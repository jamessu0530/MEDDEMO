"""在線狀態與 WebSocket（services/presence.py、api/presence.py、app/realtime.py）。

狀態規則用固定的時間測純函式；成員與「N 人在線」跑在 tx fixture 的交易裡（conftest.py），測完回滾。
WebSocket 那幾個測試不能用 tx：連線在自己的 session 裡讀狀態，只看得到 commit 過的資料，
所以這個檔案每個測試前後都把 user_presence 清空。
"""

import datetime as dt
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session
from starlette.websockets import WebSocketDisconnect

from app.api import presence as presence_api
from app.main import app
from app.models import AppUser, Channel, UserPresence
from app.services import channels, presence

NOW = dt.datetime(2026, 10, 1, 9, 0, tzinfo=dt.UTC)
SECONDS = dt.timedelta(seconds=1)
MINUTES = dt.timedelta(minutes=1)
COMPANY = {"U01", "U02", "U03", "U04", "U05", "M01", "M02", "M03", "M04", "A01"}


@pytest.fixture(autouse=True)
def no_presence(engine):
    def clear():
        with engine.begin() as conn:
            conn.execute(delete(UserPresence))

    clear()
    yield
    clear()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.mark.parametrize(
    ("choice", "seen", "active", "expected"),
    [
        # 從沒連過、已登出
        (None, None, None, "offline"),
        # 正在用
        (None, NOW, NOW, "available"),
        (None, NOW - 10 * SECONDS, NOW - 40 * SECONDS, "available"),
        # 連著但閒置、畫面在背景
        (None, NOW - 10 * SECONDS, NOW - 50 * SECONDS, "away"),
        (None, NOW, None, "away"),
        # 斷線未滿 5 分鐘還是離開，超過就離線
        (None, NOW - 4 * MINUTES, NOW - 4 * MINUTES, "away"),
        (None, NOW - 6 * MINUTES, NOW - 6 * MINUTES, "offline"),
        # 手動狀態只在連著（或斷線 5 分鐘內）時顯示
        ("busy", NOW, None, "busy"),
        ("dnd", NOW - 4 * MINUTES, None, "dnd"),
        ("brb", NOW - 6 * MINUTES, None, "offline"),
        ("available", NOW - 10 * SECONDS, NOW - 3 * MINUTES, "available"),
        ("away", NOW, NOW, "away"),
        # 顯示為離線：連著也是離線
        ("offline", NOW, NOW, "offline"),
    ],
)
def test_display_status(choice, seen, active, expected):
    assert presence.display_status(choice, seen, active, NOW) == expected


def channel_info(session: Session, name: str) -> channels.ChannelInfo:
    rows = list(session.scalars(select(Channel).where(Channel.kind != "customer")))
    return next(info for info in channels.describe(session, rows) if info.name == name)


def member_ids(session: Session, name: str) -> set[str]:
    return {person.id for person, _ in presence.members(session, channel_info(session, name))}


def channel_id(client, auth, name: str) -> int:
    return next(c["id"] for c in client.get("/api/channels", headers=auth("A01")).json() if c["name"] == name)


def ping(client, headers, active: bool = True) -> dict:
    response = client.post("/api/presence/ping", json={"active": active}, headers=headers)
    assert response.status_code == 200
    return response.json()["statuses"]


def test_members_follow_the_org_position(engine):
    with Session(engine) as session:
        assert member_ids(session, "陳建宏小組") & COMPANY == {"M01", "U01", "U02"}
        # IT 看得到整區與各組的頻道，但只是全國頻道的成員
        assert member_ids(session, "北區") & COMPANY == {"M01", "U01", "U02"}
        assert member_ids(session, "台北市・大安區") & COMPANY == {"M01", "U01", "U02"}
        assert member_ids(session, "南區") & COMPANY == {"M03", "U04", "M04", "U05"}
        assert member_ids(session, "全國") & COMPANY == COMPANY


def test_a_self_created_account_is_a_member_where_the_demo_rep_is(tx, client):
    created = client.post(
        "/api/auth/register", json={"name": "評審", "email": "judge@presence.test", "password": "judge-pass-1"}
    ).json()
    assert created["user"]["id"] in member_ids(tx, "陳建宏小組")
    assert created["user"]["id"] not in member_ids(tx, "南區")


def test_members_api_lists_names_and_statuses(tx, client, auth):
    ping(client, auth("U02"))
    team = channel_id(client, auth, "陳建宏小組")
    response = client.get(f"/api/channels/{team}/members", headers=auth("U01"))
    assert response.status_code == 200
    listed = {m["id"]: (m["name"], m["status"]) for m in response.json()}
    assert listed == {"M01": ("陳建宏", "offline"), "U01": ("林昱辰", "offline"), "U02": ("王冠宇", "available")}
    # 看不到的頻道一樣 404
    assert client.get(f"/api/channels/{team}/members", headers=auth("U04")).status_code == 404


def test_the_owner_and_their_manager_are_members_of_a_moved_customers_thread(tx, client, auth):
    # IT 把北區的忠孝店交給南區的吳承翰（同 test_channels 的情境）
    client.put("/api/admin/customers/C001/owner", json={"owner_id": "U04"}, headers=auth("A01"))
    thread = client.post("/api/customers/C001/thread", headers=auth("U04")).json()
    ids = {m["id"] for m in client.get(f"/api/channels/{thread['id']}/members", headers=auth("U04")).json()}
    assert ids & COMPANY == {"M01", "U01", "U02", "U04", "M03"}


def test_an_archived_team_channel_has_no_members(tx, client, auth):
    it = auth("A01")
    team = channel_id(client, auth, "蔡宗翰小組")
    client.put("/api/admin/users/U05/manager", json={"manager_id": "M03"}, headers=it)
    client.put("/api/admin/users/M04/role", json={"role": "sales", "manager_id": "M03"}, headers=it)
    assert client.get(f"/api/channels/{team}/members", headers=it).json() == []


def test_online_counts_skip_me_and_anyone_offline(tx, client, auth):
    for user_id in ("U01", "U02", "M01", "U04"):
        ping(client, auth(user_id))
    client.put("/api/presence/me", json={"choice": "offline"}, headers=auth("M01"))

    def online(user_id: str) -> dict[str, int]:
        return {c["name"]: c["online"] for c in client.get("/api/channels", headers=auth(user_id)).json()}

    mine = online("U01")
    # 陳建宏顯示為離線，不算；自己不算
    assert mine["陳建宏小組"] == 1
    assert mine["北區"] == 1
    assert mine["全國"] == 2
    assert mine["台北市・大安區"] == 1
    assert online("A01")["全國"] == 3


def test_appear_offline_looks_offline_to_others_but_not_to_me(tx, client, auth):
    ping(client, auth("U02"))
    chosen = client.put("/api/presence/me", json={"choice": "offline"}, headers=auth("U02"))
    assert chosen.json() == {"choice": "offline", "status": "offline"}
    assert "U02" not in ping(client, auth("U01"))
    team = channel_id(client, auth, "陳建宏小組")
    statuses = {m["id"]: m["status"] for m in client.get(f"/api/channels/{team}/members", headers=auth("U01")).json()}
    assert statuses["U02"] == "offline"
    # 重設狀態回到自動
    reset = client.put("/api/presence/me", json={"choice": None}, headers=auth("U02"))
    assert reset.json() == {"choice": None, "status": "available"}


def test_signing_out_goes_offline_at_once(tx, client, auth):
    headers = auth("U02")
    ping(client, headers)
    client.put("/api/presence/me", json={"choice": "busy"}, headers=headers)
    assert ping(client, auth("U01"))["U02"] == "busy"
    assert client.post("/api/auth/logout", headers=headers).status_code == 204
    assert "U02" not in ping(client, auth("U01"))
    # 手動選的狀態留著，下次登入照舊
    assert tx.get(UserPresence, "U02").choice == "busy"


def test_a_heartbeat_checked_just_before_signing_out_does_not_revive_the_account(tx):
    # 心跳剛驗過 token，登出就在這時 commit（版號加一）：記心跳時要看到新的版號，不能又記成在線
    user = tx.get(AppUser, "U02")
    # synchronize_session=False：手上這個 user 還是舊的版號，跟實際的情況一樣
    tx.execute(
        update(AppUser).where(AppUser.id == "U02").values(session_version=AppUser.session_version + 1),
        execution_options={"synchronize_session": False},
    )
    with pytest.raises(presence.SignedOut):
        presence.touch(tx, user, active=True)
    assert "U02" not in presence.statuses(tx)


def test_deactivated_accounts_are_offline(tx, client, auth):
    ping(client, auth("U02"))
    tx.get(AppUser, "U02").deactivated_at = presence.now()
    tx.flush()
    assert "U02" not in presence.statuses(tx)


def test_an_unknown_choice_is_rejected(client, auth):
    assert client.put("/api/presence/me", json={"choice": "sleeping"}, headers=auth("U01")).status_code == 422


# WebSocket


def connect(ws, engine, user_id: str, active: bool = True) -> dict:
    """送 token、等 ready，回傳第一則完整狀態。"""
    from conftest import token_for

    ws.send_json({"type": "auth", "token": token_for(engine, user_id), "active": active})
    assert ws.receive_json() == {"type": "ready", "user_id": user_id}
    snapshot = ws.receive_json()
    assert snapshot["type"] == "presence" and snapshot["full"] is True
    return snapshot["statuses"]


def next_of(ws, kind: str) -> dict:
    """略過別種事件（例如別人上線的狀態），拿下一則這一種的。"""
    while True:
        event = ws.receive_json()
        if event["type"] == kind:
            return event


def test_the_socket_needs_a_valid_token(client):
    with client.websocket_connect("/api/ws") as ws:
        ws.send_json({"type": "auth", "token": "not-a-token"})
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
    assert closed.value.code == 4401


def test_connecting_shows_me_available_and_others_see_status_changes(client, engine, auth):
    with client.websocket_connect("/api/ws") as ws:
        assert connect(ws, engine, "U01") == {"U01": "available"}
        ping(client, auth("M01"))
        assert next_of(ws, "presence") == {"type": "presence", "full": False, "statuses": {"M01": "available"}}
        client.put("/api/presence/me", json={"choice": "busy"}, headers=auth("M01"))
        assert next_of(ws, "presence")["statuses"] == {"M01": "busy"}
        client.put("/api/presence/me", json={"choice": "offline"}, headers=auth("M01"))
        assert next_of(ws, "presence")["statuses"] == {"M01": "offline"}


def test_new_messages_reach_only_people_who_can_see_the_channel(tx, client, engine, auth):
    north = channel_id(client, auth, "陳建宏小組")
    south = channel_id(client, auth, "許文彬小組")
    with client.websocket_connect("/api/ws") as u01, client.websocket_connect("/api/ws") as u04:
        connect(u01, engine, "U01")
        connect(u04, engine, "U04")
        assert client.post(f"/api/channels/{north}/messages", json={"body": "忠孝店到貨了"}, headers=auth("M01")).status_code == 201
        assert client.post(f"/api/channels/{south}/messages", json={"body": "高雄這週加訂"}, headers=auth("M03")).status_code == 201
        assert next_of(u01, "message") == {"type": "message", "channel_id": north}
        # 北區的先發，吳承翰卻先收到南區的：北區那則沒有送給他
        assert next_of(u04, "message") == {"type": "message", "channel_id": south}


def test_signing_out_closes_the_socket_on_its_next_ping(client, engine):
    from conftest import token_for

    token = token_for(engine, "U02")
    with client.websocket_connect("/api/ws") as ws:
        ws.send_json({"type": "auth", "token": token, "active": True})
        assert ws.receive_json()["type"] == "ready"
        assert client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"}).status_code == 204
        ws.send_json({"type": "ping", "active": False})
        with pytest.raises(WebSocketDisconnect) as closed:
            while True:
                ws.receive_json()
    assert closed.value.code == 4401


def test_a_socket_that_stops_pinging_is_closed(client, engine, monkeypatch):
    # 凍結的分頁不再送心跳，也就不會再驗 token：太久沒心跳就關掉，登出之後不能還一直收到通知
    monkeypatch.setattr(presence_api, "SWEEP_SECONDS", 0.05)
    monkeypatch.setattr(presence_api, "PING_TIMEOUT_SECONDS", 0.1)
    with client.websocket_connect("/api/ws") as ws:
        connect(ws, engine, "U01")
        with pytest.raises(WebSocketDisconnect) as closed:
            while True:
                ws.receive_json()
    assert closed.value.code == 4408


# WebSocket 不能讓每條連線、每個事件都各查一次資料庫：50 個人同時發言時會跟發言的請求搶 threadpool 與連線池，
# 整個 API 卡死（docs/superpowers/specs/2026-10-01-channel-rail-design.md「壓力測試」）


async def test_status_requests_after_the_same_event_share_one_query(monkeypatch):
    import asyncio

    calls = 0

    def slow_statuses():
        nonlocal calls
        calls += 1
        time.sleep(0.05)
        return {"U01": "available"}

    monkeypatch.setattr(presence_api, "_statuses", slow_statuses)
    cache = presence_api._StatusCache()
    since = time.monotonic()
    results = await asyncio.gather(*(cache.get(since) for _ in range(50)))
    assert calls == 1 and all(r == {"U01": "available"} for r in results)
    # 事件之後才開始算的那一份可以共用；比它晚的事件要重算，才看得到新的變動
    await cache.get(since)
    assert calls == 1
    await cache.get(time.monotonic())
    assert calls == 2


async def test_a_failed_status_query_is_not_shared_afterwards(monkeypatch):
    attempts = iter([RuntimeError("資料庫斷了"), {"U01": "busy"}])

    def flaky():
        result = next(attempts)
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(presence_api, "_statuses", flaky)
    cache = presence_api._StatusCache()
    since = time.monotonic()
    with pytest.raises(RuntimeError):
        await cache.get(since)
    assert await cache.get(since) == {"U01": "busy"}


def test_message_notifications_do_not_query_the_database_per_message(tx, client, engine, auth, monkeypatch):
    north = channel_id(client, auth, "陳建宏小組")
    checks = []
    original = presence_api._can_see
    monkeypatch.setattr(presence_api, "_can_see", lambda *args: checks.append(args) or original(*args))
    with client.websocket_connect("/api/ws") as ws:
        connect(ws, engine, "U01")
        for body in ("一", "二", "三"):
            assert client.post(f"/api/channels/{north}/messages", json={"body": body}, headers=auth("M01")).status_code == 201
            assert next_of(ws, "message") == {"type": "message", "channel_id": north}
    # 看得到哪些頻道是連上時一次算好的，三則訊息都不必再查
    assert checks == []


def test_a_channel_opened_after_connecting_still_notifies(client, engine, auth):
    # 不能用 tx：連線在自己的 session 裡查新頻道，只看得到 commit 過的。測完刪掉開的頻道（訊息跟著 CASCADE）
    north_region = channel_id(client, auth, "北區")
    south_region = channel_id(client, auth, "南區")
    opened = []
    try:
        with client.websocket_connect("/api/ws") as u01, client.websocket_connect("/api/ws") as u04:
            connect(u01, engine, "U01")
            connect(u04, engine, "U04")
            for manager, parent, name in (("M01", north_region, "陳列競賽"), ("M03", south_region, "左營檔期")):
                created = client.post("/api/channels", json={"parent_id": parent, "name": name}, headers=auth(manager))
                assert created.status_code == 201
                opened.append(created.json()["id"])
            north_topic, south_topic = opened
            client.post(f"/api/channels/{north_topic}/messages", json={"body": "北區開跑"}, headers=auth("M01"))
            client.post(f"/api/channels/{south_topic}/messages", json={"body": "南區開跑"}, headers=auth("M03"))
            assert next_of(u01, "message") == {"type": "message", "channel_id": north_topic}
            # 北區的先發，吳承翰卻先收到南區的：連上之後才開的北區頻道，一樣不會通知看不到的人
            assert next_of(u04, "message") == {"type": "message", "channel_id": south_topic}
    finally:
        with engine.begin() as conn:
            conn.execute(delete(Channel).where(Channel.id.in_(opened)))


def test_the_pool_has_room_for_every_threadpool_worker():
    import anyio.to_thread

    from app.db import MAX_OVERFLOW, POOL_SIZE, make_engine

    async def threads() -> int:
        return int(anyio.to_thread.current_default_thread_limiter().total_tokens)

    engine = make_engine()
    try:
        assert (engine.pool.size(), engine.pool._max_overflow) == (POOL_SIZE, MAX_OVERFLOW)
    finally:
        engine.dispose()
    # 請求在換執行緒之間會拿著連線：連線池比執行緒少就可能互卡
    assert POOL_SIZE + MAX_OVERFLOW > anyio.run(threads)
