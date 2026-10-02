"""在線狀態 API 與 WebSocket（docs/superpowers/specs/2026-10-01-presence-design.md）。

一條 WebSocket（/api/ws）送幾件事：有人的狀態變了、看得到的頻道有新訊息，以及（主管與 IT）看得到的業務的位置或
今天的行程變了。業務的心跳順便帶位置（services/locations.py）。
訊息本身不經過 WebSocket，手機收到通知再用原本的 API 拿，權限檢查與訊息格式只有一份。
每條連線自己訂閱 Redis 的事件頻道（app/realtime.py），連線斷了訂閱跟著結束，不另外開背景程序。
連不上 WebSocket 的時候（公司網路擋掉之類），手機改用 POST /api/presence/ping 心跳。

同一個事件會送到每一條連線：每條連線各查一次資料庫，連線一多就跟發言的請求搶 threadpool 與連線池，
所以看得到哪些頻道記在連線上、大家的狀態同一個程序裡共用一份（_StatusCache）。
"""

import asyncio
import contextlib
import json
import math
import random
import time
from collections import Counter
from typing import Annotated, Literal, NamedTuple

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app import realtime
from app.api.auth import MANAGER_SIDE_ROLES, CurrentUser
from app.config import settings
from app.db import get_session, session_factory
from app.models import AppUser
from app.services import auth, channels, locations, presence, team_itineraries

router = APIRouter(tags=["presence"])
SessionDep = Annotated[Session, Depends(get_session)]

Status = Literal["available", "busy", "dnd", "brb", "away", "offline"]

# 連上後要在這麼久之內送 token
AUTH_TIMEOUT_SECONDS = 10
# 時間到了才變的狀態（離開 → 離線）不發事件，每條連線隔這麼久自己重算一次
SWEEP_SECONDS = 10
# 手機 20 秒送一次心跳；比這個密的不寫資料庫（active 變了的除外）
MIN_PING_SECONDS = 5
# 這麼久沒有心跳就關掉連線：凍結的分頁不會再驗 token，登出之後不能還一直收到通知。
# 背景分頁的計時器最慢一分鐘跑一次，留一點餘裕
PING_TIMEOUT_SECONDS = 90
# 同一個帳號在同一台 API 最多幾條連線：自建帳號誰都能開，不能讓一個人無限開
MAX_CONNECTIONS = 5
# 每條連線記住自己看得到哪些頻道，隔這麼久（再乘上 1～1.5 倍，讓同時連上的連線錯開）重算一次。
# 組織異動（調區、換主管、降職、客戶換人）會發 channels 事件，收到就作廢、下一則訊息時重算，不必等到過期；
# 定時重算是漏接事件時的保險。這段時間內新出現的頻道（剛開的文字頻道、第一次有人打開的客戶討論串）
# 第一次有訊息時單獨查一次
VISIBLE_TTL_SECONDS = 60
# 定時重算狀態時，別條連線這麼近才算好的那一份可以直接用
SWEEP_SHARE_SECONDS = 1.0
# 每條連線記住看不看得到某位業務的位置與行程事件：位置事件很密，不必每一則都查資料庫。
# IT 改了組織會發 channels 事件，收到就作廢、下一則位置事件時重查；隔這麼久重查是漏接事件時的保險
SEE_REP_CACHE_SECONDS = 300

# 關閉碼：4000～4999 給應用程式自己用
CLOSE_UNAUTHORIZED = 4401
# 連上後沒送 token，或太久沒有心跳。手機照一般斷線重連
CLOSE_TIMEOUT = 4408
CLOSE_TOO_MANY = 4429

_connections: Counter[str] = Counter()


class PresenceMe(BaseModel):
    # 自己選的，None 是自動
    choice: Status | None
    # 別人看到的
    status: Status


class ChoiceInput(BaseModel):
    choice: Status | None


class LocationInput(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    # 誤差幾公尺（瀏覽器的 coords.accuracy）
    accuracy: float | None = Field(default=None, ge=0)


class PingInput(BaseModel):
    active: bool
    # 業務的手機在上班時間多帶目前的位置；瀏覽器拒絕定位時改帶 location_denied（services/locations.py）
    location: LocationInput | None = None
    location_denied: bool = False


class Statuses(BaseModel):
    # 不是離線的人；不在裡面的就是離線
    statuses: dict[str, Status]


def _me(session: Session, user: AppUser) -> PresenceMe:
    choice, shown = presence.mine(session, user)
    return PresenceMe(choice=choice, status=shown)


@router.get("/api/presence/me", response_model=PresenceMe)
def get_mine(session: SessionDep, user: CurrentUser):
    return _me(session, user)


@router.put("/api/presence/me", response_model=PresenceMe)
def set_mine(session: SessionDep, user: CurrentUser, body: ChoiceInput):
    """手動選狀態；choice 是 null 就重設回自動。"""
    presence.choose(session, user, body.choice)
    session.commit()
    realtime.presence_changed()
    return _me(session, user)


@router.post("/api/presence/ping", response_model=Statuses)
def ping(session: SessionDep, user: CurrentUser, body: PingInput):
    """WebSocket 連不上時的心跳，順便回全部的狀態。業務的心跳多帶位置。"""
    try:
        changed = presence.touch(session, user, body.active)
    except presence.SignedOut:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "請重新登入") from None
    position = (body.location.lat, body.location.lng, body.location.accuracy) if body.location else None
    rep_id = locations.report(session, user, position, body.location_denied)
    session.commit()
    if changed:
        realtime.presence_changed()
    if rep_id:
        realtime.location_changed(rep_id)
    return Statuses(statuses=presence.statuses(session))


# 以下在 threadpool 裡跑：資料庫是同步的，每次開一個短的 session，不讓一條長連線佔住一個資料庫連線


def _heartbeat(
    token: str, active: bool, position: tuple[float, float, float | None] | None = None, denied: bool = False
) -> str | None:
    """驗 token 並記一次心跳（業務的心跳順便記位置），回傳帳號；token 不對（過期、登出、被別的裝置頂掉、停用）回 None。"""
    with session_factory()() as session:
        try:
            user = auth.user_from_token(session, token)
        except auth.AuthError:
            return None
        user_id = user.id
        try:
            changed = presence.touch(session, user, active)
        except presence.SignedOut:
            return None
        rep_id = locations.report(session, user, position, denied)
        session.commit()
    if changed:
        realtime.presence_changed()
    if rep_id:
        realtime.location_changed(rep_id)
    return user_id


def _statuses() -> dict[str, str]:
    with session_factory()() as session:
        return presence.statuses(session)


def _can_see(user_id: str, channel_id: int) -> bool:
    with session_factory()() as session:
        user = session.get(AppUser, user_id)
        if user is None or user.deactivated_at is not None:
            return False
        try:
            channels.get_channel(session, user, channel_id)
        except channels.NotFound:
            return False
        return True


def _visible_ids(user_id: str) -> frozenset[int]:
    """這個人看得到的頻道編號；帳號不在或停用是空的。"""
    with session_factory()() as session:
        user = session.get(AppUser, user_id)
        if user is None or user.deactivated_at is not None:
            return frozenset()
        return frozenset(channels.visible_ids(session, user))


def _event_time(event: dict) -> float:
    """狀態事件發出的時間（app/realtime.py 的 at）。舊版 API 發的事件沒有（部署換版的那一下），當作現在。"""
    at = event.get("at")
    return float(at) if isinstance(at, int | float) else time.time()


class _SharedStatuses(NamedTuple):
    loop: asyncio.AbstractEventLoop
    # 開始算的時間（time.time()）
    started: float
    task: asyncio.Task[dict[str, str]]


class _StatusCache:
    """大家的狀態，同一個程序裡的連線共用。一則狀態事件會叫醒每一條連線，每條各查一次資料庫的話，
    50 條連線就是 50 次，跟發言的請求搶 threadpool 與連線池（docs/superpowers/specs/2026-10-01-channel-rail-design.md）。

    get(since)：since 之後才開始算的那一份（算好的或正在算的）直接共用，不然才重算。
    事件的 since 是事件裡的 at：發事件的那一邊 commit 之後才取的時間，之後才開始算的一定看得到那次變動。
    同一則事件的每條連線拿到同一個 at，第一條開始算的那一份其他條都能共用；
    不能用各自收到事件的時間：連線一條接一條跑，後面的那條收到的時間一定比前面那條開始算的晚，又會各查一次。
    比的是 time.time()，不同程序之間也對得上（狀態事件目前都是 API 自己發的，同一台機器）。
    算失敗的那一份不共用，下一個人重算。

    不同的 event loop 各算各的：正式環境只有一條；測試裡每條沒包在 with TestClient 裡的 WebSocket 各有一條，
    各在自己的執行緒。所以 loop、開始的時間與那一份查詢放在同一個 tuple，一次讀進來、一次寫回去：
    兩條 loop 同時來要時，不會拼出「這條的 loop、那條的查詢」，去 await 別條 loop 的查詢。"""

    def __init__(self) -> None:
        self._shared: _SharedStatuses | None = None

    async def get(self, since: float) -> dict[str, str]:
        loop = asyncio.get_running_loop()
        shared = self._shared
        if (
            shared is None
            or shared.loop is not loop
            or shared.started < since
            or (shared.task.done() and (shared.task.cancelled() or shared.task.exception() is not None))
        ):
            started = time.time()
            shared = _SharedStatuses(loop, started, loop.create_task(run_in_threadpool(_statuses)))
            self._shared = shared
        # shield：等的那條連線斷了被取消，不能把大家共用的那一份一起取消
        return await asyncio.shield(shared.task)


_status_cache = _StatusCache()


def _can_see_rep(viewer_id: str, rep_id: str) -> bool:
    """這條連線的人看不看得到這位業務的位置與行程：主管看自己底下的人、IT 看全公司（跟主管端同一個範圍）。"""
    with session_factory()() as session:
        viewer = session.get(AppUser, viewer_id)
        if viewer is None or viewer.deactivated_at is not None or viewer.role not in MANAGER_SIDE_ROLES:
            return False
        return team_itineraries.find_rep(session, viewer, rep_id) is not None


def _position(value: object) -> tuple[float, float, float | None] | None:
    """WebSocket 心跳帶來的位置；格式不對就當作沒帶（跟 HTTP 心跳用同一個 LocationInput 驗）。"""
    if not isinstance(value, dict):
        return None
    try:
        parsed = LocationInput.model_validate(value)
    except ValidationError:
        return None
    return parsed.lat, parsed.lng, parsed.accuracy


class _Connection:
    def __init__(self, ws: WebSocket, user_id: str, token: str, active: bool):
        self.ws = ws
        self.user_id = user_id
        self.token = token
        self.active = active
        self.last_ping = time.monotonic()
        # 上次送給這支手機的狀態，只送有變的
        self.sent: dict[str, str] = {}
        # 三個工作會同時送訊息，一次只讓一個送；關掉之後誰都不再送
        self.lock = asyncio.Lock()
        self.closed = False
        # 狀態事件與每 10 秒的重算可能同時進來：讀、比對、送整段一次只跑一個，
        # 不然比較舊的那份晚讀完，會蓋掉比較新的
        self.presence_lock = asyncio.Lock()
        # 看得到的頻道：連上時算一次，收到 channels 事件或隔一陣子重算；中間出現的新頻道第一次有訊息時單獨查一次並記住
        self.visible: frozenset[int] = frozenset()
        self.hidden: set[int] = set()
        self.visible_at = -math.inf
        self.visible_ttl = VISIBLE_TTL_SECONDS * random.uniform(1, 1.5)
        # 看不看得到某位業務：{業務 id: (看得到嗎, 查的時間)}
        self.reps_seen: dict[str, tuple[bool, float]] = {}

    async def send(self, payload: dict) -> None:
        async with self.lock:
            if not self.closed:
                await self.ws.send_json(payload)

    async def close(self, code: int) -> None:
        async with self.lock:
            if not self.closed:
                self.closed = True
                await self.ws.close(code)

    async def can_see_rep(self, rep_id: str) -> bool:
        cached = self.reps_seen.get(rep_id)
        if cached and time.monotonic() - cached[1] < SEE_REP_CACHE_SECONDS:
            return cached[0]
        allowed = await run_in_threadpool(_can_see_rep, self.user_id, rep_id)
        self.reps_seen[rep_id] = (allowed, time.monotonic())
        return allowed

    async def send_presence(self, since: float, full: bool = False) -> None:
        async with self.presence_lock:
            current = await _status_cache.get(since)
            if full:
                changes = current
            else:
                changes = {uid: s for uid, s in current.items() if self.sent.get(uid) != s}
                changes |= {uid: "offline" for uid in self.sent if uid not in current}
            self.sent = current
            if full or changes:
                await self.send({"type": "presence", "full": full, "statuses": changes})

    async def refresh_visible(self) -> None:
        """重算這個人看得到的頻道。連上時算一次，之後作廢或過期了（visible_ttl）由 can_see 重算。"""
        self.visible = await run_in_threadpool(_visible_ids, self.user_id)
        self.hidden = set()
        self.visible_at = time.monotonic()

    async def can_see(self, channel_id: int) -> bool:
        """新訊息通知要不要送給這條連線。看得到的頻道記在連線上，不必每則訊息都查資料庫。"""
        if time.monotonic() - self.visible_at > self.visible_ttl:
            await self.refresh_visible()
        if channel_id in self.visible:
            return True
        if channel_id in self.hidden:
            return False
        # 連上之後才出現的頻道：查一次，結果記下來
        if await run_in_threadpool(_can_see, self.user_id, channel_id):
            self.visible = self.visible | {channel_id}
            return True
        self.hidden.add(channel_id)
        return False

    async def read(self) -> None:
        """手機送來的心跳。token 驗不過就關掉連線：登出、改密碼、被別的裝置頂掉的那條連線不能繼續收通知。"""
        while True:
            try:
                data = json.loads(await self.ws.receive_text())
            except (ValueError, KeyError):
                # 不是 JSON，或送的是二進位（receive_text 拿不到 text 會丟 KeyError）：當作沒收到
                continue
            if not isinstance(data, dict) or data.get("type") != "ping":
                continue
            active = bool(data.get("active"))
            # active 沒變、5 秒內不寫資料庫：但這則帶了位置或「沒有權限」就不能略過，
            # 不然剛連上線那幾秒送的位置會被當成跟連線當下的心跳重複，直接丟掉
            carries_location = "location" in data or "location_denied" in data
            if active == self.active and not carries_location and time.monotonic() - self.last_ping < MIN_PING_SECONDS:
                continue
            self.active = active
            self.last_ping = time.monotonic()
            position = _position(data.get("location"))
            denied = data.get("location_denied") is True
            if await run_in_threadpool(_heartbeat, self.token, active, position, denied) is None:
                await self.close(CLOSE_UNAUTHORIZED)
                return

    async def listen(self, pubsub: aioredis.client.PubSub) -> None:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            event = json.loads(message["data"])
            if event.get("type") == "presence":
                await self.send_presence(_event_time(event))
            elif event.get("type") == "avatars":
                await self.send({"type": "avatars"})
            elif event.get("type") == "channels":
                # 開了頻道或改了組織，看得到的頻道可能變了：記下的作廢，下一則訊息時才重算
                # （這裡不查：每條連線同時去查，又會跟發言的請求搶 threadpool 與連線池）
                self.visible_at = -math.inf
                # 改了組織，主管看得到哪些業務也可能變了：記下的一起作廢，下一則位置或行程事件時才重查
                self.reps_seen.clear()
                # 不帶內容：收到的人重新載入自己看得到的頻道列表，看不到的頻道不會因此透露
                await self.send({"type": "channels"})
            elif event.get("type") == "message":
                channel_id = int(event["channel_id"])
                # 只通知看得到的人：看不到的頻道連「有新訊息」都不能透露
                if await self.can_see(channel_id):
                    await self.send({"type": "message", "channel_id": channel_id})
            elif event.get("type") in ("location", "itinerary"):
                rep_id = str(event.get("user_id"))
                # 只送給看得到這位業務的人：別人的位置連「動了」都不能透露
                if await self.can_see_rep(rep_id):
                    await self.send({"type": event["type"], "user_id": rep_id})

    async def sweep(self) -> None:
        while True:
            await asyncio.sleep(SWEEP_SECONDS)
            if time.monotonic() - self.last_ping > PING_TIMEOUT_SECONDS:
                await self.close(CLOSE_TIMEOUT)
                return
            await self.send_presence(time.time() - SWEEP_SHARE_SECONDS)

    async def run(self) -> None:
        client = aioredis.Redis.from_url(settings().redis_url)
        pubsub = client.pubsub()
        try:
            await pubsub.subscribe(realtime.events_channel())
            # 等 Redis 確認訂閱好了才說 ready：之後發的事件一定收得到
            await pubsub.get_message(timeout=5)
            # 先把看得到的頻道算好：不然第一則訊息進來時，每條連線同時去查
            await self.refresh_visible()
            await self.send({"type": "ready", "user_id": self.user_id})
            await self.send_presence(time.time(), full=True)
            tasks = [asyncio.create_task(job) for job in (self.read(), self.listen(pubsub), self.sweep())]
            try:
                done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
            for task in done:
                # 手機斷線是正常結束；其他例外照樣往外丟，留在 log 裡
                if (error := task.exception()) and not isinstance(error, WebSocketDisconnect):
                    raise error
        finally:
            await pubsub.aclose()
            await client.aclose()


@router.websocket("/api/ws")
async def websocket(ws: WebSocket):
    await ws.accept()
    try:
        first = json.loads(await asyncio.wait_for(ws.receive_text(), AUTH_TIMEOUT_SECONDS))
    except TimeoutError:
        await ws.close(CLOSE_TIMEOUT)
        return
    except WebSocketDisconnect:
        return
    except (ValueError, KeyError):
        first = None
    token = first.get("token") if isinstance(first, dict) and first.get("type") == "auth" else None
    active = bool(first.get("active")) if isinstance(first, dict) else False
    user_id = await run_in_threadpool(_heartbeat, token, active) if isinstance(token, str) else None
    if user_id is None:
        await ws.close(CLOSE_UNAUTHORIZED)
        return
    if _connections[user_id] >= MAX_CONNECTIONS:
        await ws.close(CLOSE_TOO_MANY)
        return
    _connections[user_id] += 1
    try:
        await _Connection(ws, user_id, token, active).run()
    except WebSocketDisconnect:
        pass
    finally:
        _connections[user_id] -= 1
        if _connections[user_id] <= 0:
            del _connections[user_id]
        # 斷線不記心跳（models.UserPresence.last_seen_at）：從最後一次心跳起算 5 分鐘變離線
        # 自己已經關掉的（心跳驗不過、太久沒心跳）再關一次會丟 RuntimeError；手機先斷線的話送不出去，
        # Starlette 會丟 WebSocketDisconnect，不擋的話每次斷線都在 log 留一段 traceback
        with contextlib.suppress(RuntimeError, WebSocketDisconnect):
            await ws.close(status.WS_1000_NORMAL_CLOSURE)
