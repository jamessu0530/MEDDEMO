"""文字頻道：區的在職主管與 IT 在整區頻道、IT 在全國頻道底下開的頻道（docs/superpowers/specs/2026-10-01-channel-rail-design.md）。

開好的頻道整區（全國的是全公司）都看得到、都能發言，看得到與否照舊由 services/channels.py 決定。
能開、改名、封存的人一樣：那一區的在職主管與 IT，全國只有 IT；不限原本開的人。不能刪除，訊息與記憶要留著。
同一個單位不能重名由資料庫的部分唯一索引守（models.Channel），兩個人同時開同名的也只會成功一個。
"""

from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import TOPIC_NAME_MAX, AppUser, Channel, OrgUnit
from app.services import channels
from app.services.channels import ChannelInfo


class NotHere(Exception):
    """上層不是全國或整區頻道，或要改的不是文字頻道。"""


class Forbidden(Exception):
    """看得到，但不是那一區的主管或 IT。"""


class Invalid(Exception):
    """名稱去掉空白後是空的，或超過上限。"""


class Duplicate(Exception):
    """同一個單位已經有同名的文字頻道。"""


def can_manage(user: AppUser, info: ChannelInfo) -> bool:
    """全國與整區頻道：能不能在底下開文字頻道；文字頻道：能不能改名、封存。其他種類一律不行。
    主管只管自己那一區（unit_id 就是區），全國的只有 IT。自建帳號是業務，不行。"""
    if info.kind not in ("national", "region", "topic"):
        return False
    if user.role == "it":
        return True
    return user.role == "manager" and user.deactivated_at is None and info.region_id is not None and user.unit_id == info.region_id


def clean_name(raw: str) -> str:
    name = raw.strip()
    if not name or len(name) > TOPIC_NAME_MAX:
        raise Invalid(f"頻道名稱要 1～{TOPIC_NAME_MAX} 個字")
    return name


def _save(session: Session, channel: Channel, name: str, unit_id: str) -> None:
    """寫進去；同一個單位已經有同名的，資料庫擋下來時換成 Duplicate。

    用整個 session.rollback()，不是 begin_nested() 的 SAVEPOINT：begin_nested() 會先把 session 裡
    還沒寫進去的變動 flush 掉，才送出 SAVEPOINT。update 改名、封存是在進到這裡之前就改了物件的欄位，
    那個 UPDATE 撞到唯一索引時是在 SAVEPOINT 建立之前失敗的（例外從 begin_nested() 本身丟出來），
    沒有 SAVEPOINT 可以退，外層的交易已經壞了，同一個 session 再查什麼都會被擋（PendingRollbackError）。
    新建的物件（create 開新頻道）在 SAVEPOINT 裡面才 add、flush，不會踩到這個問題，
    但兩條路共用一個存檔函式，就都走整個 rollback。
    unit_id 另外傳進來，不是 rollback 之後才去讀 channel.unit_id：rollback 之後 session 裡的物件都過期了，
    再讀欄位要重新查一次資料庫，傳值進來就不必。"""
    session.add(channel)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        unit = session.get(OrgUnit, unit_id)
        raise Duplicate(f"{unit.name}已經有叫「{name}」的頻道") from None


def create(session: Session, user: AppUser, parent_id: int, name: str) -> ChannelInfo:
    """在 parent_id（全國或整區頻道）底下開一個文字頻道。看不到上層丟 channels.NotFound；呼叫端負責 commit。"""
    parent = channels.get_channel(session, user, parent_id)
    if parent.kind not in ("national", "region"):
        raise NotHere("只有全國與整區頻道底下可以開文字頻道")
    if not can_manage(user, parent):
        raise Forbidden("只有這一區的主管與 IT 可以開文字頻道" if parent.kind == "region" else "只有 IT 可以在全國開文字頻道")
    cleaned = clean_name(name)
    unit_id = session.get(Channel, parent.id).unit_id
    channel = Channel(kind="topic", unit_id=unit_id, name=cleaned, created_by=user.id)
    _save(session, channel, cleaned, unit_id)
    return channels.describe(session, [channel])[0]


def update(
    session: Session, user: AppUser, channel_id: int, *, name: str | None = None, archived: bool | None = None
) -> ChannelInfo:
    """改名、封存或解除封存。已經封存的再封存一次不改時間。呼叫端負責 commit。"""
    info = channels.get_channel(session, user, channel_id)
    if info.kind != "topic":
        raise NotHere("只有文字頻道可以改名或封存")
    if not can_manage(user, info):
        raise Forbidden("只有這一區的主管與 IT 可以管理文字頻道" if info.region_id else "只有 IT 可以管理全國的文字頻道")
    channel = session.get(Channel, info.id)
    unit_id = channel.unit_id
    cleaned = clean_name(name) if name is not None else channel.name
    channel.name = cleaned
    if archived is True and channel.archived_at is None:
        channel.archived_at = func.now()
    elif archived is False:
        channel.archived_at = None
    _save(session, channel, cleaned, unit_id)
    session.refresh(channel)
    return channels.describe(session, [channel])[0]
