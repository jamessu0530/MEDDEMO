import datetime as dt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.main import app
from app.models import AppUser, Product, SalesTransaction
from app.services import auth, outlet_search


def headers(session):
    return {"Authorization": f"Bearer {auth.create_token(session.get(AppUser, 'S1'))}"}


def add_purchase(session, customer, sku, *, order_no="extra", date="2031-04-17", qty=3):
    session.add(SalesTransaction(
        order_no=order_no, customer_id=customer, date=dt.date.fromisoformat(date),
        sku=sku, qty=qty, amount=100, cost=40,
    ))
    session.flush()


def name_products(session):
    product = session.get(Product, "P1")
    product.name = "深海魚油"
    product.category = "保健食品"
    product.aliases = ["Omega 3", "魚油膠囊"]
    session.get(Product, "P2").name = "葉黃素"
    session.flush()


def test_history_covers_old_orders_and_counts_orders_without_duplicate_keywords(interaction_session):
    session = interaction_session
    name_products(session)
    add_purchase(session, "C1", "P1", order_no="O1")
    add_purchase(session, "C1", "P2", date="2020-01-01", qty=20)
    response = TestClient(app).get("/api/customers/C1/purchased-products", headers=headers(session))
    assert response.status_code == 200
    products = response.json()
    # 舊訂單的量較多，仍應排在最近叫過的品項前面。
    assert [p["sku"] for p in products] == ["P2", "P1"]
    assert products[1] == {
        "sku": "P1", "name": "深海魚油", "category": "保健食品", "spec": "盒", "unit": "盒",
        "aliases": ["Omega 3", "魚油膠囊"], "order_count": 2, "total_qty": 5,
        "last_order_date": "2031-04-17",
    }
    assert products[0]["last_order_date"] == "2020-01-01"
    assert products[0]["total_qty"] == 20


def test_picker_attaches_only_each_stores_own_purchase_keywords(interaction_session):
    response = TestClient(app).get("/api/customers/picker", headers=headers(interaction_session))
    assert response.status_code == 200
    stores = {c["id"]: c for c in response.json()["customers"]}
    assert [p["sku"] for p in stores["C1"]["purchased_products"]] == ["P1"]
    assert stores["C1"]["purchased_products"][0]["order_count"] == 2
    assert [p["sku"] for p in stores["C4"]["purchased_products"]] == ["P2"]


@pytest.mark.parametrize("query", ["魚油", "鱼油", "ＯＭＥＧＡ　３", "P1", "保健食品"])
def test_product_keywords_find_stores_without_directory_index_matches(interaction_session, monkeypatch, query):
    name_products(interaction_session)
    monkeypatch.setattr(outlet_search, "customer_matches", lambda session, q: [])
    client = TestClient(app)
    first = client.get("/api/customers/picker", params={"q": query, "limit": 2}, headers=headers(interaction_session))
    assert first.status_code == 200
    assert [c["id"] for c in first.json()["customers"]] == ["C1", "C2"]
    assert first.json()["next_offset"] == 2
    second = client.get("/api/customers/picker", params={"q": query, "limit": 2, "offset": 2}, headers=headers(interaction_session))
    assert [c["id"] for c in second.json()["customers"]] == ["C3"]
    assert second.json()["next_offset"] is None
    full = client.get("/api/customers", params={"q": query}, headers=headers(interaction_session))
    assert [c["id"] for c in full.json()] == ["C1", "C2", "C3"]


@pytest.mark.parametrize("query", ["%", "_", "不存在的品名"])
def test_purchase_search_treats_wildcards_as_literal_text(interaction_session, monkeypatch, query):
    monkeypatch.setattr(outlet_search, "customer_matches", lambda session, q: [])
    response = TestClient(app).get("/api/customers/picker", params={"q": query}, headers=headers(interaction_session))
    assert response.status_code == 200
    assert response.json() == {"customers": [], "next_offset": None}


def test_empty_history_and_new_purchases_are_reflected_immediately(interaction_session, monkeypatch):
    session = interaction_session
    session.execute(delete(SalesTransaction).where(SalesTransaction.customer_id == "C4"))
    session.flush()
    monkeypatch.setattr(outlet_search, "customer_matches", lambda session, q: [])
    client = TestClient(app)
    assert client.get("/api/customers/C4/purchased-products", headers=headers(session)).json() == []
    assert client.get("/api/customers/picker?q=P2", headers=headers(session)).json()["customers"] == []
    add_purchase(session, "C4", "P2")
    stores = client.get("/api/customers/picker?q=P2", headers=headers(session)).json()["customers"]
    assert [c["id"] for c in stores] == ["C4"]
    assert stores[0]["purchased_products"][0]["order_count"] == 1


def test_purchase_history_requires_login_and_existing_customer(interaction_session):
    client = TestClient(app)
    assert client.get("/api/customers/C1/purchased-products").status_code == 401
    assert client.get("/api/customers/missing/purchased-products", headers=headers(interaction_session)).status_code == 404
