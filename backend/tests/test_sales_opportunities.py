import datetime as dt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.main import app
from app.models import AppUser, Customer, Product, SalesTransaction
from app.services import auth as auth_service, sales_opportunities as service

DAY = dt.date(2026, 10, 28)
PREVIOUS = dt.date(2026, 9, 1)


@pytest.fixture
def client(tx):
    return TestClient(app)


@pytest.fixture
def customers(tx):
    owned = tx.scalars(select(Customer).where(Customer.owner_user_id == "U01").order_by(Customer.id).limit(7)).all()
    foreign = tx.scalars(select(Customer).where(Customer.owner_user_id == "U02").limit(1)).one()
    sku = tx.scalar(select(Product.sku).order_by(Product.sku).limit(1))
    tx.execute(delete(SalesTransaction).where(SalesTransaction.customer_id.in_([c.id for c in owned] + [foreign.id])))
    for customer in owned:
        customer.grade = "B"
    owned[0].grade = owned[3].grade = owned[5].grade = foreign.grade = "A"

    def sale(customer, day, amount, qty, order):
        tx.add(SalesTransaction(customer_id=customer.id, date=day, sku=sku, amount=amount, qty=qty, cost=0, order_no=order))

    # 多品項同一單只算一張；上月第一天與最後一天都算。
    sale(owned[0], PREVIOUS, 6000, 12, "OP-P1")
    sale(owned[0], PREVIOUS, 4000, 8, "OP-P1")
    sale(owned[0], dt.date(2026, 9, 30), 10000, 20, "OP-P2")
    sale(owned[0], dt.date(2026, 10, 1), 5000, 10, "OP-C1")
    sale(owned[0], DAY + dt.timedelta(days=1), 999999, 999, "OP-FUTURE")
    # 分別驗證僅金額減少、僅數量減少、大客戶金額已成長、一般客戶成長。
    for i, prev_amount, prev_qty, current_amount, current_qty in (
        (1, 12000, 10, 6000, 10), (2, 10000, 20, 11000, 10),
        (3, 1000, 5, 2000, 10), (4, 1000, 1, 2000, 2), (6, 1000, 1, 1000, 1),
    ):
        sale(owned[i], PREVIOUS, prev_amount, prev_qty, f"OP-P{i + 3}")
        sale(owned[i], DAY, current_amount, current_qty, f"OP-C{i + 3}")
    # 無上月基準不除以零，但 A 級仍列入；最近進貨能找到更早的交易。
    sale(owned[5], PREVIOUS - dt.timedelta(days=1), 9000, 10, "OP-OLD")
    sale(foreign, PREVIOUS, 999999, 999, "OP-OTHER")
    tx.flush()
    return owned, foreign


def test_two_independent_signals_and_amounts(tx, customers):
    owned, foreign = customers
    data = service.build(tx, tx.get(AppUser, "U01"))
    found = {item["customer_id"]: item for item in data["items"]}
    assert set(found).intersection(c.id for c in owned) == {owned[i].id for i in (0, 1, 2, 3, 5)}
    assert foreign.id not in found
    first = found[owned[0].id]
    assert first["priority"] == "high"
    assert (first["previous_amount"], first["current_amount"], first["gap_amount"]) == (20000, 5000, 15000)
    assert (first["previous_qty"], first["current_qty"]) == (40, 10)
    assert (first["previous_orders"], first["current_orders"], first["previous_average_order"]) == (2, 1, 10000)
    assert first["decline_percent"] == 75
    assert first["last_order_date"] == dt.date(2026, 10, 1)
    assert found[owned[1].id]["amount_declined"] and not found[owned[1].id]["quantity_declined"]
    assert found[owned[2].id]["quantity_declined"] and not found[owned[2].id]["amount_declined"]
    assert found[owned[2].id]["gap_amount"] == 0
    assert found[owned[3].id]["is_key_account"] and not found[owned[3].id]["is_declining"]
    assert found[owned[5].id]["decline_percent"] is None
    assert found[owned[5].id]["previous_average_order"] is None
    assert found[owned[5].id]["last_order_date"] == dt.date(2026, 8, 31)
    # 兩項訊號同時命中者先於所有一般機會，金額參考再大也不超車。
    high = [item["priority"] == "high" for item in data["items"]]
    assert high == sorted(high, reverse=True)
    assert data["summary"]["gap_amount"] == sum(item["gap_amount"] for item in data["items"])
    assert data["days_remaining"] == 3


def test_api_uses_current_ownership_and_refreshes_after_transactions(client, tx, auth, customers):
    owned, _ = customers
    response = client.get("/api/sales-opportunities", headers=auth())
    assert response.status_code == 200
    data = response.json()
    assert data["as_of"] == DAY.isoformat()
    assert data["previous_start"] == "2026-09-01" and data["previous_end"] == "2026-09-30"
    assert owned[0].id in {item["customer_id"] for item in data["items"]}
    owned[0].owner_user_id = "U02"
    tx.flush()
    updated = client.get("/api/sales-opportunities", headers=auth()).json()
    assert owned[0].id not in {item["customer_id"] for item in updated["items"]}
    # 真正入帳的補單會改變機會，未入帳草稿不會參與此交易表查詢。
    tx.add(SalesTransaction(customer_id=owned[1].id, date=DAY, sku=tx.scalar(select(Product.sku).limit(1)), amount=6000, qty=1, cost=0, order_no="OP-TOPUP"))
    tx.flush()
    updated = client.get("/api/sales-opportunities", headers=auth()).json()
    assert owned[1].id not in {item["customer_id"] for item in updated["items"]}


def test_authentication_roles_and_empty_portfolio(client, tx, auth):
    assert client.get("/api/sales-opportunities").status_code == 401
    assert client.get("/api/sales-opportunities", headers=auth("M01")).status_code == 403
    assert client.get("/api/sales-opportunities", headers=auth("A01")).status_code == 403
    tx.query(Customer).filter(Customer.owner_user_id == "U01").update({"owner_user_id": "U02"})
    tx.flush()
    data = client.get("/api/sales-opportunities", headers=auth()).json()
    assert data["items"] == []
    assert all(value == 0 for value in data["summary"].values())


def test_external_account_uses_its_assigned_demo_rep(client, tx, auth):
    proxy = AppUser(id="XOPPORTUNITY", name="評審", role="sales", region="北區", acts_as_user_id="U01")
    tx.add(proxy)
    tx.flush()
    headers = {"Authorization": f"Bearer {auth_service.create_token(proxy)}"}
    assert client.get("/api/sales-opportunities", headers=headers).json() == client.get("/api/sales-opportunities", headers=auth()).json()


@pytest.mark.parametrize("today,previous_start,previous_end,month_end", [
    ("2026-01-01", "2025-12-01", "2025-12-31", "2026-01-31"),
    ("2024-03-01", "2024-02-01", "2024-02-29", "2024-03-31"),
    ("2026-02-28", "2026-01-01", "2026-01-31", "2026-02-28"),
])
def test_calendar_boundaries(today, previous_start, previous_end, month_end):
    start, end, current, final = service.month_periods(dt.date.fromisoformat(today))
    assert (start.isoformat(), end.isoformat(), final.isoformat()) == (previous_start, previous_end, month_end)
    assert current.day == 1
