"""FR-8.4 延伸：轉給主管的提問，主管回覆後業務收到提醒，看過就不再提醒。"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.main import app
from app.models import AskRecord

SYSTEM_ANSWER = "內部文件裡找不到這個問題的依據。"


@pytest.fixture
def client(engine):
    yield TestClient(app)
    # 刪提問時，轉給主管的那筆一起刪（ON DELETE CASCADE）
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM ask_record WHERE question LIKE '測試：%'"))


def escalate(client, engine, question="測試：近效期品項可以換貨嗎"):
    ask_id = uuid.uuid4().hex
    with Session(engine) as session:
        session.add(AskRecord(id=ask_id, kind="knowledge", question=question, status="no_evidence", answer=SYSTEM_ANSWER))
        session.commit()
    return client.post(f"/api/asks/{ask_id}/escalate").json()["escalation_id"]


def unseen(client):
    return client.get("/api/escalations/unseen").json()["count"]


def test_a_manager_reply_reminds_the_rep_until_it_is_read(client, engine):
    escalation_id = escalate(client, engine)
    before = unseen(client)
    waiting = {item["id"]: item for item in client.get("/api/escalations", params={"status": "open"}).json()}
    assert waiting[escalation_id]["system_answer"] == SYSTEM_ANSWER
    assert waiting[escalation_id]["answer"] is None

    replied = client.post(
        f"/api/escalations/{escalation_id}/reply", json={"manager_id": "M01", "answer": "  可以，走近效期換貨單。 "}
    ).json()
    assert replied["status"] == "answered"
    assert replied["answer"] == "可以，走近效期換貨單。"
    assert replied["answered_by"] == "陳建宏"
    assert unseen(client) == before + 1
    assert escalation_id not in {item["id"] for item in client.get("/api/escalations", params={"status": "open"}).json()}

    assert client.post(f"/api/escalations/{escalation_id}/seen").json()["seen_at"] is not None
    assert unseen(client) == before

    # 主管改了回覆，業務會再收到一次提醒
    client.post(f"/api/escalations/{escalation_id}/reply", json={"manager_id": "M02", "answer": "要附批號照片。"})
    assert unseen(client) == before + 1


def test_only_managers_can_reply_and_a_reply_cannot_be_blank(client, engine):
    escalation_id = escalate(client, engine)
    reply = f"/api/escalations/{escalation_id}/reply"
    assert client.post(reply, json={"manager_id": "U01", "answer": "可以"}).status_code == 422
    assert client.post(reply, json={"manager_id": "M01", "answer": "   "}).status_code == 422
    assert client.post("/api/escalations/999999/reply", json={"manager_id": "M01", "answer": "可以"}).status_code == 404


def test_a_question_without_a_reply_is_not_marked_as_seen(client, engine):
    escalation_id = escalate(client, engine)
    assert client.post(f"/api/escalations/{escalation_id}/seen").json()["seen_at"] is None


def test_the_reply_form_lists_every_manager(client):
    assert [m["name"] for m in client.get("/api/escalations/managers").json()] == ["陳建宏", "張淑芬", "許文彬"]
