import datetime as dt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.main import app
from app.models import AppUser, Customer, Product, SalesOrder, SalesTransaction
from app.services import auth


def client(session):
    return TestClient(app), {"Authorization": f"Bearer {auth.create_token(session.get(AppUser, 'S1'))}"}


def sale(customer, sku, number, day="2031-04-10"):
    return SalesTransaction(customer_id=customer, sku=sku, order_no=number, date=dt.date.fromisoformat(day),
                            qty=1, amount=100, cost=40, listing_fee=0, channel_reward=0)


def test_recommendations_use_customer_context_current_price_and_exclude_existing_skus(interaction_session):
    api, headers = client(interaction_session)
    response = api.get("/api/orders/customers/C2/recommendations?exclude_sku=P2", headers=headers)
    assert response.status_code == 200, response.text
    value = response.json()
    assert (value["customer_id"], value["customer_name"], value["channel"], value["as_of"]) == ("C2", "C2", "independent", "2031-04-17")
    assert value["history_orders"] == 2 and value["peer_customers"] == 0
    assert [(item["sku"], item["rank"], item["unit_price"]) for item in value["items"]] == [("P1", 1, 95)]
    assert value["items"][0]["reasons"] and "model_version" in value
    empty = api.get("/api/orders/customers/C2/recommendations?exclude_sku=P1&exclude_sku=P2", headers=headers)
    assert empty.status_code == 200 and empty.json()["items"] == []
    assert "沒有其他可推薦" in empty.json()["message"]


def test_other_channels_future_sales_hidden_products_and_drafts_do_not_train_recommendations(interaction_session):
    session = interaction_session
    SalesOrder.__table__.create(session.connection(), checkfirst=True)
    session.add_all([Product(sku=sku, name=name, category=category, spec="盒", unit="盒", unit_price=price, unit_cost=40)
        for sku, name, category, price in [("CLINIC", "院所商品", "另一類", 100), ("FUTURE", "未來商品", "另一類", 100),
                                         ("HS-FO30", "舊商品", "測試", 100), ("ZERO", "無價格商品", "測試", 0)]])
    session.flush()
    session.add_all([sale("C1", "CLINIC", "other"), sale("C2", "FUTURE", "future", "2031-04-18"),
                     sale("C2", "HS-FO30", "hidden"), sale("C2", "ZERO", "zero")])
    session.add(SalesOrder(id="unsubmitted", order_no="DRAFT", status="draft", customer_id="C2", ship_to_id="C2",
        shipping_date=dt.date(2031, 4, 17), shipping_address="地址", payment_term="RM06", created_by="S1",
        items=[{"sku": "CLINIC", "qty": 1, "unit_price": 95}]))
    session.flush()
    before = session.scalar(select(func.count()).select_from(SalesTransaction))
    api, headers = client(session)
    value = api.get("/api/orders/customers/C2/recommendations", headers=headers).json()
    assert "items" in value, value
    assert {item["sku"] for item in value["items"]} <= {"P1", "P2"}
    assert value["history_orders"] == 2 and value["peer_customers"] == 0
    assert session.scalar(select(func.count()).select_from(SalesTransaction)) == before
    assert session.scalar(select(func.count()).select_from(SalesOrder)) == 1


def test_new_customer_falls_back_only_to_same_channel_and_empty_cohort_stays_empty(interaction_session):
    session = interaction_session
    session.execute(delete(SalesTransaction).where(SalesTransaction.customer_id == "C4"))
    api, headers = client(session)
    value = api.get("/api/orders/customers/C4/recommendations", headers=headers).json()
    assert value["history_orders"] == 0 and value["peer_customers"] == 1
    assert [item["sku"] for item in value["items"]] == ["P1"]
    assert value["items"][0]["source"] == "popular" and "尚無成交紀錄" in value["message"]
    session.get(Customer, "C4").type = "outlet"
    session.get(Customer, "C4").chain_group = None
    session.flush()
    empty = api.get("/api/orders/customers/C4/recommendations", headers=headers).json()
    assert empty["items"] == [] and empty["peer_customers"] == 0
    assert "沒有可對應目前型錄的成交紀錄" in empty["message"]


@pytest.mark.parametrize("query", ["limit=0", "limit=26", "exclude_sku=", "exclude_sku=" + "a" * 81,
                                  "&".join("exclude_sku=P1" for _ in range(101))])
def test_recommendation_query_constraints(interaction_session, query):
    api, headers = client(interaction_session)
    assert api.get(f"/api/orders/customers/C1/recommendations?{query}", headers=headers).status_code == 422


def test_recommendation_requires_login_and_an_accessible_customer(interaction_session):
    api, headers = client(interaction_session)
    assert api.get("/api/orders/customers/C1/recommendations").status_code == 401
    assert api.get("/api/orders/customers/missing/recommendations", headers=headers).status_code == 404
