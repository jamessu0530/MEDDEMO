"""位置分享（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈即時位置〉）：業務首頁的分享列要的狀態、
暫停與繼續。位置本身跟著在線狀態的心跳送（api/presence.py）。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import realtime
from app.api.auth import CurrentUser
from app.db import get_session
from app.services import locations

router = APIRouter(prefix="/api/location", tags=["location"])
SessionDep = Annotated[Session, Depends(get_session)]
NOT_SHARING = "只有業務會分享位置"


class Hours(BaseModel):
    weekdays: list[int]  # 1（一）～7（日）
    start: str  # HH:MM
    end: str  # HH:MM，這一分鐘起就是下班


class ShareState(BaseModel):
    # 這個帳號會不會分享位置（業務與代理示範業務的帳號會，主管與 IT 不會）
    applies: bool
    paused: bool
    denied: bool
    # 分享列寫「{主管名}看得到你在哪」
    manager_name: str | None
    hours: Hours


def _clock(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _out(state: locations.ShareState) -> ShareState:
    hours = state.hours
    return ShareState(
        applies=state.applies, paused=state.paused, denied=state.denied, manager_name=state.manager_name,
        hours=Hours(weekdays=sorted(hours.weekdays), start=_clock(hours.start), end=_clock(hours.end)),
    )


@router.get("/me", response_model=ShareState)
def get_mine(session: SessionDep, user: CurrentUser):
    return _out(locations.state(session, user))


def _set(session: Session, user, paused: bool) -> ShareState:
    try:
        rep_id = locations.set_paused(session, user, paused)
    except locations.NotSharing:
        raise HTTPException(403, NOT_SHARING) from None
    session.commit()
    realtime.location_changed(rep_id)
    return _out(locations.state(session, user))


@router.post("/pause", response_model=ShareState)
def pause(session: SessionDep, user: CurrentUser):
    """暫停分享：不再寫位置，主管看到「暫停分享位置」。"""
    return _set(session, user, True)


@router.post("/resume", response_model=ShareState)
def resume(session: SessionDep, user: CurrentUser):
    return _set(session, user, False)
