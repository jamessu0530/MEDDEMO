"""新人操作課程：過關、重送、帳號隔離，以及真正的 AI API 解鎖。"""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.main import app
from app.models import AppUser, LearningCompletion
from app.services import auth as auth_service, learning

ANSWERS = {
    "customer-v1": {"opened": True, "priority": "promise"},
    "product-v1": {"view": "promotions", "sku": "DEMO-A", "quantity": "12"},
    "route-v1": {"order": ["clinic", "pharmacy"]},
    "visit-v1": {"reviewed": True, "competitor": "御松田", "intent": ""},
    "ask-v1": {"asked": True, "source_opened": True, "action": "escalate"},
}


@pytest.fixture
def client(engine):
    return TestClient(app)


def new_account(tx, user_id="XLEARN"):
    user = AppUser(id=user_id, name="課程新人", role="sales", region="北區", acts_as_user_id="U01")
    tx.add(user)
    tx.commit()
    return {"Authorization": f"Bearer {auth_service.create_token(user)}"}


def submit(client, headers, lesson_id, answer=None):
    return client.post(f"/api/first-week/course/{lesson_id}/complete", headers=headers, json={"answer": ANSWERS[lesson_id] if answer is None else answer})


def test_wrong_answer_and_skipping_do_not_save_progress(tx, client):
    headers = new_account(tx)
    assert submit(client, headers, "product-v1").status_code == 409
    assert submit(client, headers, "customer-v1", {"opened": True, "priority": "order"}).status_code == 422
    state = client.get("/api/first-week/course", headers=headers).json()
    assert state["completed"] == []
    assert state["xp"] == 0
    assert state["ai_unlocked"] is False
    assert client.post("/api/first-week/course/missing/complete", headers=headers, json={"answer": {}}).status_code == 404


def test_progress_is_saved_per_login_and_replaying_does_not_award_again(tx, client):
    headers = new_account(tx)
    other = new_account(tx, "XLEARN2")
    assert submit(client, headers, "customer-v1").json()["xp"] == 20
    assert submit(client, headers, "customer-v1").json()["xp"] == 20
    # 新的 TestClient 模擬換裝置，仍由登入帳號讀到進度。
    assert TestClient(app).get("/api/first-week/course", headers=headers).json()["completed"] == ["customer-v1"]
    assert client.get("/api/first-week/course", headers=other).json()["completed"] == []
    assert tx.scalar(select(func.count()).select_from(LearningCompletion).where(LearningCompletion.user_id == "XLEARN")) == 1


def test_ai_apis_block_until_all_lessons_are_complete(tx, client, monkeypatch):
    headers = new_account(tx)
    monkeypatch.setattr("app.services.ask_followup.standalone", lambda question, earlier: question)
    routed = []
    def route(question, has_file):
        routed.append(question)
        return SimpleNamespace(kind="knowledge", choices=[], confidence=1.0)
    monkeypatch.setattr("app.services.ask_router.route", route)
    for path, body in (
        ("/api/asks", {"kind": "knowledge", "question": "促銷條件？"}),
        ("/api/asks/route", {"question": "促銷條件？"}),
        ("/api/voice/session", None),
    ):
        assert client.post(path, headers=headers, json=body).status_code == 403
    assert routed == []
    for lesson_id in learning.LESSON_IDS:
        response = submit(client, headers, lesson_id)
        assert response.status_code == 200
        if lesson_id != "ask-v1":
            assert response.json()["ai_unlocked"] is False
    assert response.json()["xp"] == 100
    assert response.json()["ai_unlocked"] is True
    assert client.post("/api/asks/route", headers=headers, json={"question": "促銷條件？"}).status_code == 200
    assert routed == ["促銷條件？"]


def test_existing_staff_keep_ai_access_and_managers_cannot_take_lessons(client, auth):
    assert client.get("/api/first-week/course", headers=auth("U01")).json()["ai_unlocked"] is True
    manager = client.get("/api/first-week/course", headers=auth("M01")).json()
    assert manager["available"] is False
    assert manager["ai_unlocked"] is True
    assert submit(client, auth("M01"), "customer-v1").status_code == 403
    assert client.get("/api/first-week/course").status_code == 401


def test_progress_can_be_restored_with_account_settings(tx, client):
    from seed import KeptAccounts, restore_settings

    headers = new_account(tx)
    submit(client, headers, "customer-v1")
    row = tx.get(LearningCompletion, ("XLEARN", "customer-v1"))
    saved = {"user_id": row.user_id, "lesson_id": row.lesson_id, "completed_at": row.completed_at}
    tx.execute(delete(LearningCompletion).where(LearningCompletion.user_id == "XLEARN"))
    tx.commit()
    kept = KeptAccounts(users=[], identities=[], settings={"learning_completion": [saved]})
    assert restore_settings(tx, kept)["learning_completion"] == 1
    tx.commit()
    assert client.get("/api/first-week/course", headers=headers).json()["xp"] == 20


def test_deleting_an_account_also_deletes_its_progress(tx, client):
    headers = new_account(tx)
    submit(client, headers, "customer-v1")
    tx.delete(tx.get(AppUser, "XLEARN"))
    tx.commit()
    assert tx.scalar(select(func.count()).select_from(LearningCompletion).where(LearningCompletion.user_id == "XLEARN")) == 0


@pytest.mark.parametrize("lesson_id", learning.LESSON_IDS)
def test_each_lesson_requires_its_operation_and_correct_result(lesson_id):
    learning.validate_answer(lesson_id, ANSWERS[lesson_id])
    with pytest.raises(learning.LearningError):
        learning.validate_answer(lesson_id, {})
    for field in ANSWERS[lesson_id]:
        wrong = ANSWERS[lesson_id] | {field: None}
        with pytest.raises(learning.LearningError):
            learning.validate_answer(lesson_id, wrong)
