"""我的排序習慣（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈我的排序習慣〉）。

只有業務自己看得到、改得了，習慣是誰的跟行程一樣由 token 決定（第三方登入代理示範業務時是示範業務的）。
主管看不到業務的習慣，自己也沒有。新增或改了習慣不回頭改今天已存的行程。
"""

import datetime as dt
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.db import get_session
from app.models import AppUser, RouteHabit
from app.services import customer_profile, itinerary, route_habits

router = APIRouter(prefix="/api/route-habits", tags=["route-habits"])
SessionDep = Annotated[Session, Depends(get_session)]
NO_ROUTE = "主管沒有自己的拜訪路線"
WindowKind = Literal["at", "before", "after"]


class Target(BaseModel):
    by: Literal["customer", "chain", "type", "area"]
    value: str = Field(min_length=1, max_length=50)


class HabitInput(BaseModel):
    """一條習慣。object 只有先後用（subject 那幾家排在 object 那幾家前面）；window_* 只有約的時段用；
    duration_minutes 只有停留用。種類缺欄位、對象不是自己的由服務層檢查，錯誤訊息才講得出是哪裡不對。"""

    model_config = ConfigDict(populate_by_name=True)

    kind: Literal["precedence", "first", "last", "window", "duration"]
    subject: Target
    then: Target | None = Field(default=None, alias="object")
    window_kind: WindowKind | None = None
    window_time: dt.time | None = None
    duration_minutes: int | None = Field(default=None, ge=5, le=480)
    weekday: int | None = Field(default=None, ge=0, le=6)

    def spec(self) -> route_habits.HabitSpec:
        return route_habits.HabitSpec(
            kind=self.kind, subject=self.subject.model_dump(), object=self.then.model_dump() if self.then else None,
            window_kind=self.window_kind, window_time=self.window_time, duration_minutes=self.duration_minutes,
            weekday=self.weekday,
        )


class HabitOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: int
    kind: str
    subject: Target
    then: Target | None = Field(default=None, alias="object")
    window_kind: str | None
    window_time: str | None  # "HH:MM"
    duration_minutes: int | None
    weekday: int | None
    text: str
    source: str
    active: bool
    created_at: dt.datetime
    # 今天的狀態。applied：套用中；skipped：今天不套用（原因在 skip_reason）；off：停用；other_day：不是今天
    today: Literal["applied", "skipped", "off", "other_day"]
    skip_reason: str | None


class TargetOption(BaseModel):
    value: str
    label: str


class HabitList(BaseModel):
    weekday: int  # 今天星期幾（0 是星期一），「今天（星期三）套用中」那一組用
    habits: list[HabitOut]
    targets: dict[str, list[TargetOption]]  # 新增習慣能選的對象


class HabitChanges(BaseModel):
    active: bool


def _rep(session: Session, user: AppUser) -> str:
    rep_id = user.acts_as_user_id or user.id
    rep = session.get(AppUser, rep_id)
    if rep is None or rep.role != "sales":
        raise HTTPException(403, NO_ROUTE)
    return rep_id


def _find(session: Session, rep_id: str, habit_id: int) -> RouteHabit:
    try:
        return route_habits.find(session, rep_id, habit_id)
    except LookupError:
        raise HTTPException(404, "找不到這條習慣") from None


def _out(habit: RouteHabit, today: dt.date, skips: dict[int, str]) -> HabitOut:
    if not habit.active:
        state = "off"
    elif habit.weekday is not None and habit.weekday != today.weekday():
        state = "other_day"
    elif habit.id in skips:
        state = "skipped"
    else:
        state = "applied"
    return HabitOut(
        id=habit.id, kind=habit.kind, subject=Target(**habit.subject),
        then=Target(**habit.object) if habit.object else None, window_kind=habit.window_kind,
        window_time=habit.window_time.strftime("%H:%M") if habit.window_time else None,
        duration_minutes=habit.duration_minutes, weekday=habit.weekday, text=habit.text, source=habit.source,
        active=habit.active, created_at=habit.created_at, today=state,
        skip_reason=skips[habit.id] if state == "skipped" else None,
    )


@router.get("", response_model=HabitList)
def list_habits(session: SessionDep, user: CurrentUser):
    """我的排序習慣，舊的在前；含今天哪幾條沒套用、為什麼，以及新增表單能選的對象。"""
    rep_id = _rep(session, user)
    today = customer_profile.app_today(session)
    skips = itinerary.today_skips(session, rep_id)
    options = route_habits.targets(session, rep_id)
    return HabitList(
        weekday=today.weekday(),
        habits=[_out(habit, today, skips) for habit in route_habits.mine(session, rep_id)],
        targets={by: [TargetOption(value=v, label=label) for v, label in items] for by, items in options.items()},
    )


@router.post("", response_model=HabitOut, status_code=status.HTTP_201_CREATED)
def create_habit(session: SessionDep, body: HabitInput, user: CurrentUser):
    """在習慣頁自己新增一條。"""
    rep_id = _rep(session, user)
    try:
        habit = route_habits.create(session, rep_id, body.spec(), "manual")
    except route_habits.InvalidHabit as exc:
        raise HTTPException(422, str(exc)) from None
    result = _out(habit, customer_profile.app_today(session), {})
    session.commit()
    return result


@router.patch("/{habit_id}", response_model=HabitOut)
def change_habit(session: SessionDep, habit_id: int, body: HabitChanges, user: CurrentUser):
    """停用或重新啟用（停用不刪）。"""
    rep_id = _rep(session, user)
    habit = _find(session, rep_id, habit_id)
    habit.active = body.active
    session.flush()
    result = _out(habit, customer_profile.app_today(session), itinerary.today_skips(session, rep_id))
    session.commit()
    return result


@router.delete("/{habit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_habit(session: SessionDep, habit_id: int, user: CurrentUser):
    rep_id = _rep(session, user)
    session.delete(_find(session, rep_id, habit_id))
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
