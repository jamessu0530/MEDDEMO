"""品類成就：真正答對才解鎖、順序、重送與代理帳號隔離。"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models import AppUser, LearningCompletion
from app.services import auth as auth_service, learning

CATEGORIES = {"chronic": "慢性處方", "otc": "一般用藥", "wellness": "保健品", "devices": "醫材"}


@pytest.fixture
def client(tx):
    return TestClient(app)


def account(tx, user_id):
    user = AppUser(id=user_id, name="品類練習業務", role="sales", region="北區", acts_as_user_id="U01")
    tx.add(user); tx.commit()
    return {"Authorization": f"Bearer {auth_service.create_token(user)}"}


def correct_answers(detail):
    reference = detail["reference"][0]
    if detail["tier"] == 1:
        return {"category": CATEGORIES[detail["kind"]], "identity": "sku"}
    if detail["tier"] == 2:
        return {"spec": f"spec:{reference['spec'].strip()}", "unit": reference["unit"]}
    return {"sku": reference["sku"], "quantity": "3", "verify": "verify"}


def finish(client, headers, kind, tier):
    path = f"/api/first-week/product-courses/{kind}/{tier}"
    detail = client.get(path, headers=headers)
    assert detail.status_code == 200, detail.text
    return client.post(f"{path}/complete", headers=headers, json={"answers": correct_answers(detail.json())})


def test_every_medal_has_a_name_condition_and_next_step(client, auth):
    data = client.get("/api/me", headers=auth()).json()
    assert len(data["medals"]) == 18
    for medal in data["medals"]:
        assert medal["title"] and medal["condition"] and medal["unit"] and medal["action_path"]
    courses = client.get("/api/first-week/product-courses", headers=auth()).json()
    assert [course["category"] for course in courses] == list(CATEGORIES.values())
    assert all(course["completed"] == 0 for course in courses)
    assert all([l["locked"] for l in course["lessons"]] == [False, True, True] for course in courses)


@pytest.mark.parametrize("kind", CATEGORIES)
def test_three_levels_unlock_the_corresponding_tier_and_replay_does_not_award_twice(client, auth, tx, kind):
    headers = auth()
    for tier in (1, 2, 3):
        result = finish(client, headers, kind, tier)
        assert result.status_code == 200, result.text
        unlocked = result.json()["unlocked"]
        assert [(m["kind"], m["tier"]) for m in unlocked] == [(kind, tier)]
        assert unlocked[0]["have"] == tier and unlocked[0]["unlocked_at"] and unlocked[0]["unlocked_on"]
        assert finish(client, headers, kind, tier).json()["unlocked"] == []
    medals = client.get("/api/me", headers=headers).json()["medals"]
    own = [m for m in medals if m["kind"] == kind]
    assert all(m["have"] == 3 and m["unlocked_on"] for m in own)
    assert all(m["have"] == 0 and not m["unlocked_on"] for m in medals if m["kind"] in CATEGORIES and m["kind"] != kind)
    assert tx.scalar(select(func.count()).select_from(LearningCompletion).where(LearningCompletion.lesson_id.like(f"product-{kind}-%"))) == 3


def test_wrong_answers_and_skipping_cannot_unlock(tx, client, auth):
    headers = auth()
    path = "/api/first-week/product-courses/devices"
    assert client.get(f"{path}/3", headers=headers).json()["locked"] is True
    assert client.post(f"{path}/3/complete", headers=headers, json={"answers": {}}).status_code == 409
    assert client.post(f"{path}/1/complete", headers=headers, json={"answers": {"category": "保健品", "identity": "sku"}}).status_code == 422
    assert client.post(f"{path}/1/complete", headers=headers, json={"answers": {"category": "醫材", "identity": "name"}}).status_code == 422
    assert tx.scalar(select(func.count()).select_from(LearningCompletion)) == 0
    finish(client, headers, "devices", 1)
    assert client.get("/api/first-week/product-courses/chronic/1", headers=headers).json()["locked"] is False


def test_learning_progress_belongs_to_the_login_not_the_shared_representative(tx, client):
    mine, other = account(tx, "XMEDAL1"), account(tx, "XMEDAL2")
    assert finish(client, mine, "chronic", 1).status_code == 200
    first = client.get("/api/me", headers=mine).json()
    second = client.get("/api/me", headers=other).json()
    assert first["name"] == second["name"] == "林昱辰"
    assert next(m for m in first["medals"] if m["kind"] == "chronic" and m["tier"] == 1)["unlocked_on"]
    assert all(not m["unlocked_on"] for m in second["medals"] if m["kind"] in CATEGORIES)
    assert client.get("/api/first-week/course", headers=mine).json()["xp"] == 0
    assert learning.ai_unlocked(tx, tx.get(AppUser, "XMEDAL1")) is False


def test_training_is_authenticated_and_invalid_categories_are_rejected(client, auth):
    assert client.get("/api/first-week/product-courses").status_code == 401
    assert client.get("/api/first-week/product-courses", headers=auth("M01")).status_code == 403
    assert client.post("/api/first-week/product-courses/chronic/1/complete", headers=auth("M01"), json={"answers": {}}).status_code == 403
    for path in ("missing/1", "chronic/0", "devices/4"):
        assert client.get(f"/api/first-week/product-courses/{path}", headers=auth()).status_code == 404
