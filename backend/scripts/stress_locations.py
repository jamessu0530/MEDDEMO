"""即時位置的壓力測試（docs/superpowers/plans/2026-10-01-itinerary-stage6.md Task 9）。

決賽時好幾位評審用第三方登入，同時代理同一位示範業務送位置：位置全部寫在同一列（user_location 的 U01），
主管頁同時開著收通知。這支對一個跑著的後端模擬這個情況，看心跳會不會變慢、出錯，主管有沒有收到通知，
最後存的是不是最後送的那一筆。

後端要用 LOCATION_SHARE_HOURS="1-7 00:00-24:00" 啟動（不受現在幾點影響），主管的 token 由呼叫端給：

    STRESS_MANAGER_TOKEN=<M01 的 token> uv run --project backend python backend/scripts/stress_locations.py \\
        --base http://127.0.0.1:8013 --judges 20 --seconds 60

評審的帳號用 /api/auth/register 開（自己開的帳號跟第三方登入的一樣都代理示範業務），信箱帶這次的時間戳，不會撞。
"""

import argparse
import asyncio
import json
import os
import random
import statistics
import time

import httpx
from websockets.asyncio.client import connect

# 台北 101 附近 3 公里內亂走：大部分的位置都超過 30 公尺，會真的寫進資料庫、發通知
CENTRE = (25.034, 121.5645)
SPREAD = 0.03
PASSWORD = "stress-pass-1234"


async def register(http: httpx.AsyncClient, run: str, n: int) -> str:
    response = await http.post("/api/auth/register", json={
        "name": f"壓測評審{n}", "email": f"stress-{run}-{n}@example.test", "password": PASSWORD,
    })
    response.raise_for_status()
    return response.json()["token"]


def somewhere() -> dict:
    return {
        "lat": round(CENTRE[0] + random.uniform(-SPREAD, SPREAD), 6),
        "lng": round(CENTRE[1] + random.uniform(-SPREAD, SPREAD), 6),
        "accuracy": 10,
    }


async def judge(http: httpx.AsyncClient, token: str, until: float, latencies: list[float], errors: list[str]) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    while time.monotonic() < until:
        started = time.monotonic()
        try:
            response = await http.post(
                "/api/presence/ping", json={"active": True, "location": somewhere()}, headers=headers
            )
            if response.status_code != 200:
                errors.append(f"{response.status_code} {response.text[:120]}")
        except httpx.HTTPError as exc:
            errors.append(repr(exc))
        latencies.append(time.monotonic() - started)
        await asyncio.sleep(random.uniform(0.5, 1.5))


async def manager(ws_url: str, token: str, until: float, received: list[str]) -> None:
    async with connect(ws_url) as ws:
        await ws.send(json.dumps({"type": "auth", "token": token, "active": True}))
        last_ping = time.monotonic()
        while time.monotonic() < until:
            try:
                event = json.loads(await asyncio.wait_for(ws.recv(), timeout=1))
            except TimeoutError:
                event = None
            if event and event.get("type") == "location":
                received.append(event["user_id"])
            if time.monotonic() - last_ping > 15:
                await ws.send(json.dumps({"type": "ping", "active": True}))
                last_ping = time.monotonic()


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", default="http://127.0.0.1:8013")
    parser.add_argument("--judges", type=int, default=20)
    parser.add_argument("--seconds", type=int, default=60)
    parser.add_argument("--managers", type=int, default=3, help="主管同時開幾條 WebSocket（同一個帳號最多 5 條）")
    args = parser.parse_args()
    manager_token = os.environ["STRESS_MANAGER_TOKEN"]
    run = str(int(time.time()))
    ws_url = args.base.replace("http", "ws", 1) + "/api/ws"

    async with httpx.AsyncClient(base_url=args.base, timeout=10) as http:
        tokens = [await register(http, run, n) for n in range(args.judges)]
        latencies: list[float] = []
        errors: list[str] = []
        received: list[list[str]] = [[] for _ in range(args.managers)]
        until = time.monotonic() + args.seconds
        await asyncio.gather(
            *(judge(http, token, until, latencies, errors) for token in tokens),
            *(manager(ws_url, manager_token, until + 2, box) for box in received),
        )

        # 最後一筆：停下來之後再送一個確定的位置，主管看到的必須是它
        final = {"lat": 25.0478, "lng": 121.517, "accuracy": 5}
        await http.post("/api/presence/ping", json={"active": True, "location": final},
                        headers={"Authorization": f"Bearer {tokens[0]}"})
        await asyncio.sleep(1)
        seen = (await http.get("/api/manager/locations", headers={"Authorization": f"Bearer {manager_token}"})).json()
        u01 = seen["locations"]["U01"]

    ordered = sorted(latencies)
    print(f"心跳 {len(latencies)} 次，失敗 {len(errors)} 次")
    print(f"延遲 p50 {statistics.median(ordered) * 1000:.0f} ms、p95 {ordered[int(len(ordered) * 0.95)] * 1000:.0f} ms、"
          f"最大 {ordered[-1] * 1000:.0f} ms")
    print(f"主管的 WebSocket 收到的位置通知：{[len(box) for box in received]}（每條）")
    print(f"最後的位置：{u01['lat']}, {u01['lng']}（應該是 {final['lat']}, {final['lng']}）· {u01['text']}")
    for line in errors[:5]:
        print("  錯誤：", line)
    ok = not errors and (u01["lat"], u01["lng"]) == (final["lat"], final["lng"]) and all(received)
    print("通過" if ok else "沒通過")


if __name__ == "__main__":
    asyncio.run(main())
