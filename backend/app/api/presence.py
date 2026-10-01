"""在線狀態 API 與 WebSocket（docs/superpowers/specs/2026-10-01-presence-design.md）。

一條 WebSocket（/api/ws）同時送兩件事：有人的狀態變了、看得到的頻道有新訊息。
訊息本身不經過 WebSocket，手機收到通知再用原本的 API 拿，權限檢查與訊息格式只有一份。
每條連線自己訂閱 Redis 的事件頻道（app/realtime.py），連線斷了訂閱跟著結束，不另外開背景程序。
連不上 WebSocket 的時候（公司網路擋掉之類），手機改用 POST /api/presence/ping 心跳。
"""

import asyncio
import contextlib
import json
import time
from collections import Counter
from typing import Annotated, Literal

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app import realtime
from app.api.auth import CurrentUser
from app.config import settings
from app.db import get_session, session_factory
from app.models import AppUser
from app.services import auth, channels, presence

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


class PingInput(BaseModel):
    active: bool


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
    """WebSocket 連不上時的心跳，順便回全部的狀態。"""
    try:
        changed = presence.touch(session, user, body.active)
    except presence.SignedOut:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "請重新登入") from None
    session.commit()
    if changed:
        realtime.presence_changed()
    return Statuses(statuses=presence.statuses(session))


# 以下在 threadpool 裡跑：資料庫是同步的，每次開一個短的 session，不讓一條長連線佔住一個資料庫連線


def _heartbeat(token: str, active: bool) -> str | None:
    """驗 token 並記一次心跳，回傳帳號；token 不對（過期、登出、被別的裝置頂掉、停用）回 None。"""
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
        session.commit()
    if changed:
        realtime.presence_changed()
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

    async def send(self, payload: dict) -> None:
        async with self.lock:
            if not self.closed:
                await self.ws.send_json(payload)

    async def close(self, code: int) -> None:
        async with self.lock:
            if not self.closed:
                self.closed = True
                await self.ws.close(code)

    async def send_presence(self, full: bool = False) -> None:
        async with self.presence_lock:
            current = await run_in_threadpool(_statuses)
            if full:
                changes = current
            else:
                changes = {uid: s for uid, s in current.items() if self.sent.get(uid) != s}
                changes |= {uid: "offline" for uid in self.sent if uid not in current}
            self.sent = current
            if full or changes:
                await self.send({"type": "presence", "full": full, "statuses": changes})

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
            if active == self.active and time.monotonic() - self.last_ping < MIN_PING_SECONDS:
                continue
            self.active = active
            self.last_ping = time.monotonic()
            if await run_in_threadpool(_heartbeat, self.token, active) is None:
                await self.close(CLOSE_UNAUTHORIZED)
                return

    async def listen(self, pubsub: aioredis.client.PubSub) -> None:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            event = json.loads(message["data"])
            if event.get("type") == "presence":
                await self.send_presence()
            elif event.get("type") == "message":
                channel_id = int(event["channel_id"])
                # 只通知看得到的人：看不到的頻道連「有新訊息」都不能透露
                if await run_in_threadpool(_can_see, self.user_id, channel_id):
                    await self.send({"type": "message", "channel_id": channel_id})

    async def sweep(self) -> None:
        while True:
            await asyncio.sleep(SWEEP_SECONDS)
            if time.monotonic() - self.last_ping > PING_TIMEOUT_SECONDS:
                await self.close(CLOSE_TIMEOUT)
                return
            await self.send_presence()

    async def run(self) -> None:
        client = aioredis.Redis.from_url(settings().redis_url)
        pubsub = client.pubsub()
        try:
            await pubsub.subscribe(realtime.events_channel())
            # 等 Redis 確認訂閱好了才說 ready：之後發的事件一定收得到
            await pubsub.get_message(timeout=5)
            await self.send({"type": "ready", "user_id": self.user_id})
            await self.send_presence(full=True)
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
        with contextlib.suppress(RuntimeError):
            # 已經關掉的（手機斷線、心跳驗不過）再關一次會丟 RuntimeError
            await ws.close(status.WS_1000_NORMAL_CLOSURE)
