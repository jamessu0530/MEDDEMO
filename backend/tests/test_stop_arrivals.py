"""點站就算到過（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈行程〉）：
到過的站標成跑完，但留在原本的位置、時間照原本排的；主管頁的地圖也算它跑完。"""

import datetime as dt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models import AppUser, StopArrival, Visit
from app.services import google_routes, travel
from app.services import itinerary as service
from app.services import team_itineraries as team
from app.timeutil import TAIPEI


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
    # 版本不變：手上拿著這一版的人（別的評審、調整清單）照樣可以改；主管頁靠 updated_at 改了收到事件（app/realtime.py）
    assert after.version == before.version


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


def progress_of(view):
    return [(s.customer_id, s.status, s.arrived_at) for s in view.stops], view.done, view.total, view.urgent


def test_progress_is_the_view_without_the_travel(tx):
    itinerary, before = route(tx)
    found = service.progress(tx, itinerary)
    assert found.itinerary_id == itinerary.id
    # 首頁移除緊急卡後，精簡進度也不再回傳該卡。
    assert found.urgent is None
    assert progress_of(found) == progress_of(before)
    for index in (2, 0):
        service.arrive(tx, "U01", before.stops[index].customer_id)
        assert progress_of(service.progress(tx, itinerary)) == progress_of(service.view(tx, itinerary))
    assert service.progress(tx, itinerary).urgent is None


def test_progress_puts_visited_stops_first_like_the_view(tx):
    itinerary, before = route(tx)
    at = dt.datetime(2026, 10, 28, 9, 40, tzinfo=TAIPEI)
    tx.add(Visit(
        id="VPROGRESS", customer_id=before.stops[3].customer_id, user_id="U01", visited_at=at, transcript="測試",
        status="synced", confirmed_at=at,
    ))
    service.arrive(tx, "U01", before.stops[1].customer_id)
    tx.flush()
    found = service.progress(tx, itinerary)
    assert found.stops[0].customer_id == before.stops[3].customer_id
    assert progress_of(found) == progress_of(service.view(tx, itinerary))


def test_tapping_a_stop_never_asks_google(tx, monkeypatch, auth):
    """點站不比版本、不動順序與時間，回來的只有進度：不該算車程（正式環境每算一次都要問 Google）。"""
    client = TestClient(app)
    first = client.get("/api/itinerary/today", headers=auth()).json()["stops"][0]["customer_id"]

    def no_travel(*args, **kwargs):
        raise AssertionError("點站不該算車程")

    for name in ("along", "matrix", "lines", "options"):
        monkeypatch.setattr(travel, name, no_travel)
    for name in ("route_matrix", "route_legs"):
        monkeypatch.setattr(google_routes, name, no_travel)
    sent = client.post(f"/api/itinerary/today/stops/{first}/arrive", headers=auth())
    assert sent.status_code == 200, sent.text
    data = sent.json()
    assert data["stops"][0] == {"customer_id": first, "status": "done", "arrived_at": data["stops"][0]["arrived_at"]}
    assert data["stops"][0]["arrived_at"] and data["urgent"] is None
