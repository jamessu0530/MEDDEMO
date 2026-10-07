"""報價成交（客戶下單了）：寫進交易紀錄與應收帳款，報價改成已成交，不能復原。"""

import datetime as dt
from decimal import ROUND_HALF_UP, Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.main import app
from app.models import Customer, Receivable, SalesTransaction, SapQuotationDraft
from app.services import approvals, promo_packs, today_route
from app.tasks import redis
from app.timeutil import TAIPEI

TODAY = dt.date(2026, 10, 28)


@pytest.fixture
def api(tx, sign_in):
    yield sign_in(TestClient(app), "U01")
    redis().flushdb()


def open_quote(api, tx, items):
    quote = api.post("/api/customers/C001/quotes", json={"items": items}).json()
    # 報價的建立時間是真的現在；改成系統日，「上次訂的」與商機的日期才固定
    tx.execute(
        update(SapQuotationDraft).where(SapQuotationDraft.quote_no == quote["quote_no"])
        .values(created_at=dt.datetime(2026, 10, 28, 10, tzinfo=TAIPEI))
    )
    return quote["quote_no"]


def fee(amount, rate):
    return float((Decimal(amount) * Decimal(str(rate))).quantize(Decimal("1"), ROUND_HALF_UP))


def test_placing_an_order_writes_the_sale_and_the_invoice(tx, api):
    premium = next(p.code for p in promo_packs.current_packs(tx) if p.name == "Premium眼藥水(小口)")
    quote_no = open_quote(api, tx, [{"sku": "HS-FO30", "qty": 20}, {"promo_code": premium, "packs": 1}])
    rates = approvals.contract_terms(tx, tx.get(Customer, "C001"), TODAY)

    placed = api.post(f"/api/customers/C001/quotes/{quote_no}/order")
    order_no = f"SO20261028-C001-{quote_no}"
    assert placed.status_code == 200
    assert placed.json() == {"order_no": order_no, "date": "2026-10-28", "amount": 8100 + 5500}

    lines = tx.execute(
        select(SalesTransaction).where(SalesTransaction.order_no == order_no).order_by(SalesTransaction.id)
    ).scalars().all()
    # 魚油 20 盒照報價金額；小口買 22 送 1，到貨 23 盒
    assert [(l.customer_id, l.date, l.sku, l.qty, float(l.amount)) for l in lines] == [
        ("C001", TODAY, "HS-FO30", 20, 8100), ("C001", TODAY, "F749579", 23, 5500),
    ]
    assert [float(l.cost) for l in lines] == [270 * 20, 150 * 23]
    assert [float(l.listing_fee) for l in lines] == [fee(8100, rates["listing_fee_rate"]), fee(5500, rates["listing_fee_rate"])]
    assert [float(l.channel_reward) for l in lines] == [fee(8100, rates["channel_reward_rate"]), fee(5500, rates["channel_reward_rate"])]

    invoice = tx.get(Receivable, order_no)
    # 連鎖的付款條件 60 天
    assert (invoice.customer_id, invoice.invoice_date, invoice.due_date, float(invoice.amount), invoice.paid_date) == (
        "C001", TODAY, TODAY + dt.timedelta(days=60), 13600, None,
    )
    assert set(tx.scalars(select(SapQuotationDraft.status).where(SapQuotationDraft.quote_no == quote_no))) == {"ordered"}
    profile = api.get("/api/customers/C001/profile").json()
    assert quote_no not in [q["quote_no"] for q in profile["open_quotes"]]
    # 同一天的進貨與報價以報價為主：口還在
    last = api.get("/api/customers/C001/last-order").json()
    assert last["quote"]["quote_no"] == quote_no
    assert [(l["sku"], l["pack"]["name"] if l["pack"] else None) for l in last["lines"]] == [
        ("HS-FO30", None), ("F749579", "Premium眼藥水(小口)"),
    ]
    # 再按一次不會寫兩次
    assert api.post(f"/api/customers/C001/quotes/{quote_no}/order").status_code == 409


def test_only_draft_quotes_can_be_ordered(tx, api, auth):
    quote_no = open_quote(api, tx, [{"sku": "HS-FO30", "qty": 20}])
    assert api.post(f"/api/customers/C001/quotes/{quote_no}/order", headers=auth("U03")).status_code == 404
    assert api.post("/api/customers/C001/quotes/Q-NOPE/order").status_code == 404
    tx.execute(update(SapQuotationDraft).where(SapQuotationDraft.quote_no == quote_no).values(status="pending_approval"))
    assert api.post(f"/api/customers/C001/quotes/{quote_no}/order").status_code == 409


def test_an_ordered_quote_is_no_longer_an_opportunity(tx, api):
    # 用 17 盒：假資料 10/19 那次拜訪已經有一張魚油 20 盒、一直沒成交的草稿，它還會是商機
    quote_no = open_quote(api, tx, [{"sku": "HS-FO30", "qty": 17}])
    assert "想進魚油 30 入 × 17" in today_route._opportunities(tx, "U01", TODAY).get("C001", "")
    api.post(f"/api/customers/C001/quotes/{quote_no}/order")
    assert "想進魚油 30 入 × 17" not in today_route._opportunities(tx, "U01", TODAY).get("C001", "")


def test_a_quote_can_have_thirty_lines(api, tx):
    skus = [row["sku"] for row in api.get("/api/customers/C001/quote-items").json()]
    items = [{"sku": sku, "qty": 1} for sku in skus[:18]]
    packs = [{"promo_code": p.code, "packs": 1} for p in promo_packs.current_packs(tx)[:12]]
    assert api.post("/api/customers/C001/quotes", json={"items": items + packs}).status_code == 201
