"""今天的行程：資料表、建立、讀取、三顆鈕、加站。"""

import datetime as dt
import itertools
import threading
import time

import catalog
import pytest
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Customer, Itinerary, ItineraryStop, RouteSignalWeight, RouteSnooze, Visit
from app.services import itinerary as service
from app.services import google_routes, route_planner, today_route, travel
from app.timeutil import TAIPEI

TODAY = dt.date(2026, 10, 28)


def new_itinerary(tx, user_id="U01"):
    itinerary = Itinerary(user_id=user_id, date=dt.date(2026, 10, 1), suggested=[])
    tx.add(itinerary)
    tx.flush()
    return itinerary


def test_one_itinerary_per_rep_per_day(tx):
    new_itinerary(tx)
    with pytest.raises(IntegrityError), tx.begin_nested():
        new_itinerary(tx)


def test_a_customer_appears_once_on_an_itinerary(tx):
    itinerary = new_itinerary(tx)
    tx.add(ItineraryStop(itinerary_id=itinerary.id, position=0, customer_id="C001", source="model", signal="ar", reason="x"))
    tx.flush()
    with pytest.raises(IntegrityError), tx.begin_nested():
        tx.add(ItineraryStop(itinerary_id=itinerary.id, position=1, customer_id="C001", source="rep", signal="ar", reason="x"))
        tx.flush()


def test_a_window_needs_both_kind_and_time(tx):
    itinerary = new_itinerary(tx)
    with pytest.raises(IntegrityError), tx.begin_nested():
        tx.add(ItineraryStop(
            itinerary_id=itinerary.id, position=0, customer_id="C001", source="model", signal="ar", reason="x",
            window_kind="before",
        ))
        tx.flush()


def test_first_read_builds_the_suggestion_ordered_by_distance(tx):
    itinerary = service.get_or_create(tx, "U01")
    view = service.view(tx, itinerary)
    assert view.date == TODAY and view.version == 1 and view.estimated is True
    assert len(view.stops) == view.total == today_route.ROUTE_SIZE
    assert [s.status for s in view.stops] == ["next"] + ["todo"] * 4
    assert all(s.source == "model" and s.duration_minutes == 40 for s in view.stops)
    times = [s.planned_time for s in view.stops]
    assert times == sorted(times) and times[0] > "09:30"
    # 「需立即處理」那家鎖在第一站，其他幾站的順序是所有排法裡車程最短的
    assert view.urgent and view.stops[0].customer_id == view.urgent["customer_id"]
    customers = {c.id: c for c in tx.scalars(select(Customer).where(Customer.id.in_([s.customer_id for s in view.stops])))}
    ids = [s.customer_id for s in view.stops]
    points = [catalog.REGION_OFFICE["TW.N"]] + [(customers[cid].lat, customers[cid].lng) for cid in ids]
    minutes = travel.matrix(points).minutes
    start = dt.datetime(2026, 10, 28, 9, 30, tzinfo=TAIPEI)
    stops = [route_planner.PlanStop(cid, n + 1, 40) for n, cid in enumerate(ids)]
    best = min(
        route_planner.schedule(start, 0, [stops[0], *rest], minutes).travel_minutes
        for rest in itertools.permutations(stops[1:])
    )
    assert view.travel_minutes == best
    assert itinerary.suggested == [{"customer_id": s.customer_id, "signal": s.signal, "reason": s.reason} for s in view.stops]


def test_second_read_returns_the_saved_itinerary(tx):
    first = service.view(tx, service.get_or_create(tx, "U01"))
    second = service.view(tx, service.get_or_create(tx, "U01"))
    assert first == second
    assert len(tx.scalars(select(Itinerary).where(Itinerary.user_id == "U01")).all()) == 1


def test_each_rep_gets_their_own_customers(tx):
    seen = set()
    for rep_id in ("U01", "U02", "U03", "U04", "U05"):
        ids = {s.customer_id for s in service.view(tx, service.get_or_create(tx, rep_id)).stops}
        assert len(ids) == today_route.ROUTE_SIZE and not ids & seen
        seen |= ids


def test_managers_have_no_itinerary(tx):
    with pytest.raises(LookupError):
        service.get_or_create(tx, "M01")


def test_pin_moves_a_stop_to_next_and_bumps_the_version(tx):
    itinerary = service.get_or_create(tx, "U01")
    last = service.view(tx, itinerary).stops[-1]
    service.apply_feedback(tx, "U01", last.customer_id, "pin", 1)
    view = service.view(tx, itinerary)
    assert view.stops[0].customer_id == last.customer_id and view.stops[0].status == "next"
    assert view.version == 2
    assert tx.get(RouteSignalWeight, ("U01", last.signal)).weight == 1


def test_snooze_drops_the_stop_and_skips_three_days(tx):
    itinerary = service.get_or_create(tx, "U01")
    target = service.view(tx, itinerary).stops[2]
    service.apply_feedback(tx, "U01", target.customer_id, "snooze", 1)
    view = service.view(tx, itinerary)
    assert target.customer_id not in {s.customer_id for s in view.stops} and view.total == 4
    assert tx.get(RouteSnooze, ("U01", target.customer_id)).until == dt.date(2026, 10, 31)


def test_misjudge_also_lowers_that_kind_of_reminder(tx):
    itinerary = service.get_or_create(tx, "U01")
    target = service.view(tx, itinerary).stops[1]
    service.apply_feedback(tx, "U01", target.customer_id, "misjudge", 1)
    assert tx.get(RouteSignalWeight, ("U01", target.signal)).weight == -1
    assert tx.get(RouteSnooze, ("U01", target.customer_id)) is not None


def test_any_button_on_the_urgent_stop_clears_the_card(tx):
    itinerary = service.get_or_create(tx, "U01")
    urgent = service.view(tx, itinerary).urgent
    service.apply_feedback(tx, "U01", urgent["customer_id"], "pin", 1)
    assert service.view(tx, itinerary).urgent is None


def test_a_stale_version_is_refused(tx):
    service.get_or_create(tx, "U01")
    with pytest.raises(service.VersionConflict):
        service.apply_feedback(tx, "U01", "C001", "pin", 99)


def test_feedback_for_a_customer_not_on_the_itinerary(tx):
    service.get_or_create(tx, "U01")
    with pytest.raises(service.NotOnItinerary):
        service.apply_feedback(tx, "U01", "C999", "pin", 1)


def test_a_finished_visit_moves_to_the_front(tx):
    itinerary = service.get_or_create(tx, "U01")
    target = service.view(tx, itinerary).stops[1]
    at = dt.datetime(2026, 10, 28, 9, 40, tzinfo=TAIPEI)
    tx.add(Visit(id="VTEST1", customer_id=target.customer_id, user_id="U01", visited_at=at,
                 transcript="測試", status="synced", confirmed_at=at))
    tx.flush()
    view = service.view(tx, itinerary)
    assert view.done == 1 and view.total == 5
    assert view.stops[0].customer_id == target.customer_id
    assert (view.stops[0].status, view.stops[0].planned_time, view.stops[0].visit_id) == ("done", "09:40", "VTEST1")
    # 下一站從那一家、09:40 加停留 40 分鐘之後出發
    assert view.stops[1].status == "next" and view.stops[1].planned_time >= "10:20"


def test_added_stops_go_where_they_detour_least(tx):
    itinerary = service.get_or_create(tx, "U01")
    on_route = [s.customer_id for s in service.view(tx, itinerary).stops]
    mine = tx.scalars(select(Customer.id).where(Customer.owner_user_id == "U01", Customer.id.not_in(on_route))).first()
    theirs = tx.scalars(select(Customer.id).where(Customer.owner_user_id == "U02")).first()
    tx.add(RouteSnooze(user_id="U01", customer_id=mine, until=dt.date(2026, 10, 30)))
    tx.flush()
    _, added, skipped = service.add_stops(tx, "U01", [mine, theirs, on_route[0]])
    view = service.view(tx, itinerary)
    stop = next(s for s in view.stops if s.customer_id == mine)
    assert len(added) == 1 and stop.source == "ask" and stop.reason
    assert {(s.customer_id, s.reason) for s in skipped} == {(theirs, "不是你的客戶"), (on_route[0], "已經在今天的行程裡")}
    assert view.version == 2
    # 加進來就取消暫緩，不然明天的建議照樣不排
    assert tx.get(RouteSnooze, ("U01", mine)) is None
    # 第一站鎖著，不會被插隊
    assert view.stops[0].customer_id == on_route[0]


def test_no_more_than_eight_open_stops(tx):
    service.get_or_create(tx, "U01")
    on_route = [s.customer_id for s in service.view(tx, service.get_or_create(tx, "U01")).stops]
    more = tx.scalars(select(Customer.id).where(Customer.owner_user_id == "U01", Customer.id.not_in(on_route)).limit(5)).all()
    _, added, skipped = service.add_stops(tx, "U01", list(more))
    assert len(added) == 3
    assert [s.reason for s in skipped] == ["今天已經排了 8 站", "今天已經排了 8 站"]


def test_saved_order_survives_new_feedback(tx):
    """動過就固定：就算之後的暫緩、權重調整原本會讓模型選別的站、排別的順序，存著的這份也不重排。"""
    itinerary = service.get_or_create(tx, "U01")
    view = service.view(tx, itinerary)
    order = [s.customer_id for s in view.stops]
    version = view.version

    tx.add(RouteSnooze(user_id="U01", customer_id=order[1], until=dt.date(2026, 10, 31)))
    tx.add(RouteSignalWeight(user_id="U01", signal=view.stops[0].signal, weight=-999))
    tx.flush()

    again = service.view(tx, service.get_or_create(tx, "U01"))
    assert [s.customer_id for s in again.stops] == order
    assert again.version == version


def test_two_saves_at_once_cannot_both_pass_the_version_check(engine):
    """兩個人同時讀到同一個版本、幾乎同時各自存：靠 _lock 的 SELECT ... FOR UPDATE 把兩邊序列化，
    後到的那個鎖到的時候，版本已經被先存的那個改過了，直接擋下來，不會兩邊的改動混在一起。
    用 engine 開真的連線跑在兩條執行緒上（不是共用一條連線的 tx），才測得出跨連線、真的交疊的鎖。"""
    with Session(engine) as a, Session(engine) as b:
        itinerary_a = service.get_or_create(a, "U01")
        version = itinerary_a.version
        target_id = service.view(a, itinerary_a).stops[-1].customer_id
        a.commit()

        itinerary_b = service.get_or_create(b, "U01")
        assert itinerary_b.version == version
        b.commit()

    # 先存的那個改完、拿到鎖之後先別急著提交，讓後存的那個真的卡在 _lock 的 FOR UPDATE 上
    first_locked = threading.Event()
    second_outcome: dict[str, bool] = {}

    def save_first():
        with Session(engine) as session:
            service.apply_feedback(session, "U01", target_id, "pin", version)
            first_locked.set()
            time.sleep(0.3)
            session.commit()

    def save_second():
        first_locked.wait(timeout=5)
        with Session(engine) as session:
            try:
                service.apply_feedback(session, "U01", target_id, "pin", version)
            except service.VersionConflict:
                second_outcome["conflict"] = True
            else:
                second_outcome["conflict"] = False
                session.commit()

    try:
        t1 = threading.Thread(target=save_first)
        t2 = threading.Thread(target=save_second)
        t1.start()
        t2.start()
        t1.join(timeout=5)
        t2.join(timeout=5)
        assert second_outcome.get("conflict") is True
    finally:
        # 這個測試不像其他測試用 tx（回滾），而是真的 commit 到測試資料庫，收尾要自己清乾淨
        with Session(engine) as cleanup:
            cleanup.execute(delete(RouteSignalWeight).where(RouteSignalWeight.user_id == "U01"))
            cleanup.execute(delete(RouteSnooze).where(RouteSnooze.user_id == "U01"))
            cleanup.execute(delete(Itinerary).where(Itinerary.user_id == "U01", Itinerary.date == TODAY))
            cleanup.commit()


def test_reading_the_itinerary_asks_google_for_the_legs_in_order_not_the_whole_matrix(tx, monkeypatch, env):
    # 先在沒有金鑰時建好（建的時候要排順序，會問整份矩陣），再設金鑰讀
    itinerary = service.get_or_create(tx, "U01")
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    asked = []

    def route_legs(key, points, http=None, polylines=True):
        asked.append(points)
        return [google_routes.Leg(seconds=600, meters=3000, polyline="") for _ in points[1:]]

    def no_matrix(*args, **kwargs):
        raise AssertionError("讀行程不該問整份矩陣")

    monkeypatch.setattr(google_routes, "route_legs", route_legs)
    monkeypatch.setattr(google_routes, "route_matrix", no_matrix)
    view = service.view(tx, itinerary)
    assert view.estimated is False
    # 一次問完：辦公室加每一站，照存著的順序
    assert len(asked) == 1 and len(asked[0]) == len(view.stops) + 1
    # 每段 10 分鐘加 5 分鐘停車、3 公里
    assert all(s.travel_minutes == 15 and s.travel_km == 3.0 for s in view.stops)
    assert view.travel_km == 3.0 * len(view.stops)
