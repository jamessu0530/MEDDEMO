"""即時位置（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈即時位置〉）。

業務打開 App 時，在線狀態的心跳（api/presence.py：WebSocket 每 20 秒、斷線時的 POST /api/presence/ping）多帶一筆位置。
只有業務、上班時間（台北的真實時間，LOCATION_SHARE_HOURS）、沒暫停才寫；一人一列覆寫、不留軌跡。
代理示範業務的帳號（第三方登入的評審）寫在示範業務名下，分享的是評審手機真的位置。
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AppUser, UserLocation
from app.services import travel
from app.timeutil import TAIPEI

# 跟上一筆差不到 30 公尺、又不到 2 分鐘就不寫、不發事件：人在店裡沒動時不必每 20 秒寫一次、通知主管一次
MIN_MOVE_METERS = 30
MIN_INTERVAL = dt.timedelta(minutes=2)


class NotSharing(Exception):
    """這個帳號不分享位置（主管、IT）。"""


@dataclass(frozen=True)
class ShareHours:
    weekdays: frozenset[int]  # 1（一）～7（日）
    start: int  # 一天的第幾分鐘
    end: int  # 不含這一分鐘；24:00 是 1440


def parse_hours(spec: str) -> ShareHours:
    """「1-5 08:30-18:30」：星期一到五，08:30 起、18:30 前。星期也可以寫成「1,3,5」。"""
    days, times = spec.split()
    if "-" in days:
        first, last = (int(day) for day in days.split("-"))
        weekdays = frozenset(range(first, last + 1))
    else:
        weekdays = frozenset(int(day) for day in days.split(","))
    start, end = (_minutes(clock) for clock in times.split("-"))
    return ShareHours(weekdays, start, end)


def _minutes(clock: str) -> int:
    hours, minutes = clock.split(":")
    return int(hours) * 60 + int(minutes)


def share_hours() -> ShareHours:
    return parse_hours(settings().location_share_hours)


def within(at: dt.datetime, hours: ShareHours) -> bool:
    """這個時刻在不在上班時間，看台北時間。"""
    local = at.astimezone(TAIPEI)
    minute = local.hour * 60 + local.minute
    return local.isoweekday() in hours.weekdays and hours.start <= minute < hours.end


def now() -> dt.datetime:
    # 位置是「現在」的事，用真實時間，不是展示日（as_of）
    return dt.datetime.now(dt.UTC)


def sharer(user: AppUser) -> AppUser | None:
    """位置寫在誰名下：業務是自己，代理示範業務的帳號是示範業務；主管、IT 不分享。"""
    if user.role != "sales":
        return None
    return user.acts_as or user


def _row(session: Session, user_id: str) -> UserLocation:
    # 兩條連線同時第一次送位置：ON CONFLICT DO NOTHING，不會撞主鍵；再鎖住那一列讀，兩個人同時寫以後到的為準
    session.execute(insert(UserLocation).values(user_id=user_id).on_conflict_do_nothing())
    return session.get(UserLocation, user_id, populate_existing=True, with_for_update=True)


def record(
    session: Session, user: AppUser, lat: float, lng: float, accuracy: float | None, at: dt.datetime | None = None
) -> str | None:
    """記一筆位置。回傳要發 location 事件的業務 id；沒寫（不是業務、下班時間、暫停中、差不多沒動）回 None。"""
    at = at or now()
    rep = sharer(user)
    if rep is None or not within(at, share_hours()):
        return None
    row = _row(session, rep.id)
    if row.paused:
        return None
    if (
        row.at is not None and row.lat is not None and row.lng is not None and not row.denied
        and at - row.at < MIN_INTERVAL
        and travel.straight_km((row.lat, row.lng), (lat, lng)) * 1000 < MIN_MOVE_METERS
    ):
        return None
    row.lat, row.lng, row.accuracy_m, row.at = lat, lng, accuracy, at
    row.denied, row.denied_at = False, None
    session.flush()
    return rep.id


def deny(session: Session, user: AppUser, at: dt.datetime | None = None) -> str | None:
    """瀏覽器沒給定位權限。已經記過就不再發事件。"""
    at = at or now()
    rep = sharer(user)
    if rep is None or not within(at, share_hours()):
        return None
    row = _row(session, rep.id)
    if row.denied:
        return None
    row.denied, row.denied_at = True, at
    session.flush()
    return rep.id


def report(
    session: Session, user: AppUser, position: tuple[float, float, float | None] | None, denied: bool,
    at: dt.datetime | None = None,
) -> str | None:
    """心跳帶來的位置 (緯度, 經度, 誤差公尺)，或「瀏覽器沒給權限」。回傳要發 location 事件的業務 id。"""
    if position is not None:
        return record(session, user, *position, at=at)
    if denied:
        return deny(session, user, at=at)
    return None


def set_paused(session: Session, user: AppUser, paused: bool, at: dt.datetime | None = None) -> str:
    """暫停或繼續分享。回傳業務 id（要發 location 事件，主管頁才會換成「暫停分享位置」）。"""
    rep = sharer(user)
    if rep is None:
        raise NotSharing
    row = _row(session, rep.id)
    row.paused = paused
    row.paused_at = (at or now()) if paused else None
    session.flush()
    return rep.id


@dataclass(frozen=True)
class ShareState:
    """業務首頁的分享列要的：會不會分享、暫停了沒、伺服器記的權限、主管是誰、上班時間。"""

    applies: bool
    paused: bool
    denied: bool
    manager_name: str | None
    hours: ShareHours


def state(session: Session, user: AppUser) -> ShareState:
    hours = share_hours()
    rep = sharer(user)
    if rep is None:
        return ShareState(False, False, False, None, hours)
    row = session.get(UserLocation, rep.id)
    manager = session.get(AppUser, rep.manager_id) if rep.manager_id else None
    return ShareState(True, bool(row and row.paused), bool(row and row.denied), manager.name if manager else None, hours)
