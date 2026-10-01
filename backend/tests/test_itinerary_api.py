"""行程 API：誰看得到、JSON 長什麼樣、三顆鈕與加站。服務本身的行為在 test_itinerary.py。"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import Customer, Itinerary, RouteSignalWeight, RouteSnooze


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


def test_it_resets_the_demo_reps_itinerary(client, auth, tx):
    urgent_id = today(client, auth)["urgent"]["customer_id"]
    # 誤判同時留下 route_snooze 與 route_signal_weight 兩張表的紀錄，reset 兩個都要清掉
    feedback = client.post(
        "/api/itinerary/today/feedback",
        json={"customer_id": urgent_id, "action": "misjudge", "version": 1},
        headers=auth(),
    )
    assert feedback.status_code == 200, feedback.text

    reset = client.post("/api/admin/demo-itinerary/reset", headers=auth("A01"))
    assert reset.status_code == 200, reset.text
    assert reset.json() == {"rep_id": "U01", "rep_name": "林昱辰"}

    assert tx.scalar(select(Itinerary).where(Itinerary.user_id == "U01")) is None
    assert tx.scalar(select(RouteSnooze).where(RouteSnooze.user_id == "U01")) is None
    assert tx.scalar(select(RouteSignalWeight).where(RouteSignalWeight.user_id == "U01")) is None

    rebuilt = today(client, auth)
    assert rebuilt["version"] == 1 and rebuilt["urgent"] is not None


def test_reset_demo_itinerary_is_it_only(client, auth):
    for user_id in ("M01", "U01"):
        assert client.post("/api/admin/demo-itinerary/reset", headers=auth(user_id)).status_code == 403


def test_add_stops_from_an_answer(client, auth, tx):
    on_route = [s["customer_id"] for s in today(client, auth)["stops"]]
    mine = tx.scalars(select(Customer).where(Customer.owner_user_id == "U01", Customer.id.not_in(on_route))).first()
    response = client.post("/api/itinerary/today/stops", json={"customer_ids": [mine.id, on_route[0]]}, headers=auth())
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["added"] == [mine.name]
    assert data["skipped"][0]["reason"] == "已經在今天的行程裡"
    assert mine.id in {s["customer_id"] for s in data["itinerary"]["stops"]}
