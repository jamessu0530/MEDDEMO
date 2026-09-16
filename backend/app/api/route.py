"""今日路線（原型的首頁）：今天該去哪幾家、先去哪一家、為什麼。"""

import dataclasses
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.db import get_session
from app.services import today_route

router = APIRouter(prefix="/api", tags=["route"])
SessionDep = Annotated[Session, Depends(get_session)]


class Rep(BaseModel):
    id: str
    name: str
    region: str


class Snooze(BaseModel):
    customer_id: str
    until: date


class Feedback(BaseModel):
    """三顆鈕按出來的結果。存在使用者手機上，每次要路線時一起送來。"""

    snoozed: list[Snooze] = Field(default_factory=list)
    pinned: list[str] = Field(default_factory=list)
    signal_weights: dict[str, float] = Field(default_factory=dict)


class RouteRequest(BaseModel):
    feedback: Feedback | None = None


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


class Urgent(BaseModel):
    customer_id: str
    customer_name: str
    signal: str
    headline: str
    detail: str
    note: str | None


class TodayRoute(BaseModel):
    date: date
    rep: Rep
    done: int
    total: int
    urgent: Urgent | None
    stops: list[Stop]


@router.post("/route/today", response_model=TodayRoute)
def get_today_route(session: SessionDep, body: RouteRequest, user: CurrentUser):
    """今天要跑哪幾家。路線是誰的由 token 決定，不是前端說了算。"""
    feedback = today_route.Feedback(
        snoozed={s.customer_id: s.until for s in body.feedback.snoozed},
        pinned=list(body.feedback.pinned),
        signal_weights=dict(body.feedback.signal_weights),
    ) if body.feedback else today_route.Feedback()
    try:
        # 第三方登入開的帳號自己沒有客戶，看示範業務的路線
        result = today_route.build(session, user.acts_as_user_id or user.id, feedback)
    except LookupError:
        raise HTTPException(status_code=403, detail="主管沒有自己的拜訪路線") from None
    return TodayRoute(
        date=result.date,
        rep=Rep(id=result.rep.id, name=result.rep.name, region=result.rep.region),
        done=result.done,
        total=result.total,
        urgent=Urgent(**dataclasses.asdict(result.urgent)) if result.urgent else None,
        stops=[Stop(**dataclasses.asdict(s)) for s in result.stops],
    )
