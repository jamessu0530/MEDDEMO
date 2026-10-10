"""個人頁：獎牌只算點過的站，另有三格事蹟數字、前五名與每月業績
（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈API〉）。"""

import datetime as dt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, text

from app.main import app
from app.models import AppUser, ItineraryStop, StopArrival
from app.services import achievements
from app.services import itinerary as service

# 測試資料庫的系統日（seed.DEFAULT_AS_OF）：解鎖日期是那份行程的日期，不是真實時間
DAY = dt.date(2026, 10, 28)


@pytest.fixture
def client(tx):
    return TestClient(app)


def tap(tx, *indexes):
    itinerary = service.get_or_create(tx, "U01")
    stops = service.view(tx, itinerary).stops
    for i in indexes:
        service.arrive(tx, "U01", stops[i].customer_id)
    return itinerary, stops


def by_key(found):
    return {(m.kind, m.tier): m for m in found}


def test_six_medals_and_nothing_unlocked_before_any_tap(tx):
    found = achievements.medals(tx, "U01")
    assert [(m.kind, m.tier, m.need) for m in found] == [
        ("stores", 1, 1), ("stores", 2, 3), ("stores", 3, 5), ("cities", 1, 1), ("cities", 2, 2), ("cities", 3, 3),
    ]
    assert all(m.have == 0 and m.unlocked_on is None and m.unlocked_at is None for m in found)


def test_three_stores_unlock_silver_on_the_route_day(tx):
    _, stops = tap(tx, 0, 1, 2)
    found = by_key(achievements.medals(tx, "U01"))
    assert found[("stores", 2)].have == 3 and found[("stores", 2)].unlocked_on == DAY
    assert found[("stores", 3)].unlocked_on is None
    cities = {s.city for s in stops[:3]}
    for tier, need in enumerate((1, 2, 3), start=1):
        medal = found[("cities", tier)]
        assert medal.have == len(cities)
        assert medal.unlocked_on == (DAY if need <= len(cities) else None)


def test_unlocked_at_is_when_the_nth_store_was_first_tapped(tx):
    # 系統日固定在決賽日，IT 重置前後解鎖日一樣；解鎖的那一刻（真實時間）不一樣，首頁與個人頁用它判斷「這面看過了沒」
    itinerary, stops = tap(tx, 0, 1, 0, 2)
    first = {
        r.customer_id: r.first_at
        for r in tx.scalars(select(StopArrival).where(StopArrival.itinerary_id == itinerary.id))
    }
    found = by_key(achievements.medals(tx, "U01"))
    assert found[("stores", 1)].unlocked_at == first[stops[0].customer_id]
    assert found[("stores", 2)].unlocked_at == first[stops[2].customer_id]
    assert found[("stores", 3)].unlocked_at is None


def test_tapping_the_same_stop_twice_counts_once(tx):
    tap(tx, 0, 0)
    assert by_key(achievements.medals(tx, "U01"))[("stores", 1)].have == 1


def test_a_removed_stop_still_counts(tx):
    itinerary, stops = tap(tx, 0)
    tx.execute(delete(ItineraryStop).where(
        ItineraryStop.itinerary_id == itinerary.id, ItineraryStop.customer_id == stops[0].customer_id
    ))
    assert by_key(achievements.medals(tx, "U01"))[("stores", 1)].have == 1


def test_newly_unlocked_lists_only_what_this_tap_unlocked(tx):
    before = achievements.medals(tx, "U01")
    tap(tx, 0)
    after = achievements.medals(tx, "U01")
    assert [(m.kind, m.tier) for m in achievements.newly_unlocked(before, after)] == [("stores", 1), ("cities", 1)]
    assert achievements.newly_unlocked(after, after) == []


def test_arrive_returns_what_this_tap_unlocked(tx):
    # 前後兩次算獎牌都在行程的列鎖裡（service.arrive）：同時點的兩下排隊，不會兩邊都說解鎖了同一面
    itinerary = service.get_or_create(tx, "U01")
    first = service.view(tx, itinerary).stops[0].customer_id
    found, unlocked = service.arrive(tx, "U01", first)
    assert found.id == itinerary.id
    assert [(m.kind, m.tier) for m in unlocked] == [("stores", 1), ("cities", 1)]
    assert service.arrive(tx, "U01", first)[1] == []


def test_arrive_through_the_api(client, auth):
    route = client.get("/api/itinerary/today", headers=auth()).json()
    first = route["stops"][0]["customer_id"]
    sent = client.post(f"/api/itinerary/today/stops/{first}/arrive", headers=auth())
    assert sent.status_code == 200, sent.text
    data = sent.json()
    assert data["itinerary"]["stops"][0]["status"] == "done" and data["itinerary"]["stops"][0]["arrived_at"]
    assert data["itinerary"]["version"] == route["version"]
    assert [(m["kind"], m["tier"], m["unlocked_on"]) for m in data["unlocked"]] == [
        ("stores", 1, "2026-10-28"), ("cities", 1, "2026-10-28"),
    ]
    assert all(m["unlocked_at"] for m in data["unlocked"])
    again = client.post(f"/api/itinerary/today/stops/{first}/arrive", headers=auth()).json()
    assert again["unlocked"] == []


def test_arrive_refuses_other_customers_and_managers(client, auth):
    client.get("/api/itinerary/today", headers=auth())
    missing = client.post("/api/itinerary/today/stops/C999/arrive", headers=auth())
    assert missing.status_code == 404
    assert client.post("/api/itinerary/today/stops/C001/arrive", headers=auth("M01")).status_code == 403


def test_me_has_what_the_personal_page_shows(client, auth):
    data = client.get("/api/me", headers=auth()).json()
    assert data["name"] == "林昱辰" and data["region"] == "北區"
    assert data["stats"]["customers"] == 53
    assert data["stats"]["visits_last_year"] > 900 and data["stats"]["sales_last_year"] > 0
    amounts = [c["amount"] for c in data["top_customers"]]
    assert len(amounts) == 5 and amounts == sorted(amounts, reverse=True)
    assert [m["month"] for m in data["monthly"]] == ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]
    assert [m["through"] for m in data["monthly"]] == [None] * 5 + ["2026-10-28"]
    assert len(data["medals"]) == 6


def test_managers_have_no_personal_page(client, auth):
    found = client.get("/api/me", headers=auth("M01"))
    assert found.status_code == 403 and found.json()["detail"] == "主管沒有自己的拜訪路線"


def test_current_month_carries_the_as_of_date_even_on_its_last_day(tx):
    tx.execute(text("UPDATE app_setting SET value = '2026-09-30' WHERE key = 'as_of_date'"))
    monthly = achievements.build(tx, tx.get(AppUser, "U01")).monthly
    assert monthly[-1].month == "2026-09" and monthly[-1].through == dt.date(2026, 9, 30)
    assert all(m.through is None for m in monthly[:-1])
