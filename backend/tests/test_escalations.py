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
def client(engine, sign_in):
    yield sign_in(TestClient(app), "U01")
    # 刪提問時，轉給主管的那筆一起刪（ON DELETE CASCADE）
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM ask_record WHERE question LIKE '測試：%'"))


def escalate(client, engine, question="測試：近效期品項可以換貨嗎"):
    ask_id = uuid.uuid4().hex
    with Session(engine) as session:
        session.add(AskRecord(
            id=ask_id, user_id="U01", kind="knowledge", question=question, status="no_evidence", answer=SYSTEM_ANSWER
        ))
        session.commit()
    return client.post(f"/api/asks/{ask_id}/escalate").json()["escalation_id"]


def unseen(client):
    return client.get("/api/escalations/unseen").json()["count"]


def test_a_manager_reply_reminds_the_rep_until_it_is_read(client, engine, auth):
    escalation_id = escalate(client, engine)
    before = unseen(client)
    waiting = {item["id"]: item for item in client.get("/api/escalations", params={"status": "open"}).json()}
    assert waiting[escalation_id]["system_answer"] == SYSTEM_ANSWER
    assert waiting[escalation_id]["answer"] is None

    replied = client.post(
        f"/api/escalations/{escalation_id}/reply",
        json={"answer": "  可以，走近效期換貨單。 "},
        headers=auth("M01"),
    ).json()
    assert replied["status"] == "answered"
    assert replied["answer"] == "可以，走近效期換貨單。"
    assert replied["answered_by"] == "陳建宏"
    assert unseen(client) == before + 1
    assert escalation_id not in {item["id"] for item in client.get("/api/escalations", params={"status": "open"}).json()}

    assert client.post(f"/api/escalations/{escalation_id}/seen").json()["seen_at"] is not None
    assert unseen(client) == before

    # 主管改了回覆，業務會再收到一次提醒
    # 同一區才改得到（林昱辰在北區）；中區主管看不到這一筆
    client.post(f"/api/escalations/{escalation_id}/reply", json={"answer": "要附批號照片。"}, headers=auth("M01"))
    assert unseen(client) == before + 1


def test_only_managers_can_reply_and_a_reply_cannot_be_blank(client, engine, auth):
    escalation_id = escalate(client, engine)
    reply = f"/api/escalations/{escalation_id}/reply"
    # 沒登入、業務登入都不能回覆
    assert TestClient(app).post(reply, json={"answer": "可以"}).status_code == 401
    assert client.post(reply, json={"answer": "可以"}, headers=auth("U01")).status_code == 403
    assert client.post(reply, json={"answer": "   "}, headers=auth("M01")).status_code == 422
    assert client.post("/api/escalations/999999/reply", json={"answer": "可以"}, headers=auth("M01")).status_code == 404


def test_a_question_without_a_reply_is_not_marked_as_seen(client, engine):
    escalation_id = escalate(client, engine)
    assert client.post(f"/api/escalations/{escalation_id}/seen").json()["seen_at"] is None


def test_reps_only_see_their_own_questions_and_managers_only_their_region(client, engine, auth):
    escalation_id = escalate(client, engine)  # 林昱辰（北區）轉出去的
    assert escalation_id in {e["id"] for e in client.get("/api/escalations").json()}
    # 同區的王冠宇看不到、也不能標已讀
    assert escalation_id not in {e["id"] for e in client.get("/api/escalations", headers=auth("U02")).json()}
    assert client.post(f"/api/escalations/{escalation_id}/seen", headers=auth("U02")).status_code == 404
    # 北區主管看得到；中區主管看不到、也不能回覆
    assert escalation_id in {e["id"] for e in client.get("/api/escalations", headers=auth("M01")).json()}
    assert escalation_id not in {e["id"] for e in client.get("/api/escalations", headers=auth("M02")).json()}
    assert client.post(
        f"/api/escalations/{escalation_id}/reply", json={"answer": "可以"}, headers=auth("M02")
    ).status_code == 404

