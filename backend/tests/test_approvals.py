"""優惠與合約簽核（services/approvals.py）：規則決定誰要簽，模型決定主管這一級能不能免。

都跑在 tx 裡（conftest.py）：API 與測試共用一條連線，測完回滾。模型用假的權重檔，不讀訓練出來的那一份，
訓練結果變了這裡的測試也不會跟著變。
"""

import datetime as dt
import math
import threading

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.main import app
from app.models import AppUser, Customer, OaActivity, OaApprovalStep, OaExpenseForm, SapQuotationDraft
from app.services import approvals, customer_profile, negotiation, oa
from app.services import auth as auth_service

TODAY = dt.date(2026, 10, 28)
# 林昱辰名下：忠孝店帳款正常（最久 23 天），鶯歌店有一筆拖了 93 天
GOOD, LATE = "C001", "C099"
# 內湖店的合約 2026-11-17 到期，剩 20 天：已經在「到期前 3 個月」裡，可以申請續約（忠孝店還有 338 天，不行）
DUE = "C003"


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


def broken(change):
    """訓練出來的模型檔被改壞的樣子：拿假模型改一處。"""
    model = fake_model(0.99)
    change(model)
    return model


@pytest.mark.parametrize("why, fake", [
    ("整個檔是 list", [fake_model(0.99)]),
    ("這一種申請不是物件", {"discount": "壞掉了", "contract": {}}),
    ("門檻是字串", broken(lambda m: m["discount"].update(threshold="0.9"))),
    ("門檻是 true", broken(lambda m: m["discount"].update(threshold=True))),
    ("門檻超過 1", broken(lambda m: m["discount"].update(threshold=1.5))),
    ("門檻是 NaN", broken(lambda m: m["discount"].update(threshold=float("nan")))),
    ("截距是 NaN", broken(lambda m: m["discount"].update(bias=float("nan")))),
    ("權重是 NaN", broken(lambda m: m["discount"]["weights"].update(margin_after=float("nan")))),
    ("權重是字串", broken(lambda m: m["discount"]["weights"].update(margin_after="0.5"))),
    ("標準差是 0", broken(lambda m: m["discount"]["sd"].update(margin_after=0))),
    ("權重大到溢位", broken(lambda m: m["discount"].update(bias=-1e6))),
    ("截距是無限大", broken(lambda m: m["discount"].update(bias=float("inf")))),
    ("平均是無限大", broken(lambda m: m["discount"]["mean"].update(margin_after=float("-inf")))),
    ("權重大得離譜，機率剛好是 1", broken(lambda m: m["discount"]["weights"].update(discount_pct=1e308))),
])
def test_a_broken_model_never_stops_a_request_or_stores_nan(tx, api, auth, model, caplog, why, fake):
    # 模型檔壞掉就當成沒有模型：照規則送人簽、機率是空的，記一筆 log；不能 500，NaN 也不能存進資料庫
    model(fake)
    assert approvals.estimate("discount", {name: 1.0 for name in approvals.DISCOUNT_FEATURES}) == (None, None), why
    created = api.post(
        f"/api/customers/{GOOD}/quotes",
        json={"items": [{"sku": "HS-FO30", "qty": 10}], "discount_pct": 5, "reason": "量大"}, headers=auth("U01"),
    )
    assert created.status_code == 201, why
    approval = created.json()["approval"]
    assert (approval["status"], approval["probability"]) == ("pending", None), why
    assert tx.get(OaExpenseForm, approval["form_id"]).model_probability is None
    assert "approval_model" in caplog.text
    # 主管的簽核匣與那張單都打得開
    assert api.get("/api/oa/inbox", headers=auth("M01")).status_code == 200
    assert api.get(f"/api/oa/forms/{approval['form_id']}", headers=auth("M01")).status_code == 200


def test_a_broken_model_file_counts_as_no_model(tmp_path, monkeypatch, caplog):
    monkeypatch.setattr(approvals, "MODEL_FILE", tmp_path / "approval_model.json")
    assert approvals.load_model() is None
    approvals.MODEL_FILE.write_text("{not json", encoding="utf-8")
    assert approvals.load_model() is None
    approvals.MODEL_FILE.write_text("[1, 2]", encoding="utf-8")
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
        # 淨毛利跟談判卡的毛利結構同一個算法（services/negotiation.py）
        margin = negotiation._margin(tx, customer, profile.today)
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
    assert approvals.reasons(renewal)[0] == "上架費率調高 1 個百分點，要送業務處長"
    # 一升一降就分開寫兩個費率各自怎麼變，不寫「合計增減 0 個百分點」
    mixed = submit_contract(tx, listing_to=0.065, reward_to=0.035, customer_id="C007")  # 福安原本 6% 與 4%
    assert approvals.reasons(mixed)[0] == "上架費率調高 0.5 個百分點、通路獎勵調降 0.5 個百分點，要送業務處長"
    assert approvals.reasons(renewal)[1].startswith("近 90 天淨毛利率 ")
    assert approvals.reasons(submit_contract(tx, customer_id="C003"))[0] == "照原費率續約 12 個月"


# ── 歷史申請單與訓練出來的模型 ───────────────────────────────────────


def test_the_generator_and_the_backend_compute_the_same_features(tx):
    # 產生器（data/seed/generate.py）自己算了一份特徵寫在歷史單上；後端在同一天算出來的要一樣，
    # 不然模型訓練時看到的資料跟上線時算出來的不一樣。兩種申請各平均抽 50 張，前後期都抽到（全部 1,205 張要十幾秒）
    for kind, build in (("discount", approvals.discount_features), ("contract", approvals.contract_features)):
        forms = tx.scalars(select(OaExpenseForm).where(OaExpenseForm.kind == kind).order_by(OaExpenseForm.id)).all()
        sample = forms[:: len(forms) // 50][:50]
        assert len(sample) == 50
        for form in sample:
            customer = tx.get(Customer, form.customer_id)
            computed = build(approvals.customer_state(tx, customer, form.request_date), form.payload)
            assert computed == pytest.approx(form.model_features, abs=1e-6), form.form_no


def test_the_trained_model_file_has_both_kinds_and_honest_metrics():
    model = approvals.load_model()
    assert set(model) == {"discount", "contract"}
    for kind, one in model.items():
        names = list(approvals.FEATURES[kind])
        assert one["features"] == names
        assert set(one["mean"]) == set(one["sd"]) == set(one["weights"]) == set(names)
        assert one["threshold"] in (None, 0.8, 0.85, 0.9, 0.95)
        metrics = one["metrics"]
        assert set(metrics) >= {"auc", "precision_at_threshold", "auto_share", "train_rows", "test_rows"}
        # 照時間切，最後四分之一當測試期
        assert metrics["train_rows"] + metrics["test_rows"] == {"discount": 900, "contract": 300}[kind]
        assert metrics["test_rows"] == {"discount": 225, "contract": 75}[kind]
        assert metrics["auc"] > 0.8
        # 模型真正在作用的那一群：規則允許系統核准的（主管級、帳款沒超過 60 天）。
        # 不用模型、這一群全部核准時有過的比例；門檻以下改送人的有幾張、其中幾張主管本來會核准
        assert 0 < metrics["eligible_rows"] <= metrics["test_manager_rows"] and 0 <= metrics["eligible_auc"] <= 1
        assert metrics["approved_at_threshold"] + metrics["deferred"] == metrics["eligible_rows"]
        assert 0 <= metrics["deferred_approved"] <= metrics["deferred"]
        if one["threshold"] is not None:
            # 門檻以上真的有過的，加上改送人裡主管核准的，就是這一群全部有過的張數
            chosen = next(row for row in metrics["thresholds"] if row["threshold"] == one["threshold"])
            approved = round(chosen["precision"] * chosen["approved"]) + metrics["deferred_approved"]
            assert approved == round(metrics["baseline_precision"] * metrics["eligible_rows"])
        if one["threshold"] is None:
            assert metrics["precision_at_threshold"] is None and metrics["auto_share"] == 0
        else:
            # 門檻的條件：模型說會過的真的有過至少 95%，而且至少 20 張
            assert metrics["precision_at_threshold"] >= 0.95 and metrics["approved_at_threshold"] >= 20
            # 模型至少不能比「規則允許的全部核准」差
            assert metrics["precision_at_threshold"] >= metrics["baseline_precision"]
            # 主管級的申請有一部分由系統核准，不是全部
            assert 0 < metrics["auto_share"] < 1
    # 優惠的全部測試單 AUC 0.92，模型真正在用的那一群只有 0.78：全部的單裡有一大塊是規則本身就分得開的
    assert model["discount"]["metrics"]["eligible_auc"] < model["discount"]["metrics"]["auc"]
    # 方向照假資料設計的關聯：折扣越深、帳款拖越久越難過；費率調越多越難過
    assert model["discount"]["weights"]["discount_pct"] < 0 and model["discount"]["weights"]["ar_age_days"] < 0
    assert model["contract"]["weights"]["fee_change"] < 0


def test_the_seeded_system_approvals_agree_with_the_trained_model(tx):
    # 展示用那兩張「系統核准」是假資料寫死的；訓練出來的模型也要同意，畫面上的機率才不會自相矛盾
    forms = tx.scalars(select(OaExpenseForm).where(OaExpenseForm.auto_approved)).all()
    assert len(forms) == 2
    for form in forms:
        probability, threshold = approvals.estimate(form.kind, form.model_features)
        assert form.model_probability == pytest.approx(probability)
        assert probability >= threshold and form.model_features["ar_age_days"] <= customer_profile.AR_WATCH_DAYS
        activity = tx.scalars(select(OaActivity).where(OaActivity.form_id == form.id).order_by(OaActivity.id)).all()
        assert activity[-1].detail == approvals.auto_detail(probability, threshold)
    # 等人簽的那三張也記了機率，簽核頁給主管參考
    waiting = tx.scalars(select(OaExpenseForm).where(OaExpenseForm.status == "pending")).all()
    assert len(waiting) == 3 and all(0 < form.model_probability < 1 for form in waiting)
    # 歷史單是人簽的，當時沒有模型
    assert tx.scalar(select(OaExpenseForm.id).where(
        OaExpenseForm.kind != "trip", OaExpenseForm.status != "pending", OaExpenseForm.auto_approved.is_(False),
        OaExpenseForm.model_probability.is_not(None),
    ).limit(1)) is None


# ── API：續約申請與系統核准的清單 ───────────────────────────────────


def renew(api, auth, customer_id=DUE, user="U01", **changes):
    body = {"term_months": 12, "listing_fee_rate": 0.08, "channel_reward_rate": 0.05, "reason": "照去年條件"} | changes
    return api.post(f"/api/customers/{customer_id}/contract-requests", json=body, headers=auth(user))


def test_the_contract_page_shows_the_current_terms(tx, api, auth, model):
    contract = api.get(f"/api/customers/{GOOD}/contract", headers=auth("U01"))
    assert contract.status_code == 200
    # 忠孝店的合約還有 338 天：看得到條件，但還不能申請續約
    assert contract.json() == {
        "contract_end_date": "2027-10-01", "days_left": 338, "ending_soon": False,
        "listing_fee_rate": 0.08, "channel_reward_rate": 0.05, "pending_form_id": None,
        "can_request": False, "blocked_reason": "合約還有 338 天到期，到期前 3 個月才能申請續約",
    }
    due = api.get(f"/api/customers/{DUE}/contract", headers=auth("U01")).json()
    assert (due["days_left"], due["ending_soon"], due["can_request"], due["blocked_reason"]) == (20, True, True, None)
    # 蘆洲店 12/7 到期，已經在 3 個月內；假資料裡它有一張還沒簽完的續約申請，簽完才能再送
    soon = api.get("/api/customers/C087/contract", headers=auth("U01")).json()
    assert (soon["contract_end_date"], soon["ending_soon"]) == ("2026-12-07", True)
    assert soon["pending_form_id"] is not None and soon["can_request"] is False
    # 只有連鎖客戶有通路合約；別人的客戶跟不存在一樣
    assert api.get("/api/customers/C025/contract", headers=auth("U01")).status_code == 409
    assert api.get("/api/customers/C002/contract", headers=auth("U01")).status_code == 404


def test_a_renewal_request_goes_through_the_api(tx, api, auth, model):
    sent = renew(api, auth)
    assert sent.status_code == 201
    approval = sent.json()
    assert (approval["status"], approval["auto_approved"]) == ("pending", False)
    assert approval["form_no"].startswith("CT202610") and approval["waiting_for"] == {"step": "區處主管", "name": "陳建宏"}
    assert api.get(f"/api/customers/{DUE}/contract", headers=auth("U01")).json()["pending_form_id"] == approval["form_id"]
    # 同一家客戶同時只能有一張還沒簽完的合約申請
    assert renew(api, auth).status_code == 409
    assert renew(api, auth, "C087").status_code == 409
    # 簽完（不管結果）就可以再送
    api.post(f"/api/oa/forms/{approval['form_id']}/decide", json={"action": "return"}, headers=auth("M01"))
    changed = renew(api, auth, listing_fee_rate=0.085, reason="總部要求調高")
    assert changed.status_code == 201
    detail = api.get(f"/api/oa/forms/{changed.json()['form_id']}", headers=auth("M01")).json()
    assert detail["summary"] == "續約 12 個月，上架費率 8% → 8.5%"
    assert [s["title"] for s in detail["steps"]] == ["業務", "區處主管", "業務處長"]


def test_bad_renewal_requests_are_rejected(tx, api, auth, model):
    assert renew(api, auth, "C025").status_code == 409  # 獨立藥局
    assert renew(api, auth, "C002").status_code == 404  # 王冠宇的客戶
    assert renew(api, auth, term_months=18).status_code == 422
    assert renew(api, auth, listing_fee_rate=0.5).status_code == 422
    assert renew(api, auth, channel_reward_rate=-0.01).status_code == 422
    assert renew(api, auth, reason="長" * 501).status_code == 422
    # 費率有調整要寫理由，照原費率續約可以不寫
    assert renew(api, auth, listing_fee_rate=0.09, reason="").status_code == 422
    assert api.get(f"/api/customers/{DUE}/contract", headers=auth("U01")).json()["pending_form_id"] is None
    assert renew(api, auth, reason="").status_code == 201


def test_a_renewal_can_only_be_filed_in_the_last_three_months(tx, api, auth, model):
    # 《連鎖通路合約條件》：續約協商在到期前 3 個月啟動。離到期還久的合約不能送續約——
    # 不然照原費率的續約可以一送再送、每次都由系統核准，到期日一路往後延，沒有人看過
    early = renew(api, auth, GOOD)
    assert early.status_code == 409
    assert early.json()["detail"] == "合約還有 338 天到期，到期前 3 個月才能申請續約"
    # 自建帳號代理林昱辰，一樣擋
    guest = AppUser(id="XTEST08", name="評審", role="sales", region="北區", acts_as_user_id="U01")
    tx.add(guest)
    tx.commit()
    headers = {"Authorization": f"Bearer {auth_service.create_token(guest)}"}
    body = {"term_months": 24, "listing_fee_rate": 0.08, "channel_reward_rate": 0.05, "reason": ""}
    assert api.post(f"/api/customers/{GOOD}/contract-requests", json=body, headers=headers).status_code == 409

    # 剛好 90 天可以，91 天不行；已經過期的可以
    customer = tx.get(Customer, GOOD)
    for days_left, status in ((91, 409), (90, 201)):
        customer.contract_end_date = TODAY + dt.timedelta(days=days_left)
        tx.commit()
        assert renew(api, auth, GOOD).status_code == status, days_left
    expired = tx.get(Customer, "C005")
    expired.contract_end_date = TODAY - dt.timedelta(days=30)
    tx.commit()
    assert api.get("/api/customers/C005/contract", headers=auth("U01")).json()["can_request"] is True
    assert renew(api, auth, "C005").status_code == 201


def test_an_approved_renewal_cannot_be_followed_by_another(tx, api, auth, model):
    # 系統核准之後到期日往後延，離到期又超過 3 個月，自然就不能再送
    model(fake_model(0.97))
    first = renew(api, auth, term_months=24)
    assert first.status_code == 201 and first.json()["auto_approved"] is True
    assert tx.get(Customer, DUE, populate_existing=True).contract_end_date == dt.date(2028, 11, 17)
    again = renew(api, auth, term_months=24)
    assert again.status_code == 409 and "到期前 3 個月才能申請續約" in again.json()["detail"]
    assert tx.get(Customer, DUE, populate_existing=True).contract_end_date == dt.date(2028, 11, 17)


def test_no_renewal_is_filed_while_oa_is_down(tx, api, auth, model):
    api.put("/api/mock-systems/oa", json={"down": True})
    try:
        response = renew(api, auth)
        assert response.status_code == 503 and "OA" in response.json()["detail"]
        assert approvals.pending_contract(tx, DUE) is None
    finally:
        api.put("/api/mock-systems/oa", json={"down": False})


def test_managers_can_review_what_the_system_approved(tx, api, auth, model):
    # 假資料裡林昱辰名下有兩張系統核准的優惠申請
    seeded = api.get("/api/oa/auto-approved", headers=auth("M01")).json()["items"]
    assert [(i["kind"], i["status"], i["applicant_name"], i["model"]["auto_approved"]) for i in seeded] == [
        ("discount", "approved", "林昱辰", True)
    ] * 2
    assert seeded[0]["summary"].startswith("折扣 5%，報價 NT$ ") and seeded[1]["summary"].startswith("折扣 4%，報價 NT$ ")
    # 再多一張：主管看得到自己底下的，別區的主管看不到，IT 看全公司，業務進不來
    model(fake_model(0.97))
    form = submit_contract(tx)
    assert form.id in {i["id"] for i in api.get("/api/oa/auto-approved", headers=auth("M01")).json()["items"]}
    assert api.get("/api/oa/auto-approved", headers=auth("M02")).json()["items"] == []
    assert len(api.get("/api/oa/auto-approved", headers=auth("A01")).json()["items"]) == 3
    assert api.get("/api/oa/auto-approved", headers=auth("U01")).status_code == 403


def test_the_inbox_shows_the_estimate_and_the_facts_behind_it(tx, api, auth):
    items = api.get("/api/oa/inbox", headers=auth("M01")).json()["items"]
    late = next(i for i in items if i["kind"] == "discount" and i["customer_name"] == "福安連鎖藥局 · 鶯歌店")
    assert late["kind_label"] == "優惠申請單" and late["summary"] == "折扣 6%，報價 NT$ 43,315"
    assert 0 < late["model"]["probability"] < 0.5 and late["model"]["auto_approved"] is False
    assert [line["text"] for line in late["model"]["reasons"]] == [
        "折扣 6%，在區處主管的權限（8%）以內", "折後毛利率 30%", "帳款最久 92 天，超過 60 天", "近 90 天的拜訪沒有提到競品",
    ]
    assert [line["alert"] for line in late["model"]["reasons"]] == [False, False, True, False]


def test_a_pending_request_follows_the_rep_to_a_new_manager(tx, api, auth, model):
    # 跟出差單一樣：業務換了主管，區處主管那一關還沒簽就改送新主管（services/org_admin.py）
    discount = submit_discount(tx, 10.0, customer_id="C002")
    renewal = submit_contract(tx, listing_to=0.065, customer_id="C098")
    assert [s.user_id for s in steps(tx, discount)] == ["U02", "M01", "A01"]
    assert [s.user_id for s in steps(tx, renewal)] == ["U02", "M01", "A01"]
    # 還在排隊（waiting）的主管關卡也算：現在的規則下主管一定是第二關、一送出就等簽，這裡直接改狀態模擬
    queued = submit_discount(tx, 6.0, customer_id="C002", quote_no="QTEST-0003")
    steps(tx, queued)[1].status = "waiting"
    # 已經簽過的是歷史，不動
    signed = submit_discount(tx, 6.0, customer_id="C002", quote_no="QTEST-0004")
    decide(api, auth, signed, "M01")
    tx.commit()

    assert api.put("/api/admin/users/U02/manager", json={"manager_id": "M02"}, headers=auth("A01")).status_code == 200
    tx.expire_all()
    for form in (discount, renewal, queued):
        assert [s.user_id for s in steps(tx, form)][1] == "M02", form.form_no
    assert [s.user_id for s in steps(tx, signed)] == ["U02", "M01"]
    assert api.get(f"/api/oa/forms/{discount.id}", headers=auth("M02")).json()["can_decide"] is True
    assert api.get(f"/api/oa/forms/{discount.id}", headers=auth("M01")).status_code == 404


def test_only_a_request_that_needs_the_director_needs_an_it_account(tx, model):
    # 業務處長與總經理由 IT 代簽；主管級的單用不到 IT，IT 帳號停用了也送得出去
    tx.get(AppUser, "A01").deactivated_at = dt.datetime.now(dt.UTC)
    tx.flush()
    assert submit_discount(tx, 6.0).status == "pending"
    with pytest.raises(HTTPException) as refused:
        submit_discount(tx, 10.0, quote_no="QTEST-0005")
    assert refused.value.status_code == 503 and "IT" in refused.value.detail


# ── 兩個請求重疊 ───────────────────────────────────────────────────
# tx 是單一連線，測不出重疊：這一段用兩條真的連線，資料真的寫進資料庫，測完把這個測試建的刪掉


@pytest.fixture
def committed(engine, monkeypatch):
    monkeypatch.setattr(approvals, "load_model", lambda: None)
    with Session(engine) as session:
        last = session.scalar(select(func.max(OaExpenseForm.id)))
        ends = dict(session.execute(select(Customer.id, Customer.contract_end_date)).all())
    yield
    with Session(engine) as session, session.begin():
        # 關卡、意見、日誌跟著申請單一起刪（ON DELETE CASCADE）
        session.execute(delete(OaExpenseForm).where(OaExpenseForm.id > last))
        session.execute(delete(SapQuotationDraft).where(SapQuotationDraft.quote_no.like("QRACE-%")))
        for customer in session.scalars(select(Customer)):
            customer.contract_end_date = ends[customer.id]


def overlap(engine, first, second) -> dict:
    """first 在自己的交易裡做完、還沒提交時，second 從另一條連線進來。
    回傳 second 有沒有被擋著等（blocked），以及它最後的結果（value）或丟出來的錯誤（error）。"""
    outcome: dict = {}
    with Session(engine) as a, Session(engine) as b:
        first(a)

        def run():
            try:
                outcome["value"] = second(b)
                b.commit()
            except HTTPException as exc:
                b.rollback()
                outcome["error"] = exc.status_code

        thread = threading.Thread(target=run)
        thread.start()
        thread.join(timeout=0.5)
        outcome["blocked"] = thread.is_alive()
        a.commit()
        thread.join(timeout=10)
        assert not thread.is_alive()
    return outcome


def signing(form_id: int, user_id: str, action: str = "approve", step_no: int | None = None):
    """一個請求裡的簽核：照 API 的做法先讀單、再簽。"""

    def act(session: Session):
        user = session.get(AppUser, user_id)
        return oa.decide(session, oa.load_form(session, form_id, user), user, action, None, step_no).status

    return act


def committed_discount(engine, discount_pct: float, quote_no: str) -> int:
    with Session(engine) as session:
        form = submit_discount(session, discount_pct, quote_no=quote_no)
        return form.id


def snapshot(engine, form_id: int, quote_no: str | None = None):
    with Session(engine) as session:
        form = session.get(OaExpenseForm, form_id)
        return form.status, [s.status for s in steps(session, form)], quote_no and quote_status(session, quote_no)


def test_a_double_click_does_not_sign_the_next_step_too(engine, committed):
    # 10% 折扣：區處主管連按兩次核准，第二次不能把業務處長那一關也放行
    form_id = committed_discount(engine, 10.0, "QRACE-0001")
    second = overlap(engine, signing(form_id, "M01"), signing(form_id, "M01"))
    assert second == {"blocked": True, "error": 403}
    assert snapshot(engine, form_id, "QRACE-0001") == ("pending", ["done", "done", "pending"], "pending_approval")

    # IT 任何一關都能代簽，連點兩次會連簽兩關：畫面送出時帶著它看到的那一關，對不上就不簽
    form_id = committed_discount(engine, 10.0, "QRACE-0002")
    second = overlap(engine, signing(form_id, "A01", step_no=2), signing(form_id, "A01", step_no=2))
    assert second == {"blocked": True, "error": 409}
    assert snapshot(engine, form_id, "QRACE-0002") == ("pending", ["done", "done", "pending"], "pending_approval")


def test_a_refusal_and_an_approval_at_the_same_moment_do_not_both_win(engine, committed):
    # 6% 折扣：主管駁回的同時 IT 代簽核准。先到的算數，後到的不能把單翻成已核准
    form_id = committed_discount(engine, 6.0, "QRACE-0003")
    second = overlap(engine, signing(form_id, "M01", "reject"), signing(form_id, "A01"))
    assert second == {"blocked": True, "error": 409}
    assert snapshot(engine, form_id, "QRACE-0003") == ("rejected", ["done", "done"], "rejected")

    # 續約也一樣：被駁回的續約不能同時被核准而延長合約
    with Session(engine) as session:
        form_id = submit_contract(session, customer_id="C003").id
    second = overlap(engine, signing(form_id, "M01", "reject"), signing(form_id, "A01"))
    assert second == {"blocked": True, "error": 409}
    assert snapshot(engine, form_id)[0] == "rejected"
    with Session(engine) as session:
        assert session.get(Customer, "C003").contract_end_date == dt.date(2026, 11, 17)


def test_signing_names_the_step_it_saw(tx, api, auth, model):
    form = submit_discount(tx, 10.0)

    def sign(user, **body):
        return api.post(f"/api/oa/forms/{form.id}/decide", json={"action": "approve"} | body, headers=auth(user))

    # 畫面上看到的是第 2 關，現在等簽的也是第 2 關：照簽
    assert sign("A01", step_no=2).json()["steps"][1]["status"] == "done"
    # 同一個畫面再送一次：第 2 關已經簽過了，不會順手把第 3 關也簽掉
    stale = sign("A01", step_no=2)
    assert stale.status_code == 409 and "重新整理" in stale.json()["detail"]
    assert [s.status for s in steps(tx, form)] == ["done", "done", "pending"]
    # 不帶就照舊簽現在等簽的那一關
    assert sign("A01").json()["status"] == "approved"
    # 整張單已經有結果了
    done = sign("A01")
    assert done.status_code == 409 and "已經" in done.json()["detail"]


def renewal_of(customer_id: str):
    def act(session: Session):
        customer = session.get(Customer, customer_id)
        payload = approvals.contract_payload(
            session, customer, TODAY, term_months=12, listing_fee_rate=0.08, channel_reward_rate=0.05, reason="",
        )
        return approvals.submit(session, kind="contract", applicant=session.get(AppUser, customer.owner_user_id),
                                customer=customer, payload=payload).form_no

    return act


def test_two_requests_filed_at_the_same_moment_get_their_own_numbers(engine, committed):
    # 兩家不同客戶同時送續約：兩張都拿到同一個流水號，後到的撞到唯一限制，要換下一號重送，不是 500
    numbers = {}
    second = overlap(engine, lambda session: numbers.update(first=renewal_of("C003")(session)), renewal_of("C007"))
    assert second["blocked"] is True and "error" not in second
    assert second["value"] != numbers["first"] and second["value"][:8] == numbers["first"][:8] == "CT202610"
    assert int(second["value"][8:]) == int(numbers["first"][8:]) + 1


def test_the_database_keeps_one_pending_renewal_per_customer(engine, committed):
    # 同一家同時送兩張：先檢查「有沒有還沒簽完的」兩邊都看不到對方，所以由資料庫的唯一索引守，後到的回 409
    second = overlap(engine, renewal_of("C003"), renewal_of("C003"))
    assert second == {"blocked": True, "error": 409}
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(OaExpenseForm).where(
            OaExpenseForm.kind == "contract", OaExpenseForm.customer_id == "C003", OaExpenseForm.status == "pending",
        )) == 1


def test_a_request_filed_today_heads_my_list_even_before_the_final(tx, api, auth, model):
    # 假資料的單建立在決賽日前兩週。照建立時間排的話，決賽日之前剛送出的單會沉到假資料後面、掉出前 50 張；
    # 照單據上的日期（送單當下的系統日）排，就一定在最前面
    model(fake_model(0.99))
    created = api.post(
        f"/api/customers/{GOOD}/quotes",
        json={"items": [{"sku": "HS-FO30", "qty": 10}], "discount_pct": 5, "reason": "量大"}, headers=auth("U01"),
    )
    assert created.json()["approval"]["status"] == "approved"
    listed = api.get("/api/oa/forms", params={"status": "approved"}, headers=auth("U01")).json()["items"]
    assert listed[0]["form_no"] == created.json()["approval"]["form_no"]
    auto = api.get("/api/oa/auto-approved", headers=auth("M01")).json()["items"]
    assert auto[0]["form_no"] == created.json()["approval"]["form_no"]
