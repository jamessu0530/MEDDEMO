"""點站就算到過（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈行程〉）：
到過的站標成跑完，但留在原本的位置、時間照原本排的；主管頁的地圖也算它跑完。"""

import pytest
from sqlalchemy import func, select

from app.models import AppUser, StopArrival
from app.services import itinerary as service
from app.services import team_itineraries as team


def route(tx):
    itinerary = service.get_or_create(tx, "U01")
    return itinerary, service.view(tx, itinerary)


def test_an_arrived_stop_is_done_but_stays_in_place(tx):
    itinerary, before = route(tx)
    service.arrive(tx, "U01", before.stops[2].customer_id)
    after = service.view(tx, itinerary)
    assert [s.customer_id for s in after.stops] == [s.customer_id for s in before.stops]
    assert [s.planned_time for s in after.stops] == [s.planned_time for s in before.stops]
    assert [s.status for s in after.stops] == ["next", "todo", "done", "todo", "todo"]
    assert after.stops[2].arrived_at is not None and after.stops[0].arrived_at is None
    assert after.done == 1
    # 版本加一：主管頁靠 Itinerary 改了才收到 itinerary 事件（app/realtime.py）
    assert after.version == before.version + 1


def test_next_skips_arrived_stops(tx):
    itinerary, before = route(tx)
    service.arrive(tx, "U01", before.stops[0].customer_id)
    assert [s.status for s in service.view(tx, itinerary).stops][:2] == ["done", "next"]


def test_tapping_again_only_moves_the_last_time(tx):
    itinerary, before = route(tx)
    a, b = before.stops[0].customer_id, before.stops[1].customer_id
    for customer_id in (a, b, a):
        service.arrive(tx, "U01", customer_id)
    rows = {r.customer_id: r for r in tx.scalars(select(StopArrival).where(StopArrival.itinerary_id == itinerary.id))}
    assert set(rows) == {a, b}
    assert rows[a].first_at < rows[b].first_at < rows[a].last_at


def test_only_stops_on_todays_route(tx):
    route(tx)
    with pytest.raises(service.NotOnItinerary):
        service.arrive(tx, "U01", "C999")


def test_managers_have_no_route_to_tap(tx):
    with pytest.raises(LookupError):
        service.arrive(tx, "M01", "C001")


def test_resetting_the_demo_route_clears_arrivals(tx):
    _, before = route(tx)
    service.arrive(tx, "U01", before.stops[0].customer_id)
    service.reset_today(tx, "U01")
    assert tx.scalar(select(func.count()).select_from(StopArrival)) == 0


def test_the_map_counts_arrived_stops_as_finished(tx):
    itinerary, before = route(tx)
    service.arrive(tx, "U01", before.stops[1].customer_id)
    found = team.rep_map(tx, tx.get(AppUser, "U01"), itinerary)
    assert [s.status for s in found.stops] == ["next", "done", "todo", "todo", "todo"]
