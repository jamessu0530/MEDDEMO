"""第六週：用量上限。每個來源每小時、全系統每天各有上限，只算真的有做事的請求。"""

import pytest
from fastapi.testclient import TestClient
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import text

from app import usage
from app.main import app
from app.tasks import redis


@pytest.fixture
def client(engine, monkeypatch):
    # 上限調小才測得到；計數先清掉，不受其他測試送過的請求影響
    monkeypatch.setitem(usage.LIMITS, "ask", usage.Limit("提問", per_client_hour=2, per_day=3))
    redis().flushdb()
    yield TestClient(app)
    redis().flushdb()
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM ask_record WHERE question LIKE '測試：%'"))


def ask(client, auth, user_id, question="測試：這個月魚油賣了幾盒", ip="198.51.100.1"):
    # 全部從同一個 IP 送：決賽現場大家連同一個 Wi-Fi，有登入就要按帳號分開算
    headers = {**auth(user_id), "CF-Connecting-IP": ip}
    return client.post("/api/asks", json={"kind": "data", "question": question}, headers=headers)


def test_one_account_is_limited_per_hour_but_others_on_the_same_wifi_can_still_ask(client, auth):
    assert ask(client, auth, "U01").status_code == 202
    assert ask(client, auth, "U01").status_code == 202
    blocked = ask(client, auth, "U01")
    assert blocked.status_code == 429
    assert "這一小時" in blocked.json()["detail"]
    assert 0 < int(blocked.headers["Retry-After"]) <= 3600
    assert ask(client, auth, "U02").status_code == 202


def test_the_whole_system_stops_at_the_daily_limit(client, auth):
    for user_id in ("U01", "U02", "U03"):
        assert ask(client, auth, user_id).status_code == 202
    blocked = ask(client, auth, "U04")
    assert blocked.status_code == 429
    assert "今天全系統" in blocked.json()["detail"]


def test_rejected_requests_do_not_use_up_the_limit(client, auth):
    for _ in range(5):
        empty = client.post("/api/asks", json={"kind": "data", "question": ""}, headers=auth("U01"))
        assert empty.status_code == 422
    # 沒登入被擋下的也不算
    for _ in range(5):
        assert client.post("/api/asks", json={"kind": "data", "question": "測試：x"}).status_code == 401
    assert ask(client, auth, "U01").status_code == 202


def test_reading_is_never_limited(client, auth):
    created = ask(client, auth, "U01").json()
    for _ in range(5):
        assert client.get(f"/api/asks/{created['id']}", headers=auth("U01")).status_code == 200


def test_requests_still_go_through_when_redis_is_down(client, auth, monkeypatch):
    def down(*counters):
        raise RedisConnectionError("測試：Redis 停了")

    monkeypatch.setattr(usage, "_take", down)
    assert ask(client, auth, "U01").status_code == 202


@pytest.mark.parametrize(
    ("method", "path", "bucket"),
    [
        ("POST", "/api/asks", "ask"),
        ("POST", "/api/voice/session", "voice"),
        ("POST", "/api/transcription/session", "transcription"),
        ("POST", "/api/visits/audio", "visit"),
        ("POST", "/api/visits/V00001/transcript", "visit"),
        ("POST", "/api/visits/V00001/reprocess", "visit"),
        ("GET", "/api/asks/abc", None),
        ("POST", "/api/asks/abc/escalate", None),
        ("POST", "/api/visits/V00001/confirm", None),
        ("POST", "/api/escalations/1/reply", None),
    ],
)
def test_every_route_that_calls_gemini_is_counted(method, path, bucket):
    assert usage.bucket_for(method, path) == bucket
