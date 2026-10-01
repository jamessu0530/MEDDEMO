"""在線狀態與頻道成員（docs/superpowers/specs/2026-10-01-presence-design.md）。

別人看到的狀態不存，每次從三個欄位現算（display_status）：手動選的狀態、最後一次心跳、最後一次「正在用」的心跳。
伺服器只往外送算好的狀態，不送時間：選了「顯示為離線」的人，在別人眼中跟真的離線一模一樣。

頻道沒有成員名單，成員照組織位置算：位置在頻道路徑底下（含本身）的人。IT 坐在根節點，只算全國頻道的成員。
全公司十幾個帳號，整批讀進來在 Python 裡算，跟 services/channels.py 一樣。
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, aliased

from app.models import AppUser, UserPresence
from app.services.channels import ChannelInfo
from app.services.scope import TEAM

# 成員清單與頭像群組的順序：有空的在最前面，離線的在最後
STATUSES = ("available", "busy", "dnd", "brb", "away", "offline")
# 手機每 20 秒送一次心跳；45 秒內有「正在用」的心跳才算有空，漏一次也不會掉成離開
ACTIVE_WINDOW = dt.timedelta(seconds=45)
# 斷線（切到別的 App、進電梯）先顯示離開，這麼久沒有心跳才算離線
GRACE = dt.timedelta(minutes=5)


def now() -> dt.datetime:
    # 狀態是「現在」的事，用真實時間，不是展示日（as_of）
    return dt.datetime.now(dt.UTC)


def display_status(
    choice: str | None, last_seen_at: dt.datetime | None, last_active_at: dt.datetime | None, at: dt.datetime
) -> str:
    """別人看到的狀態。手動狀態只在連著（或斷線 5 分鐘內）時顯示，之後一律離線。"""
    if choice == "offline" or last_seen_at is None or at - last_seen_at > GRACE:
        return "offline"
    if choice is not None:
        return choice
    if last_active_at is not None and at - last_active_at <= ACTIVE_WINDOW:
        return "available"
    return "away"


def _status(row: UserPresence | None, at: dt.datetime) -> str:
    return "offline" if row is None else display_status(row.choice, row.last_seen_at, row.last_active_at, at)


def statuses(session: Session, at: dt.datetime | None = None) -> dict[str, str]:
    """每個人別人看到的狀態，只列不是離線的；不在裡面的就是離線。停用的帳號一律離線。"""
    at = at or now()
    rows = session.scalars(
        select(UserPresence)
        .join(AppUser, AppUser.id == UserPresence.user_id)
        .where(AppUser.deactivated_at.is_(None), UserPresence.last_seen_at > at - GRACE)
    )
    return {row.user_id: status for row in rows if (status := _status(row, at)) != "offline"}


def mine(session: Session, user: AppUser) -> tuple[str | None, str]:
    """(自己選的, 別人看到的)。"""
    row = session.get(UserPresence, user.id)
    return (row.choice if row else None), _status(row, now())


def _row(session: Session, user_id: str) -> UserPresence:
    # 兩條連線同時第一次心跳：ON CONFLICT DO NOTHING，不會撞主鍵
    session.execute(insert(UserPresence).values(user_id=user_id).on_conflict_do_nothing())
    return session.get(UserPresence, user_id, populate_existing=True, with_for_update=True)


class SignedOut(Exception):
    """要記心跳時，帳號已經登出、被別的裝置頂掉或停用了：不能再把他記成在線。"""


def touch(session: Session, user: AppUser, active: bool, at: dt.datetime | None = None) -> bool:
    """記一次心跳。回傳別人看到的狀態有沒有變（例如從離開回到有空），有變呼叫端要發狀態事件。

    呼叫端剛驗過 token，但登出可能就在這之間 commit：登出會先改帳號那一列的版號，
    這裡用 FOR SHARE 讀同一列排在它後面，版號變了就丟 SignedOut，不讓剛登出的人又在線 5 分鐘。"""
    at = at or now()
    version = user.session_version
    session.refresh(user, with_for_update={"read": True})
    if user.session_version != version or user.deactivated_at is not None:
        raise SignedOut
    row = _row(session, user.id)
    before = _status(row, at)
    row.last_seen_at = at
    if active:
        row.last_active_at = at
    session.flush()
    return _status(row, at) != before


def choose(session: Session, user: AppUser, choice: str | None) -> None:
    """手動選狀態，None 是重設回自動。"""
    _row(session, user.id).choice = choice
    session.flush()


def sign_out(session: Session, user: AppUser) -> None:
    """登出立刻變離線。手動選的狀態留著，下次登入照舊。"""
    row = session.get(UserPresence, user.id, with_for_update=True)
    if row is not None:
        row.last_seen_at = None
        row.last_active_at = None


@dataclass(frozen=True)
class Person:
    id: str
    name: str
    # 組織位置：自建與第三方登入的帳號用代理那位業務的位置
    path: str | None


def people(session: Session) -> list[Person]:
    """在職的帳號與組織位置，依名字排。"""
    acting = aliased(AppUser)
    rows = session.execute(
        select(AppUser.id, AppUser.name, func.coalesce(acting.org_path, AppUser.org_path))
        .outerjoin(acting, acting.id == AppUser.acts_as_user_id)
        .where(AppUser.deactivated_at.is_(None))
        .order_by(AppUser.name, AppUser.id)
    )
    return [Person(id, name, path) for id, name, path in rows]


def _within(path: str, prefix: str) -> bool:
    return path == prefix or path.startswith(f"{prefix}.")


def is_member(path: str | None, info: ChannelInfo) -> bool:
    """位置在頻道路徑底下（含本身）就是成員；成員一定看得到這個頻道（Scope.can_see 成立），反過來不一定（IT）。
    客戶討論串另外加上負責人與他的主管，跟 channels.can_see 的補充規則一致。封存的小組頻道沒有成員。"""
    if path is None or info.archived or info.path is None:
        return False
    if _within(path, info.path):
        return True
    owner = info.owner_path
    # 負責人自己，或負責人的主管（小組那一層）。IT 也是負責人的祖先，但不是他的主管
    return (
        info.kind == "customer"
        and owner is not None
        and (path == owner or (_within(owner, path) and len(path.split(".")) >= TEAM))
    )


def members(session: Session, info: ChannelInfo) -> list[tuple[Person, str]]:
    """(成員, 別人看到的狀態)，依名字排。"""
    current = statuses(session)
    return [(p, current.get(p.id, "offline")) for p in people(session) if is_member(p.path, info)]


def online_counts(session: Session, viewer: AppUser, infos: list[ChannelInfo]) -> dict[int, int]:
    """每個頻道有幾位成員不是離線，不算自己。沒有人在線的頻道不會出現在結果裡。"""
    current = statuses(session)
    online = [p for p in people(session) if p.id in current and p.id != viewer.id]
    counts = {info.id: sum(is_member(p.path, info) for p in online) for info in infos}
    return {channel_id: count for channel_id, count in counts.items() if count}
