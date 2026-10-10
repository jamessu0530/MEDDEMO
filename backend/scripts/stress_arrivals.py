"""點站的壓力測試（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈測試〉）：
展示時 20 位評審同時代理林昱辰，一直點站、開小卡、開個人頁。

    JWT_SECRET=… DATABASE_URL=… REDIS_URL=… uv run --project backend python backend/scripts/stress_arrivals.py \
        --base-url http://127.0.0.1:8013

API 與這支腳本要用同一把 JWT_SECRET（理由見 stress_channels.py）。只打本機（--base-url 不是 localhost 就拒絕）。
帳號直接寫進 DATABASE_URL 那個資料庫，跟 stress_channels.py 同一批（stress-NN@stress.local）。
開始前由 IT 重置示範業務今天的行程，所以結束後示範業務的行程停在壓測點過的樣子。

通過條件：沒有 5xx、每個請求都 200、點站的 p95 在 1 秒內、主管頁最後的進度（done）等於點過的不同站數。
不通過時 exit code 1。
"""

import argparse
import asyncio
import random
import statistics
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

# macOS 上 .venv 會被標成隱藏，Python 就略過可編輯安裝的 .pth、找不到 app；直接把 backend 加進搜尋路徑
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.api.auth import _new_sales_account  # noqa: E402
from app.db import session_factory  # noqa: E402
from app.models import AppUser  # noqa: E402
from app.services import auth  # noqa: E402

P95_LIMIT_SECONDS = 1.0


def tokens(count: int) -> tuple[str, str, list[str]]:
    """(IT, 主管 M01, count 個代理示範業務的帳號) 的 token；帳號沿用上次建的。"""
    judges = []
    with session_factory()() as session:
        for n in range(1, count + 1):
            email = f"stress-{n:02d}@stress.local"
            user = session.scalar(select(AppUser).where(AppUser.email == email))
            if user is None:
                user = _new_sales_account(session, f"壓測{n:02d}", email=email, password_hash=None)
            judges.append(auth.create_token(user))
        it, manager = auth.create_token(session.get(AppUser, "A01")), auth.create_token(session.get(AppUser, "M01"))
        session.commit()
    return it, manager, judges


async def judge(
    client: httpx.AsyncClient, token: str, stops: list[str], rounds: int, log: list[tuple[str, int, float]], hits: list[str]
):
    headers = {"Authorization": f"Bearer {token}"}

    async def hit(kind: str, method: str, path: str):
        started = time.perf_counter()
        try:
            response = await client.request(method, path, headers=headers)
            log.append((kind, response.status_code, time.perf_counter() - started))
        except httpx.HTTPError:
            log.append((kind, 0, time.perf_counter() - started))

    for n in range(rounds):
        customer_id = random.choice(stops)
        hits.append(f"/api/itinerary/today/stops/{customer_id}/arrive")
        await hit("arrive", "POST", f"/api/itinerary/today/stops/{customer_id}/arrive")
        await hit("brief", "GET", f"/api/customers/{customer_id}/brief")
        if n % 3 == 0:
            await hit("me", "GET", "/api/me")


async def main(args) -> int:
    if urlparse(args.base_url).hostname not in ("127.0.0.1", "localhost"):
        print("只打本機")
        return 1
    it, manager, judges = tokens(args.judges)
    async with httpx.AsyncClient(base_url=args.base_url, timeout=30) as client:
        reset = await client.post("/api/admin/demo-itinerary/reset", headers={"Authorization": f"Bearer {it}"})
        reset.raise_for_status()
        route = (await client.get("/api/itinerary/today", headers={"Authorization": f"Bearer {judges[0]}"})).json()
        stops = [s["customer_id"] for s in route["stops"]]
        log: list[tuple[str, int, float]] = []
        hits: list[str] = []
        await asyncio.gather(*(judge(client, token, stops, args.rounds, log, hits) for token in judges))
        rep = (await client.get("/api/manager/itineraries/U01", headers={"Authorization": f"Bearer {manager}"})).json()
    # 每位評審隨機點，20 人 × 15 輪幾乎一定每站都點過；沒點到的站照實印出
    tapped = {path.rsplit("/", 2)[-2] for path in hits}
    bad = [(kind, code) for kind, code, _ in log if code != 200]
    arrive_times = sorted(seconds for kind, _, seconds in log if kind == "arrive")
    p95 = arrive_times[int(len(arrive_times) * 0.95) - 1] if arrive_times else float("inf")
    print(f"請求 {len(log)}、不是 200 的 {len(bad)}、點站中位數 {statistics.median(arrive_times):.3f}s、p95 {p95:.3f}s")
    print(f"主管頁的進度 done={rep['done']}／total={rep['total']}（點過 {len(tapped)} 站；沒點到的：{sorted(set(stops) - tapped)}）")
    passed = not bad and p95 <= P95_LIMIT_SECONDS and rep["done"] == len(tapped)
    if bad:
        print("失敗的請求：", sorted(set(bad)))
    print("通過" if passed else "不通過")
    return 0 if passed else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8013")
    parser.add_argument("--judges", type=int, default=20)
    parser.add_argument("--rounds", type=int, default=15)
    sys.exit(asyncio.run(main(parser.parse_args())))
