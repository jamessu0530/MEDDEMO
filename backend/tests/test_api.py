import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client(engine):
    return TestClient(app)


def test_health_reports_ok_when_database_is_reachable(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_customer_list_returns_every_customer_with_last_visit(client):
    customers = client.get("/api/customers").json()
    assert len(customers) == 250
    zhongxiao = next(c for c in customers if c["name"] == "康泰連鎖藥局 · 忠孝店")
    assert zhongxiao["last_visit_date"] == "2026-10-19"
    assert zhongxiao["owner_name"] == "林昱辰"


def test_customer_list_filters_by_name(client):
    names = [c["name"] for c in client.get("/api/customers", params={"q": "康泰"}).json()]
    assert len(names) == 18
    assert all("康泰" in name for name in names)


def test_single_customer_lookup(client):
    assert client.get("/api/customers/C001").json()["name"] == "康泰連鎖藥局 · 忠孝店"
    assert client.get("/api/customers/C999").status_code == 404


def test_product_list_includes_spoken_aliases(client):
    products = {p["sku"]: p for p in client.get("/api/products").json()}
    assert len(products) == 40
    assert "魚油" in products["HS-FO30"]["aliases"]
