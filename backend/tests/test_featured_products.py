"""經理的節慶主推設定持久化、團隊範圍與談判卡的單品毛利。"""

import datetime as dt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import AppSetting, AppUser, Customer, Product, Promotion, PromotionItem, SalesTransaction
from app.services import featured_products as featured, festivals

PATH = "/api/manager/featured-products"
TODAY = dt.date(2026, 10, 28)
FESTIVAL_ID = "featured-autumn"


@pytest.fixture(autouse=True)
def catalog_and_calendar(tx, monkeypatch):
    monkeypatch.setattr(festivals, "load", lambda: [
        festivals.Festival(FESTIVAL_ID, "秋季檔", TODAY + dt.timedelta(days=14), 28, ["保健品"], "顧客提醒", "成本提醒"),
        festivals.Festival("featured-winter", "冬季檔", TODAY + dt.timedelta(days=60), 28, ["保健品"], "顧客提醒", "成本提醒"),
    ])
    tx.add_all([
        Product(sku="FP-A", name="主推單品甲", category="日用品", spec="一瓶", unit="瓶", unit_price=100, unit_cost=60, aliases=[]),
        Product(sku="FP-B", name="主推單品乙", category="保健品", spec="一盒", unit="盒", unit_price=200, unit_cost=150, aliases=[]),
        Product(sku="FP-C", name="主推單品丙", category="醫材", spec="一組", unit="組", unit_price=0, unit_cost=0, aliases=[]),
    ])
    tx.flush()


@pytest.fixture
def client(tx):
    return TestClient(app)


def save(client, auth, skus, *, manager_id="M01", festival_id=FESTIVAL_ID, revision=0, viewer="M01"):
    return client.put(PATH, headers=auth(viewer), json={
        "manager_id": manager_id, "festival_id": festival_id, "revision": revision, "skus": skus,
    })


def customer(tx, owner, kind="chain"):
    return tx.scalar(select(Customer).where(Customer.owner_user_id == owner, Customer.type == kind).order_by(Customer.id))


def card(client, auth, target, viewer="U01"):
    response = client.get(f"/api/customers/{target.id}/negotiation", headers=auth(viewer))
    assert response.status_code == 200, response.text
    return response.json()


def test_permissions_and_it_can_select_each_team(client, auth):
    assert client.get(PATH).status_code == 401
    assert client.get(PATH, headers=auth("U01")).status_code == 403
    assert save(client, auth, ["FP-A"], viewer="U01").status_code == 403
    assert client.get(PATH + "?manager_id=M02", headers=auth("M01")).status_code == 404
    assert save(client, auth, ["FP-A"], manager_id="M02").status_code == 404
    settings = client.get(PATH, headers=auth("M01")).json()
    assert settings["manager_id"] == "M01" and settings["festival_id"] == FESTIVAL_ID
    assert settings["managers"] == [{"id": "M01", "name": "陳建宏"}]
    assert settings["skus"] == [] and settings["revision"] == 0
    all_teams = client.get(PATH, headers=auth("A01")).json()
    assert len(all_teams["managers"]) == 4
    assert save(client, auth, ["FP-A"], manager_id="M02", viewer="A01").status_code == 200


def test_save_reload_clear_and_stale_revision_preserve_newer_selection(client, auth, tx):
    response = save(client, auth, ["FP-B", "FP-A"])
    assert response.status_code == 200, response.text
    assert response.json()["revision"] == 1
    assert client.get(PATH, headers=auth("M01")).json()["skus"] == ["FP-B", "FP-A"]
    assert tx.get(AppSetting, featured.PREFIX + "M01:" + FESTIVAL_ID) is not None
    assert save(client, auth, ["FP-C"]).status_code == 409
    assert client.get(PATH, headers=auth("M01")).json()["skus"] == ["FP-B", "FP-A"]
    cleared = save(client, auth, [], revision=1)
    assert cleared.status_code == 200 and cleared.json()["revision"] == 2
    assert card(client, auth, customer(tx, "U01"))["featured"] is None


@pytest.mark.parametrize("skus", [["not-a-product"], ["HS-FO30"], ["FP-A", "FP-A"], [""], ["FP-A"] * 101])
def test_invalid_hidden_duplicate_and_excessive_products_do_not_write(client, auth, tx, skus):
    assert save(client, auth, skus).status_code == 422
    assert tx.get(AppSetting, featured.PREFIX + "M01:" + FESTIVAL_ID) is None


def test_unknown_and_past_festivals_are_rejected(client, auth):
    assert save(client, auth, ["FP-A"], festival_id="absent").status_code == 404
    assert client.get(PATH + "?festival_id=absent", headers=auth("M01")).status_code == 404


def test_single_products_without_purchase_history_or_matching_category_lead_the_card(client, auth, tx):
    assert save(client, auth, ["FP-B", "FP-A"]).status_code == 200
    target = customer(tx, "U01")
    assert tx.scalar(select(SalesTransaction.id).where(SalesTransaction.sku.in_(["FP-A", "FP-B"]))) is None
    result = card(client, auth, target)
    block = result["featured"]
    assert block["manager_id"] == "M01" and block["manager_name"] == "陳建宏"
    assert [p["sku"] for p in block["items"]] == ["FP-B", "FP-A"]
    item = block["items"][1]
    assert item["supply_price"] == 90 and item["unit_cost"] == 60
    assert item["unit_margin"] == 30 and item["margin_rate"] == pytest.approx(1 / 3, abs=0.0001)
    assert item["price_source"] == "標準供貨價"
    # 查看者不影響主推來源；同主管的另一位業務也適用，其他團隊不受影響。
    assert card(client, auth, target, "A01")["featured"] == block
    assert card(client, auth, customer(tx, "U02"), "M01")["featured"]["manager_id"] == "M01"
    assert card(client, auth, customer(tx, "U03"), "A01")["featured"] is None


@pytest.mark.parametrize("kind,price,margin", [("independent", 95, 35), ("clinic", 100, 40)])
def test_cost_orientation_uses_customer_type_supply_price(client, auth, tx, kind, price, margin):
    assert save(client, auth, ["FP-A"]).status_code == 200
    result = card(client, auth, customer(tx, "U01", kind))
    assert result["orientation"] == "cost"
    assert result["featured"]["items"][0]["supply_price"] == price
    assert result["featured"]["items"][0]["unit_margin"] == margin


def test_best_current_promotion_is_used_and_negative_margin_is_not_hidden(client, auth, tx):
    tx.add(Promotion(id="FP-PROMO", name="主推驗證促銷", type="搭贈", department="業務", start_date=TODAY, end_date=TODAY + dt.timedelta(days=3), pm_note=""))
    tx.flush()
    for code, qty, free, price in [("FP-LOT-A", 10, 0, 700), ("FP-LOT-B", 10, 10, 1000)]:
        tx.add(PromotionItem(code=code, promotion_id="FP-PROMO", group_name="主推", name="單品甲搭贈", sku="FP-A", deal=f"{qty}+{free}", buy_qty=qty, free_qty=free, deal_price=price, list_price=100, ship_price=90))
    tx.flush()
    assert save(client, auth, ["FP-A"]).status_code == 200
    item = card(client, auth, customer(tx, "U01"))["featured"]["items"][0]
    assert item["supply_price"] == 50 and item["unit_margin"] == -10
    assert item["margin_rate"] == -0.2 and item["deal"] == "10+10"
    assert item["price_source"] == "主推驗證促銷"


def test_missing_price_and_cost_are_unknown_and_catalog_removal_is_respected(client, auth, tx):
    tx.get(Product, "FP-B").unit_cost = 0
    tx.flush()
    assert save(client, auth, ["FP-C", "FP-B"]).status_code == 200
    target = customer(tx, "U01")
    items = card(client, auth, target)["featured"]["items"]
    assert items[0]["supply_price"] is None and items[0]["unit_cost"] is None
    assert all(item["margin_rate"] is None and item["unit_margin"] is None for item in items)
    tx.get(Product, "FP-B").name = "測試商品已下架"
    tx.flush()
    assert [p["sku"] for p in card(client, auth, target)["featured"]["items"]] == ["FP-C"]


def test_future_festival_settings_only_apply_when_that_festival_is_next(client, auth, tx, monkeypatch):
    assert save(client, auth, ["FP-A"], festival_id="featured-winter").status_code == 200
    target = customer(tx, "U01")
    assert card(client, auth, target)["featured"] is None
    calendar = festivals.load()
    monkeypatch.setattr(festivals, "load", lambda: calendar[1:])
    assert card(client, auth, target)["featured"]["festival_id"] == "featured-winter"
    monkeypatch.setattr(festivals, "load", lambda: [])
    assert card(client, auth, target)["featured"] is None
    settings = client.get(PATH, headers=auth("M01")).json()
    assert settings["festival_id"] is None and settings["festivals"] == []


def test_shared_region_does_not_share_different_managers_selection(client, auth, tx):
    assert save(client, auth, ["FP-A"], manager_id="M03", viewer="A01").status_code == 200
    assert card(client, auth, customer(tx, "U04"), "A01")["featured"]["manager_id"] == "M03"
    assert card(client, auth, customer(tx, "U05"), "A01")["featured"] is None


def test_deactivated_manager_and_unowned_customer_have_no_featured_products(client, auth, tx):
    assert save(client, auth, ["FP-A"]).status_code == 200
    target = customer(tx, "U01")
    tx.get(AppUser, "M01").deactivated_at = dt.datetime.now(dt.UTC)
    tx.flush()
    assert featured.for_customer(tx, target, festivals.load()[0]) is None
    unowned = Customer(id="FP-OUTLET", name="主推未分派通路", type="outlet", region="北區")
    assert featured.for_customer(tx, unowned, festivals.load()[0]) is None
