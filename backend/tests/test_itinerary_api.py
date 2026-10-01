"""行程 API：誰看得到、JSON 長什麼樣、三顆鈕與加站。服務本身的行為在 test_itinerary.py。"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import Customer


@pytest.fixture
def client(tx):
    return TestClient(app)


def today(client, auth, user_id="U01"):
    response = client.get("/api/itinerary/today", headers=auth(user_id))
    assert response.status_code == 200, response.text
    return response.json()


def test_today_has_the_fields_the_home_page_needs(client, auth):
    data = today(client, auth)
    assert data["date"] == "2026-10-28" and data["rep"]["name"] == "林昱辰"
    assert data["version"] == 1 and data["estimated"] is True
    assert data["total"] == len(data["stops"]) == 5
    first = data["stops"][0]
    assert set(first) == {
        "customer_id", "customer_name", "type", "grade", "planned_time", "status", "signal", "reason", "visit_id",
        "source", "duration_minutes", "late_minutes", "travel_minutes", "travel_km",
    }
    assert data["urgent"]["customer_id"] == first["customer_id"]
    assert data["finish_time"] > first["planned_time"]


def test_only_a_signed_in_sales_rep_has_an_itinerary(client, auth):
    assert client.get("/api/itinerary/today").status_code == 401
    denied = client.get("/api/itinerary/today", headers=auth("M01"))
    assert denied.status_code == 403 and denied.json()["detail"] == "主管沒有自己的拜訪路線"


def test_pin_through_the_api(client, auth):
    last = today(client, auth)["stops"][-1]
    response = client.post(
        "/api/itinerary/today/feedback",
        json={"customer_id": last["customer_id"], "action": "pin", "version": 1},
        headers=auth(),
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["stops"][0]["customer_id"] == last["customer_id"] and data["version"] == 2


def test_stale_version_and_unknown_customer(client, auth):
    first = today(client, auth)["stops"][0]
    stale = client.post(
        "/api/itinerary/today/feedback",
        json={"customer_id": first["customer_id"], "action": "snooze", "version": 7}, headers=auth(),
    )
    assert stale.status_code == 409 and stale.json()["detail"] == "行程剛被改過，已幫你重新整理"
    missing = client.post(
        "/api/itinerary/today/feedback", json={"customer_id": "C999", "action": "pin", "version": 1}, headers=auth(),
    )
    assert missing.status_code == 404


def test_add_stops_from_an_answer(client, auth, tx):
    on_route = [s["customer_id"] for s in today(client, auth)["stops"]]
    mine = tx.scalars(select(Customer).where(Customer.owner_user_id == "U01", Customer.id.not_in(on_route))).first()
    response = client.post("/api/itinerary/today/stops", json={"customer_ids": [mine.id, on_route[0]]}, headers=auth())
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["added"] == [mine.name]
    assert data["skipped"][0]["reason"] == "已經在今天的行程裡"
    assert mine.id in {s["customer_id"] for s in data["itinerary"]["stops"]}
