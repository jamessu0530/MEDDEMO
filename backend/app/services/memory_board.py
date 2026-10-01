"""記憶看板與人工修正（docs/superpowers/specs/2026-09-28-channels-design.md「看板與往上傳」）。

某個頻道的看板 = 自己的重點 ＋ 所有下層頻道裡往上傳、沒撤回、沒刪除的重點，依來源頻道分組。
上層不會把下層的重點重新整理一次：撤回一條，它就從所有上層同時消失。下層的重點給上層看時只給往上傳的寫法與
往上傳的附件，不給原本的內容與來源訊息。改、刪、撤回只能在重點所屬的頻道做，而且頻道沒封存。
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.embeddings import optional_embedder
from app.models import MEMORY_CATEGORIES, AppUser, Attachment, Channel, MemoryItem
from app.services import channels
from app.services.channel_memory import memory_text
from app.services.channels import ChannelInfo


class Invalid(ValueError):
    """改的內容不合規則（例如想加一張沒往上傳過的附件），訊息直接顯示給使用者。"""


@dataclass
class BelowGroup:
    channel_id: int
    channel_name: str
    items: list[MemoryItem] = field(default_factory=list)


@dataclass
class Board:
    own: list[MemoryItem]
    below: list[BelowGroup]
    # 看板上要顯示縮圖的附件（自己的重點的來源附件、下層往上傳的附件）
    attachments: dict[int, Attachment]
    # 改過內容的人的名字
    editors: dict[str, str]


def descendants(session: Session, channel_id: int) -> dict[int, ChannelInfo]:
    """所有下層頻道（客戶討論串 → 地點 → 整區 → 全國；小組 → 整區 → 全國），連下層的下層。"""
    infos = channels.describe(session, list(session.scalars(select(Channel))))
    children: dict[int, list[ChannelInfo]] = defaultdict(list)
    for info in infos:
        if info.parent_id is not None:
            children[info.parent_id].append(info)
    found: dict[int, ChannelInfo] = {}
    stack = list(children[channel_id])
    while stack:
        info = stack.pop()
        if info.id not in found:
            found[info.id] = info
            stack += children[info.id]
    return found


def _order(item: MemoryItem) -> tuple:
    # 沒做完的待辦在最上面（到期日早的先），其他依最近變動，做完的待辦最後
    if item.category == "todo" and item.status == "open":
        return (0, item.due_date or dt.date.max, -item.updated_at.timestamp())
    if item.category == "todo":
        return (2, dt.date.max, -item.updated_at.timestamp())
    return (1, dt.date.max, -item.updated_at.timestamp())


def board(session: Session, info: ChannelInfo) -> Board:
    own = sorted(
        session.scalars(select(MemoryItem).where(MemoryItem.channel_id == info.id, MemoryItem.deleted_at.is_(None))),
        key=_order,
    )
    below_channels = descendants(session, info.id)
    groups: dict[int, BelowGroup] = {}
    if below_channels:
        shared = session.scalars(
            select(MemoryItem).where(
                MemoryItem.channel_id.in_(below_channels),
                MemoryItem.shared.is_(True),
                MemoryItem.withdrawn_at.is_(None),
                MemoryItem.deleted_at.is_(None),
            )
        )
        for item in sorted(shared, key=_order):
            source = below_channels[item.channel_id]
            groups.setdefault(item.channel_id, BelowGroup(source.id, source.name)).items.append(item)
    ids = {a for item in own for a in item.attachment_ids} | {
        a for group in groups.values() for item in group.items for a in item.shared_attachment_ids
    }
    attachments = {a.id: a for a in session.scalars(select(Attachment).where(Attachment.id.in_(ids)))} if ids else {}
    editor_ids = {item.updated_by for item in own if item.updated_by}
    editors = dict(session.execute(select(AppUser.id, AppUser.name).where(AppUser.id.in_(editor_ids))).all()) if editor_ids else {}
    # 最近有動靜的來源頻道排前面
    ordered = sorted(groups.values(), key=lambda g: -max(i.updated_at.timestamp() for i in g.items))
    return Board(own, ordered, attachments, editors)


def editable(session: Session, user: AppUser, item_id: int) -> tuple[MemoryItem, ChannelInfo]:
    """改、刪、撤回之前的檢查：看得到這條重點所屬的頻道，而且頻道沒封存。上層的人只能看下層的重點，不能動。"""
    item = session.get(MemoryItem, item_id)
    if item is None or item.deleted_at is not None:
        raise channels.NotFound
    info = channels.describe(session, [session.get(Channel, item.channel_id)])[0]
    if not channels.can_see(user, info):
        raise channels.NotFound
    if info.archived:
        raise channels.Archived
    return item, info


def edit(session: Session, user: AppUser, item_id: int, changes: dict) -> MemoryItem:
    """人工修正：內容、分類、到期日、狀態，以及拿掉往上傳的附件（只能拿掉、不能加，往上傳只由熊熊滾判斷）。
    記下是誰改的；之後熊熊滾只能把這條待辦標完成，不能再改內容。"""
    item, _ = editable(session, user, item_id)
    if "text" in changes:
        text = (changes["text"] or "").strip()
        if not text:
            raise Invalid("內容不能是空的")
        item.text = text
    if "category" in changes:
        if changes["category"] not in MEMORY_CATEGORIES:
            raise Invalid("沒有這個分類")
        item.category = changes["category"]
    if "due_date" in changes or "category" in changes:
        due = changes.get("due_date", item.due_date)
        item.due_date = due if item.category == "todo" else None
    if "status" in changes:
        if changes["status"] not in ("open", "done"):
            raise Invalid("狀態只能是 open 或 done")
        item.status = changes["status"] if item.category == "todo" else "open"
    elif item.category != "todo":
        item.status = "open"
    if "shared_attachment_ids" in changes:
        kept = list(dict.fromkeys(changes["shared_attachment_ids"] or []))
        if not set(kept) <= set(item.shared_attachment_ids):
            raise Invalid("只能拿掉往上傳的附件，不能另外加")
        item.shared_attachment_ids = kept
    item.updated_by = user.id
    item.updated_at = dt.datetime.now(dt.UTC)
    session.flush()
    embedder = optional_embedder()
    if embedder is not None:
        try:
            item.embedding = embedder.embed_documents([(None, memory_text(item))])[0]
        except Exception:
            pass  # 向量是問答頁查詢用的，算不出來不擋修改
    return item


def delete(session: Session, user: AppUser, item_id: int) -> None:
    item, _ = editable(session, user, item_id)
    item.deleted_at = dt.datetime.now(dt.UTC)
    item.deleted_by = user.id
    session.flush()


def withdraw(session: Session, user: AppUser, item_id: int) -> MemoryItem:
    """撤回往上傳：從所有上層的看板同時消失，附件也一起。撤回是單向的，熊熊滾之後也不能再標成往上傳。"""
    item, _ = editable(session, user, item_id)
    if not item.shared:
        raise Invalid("這條重點沒有往上傳")
    if item.withdrawn_at is None:
        item.withdrawn_at = dt.datetime.now(dt.UTC)
        item.withdrawn_by = user.id
        session.flush()
    return item

