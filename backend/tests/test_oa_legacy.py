"""原 OA 的模擬草稿與簽核：不呼叫外部 OA、SAP 或 LLM。"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select, text

from app.main import app
from app.models import AppSetting, OaExpenseForm
from app.services import oa_legacy
from app.services.oa_templates import COMMON_FIELDS, TEMPLATES


@pytest.fixture
def api(tx):
    return TestClient(app)


def body(code="expense", **overrides):
    return {"template_code": code, "fields": {}, "purpose": "", **overrides}


def sample(item):
    return body(item["code"], fields={f["key"]: {"company": "裕民", "business_unit": "保健醫材事業處", "receipt_no": "AB12345678"}.get(f["key"], "2026-11-01" if f["type"] == "date" else "10" if f["type"] == "number" else "已核對資料") for f in [*COMMON_FIELDS, *item["fields"]]}, purpose="申請用途", customer_id="C001" if item["needs_customer"] else None, submit=True)


def test_catalog_matches_all_screenshot_entries_and_marks_sap_and_query(api, auth):
    assert api.get("/api/oa/templates").status_code == 401
    data = api.get("/api/oa/templates", headers=auth()).json()
    assert len(data["templates"]) == 21
    assert {t["code"] for t in data["templates"] if t["sap_origin"]} == {"A042-pr", "A042-po"}
    assert [t["code"] for t in data["templates"] if t["query_only"]] == ["expense-list"]
    assert len(data["business_gaps"]) == 6
    assert api.post("/api/oa/forms", headers=auth(), json=body("expense-list")).status_code == 422
    assert api.get("/api/oa/customers").status_code == 401
    customers = api.get("/api/oa/customers", headers=auth(), params={"q": "C001"}).json()
    assert len(customers) == 1 and customers[0]["id"] == "C001"


def test_every_writable_template_can_submit_and_be_decided_without_customer_or_model(api, auth, tx):
    for item in TEMPLATES:
        if item["query_only"]:
            continue
        response = api.post("/api/oa/forms", headers=auth(), json=sample(item))
        assert response.status_code == 201, response.text
        form = response.json()
        assert form["kind_label"] == item["title"] and form["status"] == "pending"
        assert form["model"] is None and form["missing"] == []
        assert form["payload"]["simulation"] is True
        assert form["can_edit"] is False
        assert form["customer_id"] == ("C001" if item["needs_customer"] else None)
        assert form["steps"][-1]["name"] == "陳建宏"
        assert api.get(f"/api/oa/forms/{form['id']}", headers=auth("U02")).status_code == 404
        assert api.post(f"/api/oa/forms/{form['id']}/decide", headers=auth(), json={"action": "approve"}).status_code == 403
        approved = api.post(f"/api/oa/forms/{form['id']}/decide", headers=auth("M01"), json={"action": "approve", "step_no": 2})
        assert approved.status_code == 200, approved.text
        assert approved.json()["status"] == "approved"
    assert len(tx.scalars(select(OaExpenseForm).where(OaExpenseForm.kind == "legacy")).all()) == 20


def test_missing_data_draft_return_edit_and_resubmit_are_persistent(api, auth):
    draft = api.post("/api/oa/forms", headers=auth(), json=body()).json()
    assert draft["status"] == "draft" and draft["can_edit"]
    assert "總金額" in draft["missing"] and "公司" in draft["missing"]
    assert not draft["steps"]
    url = f"/api/oa/forms/{draft['id']}"
    assert api.put(url, headers=auth(), json=body(submit=True)).status_code == 422
    assert api.get(url, headers=auth()).json()["status"] == "draft"
    item = next(t for t in TEMPLATES if t["code"] == "expense")
    submitted = api.put(url, headers=auth(), json=sample(item)).json()
    assert submitted["id"] == draft["id"] and submitted["status"] == "pending"
    assert api.put(url, headers=auth(), json=sample(item)).status_code == 409
    returned = api.post(url + "/decide", headers=auth("M01"), json={"action": "return", "comment": "請補費用明細"}).json()
    assert returned["status"] == "returned"
    assert api.get(url, headers=auth()).json()["can_edit"]
    assert api.put(url, headers=auth("M01"), json=sample(item)).status_code == 403
    resubmitted = api.put(url, headers=auth(), json=sample(item)).json()
    assert len(resubmitted["steps"]) == 2
    assert [s["status"] for s in resubmitted["steps"]] == ["done", "pending"]
    assert resubmitted["comments"][0]["body"] == "請補費用明細"
    assert [a["action"] for a in resubmitted["activity"]] == ["submitted", "returned", "submitted"]


@pytest.mark.parametrize("code,fields", [("expense", {"amount": "NaN"}), ("expense", {"amount": "-5"}), ("expense", {"amount": "Infinity"}), ("6039", {"quantity": "1.5"}), ("6039", {"needed_date": "2026-02-30"}), ("6039", {"unauthorized": "value"})])
def test_invalid_values_never_save_or_send(api, auth, code, fields):
    assert api.post("/api/oa/forms", headers=auth(), json=body(code, fields=fields)).status_code == 422


def test_customer_required_and_date_order_are_enforced_on_server(api, auth):
    item = next(t for t in TEMPLATES if t["code"] == "6039")
    request = sample(item)
    request["customer_id"] = None
    response = api.post("/api/oa/forms", headers=auth(), json=request)
    assert response.status_code == 422 and "客戶" in response.json()["detail"]
    request["customer_id"] = "unknown"
    assert api.post("/api/oa/forms", headers=auth(), json=request).status_code == 404
    assert api.post("/api/oa/forms", headers=auth(), json=body("6014", fields={"start_date": "2026-11-20", "end_date": "2026-11-01"})).status_code == 422


def test_prefill_uses_explicit_text_and_known_account_leaves_unknowns_empty(api, auth):
    known = api.post("/api/oa/templates/expense/prefill", headers=auth(), json={}).json()
    assert known["fields"] == {"business_unit": "北區"}
    assert "總金額" in known["missing"] and "company" not in known["fields"]
    text = "外勤代號：HFVA2A；總金額：4927；費用類型：小額費用"
    result = api.post("/api/oa/templates/expense/prefill", headers=auth(), json={"mode": "text", "text": text}).json()
    assert result["fields"]["amount"] == "4927"
    assert result["fields"]["sales_code"] == "HFVA2A"
    assert result["purpose"] == text
    assert "expense_date" not in result["fields"]
    assert "輸入原文" in result["sources"]["amount"]


def test_old_sample_mode_never_invents_products_identifiers_or_money(api, auth):
    for item in TEMPLATES:
        assert all(field["sample"] == "" for field in item["fields"])
        if item["query_only"]:
            continue
        response = api.post(f"/api/oa/templates/{item['code']}/prefill", headers=auth(), json={"mode": "sample"})
        assert response.status_code == 200
        result = response.json()
        assert set(result["fields"]) <= {"business_unit", "printed_name", "email"}
        assert result["purpose"] == ""
        assert result["missing"]


def test_placeholder_cleanup_refuses_normal_forms_and_preserves_other_records(api, auth, tx):
    from scripts.clean_placeholder_forms import plan, remove

    normal = api.post("/api/oa/forms", headers=auth(), json=body(purpose="申請交通費")).json()
    placeholder = api.post("/api/oa/forms", headers=auth(), json=body(purpose="示範申請：交通費")).json()
    with pytest.raises(ValueError, match="不是原範例"):
        plan(tx.connection(), [normal["id"], placeholder["id"]])
    assert api.get(f"/api/oa/forms/{placeholder['id']}", headers=auth()).status_code == 200
    backup = plan(tx.connection(), [placeholder["id"]])
    assert remove(tx.connection(), backup) == 1
    assert backup["oa_expense_form"][0]["purpose"] == "示範申請：交通費"
    assert api.get(f"/api/oa/forms/{normal['id']}", headers=auth()).status_code == 200
    assert api.get(f"/api/oa/forms/{placeholder['id']}", headers=auth()).status_code == 404


def test_ai_values_need_verbatim_evidence_and_format_validation(api, auth, monkeypatch):
    class FakeLlm:
        def json(self, **kwargs):
            return {"values": [
                {"key": "amount", "value": "500", "evidence": "交通費 500 元"},
                {"key": "receipt_no", "value": "MADE-UP", "evidence": "原文不存在的憑證"},
                {"key": "expense_date", "value": "2026-02-30", "evidence": "交通費"},
            ]}
    monkeypatch.setattr(oa_legacy, "get_llm", lambda: FakeLlm())
    result = api.post("/api/oa/templates/expense/prefill", headers=auth(), json={"mode": "text", "text": "交通費 500 元"}).json()
    assert result["fields"]["amount"] == "500"
    assert "receipt_no" not in result["fields"] and "expense_date" not in result["fields"]


def test_filters_find_legacy_field_contents_and_preserve_owner_scope(api, auth):
    item = next(t for t in TEMPLATES if t["code"] == "expense")
    created = api.post("/api/oa/forms", headers=auth(), json=sample(item)).json()
    query = {"application": "expense", "company": "裕民", "unit": "保健醫材", "q": "AB12345678", "submitted_date": created["request_date"]}
    result = api.get("/api/oa/forms", headers=auth(), params=query).json()
    assert [i["id"] for i in result["items"]] == [created["id"]]
    assert result["total"] == result["counts"]["pending"] == 1
    assert api.get("/api/oa/forms", headers=auth("U02"), params=query).json()["items"] == []


def test_oa_scoped_upgrade_preserves_existing_forms_and_global_version(tx, api, auth):
    from scripts.upgrade_schema import upgrade_oa_forms
    before = tx.scalar(select(func.count()).select_from(OaExpenseForm))
    version = tx.get(AppSetting, "schema_version").value
    # 重建舊表的限制，驗證實際 ALTER 而非只驗證新模型。
    tx.execute(text("ALTER TABLE oa_expense_form ALTER COLUMN customer_id SET NOT NULL"))
    tx.execute(text("ALTER TABLE oa_expense_form DROP CONSTRAINT ck_oa_expense_form_kind"))
    tx.execute(text("ALTER TABLE oa_expense_form ADD CONSTRAINT ck_oa_expense_form_kind CHECK (kind IN ('trip','discount','contract'))"))
    upgrade_oa_forms(tx.connection())
    upgrade_oa_forms(tx.connection())  # 可以重跑。
    assert tx.scalar(select(func.count()).select_from(OaExpenseForm)) == before
    assert tx.get(AppSetting, "schema_version").value == version
    draft = api.post("/api/oa/forms", headers=auth(), json=body()).json()
    assert draft["status"] == "draft" and draft["customer_id"] is None


def test_trip_era_schema_adds_new_columns_without_reseeding_trip_history(tx, api, auth):
    from scripts.upgrade_schema import upgrade_oa_forms
    # 僅在可回滾的測試資料庫重建「當時只有出差單」的結構。
    tx.execute(delete(OaExpenseForm).where(OaExpenseForm.kind != "trip"))
    before = tx.scalar(select(func.count()).select_from(OaExpenseForm))
    assert before > 0
    for name in ("kind", "request_date", "payload", "required_level", "model_probability", "model_features", "auto_approved"):
        tx.execute(text(f"ALTER TABLE oa_expense_form DROP COLUMN {name} CASCADE"))
    for name in ("customer_id", "visit_id", "trip_date"):
        tx.execute(text(f"ALTER TABLE oa_expense_form ALTER COLUMN {name} SET NOT NULL"))
    upgrade_oa_forms(tx.connection())
    assert tx.scalar(select(func.count()).select_from(OaExpenseForm)) == before
    assert tx.scalar(select(func.count()).select_from(OaExpenseForm).where(OaExpenseForm.kind == "trip")) == before
    assert api.post("/api/oa/forms", headers=auth(), json=body()).status_code == 201


def test_oa_can_use_older_customer_master_without_order_workspace_columns(tx, api, auth):
    for name in ("area", "lat", "lng", "payment_term"):
        tx.execute(text(f"ALTER TABLE customer DROP COLUMN {name} CASCADE"))
    response = api.get("/api/oa/customers", headers=auth(), params={"q": "C001"})
    assert response.status_code == 200 and response.json()[0]["id"] == "C001"
    request = sample(next(t for t in TEMPLATES if t["code"] == "6039"))
    created = api.post("/api/oa/forms", headers=auth(), json=request)
    assert created.status_code == 201, created.text
    assert created.json()["customer_name"] == "康泰連鎖藥局 · 忠孝店"
    assert api.get("/api/oa/forms?application=6039", headers=auth()).json()["items"][0]["id"] == created.json()["id"]


def test_oa_upgrade_restores_ai_eligibility_tables_and_keeps_course_progress(tx):
    from sqlalchemy import inspect
    from app.models import LearningCompletion
    from scripts.upgrade_schema import upgrade_oa_forms

    tx.add(LearningCompletion(user_id="U01", lesson_id="customer-v1"))
    tx.flush()
    tx.execute(text("DROP TABLE sap_employee"))
    upgrade_oa_forms(tx.connection())
    assert inspect(tx.connection()).has_table("sap_employee")
    assert tx.get(LearningCompletion, ("U01", "customer-v1")) is not None
    # 只建缺少的表，不能憑空建立人員或課程過關紀錄。
    assert tx.scalar(text("SELECT count(*) FROM sap_employee")) == 0
    upgrade_oa_forms(tx.connection())
    assert tx.get(LearningCompletion, ("U01", "customer-v1")) is not None
