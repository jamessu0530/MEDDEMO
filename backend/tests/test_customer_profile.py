"""客戶檔案（FR-2）：用灌好的假資料檢查數字與待處理事項。談判卡的測試在 test_negotiation.py。"""

import datetime as dt
from calendar import monthrange

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.main import app
from app.models import Product, SalesTransaction
from app.services import customer_profile


@pytest.fixture
def client(engine, sign_in):
    # 用到的 C001、C030 分屬北區兩位業務，他們的主管 M01 兩家都看得到
    return sign_in(TestClient(app), "M01")


def test_profile_shows_the_lengthening_interval_and_open_items(client):
    # 康泰忠孝店是刻意設計的案例：進貨間隔 21 → 34 天、單次金額持平，10/19 拜訪提到御松田
    profile = client.get("/api/customers/C001/profile").json()
    stats = profile["stats"]
    assert (stats["interval_before"], stats["interval_last_90d"]) == (21.0, 34.3)
    assert stats["interval_alert"] is True
    assert profile["highlights"][0] == "進貨間隔從 21 天拉長到 34 天，單次金額持平"
    assert "答應客戶的「回報檔期」已過期限（10/24）" in profile["highlights"]
    # 競品不寫成一句，改記成備忘
    assert not any("競品" in h for h in profile["highlights"])
    assert len(profile["intervals"]) == 6 and profile["intervals"][-1]["month"] == "2026-10"
    assert [c["text"] for c in profile["commitments"] if c["overdue"]] == ["回報檔期"]
    assert [c["text"] for c in profile["complaints"]] == ["補貨延遲三天"]
    assert [c["name"] for c in profile["competitors"]] == ["御松田"]
    assert len(profile["open_quotes"]) == 1


def test_the_complaint_makes_the_brief(client):
    # 康泰忠孝店：間隔、上次訂的、過期承諾、客訴
    highlights = client.get("/api/customers/C001/profile").json()["highlights"]
    assert "客訴：補貨延遲三天（10/19）" in highlights
    assert len(highlights) <= 5


def test_a_steady_customer_gets_no_interval_alert(client):
    # 明德北投：間隔 34.4 → 36.0 天，變化不到兩成
    profile = client.get("/api/customers/C030/profile").json()
    assert profile["stats"]["interval_alert"] is False
    assert not any("拉長" in line for line in profile["highlights"])


def test_an_unknown_customer_is_not_found(client):
    assert client.get("/api/customers/C999/profile").status_code == 404


def test_profile_provides_the_district_for_google_storefront_search(client):
    profile = client.get("/api/customers/C001/profile").json()
    assert (profile["city"], profile["area"]) == ("台北市", "大安")
    # 示範座標不是店址：只給搜尋地區，街景必須從核對過的 Google 店家取位置。
    assert "lat" not in profile and "lng" not in profile


def test_the_brief_says_which_packs_changed_since_the_last_order(client):
    highlights = client.get("/api/customers/C001/profile").json()["highlights"]
    # 排在進貨間隔那句後面
    assert highlights[1] == "上次訂的有 3 項這期促銷變了：40EXa眼藥水(中口)沒了、金舒胃平(小口)要買的量變多、威鎮凝膠沒有促銷了"
    assert not any("上次訂的" in line for line in client.get("/api/customers/C030/profile").json()["highlights"])


def test_the_brief_lists_three_changes_at_most():
    shorts = ["甲沒了", "乙沒了", "丙沒了", "丁沒了"]
    assert customer_profile.last_order_highlight(shorts) == "上次訂的有 4 項這期促銷變了：甲沒了、乙沒了、丙沒了等"
    assert customer_profile.last_order_highlight([]) is None


def test_profile_includes_daily_purchases_for_this_and_last_month(client, db):
    profile = client.get("/api/customers/C001/profile").json()
    previous, current = profile["monthly_purchases"]
    assert [previous["month"], current["month"]] == ["2026-09", "2026-10"]
    assert len(previous["daily"]) == 30
    assert current["daily"][-1]["date"] == profile["today"]
    expected = db.scalar(
        select(func.sum(SalesTransaction.amount)).where(
            SalesTransaction.customer_id == "C001",
            SalesTransaction.date >= dt.date(2026, 10, 1),
            SalesTransaction.date <= dt.date.fromisoformat(profile["today"]),
        )
    )
    assert sum(day["amount"] for day in current["daily"]) == pytest.approx(float(expected or 0))


@pytest.mark.parametrize("today", [dt.date(2026, 10, 18), dt.date(2024, 3, 31), dt.date(2027, 1, 1), dt.date(2025, 3, 1)])
def test_monthly_purchases_aggregate_lines_and_respect_calendar_boundaries(tx, today):
    previous_start, current_start = customer_profile._month_starts(today, 2)
    previous_end = current_start - dt.timedelta(days=1)
    tx.execute(delete(SalesTransaction).where(SalesTransaction.customer_id == "C001"))
    sku = tx.scalar(select(Product.sku).limit(1))
    for number, (customer_id, day, amount) in enumerate([
        ("C001", previous_start - dt.timedelta(days=1), 99999),
        ("C001", previous_start, 1000),
        ("C001", previous_start, 500),
        ("C001", previous_end, 500),
        ("C001", current_start, 2000),
        ("C001", today, 3000),
        ("C001", today + dt.timedelta(days=1), 99999),
        ("C030", today, 99999),
    ]):
        tx.add(SalesTransaction(
            order_no=f"MONTH-COMPARE-{number if number != 2 else 1}",
            customer_id=customer_id, date=day, sku=sku, qty=1, amount=amount, cost=1,
        ))
    tx.flush()

    previous, current = customer_profile._monthly_purchases(tx, "C001", today)
    assert previous.month == previous_start.strftime("%Y-%m")
    assert len(previous.daily) == monthrange(previous_start.year, previous_start.month)[1]
    assert previous.daily[0].amount == 1500
    assert sum(day.amount for day in previous.daily) == 2000
    assert current.month == today.strftime("%Y-%m")
    assert len(current.daily) == today.day
    assert current.daily[-1].date == today
    assert sum(day.amount for day in current.daily) == 5000
    if today.day > 2:
        assert current.daily[1].amount == 0


def test_monthly_purchases_include_zero_days_without_orders(tx):
    tx.execute(delete(SalesTransaction).where(SalesTransaction.customer_id == "C001"))
    months = customer_profile._monthly_purchases(tx, "C001", dt.date(2026, 10, 18))
    assert [len(month.daily) for month in months] == [30, 18]
    assert all(day.amount == 0 for month in months for day in month.daily)
