"""停用持續定位後，舊網頁心跳不能寫入位置，分享端點不能重新啟用。"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app import realtime
from app.main import app
from app.models import UserLocation, UserPresence


@pytest.fixture(autouse=True)
def clean(engine):
    def clear():
        with engine.begin() as conn:
            conn.execute(delete(UserLocation))
            conn.execute(delete(UserPresence))
    clear()
    yield
    clear()


@pytest.mark.parametrize("user", ["U01", "M01", "A01"])
@pytest.mark.parametrize("payload", [
    {"location": {"lat": 25.034, "lng": 121.5645, "accuracy": 15}},
    {"location_denied": True},
])
def test_old_http_heartbeats_update_presence_without_collecting_location(engine, auth, monkeypatch, user, payload):
    events = []
    monkeypatch.setattr(realtime, "publish", events.append)
    response = TestClient(app).post("/api/presence/ping", headers=auth(user), json={"active": True, **payload})
    assert response.status_code == 200, response.text
    with Session(engine) as session:
        assert session.get(UserPresence, user) is not None
        assert session.get(UserLocation, user) is None
    assert all(event["type"] != "location" for event in events)


@pytest.mark.parametrize("method,path", [("get", "/api/location/me"), ("post", "/api/location/pause"), ("post", "/api/location/resume")])
def test_legacy_sharing_controls_are_retired_for_every_role(engine, auth, method, path):
    request = getattr(TestClient(app), method)
    for user in ("U01", "M01", "A01"):
        response = request(path, headers=auth(user))
        assert response.status_code == 410
        assert response.json()["detail"] == "持續位置分享已停用，主管僅能查看客戶提問。"
    assert request(path).status_code == 401


def test_legacy_heartbeat_does_not_overwrite_an_existing_location(engine, auth):
    with Session(engine) as session:
        session.add(UserLocation(user_id="U01", lat=24.0, lng=120.0, paused=True))
        session.commit()
    response = TestClient(app).post("/api/presence/ping", headers=auth("U01"),
                                    json={"active": True, "location": {"lat": 25.034, "lng": 121.5645}})
    assert response.status_code == 200
    with Session(engine) as session:
        row = session.get(UserLocation, "U01")
        assert (row.lat, row.lng, row.paused) == (24.0, 120.0, True)
