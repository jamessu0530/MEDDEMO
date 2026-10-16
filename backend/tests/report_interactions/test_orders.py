import datetime as dt
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models import AppUser, Customer, Promotion, PromotionItem, Receivable, SalesOrder, SalesTransaction, SapQuotationDraft
from app.services import auth, order_workspace as service


@pytest.fixture
def workspace(interaction_session, monkeypatch):
    SalesOrder.__table__.create(interaction_session.connection(), checkfirst=True)
    Promotion.__table__.create(interaction_session.connection(), checkfirst=True)
    PromotionItem.__table__.create(interaction_session.connection(), checkfirst=True)
    SapQuotationDraft.__table__.create(interaction_session.connection(), checkfirst=True)
    monkeypatch.setattr(service.writeback, "is_mock_down", lambda target: False)
    return interaction_session


def client(session, user="S1"):
    return TestClient(app), {"Authorization": f"Bearer {auth.create_token(session.get(AppUser, user))}"}


def body(**patch):
    return {"customer_id": "C1", "ship_to_id": "C1", "shipping_date": "2031-04-17", "shipping_address": "測試收貨地址",
        "recipient": "測試收件人", "payment_term": "RM06", "purchase_no": "PO-1", "note": "測試訂單", "items": [], **patch}


def create(session, **patch):
    api, headers = client(session)
    response = api.post("/api/orders", headers=headers, json=body(**patch))
    assert response.status_code == 201, response.text
    return api, headers, response.json()


def test_empty_draft_roundtrip_edit_conflict_and_clear_all_items(workspace):
    api, headers, order = create(workspace)
    assert order["items"] == [] and order["amount"] == 0 and order["status"] == "draft"
    assert order["revision"] == 1 and order["as_of"] == "2031-04-17"
    assert api.get(f"/api/orders/{order['id']}", headers=headers).json() == order
    edited = body(items=[{"sku": "P1", "qty": 3, "unit_price": "99.50"}], revision=1)
    saved = api.put(f"/api/orders/{order['id']}", headers=headers, json=edited)
    assert saved.status_code == 200
    assert saved.json()["amount"] == 298.5 and saved.json()["revision"] == 2
    assert saved.json()["items"][0]["price_status"] == "yellow"
    assert api.put(f"/api/orders/{order['id']}", headers=headers, json=edited).status_code == 409
    cleared = api.put(f"/api/orders/{order['id']}", headers=headers, json=body(revision=2))
    assert cleared.status_code == 200 and cleared.json()["items"] == [] and cleared.json()["amount"] == 0
    rows = api.get("/api/orders?status=draft", headers=headers).json()
    assert rows["total"] == 1 and rows["items"][0]["id"] == order["id"]


def test_list_combines_history_and_new_orders_with_scoped_search_sort_and_pages(workspace):
    api, headers, order = create(workspace)
    first = api.get("/api/orders?page_size=2", headers=headers).json()
    second = api.get("/api/orders?page_size=2&page=2", headers=headers).json()
    assert first["total"] == second["total"] == 7
    assert not {row["id"] for row in first["items"]} & {row["id"] for row in second["items"]}
    ranked = api.get("/api/orders?sort=amount_desc", headers=headers).json()
    amounts = [row["amount"] for row in ranked["items"]]
    assert amounts == sorted(amounts, reverse=True)
    searched = api.get(f"/api/orders?q={order['order_no']}", headers=headers).json()
    assert searched["total"] == 1 and searched["items"][0]["id"] == order["id"]
    assert api.get("/api/orders?q=%25", headers=headers).json()["total"] == 0
    assert {row["customer_id"] for row in ranked["items"]} == {"C1", "C2", "C3", "C4"}
    _, foreign = client(workspace, "S3")
    assert api.get(f"/api/orders/{order['id']}", headers=foreign).status_code == 200
    saved = api.put(f"/api/orders/{order['id']}", headers=foreign, json=body(revision=1, items=[{"sku":"P1","qty":1,"unit_price":100}]))
    assert saved.status_code == 200
    assert api.post(f"/api/orders/{order['id']}/submit", headers=foreign, json={"revision": saved.json()["revision"]}).status_code == 200
    assert api.post("/api/orders", headers=headers, json=body(customer_id="C3")).status_code == 201
    assert api.post("/api/orders", headers=headers, json=body(ship_to_id="C3")).status_code == 201


def test_historical_amounts_keep_precision_and_duplicate_sku_lines_are_grouped(workspace):
    workspace.add_all([SalesTransaction(order_no="FRACTION", customer_id="C1", date=dt.date(2031, 4, 17), sku="P1", qty=3, amount=100, cost=40, listing_fee=0, channel_reward=0),
        SalesTransaction(order_no="FRACTION", customer_id="C1", date=dt.date(2031, 4, 17), sku="P1", qty=2, amount=17, cost=10, listing_fee=0, channel_reward=0)])
    workspace.flush()
    api, headers = client(workspace)
    historical = service.history_id("C1", "FRACTION")
    response = api.get(f"/api/orders/{historical}", headers=headers)
    assert response.status_code == 200
    order = response.json()
    assert order["readonly"] is True and order["amount"] == 117
    assert order["updated_at"] is None and order["sap_order_no"] is None and order["ship_to_name"] == "未記錄"
    assert len(order["items"]) == 1 and order["items"][0]["qty"] == 5 and order["items"][0]["amount"] == 117
    fractional = service.history_id("C1", "O0")
    assert api.get(f"/api/orders/{fractional}", headers=headers).status_code == 200
    _, foreign = client(workspace, "S3")
    assert api.get(f"/api/orders/{historical}", headers=foreign).status_code == 200
    assert api.get("/api/orders/history-!!!", headers=headers).status_code == 404


def test_order_customers_and_full_catalog_use_edit_scope_and_current_supply_price(workspace):
    api, headers = client(workspace, "M1")
    customers = api.get("/api/orders/customers", headers=headers).json()
    assert {item["id"] for item in customers} == {"C1", "C2", "C3", "C4"}
    assert all("grade" not in item for item in customers)
    catalog = api.get("/api/orders/products?customer_id=C2&q=P1", headers=headers).json()
    assert catalog["total"] == 1 and catalog["items"][0]["unit_price"] == 95
    assert api.get("/api/orders/products?customer_id=C3", headers=headers).status_code == 200
    assert api.get("/api/orders/products?customer_id=C2&q=%25", headers=headers).json()["total"] == 0


@pytest.mark.parametrize("patch", [
    {"items": [{"sku": "P1", "qty": 0, "unit_price": 100}]},
    {"items": [{"sku": "P1", "qty": 1.5, "unit_price": 100}]},
    {"items": [{"sku": "P1", "qty": 1, "unit_price": "NaN"}]},
    {"items": [{"sku": "P1", "qty": 1, "unit_price": "99.999"}]},
    {"items": [{"sku": "P1", "qty": 1, "unit_price": -1}]},
    {"items": [{"sku": "missing", "qty": 1, "unit_price": 100}]},
    {"items": [{"sku": "P1", "qty": 1, "unit_price": 100}] * 2},
    {"payment_term": "unknown"}, {"status": "effective"}, {"amount": 1},
])
def test_invalid_drafts_are_not_written(workspace, patch):
    api, headers = client(workspace)
    response = api.post("/api/orders", headers=headers, json=body(**patch))
    assert response.status_code == 422
    assert workspace.scalar(select(func.count()).select_from(SalesOrder)) == 0


@pytest.mark.parametrize("patch,message", [
    ({"items": []}, "至少一項"),
    ({"shipping_address": ""}, "收貨地址"),
    ({"shipping_date": "2031-04-16"}, "出貨日期"),
    ({"items": [{"sku": "P1", "qty": 1, "unit_price": "96.99"}]}, "優惠"),
])
def test_submit_validation_keeps_draft_and_does_not_write_sales(workspace, patch, message):
    before = workspace.scalar(select(func.count()).select_from(SalesTransaction))
    api, headers, order = create(workspace, **({"items": [{"sku": "P1", "qty": 3, "unit_price": 100}]} | patch))
    response = api.post(f"/api/orders/{order['id']}/submit", headers=headers, json={"revision": 1})
    assert response.status_code == 422 and message in response.json()["detail"]
    assert workspace.scalar(select(func.count()).select_from(SalesTransaction)) == before
    assert api.get(f"/api/orders/{order['id']}", headers=headers).json()["status"] == "draft"


def test_sap_outage_is_retryable_and_submit_is_atomic_idempotent_and_locks_editing(workspace, monkeypatch):
    api, headers, order = create(workspace, items=[{"sku": "P1", "qty": 3, "unit_price": "97"}], payment_term="RCD1")
    monkeypatch.setattr(service.writeback, "is_mock_down", lambda target: True)
    assert api.post(f"/api/orders/{order['id']}/submit", headers=headers, json={"revision": 1}).status_code == 503
    assert workspace.scalar(select(func.count()).select_from(SapQuotationDraft)) == 0
    monkeypatch.setattr(service.writeback, "is_mock_down", lambda target: False)
    sent = api.post(f"/api/orders/{order['id']}/submit", headers=headers, json={"revision": 1})
    assert sent.status_code == 200, sent.text
    effective = sent.json()
    assert effective["status"] == "effective" and effective["revision"] == 2 and effective["readonly"]
    number = effective["sap_order_no"]
    repeated = api.post(f"/api/orders/{order['id']}/submit", headers=headers, json={"revision": 1})
    assert repeated.status_code == 200 and repeated.json()["sap_order_no"] == number
    transactions = workspace.scalars(select(SalesTransaction).where(SalesTransaction.order_no == number)).all()
    invoices = workspace.scalars(select(Receivable).where(Receivable.invoice_no == number)).all()
    assert len(transactions) == len(invoices) == 1 and transactions[0].amount == 291
    assert invoices[0].amount == Decimal("285")
    workspace.expire_all()
    assert workspace.get(Customer, "C1").payment_term == "RM06"
    listed = api.get(f"/api/orders?q={number}", headers=headers).json()
    assert listed["total"] == 1 and listed["items"][0]["id"] == order["id"]
    assert api.put(f"/api/orders/{order['id']}", headers=headers, json=body(revision=2)).status_code == 409
