"""頻道 API（docs/superpowers/specs/2026-09-28-channels-design.md）：頻道列表、訊息、已讀、客戶討論串。

誰看得到哪些頻道由 services/channels.py 決定；看不到的一律 404，不透露它存在。
訊息靠畫面輪詢（打開頻道時每 3 秒問一次 after 之後的新訊息），不開長連線。
"""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.db import get_session
from app.models import MESSAGE_MAX_LENGTH, AppUser, ChannelMessage
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
    # 輸入框上的提示：誰看得到這裡的訊息
    audience: str
    unread: int
    last_message_at: dt.datetime | None


class MessageItem(BaseModel):
    id: int
    kind: str
    author_id: str | None
    author_name: str | None
    body: str
    created_at: dt.datetime
    # 是不是登入者自己發的（自建帳號看的是示範業務的頻道，但發言記在自己名下）
    mine: bool


class MessageInput(BaseModel):
    body: str = Field(min_length=1, max_length=MESSAGE_MAX_LENGTH)


class ReadInput(BaseModel):
    message_id: int


class Unread(BaseModel):
    count: int


def _items(session: Session, user: AppUser, infos: list[ChannelInfo]) -> list[ChannelItem]:
    ids = [info.id for info in infos]
    unread = channels.unread_counts(session, user, ids)
    latest = channels.last_message_at(session, ids)
    return [
        ChannelItem(
            id=i.id, kind=i.kind, name=i.name, region_id=i.region_id, parent_id=i.parent_id,
            archived=i.archived, customer_id=i.customer_id, audience=i.audience,
            unread=unread.get(i.id, 0), last_message_at=latest.get(i.id),
        )
        for i in infos
    ]


def _message(message: ChannelMessage, author_name: str | None, user: AppUser) -> MessageItem:
    return MessageItem(
        id=message.id, kind=message.kind, author_id=message.author_id, author_name=author_name,
        body=message.body, created_at=message.created_at, mine=message.author_id == user.id,
    )


def _visible(session: Session, user: AppUser, channel_id: int) -> ChannelInfo:
    try:
        return channels.get_channel(session, user, channel_id)
    except channels.NotFound:
        raise HTTPException(404, "找不到這個頻道") from None


@router.get("/api/channels", response_model=list[ChannelItem])
def list_channels(session: SessionDep, user: CurrentUser):
    """看得到的頻道，不含客戶討論串。全國在最前面，接著各區由北到南（整區、小組、地點）。"""
    return _items(session, user, channels.visible_channels(session, user))


# 要寫在 /api/channels/{channel_id} 前面，不然 unread 會被當成頻道編號
@router.get("/api/channels/unread", response_model=Unread)
def unread_badge(session: SessionDep, user: CurrentUser):
    """分頁列紅點的數字（規則見 services/channels.badge_count）。畫面每分鐘問一次。"""
    return Unread(count=channels.badge_count(session, user))


@router.get("/api/channels/{channel_id}", response_model=ChannelItem)
def get_channel(session: SessionDep, user: CurrentUser, channel_id: int):
    return _items(session, user, [_visible(session, user, channel_id)])[0]


@router.get("/api/channels/{channel_id}/messages", response_model=list[MessageItem])
def list_messages(
    session: SessionDep,
    user: CurrentUser,
    channel_id: int,
    after: int | None = None,
    before: int | None = None,
    limit: Annotated[int, Query(ge=1, le=channels.MESSAGE_PAGE)] = channels.MESSAGE_PAGE,
):
    """由舊到新。after 給輪詢用，before 給往上捲；都沒給就是最新的一頁。"""
    info = _visible(session, user, channel_id)
    rows = channels.messages(session, info.id, after=after, before=before, limit=limit)
    return [_message(message, author_name, user) for message, author_name in rows]


@router.post("/api/channels/{channel_id}/messages", response_model=MessageItem, status_code=status.HTTP_201_CREATED)
def post_message(session: SessionDep, user: CurrentUser, channel_id: int, body: MessageInput):
    info = _visible(session, user, channel_id)
    text = body.body.strip()
    if not text:
        raise HTTPException(422, "訊息不能是空的")
    try:
        message = channels.post(session, user, info, text)
    except channels.Archived:
        raise HTTPException(409, "這個小組頻道已封存，不能再發言") from None
    session.commit()
    return _message(message, user.name, user)


@router.post("/api/channels/{channel_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(session: SessionDep, user: CurrentUser, channel_id: int, body: ReadInput):
    info = _visible(session, user, channel_id)
    channels.mark_read(session, user, info.id, body.message_id)
    session.commit()


@router.get("/api/channels/{channel_id}/threads", response_model=list[ChannelItem])
def list_threads(session: SessionDep, user: CurrentUser, channel_id: int):
    """地點頻道底下有人發過言的客戶討論串，最近有訊息的在前。"""
    info = _visible(session, user, channel_id)
    # 全國、整區、小組頻道底下沒有討論串這個概念，不是「還沒有人開」，回 404 才不會讓畫面顯示誤導的空清單
    if info.kind != "place":
        raise HTTPException(404, "找不到這個地點")
    return _items(session, user, channels.threads(session, user, info))


@router.post("/api/customers/{customer_id}/thread", response_model=ChannelItem)
def open_customer_thread(session: SessionDep, user: CurrentUser, customer_id: str):
    """這家客戶的討論串，沒有就建一個，可以重複呼叫。整區的人與負責人（和他的主管）打得開。"""
    try:
        info = channels.customer_thread(session, user, customer_id)
    except channels.NotFound:
        raise HTTPException(404, "找不到這家客戶的討論串") from None
    session.commit()
    return _items(session, user, [info])[0]
