import datetime as dt
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.main import app
from app.models import AppUser, Customer, Product, ProductBrowseProfile, ProductQueryEvent, SalesTransaction
from app.services import auth


@pytest.fixture
def business(interaction_session):
    for model in (ProductBrowseProfile, ProductQueryEvent):
        model.__table__.create(interaction_session.connection(), checkfirst=True)
    return interaction_session


def headers(session):
    return {"Authorization": f"Bearer {auth.create_token(session.get(AppUser, 'S1'))}"}


def report(session, **values):
    response = TestClient(app).post("/api/reports/business", headers=headers(session), json=values)
    assert response.status_code == 200, response.text
    return response.json()


def purchase(session, *, sku="P1", customer="C2", order="O3", qty=4, amount=80):
    session.add(SalesTransaction(order_no=order, customer_id=customer, date=dt.date(2031, 4, 3),
        sku=sku, qty=qty, amount=amount, cost=20))
    session.flush()


def test_business_endpoints_require_login():
    client = TestClient(app)
    assert client.post("/api/reports/business", json={}).status_code == 401
    assert client.get("/api/reports/business-products").status_code == 401


def test_sales_group_each_store_deduplicate_orders_and_total_all_pages(business):
    purchase(business, sku="P2")  # 同一張 O3 的另一品項，金額加總、訂單只算一次。
    data = report(business, view="pharmacy_sales", start="2031-04-01", end="2031-04-17", page_size=2)
    assert [r["key"] for r in data["rows"]] == ["C3", "C2"]
    assert data["total"] == 4
    assert data["totals"] == {"sales": 2330, "order_count": 4, "quantity": None, "query_count": None}
    assert data["rows"][1]["sales"] == 780 and data["rows"][1]["order_count"] == 1
    second = report(business, view="pharmacy_sales", start="2031-04-01", end="2031-04-17", page_size=2, page=2)
    assert second["totals"] == data["totals"]
    assert {r["key"] for r in second["rows"]}.isdisjoint({r["key"] for r in data["rows"]})


def test_sales_includes_zero_stores_filters_types_and_bounds(business):
    data = report(business, start="2031-04-17", end="2031-04-17", customer_type="pharmacies")
    assert {r["key"] for r in data["rows"]} == {"C2", "C3", "C4"}
    assert data["totals"]["sales"] == 0
    assert all(r["sales"] == 0 and r["order_count"] == 0 and r["last_order_date"] is None for r in data["rows"])
    assert report(business, customer_type="clinic")["rows"][0]["sales"] == 500


def test_single_product_buyers_show_exact_quantities_amounts_and_units(business):
    purchase(business)  # 同張訂單同一品項：qty 1+4，訂單數仍 1。
    data = report(business, view="product_orders", sku="P1", start="2031-04-01", end="2031-04-03")
    assert [r["key"] for r in data["rows"]] == ["C2", "C3"]
    assert data["rows"][0]["quantity"] == 5 and data["rows"][0]["order_count"] == 1
    assert data["totals"] == {"sales": 1680, "order_count": 2, "quantity": 6, "query_count": None}
    assert data["product"] == {"sku": "P1", "name": "P1", "spec": "盒", "unit": "盒"}
    assert report(business, view="product_orders", sku="P1", q="C1")["rows"][0]["quantity"] == 2
    assert report(business, view="product_orders", sku="P2", start="2031-04-17")["rows"] == []


def test_order_numbers_reused_by_different_customers_count_separately(business):
    purchase(business, customer="C1", order="O3")
    data = report(business, view="product_orders", sku="P1", start="2031-04-01")
    assert data["totals"]["order_count"] == 4  # C1 O1+O3、C2 O3、C3 O4。


def test_open_events_are_anonymous_durable_deduplicated_and_not_dwell(business):
    client = TestClient(app)
    detail = {"id": str(uuid4()), "sku": "P1", "kind": "detail"}
    dwell = {"id": str(uuid4()), "sku": "P1", "kind": "dwell", "active_ms": 3000}
    unknown = {"id": str(uuid4()), "sku": "unknown", "kind": "detail"}
    for _ in range(2):
        response = client.post("/api/products/browse-events", headers=headers(business), json={"events": [detail, detail, dwell, unknown]})
        assert response.status_code == 200, response.text
    assert business.scalar(select(func.count()).select_from(ProductQueryEvent)) == 1
    # 即使個人偏好的近期去重清單已淘汰此 ID，永久事件仍不能重計。
    business.expire_all()
    profile = business.get(ProductBrowseProfile, "S1")
    profile.recent_events = []
    business.flush()
    response = client.post("/api/products/browse-events", headers=headers(business), json={"events": [detail]})
    assert response.json()["P1"]["opens"] == 1
    assert business.scalar(select(func.count()).select_from(ProductQueryEvent)) == 1
    assert set(ProductQueryEvent.__table__.columns.keys()) == {"id", "sku", "recorded_at"}


def test_query_counts_use_taipei_days_and_search_without_borrowing_old_profiles(business):
    product = business.get(Product, "P1")
    product.name, product.aliases = "深海魚油", ["Omega 3"]
    business.add(ProductBrowseProfile(user_id="S1", signals={"P1": {"opens": 999}}, recent_events=[]))
    for sku, timestamp in (("P1", "2031-04-02T15:59:59+00:00"), ("P1", "2031-04-02T16:00:00+00:00"),
        ("P1", "2031-04-03T15:59:59+00:00"), ("P1", "2031-04-03T16:00:00+00:00"), ("P2", "2031-04-03T08:00:00+00:00")):
        business.add(ProductQueryEvent(id=str(uuid4()), sku=sku, recorded_at=dt.datetime.fromisoformat(timestamp)))
    business.flush()
    data = report(business, view="product_queries", start="2031-04-03", end="2031-04-03")
    assert [(r["key"], r["query_count"]) for r in data["rows"]] == [("P1", 2), ("P2", 1)]
    assert data["totals"]["query_count"] == 3
    assert report(business, view="product_queries", q="ＯＭＥＧＡ　３")["rows"][0]["query_count"] == 4
    assert report(business, view="product_queries", q="%")["rows"] == []
    business.execute(delete(ProductQueryEvent))
    business.flush()
    zero = report(business, view="product_queries", sku="P1")
    assert zero["rows"][0]["query_count"] == 0 and zero["tracked_since"] is None


def test_product_picker_searches_historical_skus_aliases_and_literal_wildcards(business):
    business.get(Product, "P1").aliases = ["Omega 3"]
    business.flush()
    client = TestClient(app)
    assert client.get("/api/reports/business-products?q=Omega", headers=headers(business)).json()[0]["sku"] == "P1"
    assert client.get("/api/reports/business-products?q=%25", headers=headers(business)).json() == []


@pytest.mark.parametrize("body", [
    {"start": "2031-05-01", "end": "2031-04-01"}, {"end": "9999-12-31"},
    {"page_size": 101}, {"page": 0}, {"view": "product_orders"},
    {"view": "product_queries", "customer_type": "clinic"}, {"view": "pharmacy_sales", "sku": "P1"},
])
def test_invalid_queries_are_rejected(business, body):
    assert TestClient(app).post("/api/reports/business", headers=headers(business), json=body).status_code == 422


def test_missing_product_and_out_of_range_page(business):
    client = TestClient(app)
    assert client.post("/api/reports/business", headers=headers(business), json={"view": "product_orders", "sku": "gone"}).status_code == 404
    assert report(business, page=999, page_size=3)["page"] == 2
