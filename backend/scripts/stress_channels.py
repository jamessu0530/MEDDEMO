"""頻道的壓力測試（docs/superpowers/specs/2026-10-01-channel-rail-design.md「測試」）：
demo 當天幾十個人同時在同一個文字頻道收發訊息，WebSocket 與發言不能出錯。

    DATABASE_URL=… REDIS_URL=… uv run --project backend python backend/scripts/stress_channels.py \
        --base-url http://127.0.0.1:8011

API 與這支腳本要用同一把 JWT_SECRET（backend/.env 沒設的話，API 每次啟動隨機產生一把，腳本簽的 token 會被當成無效）：兩邊的指令前面都加上同一個 JWT_SECRET=…。

只打本機（--base-url 不是 localhost 就拒絕），不會在正式站留下測試訊息。
帳號直接寫進 DATABASE_URL 那個資料庫（註冊 API 每個來源每小時只能開 20 個）；重跑會沿用同一批帳號。
發言每天全系統最多 1,000 則（app/usage.py），一次 50 人 × 3 則 = 150 則，一天大約能跑六次。

通過條件：沒有 5xx、每則發言都 201、每個人輪詢都拿齊這一輪的全部訊息、
每條 WebSocket 都收到新訊息通知、發言的 p95 在 1 秒內。不通過時 exit code 1。
"""

import argparse
import asyncio
import json
import statistics
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

# macOS 上 .venv 會被標成隱藏，Python 就略過可編輯安裝的 .pth、找不到 app；直接把 backend 加進搜尋路徑
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
import websockets  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.api.auth import _new_sales_account  # noqa: E402
from app.db import session_factory  # noqa: E402
from app.models import AppUser  # noqa: E402
from app.services import auth  # noqa: E402

TOPIC = "壓力測試"
P95_LIMIT_SECONDS = 1.0


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


def topic_id(client: httpx.Client, it_token: str) -> int:
    """北區的「壓力測試」文字頻道，沒有就由 IT 開一個（順便測開頻道的端點）。"""
    headers = {"Authorization": f"Bearer {it_token}"}
    response = client.get("/api/channels", headers=headers)
    response.raise_for_status()
    listed = response.json()
    found = next((c for c in listed if c["kind"] == "topic" and c["name"] == TOPIC), None)
    if found:
        return found["id"]
    north = next(c for c in listed if c["kind"] == "region" and c["name"] == "北區")
    created = client.post("/api/channels", json={"parent_id": north["id"], "name": TOPIC}, headers=headers)
    created.raise_for_status()
    return created.json()["id"]


async def listen(ws_url: str, token: str, channel: int, ready: asyncio.Event, counts: list[int], index: int, stop: asyncio.Event):
    async with websockets.connect(ws_url) as ws:
        await ws.send(json.dumps({"type": "auth", "token": token, "active": True}))
        while json.loads(await ws.recv())["type"] != "ready":
            pass
        ready.set()
        while not stop.is_set():
            try:
                event = json.loads(await asyncio.wait_for(ws.recv(), timeout=0.5))
            except TimeoutError:
                continue
            if event.get("type") == "message" and event.get("channel_id") == channel:
                counts[index] += 1


async def run(base_url: str, users: int, per_user: int) -> bool:
    tokens = accounts(users)
    it_token, user_tokens = tokens[0], tokens[1:]
    with httpx.Client(base_url=base_url, timeout=30) as client:
        channel = topic_id(client, it_token)
        before = client.get(f"/api/channels/{channel}/messages", headers={"Authorization": f"Bearer {it_token}"}).json()
    start_after = before[-1]["id"] if before else 0

    ws_url = base_url.replace("http", "ws", 1) + "/api/ws"
    counts = [0] * users
    stop = asyncio.Event()
    readies = [asyncio.Event() for _ in range(users)]
    listeners = [
        asyncio.create_task(listen(ws_url, token, channel, readies[i], counts, i, stop)) for i, token in enumerate(user_tokens)
    ]
    await asyncio.wait_for(asyncio.gather(*(r.wait() for r in readies)), timeout=30)
    print(f"{users} 條 WebSocket 都連上了，開始發言")

    latencies: list[float] = []
    failures: list[str] = []
    async with httpx.AsyncClient(base_url=base_url, timeout=30) as client:

        async def speak(i: int, token: str):
            for k in range(per_user):
                started = time.perf_counter()
                response = await client.post(
                    f"/api/channels/{channel}/messages",
                    json={"body": f"壓測{i + 1:02d} 第 {k + 1} 則"},
                    headers={"Authorization": f"Bearer {token}"},
                )
                latencies.append(time.perf_counter() - started)
                if response.status_code != 201:
                    failures.append(f"壓測{i + 1:02d} 第 {k + 1} 則：{response.status_code} {response.text[:120]}")

        await asyncio.gather(*(speak(i, token) for i, token in enumerate(user_tokens)))
        expected = users * per_user - len(failures)

        async def fetch_all(token: str) -> int:
            got, after = 0, start_after
            while True:
                page = (await client.get(
                    f"/api/channels/{channel}/messages", params={"after": after},
                    headers={"Authorization": f"Bearer {token}"},
                )).json()
                if not page:
                    return got
                got += len(page)
                after = page[-1]["id"]

        await asyncio.sleep(1)  # 讓最後幾則通知送到
        fetched = await asyncio.gather(*(fetch_all(token) for token in user_tokens))

    stop.set()
    await asyncio.gather(*listeners, return_exceptions=True)

    p95 = statistics.quantiles(latencies, n=20)[18] if len(latencies) >= 20 else max(latencies)
    print(f"發言 {len(latencies)} 則，失敗 {len(failures)} 則")
    print(f"發言時間：p50 {statistics.median(latencies):.3f}s、p95 {p95:.3f}s、最慢 {max(latencies):.3f}s")
    print(f"輪詢拿到：最少 {min(fetched)}、最多 {max(fetched)}（應該是 {expected}）")
    print(f"WebSocket 通知：最少 {min(counts)}、最多 {max(counts)}")
    for line in failures[:10]:
        print("  ", line)

    ok = not failures and all(n == expected for n in fetched) and min(counts) > 0 and p95 <= P95_LIMIT_SECONDS
    print("通過" if ok else "沒有通過")
    return ok


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--base-url", default="http://127.0.0.1:8011")
    parser.add_argument("--users", type=int, default=50)
    parser.add_argument("--messages", type=int, default=3, help="每個人發幾則")
    args = parser.parse_args()
    if urlparse(args.base_url).hostname not in ("127.0.0.1", "localhost"):
        sys.exit("只打本機：--base-url 要是 localhost 或 127.0.0.1")
    sys.exit(0 if asyncio.run(run(args.base_url.rstrip("/"), args.users, args.messages)) else 1)


if __name__ == "__main__":
    main()
