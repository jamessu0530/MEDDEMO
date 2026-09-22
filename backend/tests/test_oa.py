"""OA 出差單：回寫後有表單、簽核關卡、申請匣與主管批准。"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from test_visits import make_draft

from app.config import NotConfigured
from app.main import app
from app.services import visit_processing
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
    assert form["kind"] == "出差單"
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
    assert client.get("/api/oa/inbox", headers=auth("M01")).json()["counts"]["pending"] == 0
