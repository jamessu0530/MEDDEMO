"""在頻道記憶與頻道附件裡找東西：問答頁的「頻道記憶」與頻道的搜尋頁共用
（docs/superpowers/specs/2026-10-01-attachments-design.md「問答查頻道記憶」「搜尋頁」）。

找得到的範圍跟看板一樣：自己看得到的頻道裡的，加上全公司往上傳、沒撤回、沒刪除的。
先算出這個人看得到哪些頻道，在 SQL 的 WHERE 裡就篩掉，不是先搜再過濾。
向量用 gemini-embedding-2（文字、照片同一個空間），關鍵字用跟知識庫一樣的中文兩字一組；兩路照知識檢索的做法合併（向量 0.6）。
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models import AppUser, Attachment, AttachmentVector, Channel, ChannelMessage, MemoryItem
from app.services import channels
from app.services.retrieval import SIMPLE, keyword_tokens

# 向量那一路的權重，跟知識檢索一樣
VECTOR_WEIGHT = 0.6
# 每一路先各撈多少個候選再合併
CANDIDATES = 40


@dataclass(frozen=True)
class Scope:
    """這個人搜得到什麼：看得到的頻道（編號 → 名稱），與全公司往上傳的附件（編號 → 往上傳的寫法）。"""

    channels: dict[int, str]
    shared_attachments: dict[int, str]


def scope_for(session: Session, user: AppUser) -> Scope:
    infos = channels.describe(session, list(session.scalars(select(Channel))))
    visible = {info.id: info.name for info in infos if channels.can_see(user, info)}
    shared: dict[int, str] = {}
    for item in session.scalars(
        select(MemoryItem).where(
            MemoryItem.shared.is_(True), MemoryItem.withdrawn_at.is_(None), MemoryItem.deleted_at.is_(None),
            func.cardinality(MemoryItem.shared_attachment_ids) > 0,
        )
    ):
        for attachment_id in item.shared_attachment_ids:
            shared.setdefault(attachment_id, item.shared_text or item.text)
    return Scope(visible, shared)


def all_channel_names(session: Session) -> dict[int, str]:
    return {info.id: info.name for info in channels.describe(session, list(session.scalars(select(Channel))))}


def fuse(vector: dict[int, float], keyword: dict[int, float], weight: float = VECTOR_WEIGHT) -> list[int]:
    """兩路的分數各自 min-max 正規化到 0～1 再加權；某一路沒撈到的記 0 分。只有一路就照那一路排。"""

    def normalized(scores: dict[int, float]) -> dict[int, float]:
        if not scores:
            return {}
        low, high = min(scores.values()), max(scores.values())
        return {key: 1.0 if high == low else (value - low) / (high - low) for key, value in scores.items()}

    v, k = normalized(vector), normalized(keyword)
    if not v or not k:
        only = v or k
        return sorted(only, key=lambda key: (-only[key], key))
    keys = set(v) | set(k)
    combined = {key: weight * v.get(key, 0.0) + (1 - weight) * k.get(key, 0.0) for key in keys}
    return sorted(combined, key=lambda key: (-combined[key], key))


@dataclass(frozen=True)
class AttachmentHit:
    attachment: Attachment
    message_id: int
    channel_id: int
    channel_name: str
    author_name: str | None
    created_at: dt.datetime
    # 看不到原頻道、靠往上傳才搜得到的：點了只開大圖，下面寫往上傳的寫法
    reachable: bool
    shared_text: str | None


def _visible_attachments(scope: Scope, channel_id: int | None):
    if channel_id is not None:
        return ChannelMessage.channel_id == channel_id
    conditions = [ChannelMessage.channel_id.in_(list(scope.channels))]
    if scope.shared_attachments:
        conditions.append(Attachment.id.in_(list(scope.shared_attachments)))
    return or_(*conditions)


def search_attachments(
    session: Session,
    scope: Scope,
    *,
    text: str = "",
    vector: Sequence[float] | None = None,
    channel_id: int | None = None,
    limit: int = 30,
) -> list[AttachmentHit]:
    """頻道附件：向量比每個附件最像的那一段，關鍵字比說明、檔名與所屬訊息的文字。channel_id 只搜那個頻道（呼叫端先確認看得到）。"""
    where = and_(Attachment.message_id.is_not(None), ChannelMessage.deleted_at.is_(None), _visible_attachments(scope, channel_id))
    vector_scores: dict[int, float] = {}
    if vector is not None:
        distance = func.min(AttachmentVector.embedding.cosine_distance(vector))
        rows = session.execute(
            select(Attachment.id, distance)
            .join(AttachmentVector, AttachmentVector.attachment_id == Attachment.id)
            .join(ChannelMessage, ChannelMessage.id == Attachment.message_id)
            .where(where)
            .group_by(Attachment.id)
            .order_by(distance)
            .limit(CANDIDATES)
        )
        vector_scores = {attachment_id: 1.0 - float(d) for attachment_id, d in rows}
    keyword_scores: dict[int, float] = {}
    if tokens := keyword_tokens(text):
        tsquery = func.to_tsquery(SIMPLE, " | ".join(f"'{t}'" for t in tokens))
        rank = func.ts_rank_cd(Attachment.search_tokens, tsquery)
        rows = session.execute(
            select(Attachment.id, rank)
            .join(ChannelMessage, ChannelMessage.id == Attachment.message_id)
            .where(where, Attachment.search_tokens.op("@@")(tsquery))
            .order_by(rank.desc(), Attachment.id)
            .limit(CANDIDATES)
        )
        keyword_scores = {attachment_id: float(score) for attachment_id, score in rows}
    order = fuse(vector_scores, keyword_scores)[:limit]
    if not order:
        return []
    rows = session.execute(
        select(Attachment, ChannelMessage, AppUser.name)
        .join(ChannelMessage, ChannelMessage.id == Attachment.message_id)
        .outerjoin(AppUser, AppUser.id == ChannelMessage.author_id)
        .where(Attachment.id.in_(order))
    ).all()
    by_id = {attachment.id: (attachment, message, author) for attachment, message, author in rows}
    names = scope.channels if all(m.channel_id in scope.channels for _, m, _ in by_id.values()) else all_channel_names(session)
    hits = []
    for attachment_id in order:
        attachment, message, author = by_id[attachment_id]
        reachable = message.channel_id in scope.channels
        hits.append(AttachmentHit(
            attachment=attachment, message_id=message.id, channel_id=message.channel_id,
            channel_name=names.get(message.channel_id, ""), author_name=author, created_at=message.created_at,
            reachable=reachable, shared_text=None if reachable else scope.shared_attachments.get(attachment_id),
        ))
    return hits


@dataclass(frozen=True)
class MemoryHit:
    item: MemoryItem
    channel_name: str
    # 看不到原頻道的（全公司往上傳的）只給往上傳的寫法
    text: str


def search_memory(session: Session, scope: Scope, vector: Sequence[float] | None, limit: int = 30) -> tuple[list[MemoryHit], int]:
    """提問者看得到的重點：自己看得到的頻道裡沒刪除的（用原本的內容），加上全公司往上傳、沒撤回的（用往上傳的寫法）。
    有向量就依相似度取前 30 條，沒有就取最近變動的。回傳 (挑出來的, 候選總數)。"""
    visible = MemoryItem.channel_id.in_(list(scope.channels))
    shared = and_(MemoryItem.shared.is_(True), MemoryItem.withdrawn_at.is_(None))
    where = and_(MemoryItem.deleted_at.is_(None), or_(visible, shared))
    total = session.scalar(select(func.count()).select_from(MemoryItem).where(where)) or 0
    stmt = select(MemoryItem).where(where)
    if vector is not None:
        stmt = stmt.order_by(MemoryItem.embedding.cosine_distance(vector).nulls_last(), MemoryItem.updated_at.desc())
    else:
        stmt = stmt.order_by(MemoryItem.updated_at.desc())
    items = list(session.scalars(stmt.limit(limit)))
    names = all_channel_names(session)
    hits = [
        MemoryHit(item, names.get(item.channel_id, ""), item.text if item.channel_id in scope.channels else (item.shared_text or item.text))
        for item in items
    ]
    return hits, total
