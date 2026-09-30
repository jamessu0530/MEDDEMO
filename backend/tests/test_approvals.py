"""優惠與合約簽核（services/approvals.py）：規則決定誰要簽，模型決定主管這一級能不能免。

都跑在 tx 裡（conftest.py）：API 與測試共用一條連線，測完回滾。模型用假的權重檔，不讀訓練出來的那一份，
訓練結果變了這裡的測試也不會跟著變。
"""

import datetime as dt
import math

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import AppUser, Customer, OaActivity, OaApprovalStep, OaExpenseForm, SapQuotationDraft
from app.services import approvals, customer_profile

TODAY = dt.date(2026, 10, 28)
# 林昱辰名下：忠孝店帳款正常（最久 23 天），鶯歌店有一筆拖了 93 天
GOOD, LATE = "C001", "C099"


@pytest.fixture
def api():
    return TestClient(app)


def fake_model(probability: float, threshold: float | None = 0.9) -> dict:
    """不管特徵是什麼都估同一個機率的模型：權重全是 0，機率只由截距決定。"""
    def one(names):
        return {
            "features": list(names), "mean": dict.fromkeys(names, 0.0), "sd": dict.fromkeys(names, 1.0),
            "weights": dict.fromkeys(names, 0.0), "bias": math.log(probability / (1 - probability)), "threshold": threshold,
        }

    return {"discount": one(approvals.DISCOUNT_FEATURES), "contract": one(approvals.CONTRACT_FEATURES)}


@pytest.fixture
def model(monkeypatch):
    """換掉 load_model。不給參數就是沒有模型檔。"""

    def use(value: dict | None):
        monkeypatch.setattr(approvals, "load_model", lambda: value)

    use(None)
    return use


def pending_quote(tx, customer_id: str, quote_no: str, discount_pct: float) -> dict:
    """一張等簽核的報價，回傳對應的申請內容。"""
    price = round(405 * (1 - discount_pct / 100), 2)
    tx.add(SapQuotationDraft(
        quote_no=quote_no, line_no=1, customer_id=customer_id, sku="HS-FO30", qty=100, created_by="U01",
        unit_price=price, discount_pct=discount_pct, status="pending_approval",
    ))
    tx.flush()
    return {
        "quote_no": quote_no, "discount_pct": discount_pct, "list_amount": 40500, "amount": round(price * 100),
        "cost": 27000, "reason": "競品開買十送一",
    }


def submit_discount(tx, discount_pct: float, customer_id: str = GOOD, quote_no: str = "QTEST-0001") -> OaExpenseForm:
    customer = tx.get(Customer, customer_id)
    payload = pending_quote(tx, customer_id, quote_no, discount_pct)
    form = approvals.submit(tx, kind="discount", applicant=tx.get(AppUser, customer.owner_user_id), customer=customer, payload=payload)
    tx.commit()
    return form


def submit_contract(tx, listing_to: float = 0.08, reward_to: float = 0.05, customer_id: str = GOOD, term_months: int = 12) -> OaExpenseForm:
    customer = tx.get(Customer, customer_id)
    payload = approvals.contract_payload(
        tx, customer, TODAY, term_months=term_months, listing_fee_rate=listing_to, channel_reward_rate=reward_to, reason="照去年條件",
    )
    form = approvals.submit(tx, kind="contract", applicant=tx.get(AppUser, customer.owner_user_id), customer=customer, payload=payload)
    tx.commit()
    return form


def steps(tx, form) -> list[OaApprovalStep]:
    return list(tx.scalars(select(OaApprovalStep).where(OaApprovalStep.form_id == form.id).order_by(OaApprovalStep.step_no)))


def quote_status(tx, quote_no: str = "QTEST-0001") -> str:
    return tx.scalar(select(SapQuotationDraft.status).where(SapQuotationDraft.quote_no == quote_no))


def decide(api, auth, form, user_id, action="approve"):
    return api.post(f"/api/oa/forms/{form.id}/decide", json={"action": action}, headers=auth(user_id))


# ── 規則：誰要簽 ───────────────────────────────────────────────────


def test_discount_levels_follow_the_quote_authority_document():
    # 《報價權限與折扣審核》：3% 以內業務自己決定，8% 以內區處主管，12% 以內業務處長，再上去總經理
    levels = {pct: approvals.discount_level(pct) for pct in (0, 3, 3.5, 8, 8.5, 12, 12.5, 20)}
    assert levels == {
        0: None, 3: None, 3.5: "manager", 8: "manager", 8.5: "director", 12: "director", 12.5: "gm", 20: "gm",
    }
    for bad in (20.5, -1):
        with pytest.raises(ValueError):
            approvals.discount_level(bad)


def test_a_renewal_needs_the_director_only_when_a_rate_changes():
    assert approvals.contract_level(0.08, 0.08, 0.05, 0.05) == "manager"
    assert approvals.contract_level(0.08, 0.085, 0.05, 0.05) == "director"
    assert approvals.contract_level(0.08, 0.08, 0.05, 0.045) == "director"


@pytest.mark.parametrize("discount_pct, level, signers", [
    (6.0, "manager", [("經辦人的主管", "區處主管", "M01", "pending")]),
    (10.0, "director", [("經辦人的主管", "區處主管", "M01", "pending"), ("業務處長", "業務處長", "A01", "waiting")]),
    (15.0, "gm", [
        ("經辦人的主管", "區處主管", "M01", "pending"), ("業務處長", "業務處長", "A01", "waiting"),
        ("總經理", "總經理", "A01", "waiting"),
    ]),
])
def test_each_discount_level_builds_its_own_chain_of_signers(tx, model, discount_pct, level, signers):
    form = submit_discount(tx, discount_pct)
    assert (form.kind, form.required_level, form.status, form.auto_approved) == ("discount", level, "pending", False)
    assert form.form_no.startswith("DC202610") and form.request_date == TODAY
    assert (form.applicant_id, form.customer_id, form.unit_name) == ("U01", GOOD, "北區")
    built = steps(tx, form)
    assert (built[0].role_label, built[0].user_id, built[0].status) == ("請求者", "U01", "done")
    # 區處主管是申請人的直屬主管；業務處長、總經理沒有帳號，由根節點的 IT 帳號代簽
    assert [(s.role_label, s.title, s.user_id, s.status) for s in built[1:]] == signers
    assert quote_status(tx) == "pending_approval"


def test_the_two_kinds_of_renewal_build_their_own_chain_of_signers(tx, model):
    same = submit_contract(tx)
    assert (same.kind, same.required_level, same.form_no[:8]) == ("contract", "manager", "CT202610")
    assert [(s.title, s.user_id) for s in steps(tx, same)[1:]] == [("區處主管", "M01")]
    assert same.payload["listing_fee_rate"] == {"from": 0.08, "to": 0.08}

    changed = submit_contract(tx, listing_to=0.085, customer_id="C003")
    assert changed.required_level == "director"
    assert [(s.title, s.user_id, s.status) for s in steps(tx, changed)[1:]] == [
        ("區處主管", "M01", "pending"), ("業務處長", "A01", "waiting"),
    ]


# ── 模型：主管這一級能不能免 ─────────────────────────────────────────


def test_a_confident_model_approves_a_manager_level_request_on_its_own(tx, api, auth, model):
    model(fake_model(0.94))
    form = submit_discount(tx, 6.0)
    assert (form.status, form.auto_approved, form.model_probability) == ("approved", True, pytest.approx(0.94))
    # 第二關沒有簽核人，記成系統核准；日誌寫出機率與門檻
    built = steps(tx, form)
    assert [(s.role_label, s.user_id, s.status) for s in built] == [("請求者", "U01", "done"), ("系統核准", None, "done")]
    activity = tx.scalars(select(OaActivity).where(OaActivity.form_id == form.id).order_by(OaActivity.id)).all()
    assert [(a.action, a.actor_id) for a in activity] == [("submitted", "U01"), ("auto_approved", None)]
    assert activity[1].detail == "模型估計核准機率 94%，高於門檻 90%，系統核准"
    # 效果立刻生效：報價可以送給客戶了
    assert quote_status(tx) == "draft"
    # 沒有人要簽：主管的簽核匣裡沒有它
    assert form.id not in {i["id"] for i in api.get("/api/oa/inbox", headers=auth("M01")).json()["items"]}
    assert approvals.approval_out(tx, form) == {
        "form_id": form.id, "form_no": form.form_no, "status": "approved", "auto_approved": True,
        "probability": pytest.approx(0.94), "waiting_for": None,
    }


def test_the_features_behind_the_estimate_are_kept_on_the_form(tx, model):
    model(fake_model(0.5))
    form = submit_discount(tx, 6.0)
    assert set(form.model_features) == set(approvals.DISCOUNT_FEATURES)
    assert form.model_features["discount_pct"] == 6.0
    assert form.model_features["margin_after"] == pytest.approx((38070 - 27000) / 38070)
    assert form.model_features["grade_weight"] == 3.0
    renewal = submit_contract(tx, listing_to=0.09, reward_to=0.045, term_months=24)
    assert set(renewal.model_features) == set(approvals.CONTRACT_FEATURES)
    # 上架費率 +1、通路獎勵 -0.5，合計調高 0.5 個百分點
    assert renewal.model_features["fee_change"] == pytest.approx(0.5)
    assert renewal.model_features["term_years"] == 2.0


@pytest.mark.parametrize("why, fake, discount_pct, customer_id, probability", [
    ("機率不到門檻", fake_model(0.62), 6.0, GOOD, 0.62),
    ("帳款超過 60 天", fake_model(0.99), 6.0, LATE, 0.99),
    ("規則要到業務處長", fake_model(0.99), 10.0, GOOD, 0.99),
    ("沒有模型檔", None, 6.0, GOOD, None),
    ("這一種申請沒有訂出門檻", fake_model(0.99, threshold=None), 6.0, GOOD, 0.99),
    ("模型檔裡沒有這一種申請", {"contract": fake_model(0.99)["contract"]}, 6.0, GOOD, None),
])
def test_everything_else_goes_to_a_person(tx, model, why, fake, discount_pct, customer_id, probability):
    model(fake)
    form = submit_discount(tx, discount_pct, customer_id)
    assert (form.status, form.auto_approved) == ("pending", False), why
    # 送人簽的單一樣記下機率，簽核頁給主管參考
    assert form.model_probability == (pytest.approx(probability) if probability else None)
    assert steps(tx, form)[1].user_id == "M01"
    assert quote_status(tx) == "pending_approval"
    waiting = approvals.approval_out(tx, form)
    assert (waiting["status"], waiting["waiting_for"]) == ("pending", {"step": "區處主管", "name": "陳建宏"})


def test_a_model_missing_a_feature_counts_as_no_model(tx, model, caplog):
    broken = fake_model(0.99)
    del broken["discount"]["weights"]["margin_after"]
    model(broken)
    form = submit_discount(tx, 6.0)
    assert (form.status, form.model_probability) == ("pending", None)
    assert "approval_model" in caplog.text


def test_a_broken_model_file_counts_as_no_model(tmp_path, monkeypatch, caplog):
    monkeypatch.setattr(approvals, "MODEL_FILE", tmp_path / "approval_model.json")
    assert approvals.load_model() is None
    approvals.MODEL_FILE.write_text("{not json", encoding="utf-8")
    assert approvals.load_model() is None
    assert "approval_model" in caplog.text


def test_a_renewal_at_the_same_rates_can_be_approved_by_the_system(tx, model):
    model(fake_model(0.97))
    customer = tx.get(Customer, GOOD)
    before = customer.contract_end_date
    form = submit_contract(tx)
    assert (form.status, form.auto_approved) == ("approved", True)
    # 忠孝店的合約 2027-10-01 到期，續 12 個月
    assert (before, customer.contract_end_date) == (dt.date(2027, 10, 1), dt.date(2028, 10, 1))
    # 費率有調整的一律要人簽，模型不碰
    changed = submit_contract(tx, reward_to=0.055, customer_id="C003")
    assert (changed.status, changed.auto_approved) == ("pending", False)


# ── 逐關簽核與核准之後 ─────────────────────────────────────────────


def test_a_discount_takes_effect_only_after_the_last_signer(tx, api, auth, model):
    form = submit_discount(tx, 10.0)
    assert decide(api, auth, form, "M01").json()["status"] == "pending"
    # 主管核准後換處長等簽，報價還不能送出
    assert quote_status(tx) == "pending_approval"
    assert approvals.approval_out(tx, form)["waiting_for"] == {"step": "業務處長", "name": "James"}
    assert decide(api, auth, form, "A01").json()["status"] == "approved"
    assert quote_status(tx) == "draft"


@pytest.mark.parametrize("action", ["reject", "return"])
def test_a_refusal_midway_rejects_the_quote(tx, api, auth, model, action):
    form = submit_discount(tx, 10.0)
    decide(api, auth, form, "M01")
    assert decide(api, auth, form, "A01", action).status_code == 200
    assert quote_status(tx) == "rejected"


def test_an_approved_renewal_extends_the_contract_and_a_refused_one_does_not(tx, api, auth, model):
    # 內湖店的合約 2026-11-17 到期：原到期日比系統日晚，從原到期日起算
    customer = tx.get(Customer, "C003")
    form = submit_contract(tx, customer_id="C003", term_months=24)
    assert form.payload["old_end_date"] == "2026-11-17" and form.payload["new_end_date"] == "2028-11-17"
    assert customer.contract_end_date == dt.date(2026, 11, 17)
    decide(api, auth, form, "M01")
    tx.refresh(customer)
    assert customer.contract_end_date == dt.date(2028, 11, 17)

    refused = submit_contract(tx, customer_id="C005")
    decide(api, auth, refused, "M01", "reject")
    assert tx.get(Customer, "C005", populate_existing=True).contract_end_date == dt.date(2027, 8, 15)


def test_an_expired_contract_is_renewed_from_the_system_date(tx, model):
    customer = tx.get(Customer, GOOD)
    customer.contract_end_date = dt.date(2026, 8, 31)
    tx.flush()
    payload = approvals.contract_payload(tx, customer, TODAY, term_months=12, listing_fee_rate=0.08, channel_reward_rate=0.05, reason="")
    assert (payload["old_end_date"], payload["new_end_date"]) == ("2026-08-31", "2027-10-28")
    # 月底往後加月份，落在比較短的月份就取那個月的最後一天
    assert approvals.add_months(dt.date(2026, 8, 31), 6) == dt.date(2027, 2, 28)


def test_a_pending_renewal_is_found_until_it_is_decided(tx, api, auth, model):
    assert approvals.pending_contract(tx, GOOD) is None
    form = submit_contract(tx)
    assert approvals.pending_contract(tx, GOOD) == form.id
    decide(api, auth, form, "M01", "return")
    assert approvals.pending_contract(tx, GOOD) is None


# ── 客戶狀態與簽核頁上的理由 ─────────────────────────────────────────


def test_customer_state_agrees_with_the_customer_profile(tx):
    for customer_id in (GOOD, LATE, "C007"):
        customer = tx.get(Customer, customer_id)
        state = approvals.customer_state(tx, customer, TODAY)
        profile = customer_profile.build_profile(tx, customer)
        assert set(state) == {"sales_90d", "net_margin", "interval_change", "ar_age_days", "competitor_recent", "grade_weight"}
        assert state["sales_90d"] == profile.stats.amount_last_90d
        assert state["ar_age_days"] == (profile.stats.ar_max_age_days or 0)
        assert bool(state["competitor_recent"]) == ("competitor" in profile.signals)
        margin = customer_profile.negotiation_card(tx, customer, profile).margin
        assert state["net_margin"] == pytest.approx(margin.net_margin_rate, abs=1e-4)
    # 板橋店是刻意設計「進貨間隔拉長」的客戶，近期拜訪提到御松田
    assert state["interval_change"] > 0.2 and state["competitor_recent"] == 1.0
    assert approvals.contract_terms(tx, tx.get(Customer, GOOD), TODAY) == {
        "contract_end_date": dt.date(2027, 10, 1), "days_left": 338, "listing_fee_rate": 0.08, "channel_reward_rate": 0.05,
    }


def test_reasons_list_the_facts_a_manager_checks(tx, api, auth, model):
    model(fake_model(0.62))
    late = submit_discount(tx, 6.0, LATE)
    assert approvals.reasons(late) == [
        "折扣 6%，在區處主管的權限（8%）以內",
        "折後毛利率 29%",
        "帳款最久 93 天，超過 60 天",
        "近 90 天的拜訪沒有提到競品",
    ]
    shown = api.get(f"/api/oa/forms/{late.id}", headers=auth("M01")).json()["model"]
    assert shown["probability"] == pytest.approx(0.62) and shown["auto_approved"] is False
    # 帳款超過 60 天那一行標紅
    assert [line["alert"] for line in shown["reasons"]] == [False, False, True, False]
    assert [line["text"] for line in shown["reasons"]] == approvals.reasons(late)

    deep = submit_discount(tx, 15.0, "C007", "QTEST-0002")
    assert approvals.reasons(deep)[0] == "折扣 15%，超過業務處長的權限（12%），要送到總經理"
    assert approvals.reasons(deep)[-1] == "近 90 天的拜訪提到競品"

    renewal = submit_contract(tx, listing_to=0.09)
    assert approvals.reasons(renewal)[0] == "上架費率與通路獎勵合計調高 1 個百分點，要送業務處長"
    assert approvals.reasons(renewal)[1].startswith("近 90 天淨毛利率 ")
    assert approvals.reasons(submit_contract(tx, customer_id="C003"))[0] == "照原費率續約 12 個月"
