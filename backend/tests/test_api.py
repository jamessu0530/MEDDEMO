import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client(engine, sign_in):
    return sign_in(TestClient(app), "U01")


def test_health_reports_ok_when_database_is_reachable(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_customer_list_returns_every_customer_with_last_visit(client):
    customers = client.get("/api/customers").json()
    # 客戶清單全國共享（services/scope.py），253 家客戶不分負責人一律列出
    assert len(customers) == 253
    zhongxiao = next(c for c in customers if c["name"] == "康泰連鎖藥局 · 忠孝店")
    assert zhongxiao["last_visit_date"] == "2026-10-19"
    assert zhongxiao["owner_name"] == "林昱辰"


def test_customer_list_filters_by_name(client):
    names = [c["name"] for c in client.get("/api/customers", params={"q": "康泰"}).json()]
    assert len(names) == len(set(names)) > 0
    assert all("康泰" in name for name in names)


def test_single_customer_lookup(client):
    assert client.get("/api/customers/C001").json()["name"] == "康泰連鎖藥局 · 忠孝店"
    assert client.get("/api/customers/C999").status_code == 404


def test_promotions_list_every_period_newest_first(client):
    promotions = client.get("/api/promotions").json()
    assert [(p["name"], p["status"]) for p in promotions] == [
        ("202610保藥特搭活動", "進行中"), ("202609保藥特搭活動", "已結束"), ("202608保藥特搭活動", "已結束"),
    ]
    current = promotions[0]
    assert len(current["items"]) == 34 and "骨營滿額贈" in current["pm_note"]
    # 數字跟問答查的 v_promotion_item 是同一份：骨營膠囊小口 <11+1>，每口 11,550、平均每個 962.5
    small = next(i for i in current["items"] if i["name"] == "骨營膠囊600T(小口)")
    assert (small["buy_qty"], small["free_qty"], small["deal_price"], small["unit_deal_price"]) == (11, 1, 11550, 962.5)


def test_promotions_need_sign_in(engine):
    # 促銷不分客戶，但價格是公司內部的，沒登入拿不到
    assert TestClient(app).get("/api/promotions").status_code == 401


def test_product_list_includes_spoken_aliases(client):
    products = {p["sku"]: p for p in client.get("/api/products").json()}
    # 40 個虛構品項、促銷方案的 20 個真實品項，加上真實型錄；確認頁的預設選單只列常用品項
    assert len(products) > 1500
    assert "魚油" in products["HS-FO30"]["aliases"] and products["HS-FO30"]["common"]
    assert products["C490191"]["common"] and "虎讚" in products["C490191"]["aliases"]
    assert not products["F762505"]["common"]
