"""帳號專屬的長期對話與地圖筆記；登出不刪除，刪除帳號才連帶刪除。"""

import hashlib
import datetime as dt
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.api.asks import AskKind, _detail
from app.api.attachments import attachment_item
from app.api.auth import CurrentAccount
from app.db import get_session
from app.models import AskRecord, AssistantMemoryEntry, AssistantMemoryNode, Attachment
from app.services import attachments
from app.services.assistant_context import PageContext

router = APIRouter(prefix="/api/assistant-memory", tags=["assistant-memory"])
SessionDep = Annotated[Session, Depends(get_session)]


class MemoryEntry(BaseModel):
    id: int = Field(ge=-(2**53 - 1), le=2**53 - 1)
    kind: Literal["user", "model", "tool"]
    source: Literal["voice", "typed"] = "typed"
    text: str = Field(default="", max_length=100_000)
    question: str = Field(default="", max_length=4000)
    original: str | None = Field(default=None, max_length=4000)
    askKind: AskKind | None = None
    ask_id: str | None = Field(default=None, max_length=100)
    attachment_id: int | None = None
    error: str | None = Field(default=None, max_length=4000)
    cancelled: bool = False
    auto: bool = False
    contextUsed: bool = False
    clarification: str | None = Field(default=None, max_length=4000)
    hasFile: bool = False
    page: PageContext | None = None
    threadId: str | None = Field(default=None, max_length=100)
    createdAt: dt.datetime | None = None
    ghost: bool = False


class NodeChange(BaseModel):
    id: str = Field(min_length=1, max_length=50_000)
    label: str | None = Field(default=None, max_length=80)
    note: str | None = Field(default=None, max_length=1200)
    deleted: bool = False


class MemoryChanges(BaseModel):
    entries: list[MemoryEntry] = Field(default_factory=list, max_length=100)
    nodes: list[NodeChange] = Field(default_factory=list, max_length=100)


def legacy_entry_id(ask_id: str) -> int:
    # 舊查詢也有穩定的節點編號；負數與新裝置產生的正數編號分開。
    return -(int(hashlib.sha256(ask_id.encode()).hexdigest()[:13], 16) + 1)


def entry_time(value: dt.datetime) -> str:
    # 舊資料表是 UTC 的無時區 timestamp；回傳明確時區，手機才能顯示正確時間。
    return value.replace(tzinfo=value.tzinfo or dt.UTC).isoformat()


@router.get("")
def get_memory(session: SessionDep, user: CurrentAccount, response: Response):
    response.headers["Cache-Control"] = "no-store"
    asks = {record.id: record for record in session.scalars(
        select(AskRecord).where(AskRecord.user_id == user.id, AskRecord.ghost.is_(False)).order_by(AskRecord.created_at, AskRecord.id)
    )}
    entries = []
    linked = set()
    for row in session.scalars(select(AssistantMemoryEntry).where(
        AssistantMemoryEntry.user_id == user.id
    ).order_by(AssistantMemoryEntry.created_at, AssistantMemoryEntry.entry_id)):
        entry = dict(row.data)
        if entry.get("ghost"):
            continue
        entry["createdAt"] = entry.get("createdAt") or entry_time(row.created_at)
        if entry["kind"] == "tool":
            record = asks.get(entry.pop("ask_id", None))
            entry.update(ask=_detail(session, record, user).model_dump(mode="json") if record else None,
                         routing=False, choices=None)
            if record:
                linked.add(record.id)
            elif not entry.get("error") and not entry.get("clarification"):
                entry["error"] = "上次查詢尚未完成，請重新提問。"
        else:
            attachment = session.get(Attachment, entry.pop("attachment_id")) if entry.get("attachment_id") else None
            if attachment and attachments.can_see(session, user, attachment):
                entry["attachment"] = attachment_item(attachment, user).model_dump(mode="json")
        entries.append(entry)
    # 在此功能上線前或送出後立即關頁的查詢，仍可從既有正式紀錄恢復。
    history = [dict(id=legacy_entry_id(record.id), kind="tool", askKind=record.kind,
                    question=record.question, original=None, error=None, cancelled=False,
                    routing=False, choices=None, auto=False,
                    createdAt=entry_time(record.created_at),
                    ask=_detail(session, record, user).model_dump(mode="json"))
               for record in asks.values() if record.id not in linked]
    nodes = [dict(id=row.node_id, label=row.label, note=row.note, deleted=row.deleted)
             for row in session.scalars(select(AssistantMemoryNode).where(AssistantMemoryNode.user_id == user.id))]
    return {"entries": history + entries, "nodes": nodes}


@router.patch("", status_code=204)
def save_memory(session: SessionDep, user: CurrentAccount, body: MemoryChanges):
    entries = [entry for entry in body.entries if not entry.ghost]
    ask_ids = {entry.ask_id for entry in entries if entry.ask_id}
    if ask_ids:
        owned = set(session.scalars(select(AskRecord.id).where(AskRecord.user_id == user.id, AskRecord.ghost.is_(False), AskRecord.id.in_(ask_ids))))
        if owned != ask_ids:
            raise HTTPException(404, "找不到這個提問")
    for entry in entries:
        data = entry.model_dump(mode="json")
        stmt = insert(AssistantMemoryEntry).values(user_id=user.id, entry_id=entry.id, data=data)
        session.execute(stmt.on_conflict_do_update(
            index_elements=[AssistantMemoryEntry.user_id, AssistantMemoryEntry.entry_id], set_={"data": stmt.excluded.data}
        ))
    for node in body.nodes:
        stmt = insert(AssistantMemoryNode).values(user_id=user.id, node_key=hashlib.sha256(node.id.encode()).hexdigest(), node_id=node.id,
                                                 label=node.label, note=node.note, deleted=node.deleted)
        changes = {field: getattr(stmt.excluded, field) for field in node.model_fields_set if field != "id"}
        session.execute(stmt.on_conflict_do_update(
            index_elements=[AssistantMemoryNode.user_id, AssistantMemoryNode.node_key],
            set_=changes or {"deleted": stmt.excluded.deleted}
        ))
    session.commit()
