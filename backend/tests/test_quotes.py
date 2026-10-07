"""客戶檔案「開報價」：不必先有一次拜訪，直接開 SAP 報價草稿；折扣超過業務的權限就開優惠申請單送簽。"""

import datetime as dt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from test_approvals import fake_model, model  # noqa: F401  model 是 fixture

from app.main import app
from app.models import AppUser, OaExpenseForm, SapQuotationDraft
from app.services import auth as auth_service
from app.services import today_route
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
        "reason": "競品開買十送一",
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
