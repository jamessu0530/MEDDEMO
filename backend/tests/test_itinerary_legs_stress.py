"""壓力測試：20 位評審同時代理同一位示範業務，一起打開交通方式的選單、改同一段的交通方式（Google 用假的）。
不能有 500；同一個版本只有一個人存得進去，其他一律 409。

不用 tx：要真的 commit、真的搶 _lock 的列鎖，所以收尾要自己清乾淨。"""

import datetime as dt
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.main import app
from app.models import Itinerary, RouteSignalWeight, RouteSnooze
from app.services import google_routes

TODAY = dt.date(2026, 10, 28)
JUDGES = 20
MODES = ["walk", "transit", "scooter"]


def test_twenty_judges_change_the_same_leg_at_once(engine, auth, env, monkeypatch):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")

    def route_legs(key, points, http=None, polylines=True, mode="drive"):
        return [google_routes.Leg(seconds=600, meters=3000, polyline="") for _ in range(len(points) - 1)]

    monkeypatch.setattr(google_routes, "route_legs", route_legs)
    headers = auth("U01")
    try:
        first = TestClient(app).get("/api/itinerary/today", headers=headers).json()
        a, b = first["stops"][0]["customer_id"], first["stops"][1]["customer_id"]

        def judge(n):
            client = TestClient(app)
            options = client.get("/api/itinerary/today/legs/options", params={"from": a, "to": b}, headers=headers)
            saved = client.put(
                "/api/itinerary/today/legs",
                json={"from": a, "to": b, "mode": MODES[n % len(MODES)], "version": first["version"]},
                headers=headers,
            )
            return options.status_code, saved.status_code

        with ThreadPoolExecutor(max_workers=JUDGES) as pool:
            results = list(pool.map(judge, range(JUDGES)))
        assert [options for options, _ in results] == [200] * JUDGES
        saved = sorted(status for _, status in results)
        assert saved == [200] + [409] * (JUDGES - 1)
    finally:
        with Session(engine) as cleanup:
            cleanup.execute(delete(RouteSignalWeight).where(RouteSignalWeight.user_id == "U01"))
            cleanup.execute(delete(RouteSnooze).where(RouteSnooze.user_id == "U01"))
            cleanup.execute(delete(Itinerary).where(Itinerary.user_id == "U01", Itinerary.date == TODAY))
            cleanup.commit()
