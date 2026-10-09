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
from app.services import festivals, negotiation, payment_terms
from app.services.documents import index_documents

CATEGORY = {product[0]: product[2] for product in catalog.PRODUCTS}
# 方法卡（catalog.METHOD_CARDS）：談判卡照這家客戶的情況帶出相關的卡
RIVAL = "御松田來搶陳列位：先守住櫃檯旁那一格"
FISH_OIL = "魚油進貨變慢：先看架位，再談價格"
CAMPAIGN = "檔期要提前 21 天送單：從活動日往回推"
SMALL_LOT = "獨立藥局小口進貨：算一盒賺多少給老闆看"
GENERICS = "慢箋量在長的診所：帶學名藥比價表去"
DISCOUNT = "客戶開口要折扣：先問量，超過 3% 不要當場答應"


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


def card_of(client, customer_id, headers=None):
    response = client.get(f"/api/customers/{customer_id}/negotiation", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def method_titles(client, customer_id, headers=None):
    return [method["title"] for method in card_of(client, customer_id, headers)["methods"]]


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


def add_order(tx, customer_id, sku, days_ago):
    """在測試的交易裡補一筆進貨（測完回滾）。金額隨意，缺口只看有沒有進"""
    tx.execute(text(
        "INSERT INTO sales_transaction (order_no, customer_id, date, sku, qty, amount, cost) "
        "VALUES (:order_no, :customer_id, app_today() - :days_ago, :sku, 10, 4000, 2500)"
    ), {"order_no": f"SO-TEST-{customer_id}-{days_ago}", "customer_id": customer_id, "sku": sku, "days_ago": days_ago})
    tx.flush()


def gap_skus(client, customer_id):
    return [gap["sku"] for gap in card_of(client, customer_id)["gaps"]]


@pytest.mark.parametrize(("days_ago", "still_a_gap"), [(100, False), (200, True)])
def test_this_customer_stocks_an_item_if_it_bought_it_within_half_a_year(client, tx, days_ago, still_a_gap):
    # 「這家沒進過」看近 180 天：忠孝店 100 天前進過葉黃素就不算缺口，200 天前進的不算數
    assert "HS-LT30" in gap_skus(client, "C001")
    add_order(tx, "C001", "HS-LT30", days_ago)
    assert ("HS-LT30" in gap_skus(client, "C001")) is still_a_gap


@pytest.mark.parametrize(("days_ago", "becomes_a_gap"), [(100, False), (80, True)])
def test_peers_stock_an_item_only_if_they_bought_it_in_the_last_90_days(client, tx, days_ago, becomes_a_gap):
    # 口罩：北區其他 31 家連鎖近 90 天只有 12 家進，不到一半。給沒進的那 19 家各補一筆進貨：
    # 補在 80 天前，31 家都有進，口罩變成缺口；補在 100 天前，半年內看是都進過，但「同區有進」只看近 90 天，不算
    assert "MD-MASK50" not in gap_skus(client, "C001")
    without = tx.execute(text(
        "SELECT id FROM customer WHERE type = 'chain' AND region = '北區' AND id <> 'C001' AND id NOT IN "
        "(SELECT customer_id FROM sales_transaction WHERE sku = 'MD-MASK50' AND date > app_today() - 90)"
    )).scalars().all()
    assert len(without) == 19
    for customer_id in without:
        add_order(tx, customer_id, "MD-MASK50", days_ago)
    gaps = card_of(client, "C001")["gaps"]
    assert ("MD-MASK50" in [gap["sku"] for gap in gaps]) is becomes_a_gap
    if becomes_a_gap:
        assert gaps[0] == {"sku": "MD-MASK50", "name": "醫用口罩 50 入", "peers_with": 31, "peers_total": 31}


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


def test_an_item_without_a_list_price_is_left_out(client, tx):
    # 資料表沒有限制建議售價要大於 0：算不出毛利率的品項直接不列，不讓整張卡因為除以零壞掉
    before = [item["sku"] for item in card_of(client, "C030")["deals"]["items"]]
    assert before[0] == "F763991"
    tx.execute(text(
        "UPDATE promotion_item SET list_price = 0 WHERE sku = 'F763991' "
        "AND promotion_id = (SELECT id FROM promotion WHERE name = '202610保藥特搭活動')"
    ))
    tx.flush()
    after = [item["sku"] for item in card_of(client, "C030")["deals"]["items"]]
    # 葡萄籽不見了，後面的往前遞補，還是五個
    assert "F763991" not in after and after[:4] == before[1:] and len(after) == negotiation.MAX_DEALS


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
    stats = client.get(f"/api/customers/{customer_id}/profile").json()["stats"]
    # 付款條件寫代碼、誰收、優惠幾 %（《付款條件與帳齡管理》）；《報價權限》業務可以直接給 3%
    assert terms["payment_term"] == payment_terms.describe(stats["payment_term"]) and terms["free_discount_pct"] == 3
    assert terms["ar_max_age_days"] == stats["ar_max_age_days"]
    assert terms["ar_overdue_days"] == stats["ar_overdue_days"]
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
        ("ar_overdue", ["帳款逾期的收款提醒"]),
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


# ── 主管教的做法：照這家客戶的情況帶出方法卡 ─────────────────────────


def test_a_chain_card_brings_the_method_cards_for_this_customers_situation(client):
    # 忠孝店近期提到競品、進貨間隔拉長，又有下一個節慶：這三種情況的卡裡，連鎖適用、採用次數最多的兩張
    methods = card_of(client, "C001")["methods"]
    assert [(method["title"], method["adopted"]) for method in methods] == [(RIVAL, 46), (FISH_OIL, 41)]
    assert len(methods) == negotiation.MAX_METHODS == 2
    # 跟方法卡頁的一張卡同一個形狀，畫面用同一個元件
    assert set(methods[0]) == {
        "id", "title", "situation", "approach", "customer_type", "tags", "author_name", "status",
        "adopted", "not_helped", "my_feedback", "updated_at",
    }
    # client 登入的是主管陳建宏，他沒在這家按過
    assert all(method["status"] == "published" and method["my_feedback"] is None for method in methods)


def test_a_cost_card_brings_the_method_cards_about_cost(client):
    # 成本導向的卡多帶「談進價與成本」：獨立藥局與診所各有一張自己的，再加每種客戶都適用的那一張。
    # 連鎖的卡（搶陳列位、續約）不會出現在這裡
    assert method_titles(client, "C030") == [SMALL_LOT, DISCOUNT]
    assert method_titles(client, "C061") == [GENERICS, DISCOUNT]


def test_a_retired_method_card_leaves_the_negotiation_card(tx, client):
    rival = card_of(client, "C001")["methods"][0]
    # client 登入的是陳建宏，這張卡的作者
    assert client.patch(f"/api/methods/{rival['id']}", json={"status": "retired"}).status_code == 200
    assert method_titles(client, "C001") == [FISH_OIL, CAMPAIGN]
    # 一張相關的卡都沒有：methods 是空的，卡片其餘照常
    tx.execute(text("UPDATE method_card SET status = 'retired'"))
    tx.flush()
    card = card_of(client, "C001")
    assert card["methods"] == [] and card["margin"]


def test_feedback_pressed_on_the_negotiation_card_is_kept_with_that_customer(tx, client, auth):
    rep = auth("U01")  # 忠孝店是林昱辰的客戶
    rival, fish_oil = card_of(client, "C001", rep)["methods"]
    # 灌資料時他在這家按過第一張「有幫上」，回饋掛在客戶上，打開談判卡就看得到；第二張還沒按過
    assert (rival["title"], rival["my_feedback"]) == (RIVAL, True)
    assert (fish_oil["title"], fish_oil["not_helped"], fish_oil["my_feedback"]) == (FISH_OIL, 7, None)

    def mine_at_this_customer() -> list[bool]:
        # 他在別家客戶也按過這張卡，這裡只看記在忠孝店的
        return list(tx.execute(
            text("SELECT helped FROM method_card_feedback WHERE card_id = :card_id AND user_id = 'U01' AND customer_id = 'C001'"),
            {"card_id": fish_oil["id"]},
        ).scalars())

    assert mine_at_this_customer() == []
    body = {"helped": False, "customer_id": "C001"}
    assert client.post(f"/api/methods/{fish_oil['id']}/feedback", json=body, headers=rep).status_code == 200
    assert mine_at_this_customer() == [False]
    # 重新打開這家的談判卡，那一顆還是選著的，次數也是按完之後的
    after = card_of(client, "C001", rep)["methods"][1]
    assert (after["id"], after["not_helped"], after["my_feedback"]) == (fish_oil["id"], 8, False)
    # 只算這一家：方法卡頁上同一張卡他還沒按過
    listed = client.get("/api/methods", headers=rep).json()
    assert next(method for method in listed if method["id"] == fish_oil["id"])["my_feedback"] is None
    # 主管打開同一家的談判卡，次數一樣，但看不到別人按了什麼
    seen = card_of(client, "C001")["methods"]
    assert [(method["not_helped"], method["my_feedback"]) for method in seen] == [(6, None), (8, None)]


def test_a_self_created_account_gets_the_method_cards_on_the_demo_reps_customers(tx, client, auth):
    created = client.post(
        "/api/auth/register", json={"name": "評審", "email": "judge@negotiation.test", "password": "judge-pass-1"}
    ).json()
    judge = {"Authorization": f"Bearer {created['token']}"}
    # 自建帳號看的是林昱辰的客戶：談判卡帶出來的卡跟他看到的一樣
    methods = card_of(client, "C001", judge)["methods"]
    assert [method["title"] for method in methods] == method_titles(client, "C001", auth("U01")) == [RIVAL, FISH_OIL]
    # 但林昱辰在這家按過的不算他的
    assert all(method["my_feedback"] is None for method in methods)
    # 回饋記在自己名下、這家客戶上
    body = {"helped": True, "customer_id": "C001"}
    assert client.post(f"/api/methods/{methods[0]['id']}/feedback", json=body, headers=judge).json()["adopted"] == 47
    rows = tx.execute(
        text("SELECT customer_id, helped FROM method_card_feedback WHERE user_id = :user_id"), {"user_id": created["user"]["id"]}
    ).all()
    assert [tuple(row) for row in rows] == [("C001", True)]
    after = card_of(client, "C001", judge)["methods"][0]
    assert (after["title"], after["adopted"], after["my_feedback"]) == (RIVAL, 47, True)
