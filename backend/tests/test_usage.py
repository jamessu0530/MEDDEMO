"""外部 API 不設用量額度；非付費操作只保留每小時防洗版限制。"""

import datetime as dt

import pytest
from fastapi.testclient import TestClient
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import text

from app import usage
from app.main import app
from app.tasks import redis


@pytest.fixture
def client(engine):
    redis().flushdb()
    yield TestClient(app)
    redis().flushdb()
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM ask_record WHERE question LIKE '測試：%'"))


def ask(client, auth, user_id="U01"):
    return client.post(
        "/api/asks", json={"kind": "data", "question": "測試：這個月魚油賣了幾盒"},
        headers={**auth(user_id), "CF-Connecting-IP": "198.51.100.1"},
    )


def test_ai_requests_ignore_exhausted_legacy_hourly_and_daily_counters(client, auth, monkeypatch):
    now = dt.datetime.now(usage.TAIPEI)
    old = {
        f"usage:ask:user:U01:{now:%Y%m%d%H}": 500,
        f"usage:ask:all:{now:%Y%m%d}": 2000,
        f"usage:attachment:all:{now:%Y%m%d}": 5000,
    }
    redis().mset(old)

    def unexpected_count(*items):
        raise AssertionError("AI 請求不應讀寫用量計數器")

    monkeypatch.setattr(usage, "_take", unexpected_count)
    for user_id in ("U01", "U01", "U02"):
        response = ask(client, auth, user_id)
        assert response.status_code == 202
        assert "Retry-After" not in response.headers
    assert {key: int(redis().get(key)) for key in old} == old


def test_ai_requests_still_require_login_and_valid_input(client, auth):
    assert client.post("/api/asks", json={"kind": "data", "question": "測試：x"}).status_code == 401
    assert client.post("/api/asks", json={"kind": "data", "question": ""}, headers=auth()).status_code == 422


@pytest.mark.parametrize("path", [
    "/api/asks", "/api/asks/route", "/api/voice/session", "/api/transcription/session",
    "/api/visits/audio", "/api/visits/V00001/transcript", "/api/visits/V00001/reprocess",
    "/api/channels/search", "/api/itinerary/today/ask", "/api/reports/adjust",
    "/api/reports/datasets/123/analyze", "/api/manager/customer-priority/advice",
])
def test_external_api_endpoints_have_no_usage_limit(path):
    assert usage.buckets_for("POST", path) == []


def test_attachments_do_not_add_a_separate_usage_limit():
    assert usage.buckets_for("POST", "/api/asks") == []
    assert usage.buckets_for("POST", "/api/channels/1/messages") == ["channel_post"]


@pytest.mark.parametrize("bucket", ["register", "channel_post", "avatar"])
def test_non_api_protection_has_only_a_client_hourly_counter(bucket):
    now = dt.datetime(2026, 10, 17, 15, 59, tzinfo=usage.TAIPEI)
    counter, = usage.counters(bucket, "user:U01", now)
    assert counter.key == f"usage:{bucket}:user:U01:2026101715"
    assert counter.resets_at == dt.datetime(2026, 10, 17, 16, tzinfo=usage.TAIPEI)


def channel_post(client, auth, user_id="U01", body="測試：訊息"):
    headers = {**auth(user_id), "CF-Connecting-IP": "198.51.100.1"}
    national = next(c["id"] for c in client.get("/api/channels", headers=headers).json() if c["kind"] == "national")
    return client.post(f"/api/channels/{national}/messages", json={"body": body}, headers=headers)


def test_channel_hourly_protection_does_not_share_a_daily_or_wifi_limit(client, auth, tx, monkeypatch):
    monkeypatch.setitem(usage.LIMITS, "channel_post", usage.Limit("頻道發言", per_client_hour=2))
    now = dt.datetime.now(usage.TAIPEI)
    redis().set(f"usage:channel_post:all:{now:%Y%m%d}", 10000)
    assert channel_post(client, auth).status_code == 201
    assert channel_post(client, auth).status_code == 201
    blocked = channel_post(client, auth)
    assert blocked.status_code == 429
    assert "這一小時" in blocked.json()["detail"]
    assert 0 < int(blocked.headers["Retry-After"]) <= 3600
    assert channel_post(client, auth, "U02").status_code == 201


def test_rejected_messages_do_not_use_up_hourly_protection(client, auth, tx, monkeypatch):
    monkeypatch.setitem(usage.LIMITS, "channel_post", usage.Limit("頻道發言", per_client_hour=1))
    for _ in range(3):
        assert channel_post(client, auth, body="").status_code == 422
    assert channel_post(client, auth).status_code == 201


def test_hourly_protection_allows_requests_when_redis_is_down(client, auth, tx, monkeypatch):
    def down(*items):
        raise RedisConnectionError("測試：Redis 停了")

    monkeypatch.setattr(usage, "_take", down)
    assert channel_post(client, auth).status_code == 201
