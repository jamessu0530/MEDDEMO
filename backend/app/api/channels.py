"""頻道 API（docs/superpowers/specs/2026-09-28-channels-design.md）：頻道列表、訊息、已讀、客戶討論串。

誰看得到哪些頻道由 services/channels.py 決定；看不到的一律 404，不透露它存在。
訊息靠畫面輪詢（打開頻道時每 3 秒問一次 after 之後的新訊息），不開長連線。
訊息裡 @熊熊滾 就排背景工作回答（services/channel_ai.py）。
"""

import datetime as dt
import logging
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from app import usage
from app.api.auth import CurrentUser, ItUser
from app.db import get_session
from app.models import MESSAGE_MAX_LENGTH, AppUser, Attachment, ChannelMessage
from app.services import attachment_processing, attachments, channel_ai, channels
from app.services.channels import ChannelInfo
from app.tasks import channels_queue

log = logging.getLogger(__name__)
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


class AttachmentItem(BaseModel):
    id: int
    kind: str
    filename: str
    width: int | None
    height: int | None
    page_count: int | None
    # 簽過名的網址，<img> 直接用；PDF 沒有縮圖
    url: str
    thumb_url: str | None


class MessageItem(BaseModel):
    id: int
    kind: str
    author_id: str | None
    author_name: str | None
    body: str
    created_at: dt.datetime
    # 是不是登入者自己發的（自建帳號看的是示範業務的頻道，但發言記在自己名下）
    mine: bool
    attachments: list[AttachmentItem] = Field(default_factory=list)
    # IT 刪掉的訊息：內容已經換成固定的一句，畫面改用灰字
    deleted: bool = False
    # 有沒有叫熊熊滾；畫面靠它和 reply_to_id 判斷熊熊滾是不是還在想
    mentions_ai: bool
    # 熊熊滾的回答指向提問那一則
    reply_to_id: int | None


class MessageInput(BaseModel):
    body: str = Field(min_length=1, max_length=MESSAGE_MAX_LENGTH)


@dataclass(frozen=True)
class MessageForm:
    body: str
    # (檔名, 內容)；JSON 發言沒有檔案
    files: list[tuple[str | None, bytes]]


async def message_form(request: Request) -> MessageForm:
    """發言可以送 JSON（只有文字），也可以送 multipart（文字加最多 4 個檔案）。"""
    if not request.headers.get("content-type", "").startswith("multipart/form-data"):
        try:
            data = MessageInput.model_validate(await request.json())
        except ValueError as exc:
            errors = exc.errors() if isinstance(exc, ValidationError) else [{"msg": "格式不對", "loc": ("body",)}]
            raise RequestValidationError(errors) from None
        return MessageForm(data.body, [])
    # 多收一個才知道是不是超過上限；超過的檔案根本不讀進來
    form = await request.form(max_files=attachments.MAX_PER_MESSAGE + 1, max_fields=5)
    uploads = [item for item in form.getlist("files") if isinstance(item, UploadFile)]
    if len(uploads) > attachments.MAX_PER_MESSAGE:
        raise HTTPException(422, f"一則訊息最多附 {attachments.MAX_PER_MESSAGE} 個檔案")
    body = form.get("body")
    files = [(upload.filename, await upload.read(attachments.MAX_FILE_BYTES + 1)) for upload in uploads]
    return MessageForm(body if isinstance(body, str) else "", files)


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


def _attachment(attachment: Attachment, user: AppUser) -> AttachmentItem:
    url, thumb_url = attachments.urls(attachment, user)
    return AttachmentItem(
        id=attachment.id, kind=attachment.kind, filename=attachment.filename, width=attachment.width,
        height=attachment.height, page_count=attachment.page_count, url=url, thumb_url=thumb_url,
    )


def _message(
    message: ChannelMessage, author_name: str | None, user: AppUser, files: list[Attachment] | None = None
) -> MessageItem:
    return MessageItem(
        id=message.id, kind=message.kind, author_id=message.author_id, author_name=author_name,
        body=message.body, created_at=message.created_at, mine=message.author_id == user.id,
        attachments=[_attachment(a, user) for a in files or []], deleted=message.deleted_at is not None,
        mentions_ai=message.mentions_ai, reply_to_id=message.reply_to_id,
    )


def _messages(session: Session, user: AppUser, rows: list) -> list[MessageItem]:
    files = attachments.for_messages(session, [message.id for message, _ in rows])
    return [_message(message, author_name, user, files.get(message.id)) for message, author_name in rows]


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
    return _messages(session, user, rows)


@router.post("/api/channels/{channel_id}/messages", response_model=MessageItem, status_code=status.HTTP_201_CREATED)
def post_message(
    request: Request,
    session: SessionDep,
    user: CurrentUser,
    channel_id: int,
    form: Annotated[MessageForm, Depends(message_form)],
):
    """發言。可以只有文字、只有檔案，或兩個都有；檔案先檢查完才寫入，有一個不收整則就不發。"""
    info = _visible(session, user, channel_id)
    text = form.body.strip()
    if not text and not form.files:
        raise HTTPException(422, "訊息不能是空的")
    if len(text) > MESSAGE_MAX_LENGTH:
        raise HTTPException(422, f"一則訊息最多 {MESSAGE_MAX_LENGTH} 字")
    try:
        prepared = [attachments.prepare(raw, filename) for filename, raw in form.files]
    except attachments.Rejected as exc:
        raise HTTPException(exc.status, str(exc)) from None
    try:
        message = channels.post(session, user, info, text)
    except channels.Archived:
        raise HTTPException(409, "這個小組頻道已封存，不能再發言") from None
    # @熊熊滾 跑的是跟問答頁一樣的查詢，算一次「提問」。middleware 只看網址分不出有沒有 @，在這裡另外扣；
    # 超過上限就整則不留（附件還沒寫），輸入框裡的字還在，提問的人看得到為什麼沒送出
    if message.mentions_ai and (blocked := usage.take("ask", request)) is not None:
        session.rollback()
        return blocked
    files = [attachments.add(session, user, p, context=text, message_id=message.id) for p in prepared]
    session.commit()
    # 寫說明、算向量在背景做；先回訊息，畫面上照片馬上看得到
    attachment_processing.enqueue([f.id for f in files])
    if message.mentions_ai:
        _call_mascot(session, message)
    return _message(message, user.name, user, files)


def _call_mascot(session: Session, message: ChannelMessage) -> None:
    """排熊熊滾的背景工作。排不進去（Redis 連不上）就直接道歉，提問那一則照樣留著，可以再 @ 一次。"""
    try:
        channels_queue().enqueue("app.services.channel_ai.run", message.id)
    except Exception:
        log.exception("排入熊熊滾的背景工作失敗 message=%s", message.id)
        channels.post_mascot(session, message.channel_id, channel_ai.SORRY, message.id)
        session.commit()


@router.delete("/api/channels/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_message(session: SessionDep, user: ItUser, message_id: int):
    """IT 刪訊息（擋濫用）：附件整列刪掉、內容換成固定的一句，這一則本身留著。發言的人自己不能刪。"""
    try:
        channels.delete_message(session, user, message_id)
    except channels.NotFound:
        raise HTTPException(404, "找不到這則訊息") from None
    session.commit()


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
