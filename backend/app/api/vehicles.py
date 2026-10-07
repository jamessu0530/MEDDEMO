"""座騎圖鑑（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md〈座騎圖鑑〉）。

騎的人由 token 決定：第三方登入開的帳號記在示範業務名下；主管與 IT 沒有拜訪路線，也就沒有座騎。
"""

import datetime as dt
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.db import get_session
from app.models import AppUser
from app.services import vehicles as service
from app.services.google_routes import TravelMode

router = APIRouter(prefix="/api/vehicles", tags=["vehicles"])
SessionDep = Annotated[Session, Depends(get_session)]
NO_ROUTE = "主管沒有自己的拜訪路線"
RideCityName = Literal["台北市", "新北市", "新竹市", "台中市", "彰化縣", "台南市", "高雄市"]


class RideIn(BaseModel):
    city: RideCityName
    mode: TravelMode


class RidesInput(BaseModel):
    rides: list[RideIn] = Field(min_length=1, max_length=4)


class RiddenOut(BaseModel):
    city: str
    mode: str
    ridden_at: dt.datetime | None


class CollectionOut(BaseModel):
    total: int
    ridden: int
    items: list[RiddenOut]


def _rep_id(session: Session, user: AppUser) -> str:
    """業務才有座騎；代理示範業務的帳號記在示範業務名下。"""
    rep_id = user.acts_as_user_id or user.id
    rep = session.get(AppUser, rep_id)
    if rep is None or rep.role != "sales":
        raise HTTPException(403, NO_ROUTE)
    return rep_id


@router.post("/rides", status_code=204)
def post_rides(session: SessionDep, body: RidesInput, user: CurrentUser):
    """記下剛騎過的座騎（已經記過的不動）。"""
    service.record(session, _rep_id(session, user), [(r.city, r.mode) for r in body.rides])
    session.commit()
    return Response(status_code=204)


@router.get("", response_model=CollectionOut)
def get_collection(session: SessionDep, user: CurrentUser):
    """28 種座騎各騎過沒有。"""
    items = service.collection(session, _rep_id(session, user))
    return CollectionOut(
        total=len(items), ridden=sum(1 for i in items if i.ridden_at),
        items=[RiddenOut(city=i.city, mode=i.mode, ridden_at=i.ridden_at) for i in items],
    )
