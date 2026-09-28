"""頻道 API（第一版，只有權限，讀不到訊息）。

Task 4 會把這個檔案換成完整版：訊息、未讀數與發言。這一步先讓 services/channels.py
算出的可見頻道與客戶討論串上得了前端，訊息相關的兩個測試等 Task 4 一起跑
（test_channels.py 的 test_channels_you_cannot_see_do_not_exist 與
test_a_demoted_managers_channel_is_archived_for_it_only）。
"""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.db import get_session
from app.models import AppUser
from app.services import channels
from app.services.channels import ChannelInfo

router = APIRouter(tags=["channels"])
SessionDep = Annotated[Session, Depends(get_session)]


class ChannelItem(BaseModel):
    id: int
    kind: str
    name: str
    region_id: str | None
    parent_id: int | None
    archived: bool
    customer_id: str | None
    audience: str
    unread: int
    last_message_at: dt.datetime | None


def _visible(session: Session, user: AppUser, channel_id: int) -> ChannelInfo:
    try:
        return channels.get_channel(session, user, channel_id)
    except channels.NotFound:
        raise HTTPException(404, "找不到這個頻道") from None


def _items(session: Session, user: AppUser, infos: list[ChannelInfo]) -> list[ChannelItem]:
    return [
        ChannelItem(
            id=i.id, kind=i.kind, name=i.name, region_id=i.region_id, parent_id=i.parent_id,
            archived=i.archived, customer_id=i.customer_id, audience=i.audience, unread=0, last_message_at=None,
        )
        for i in infos
    ]


@router.get("/api/channels", response_model=list[ChannelItem])
def list_channels(session: SessionDep, user: CurrentUser):
    return _items(session, user, channels.visible_channels(session, user))


@router.get("/api/channels/{channel_id}", response_model=ChannelItem)
def get_channel(session: SessionDep, user: CurrentUser, channel_id: int):
    return _items(session, user, [_visible(session, user, channel_id)])[0]


@router.post("/api/customers/{customer_id}/thread", response_model=ChannelItem)
def open_customer_thread(session: SessionDep, user: CurrentUser, customer_id: str):
    try:
        info = channels.customer_thread(session, user, customer_id)
    except channels.NotFound:
        raise HTTPException(404, "找不到這家客戶的討論串") from None
    session.commit()
    return _items(session, user, [info])[0]
