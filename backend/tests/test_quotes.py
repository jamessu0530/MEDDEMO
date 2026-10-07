"""客戶檔案「開報價」：不必先有一次拜訪，直接開 SAP 報價草稿；折扣超過業務的權限就開優惠申請單送簽。"""

import datetime as dt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text, update
from test_approvals import fake_model, model  # noqa: F401  model 是 fixture

from app.main import app
from app.models import AppUser, OaExpenseForm, SapQuotationDraft
from app.services import auth as auth_service
from app.services import promo_packs, today_route
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


def test_each_quote_line_keeps_its_own_amount(client, engine):
    quote = client.post("/api/customers/C001/quotes", json={"items": [{"sku": "HS-FO30", "qty": 20}]}).json()
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT amount, discount_pct, free_qty, promo_code, packs FROM sap_quotation_draft WHERE quote_no = :q"),
            {"q": quote["quote_no"]},
        ).one()
    # 康泰忠孝店是連鎖：魚油 30 入 405 元 × 20
    assert (float(row.amount), float(row.discount_pct), row.free_qty, row.promo_code, row.packs) == (8100, 0, 0, None, None)


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


# ── 折扣：3% 以內業務自己決定，超過就開優惠申請單（規則與模型在 test_approvals.py）────────────
# 這一段跑在 tx 裡：API 與測試共用一條連線，測完回滾，不必自己清報價與申請單

FISH_OIL = [{"sku": "HS-FO30", "qty": 100}]


@pytest.fixture
def api():
    yield TestClient(app)
    redis().flushdb()


def open_quote(api, auth, discount_pct, reason="競品開買十送一", customer="C001", user="U01", items=FISH_OIL):
    body = {"items": items, "discount_pct": discount_pct} | ({"reason": reason} if reason is not None else {})
    return api.post(f"/api/customers/{customer}/quotes", json=body, headers=auth(user))


def discount_forms(tx) -> int:
    return tx.scalar(select(func.count()).select_from(OaExpenseForm).where(OaExpenseForm.kind == "discount"))


def open_quotes(api, auth, customer="C001"):
    profile = api.get(f"/api/customers/{customer}/profile", headers=auth("U01")).json()
    return {q["quote_no"]: q for q in profile["open_quotes"]}


def test_a_discount_within_three_percent_needs_no_approval(tx, api, auth, model):
    before = discount_forms(tx)
    created = open_quote(api, auth, 3, reason=None)
    assert created.status_code == 201
    quote = created.json()
    assert (quote["status"], quote["discount_pct"], quote["approval"]) == ("draft", 3.0, None)
    # 折扣套在標準供貨價上：魚油給連鎖 405 元，打 97 折
    assert quote["items"][0]["unit_price"] == 392.85 and quote["amount"] == 39285
    assert discount_forms(tx) == before
    assert open_quotes(api, auth)[quote["quote_no"]]["status"] == "draft"
    # 沒填折扣就是照原價，跟以前一樣
    plain = api.post("/api/customers/C001/quotes", json={"items": FISH_OIL}, headers=auth("U01")).json()
    assert (plain["status"], plain["discount_pct"], plain["amount"], plain["approval"]) == ("draft", 0.0, 40500, None)


def test_a_deeper_discount_waits_for_the_manager_before_it_counts(tx, api, auth, model):
    route_before = today_route._opportunities(tx, "U01", dt.date(2026, 10, 28))
    created = open_quote(api, auth, 7)
    assert created.status_code == 201
    quote = created.json()
    assert (quote["status"], quote["discount_pct"], quote["amount"]) == ("pending_approval", 7.0, 37665)
    approval = quote["approval"]
    assert (approval["status"], approval["auto_approved"], approval["probability"]) == ("pending", False, None)
    assert approval["form_no"].startswith("DC202610")
    assert approval["waiting_for"] == {"step": "區處主管", "name": "陳建宏"}

    form = tx.get(OaExpenseForm, approval["form_id"])
    assert (form.applicant_id, form.required_level) == ("U01", "manager")
    assert form.payload == {
        "quote_no": quote["quote_no"], "discount_pct": 7.0, "list_amount": 40500, "amount": 37665, "cost": 27000,
        "reason": "競品開買十送一", "total_amount": 37665,
    }
    # 客戶檔案列出來並標明還在等簽核；還沒核准的報價不算今日路線的商機
    assert open_quotes(api, auth)[quote["quote_no"]]["status"] == "pending_approval"
    assert today_route._opportunities(tx, "U01", dt.date(2026, 10, 28)) == route_before

    decided = api.post(f"/api/oa/forms/{form.id}/decide", json={"action": "approve"}, headers=auth("M01"))
    assert decided.json()["status"] == "approved"
    assert open_quotes(api, auth)[quote["quote_no"]]["status"] == "draft"


def test_a_rejected_quote_drops_out_of_the_profile(tx, api, auth, model):
    quote = open_quote(api, auth, 7).json()
    api.post(f"/api/oa/forms/{quote['approval']['form_id']}/decide", json={"action": "reject"}, headers=auth("M01"))
    assert quote["quote_no"] not in open_quotes(api, auth)
    assert tx.scalar(select(SapQuotationDraft.status).where(SapQuotationDraft.quote_no == quote["quote_no"])) == "rejected"


def test_a_confident_model_approves_the_quote_on_the_spot(tx, api, auth, model):
    model(fake_model(0.94))
    quote = open_quote(api, auth, 5).json()
    assert quote["status"] == "draft"
    assert quote["approval"]["status"] == "approved" and quote["approval"]["auto_approved"] is True
    assert quote["approval"]["probability"] == pytest.approx(0.94) and quote["approval"]["waiting_for"] is None
    # 鶯歌店有帳款拖超過 60 天，一樣的折扣就要人簽
    late = open_quote(api, auth, 5, customer="C099").json()
    assert (late["status"], late["approval"]["status"], late["approval"]["auto_approved"]) == ("pending_approval", "pending", False)
    # 超過區處主管的權限，模型不碰
    deep = open_quote(api, auth, 10).json()
    assert deep["approval"]["waiting_for"] == {"step": "區處主管", "name": "陳建宏"} and deep["status"] == "pending_approval"


def test_bad_discounts_are_rejected(tx, api, auth, model):
    before = tx.scalar(select(func.count()).select_from(SapQuotationDraft))
    assert open_quote(api, auth, 3.5, reason=None).status_code == 422  # 超過 3% 要寫理由
    assert open_quote(api, auth, 3.5, reason="   ").status_code == 422
    assert open_quote(api, auth, 3.5, reason="長" * 501).status_code == 422
    assert open_quote(api, auth, 2.3).status_code == 422  # 每 0.5% 一格
    assert open_quote(api, auth, 20.5).status_code == 422  # 最多 20%
    assert open_quote(api, auth, -1).status_code == 422
    assert "超過 3%" in open_quote(api, auth, 3.5, reason=None).json()["detail"]
    assert tx.scalar(select(func.count()).select_from(SapQuotationDraft)) == before


def test_nothing_is_written_when_the_approval_cannot_be_filed(tx, api, auth, model):
    before = tx.scalar(select(func.count()).select_from(SapQuotationDraft)), discount_forms(tx)
    api.put("/api/mock-systems/oa", json={"down": True})
    response = open_quote(api, auth, 5)
    assert response.status_code == 503 and "OA" in response.json()["detail"]
    assert (tx.scalar(select(func.count()).select_from(SapQuotationDraft)), discount_forms(tx)) == before
    # 不用簽的報價不受 OA 影響
    assert open_quote(api, auth, 2).status_code == 201
    api.put("/api/mock-systems/oa", json={"down": False})
    assert open_quote(api, auth, 5).status_code == 201


def test_who_can_see_and_sign_a_discount_request(tx, api, auth, model):
    # 自建與第三方登入的帳號代理林昱辰：他們開的單記在林昱辰名下（跟出差單一樣記在客戶負責人名下），
    # 報價本身記實際開的人
    guest = AppUser(id="XTEST09", name="評審", role="sales", region="北區", acts_as_user_id="U01")
    tx.add(guest)
    tx.commit()
    headers = {"Authorization": f"Bearer {auth_service.create_token(guest)}"}
    created = api.post(
        "/api/customers/C001/quotes", json={"items": FISH_OIL, "discount_pct": 6, "reason": "量大"}, headers=headers,
    )
    assert created.status_code == 201
    quote = created.json()
    form = tx.get(OaExpenseForm, quote["approval"]["form_id"])
    assert form.applicant_id == "U01"
    assert tx.scalar(select(SapQuotationDraft.created_by).where(SapQuotationDraft.quote_no == quote["quote_no"])) == "XTEST09"

    def can_see(user_headers):
        return api.get(f"/api/oa/forms/{form.id}", headers=user_headers).status_code == 200

    # 申請人、代理他的帳號、他的主管、IT 看得到；別的業務與別區的主管看不到
    assert can_see(auth("U01")) and can_see(headers) and can_see(auth("M01")) and can_see(auth("A01"))
    assert not can_see(auth("U02")) and not can_see(auth("M02"))
    mine = api.get("/api/oa/forms?status=pending", headers=headers).json()["items"]
    assert form.id in {item["id"] for item in mine}
    # 簽核匣：主管只有自己底下的，IT 全公司都有，也能代簽
    inbox = lambda user: {i["id"] for i in api.get("/api/oa/inbox", headers=auth(user)).json()["items"]}  # noqa: E731
    assert form.id in inbox("M01") and form.id not in inbox("M02") and form.id in inbox("A01")
    assert api.post(f"/api/oa/forms/{form.id}/decide", json={"action": "approve"}, headers=auth("U01")).status_code == 403
    signed = api.post(f"/api/oa/forms/{form.id}/decide", json={"action": "approve"}, headers=auth("A01")).json()
    assert signed["status"] == "approved" and signed["steps"][-1]["name"] == "James"


# ── 促銷的口：照每口售價、不再打折（docs/superpowers/specs/2026-10-07-quote-promotion-packs-design.md）────


def pack_code(session, name):
    return next(p.code for p in promo_packs.current_packs(session) if p.name == name)


def test_the_quote_page_lists_this_period_by_product(tx, api, auth):
    promotion = api.get("/api/customers/C001/quote-promotion", headers=auth("U01")).json()
    assert promotion["name"] == "202610保藥特搭活動" and "滿額贈" in promotion["pm_note"]
    premium = next(p for p in promotion["products"] if p["sku"] == "F749579")
    # 連鎖的供貨價打 9 折：Premium 眼藥水原出貨價 250 元
    assert (premium["group_name"], premium["supply_price"], premium["usual"]) == ("獅王眼藥水", 225, False)
    assert [p["name"] for p in premium["packs"]] == ["Premium眼藥水(小口)", "Premium眼藥水(中口)", "Premium眼藥水(大口)"]
    assert premium["packs"][0] | {"code": None} == {
        "code": None, "name": "Premium眼藥水(小口)", "deal": "常態搭贈<22+1>", "buy_qty": 22, "free_qty": 1, "deal_price": 5500,
    }
    assert api.get("/api/customers/C002/quote-promotion", headers=auth("U01")).status_code == 404  # 王冠宇的客戶


def test_no_running_period_means_no_promotion_section(tx, api, auth):
    tx.execute(text("UPDATE promotion SET end_date = start_date WHERE end_date >= DATE '2026-10-28'"))
    tx.flush()
    assert api.get("/api/customers/C001/quote-promotion", headers=auth("U01")).json() is None


def test_a_pack_is_quoted_at_its_deal_price(tx, api, auth):
    code = pack_code(tx, "Premium眼藥水(小口)")
    created = api.post(
        "/api/customers/C001/quotes", json={"items": [{"promo_code": code, "packs": 2}, {"sku": "HS-FO30", "qty": 20}]},
        headers=auth("U01"),
    )
    assert created.status_code == 201
    quote = created.json()
    assert quote["amount"] == 11000 + 8100 and quote["status"] == "draft"
    pack, fish = quote["items"]
    assert pack == {
        "sku": "F749579", "name": "Premium眼藥水(小口)", "qty": 44, "unit_price": 250.0, "amount": 11000.0,
        "promo_code": code, "packs": 2, "free_qty": 2, "deal": "常態搭贈<22+1>",
    }
    assert fish["promo_code"] is None and fish["amount"] == 8100.0
    row = tx.execute(
        select(SapQuotationDraft).where(SapQuotationDraft.quote_no == quote["quote_no"], SapQuotationDraft.line_no == 1)
    ).scalar_one()
    assert (row.promo_code, row.packs, row.qty, row.free_qty, float(row.amount), float(row.discount_pct)) == (code, 2, 44, 2, 11000, 0)


def test_the_discount_only_applies_to_lines_without_a_promotion(tx, api, auth, model):
    code = pack_code(tx, "Premium眼藥水(小口)")
    quote = open_quote(api, auth, 7, items=[*FISH_OIL, {"promo_code": code, "packs": 1}]).json()
    # 魚油 100 盒 405 元打 93 折是 37,665 元，小口照 5,500 元不打折
    assert (quote["status"], quote["amount"]) == ("pending_approval", 37665 + 5500)
    assert [i["amount"] for i in quote["items"]] == [37665.0, 5500.0]
    form = tx.get(OaExpenseForm, quote["approval"]["form_id"])
    # 簽核只看有打折的那幾列：模型是用沒有促銷的單訓練的
    assert form.payload == {
        "quote_no": quote["quote_no"], "discount_pct": 7.0, "list_amount": 40500, "amount": 37665, "cost": 27000,
        "reason": "競品開買十送一", "total_amount": 43165,
    }
    inbox = api.get("/api/oa/inbox", headers=auth("M01")).json()["items"]
    assert next(i for i in inbox if i["id"] == form.id)["summary"] == "折扣 7%，打折的品項 NT$ 37,665，整張報價 NT$ 43,165"


def test_bad_pack_quotes_are_rejected(tx, api, auth, model):
    code = pack_code(tx, "Premium眼藥水(小口)")
    post = lambda body: api.post("/api/customers/C001/quotes", json=body, headers=auth("U01"))  # noqa: E731
    pack = {"promo_code": code, "packs": 1}
    assert post({"items": [pack, pack]}).status_code == 422  # 同一口只能列一次
    assert post({"items": [{"promo_code": code, "packs": 0}]}).status_code == 422
    assert post({"items": [{"sku": "HS-FO30", "qty": 1, "promo_code": code, "packs": 1}]}).status_code == 422
    assert post({"items": [{"sku": "HS-FO30"}]}).status_code == 422
    ended = post({"items": [{"promo_code": "PP-027942", "packs": 1}]})  # 202608 那一期，已經結束
    assert ended.status_code == 422 and "換期" in ended.json()["detail"]
    only_packs = post({"items": [pack], "discount_pct": 2})
    assert only_packs.status_code == 422 and "沒促銷的品項" in only_packs.json()["detail"]
    # 同一個品項的小口與不走促銷可以同時開
    assert post({"items": [pack, {"sku": "F749579", "qty": 5}]}).status_code == 201


def test_profile_and_route_name_the_pack(tx, api, auth):
    code = pack_code(tx, "Premium眼藥水(小口)")
    quote = api.post(
        "/api/customers/C001/quotes", json={"items": [{"promo_code": code, "packs": 1}, {"sku": "HS-FO30", "qty": 20}]},
        headers=auth("U01"),
    ).json()
    opened = open_quotes(api, auth)[quote["quote_no"]]
    assert opened["items"] == "Premium眼藥水(小口) × 1 口、魚油 30 入 × 20" and opened["amount"] == 13600
    # 今日路線一家只寫最近的一張報價：假資料的拜訪排在決賽日之前，把這張挪到決賽日當天才會是最近的
    tx.execute(
        update(SapQuotationDraft).where(SapQuotationDraft.quote_no == quote["quote_no"])
        .values(created_at=dt.datetime(2026, 10, 28, 9, tzinfo=dt.timezone(dt.timedelta(hours=8))))
    )
    route = today_route._opportunities(tx, "U01", dt.date(2026, 10, 28))
    assert route["C001"] == "10/28 想進Premium眼藥水(小口) × 1 口，報價草稿還沒成交"
