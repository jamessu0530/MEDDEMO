"""新人操作課程：過關、重送、帳號隔離，以及登入後即可使用 AI API。"""

import datetime as dt
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.main import app
from app.models import AppUser, LearningCompletion
from app.services import auth as auth_service, learning
from app.services.voice import VoiceSession
from app.tasks import redis

ANSWERS = {
    "customer-v1": {"opened": True, "priority": "promise"},
    "product-v1": {"view": "promotions", "sku": "C130082", "quantity": "12"},
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


@pytest.fixture
def demo_enabled(env):
    env(DEMO_SKIP_LEARNING="true")
    yield
    keys = list(redis().scan_iter(f"{learning.DEMO_SKIP_PREFIX}*"))
    if keys:
        redis().delete(*keys)


@pytest.mark.parametrize("demo_skip", ["true", "false"])
def test_new_accounts_can_use_ai_without_courses_or_demo_skip(tx, client, monkeypatch, env, demo_skip):
    env(DEMO_SKIP_LEARNING=demo_skip, LLM_PROVIDER="gemini")
    headers = new_account(tx)
    monkeypatch.setattr("app.services.ask_followup.standalone", lambda question, earlier: question)
    monkeypatch.setattr("app.services.ask_router.route", lambda *_: SimpleNamespace(kind="knowledge", choices=[], confidence=1.0))
    queued = []
    monkeypatch.setattr("app.api.asks.visit_queue", lambda: SimpleNamespace(enqueue=lambda *args: queued.append(args)))
    monkeypatch.setattr("app.services.voice.vocabulary", lambda *_: "")
    monkeypatch.setattr("app.services.voice.create_session", lambda *_: VoiceSession(
        token="demo-token", model="demo-model", api_version="v1beta",
        expires_at=dt.datetime.now(dt.UTC) + dt.timedelta(minutes=30), config={}, tool_kinds={},
    ))
    for login in range(2):
        state = client.get("/api/first-week/course", headers=headers).json()
        assert state["completed"] == []
        assert state["xp"] == 0
        assert state["ai_unlocked"] is True
        assert client.post("/api/asks/route", headers=headers, json={"question": "促銷條件？"}).status_code == 200
        assert client.post("/api/asks", headers=headers, json={"kind": "knowledge", "question": "促銷條件？"}).status_code == 202
        assert client.post("/api/voice/session", headers=headers).status_code == 200
        if login == 0:
            user = tx.get(AppUser, "XLEARN")
            user.session_version += 1
            tx.commit()
            headers = {"Authorization": f"Bearer {auth_service.create_token(user)}"}
    assert len(queued) == 2
    assert tx.scalar(select(func.count()).select_from(LearningCompletion).where(LearningCompletion.user_id == "XLEARN")) == 0


def test_legacy_demo_skip_preserves_course_progress_and_auth(tx, client, auth, demo_enabled, env):
    headers = new_account(tx)
    assert client.post("/api/first-week/course/demo-skip").status_code == 401
    assert client.post("/api/first-week/course/demo-skip", headers=auth("M01")).status_code == 403
    assert submit(client, headers, "customer-v1").json()["xp"] == 20
    skipped = client.post("/api/first-week/course/demo-skip", headers=headers)
    assert skipped.status_code == 200
    assert skipped.json()["completed"] == ["customer-v1"]
    assert skipped.json()["xp"] == 20
    assert skipped.json()["ai_unlocked"] is True
    env(DEMO_SKIP_LEARNING="false")
    assert client.post("/api/first-week/course/demo-skip", headers=headers).status_code == 403
    assert client.get("/api/first-week/course", headers=headers).json()["ai_unlocked"] is True
    assert submit(client, headers, "route-v1").status_code == 409


@pytest.mark.parametrize("path,body", [
    ("/api/asks", {"kind": "knowledge", "question": "促銷條件？"}),
    ("/api/asks/route", {"question": "促銷條件？"}),
    ("/api/voice/session", None),
])
def test_ai_still_requires_login(client, path, body):
    assert client.post(path, json=body).status_code == 401


def test_wrong_answer_and_skipping_do_not_save_progress(tx, client):
    headers = new_account(tx)
    assert submit(client, headers, "product-v1").status_code == 409
    assert submit(client, headers, "customer-v1", {"opened": True, "priority": "order"}).status_code == 422
    state = client.get("/api/first-week/course", headers=headers).json()
    assert state["completed"] == []
    assert state["xp"] == 0
    assert state["ai_unlocked"] is True
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


def test_course_progress_is_optional_and_keeps_real_xp(tx, client):
    headers = new_account(tx)
    for index, lesson_id in enumerate(learning.LESSON_IDS, 1):
        response = submit(client, headers, lesson_id)
        assert response.status_code == 200
        assert response.json()["ai_unlocked"] is True
        assert response.json()["xp"] == index * 20
    assert response.json()["completed"] == list(learning.LESSON_IDS)


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
