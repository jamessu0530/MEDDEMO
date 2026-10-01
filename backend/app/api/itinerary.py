"""今天的行程（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md）。

行程是誰的由 token 決定，不是前端說了算：第三方登入開的帳號自己沒有客戶，看示範業務的行程。
"""

import dataclasses
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.db import get_session
from app.models import AppUser
from app.services import itinerary as service

router = APIRouter(prefix="/api/itinerary", tags=["itinerary"])
SessionDep = Annotated[Session, Depends(get_session)]
NO_ROUTE = "主管沒有自己的拜訪路線"


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
    )


@router.get("/today", response_model=TodayItinerary)
def get_today(session: SessionDep, user: CurrentUser):
    """今天的行程；當天第一次讀取時照模型的建議建好。"""
    try:
        itinerary = service.get_or_create(session, _rep_id(user))
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    result = _out(service.view(session, itinerary))
    session.commit()
    return result


@router.post("/today/feedback", response_model=TodayItinerary)
def send_feedback(session: SessionDep, body: FeedbackInput, user: CurrentUser):
    """需立即處理的三顆鈕：插入下一站、暫緩、誤判。"""
    try:
        itinerary = service.apply_feedback(session, _rep_id(user), body.customer_id, body.action, body.version)
    except service.VersionConflict:
        raise HTTPException(409, "行程剛被改過，已幫你重新整理") from None
    except service.NotOnItinerary:
        raise HTTPException(404, "這家不在今天還沒跑的站裡") from None
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    result = _out(service.view(session, itinerary))
    session.commit()
    return result


@router.post("/today/stops", response_model=StopsResult)
def add_stops(session: SessionDep, body: StopsInput, user: CurrentUser):
    """問答答案提到的客戶加進今天的行程，各自插在多繞最少的位置。"""
    try:
        itinerary, added, skipped = service.add_stops(session, _rep_id(user), body.customer_ids)
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    result = StopsResult(
        itinerary=_out(service.view(session, itinerary)), added=added,
        skipped=[SkippedStop(**dataclasses.asdict(item)) for item in skipped],
    )
    session.commit()
    return result
