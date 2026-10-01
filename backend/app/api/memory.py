"""頻道記憶的看板與人工修正（docs/superpowers/specs/2026-09-28-channels-design.md「API」）。

看板看得到就能看；改、刪、撤回要看得到重點所屬的頻道，而且頻道沒封存。上層的人只能看下層的重點，不能動。
看不到的一律 404，不透露它存在。
"""

import datetime as dt
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.attachments import AttachmentItem, attachment_item
from app.api.auth import CurrentUser
from app.db import get_session
from app.models import AppUser, Attachment, MemoryItem
from app.services import channels, memory_board

router = APIRouter(tags=["memory"])
SessionDep = Annotated[Session, Depends(get_session)]
Category = Literal["complaint", "competitor", "todo", "decision", "experience"]


class OwnItem(BaseModel):
    id: int
    category: str
    text: str
    status: str
    due_date: dt.date | None
    shared: bool
    shared_text: str | None
    withdrawn: bool
    # 改過內容的人；熊熊滾整理的是 None
    edited_by: str | None
    # 點一下捲到原始訊息
    source_message_ids: list[int]
    attachments: list[AttachmentItem]
    shared_attachment_ids: list[int]
    updated_at: dt.datetime


class BelowItem(BaseModel):
    """下層往上傳的重點：只有往上傳的寫法與附件，沒有原本的內容與來源訊息。"""

    id: int
    category: str
    text: str
    status: str
    due_date: dt.date | None
    attachments: list[AttachmentItem]
    updated_at: dt.datetime


class BelowGroup(BaseModel):
    channel_id: int
    channel_name: str
    items: list[BelowItem]


class BoardOut(BaseModel):
    own: list[OwnItem]
    below: list[BelowGroup]


class MemoryEdit(BaseModel):
    text: str | None = Field(default=None, max_length=500)
    category: Category | None = None
    due_date: dt.date | None = None
    status: Literal["open", "done"] | None = None
    shared_attachment_ids: list[int] | None = None


def _files(ids: list[int], attachments: dict[int, Attachment], user: AppUser) -> list[AttachmentItem]:
    # IT 刪掉的訊息連附件一起刪了：重點裡留著編號，讀的時候略過
    return [attachment_item(attachments[i], user) for i in ids if i in attachments]


def _own(item: MemoryItem, board: memory_board.Board, user: AppUser) -> OwnItem:
    return OwnItem(
        id=item.id, category=item.category, text=item.text, status=item.status, due_date=item.due_date,
        shared=item.shared, shared_text=item.shared_text, withdrawn=item.withdrawn_at is not None,
        edited_by=board.editors.get(item.updated_by) if item.updated_by else None,
        source_message_ids=list(item.source_message_ids), attachments=_files(item.attachment_ids, board.attachments, user),
        shared_attachment_ids=[i for i in item.shared_attachment_ids if i in board.attachments], updated_at=item.updated_at,
    )


@router.get("/api/channels/{channel_id}/board", response_model=BoardOut)
def get_board(session: SessionDep, user: CurrentUser, channel_id: int):
    """看板：own 是這個頻道自己的重點（含來源訊息），below 是下層往上傳的，依來源頻道分組（不含原文與來源訊息）。"""
    try:
        info = channels.get_channel(session, user, channel_id)
    except channels.NotFound:
        raise HTTPException(404, "找不到這個頻道") from None
    board = memory_board.board(session, info)
    return BoardOut(
        own=[_own(item, board, user) for item in board.own],
        below=[
            BelowGroup(
                channel_id=group.channel_id, channel_name=group.channel_name,
                items=[
                    BelowItem(
                        id=item.id, category=item.category, text=item.shared_text or item.text, status=item.status,
                        due_date=item.due_date, attachments=_files(item.shared_attachment_ids, board.attachments, user),
                        updated_at=item.updated_at,
                    )
                    for item in group.items
                ],
            )
            for group in board.below
        ],
    )


def _guarded(action):
    try:
        return action()
    except channels.NotFound:
        raise HTTPException(404, "找不到這條重點") from None
    except channels.Archived:
        raise HTTPException(409, "這個小組頻道已封存，重點不能再改") from None
    except memory_board.Invalid as exc:
        raise HTTPException(422, str(exc)) from None


@router.patch("/api/memory/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def edit_item(session: SessionDep, user: CurrentUser, item_id: int, body: MemoryEdit):
    """改內容、分類、到期日、狀態，或拿掉往上傳的附件。記下是誰改的。"""
    _guarded(lambda: memory_board.edit(session, user, item_id, body.model_dump(exclude_unset=True)))
    session.commit()


@router.delete("/api/memory/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(session: SessionDep, user: CurrentUser, item_id: int):
    _guarded(lambda: memory_board.delete(session, user, item_id))
    session.commit()


@router.post("/api/memory/{item_id}/withdraw", status_code=status.HTTP_204_NO_CONTENT)
def withdraw_item(session: SessionDep, user: CurrentUser, item_id: int):
    """撤回往上傳：所有上層的看板同時看不到，附件也一起。撤回之後不能再往上傳。"""
    _guarded(lambda: memory_board.withdraw(session, user, item_id))
    session.commit()
