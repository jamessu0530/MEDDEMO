"""座騎圖鑑：騎過哪些座騎（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md〈座騎圖鑑〉）。"""

import typing

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api import vehicles as vehicles_api
from app.main import app
from app.models import RIDE_CITIES, AppUser, VehicleRide
from app.services import auth as auth_service
from app.services import itinerary as itinerary_service
from app.services import vehicles


@pytest.fixture
def client(tx):
    return TestClient(app)


def test_a_ride_is_recorded_once_and_keeps_its_first_time(tx):
    vehicles.record(tx, "U01", [("新竹市", "scooter")])
    first = tx.scalar(select(VehicleRide.first_ridden_at).where(VehicleRide.user_id == "U01"))
    vehicles.record(tx, "U01", [("新竹市", "scooter"), ("新北市", "scooter")])
    rows = tx.execute(select(VehicleRide.city, VehicleRide.mode, VehicleRide.first_ridden_at)
                      .where(VehicleRide.user_id == "U01").order_by(VehicleRide.city)).all()
    assert [(c, m) for c, m, _ in rows] == [("新北市", "scooter"), ("新竹市", "scooter")]
    assert next(t for c, _, t in rows if c == "新竹市") == first


def test_the_collection_lists_all_28_in_order(tx):
    vehicles.record(tx, "U01", [("台中市", "walk")])
    items = vehicles.collection(tx, "U01")
    assert len(items) == 28
    assert [(i.city, i.mode) for i in items[:4]] == [("台北市", "drive"), ("台北市", "scooter"), ("台北市", "transit"), ("台北市", "walk")]
    assert [i.city for i in items[::4]] == list(RIDE_CITIES)
    assert [(i.city, i.mode) for i in items if i.ridden_at] == [("台中市", "walk")]


def test_rides_through_the_api(client, auth):
    sent = client.post("/api/vehicles/rides", json={"rides": [{"city": "新竹市", "mode": "walk"}]}, headers=auth())
    assert sent.status_code == 204, sent.text
    data = client.get("/api/vehicles", headers=auth()).json()
    assert data["total"] == 28 and data["ridden"] == 1
    assert {(i["city"], i["mode"]) for i in data["items"] if i["ridden_at"]} == {("新竹市", "walk")}


@pytest.mark.parametrize("body", [
    {"rides": [{"city": "桃園市", "mode": "walk"}]},
    {"rides": [{"city": "新竹市", "mode": "rocket"}]},
    {"rides": []},
    {"rides": [{"city": "新竹市", "mode": "walk"}] * 5},
])
def test_bad_rides_are_refused(client, auth, body):
    assert client.post("/api/vehicles/rides", json=body, headers=auth()).status_code == 422


def test_managers_have_no_rides(client, auth):
    assert client.get("/api/vehicles", headers=auth("M01")).status_code == 403
    assert client.post("/api/vehicles/rides", json={"rides": [{"city": "新竹市", "mode": "walk"}]},
                       headers=auth("M01")).status_code == 403


def test_a_third_party_account_rides_as_the_demo_rep(client, tx):
    guest = AppUser(id="XRIDE01", name="評審", role="sales", region="北區", acts_as_user_id="U01")
    tx.add(guest)
    tx.commit()
    headers = {"Authorization": f"Bearer {auth_service.create_token(guest)}"}
    sent = client.post("/api/vehicles/rides", json={"rides": [{"city": "高雄市", "mode": "drive"}]}, headers=headers)
    assert sent.status_code == 204, sent.text
    assert [(i.city, i.mode) for i in vehicles.collection(tx, "U01") if i.ridden_at] == [("高雄市", "drive")]
    assert tx.scalar(select(VehicleRide).where(VehicleRide.user_id == "XRIDE01")) is None


def test_resetting_the_demo_itinerary_clears_rides(tx):
    vehicles.record(tx, "U01", [("新竹市", "walk")])
    itinerary_service.reset_today(tx, "U01")
    assert vehicles.collection(tx, "U01")[0].ridden_at is None
    assert tx.scalar(select(VehicleRide).where(VehicleRide.user_id == "U01")) is None


def test_the_api_city_literal_matches_ride_cities():
    assert typing.get_args(vehicles_api.RideCityName) == RIDE_CITIES
