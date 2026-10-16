from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def event(kind="dwell", sku="HS-FO30", active_ms=5000):
    return {"id": str(uuid4()), "sku": sku, "kind": kind, "active_ms": active_ms}


def test_browsing_requires_an_account(client):
    assert client.get("/api/products/browse-profile").status_code == 401
    assert client.post("/api/products/browse-events", json={"events": [event()]}).status_code == 401


def test_actual_users_have_separate_preferences(tx, client, auth):
    mine, other = auth("U02"), auth("U03")
    assert client.get("/api/products/browse-profile", headers=mine).json() == {}
    result = client.post("/api/products/browse-events", headers=mine, json={"events": [event(), event("detail", active_ms=0)]})
    assert result.status_code == 200
    assert result.json()["HS-FO30"]["active_ms"] == 5000
    assert result.json()["HS-FO30"]["opens"] == 1
    assert client.get("/api/products/browse-profile", headers=other).json() == {}
    assert client.get("/api/products/browse-profile", headers=mine).json() == result.json()


def test_retries_and_unknown_skus_do_not_train_twice(tx, client, auth):
    headers = auth("U02")
    sample = event()
    body = {"events": [sample, sample, event(sku="not-a-product")]}
    for _ in range(2):
        result = client.post("/api/products/browse-events", headers=headers, json=body)
        assert result.status_code == 200
        assert set(result.json()) == {"HS-FO30"}
        assert result.json()["HS-FO30"]["active_ms"] == 5000


@pytest.mark.parametrize("bad", [{"active_ms": -1}, {"active_ms": 60001}, {"kind": "swipe_left"}, {"kind": "swipe_right"}])
def test_unbounded_time_and_swipe_dislike_labels_are_rejected(tx, client, auth, bad):
    result = client.post("/api/products/browse-events", headers=auth("U02"), json={"events": [event() | bad]})
    assert result.status_code == 422
