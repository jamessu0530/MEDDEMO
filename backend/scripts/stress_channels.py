"""頻道的壓力測試（docs/superpowers/specs/2026-10-01-channel-rail-design.md「測試」）：
demo 當天幾十個人同時在同一個文字頻道收發訊息，WebSocket 與發言不能出錯。

    DATABASE_URL=… REDIS_URL=… uv run --project backend python backend/scripts/stress_channels.py \
        --base-url http://127.0.0.1:8011

API 與這支腳本要用同一把 JWT_SECRET（backend/.env 沒設的話，API 每次啟動隨機產生一把，腳本簽的 token 會被當成無效）：兩邊的指令前面都加上同一個 JWT_SECRET=…。

每條 WebSocket 照手機的做法：每 20 秒送一次心跳；收到這個頻道的新訊息通知，就去拿新訊息
（GET …/messages?after=，一次只問一個，問的時候又來了通知就問完再補一次，同 frontend/src/pages/channel.tsx），
並在 2 秒後問一次紅點（GET /api/channels/unread，一次只問一個，同 frontend/src/lib/count-poller.ts 的 refreshSoon）。

另外兩種情境，各跑一次：
- --idle 95：連上之後等 95 秒才發言。每條連線記住的「看得到哪些頻道」最晚 90 秒過期，第一則訊息時每條連線同時重算。
- --late-topic：連上之後才開一個新的文字頻道，在新頻道裡發言。開頻道會讓每條連線記住的頻道作廢，第一則訊息時同時重算。

只打本機（--base-url 不是 localhost 就拒絕），不會在正式站留下測試訊息。
帳號直接寫進 DATABASE_URL 那個資料庫（註冊 API 每個來源每小時只能開 20 個）；重跑會沿用同一批帳號。
發言每天全系統最多 1,000 則（app/usage.py），一次 50 人 × 3 則 = 150 則，一天大約能跑六次。

通過條件：沒有 5xx、每則發言都 201、每個人輪詢都拿齊這一輪的全部訊息、
每條 WebSocket 都收到新訊息通知（沒有中途斷線）、手機收到通知後拿新訊息與紅點的請求都是 200、發言的 p95 在 1 秒內。
連不上、逾時也算不通過，照樣印出結果。不通過時 exit code 1。
"""

import argparse
import asyncio
import json
import statistics
import sys
import time
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

# macOS 上 .venv 會被標成隱藏，Python 就略過可編輯安裝的 .pth、找不到 app；直接把 backend 加進搜尋路徑
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
import websockets  # noqa: E402
from websockets.exceptions import WebSocketException  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.api.auth import _new_sales_account  # noqa: E402
from app.db import session_factory  # noqa: E402
from app.models import AppUser  # noqa: E402
from app.services import auth  # noqa: E402
from app.services.channels import MESSAGE_PAGE  # noqa: E402

TOPIC = "壓力測試"
P95_LIMIT_SECONDS = 1.0
# 手機的心跳間隔（frontend/src/lib/realtime.ts 的 PING_MS）：不送的話 API 90 秒後關掉連線
PING_SECONDS = 20
# 收到通知後等這麼久才問紅點（frontend/src/lib/count-poller.ts 的 SOON_MS）
UNREAD_DELAY_SECONDS = 2
# 發完之後最多等手機把通知引起的請求做完這麼久
SETTLE_SECONDS = 60
# 連不上、逾時這幾種都算失敗，不讓腳本丟 traceback 停掉
NETWORK_ERRORS = (httpx.HTTPError, OSError, WebSocketException)


def accounts(count: int) -> list[str]:
    """準備 count 個自建帳號（代理示範業務，看得到北區），回傳 token。沿用上次建的。"""
    tokens = []
    with session_factory()() as session:
        for n in range(1, count + 1):
            email = f"stress-{n:02d}@stress.local"
            user = session.scalar(select(AppUser).where(AppUser.email == email))
            if user is None:
                user = _new_sales_account(session, f"壓測{n:02d}", email=email, password_hash=None)
            tokens.append(auth.create_token(user))
        it = session.get(AppUser, "A01")
        it_token = auth.create_token(it)
        session.commit()
    return [it_token, *tokens]


def north_topic(client: httpx.Client, it_token: str, name: str | None) -> int:
    """北區的文字頻道：name 是 None 就用「壓力測試」（沒有就由 IT 開一個），不然開一個叫 name 的新頻道。"""
    headers = {"Authorization": f"Bearer {it_token}"}
    response = client.get("/api/channels", headers=headers)
    response.raise_for_status()
    listed = response.json()
    if name is None:
        found = next((c for c in listed if c["kind"] == "topic" and c["name"] == TOPIC), None)
        if found:
            return found["id"]
        name = TOPIC
    north = next(c for c in listed if c["kind"] == "region" and c["name"] == "北區")
    created = client.post("/api/channels", json={"parent_id": north["id"], "name": name}, headers=headers)
    created.raise_for_status()
    return created.json()["id"]


def last_message_id(client: httpx.Client, it_token: str, channel: int) -> int:
    response = client.get(f"/api/channels/{channel}/messages", headers={"Authorization": f"Bearer {it_token}"})
    response.raise_for_status()
    page = response.json()
    return page[-1]["id"] if page else 0


class Phone:
    """一支手機：收到這個頻道的新訊息通知，照前端的做法拿新訊息與紅點，記下請求的次數與失敗。"""

    def __init__(self, client: httpx.AsyncClient, token: str):
        self.client = client
        self.token = token
        self.headers = {"Authorization": f"Bearer {token}"}
        # 發言的頻道與這一輪之前最後一則的編號；--late-topic 要等連上之後開了頻道才知道
        self.channel: int | None = None
        self.cursor = 0
        self.ready = asyncio.Event()
        self.notified = 0
        # 邊收通知邊拿到的訊息
        self.got = 0
        self.requests: Counter[str] = Counter()
        self.failures: list[str] = []
        # 連線中途斷了（不是腳本自己關的）
        self.dropped: str | None = None
        self.background: set[asyncio.Task] = set()
        # 拿新訊息：一次只問一個，問的時候又來了通知，問完再補一次
        self.fetching = False
        self.fetch_again = False
        # 紅點：等 2 秒再問，這段時間的通知併成一次；一次只問一個，問的時候又要問就問完再補一次
        self.unread_waiting = False
        self.unread_running = False
        self.unread_again = False

    async def get(self, kind: str, path: str, **params) -> list | dict | None:
        self.requests[kind] += 1
        try:
            response = await self.client.get(path, params=params, headers=self.headers)
        except NETWORK_ERRORS as error:
            self.failures.append(f"GET {path}：{type(error).__name__} {error}")
            return None
        if response.status_code != 200:
            self.failures.append(f"GET {path}：{response.status_code} {response.text[:120]}")
            return None
        return response.json()

    def spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self.background.add(task)
        task.add_done_callback(self.background.discard)

    def on_message(self) -> None:
        self.notified += 1
        self.fetch_new()
        self.unread_soon()

    def fetch_new(self) -> None:
        if self.fetching:
            self.fetch_again = True
            return
        self.fetching = True
        self.spawn(self._fetch_new())

    async def _fetch_new(self) -> None:
        try:
            while True:
                self.fetch_again = False
                page = await self.get("messages", f"/api/channels/{self.channel}/messages", after=self.cursor)
                if page:
                    self.got += len(page)
                    self.cursor = max(self.cursor, page[-1]["id"])
                    # 一次最多一頁，滿了就是還有
                    if len(page) == MESSAGE_PAGE:
                        self.fetch_again = True
                if not self.fetch_again:
                    return
        finally:
            self.fetching = False

    def unread_soon(self) -> None:
        if self.unread_waiting:
            return
        self.unread_waiting = True
        self.spawn(self._unread_later())

    async def _unread_later(self) -> None:
        await asyncio.sleep(UNREAD_DELAY_SECONDS)
        self.unread_waiting = False
        if self.unread_running:
            self.unread_again = True
            return
        self.unread_running = True
        try:
            while True:
                self.unread_again = False
                await self.get("unread", "/api/channels/unread")
                if not self.unread_again:
                    return
        finally:
            self.unread_running = False

    async def listen(self, ws_url: str, stop: asyncio.Event) -> None:
        try:
            async with websockets.connect(ws_url) as ws:
                await ws.send(json.dumps({"type": "auth", "token": self.token, "active": True}))
                while json.loads(await ws.recv())["type"] != "ready":
                    pass
                self.ready.set()
                last_ping = time.monotonic()
                while not stop.is_set():
                    if time.monotonic() - last_ping >= PING_SECONDS:
                        await ws.send(json.dumps({"type": "ping", "active": True}))
                        last_ping = time.monotonic()
                    try:
                        event = json.loads(await asyncio.wait_for(ws.recv(), timeout=0.5))
                    except TimeoutError:
                        continue
                    if event.get("type") == "message" and self.channel is not None and event.get("channel_id") == self.channel:
                        self.on_message()
        except NETWORK_ERRORS as error:
            self.dropped = f"{type(error).__name__} {error}"


async def wait_until(condition, seconds: float) -> bool:
    deadline = time.monotonic() + seconds
    while not condition():
        if time.monotonic() > deadline:
            return False
        await asyncio.sleep(0.1)
    return True


async def run(base_url: str, users: int, per_user: int, idle: float, late_topic: bool) -> bool:
    tokens = accounts(users)
    it_token, user_tokens = tokens[0], tokens[1:]
    channel = None
    if not late_topic:
        with httpx.Client(base_url=base_url, timeout=30) as client:
            channel = north_topic(client, it_token, None)
            start_after = last_message_id(client, it_token, channel)

    ws_url = base_url.replace("http", "ws", 1) + "/api/ws"
    stop = asyncio.Event()
    # 手機各自的請求：50 支手機各自連線，不跟發言共用連線上限，發言的時間才量得準
    phone_client = httpx.AsyncClient(
        base_url=base_url, timeout=30, limits=httpx.Limits(max_connections=None, max_keepalive_connections=None)
    )
    phones = [Phone(phone_client, token) for token in user_tokens]
    listeners = [asyncio.create_task(phone.listen(ws_url, stop)) for phone in phones]

    latencies: list[float] = []
    failures: list[str] = []
    poll_failures: list[str] = []
    fetched = [0] * users
    expected = 0
    try:
        connected = await wait_until(lambda: all(p.ready.is_set() or p.dropped for p in phones), 30)
        ready = sum(p.ready.is_set() for p in phones)
        if not connected or ready < users:
            print(f"只有 {ready} 條 WebSocket 連上（應該是 {users}）")
            return report_failure(phones)
        if late_topic:
            name = time.strftime("壓測%m%d-%H%M%S")
            with httpx.Client(base_url=base_url, timeout=30) as client:
                channel = north_topic(client, it_token, name)
            start_after = 0
            print(f"{users} 條 WebSocket 都連上了，之後才開了新的文字頻道「{name}」，開始發言")
        elif idle:
            print(f"{users} 條 WebSocket 都連上了，等 {idle:g} 秒再發言")
            await asyncio.sleep(idle)
            dropped = sum(p.dropped is not None for p in phones)
            print(f"等完了，{users - dropped} 條還連著，開始發言")
        else:
            print(f"{users} 條 WebSocket 都連上了，開始發言")
        for phone in phones:
            phone.channel = channel
            phone.cursor = start_after

        async with httpx.AsyncClient(base_url=base_url, timeout=30) as client:

            async def speak(i: int, token: str):
                for k in range(per_user):
                    started = time.perf_counter()
                    try:
                        response = await client.post(
                            f"/api/channels/{channel}/messages",
                            json={"body": f"壓測{i + 1:02d} 第 {k + 1} 則"},
                            headers={"Authorization": f"Bearer {token}"},
                        )
                    except NETWORK_ERRORS as error:
                        latencies.append(time.perf_counter() - started)
                        failures.append(f"壓測{i + 1:02d} 第 {k + 1} 則：{type(error).__name__} {error}")
                        continue
                    latencies.append(time.perf_counter() - started)
                    if response.status_code != 201:
                        failures.append(f"壓測{i + 1:02d} 第 {k + 1} 則：{response.status_code} {response.text[:120]}")

            await asyncio.gather(*(speak(i, token) for i, token in enumerate(user_tokens)))
            expected = users * per_user - len(failures)

            # 讓最後幾則通知送到，再等手機把通知引起的請求做完（紅點等 2 秒才問）
            await asyncio.sleep(1)
            if not await wait_until(lambda: not any(p.background for p in phones), SETTLE_SECONDS):
                poll_failures.append(f"手機的請求 {SETTLE_SECONDS} 秒內沒有做完")

            async def fetch_all(token: str) -> int:
                got, after = 0, start_after
                while True:
                    try:
                        response = await client.get(
                            f"/api/channels/{channel}/messages", params={"after": after},
                            headers={"Authorization": f"Bearer {token}"},
                        )
                    except NETWORK_ERRORS as error:
                        poll_failures.append(f"輪詢：{type(error).__name__} {error}")
                        return got
                    if response.status_code != 200:
                        poll_failures.append(f"輪詢：{response.status_code} {response.text[:120]}")
                        return got
                    page = response.json()
                    if not page:
                        return got
                    got += len(page)
                    after = page[-1]["id"]

            fetched = await asyncio.gather(*(fetch_all(token) for token in user_tokens))
    except NETWORK_ERRORS as error:
        failures.append(f"中途連不上 API：{type(error).__name__} {error}")
    finally:
        stop.set()
        await asyncio.gather(*listeners, return_exceptions=True)
        # 中途失敗時手機可能還有請求沒做完：取消、等它們結束，再關掉連線
        pending = [task for phone in phones for task in phone.background]
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        await phone_client.aclose()

    p95 = (statistics.quantiles(latencies, n=20)[18] if len(latencies) >= 20 else max(latencies)) if latencies else float("inf")
    counts = [p.notified for p in phones]
    dropped = [p.dropped for p in phones if p.dropped]
    phone_failures = [line for p in phones for line in p.failures]
    requests = sum((p.requests for p in phones), Counter())
    print(f"發言 {len(latencies)} 則，失敗 {len(failures)} 則")
    if latencies:
        print(f"發言時間：p50 {statistics.median(latencies):.3f}s、p95 {p95:.3f}s、最慢 {max(latencies):.3f}s")
    print(f"輪詢拿到：最少 {min(fetched)}、最多 {max(fetched)}（應該是 {expected}）")
    print(f"WebSocket 通知：最少 {min(counts)}、最多 {max(counts)}，中途斷線 {len(dropped)} 條")
    print(
        f"手機收到通知後的請求：拿新訊息 {requests['messages']} 個、紅點 {requests['unread']} 個，"
        f"失敗 {len(phone_failures)} 個；邊收邊拿到的訊息最少 {min(p.got for p in phones)}、最多 {max(p.got for p in phones)}"
    )
    for line in (failures + poll_failures + phone_failures + dropped)[:10]:
        print("  ", line)

    ok = (
        not failures
        and not poll_failures
        and all(n == expected for n in fetched)
        and min(counts) > 0
        and not dropped
        and not phone_failures
        and p95 <= P95_LIMIT_SECONDS
    )
    print("通過" if ok else "沒有通過")
    return ok


def report_failure(phones: list[Phone]) -> bool:
    for line in [p.dropped for p in phones if p.dropped][:10]:
        print("  ", line)
    print("沒有通過")
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--base-url", default="http://127.0.0.1:8011")
    parser.add_argument("--users", type=int, default=50)
    parser.add_argument("--messages", type=int, default=3, help="每個人發幾則")
    parser.add_argument("--idle", type=float, default=0, metavar="SECONDS", help="連上之後等幾秒才發言（95：每條連線記住的頻道都過期）")
    parser.add_argument("--late-topic", action="store_true", help="連上之後才開一個新的文字頻道，在那裡發言")
    args = parser.parse_args()
    if urlparse(args.base_url).hostname not in ("127.0.0.1", "localhost"):
        sys.exit("只打本機：--base-url 要是 localhost 或 127.0.0.1")
    try:
        ok = asyncio.run(run(args.base_url.rstrip("/"), args.users, args.messages, args.idle, args.late_topic))
    except NETWORK_ERRORS as error:
        # 還沒開始發言就連不上（API 沒開、逾時）
        print(f"連不上 API：{type(error).__name__} {error}")
        print("沒有通過")
        ok = False
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
