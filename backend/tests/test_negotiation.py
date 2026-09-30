"""談判卡（FR-3）：每種客戶都有，圍繞下一個節慶。

連鎖是顧客導向（檔期、架上、缺口、毛利底線），獨立藥局與診所是成本導向（這一檔的進價、這家的條件）。
用灌好的假資料檢查數字與內部文件的切入點。
"""

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
    # 用到的 C001、C002、C030、C061 分屬北區兩位業務，他們的主管 M01 都看得到
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
    assert card["margin"]
    # 忠孝店近期提到競品、進貨間隔拉長：沒有節慶可談，切入點就從這兩個情況開始
    assert [tip["reason"] for tip in card["tips"][:2]] == ["近 90 天的拜訪提到競品", "進貨間隔拉長"]
    assert [tip["section"] for tip in card["tips"][:2]] == ["陳列位被調降或被競品取代", "檔期活動的申請期限"]


def test_the_card_shows_our_margin_floor_and_quotes_company_documents(client, company_docs):
    card = card_of(client, "C001")
    margin = card["margin"]
    assert 0 < margin["net_margin_rate"] < 1 and margin["summary"].startswith("上架費")
    # 有下一個節慶：檔期的規定只占一段（期限與上限的數字「檔期」那一區已經算好），
    # 另外兩段留給這家自己的情況：近期提到競品、進貨間隔拉長。內容是內部文件的原文
    assert [tip["section"] for tip in card["tips"]] == ["檔期費用的上限與核准", "陳列位被調降或被競品取代", "檔期活動的申請期限"]
    assert [tip["reason"] for tip in card["tips"][1:]] == ["近 90 天的拜訪提到競品", "進貨間隔拉長"]
    assert "由區處主管在 OA 核准" in card["tips"][0]["content"] and "活動開始日前 21 天" in card["tips"][2]["content"]


def test_a_section_already_quoted_is_not_replaced_by_a_weaker_match(engine, company_docs, tmp_path, monkeypatch):
    # 兩筆要找的是同一段：後面那一筆就跳過，不拿次相關的段落充數
    topics = [
        {"signal": "festival", "reason": "第一筆", "keywords": ["檔期活動", "申請期限"]},
        {"signal": "interval_up", "reason": "第二筆", "keywords": ["檔期活動", "申請期限"]},
    ]
    path = tmp_path / "topics.json"
    path.write_text(json.dumps({"topics": topics}, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(negotiation, "TOPICS_FILE", path)
    with Session(engine) as session:
        tips = negotiation._tips(session, {"festival", "interval_up"})
    assert [(tip.reason, tip.section) for tip in tips] == [("第一筆", "檔期活動的申請期限")]


# ── 獨立藥局與診所：成本導向 ─────────────────────────────────────────


def promotion_lots(engine, sku):
    """進行中那一期裡這個料號的每一口，數字直接讀語意層的 View"""
    with engine.connect() as conn:
        return conn.execute(text(
            "SELECT promotion_name, item_name, category, deal, deal_price, unit_deal_price, list_price "
            "FROM v_promotion_item WHERE status = '進行中' AND sku = :sku ORDER BY unit_deal_price, deal_price"
        ), {"sku": sku}).all()


@pytest.mark.parametrize("customer_id", ["C030", "C061"])  # 明德藥局（獨立藥局）、杏林診所
def test_independent_pharmacies_and_clinics_get_a_cost_oriented_card(client, customer_id):
    card = card_of(client, customer_id)
    assert card["orientation"] == "cost"
    double11 = next(festival for festival in festivals.load() if festival.id == "2026-double11")
    # 同一個節慶，換成「這一檔進貨要注意什麼」那一句
    assert (card["festival"]["name"], card["festival"]["days_left"]) == ("雙 11", 14)
    assert card["festival"]["note"] == double11.cost_note
    # 檔期、架上、缺口、毛利底線是連鎖的
    assert card["campaign"] is None and card["shelf"] is None and card["gaps"] is None and card["margin"] is None
    assert card["deals"]["items"] and card["terms"]


def test_deals_are_the_cheapest_lot_of_each_item_in_the_running_promotion(client, engine):
    card = card_of(client, "C030")
    deals = card["deals"]
    assert deals["promotion_name"] == "202610保藥特搭活動" and deals["scoped"] is True
    items = deals["items"]
    # 一個料號一列，照毛利率由高到低，最多五個
    assert len(items) == negotiation.MAX_DEALS == 5
    assert len({item["sku"] for item in items}) == len(items)
    assert [item["profit_rate"] for item in items] == sorted((item["profit_rate"] for item in items), reverse=True)
    for item in items:
        lots = promotion_lots(engine, item["sku"])
        best = lots[0]
        assert best.category in card["festival"]["categories"]
        # 數字跟促銷頁、問答查到的是同一份：每個平均價是 View 算的
        assert (item["name"], item["deal"]) == (best.item_name, best.deal)
        assert (item["deal_price"], item["unit_deal_price"], item["list_price"]) == (
            float(best.deal_price), float(best.unit_deal_price), float(best.list_price),
        )
        assert item["unit_profit"] == pytest.approx(float(best.list_price - best.unit_deal_price))
        assert item["profit_rate"] == pytest.approx(float(1 - best.unit_deal_price / best.list_price), abs=0.0001)
        assert item["smallest_deal_price"] == float(min(lot.deal_price for lot in lots))
    # 固循魚油有三口：每個最便宜的是大口（買 17 送 3，每個 841.5），最小一口是 5 盒直走 4,650
    fish_oil = next(item for item in items if item["sku"] == "F764521")
    assert (fish_oil["deal_price"], fish_oil["unit_deal_price"], fish_oil["smallest_deal_price"]) == (16830, 841.5, 4650)
    assert (fish_oil["unit_profit"], fish_oil["profit_rate"]) == (1038.5, 0.5524)


def test_deals_fall_back_to_every_category_when_the_festival_has_no_promotion_items(client, calendar):
    # 促銷品項沒有慢性處方：主推品類裡沒有東西可列，就列全部品類並標明
    calendar({"id": "a", "name": "雙 11", "date": "2026-11-11", "categories": ["慢性處方"]})
    deals = card_of(client, "C030")["deals"]
    assert deals["scoped"] is False and len(deals["items"]) == negotiation.MAX_DEALS
    # 全部品類裡賣一個賺最多成數的是雄讚
    assert deals["items"][0]["sku"] == "C490074"


def test_deals_ignore_promotions_that_are_not_running(client, tx):
    # 把上一期（已結束）的每口售價改成 1 元：卡片只看進行中那一期，數字不受影響
    before = card_of(client, "C030")["deals"]
    tx.execute(text(
        "UPDATE promotion_item SET deal_price = 1 WHERE promotion_id = (SELECT id FROM promotion WHERE name = '202609保藥特搭活動')"
    ))
    tx.flush()
    assert card_of(client, "C030")["deals"] == before


def test_no_running_promotion_means_no_deals(client, tx):
    tx.execute(text("UPDATE promotion SET end_date = app_today() - 1 WHERE end_date >= app_today()"))
    tx.flush()
    assert card_of(client, "C030")["deals"] == {"items": [], "scoped": False, "promotion_name": None}


@pytest.mark.parametrize(
    ("customer_id", "supply_rate", "channel_reward_rate"),
    [
        ("C030", 0.95, 0.02),  # 獨立藥局：建議售價的 95%，通路獎勵 2%
        ("C061", 1.0, None),  # 診所：照建議售價，不適用通路獎勵
    ],
)
def test_terms_depend_on_the_customer_type(client, customer_id, supply_rate, channel_reward_rate):
    terms = card_of(client, customer_id)["terms"]
    assert (terms["supply_rate"], terms["channel_reward_rate"]) == (supply_rate, channel_reward_rate)
    # 《付款條件與帳齡管理》月結 30 天；《報價權限》業務可以直接給 3%
    assert (terms["payment_days"], terms["free_discount_pct"]) == (30, 3)
    stats = client.get(f"/api/customers/{customer_id}/profile").json()["stats"]
    assert terms["ar_max_age_days"] == stats["ar_max_age_days"]
    assert terms["amount_last_90d"] == stats["amount_last_90d"] > 0
    assert terms["avg_order_amount"] == stats["avg_order_amount_last_90d"]


def test_a_cost_card_opens_its_tips_with_discount_authority_and_channel_fees(client, company_docs):
    tips = card_of(client, "C030")["tips"]
    assert [(tip["doc_title"], tip["section"]) for tip in tips[:2]] == [
        ("報價權限與折扣審核", "業務的折扣權限"),
        ("連鎖通路合約條件：上架費與通路獎勵", "獨立藥局與診所的通路費用"),
    ]
    assert len(tips) <= 3


def test_a_cost_card_does_not_quote_the_chain_renewal_clause(client, company_docs):
    # 恆安藥局（獨立藥局）的合約 2027-01-21 到期，在 90 天內：客戶檔案照舊提醒要談續約，
    # 但續約那一段講的是連鎖的上架費率與通路獎勵比率，獨立藥局沒有上架費，卡上不引
    highlights = client.get("/api/customers/C148/profile").json()["highlights"]
    assert any("到期，要開始談續約" in line for line in highlights)
    tips = card_of(client, "C148")["tips"]
    assert "連鎖合約的續約與費率調整" not in [tip["section"] for tip in tips]
    assert [tip["section"] for tip in tips[:2]] == ["業務的折扣權限", "獨立藥局與診所的通路費用"]
    # 連鎖的卡照舊引：福安信義店的合約 2027-01-04 到期
    assert "連鎖合約的續約與費率調整" in [tip["section"] for tip in card_of(client, "C010")["tips"]]


@pytest.mark.parametrize(
    ("signal", "sections"),
    [
        ("festival", ["檔期費用的上限與核准"]),
        ("cost", ["業務的折扣權限", "獨立藥局與診所的通路費用"]),
        ("competitor", ["陳列位被調降或被競品取代"]),
        ("interval_up", ["檔期活動的申請期限"]),
        ("contract_ending", ["連鎖合約的續約與費率調整"]),
        ("ar_overdue", ["帳齡超過 60 天的處理"]),
        ("chain", ["陳列位與上架費的連動"]),
    ],
)
def test_each_topic_in_the_settings_finds_its_intended_section(engine, company_docs, signal, sections):
    """negotiation_topics.json 的每組關鍵字都要找到想要的段落；改了文件或關鍵字，這裡會先發現。
    cost 有兩筆，各找一段"""
    topics = json.loads(negotiation.TOPICS_FILE.read_text(encoding="utf-8"))["topics"]
    with Session(engine) as session:
        found = [negotiation._best_section(session, topic["keywords"]).section for topic in topics if topic["signal"] == signal]
    assert found == sections


def test_the_festival_and_cost_topics_come_first_in_the_settings():
    topics = json.loads(negotiation.TOPICS_FILE.read_text(encoding="utf-8"))["topics"]
    assert [topic["signal"] for topic in topics] == [
        "festival", "cost", "cost", "competitor", "interval_up", "contract_ending", "ar_overdue", "chain",
    ]
