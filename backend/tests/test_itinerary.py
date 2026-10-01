"""今天的行程：資料表、建立、讀取、三顆鈕、加站。"""

import datetime as dt
import itertools

import catalog
import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import Customer, Itinerary, ItineraryStop, RouteSignalWeight, RouteSnooze, Visit
from app.services import itinerary as service
from app.services import route_planner, today_route, travel
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
