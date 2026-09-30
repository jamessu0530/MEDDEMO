"""OA 申請單：出差單回寫後有表單、簽核關卡、申請匣與主管批准；優惠與合約申請單共用同一套，關卡逐關推進。"""

import datetime as dt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from test_visits import make_draft

from app.config import NotConfigured
from app.main import app
from app.models import OaActivity, OaApprovalStep, OaExpenseForm
from app.services import oa, visit_processing
from app.tasks import redis


def not_configured():
    raise NotConfigured("測試：沒有設定")


@pytest.fixture
def client(engine, sign_in):
    with engine.connect() as conn:
        last = conn.execute(text("SELECT max(id) FROM visit")).scalar_one()
    yield sign_in(TestClient(app), "U01")
    with engine.begin() as conn:
        for table in ("writeback_log", "crm_visit_record", "sap_quotation_draft", "oa_expense_form"):
            conn.execute(text(f"DELETE FROM {table} WHERE visit_id > :last"), {"last": last})
        conn.execute(text("DELETE FROM visit WHERE id > :last"), {"last": last})
    redis().flushdb()


@pytest.fixture
def providers(monkeypatch):
    def use(transcriber=None, extractor=None):
        monkeypatch.setattr(visit_processing, "get_transcriber", (lambda: transcriber) if transcriber else not_configured)
        monkeypatch.setattr(visit_processing, "get_extractor", (lambda: extractor) if extractor else not_configured)

    return use


def not_configured():
    raise Exception("測試：沒有設定")


def test_confirm_opens_a_pending_trip_form_with_approval_steps(client, providers, engine, auth):
    visit_id = make_draft(client, providers)
    visit = client.post(f"/api/visits/{visit_id}/confirm").json()
    form_id = visit["oa_form_id"]
    assert form_id

    form = client.get(f"/api/oa/forms/{form_id}").json()
    assert (form["kind"], form["kind_label"]) == ("trip", "出差單")
    assert form["status"] == "pending"
    assert form["form_no"].startswith("OA")
    assert form["purpose"] == "客戶拜訪"
    assert form["customer_name"] == "康泰連鎖藥局 · 忠孝店"
    assert [s["role_label"] for s in form["steps"]] == ["請求者", "經辦人的主管"]
    assert form["steps"][0]["status"] == "done"
    assert form["steps"][0]["name"] == "林昱辰"
    assert form["steps"][1]["status"] == "pending"
    assert form["steps"][1]["name"] == "陳建宏"
    assert form["comments"] == []
    assert form["attachments"] == []
    assert form["activity"][0]["action"] == "submitted"

    listed = client.get("/api/oa/forms?status=pending").json()
    assert form_id in {item["id"] for item in listed["items"]}
    assert listed["counts"]["pending"] >= 1

    inbox = client.get("/api/oa/inbox", headers=auth("M01")).json()
    assert form_id in {item["id"] for item in inbox["items"]}
    assert client.get("/api/oa/inbox", headers=auth("M02")).json()["items"] == []
    assert client.get(f"/api/oa/forms/{form_id}", headers=auth("U02")).status_code == 404


def test_manager_can_approve_and_sales_cannot(client, providers, auth):
    visit_id = make_draft(client, providers)
    form_id = client.post(f"/api/visits/{visit_id}/confirm").json()["oa_form_id"]

    denied = client.post(f"/api/oa/forms/{form_id}/decide", json={"action": "approve"})
    assert denied.status_code == 403

    approved = client.post(
        f"/api/oa/forms/{form_id}/decide",
        json={"action": "approve", "comment": "准"},
        headers=auth("M01"),
    ).json()
    assert approved["status"] == "approved"
    assert approved["steps"][-1]["status"] == "done"
    assert any(c["body"] == "准" for c in approved["comments"])
    assert [a["action"] for a in approved["activity"]] == ["submitted", "approved"]
    assert form_id not in {item["id"] for item in client.get("/api/oa/inbox", headers=auth("M01")).json()["items"]}


def test_seeded_forms_are_approved_and_only_visible_to_the_owner(client, auth):
    mine = client.get("/api/oa/forms?status=approved").json()
    assert mine["counts"]["approved"] > 0
    assert all(item["status"] == "approved" for item in mine["items"])
    first = client.get(f"/api/oa/forms/{mine['items'][0]['id']}").json()
    assert first["steps"][-1]["status"] == "done"
    assert client.get(f"/api/oa/forms/{mine['items'][0]['id']}", headers=auth("U02")).status_code == 404
    # 歷史出差單都簽完了；主管的簽核匣裡只有展示用的三張優惠與合約申請
    inbox = client.get("/api/oa/inbox", headers=auth("M01")).json()
    assert inbox["counts"]["pending"] == 3
    assert [item["kind"] for item in inbox["items"]] == ["contract", "discount", "discount"]


# ── 三種申請單共用同一套（優惠、合約的規則與模型在 test_approvals.py）────────────────

TODAY = dt.date(2026, 10, 28)
DISCOUNT_PAYLOAD = {
    "quote_no": None, "discount_pct": 10.0, "list_amount": 50000, "amount": 45000, "cost": 30000, "reason": "競品開買十送一",
}


@pytest.fixture
def api():
    """跟 tx 一起用：API 與測試共用一條連線，測完回滾，不必自己清資料。"""
    return TestClient(app)


def discount_form(tx, approvers=(("經辦人的主管", "區處主管", "M01"), ("業務處長", "業務處長", "A01"))) -> OaExpenseForm:
    """直接寫一張優惠申請單：第一關請求者已完成，第二關等簽，後面的關卡排隊。"""
    form = OaExpenseForm(
        form_no=oa.next_form_no(tx, "DC", TODAY), kind="discount", applicant_id="U01", customer_id="C001",
        request_date=TODAY, purpose="報價折扣", unit_name="北區", payload=DISCOUNT_PAYLOAD,
        required_level="director", status="pending",
    )
    tx.add(form)
    tx.flush()
    tx.add(OaApprovalStep(form_id=form.id, step_no=1, role_label="請求者", user_id="U01", title="業務", status="done"))
    for n, (role_label, title, user_id) in enumerate(approvers, start=2):
        tx.add(OaApprovalStep(
            form_id=form.id, step_no=n, role_label=role_label, user_id=user_id, title=title,
            status="pending" if n == 2 else "waiting",
        ))
    tx.add(OaActivity(form_id=form.id, action="submitted", actor_id="U01", detail="經辦人送出"))
    tx.commit()
    return form


def decide(api, auth, form_id, user_id, action="approve"):
    return api.post(f"/api/oa/forms/{form_id}/decide", json={"action": action}, headers=auth(user_id))


def inbox_ids(api, auth, user_id):
    return {item["id"] for item in api.get("/api/oa/inbox", headers=auth(user_id)).json()["items"]}


def test_trip_forms_report_their_kind_and_a_one_line_summary(client, providers):
    visit_id = make_draft(client, providers)
    form_id = client.post(f"/api/visits/{visit_id}/confirm").json()["oa_form_id"]
    form = client.get(f"/api/oa/forms/{form_id}").json()
    day = dt.date.fromisoformat(form["trip_date"])
    assert form["summary"] == f"康泰連鎖藥局 · 忠孝店，{day.month}/{day.day} 拜訪"
    # 出差單沒有申請內容，也不經過模型
    assert form["payload"] is None and form["model"] is None and form["request_date"] is None
    item = next(i for i in client.get("/api/oa/forms?status=pending").json()["items"] if i["id"] == form_id)
    assert (item["kind"], item["kind_label"], item["summary"], item["model"]) == ("trip", "出差單", form["summary"], None)


def test_form_numbers_run_separately_for_each_kind(tx):
    first = oa.next_form_no(tx, "CT", TODAY)
    assert first[:8] == "CT202610" and len(first) == 13
    tx.add(OaExpenseForm(
        form_no=first, kind="contract", applicant_id="U01", customer_id="C001", request_date=TODAY,
        purpose="連鎖續約", unit_name="北區", payload={"term_months": 12},
    ))
    tx.flush()
    assert int(oa.next_form_no(tx, "CT", TODAY)[8:]) == int(first[8:]) + 1
    # 出差單的流水號不受影響：接在這個月最後一張出差單後面
    last_trip = tx.scalar(text("SELECT max(form_no) FROM oa_expense_form WHERE form_no LIKE 'OA202610%'"))
    assert int(oa.next_form_no(tx, "OA", TODAY)[8:]) == int(last_trip[8:]) + 1


def test_the_database_refuses_a_form_whose_fields_do_not_match_its_kind(tx):
    base = {"applicant_id": "U01", "customer_id": "C001", "purpose": "測試", "unit_name": "北區"}
    bad = [
        # 優惠申請單不跟著拜訪、一定有內容與送單日
        OaExpenseForm(form_no="DC-BAD-1", kind="discount", request_date=TODAY, **base),
        OaExpenseForm(form_no="DC-BAD-2", kind="discount", payload=DISCOUNT_PAYLOAD, **base),
        # 出差單一定跟著一次拜訪
        OaExpenseForm(form_no="OA-BAD-1", kind="trip", trip_date=TODAY, **base),
        OaExpenseForm(form_no="OA-BAD-2", kind="memo", request_date=TODAY, payload={}, **base),
    ]
    for form in bad:
        with pytest.raises(IntegrityError), tx.begin_nested():
            tx.add(form)
            tx.flush()


def test_a_form_with_several_steps_moves_one_step_at_a_time(tx, api, auth):
    form = discount_form(tx)
    shown = api.get(f"/api/oa/forms/{form.id}", headers=auth("U01")).json()
    assert (shown["kind"], shown["kind_label"], shown["flow_name"]) == ("discount", "優惠申請單", "優惠申請單_簽核流程")
    assert shown["summary"] == "折扣 10%，報價 NT$ 45,000"
    assert shown["payload"]["reason"] == "競品開買十送一"
    assert (shown["trip_date"], shown["request_date"], shown["visit_id"]) == (None, "2026-10-28", None)
    assert [s["status"] for s in shown["steps"]] == ["done", "pending", "waiting"]
    assert form.id in inbox_ids(api, auth, "M01")

    # 還沒輪到處長那一關：主管簽完，整張單還在審核中，換下一關等簽
    after_manager = decide(api, auth, form.id, "M01").json()
    assert after_manager["status"] == "pending"
    assert [s["status"] for s in after_manager["steps"]] == ["done", "done", "pending"]
    assert after_manager["can_decide"] is False
    assert form.id not in inbox_ids(api, auth, "M01")
    assert decide(api, auth, form.id, "M01").status_code == 403
    waiting = next(i for i in api.get("/api/oa/forms?status=pending", headers=auth("U01")).json()["items"] if i["id"] == form.id)
    assert waiting["approver_name"] == "James"

    # 最後一關核准，整張單才是已核准
    assert form.id in inbox_ids(api, auth, "A01")
    done = decide(api, auth, form.id, "A01").json()
    assert done["status"] == "approved"
    assert [s["status"] for s in done["steps"]] == ["done", "done", "done"]
    assert [a["action"] for a in done["activity"]] == ["submitted", "approved", "approved"]
    assert [a["detail"] for a in done["activity"]][1:] == ["區處主管核准", "業務處長核准"]


@pytest.mark.parametrize("action, status", [("reject", "rejected"), ("return", "returned")])
def test_a_rejection_midway_ends_the_whole_form(tx, api, auth, action, status):
    form = discount_form(tx)
    ended = decide(api, auth, form.id, "M01", action).json()
    assert ended["status"] == status
    # 後面的關卡不會再輪到：整張單已經有結果，再簽會被擋下來
    assert [s["status"] for s in ended["steps"]] == ["done", "done", "waiting"]
    assert decide(api, auth, form.id, "A01").status_code == 409
    assert form.id not in inbox_ids(api, auth, "A01")


def test_a_step_without_a_signer_is_shown_as_the_system(tx, api, auth):
    form = discount_form(tx, approvers=())
    tx.add(OaApprovalStep(form_id=form.id, step_no=2, role_label="系統核准", user_id=None, title="模型", status="done"))
    tx.add(OaActivity(form_id=form.id, action="auto_approved", actor_id=None, detail="模型估計核准機率 94%，高於門檻 90%，系統核准"))
    form.status, form.auto_approved, form.model_probability = "approved", True, 0.94
    tx.commit()

    shown = api.get(f"/api/oa/forms/{form.id}", headers=auth("U01")).json()
    assert [(s["role_label"], s["name"]) for s in shown["steps"]] == [("請求者", "林昱辰"), ("系統核准", "系統（模型）")]
    assert (shown["activity"][-1]["action"], shown["activity"][-1]["actor_name"]) == ("auto_approved", "系統（模型）")
    assert shown["model"]["auto_approved"] is True and shown["model"]["probability"] == 0.94
    assert shown["can_decide"] is False
