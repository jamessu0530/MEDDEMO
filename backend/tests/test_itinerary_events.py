"""行程變了就在 commit 之後發 itinerary 事件，主管頁收到 3 秒後重拿。"""

import datetime as dt

import pytest
from fastapi.testclient import TestClient

from app import realtime
from app.main import app
from app.models import Visit
from app.services import itinerary as itineraries
from app.timeutil import TAIPEI


@pytest.fixture
def events(monkeypatch):
    sent = []
    monkeypatch.setattr(realtime, "publish", sent.append)
    return sent


def changed(events):
    return [event["user_id"] for event in events if event["type"] == "itinerary"]


def test_a_saved_change_is_announced_after_commit(tx, events):
    itinerary = itineraries.get_or_create(tx, "U02")
    tx.commit()
    events.clear()
    last = itineraries.view(tx, itinerary).stops[-1]
    itineraries.apply_feedback(tx, "U02", last.customer_id, "pin", itinerary.version)
    tx.flush()
    # 還沒 commit：別人還看不到這個改動，不能先通知
    assert changed(events) == []
    tx.commit()
    assert changed(events) == ["U02"]


def test_a_rolled_back_change_is_not_announced(tx, events):
    itinerary = itineraries.get_or_create(tx, "U02")
    tx.commit()
    events.clear()
    last = itineraries.view(tx, itinerary).stops[-1]
    itineraries.apply_feedback(tx, "U02", last.customer_id, "pin", itinerary.version)
    tx.flush()
    tx.rollback()
    tx.commit()
    assert changed(events) == []


def test_confirming_a_visit_is_announced_but_editing_it_later_is_not(tx, events):
    at = dt.datetime(2026, 10, 28, 9, 40, tzinfo=TAIPEI)
    visit = Visit(id="VEVENT1", customer_id="C001", user_id="U01", visited_at=at, transcript="測試", status="draft")
    tx.add(visit)
    tx.commit()
    assert changed(events) == []
    visit.confirmed_at, visit.status = at, "synced"
    tx.commit()
    assert changed(events) == ["U01"]
    events.clear()
    visit.transcript = "改過逐字稿"
    tx.commit()
    assert changed(events) == []


def test_resetting_the_demo_reps_itinerary_is_announced(tx, events, auth):
    client = TestClient(app)
    assert client.get("/api/itinerary/today", headers=auth("U01")).status_code == 200
    events.clear()
    assert client.post("/api/admin/demo-itinerary/reset", headers=auth("A01")).status_code == 200
    assert changed(events) == ["U01"]
