"""頻道裡熊熊滾的主動發言（docs/superpowers/specs/2026-09-28-channels-design.md「主動發言」），由 K8s CronJob 跑：

    python -m app.jobs.channels weekly      # 週摘要：每週一 08:30
    python -m app.jobs.channels reminders   # 逾期提醒：每天 09:00

時間一律用真實的台灣日期（不是展示日 app_today()）：訊息、示範對話與熊熊滾讀出來的到期日都是真實時間
（docs/superpowers/specs/2026-10-01-attachments-design.md「原 spec 留下的事」）。
"""

from __future__ import annotations

import datetime as dt
import logging
import sys
from collections import defaultdict

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db import session_factory
from app.llm import LLM, get_llm
from app.models import AppUser, Attachment, Channel, ChannelMessage, MemoryItem
from app.services import channels
from app.services.channel_memory import CATEGORY_LABEL
from app.timeutil import TAIPEI

log = logging.getLogger(__name__)

WEEK = dt.timedelta(days=7)
# 同一條逾期待辦，三天內不重複提醒
REMIND_EVERY = dt.timedelta(days=3)
SUMMARY_LIMIT = 300

WEEKLY_SYSTEM = f"""你是「熊熊滾」，醫藥通路業務團隊頻道「{{channel}}」的 AI 主理。每週一早上幫大家整理上週的頻道動態。
用繁體中文、{SUMMARY_LIMIT} 字以內，口語、不要客套：
1. 上週最重要的兩三件事（客訴、競品動作、決議）。
2. 還沒做完的待辦與期限。
3. 有需要的話，一句提醒這週要注意什麼。
只根據下面的訊息與重點，不要補沒提到的事；議價條件、報價數字不要寫出來。"""
WEEKLY_SCHEMA = {
    "type": "object",
    "properties": {"summary": {"type": "string"}},
    "required": ["summary"],
    "additionalProperties": False,
}


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _active_channels(session: Session, since: dt.datetime) -> list[channels.ChannelInfo]:
    ids = session.scalars(
        select(ChannelMessage.channel_id)
        .where(ChannelMessage.created_at >= since, ChannelMessage.kind.in_(("user", "notice")), ChannelMessage.deleted_at.is_(None))
        .distinct()
    )
    rows = list(session.scalars(select(Channel).where(Channel.id.in_(list(ids)))))
    return [info for info in channels.describe(session, rows) if not info.archived]


def _week_prompt(session: Session, info: channels.ChannelInfo, since: dt.datetime) -> str:
    rows = session.execute(
        select(ChannelMessage, AppUser.name)
        .outerjoin(AppUser, AppUser.id == ChannelMessage.author_id)
        .where(
            ChannelMessage.channel_id == info.id,
            ChannelMessage.created_at >= since,
            ChannelMessage.kind.in_(("user", "notice")),
            ChannelMessage.deleted_at.is_(None),
        )
        .order_by(ChannelMessage.id)
    ).all()
    files: dict[int, list[Attachment]] = defaultdict(list)
    for attachment in session.scalars(select(Attachment).where(Attachment.message_id.in_([m.id for m, _ in rows]))):
        files[attachment.message_id].append(attachment)
    items = session.scalars(
        select(MemoryItem)
        .where(MemoryItem.channel_id == info.id, MemoryItem.deleted_at.is_(None),
               or_(MemoryItem.updated_at >= since, MemoryItem.status == "open"))
        .order_by(MemoryItem.updated_at.desc())
        .limit(100)
    )
    parts = ["上週的訊息（由舊到新）："]
    for message, author in rows:
        who = "風險通報" if message.kind == "notice" else author
        notes = "".join(f"〔附件：{a.caption or a.filename}〕" for a in files.get(message.id, []))
        parts.append(f"{message.created_at.astimezone(TAIPEI):%m/%d %H:%M} {who}：{message.body}{notes}")
    parts.append("\n這個頻道的重點：")
    for item in items:
        due = f"，期限 {item.due_date.isoformat()}" if item.due_date else ""
        parts.append(f"（{CATEGORY_LABEL[item.category]}、{item.status}{due}）{item.text}")
    return "\n".join(parts)


def weekly(session: Session, llm: LLM, now: dt.datetime | None = None) -> int:
    """過去七天有人發言（或有風險通報）、沒封存的頻道，各貼一則週摘要。某個頻道失敗就記 log、跳過。回傳貼了幾則。"""
    since = (now or _now()) - WEEK
    posted = 0
    for info in _active_channels(session, since):
        try:
            with session.begin_nested():
                result = llm.json(
                    system=WEEKLY_SYSTEM.format(channel=info.name), prompt=_week_prompt(session, info, since),
                    schema=WEEKLY_SCHEMA, effort="low",
                )
                summary = result["summary"].strip()
                if summary:
                    channels.post_mascot(session, info.id, f"上週重點整理：\n{summary}", None)
                    posted += 1
        except Exception:
            log.exception("週摘要失敗 channel=%s", info.id)
    return posted


def reminders(session: Session, now: dt.datetime | None = None) -> int:
    """還沒完成、已經過了到期日、三天內沒提醒過的待辦，依頻道各貼一則清單（固定文字，不呼叫模型）。
    封存的頻道跳過。回傳貼了幾則。"""
    now = now or _now()
    today = now.astimezone(TAIPEI).date()
    overdue = session.scalars(
        select(MemoryItem)
        .where(
            MemoryItem.category == "todo",
            MemoryItem.status == "open",
            MemoryItem.deleted_at.is_(None),
            MemoryItem.due_date < today,
            or_(MemoryItem.reminded_at.is_(None), MemoryItem.reminded_at < now - REMIND_EVERY),
        )
        .order_by(MemoryItem.channel_id, MemoryItem.due_date, MemoryItem.id)
    )
    by_channel: dict[int, list[MemoryItem]] = defaultdict(list)
    for item in overdue:
        by_channel[item.channel_id].append(item)
    posted = 0
    for info in channels.describe(session, list(session.scalars(select(Channel).where(Channel.id.in_(list(by_channel)))))):
        if info.archived:
            continue
        items = by_channel[info.id]
        lines = [f"・{item.text}（{item.due_date.month}/{item.due_date.day} 到期）" for item in items]
        body = "這些待辦已經過了期限：\n" + "\n".join(lines) + "\n做完了請到記憶看板勾選完成。"
        channels.post_mascot(session, info.id, body, None)
        for item in items:
            item.reminded_at = now
        posted += 1
    session.flush()
    return posted


def main(argv: list[str]) -> None:
    logging.basicConfig(level=logging.INFO)
    if len(argv) != 1 or argv[0] not in ("weekly", "reminders"):
        raise SystemExit("用法：python -m app.jobs.channels weekly|reminders")
    with session_factory()() as session:
        posted = weekly(session, get_llm()) if argv[0] == "weekly" else reminders(session)
        session.commit()
    log.info("%s：貼了 %s 則", argv[0], posted)


if __name__ == "__main__":
    main(sys.argv[1:])
