"""今天的行程（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md）。

行程是誰的由 token 決定，不是前端說了算：第三方登入開的帳號自己沒有客戶，看示範業務的行程。
"""

import dataclasses
import logging
from datetime import date, time
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from google.genai import errors
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.api.route_habits import HabitInput
from app.config import NotConfigured
from app.db import get_session
from app.llm import LLMOutputError
from app.models import AppUser
from app.services import itinerary as service
from app.services import itinerary_ai

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/itinerary", tags=["itinerary"])
SessionDep = Annotated[Session, Depends(get_session)]
NO_ROUTE = "主管沒有自己的拜訪路線"
STALE = "行程剛被改過，已幫你重新整理"
NO_AI = "熊熊滾現在沒辦法排行程"
MISHEARD = "熊熊滾這次沒聽懂，請換個說法再試一次"
ASKED_STALE = "行程在你問完之後改過了"


class Rep(BaseModel):
    id: str
    name: str
    region: str


class Urgent(BaseModel):
    customer_id: str
    customer_name: str
    signal: str
    headline: str
    detail: str
    note: str | None


class Stop(BaseModel):
    customer_id: str
    customer_name: str
    type: str
    grade: str
    planned_time: str
    status: str
    signal: str
    reason: str
    visit_id: str | None
    source: str
    duration_minutes: int
    late_minutes: int
    travel_minutes: int | None
    travel_km: float | None
    window_kind: str | None
    window_time: str | None
    note: str | None
    locked: bool
    habit_ids: list[int]


class Rule(BaseModel):
    id: str
    text: str
    kind: str
    source: str
    customer_ids: list[str]


class PrecedenceOut(BaseModel):
    before: str
    after: str


class SkippedHabit(BaseModel):
    id: int
    text: str
    reason: str
    conflict: bool


class TodayItinerary(BaseModel):
    date: date
    rep: Rep
    version: int
    done: int
    total: int
    urgent: Urgent | None
    stops: list[Stop]
    travel_minutes: int
    travel_km: float
    finish_time: str | None
    estimated: bool
    rules: list[Rule]
    violations: list[str]
    precedences: list[PrecedenceOut]
    skipped_habits: list[SkippedHabit]


class FeedbackInput(BaseModel):
    customer_id: str
    action: Literal["pin", "snooze", "misjudge"]
    version: int


class StopsInput(BaseModel):
    customer_ids: list[str] = Field(min_length=1, max_length=20)


class SkippedStop(BaseModel):
    customer_id: str
    customer_name: str
    reason: str


class StopsResult(BaseModel):
    itinerary: TodayItinerary
    added: list[str]
    skipped: list[SkippedStop]


class DraftStopInput(BaseModel):
    customer_id: str
    duration_minutes: int = Field(default=40, ge=5, le=480)
    window_kind: Literal["at", "before", "after"] | None = None
    window_time: time | None = None
    note: str | None = Field(default=None, max_length=200)
    locked: bool = False

    @model_validator(mode="after")
    def window_needs_both(self):
        if (self.window_kind is None) != (self.window_time is None):
            raise ValueError("約的時間要選幾點到、以前或以後，再填時間")
        return self


class PrecedenceInput(BaseModel):
    before: str
    after: str


class PendingHabitInput(HabitInput):
    # 紅框上按了「今天不套用這條」：照樣記下來，只是今天不套用
    skip_today: bool = False


class DraftInput(BaseModel):
    """調整清單上的草稿：還沒跑的站照畫面上的順序。"""

    stops: list[DraftStopInput] = Field(max_length=20)
    precedences: list[PrecedenceInput] = Field(default_factory=list, max_length=50)
    skipped_habit_ids: list[int] = Field(default_factory=list, max_length=100)
    habits: list[PendingHabitInput] = Field(default_factory=list, max_length=10)

    def draft(self) -> service.Draft:
        return service.Draft(
            stops=[
                service.DraftStop(s.customer_id, s.duration_minutes, s.window_kind, s.window_time, s.note, s.locked)
                for s in self.stops
            ],
            precedences=[(p.before, p.after) for p in self.precedences],
            skipped_habit_ids=list(self.skipped_habit_ids),
            habits=[service.PendingHabit(h.spec(), h.skip_today) for h in self.habits],
        )


class PreviewInput(DraftInput):
    insert: str | None = None  # 「加一站」點的那一家


class SaveInput(DraftInput):
    version: int


class CandidateOut(BaseModel):
    customer_id: str
    customer_name: str
    type: str
    area: str
    signal: str | None
    after_stop: int | None
    extra_minutes: int | None


class CandidateList(BaseModel):
    nearby: list[CandidateOut]
    others: list[CandidateOut]
    full: bool


class AskInput(BaseModel):
    question: str = Field(min_length=1, max_length=300)
    # 「要選一個」時業務按的那一家，跟原句一起再送一次
    customer_id: str | None = None


class ProposalStop(BaseModel):
    customer_id: str
    customer_name: str
    planned_time: str
    late_minutes: int


class ProposalSide(BaseModel):
    stops: list[ProposalStop]
    travel_minutes: int
    travel_km: float


class CustomerName(BaseModel):
    customer_id: str
    customer_name: str


class ProposalOut(BaseModel):
    """對照卡。kind：proposal 提案（changed 是 False 時沒有「套用」）、conflict 規則互相衝突排不出來、
    ask_which 名字對到好幾家要選一個、answer 只回答。一行一行的字都是後端寫好的。"""

    id: int
    question: str | None
    kind: Literal["proposal", "conflict", "ask_which", "answer"]
    summary: str
    changed: bool
    before: ProposalSide | None
    after: ProposalSide | None
    rule_costs: list[str]
    late: list[str]
    habits_added: list[str]
    habits_disabled: list[str]
    dropped: list[str]
    notes: list[str]
    conflict: list[str]
    mention: str | None
    candidates: list[CustomerName]
    text: str | None
    estimated: bool


def _rep_id(user: AppUser) -> str:
    return user.acts_as_user_id or user.id


def _out(view: service.ItineraryView) -> TodayItinerary:
    return TodayItinerary(
        date=view.date, rep=Rep(id=view.rep.id, name=view.rep.name, region=view.rep.region),
        version=view.version, done=view.done, total=view.total,
        urgent=Urgent(**view.urgent) if view.urgent else None,
        stops=[Stop(**dataclasses.asdict(stop)) for stop in view.stops],
        travel_minutes=view.travel_minutes, travel_km=view.travel_km, finish_time=view.finish_time,
        estimated=view.estimated,
        rules=[Rule(**dataclasses.asdict(r)) for r in view.rules], violations=view.violations,
        precedences=[PrecedenceOut(**dataclasses.asdict(p)) for p in view.precedences],
        skipped_habits=[SkippedHabit(**dataclasses.asdict(h)) for h in view.skipped_habits],
    )


def _proposal(proposal) -> ProposalOut:
    return ProposalOut(id=proposal.id, question=proposal.question, **proposal.result)


@router.get("/today", response_model=TodayItinerary)
def get_today(session: SessionDep, user: CurrentUser):
    """今天的行程；當天第一次讀取時照模型的建議建好。"""
    try:
        itinerary = service.get_or_create(session, _rep_id(user))
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    # 先提交再算畫面：算車程可能要等 Google，不要讓剛建好的那一列一直卡著同時第一次讀的人
    session.commit()
    return _out(service.view(session, itinerary))


@router.post("/today/feedback", response_model=TodayItinerary)
def send_feedback(session: SessionDep, body: FeedbackInput, user: CurrentUser):
    """需立即處理的三顆鈕：插入下一站、暫緩、誤判。"""
    try:
        itinerary = service.apply_feedback(session, _rep_id(user), body.customer_id, body.action, body.version)
    except service.VersionConflict:
        raise HTTPException(409, STALE) from None
    except service.NotOnItinerary:
        raise HTTPException(404, "這家不在今天還沒跑的站裡") from None
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    # 先提交、放掉列鎖再算畫面：算車程可能要等 Google
    session.commit()
    return _out(service.view(session, itinerary))


@router.post("/today/stops", response_model=StopsResult)
def add_stops(session: SessionDep, body: StopsInput, user: CurrentUser):
    """問答答案提到的客戶加進今天的行程，各自插在多繞最少的位置。"""
    try:
        itinerary, added, skipped = service.add_stops(session, _rep_id(user), body.customer_ids)
    except service.VersionConflict:
        raise HTTPException(409, STALE) from None
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    session.commit()
    return StopsResult(
        itinerary=_out(service.view(session, itinerary)), added=added,
        skipped=[SkippedStop(**dataclasses.asdict(item)) for item in skipped],
    )


@router.post("/today/preview", response_model=TodayItinerary)
def preview_today(session: SessionDep, body: PreviewInput, user: CurrentUser):
    """調整清單上的改動算時間、車程與違反的規則，不存；insert 是「加一站」點的那一家。"""
    try:
        view = service.preview(session, _rep_id(user), body.draft(), body.insert)
    except service.InvalidDraft as exc:
        raise HTTPException(422, str(exc)) from None
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    result = _out(view)
    # 不存任何改動；當天第一次讀就是這一支時，建好的行程要留下來
    session.commit()
    return result


@router.put("/today", response_model=TodayItinerary)
def save_today(session: SessionDep, body: SaveInput, user: CurrentUser):
    """調整清單按「完成」：整份還沒跑的站、今天的先後、今天不套用的習慣、要新增的習慣一次存進去。"""
    try:
        itinerary = service.save(session, _rep_id(user), body.version, body.draft())
    except service.VersionConflict:
        raise HTTPException(409, STALE) from None
    except service.InvalidDraft as exc:
        raise HTTPException(422, str(exc)) from None
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    session.commit()
    return _out(service.view(session, itinerary))


@router.get("/today/candidates", response_model=CandidateList)
def list_candidates(session: SessionDep, user: CurrentUser, order: str | None = None, locked: str = ""):
    """加一站的候選。order、locked 是調整清單上目前還沒跑的站與鎖住的站（逗號分隔）；沒給 order 就用存著的。"""
    ids = [cid for cid in order.split(",") if cid] if order is not None else None
    try:
        found = service.candidates(session, _rep_id(user), ids, [cid for cid in locked.split(",") if cid])
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    result = CandidateList(
        nearby=[CandidateOut(**dataclasses.asdict(c)) for c in found.nearby],
        others=[CandidateOut(**dataclasses.asdict(c)) for c in found.others], full=found.full,
    )
    session.commit()
    return result


@router.post("/today/ask", response_model=ProposalOut)
def ask_route(session: SessionDep, body: AskInput, user: CurrentUser):
    """跟熊熊滾說要怎麼排：一次 Gemini 把話翻成操作，回對照卡（還沒套用）。算進用量上限（usage.py）。"""
    try:
        proposal = itinerary_ai.ask(session, _rep_id(user), body.question.strip(), body.customer_id)
    except NotConfigured:
        raise HTTPException(503, NO_AI) from None
    except (LLMOutputError, errors.APIError) as exc:
        log.warning("跟熊熊滾說要怎麼排：Gemini 沒有給可以用的回答：%s", exc)
        raise HTTPException(502, MISHEARD) from None
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    result = _proposal(proposal)
    session.commit()
    return result


@router.post("/today/optimize", response_model=ProposalOut)
def optimize_route(session: SessionDep, user: CurrentUser):
    """「幫我排順一點」：整條重排，回同一種對照卡。不呼叫 Gemini。"""
    try:
        proposal = itinerary_ai.optimize(session, _rep_id(user))
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    result = _proposal(proposal)
    session.commit()
    return result


@router.post("/proposals/{proposal_id}/apply", response_model=TodayItinerary)
def apply_proposal(session: SessionDep, proposal_id: int, user: CurrentUser):
    """套用提案：照存下來的操作在最新的行程上再做一次，版本對不上回 409。"""
    try:
        itinerary = itinerary_ai.apply(session, _rep_id(user), proposal_id)
    except itinerary_ai.ProposalNotFound:
        raise HTTPException(404, "找不到這個提案") from None
    except service.VersionConflict:
        raise HTTPException(409, ASKED_STALE) from None
    except itinerary_ai.NotApplicable:
        raise HTTPException(422, "這個提案不能套用") from None
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    # 先提交、放掉列鎖再算畫面：算車程可能要等 Google
    session.commit()
    return _out(service.view(session, itinerary))
