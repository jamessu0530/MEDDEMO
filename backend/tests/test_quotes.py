"""客戶檔案「開報價」：不必先有一次拜訪，直接開 SAP 報價草稿。"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.tasks import redis


@pytest.fixture
def client(engine, sign_in):
    yield sign_in(TestClient(app), "U01")
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM sap_quotation_draft WHERE quote_no LIKE 'Q%'"))
    redis().flushdb()


def test_quote_items_are_what_the_customer_usually_buys(client):
    items = client.get("/api/customers/C001/quote-items").json()
    fish = next(i for i in items if i["sku"] == "HS-FO30")
    # 康泰忠孝店是連鎖：魚油 30 入建議售價 450 元，打 9 折是 405 元
    assert fish["unit_price"] == 405
    assert fish["usual_qty"] > 0 and fish["unit"] == "盒"


def test_an_opened_quote_shows_up_in_the_profile(client):
    created = client.post("/api/customers/C001/quotes", json={"items": [{"sku": "HS-FO30", "qty": 20}, {"sku": "HS-CA60", "qty": 5}]})
    assert created.status_code == 201
    quote = created.json()
    assert quote["quote_no"].startswith("Q20261028-")
    assert quote["amount"] == sum(i["unit_price"] * i["qty"] for i in quote["items"])

    opened = next(q for q in client.get("/api/customers/C001/profile").json()["open_quotes"] if q["quote_no"] == quote["quote_no"])
    assert opened["visit_id"] is None and "× 20" in opened["items"]

    again = client.post("/api/customers/C001/quotes", json={"items": [{"sku": "HS-FO30", "qty": 1}]}).json()
    assert again["quote_no"] != quote["quote_no"]


def test_bad_quotes_are_rejected(client):
    post = lambda body, customer="C001": client.post(f"/api/customers/{customer}/quotes", json=body).status_code
    assert post({"items": []}) == 422
    assert post({"items": [{"sku": "HS-FO30", "qty": 0}]}) == 422
    assert post({"items": [{"sku": "HS-FO30", "qty": 1}, {"sku": "HS-FO30", "qty": 2}]}) == 422
    assert post({"items": [{"sku": "NOPE", "qty": 1}]}) == 422
    assert post({"items": [{"sku": "HS-FO30", "qty": 1}]}, customer="C002") == 404  # 王冠宇的客戶


def test_no_quote_when_sap_is_down(client):
    client.put("/api/mock-systems/sap", json={"down": True})
    response = client.post("/api/customers/C001/quotes", json={"items": [{"sku": "HS-FO30", "qty": 1}]})
    assert response.status_code == 503 and "SAP" in response.json()["detail"]
    client.put("/api/mock-systems/sap", json={"down": False})
