"""主管端的行程 API：誰看得到、JSON 長什麼樣、主管一讀就把行程建好存起來。服務的行為在 test_team_itineraries.py。"""

import re

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.main import app
from app.models import Itinerary

ROUTE_FIELDS = {
    "rep", "version", "done", "total", "travel_minutes", "travel_km", "finish_time", "estimated", "travel_mode", "origin",
    "stops", "legs", "removed", "added", "moved", "untouched", "location",
}
STOP_FIELDS = {
    "number", "customer_id", "customer_name", "area", "lat", "lng", "status", "planned_time", "duration_minutes",
    "late_minutes", "source", "signal", "reason", "window_kind", "window_time",
}


@pytest.fixture
def client(tx):
    return TestClient(app)


def test_a_manager_gets_the_team_overview(client, auth):
    response = client.get("/api/manager/itineraries", headers=auth("M01"))
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["date"] == "2026-10-28" and data["scope"] == "北區"
    assert re.fullmatch(r"\d\d:\d\d", data["updated_at"])
    assert [r["rep"]["id"] for r in data["reps"]] == ["U01", "U02"]
    first = data["reps"][0]
    assert set(first) == ROUTE_FIELDS
    assert first["rep"] == {"id": "U01", "name": "林昱辰", "region": "北區"}
    assert set(first["stops"][0]) == STOP_FIELDS
    assert set(first["origin"]) == {"lat", "lng"}
    assert len(first["legs"]) == len(first["stops"])
    assert first["legs"][0] == {"polyline": None, "done": False, "steps": []}
    assert first["estimated"] is True and first["travel_mode"] == "drive"


def test_it_sees_the_whole_company(client, auth):
    data = client.get("/api/manager/itineraries", headers=auth("A01")).json()
    assert data["scope"] == "全公司"
    assert {"U01", "U02", "U03", "U04", "U05"} <= {r["rep"]["id"] for r in data["reps"]}


def test_reps_cannot_open_the_team_routes(client, auth):
    for path in ("/api/manager/itineraries", "/api/manager/itineraries/U01"):
        response = client.get(path, headers=auth("U01"))
        assert response.status_code == 403 and response.json()["detail"] == "這個頁面只有主管看得到"
    assert client.get("/api/manager/itineraries").status_code == 401


def test_one_reps_detail_only_inside_your_team(client, auth):
    detail = client.get("/api/manager/itineraries/U02", headers=auth("M01"))
    assert detail.status_code == 200, detail.text
    assert detail.json()["rep"]["name"] == "王冠宇" and set(detail.json()) == ROUTE_FIELDS
    for user_id in ("U03", "M01", "NOBODY"):
        response = client.get(f"/api/manager/itineraries/{user_id}", headers=auth("M01"))
        assert response.status_code == 404 and response.json()["detail"] == "找不到這位業務"
    assert client.get("/api/manager/itineraries/U03", headers=auth("A01")).status_code == 200


def test_a_managers_read_saves_the_itinerary_it_built(client, auth, tx):
    tx.execute(delete(Itinerary).where(Itinerary.user_id == "U02"))
    assert client.get("/api/manager/itineraries/U02", headers=auth("M01")).status_code == 200
    assert tx.scalar(select(Itinerary).where(Itinerary.user_id == "U02")) is not None


def test_the_route_carries_the_location_line(client, auth):
    first = client.get("/api/manager/itineraries", headers=auth("M01")).json()["reps"][0]
    assert set(first["location"]) == {"text", "lat", "lng", "at", "live"}


def test_locations_alone_for_live_updates(client, auth):
    response = client.get("/api/manager/locations", headers=auth("M01"))
    assert response.status_code == 200, response.text
    data = response.json()
    assert re.fullmatch(r"\d\d:\d\d", data["updated_at"])
    assert set(data["locations"]) == {"U01", "U02"}
    assert set(data["locations"]["U01"]) == {"text", "lat", "lng", "at", "live"}
    assert client.get("/api/manager/locations", headers=auth("U01")).status_code == 403
