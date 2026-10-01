"""今天的行程（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md）。

當天第一次讀取時照模型的建議建一份存起來：模型挑哪幾家（today_route.pick），順序交給 route_planner 排順路，
「需立即處理」那家鎖在第一站。之後一律以存著的為準，模型不再重排；業務或主管誰先讀都一樣。
已完成與否不存：跟以前一樣看今天有沒有這家已確認的拜訪紀錄，跑完的站排在最前面。
"""

from __future__ import annotations

import dataclasses
import datetime as dt
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    AppUser, Customer, Itinerary, ItineraryPrecedence, ItineraryStop, OrgUnit, RouteSignalWeight, RouteSnooze, Visit,
)
from app.services import customer_profile, route_planner, today_route, travel
from app.timeutil import TAIPEI

# 每站預設停留多久。以前用「平均 70 分鐘一站」排時間，那包含了車程；現在車程另外算
DEFAULT_DURATION = 40
# 暫緩跳過三天：足夠跳過這一趟和隔天的路線，又不會整個週期看不到這家（跟原本手機上的一樣）
SNOOZE_DAYS = 3

FeedbackAction = Literal["pin", "snooze", "misjudge"]


class VersionConflict(Exception):
    """行程在讀取之後被改過：兩個人同時改同一位業務的行程，後存的那一個擋下來。"""


class NotOnItinerary(LookupError):
    """這家不在今天還沒跑的站裡。"""


@dataclass
class StopView:
    customer_id: str
    customer_name: str
    type: str
    grade: str
    planned_time: str  # 已完成的是拜訪時間，其他是排出來的到達時間
    status: str  # done／next／todo
    signal: str
    reason: str
    visit_id: str | None
    source: str
    duration_minutes: int
    late_minutes: int
    travel_minutes: int | None  # 從上一站開過來；已完成的站是 None
    travel_km: float | None


@dataclass
class ItineraryView:
    date: dt.date
    rep: AppUser
    version: int
    done: int
    total: int
    urgent: dict | None
    stops: list[StopView]
    travel_minutes: int
    travel_km: float
    finish_time: str | None  # 最後一站離開的時間
    estimated: bool  # 車程是直線估算的


@dataclass
class Skipped:
    customer_id: str
    customer_name: str
    reason: str


def get_or_create(session: Session, user_id: str) -> Itinerary:
    """今天的行程，沒有就照模型的建議建一份。不是業務（主管、IT）丟 LookupError。"""
    today = customer_profile.app_today(session)
    rep = session.get(AppUser, user_id)
    if rep is None or rep.role != "sales":
        raise LookupError(user_id)
    found = _find(session, user_id, today)
    if found:
        return found
    try:
        with session.begin_nested():
            return _create(session, rep, today)
    except IntegrityError:
        # 同一位業務兩個請求同時第一次讀：另一個先建好了，用那一份
        found = _find(session, user_id, today)
        if found is None:
            raise
        return found


def view(session: Session, itinerary: Itinerary) -> ItineraryView:
    """畫面要的樣子：跑完的站在前（照拜訪時間），還沒跑的照存著的順序，時間與車程現算。"""
    rep = session.get(AppUser, itinerary.user_id)
    done = today_route.done_visits(session, rep.id, itinerary.date)
    rows = _rows(session, itinerary)
    done_ids = {c.id for _, c in done}
    open_rows = [r for r in rows if r.customer_id not in done_ids]
    customers = _customers(session, [r.customer_id for r in open_rows])
    start, origin = _start(session, rep, itinerary.date, done, _durations(rows))
    points = [_point(customers[r.customer_id]) for r in open_rows]
    matrix = travel.along([origin or (points[0] if points else (0.0, 0.0)), *points])
    planned = route_planner.schedule(start, 0, [_plan_stop(r, n + 1) for n, r in enumerate(open_rows)], matrix.minutes)

    by_customer = {r.customer_id: r for r in rows}
    stops = []
    for visit, customer in done:
        row = by_customer.get(customer.id)
        stops.append(StopView(
            customer_id=customer.id, customer_name=customer.name, type=customer.type, grade=customer.grade,
            planned_time=visit.visited_at.astimezone(TAIPEI).strftime("%H:%M"), status="done",
            signal="routine", reason="已完成", visit_id=visit.id, source=row.source if row else "rep",
            duration_minutes=row.duration_minutes if row else DEFAULT_DURATION, late_minutes=0,
            travel_minutes=None, travel_km=None,
        ))
    total_km = 0.0
    for n, (row, slot) in enumerate(zip(open_rows, planned.slots, strict=True)):
        customer = customers[row.customer_id]
        km = matrix.km[n][n + 1]
        total_km += km
        stops.append(StopView(
            customer_id=customer.id, customer_name=customer.name, type=customer.type, grade=customer.grade,
            planned_time=slot.arrive.strftime("%H:%M"), status="next" if n == 0 else "todo",
            signal=row.signal, reason=row.reason, visit_id=None, source=row.source,
            duration_minutes=row.duration_minutes, late_minutes=slot.late_minutes,
            travel_minutes=slot.travel_minutes, travel_km=km,
        ))
    open_ids = {r.customer_id for r in open_rows}
    urgent = itinerary.urgent if itinerary.urgent and itinerary.urgent["customer_id"] in open_ids else None
    return ItineraryView(
        date=itinerary.date, rep=rep, version=itinerary.version, done=len(done), total=len(stops), urgent=urgent,
        stops=stops, travel_minutes=planned.travel_minutes, travel_km=round(total_km, 1),
        finish_time=planned.slots[-1].leave.strftime("%H:%M") if planned.slots else None,
        estimated=matrix.estimated,
    )


def apply_feedback(session: Session, user_id: str, customer_id: str, action: FeedbackAction, version: int) -> Itinerary:
    """需立即處理的三顆鈕。插入下一站：移到還沒跑的第一站，同類提醒之後排前面一點；
    暫緩：從今天拿掉，三天內的建議不排；誤判：暫緩，再加上同類提醒之後少排一點。"""
    itinerary = get_or_create(session, user_id)
    _lock(session, itinerary)
    if itinerary.version != version:
        raise VersionConflict
    rows = _rows(session, itinerary)
    done_ids = {c.id for _, c in today_route.done_visits(session, user_id, itinerary.date)}
    row = next((r for r in rows if r.customer_id == customer_id and customer_id not in done_ids), None)
    if row is None:
        raise NotOnItinerary(customer_id)
    if action == "pin":
        finished = [r for r in rows if r.customer_id in done_ids]
        rest = [r for r in rows if r.customer_id not in done_ids and r is not row]
        _renumber([*finished, row, *rest])
        _adjust_weight(session, user_id, row.signal, 1)
    else:
        _remove(session, itinerary, row)
        _snooze(session, user_id, customer_id, itinerary.date + dt.timedelta(days=SNOOZE_DAYS))
        if action == "misjudge":
            _adjust_weight(session, user_id, row.signal, -1)
    if itinerary.urgent and itinerary.urgent["customer_id"] == customer_id:
        itinerary.urgent = None
    _touch(itinerary)
    session.flush()
    return itinerary


def add_stops(
    session: Session, user_id: str, customer_ids: list[str], source: str = "ask"
) -> tuple[Itinerary, list[str], list[Skipped]]:
    """把幾家加進今天的行程，各自插在多繞最少、又不動到鎖住的站的位置。回傳 (行程, 加進去的店名, 沒加的與原因)。
    加進來的那家一併取消暫緩，否則明天的建議照樣不排它。"""
    itinerary = get_or_create(session, user_id)
    _lock(session, itinerary)
    rep = session.get(AppUser, user_id)
    done = today_route.done_visits(session, user_id, itinerary.date)
    done_ids = {c.id for _, c in done}
    rows = _rows(session, itinerary)
    open_rows = [r for r in rows if r.customer_id not in done_ids]
    on_route = {r.customer_id for r in rows}
    wanted = list(dict.fromkeys(customer_ids))
    found = _customers(session, wanted)
    added: list[str] = []
    skipped: list[Skipped] = []
    for cid in wanted:
        customer = found.get(cid)
        if customer is None or customer.owner_user_id != user_id:
            skipped.append(Skipped(cid, customer.name if customer else cid, "不是你的客戶"))
            continue
        if cid in done_ids:
            skipped.append(Skipped(cid, customer.name, "今天已經去過了"))
            continue
        if cid in on_route:
            skipped.append(Skipped(cid, customer.name, "已經在今天的行程裡"))
            continue
        if len(open_rows) >= route_planner.MAX_OPEN_STOPS:
            skipped.append(Skipped(cid, customer.name, f"今天已經排了 {route_planner.MAX_OPEN_STOPS} 站"))
            continue
        signal, reason = today_route.label(session, user_id, cid)
        row = ItineraryStop(
            itinerary_id=itinerary.id, position=len(rows), customer_id=cid, source=source,
            signal=signal, reason=reason, duration_minutes=DEFAULT_DURATION,
        )
        index = _cheapest_index(session, rep, itinerary.date, done, _durations(rows), open_rows, row, customer)
        open_rows.insert(index, row)
        rows.append(row)
        session.add(row)
        on_route.add(cid)
        added.append(customer.name)
        session.execute(delete(RouteSnooze).where(RouteSnooze.user_id == user_id, RouteSnooze.customer_id == cid))
    if added:
        _renumber([r for r in rows if r.customer_id in done_ids] + open_rows)
        _touch(itinerary)
    session.flush()
    return itinerary, added, skipped


def reset_today(session: Session, user_id: str) -> None:
    """IT 用：刪掉這位業務今天的行程（站與先後跟著 ON DELETE CASCADE 一起刪），
    以及所有的暫緩、訊號權重，下次讀取就照模型的建議重新建一份。

    示範業務的行程給所有用第三方登入的評審共用：系統日期固定在決賽日不會換天，行程第一次建好之後
    就一直是存著的那份，按過的暫緩、調整過的權重也會一直留著、累積影響之後的建議。換一批評審之前，
    IT 用這個清掉，回到當天早上模型原本的建議。
    """
    today = customer_profile.app_today(session)
    session.execute(delete(Itinerary).where(Itinerary.user_id == user_id, Itinerary.date == today))
    session.execute(delete(RouteSnooze).where(RouteSnooze.user_id == user_id))
    session.execute(delete(RouteSignalWeight).where(RouteSignalWeight.user_id == user_id))


def _find(session: Session, user_id: str, today: dt.date) -> Itinerary | None:
    return session.scalar(select(Itinerary).where(Itinerary.user_id == user_id, Itinerary.date == today))


def _lock(session: Session, itinerary: Itinerary) -> None:
    """鎖住這份行程、重新讀一次。兩個人同時改同一位業務的行程：後到的等前一個存完，再看到版本已經變了。"""
    session.refresh(itinerary, with_for_update=True)


def _create(session: Session, rep: AppUser, today: dt.date) -> Itinerary:
    picked = today_route.pick(session, rep.id, today_route.load_feedback(session, rep.id, today))
    items = {item["candidate"].customer_id: item for item in picked.picked}
    customers = _customers(session, list(items))
    start, origin = _start(session, rep, today, picked.done, {})
    points = [_point(customers[cid]) for cid in items]
    minutes = travel.matrix([origin or (points[0] if points else (0.0, 0.0)), *points]).minutes
    stops = [route_planner.PlanStop(customer_id=cid, point=n + 1, duration=DEFAULT_DURATION) for n, cid in enumerate(items)]
    rules = []
    if picked.urgent:
        # 「需立即處理」那家鎖在第一站，其他照順路排；業務之後可以拖走或解鎖
        rules.append(route_planner.Rule(
            id=f"lock:{picked.urgent.customer_id}", text=f"{picked.urgent.customer_name}排第一站",
            kind="lock", customer_ids=(picked.urgent.customer_id,), position=0,
        ))
    result = route_planner.plan(start, 0, stops, rules, minutes)
    # 只有鎖第一站這一條規則，不會排不出來；萬一排不出來就照模型挑的順序
    order = [s.customer_id for s in result.slots] if isinstance(result, route_planner.Schedule) else list(items)
    itinerary = Itinerary(
        user_id=rep.id, date=today,
        suggested=[{"customer_id": cid, "signal": items[cid]["signal"], "reason": items[cid]["reason"]} for cid in order],
        urgent=dataclasses.asdict(picked.urgent) if picked.urgent else None,
    )
    session.add(itinerary)
    session.flush()
    session.add_all([
        ItineraryStop(
            itinerary_id=itinerary.id, position=n, customer_id=cid, source="model",
            signal=items[cid]["signal"], reason=items[cid]["reason"], duration_minutes=DEFAULT_DURATION,
            locked=picked.urgent is not None and cid == picked.urgent.customer_id,
        )
        for n, cid in enumerate(order)
    ])
    session.flush()
    return itinerary


def _start(
    session: Session, rep: AppUser, today: dt.date, done: list[tuple[Visit, Customer]], durations: dict[str, int]
) -> tuple[dt.datetime, travel.Point | None]:
    """從哪裡、幾點出發。還沒跑任何一站：區處辦公室 09:30；跑過了：最後完成那一站，拜訪時間加停留之後。
    區處沒有位置（組織管理新開的區）時回 None，呼叫端改從第一站出發。"""
    if done:
        visit, customer = done[-1]
        minutes = durations.get(customer.id, DEFAULT_DURATION)
        return visit.visited_at.astimezone(TAIPEI) + dt.timedelta(minutes=minutes), _point(customer)
    office = session.scalar(select(OrgUnit).where(OrgUnit.kind == "region", OrgUnit.name == rep.region))
    origin = (office.lat, office.lng) if office and office.lat is not None and office.lng is not None else None
    return dt.datetime.combine(today, today_route.FIRST_STOP, TAIPEI), origin


def _cheapest_index(
    session: Session, rep: AppUser, today: dt.date, done: list[tuple[Visit, Customer]], durations: dict[str, int],
    open_rows: list[ItineraryStop], new_row: ItineraryStop, new_customer: Customer,
) -> int:
    customers = _customers(session, [r.customer_id for r in open_rows]) | {new_customer.id: new_customer}
    start, origin = _start(session, rep, today, done, durations)
    ids = [r.customer_id for r in open_rows] + [new_customer.id]
    points = [_point(customers[cid]) for cid in ids]
    minutes = travel.matrix([origin or points[0], *points]).minutes
    ordered = [_plan_stop(r, n + 1) for n, r in enumerate(open_rows)]
    new = route_planner.PlanStop(customer_id=new_customer.id, point=len(ids), duration=new_row.duration_minutes)
    locks = [
        route_planner.Rule(
            id=f"lock:{r.customer_id}", text=f"{customers[r.customer_id].name}鎖在第 {n + 1} 站",
            kind="lock", customer_ids=(r.customer_id,), position=n,
        )
        for n, r in enumerate(open_rows) if r.locked
    ]
    return route_planner.cheapest_insert(start, 0, ordered, new, locks, minutes)


def _rows(session: Session, itinerary: Itinerary) -> list[ItineraryStop]:
    return list(session.scalars(
        select(ItineraryStop).where(ItineraryStop.itinerary_id == itinerary.id)
        .order_by(ItineraryStop.position, ItineraryStop.id)
    ))


def _customers(session: Session, ids: list[str]) -> dict[str, Customer]:
    return {c.id: c for c in session.scalars(select(Customer).where(Customer.id.in_(ids)))} if ids else {}


def _durations(rows: list[ItineraryStop]) -> dict[str, int]:
    return {r.customer_id: r.duration_minutes for r in rows}


def _point(customer: Customer) -> travel.Point:
    return customer.lat, customer.lng


def _plan_stop(row: ItineraryStop, point: int) -> route_planner.PlanStop:
    window = (row.window_kind, row.window_time) if row.window_kind and row.window_time else None
    return route_planner.PlanStop(customer_id=row.customer_id, point=point, duration=row.duration_minutes, window=window)


def _renumber(rows: list[ItineraryStop]) -> None:
    for n, row in enumerate(rows):
        row.position = n


def _remove(session: Session, itinerary: Itinerary, row: ItineraryStop) -> None:
    session.execute(delete(ItineraryPrecedence).where(
        ItineraryPrecedence.itinerary_id == itinerary.id,
        or_(ItineraryPrecedence.before_customer_id == row.customer_id,
            ItineraryPrecedence.after_customer_id == row.customer_id),
    ))
    session.delete(row)


def _snooze(session: Session, user_id: str, customer_id: str, until: dt.date) -> None:
    stmt = insert(RouteSnooze).values(user_id=user_id, customer_id=customer_id, until=until)
    session.execute(stmt.on_conflict_do_update(
        index_elements=["user_id", "customer_id"],
        set_={"until": func.greatest(RouteSnooze.until, stmt.excluded.until)},
    ))


def _adjust_weight(session: Session, user_id: str, signal: str, delta: int) -> None:
    stmt = insert(RouteSignalWeight).values(user_id=user_id, signal=signal, weight=delta)
    session.execute(stmt.on_conflict_do_update(
        index_elements=["user_id", "signal"], set_={"weight": RouteSignalWeight.weight + delta},
    ))


def _touch(itinerary: Itinerary) -> None:
    itinerary.version += 1
    itinerary.updated_at = func.now()
