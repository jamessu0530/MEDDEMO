"""熊熊滾把頻道的對話整理成記憶（docs/superpowers/specs/2026-09-28-channels-design.md「整理記憶」，
附件的部分見 2026-10-01-attachments-design.md）。

發言後搶一個 Redis 標記，搶到的才排工作，兩分鐘內再多的訊息都併進同一次。工作讀這個頻道還沒整理過的訊息
（連同附的照片與 PDF）和現有的重點，模型回傳要新增與要修改的重點；每一條都先檢查，不合規則的那一條丟掉並記 log，
其他照寫。熊熊滾只讀得到這個頻道自己的東西。
"""

from __future__ import annotations

import datetime as dt
import logging
from collections import defaultdict
from collections.abc import Sequence
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, undefer

from app.db import session_factory
from app.embeddings import Embedder, optional_embedder
from app.llm import LLM, MEDIA_LIMIT_BYTES, Media, get_llm
from app.models import MEMORY_CATEGORIES, AppUser, Attachment, Channel, ChannelMessage, MemoryItem
from app.services import channels
from app.services.channels import ChannelInfo
from app.tasks import channels_queue, redis
from app.timeutil import TAIPEI

log = logging.getLogger(__name__)

# 發言後等兩分鐘再整理：一連串的回報併成一次，熊熊滾也看得到前後文
DIGEST_DELAY = dt.timedelta(minutes=2)
# 標記的存活時間：工作一開始就刪掉；萬一工作沒跑（worker 停了），十分鐘後下一則訊息還能再排
MARKER_TTL_SECONDS = 600
# 一次最多讀幾則新訊息、幾條現有的重點
BATCH_MESSAGES = 200
EXISTING_ITEMS = 100
# 做完或沒變動超過這麼久的重點，不再給熊熊滾看（看板上還在）
RECENT_DAYS = 30
CATEGORY_LABEL = {"complaint": "客訴", "competitor": "競品", "todo": "待辦", "decision": "決議", "experience": "經驗"}

SYSTEM = """你是「熊熊滾」，醫藥通路業務團隊頻道「{channel}」的 AI 主理。你的工作是把頻道裡的對話整理成這個頻道的記憶：
一條一條簡短的重點，大家打開看板就知道最近發生什麼事、還有什麼待辦。

分類（category）：
- complaint 客訴：客戶抱怨補貨、品質、發票、服務。
- competitor 競品：競品的促銷、報價、搭贈、陳列、業務動作。
- todo 待辦：有人答應要做的事。有期限就寫 due_date（YYYY-MM-DD，今天是 {today}，「週五前」這類要換算成日期）。
- decision 決議：主管或大家決定的做法。
- experience 經驗：做了有效、值得別人學的方法。
閒聊、打招呼、個人私事不要記。

怎麼整理：
- 先看現有的重點：同一件事有新進展就用 update 改那一條（例如待辦做完了把 status 改成 done），不要重複新增。
- 每條重點用一兩句話寫清楚是哪家客戶、什麼事；source_message_ids 寫出是從哪幾則訊息整理來的（只能用這次給你的新訊息編號）。
- 訊息附的照片或 PDF 跟這條重點有關，就把附件編號寫進 attachment_ids（只能用這次新訊息的附件，或這條重點原本來源訊息的附件）。
- 標著「人改過」的重點，你只能把待辦標成完成，不能改內容、分類、往上傳。

往上傳（share）：這個頻道的上層是「{parent}」。只挑對其他組也有用的：客訴的趨勢、競品的動作、需要支援的事、成功的經驗。
- 往上傳就寫 shared_text：拿掉同事的名字與個人細節，讓別組看得懂。
- 議價條件、報價細節、折扣數字不往上傳（這些只給經手的人看）。
- 附件要跟著往上傳，就把編號寫進 share_attachment_ids（必須也在 attachment_ids 裡）。只帶對別組有用的圖，例如競品海報、陳列照、產品問題。
  這些一律不帶：報價單、議價條件、合約、拍得到人臉的照片、處方、病歷或病人資料、客戶內部文件。拿不準就只傳文字、不帶圖。
- 標著「已撤回」的重點不能再往上傳。{national}"""

NATIONAL_NOTE = "\n這是全國頻道，沒有上層：share 一律填 false。"

ITEM_FIELDS = {
    "category": {"type": "string", "enum": list(MEMORY_CATEGORIES)},
    "text": {"type": "string"},
    "due_date": {"type": ["string", "null"], "description": "YYYY-MM-DD，只有待辦才有"},
    "share": {"type": "boolean"},
    "shared_text": {"type": ["string", "null"]},
    "attachment_ids": {"type": "array", "items": {"type": "integer"}},
    "share_attachment_ids": {"type": "array", "items": {"type": "integer"}},
}
SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["add", "update"],
    "properties": {
        "add": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["category", "text", "due_date", "source_message_ids", "share", "shared_text",
                             "attachment_ids", "share_attachment_ids"],
                "properties": {**ITEM_FIELDS, "source_message_ids": {"type": "array", "items": {"type": "integer"}}},
            },
        },
        "update": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id"],
                "properties": {
                    "id": {"type": "integer"},
                    **ITEM_FIELDS,
                    "status": {"type": "string", "enum": ["open", "done"]},
                },
            },
        },
    },
}


def marker_key(channel_id: int) -> str:
    return f"channel:{channel_id}:digest"


def schedule(channel_id: int) -> None:
    """有人發言（或風險通報）之後呼叫。搶到標記的才排，兩分鐘內再多的訊息都併進同一次。
    Redis 連不上就記 log：下一則訊息進來會再排，沒整理到的訊息一起補上。"""
    try:
        if redis().set(marker_key(channel_id), 1, nx=True, ex=MARKER_TTL_SECONDS):
            channels_queue().enqueue_in(DIGEST_DELAY, "app.services.channel_memory.run", channel_id)
    except Exception:
        log.exception("排入整理記憶失敗 channel=%s", channel_id)


def run(channel_id: int) -> None:
    """RQ 背景工作的進入點。先刪標記，之後進來的訊息會再排下一次。失敗不重試：
    memory_through_id 沒動，下一則訊息進來時沒整理到的會一起補上。"""
    redis().delete(marker_key(channel_id))
    with session_factory()() as session:
        try:
            digest(session, channel_id, get_llm(), optional_embedder())
            session.commit()
        except Exception:
            session.rollback()
            log.exception("整理記憶失敗 channel=%s", channel_id)


def digest(session: Session, channel_id: int, llm: LLM, embedder: Embedder | None) -> int:
    """把還沒整理過的訊息整理進記憶，一次最多 200 則，多的分批。回傳這次新增與修改了幾條。呼叫端 commit。"""
    channel = session.get(Channel, channel_id)
    if channel is None:
        return 0
    info = channels.describe(session, [channel])[0]
    if info.archived:
        return 0
    changed = 0
    while batch := _new_messages(session, channel):
        touched = _digest_batch(session, info, batch, llm)
        channel.memory_through_id = batch[-1][0].id
        session.flush()
        _embed(embedder, touched)
        changed += len(touched)
        if len(batch) < BATCH_MESSAGES:
            break
    return changed


def _new_messages(session: Session, channel: Channel) -> list[tuple[ChannelMessage, str | None]]:
    # 熊熊滾自己的回答不整理（提問那一則是人發的，照常整理）；IT 刪掉的不整理
    return list(session.execute(
        select(ChannelMessage, AppUser.name)
        .outerjoin(AppUser, AppUser.id == ChannelMessage.author_id)
        .where(
            ChannelMessage.channel_id == channel.id,
            ChannelMessage.id > (channel.memory_through_id or 0),
            ChannelMessage.kind.in_(("user", "notice")),
            ChannelMessage.deleted_at.is_(None),
        )
        .order_by(ChannelMessage.id)
        .limit(BATCH_MESSAGES)
    ).all())


def _existing(session: Session, channel_id: int) -> list[MemoryItem]:
    recent = dt.datetime.now(dt.UTC) - dt.timedelta(days=RECENT_DAYS)
    return list(session.scalars(
        select(MemoryItem)
        .where(
            MemoryItem.channel_id == channel_id,
            MemoryItem.deleted_at.is_(None),
            or_(MemoryItem.status == "open", MemoryItem.updated_at > recent),
        )
        .order_by(MemoryItem.updated_at.desc())
        .limit(EXISTING_ITEMS)
    ))


def inline_files(files: Sequence[Attachment], limit: int = MEDIA_LIMIT_BYTES) -> tuple[list[Media], set[int]]:
    """照順序把原檔放進這次呼叫，到上限為止。回傳 (要附的檔案, 附了原檔的附件編號)；其他的在提示裡給說明。"""
    media: list[Media] = []
    included: set[int] = set()
    used = 0
    for attachment in files:
        if used + attachment.size_bytes > limit:
            continue
        media.append((attachment.content, attachment.mime_type))
        included.add(attachment.id)
        used += attachment.size_bytes
    return media, included


def _file_note(attachment: Attachment, included: set[int]) -> str:
    seen = "原檔已附上" if attachment.id in included else "原檔沒附上"
    caption = attachment.caption or ("圖片" if attachment.kind == "image" else "PDF")
    return f"〔附件 #{attachment.id}（{seen}）：{caption}〕"


def _today() -> dt.date:
    return dt.datetime.now(TAIPEI).date()


def _prompt(
    info: ChannelInfo,
    batch: list[tuple[ChannelMessage, str | None]],
    files: dict[int, list[Attachment]],
    included: set[int],
    existing: list[MemoryItem],
) -> str:
    parts = ["現有的重點："]
    if not existing:
        parts.append("（還沒有）")
    for item in existing:
        flags = [CATEGORY_LABEL[item.category], item.status]
        if item.due_date:
            flags.append(f"期限 {item.due_date.isoformat()}")
        if item.updated_by:
            flags.append("人改過")
        if item.withdrawn_at:
            flags.append("已撤回")
        elif item.shared:
            flags.append("已往上傳")
        attachments = f"；附件 {item.attachment_ids}" if item.attachment_ids else ""
        parts.append(f"[id {item.id}]（{'、'.join(flags)}）{item.text}{attachments}")
    parts.append("\n還沒整理過的新訊息（由舊到新；附件的原檔照編號順序附在最前面）：")
    for message, author in batch:
        who = "風險通報" if message.kind == "notice" else author
        when = message.created_at.astimezone(TAIPEI)
        line = f"[#{message.id}] {when:%m/%d %H:%M} {who}：{message.body}"
        line += "".join(_file_note(a, included) for a in files.get(message.id, []))
        parts.append(line)
    return "\n".join(parts)


def _digest_batch(
    session: Session, info: ChannelInfo, batch: list[tuple[ChannelMessage, str | None]], llm: LLM
) -> list[MemoryItem]:
    message_ids = [message.id for message, _ in batch]
    files: dict[int, list[Attachment]] = defaultdict(list)
    for attachment in session.scalars(
        select(Attachment)
        .where(Attachment.message_id.in_(message_ids))
        .options(undefer(Attachment.content))
        .order_by(Attachment.id)
    ):
        files[attachment.message_id].append(attachment)
    ordered = [a for message_id in message_ids for a in files.get(message_id, [])]
    media, included = inline_files(ordered)
    existing = _existing(session, info.id)
    parent = channels.describe(session, [session.get(Channel, info.parent_id)])[0].name if info.parent_id else "（沒有）"
    system = SYSTEM.format(
        channel=info.name, today=_today().isoformat(), parent=parent,
        national=NATIONAL_NOTE if info.parent_id is None else "",
    )
    result = llm.json(
        system=system, prompt=_prompt(info, batch, files, included, existing), schema=SCHEMA, effort="medium", media=media
    )
    return apply(session, info, result, set(message_ids), {a.id for a in ordered}, existing)


def _attachments_of(session: Session, message_ids: Sequence[int]) -> set[int]:
    if not message_ids:
        return set()
    return set(session.scalars(select(Attachment.id).where(Attachment.message_id.in_(message_ids))))


def _due(value: Any, category: str) -> dt.date | None:
    if category != "todo" or not value:
        return None
    return dt.date.fromisoformat(value)


class Dropped(ValueError):
    """模型回傳的這一條不合規則，丟掉。"""


def apply(
    session: Session,
    info: ChannelInfo,
    result: dict[str, Any],
    batch_message_ids: set[int],
    batch_attachment_ids: set[int],
    existing: list[MemoryItem],
) -> list[MemoryItem]:
    """寫入模型回傳的新增與修改。每一條先檢查，不合的丟掉並記 log，其他照寫。回傳寫了的重點。"""
    can_share = info.parent_id is not None
    touched: list[MemoryItem] = []
    for entry in result.get("add", []):
        try:
            touched.append(_add(session, info, entry, batch_message_ids, batch_attachment_ids, can_share))
        except (Dropped, ValueError) as exc:
            log.warning("整理記憶：丟掉一條新增 channel=%s：%s；%s", info.id, exc, entry)
    by_id = {item.id: item for item in existing}
    for entry in result.get("update", []):
        try:
            item = by_id.get(entry.get("id")) or _own_item(session, info.id, entry.get("id"))
            if _update(session, item, entry, batch_attachment_ids, can_share):
                touched.append(item)
        except (Dropped, ValueError) as exc:
            log.warning("整理記憶：丟掉一條修改 channel=%s：%s；%s", info.id, exc, entry)
    session.flush()
    return touched


def _own_item(session: Session, channel_id: int, item_id: Any) -> MemoryItem:
    item = session.get(MemoryItem, item_id) if isinstance(item_id, int) else None
    if item is None or item.channel_id != channel_id or item.deleted_at is not None:
        raise Dropped(f"重點 {item_id} 不是這個頻道的")
    return item


def _check_files(attachment_ids: list[int], share_ids: list[int], allowed: set[int], share: bool) -> None:
    if not set(attachment_ids) <= allowed:
        raise Dropped(f"附件 {sorted(set(attachment_ids) - allowed)} 不在這一批訊息或這條重點的來源裡")
    if not set(share_ids) <= set(attachment_ids):
        raise Dropped("往上傳的附件不在這條重點的附件裡")
    if share_ids and not share:
        raise Dropped("重點沒有往上傳，附件卻要往上傳")


def _add(
    session: Session,
    info: ChannelInfo,
    entry: dict[str, Any],
    batch_message_ids: set[int],
    batch_attachment_ids: set[int],
    can_share: bool,
) -> MemoryItem:
    sources = entry["source_message_ids"]
    if not sources or not set(sources) <= batch_message_ids:
        raise Dropped(f"來源訊息 {sources} 不在這一批裡")
    text = entry["text"].strip()
    if not text:
        raise Dropped("內容是空的")
    share = bool(entry["share"]) and can_share
    files = list(dict.fromkeys(entry["attachment_ids"]))
    share_files = list(dict.fromkeys(entry["share_attachment_ids"])) if can_share else []
    _check_files(files, share_files, batch_attachment_ids, share)
    item = MemoryItem(
        channel_id=info.id, category=entry["category"], text=text, status="open",
        due_date=_due(entry.get("due_date"), entry["category"]), source_message_ids=list(dict.fromkeys(sources)),
        attachment_ids=files, shared_attachment_ids=share_files if share else [],
        shared=share, shared_text=(entry.get("shared_text") or None) if share else None,
    )
    session.add(item)
    return item


def _update(
    session: Session, item: MemoryItem, entry: dict[str, Any], batch_attachment_ids: set[int], can_share: bool
) -> bool:
    """回傳有沒有真的改到東西。"""
    if item.updated_by is not None:
        # 人改過的：只能把待辦標完成，其他欄位一律不理
        if entry.get("status") == "done" and item.category == "todo" and item.status != "done":
            item.status = "done"
            item.updated_at = dt.datetime.now(dt.UTC)
            return True
        if set(entry) - {"id", "status"}:
            raise Dropped("人改過的重點只能標完成")
        return False
    category = entry.get("category", item.category)
    share = bool(entry.get("share", item.shared)) and can_share
    if share and item.withdrawn_at is not None:
        raise Dropped("撤回過的重點不能再往上傳")
    files = list(dict.fromkeys(entry.get("attachment_ids", item.attachment_ids)))
    share_files = list(dict.fromkeys(entry.get("share_attachment_ids", item.shared_attachment_ids))) if can_share else []
    if files != list(item.attachment_ids):
        # 新加的附件只能來自這一批訊息，或這條重點原本的來源訊息
        allowed = batch_attachment_ids | _attachments_of(session, item.source_message_ids) | set(item.attachment_ids)
        _check_files(files, share_files, allowed, share)
    else:
        _check_files(files, share_files, set(files), share)
    item.category = category
    if "text" in entry and entry["text"].strip():
        item.text = entry["text"].strip()
    if "due_date" in entry or "category" in entry:
        item.due_date = _due(entry.get("due_date", item.due_date and item.due_date.isoformat()), category)
    if category == "todo" and entry.get("status") in ("open", "done"):
        item.status = entry["status"]
    elif category != "todo":
        item.status = "open"
    item.shared = share
    item.shared_text = (entry.get("shared_text", item.shared_text) or None) if share else None
    item.attachment_ids = files
    item.shared_attachment_ids = share_files if share else []
    item.updated_at = dt.datetime.now(dt.UTC)
    return True


def memory_text(item: MemoryItem) -> str:
    return f"{CATEGORY_LABEL[item.category]}：{item.text}"


def _embed(embedder: Embedder | None, items: list[MemoryItem]) -> None:
    """新增、改過的重點重算向量（問答頁查頻道記憶用）。算不出來就留著舊的或空的，不影響整理本身。"""
    if embedder is None or not items:
        return
    try:
        vectors = embedder.embed_documents([(None, memory_text(item)) for item in items])
    except Exception:
        log.exception("重點的向量算不出來")
        return
    for item, vector in zip(items, vectors, strict=True):
        item.embedding = vector
