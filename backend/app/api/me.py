"""個人頁（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈個人頁〉）。

是誰的由 token 決定：代理示範業務的帳號看示範業務的；主管與 IT 沒有拜訪路線，也就沒有個人頁。
"""

import dataclasses
from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.db import get_session
from app.services import achievements
from app.services.auth import role_data_user

router = APIRouter(prefix="/api/me", tags=["me"])
SessionDep = Annotated[Session, Depends(get_session)]
NO_ROUTE = "主管沒有自己的拜訪路線"


class MedalOut(BaseModel):
    kind: Literal["stores", "cities", "chronic", "otc", "wellness", "devices"]
    tier: Literal[1, 2, 3]
    need: int
    have: int
    unlocked_on: date | None
    unlocked_at: datetime | None
    title: str
    condition: str
    unit: str
    action_path: str | None


class StatsOut(BaseModel):
    visits_last_year: int
    customers: int
    sales_last_year: float


class TopCustomerOut(BaseModel):
    customer_id: str
    name: str
    amount: float


class MonthOut(BaseModel):
    month: str
    amount: float
    through: date | None


class MeOut(BaseModel):
    name: str
    region: str
    stats: StatsOut
    medals: list[MedalOut]
    top_customers: list[TopCustomerOut]
    monthly: list[MonthOut]


def medal_out(medal: achievements.Medal) -> MedalOut:
    return MedalOut(**dataclasses.asdict(medal))


@router.get("", response_model=MeOut)
def get_me(session: SessionDep, user: CurrentUser):
    """個人頁的全部數字：三格事蹟、六面獎牌、近一年賣最多的五家、近六個月每月業績。"""
    rep = role_data_user(user)
    if rep is None or rep.role != "sales":
        raise HTTPException(403, NO_ROUTE)
    result = dataclasses.asdict(achievements.build(session, rep, learning_user_id=user.id))
    return MeOut(**{**result, "name": user.name, "region": user.region})
