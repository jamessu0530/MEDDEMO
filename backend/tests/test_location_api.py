"""位置的 API：心跳帶位置、暫停與繼續、分享狀態，以及 WebSocket 只把位置事件送給看得到的主管。"""

import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app import realtime
from app.main import app
from app.models import UserLocation, UserPresence

TAIPEI_101 = {"lat": 25.034, "lng": 121.5645, "accuracy": 15}


@pytest.fixture(autouse=True)
def clean(engine):
    """心跳與 WebSocket 不在 tx 裡，會真的寫進資料庫：前後清掉位置與在線狀態。"""

    def clear():
        with engine.begin() as conn:
            conn.execute(delete(UserLocation))
            conn.execute(delete(UserPresence))

    clear()
    yield
    clear()


@pytest.fixture
def always(env):
    """測試不看現在幾點：整個星期都算上班時間。"""
    env(LOCATION_SHARE_HOURS="1-7 00:00-24:00")


@pytest.fixture
def events(monkeypatch):
    sent = []
    monkeypatch.setattr(realtime, "publish", sent.append)
    return sent


@pytest.fixture
def client():
    return TestClient(app)


def ping(client, headers, **body):
    response = client.post("/api/presence/ping", json={"active": True, **body}, headers=headers)
    assert response.status_code == 200, response.text


def location_of(engine, user_id):
    with Session(engine) as session:
        return session.get(UserLocation, user_id)


def test_a_heartbeat_with_a_location_saves_it_and_tells_managers(client, auth, always, events, engine):
    ping(client, auth("U01"), location=TAIPEI_101)
    row = location_of(engine, "U01")
    assert (row.lat, row.lng, row.accuracy_m) == (25.034, 121.5645, 15)
    assert {"type": "location", "user_id": "U01"} in events


def test_heartbeats_outside_work_hours_are_not_saved(client, auth, env, events, engine):
    env(LOCATION_SHARE_HOURS="1-7 00:00-00:00")
    ping(client, auth("U01"), location=TAIPEI_101)
    assert location_of(engine, "U01") is None
    assert not [event for event in events if event["type"] == "location"]


def test_a_denied_browser_is_recorded(client, auth, always, engine):
    ping(client, auth("U01"), location_denied=True)
    assert location_of(engine, "U01").denied is True


def test_a_managers_heartbeat_never_saves_a_location(client, auth, always, engine):
    ping(client, auth("M01"), location=TAIPEI_101)
    assert location_of(engine, "M01") is None


def test_an_impossible_location_is_rejected(client, auth):
    response = client.post("/api/presence/ping", json={"active": True, "location": {"lat": 121.5, "lng": 25.0}}, headers=auth("U01"))
    assert response.status_code == 422


def test_pause_and_resume(client, auth, always, events, engine):
    paused = client.post("/api/location/pause", headers=auth("U01"))
    assert paused.status_code == 200 and paused.json()["paused"] is True
    assert {"type": "location", "user_id": "U01"} in events
    ping(client, auth("U01"), location=TAIPEI_101)
    assert location_of(engine, "U01").lat is None
    resumed = client.post("/api/location/resume", headers=auth("U01"))
    assert resumed.json()["paused"] is False
    ping(client, auth("U01"), location=TAIPEI_101)
    assert location_of(engine, "U01").lat == 25.034
    denied = client.post("/api/location/pause", headers=auth("M01"))
    assert denied.status_code == 403 and denied.json()["detail"] == "只有業務會分享位置"


def test_my_share_state(client, auth):
    assert client.get("/api/location/me", headers=auth("U01")).json() == {
        "applies": True,
        "paused": False,
        "denied": False,
        "manager_name": "陳建宏",
        "hours": {"weekdays": [1, 2, 3, 4, 5], "start": "08:30", "end": "18:30"},
    }
    assert client.get("/api/location/me", headers=auth("M01")).json()["applies"] is False
    assert client.get("/api/location/me").status_code == 401


# WebSocket


def connect(ws, engine, user_id: str) -> None:
    from conftest import token_for

    ws.send_json({"type": "auth", "token": token_for(engine, user_id), "active": True})
    assert ws.receive_json() == {"type": "ready", "user_id": user_id}
    assert ws.receive_json()["type"] == "presence"


def next_of(ws, kind: str) -> dict:
    """略過別種事件（例如狀態），拿下一則這一種的。"""
    while True:
        event = ws.receive_json()
        if event["type"] == kind:
            return event


def test_location_events_reach_only_managers_who_can_see_the_rep(client, engine, auth, always):
    with client.websocket_connect("/api/ws") as north, client.websocket_connect("/api/ws") as south:
        connect(north, engine, "M01")
        connect(south, engine, "M03")
        ping(client, auth("U01"), location=TAIPEI_101)
        ping(client, auth("U04"), location={"lat": 22.69, "lng": 120.29})
        assert next_of(north, "location") == {"type": "location", "user_id": "U01"}
        # 林昱辰的先發，南區的主管卻先收到吳承翰的：林昱辰那一則沒有送給他
        assert next_of(south, "location") == {"type": "location", "user_id": "U04"}


def test_a_websocket_heartbeat_can_carry_the_location(client, engine, always):
    with client.websocket_connect("/api/ws") as rep:
        connect(rep, engine, "U01")
        # active 跟連上時不一樣，伺服器才不會當成 5 秒內重複的心跳略過
        rep.send_json({"type": "ping", "active": False, "location": {"lat": 25.034, "lng": 121.5645, "accuracy": 8}})
        row = None
        for _ in range(60):
            row = location_of(engine, "U01")
            if row is not None and row.lat is not None:
                break
            time.sleep(0.05)
        assert (row.lat, row.lng, row.accuracy_m) == (25.034, 121.5645, 8)
