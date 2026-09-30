"""談判卡（FR-3）：每種客戶都有，圍繞下一個節慶。用灌好的假資料檢查檔期、架上、缺口與內部文件的切入點。"""

import json

import catalog
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.main import app
from app.services import festivals, negotiation
from app.services.documents import index_documents

CATEGORY = {product[0]: product[2] for product in catalog.PRODUCTS}


@pytest.fixture
def client(engine, sign_in):
    # 用到的 C001、C002、C030 分屬北區兩位業務，他們的主管 M01 都看得到
    return sign_in(TestClient(app), "M01")


@pytest.fixture
def company_docs(engine):
    """重建成完整的 20 份內部文件：別的測試會把索引換成兩份測試用文件。"""
    with Session(engine) as session:
        index_documents(session)
        session.commit()


@pytest.fixture
def calendar(tmp_path, monkeypatch):
    """這個測試裡換一份節慶行事曆。每一筆只要寫跟預設不一樣的欄位。"""

    def use(*rows):
        defaults = {"lead_days": 28, "categories": ["保健品"], "customer_note": "顧客的一句話", "cost_note": "成本的一句話"}
        path = tmp_path / "festivals.json"
        path.write_text(json.dumps({"festivals": [defaults | row for row in rows]}, ensure_ascii=False), encoding="utf-8")
        monkeypatch.setattr(festivals, "FESTIVALS_FILE", path)

    return use


def card_of(client, customer_id):
    response = client.get(f"/api/customers/{customer_id}/negotiation")
    assert response.status_code == 200, response.text
    return response.json()


def test_a_chain_card_is_customer_oriented_and_opens_with_the_next_festival(client):
    card = card_of(client, "C001")
    assert card["orientation"] == "customer"
    # 決賽日 10/28 的下一個節慶是雙 11，還有 14 天；連鎖看的是「顧客在買什麼」那一句
    double11 = next(festival for festival in festivals.load() if festival.id == "2026-double11")
    assert card["festival"] == {
        "name": "雙 11",
        "date": "2026-11-11",
        "days_left": 14,
        "categories": double11.categories,
        "note": double11.customer_note,
    }
    # 成本導向的兩區是獨立藥局與診所的
    assert card["deals"] is None and card["terms"] is None


def test_the_campaign_moves_on_to_the_next_festival_still_open_for_application(client):
    card = card_of(client, "C001")
    # 雙 11 的檔期 9/23 就要送申請，來不及了；過年（2/6）提前 28 天開賣、再早 21 天申請
    assert card["campaign"]["missed"] == ["雙 11"]
    assert (card["campaign"]["festival_name"], card["campaign"]["festival_date"]) == ("過年", "2027-02-06")
    assert (card["campaign"]["apply_by"], card["campaign"]["days_to_apply"]) == ("2026-12-19", 52)
    # 《檔期活動》：檔期費用以前 3 個月平均月進貨金額的 15% 為上限
    amount = client.get("/api/customers/C001/profile").json()["stats"]["amount_last_90d"]
    assert card["campaign"]["fee_cap"] == round(amount / 3 * 0.15) > 0


def test_every_festival_past_its_deadline_is_listed_as_missed(client, calendar):
    calendar(
        {"id": "a", "name": "雙 11", "date": "2026-11-11"},
        {"id": "b", "name": "雙 12", "date": "2026-12-12"},  # 開賣 11/14，申請期限 10/24，也過了
        {"id": "c", "name": "過年", "date": "2027-02-06"},
    )
    campaign = card_of(client, "C001")["campaign"]
    assert (campaign["missed"], campaign["festival_name"]) == (["雙 11", "雙 12"], "過年")


def test_the_deadline_day_itself_still_counts(client, calendar):
    # 節日 12/16，開賣 11/18，申請期限正好是今天 10/28
    calendar({"id": "a", "name": "聖誕", "date": "2026-12-16"})
    campaign = card_of(client, "C001")["campaign"]
    assert (campaign["apply_by"], campaign["days_to_apply"], campaign["missed"]) == ("2026-10-28", 0, [])


def test_the_shelf_lists_only_items_in_the_festival_categories(client):
    card = card_of(client, "C001")
    shelf = card["shelf"]
    assert shelf["scoped"] is True
    assert 0 < len(shelf["items"]) <= negotiation.TOP_SKUS
    assert {CATEGORY[item["sku"]] for item in shelf["items"]} <= set(card["festival"]["categories"])
    assert all(item["orders_per_month"] >= 0 for item in shelf["items"])
    assert any(item["region_orders_per_month"] for item in shelf["items"])


def test_the_shelf_falls_back_to_every_category_when_the_customer_stocks_none(client, calendar):
    # 連鎖藥局不進慢性處方：主推品類裡一項都沒有，就退回不分品類並標明
    calendar({"id": "a", "name": "雙 11", "date": "2026-11-11", "categories": ["慢性處方"]})
    shelf = card_of(client, "C001")["shelf"]
    assert shelf["scoped"] is False
    assert len(shelf["items"]) == negotiation.TOP_SKUS
    assert "慢性處方" not in {CATEGORY[item["sku"]] for item in shelf["items"]}


def test_gaps_are_what_most_chains_nearby_stock_and_this_one_does_not(client, engine):
    card = card_of(client, "C001")
    # 北區另外 31 家連鎖，近 90 天 21 家進了葉黃素、19 家進了鐵劑，忠孝店半年沒進過。
    # 口罩只有 12 家進（不到一半）、止痛錠不在雙 11 的主推品類，都不列
    assert card["gaps"] == [
        {"sku": "HS-LT30", "name": "葉黃素 30 入", "peers_with": 21, "peers_total": 31},
        {"sku": "HS-FE30", "name": "鐵劑 30 入", "peers_with": 19, "peers_total": 31},
    ]
    with engine.connect() as conn:
        bought = set(conn.execute(text(
            "SELECT DISTINCT sku FROM sales_transaction WHERE customer_id = 'C001' AND date > app_today() - 180"
        )).scalars())
    assert not bought & {gap["sku"] for gap in card["gaps"]}


def test_gaps_stop_at_three(client):
    # 南京店在主推品類裡缺五個同區過半有進的品項，只列最多人進的三個
    card = card_of(client, "C002")
    gaps = card["gaps"]
    assert len(gaps) == negotiation.MAX_GAPS == 3
    assert [gap["peers_with"] for gap in gaps] == sorted((gap["peers_with"] for gap in gaps), reverse=True)
    assert all(gap["peers_with"] * 2 > gap["peers_total"] for gap in gaps)
    assert {CATEGORY[gap["sku"]] for gap in gaps} <= set(card["festival"]["categories"])


def test_without_a_festival_the_rest_of_the_card_still_shows(client, company_docs, tmp_path, monkeypatch):
    monkeypatch.setattr(festivals, "FESTIVALS_FILE", tmp_path / "missing.json")
    card = card_of(client, "C001")
    assert card["festival"] is None and card["campaign"] is None
    # 沒有主推品類可以限定，也就沒有缺口可比
    assert card["shelf"]["scoped"] is False and len(card["shelf"]["items"]) == negotiation.TOP_SKUS
    assert card["gaps"] == []
    assert card["margin"] and card["tips"]


def test_the_card_shows_our_margin_floor_and_quotes_company_documents(client, company_docs):
    card = card_of(client, "C001")
    margin = card["margin"]
    assert 0 < margin["net_margin_rate"] < 1 and margin["summary"].startswith("上架費")
    # 忠孝店近期提到競品、進貨間隔拉長：切入點依序是這兩個情況，內容是內部文件的原文
    assert [tip["reason"] for tip in card["tips"][:2]] == ["近 90 天的拜訪提到競品", "進貨間隔拉長"]
    assert [tip["section"] for tip in card["tips"][:2]] == ["陳列位被調降或被競品取代", "檔期活動的申請期限"]
    assert len(card["tips"]) <= 3


def test_only_chain_customers_have_a_negotiation_card(client):
    assert client.get("/api/customers/C030/negotiation").status_code == 409


@pytest.mark.parametrize(
    ("signal", "section"),
    [
        ("competitor", "陳列位被調降或被競品取代"),
        ("interval_up", "檔期活動的申請期限"),
        ("contract_ending", "連鎖合約的續約與費率調整"),
        ("ar_overdue", "帳齡超過 60 天的處理"),
        ("chain", "陳列位與上架費的連動"),
    ],
)
def test_each_topic_in_the_settings_finds_its_intended_section(engine, company_docs, signal, section):
    """negotiation_topics.json 的每組關鍵字都要找到想要的段落；改了文件或關鍵字，這裡會先發現"""
    topics = {topic["signal"]: topic for topic in json.loads(negotiation.TOPICS_FILE.read_text(encoding="utf-8"))["topics"]}
    with Session(engine) as session:
        assert negotiation._best_section(session, topics[signal]["keywords"], set()).section == section
