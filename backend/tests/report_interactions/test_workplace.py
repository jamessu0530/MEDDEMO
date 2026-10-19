"""打卡狀態、本人目標與來源整合；使用隔離資料庫，不接外部服務。"""

import datetime as dt
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.api import workplace
from app.main import app
from app.models import AppUser, AttendanceEvent, WorkGoal
from app.services.auth import create_token

NOW = dt.datetime(2031, 4, 17, 4, 0, tzinfo=dt.UTC)  # 台灣中午


@pytest.fixture
def setup_workplace(interaction_session, monkeypatch):
    session = interaction_session
    for model in (AttendanceEvent, WorkGoal):
        model.__table__.create(session.connection(), checkfirst=True)
    session.add(AppUser(id="IT1", name="IT", role="it", region="全國", unit_id="TW", org_path="TW"))
    session.flush()
    monkeypatch.setattr(workplace, "utc_now", lambda: NOW)
    return session, TestClient(app)


def headers(session, user_id="S1"):
    return {"Authorization": f"Bearer {create_token(session.get(AppUser, user_id))}"}


def punch(client, auth, direction="in", request_id=None):
    return client.post("/api/workplace/punch", headers=auth, json={"direction": direction, "request_id": request_id or str(uuid.uuid4())})


def test_no_record_does_not_infer_absence_or_use_demo_date(setup_workplace):
    session, client = setup_workplace
    response = client.get("/api/workplace", headers=headers(session))
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    result = response.json()
    assert result["date"] == "2031-04-17"
    assert result["members"] == [{"id": "S1", "name": "S1", "region": "北區", "status": "no_record", "latest_event": None}]
    assert result["goals"] == result["events"] == []
    assert client.get("/api/workplace").status_code == 401


def test_punch_updates_status_retries_and_reentry(setup_workplace, monkeypatch):
    session, client = setup_workplace
    auth = headers(session)
    request_id = str(uuid.uuid4())
    first = punch(client, auth, request_id=request_id)
    assert first.status_code == 200
    assert punch(client, auth, request_id=request_id).json()["id"] == first.json()["id"]
    assert punch(client, auth).json()["id"] == first.json()["id"]
    assert client.get("/api/workplace", headers=auth).json()["members"][0]["status"] == "in_company"
    monkeypatch.setattr(workplace, "utc_now", lambda: NOW + dt.timedelta(minutes=1))
    assert punch(client, auth, "out").status_code == 200
    assert client.get("/api/workplace", headers=auth).json()["members"][0]["status"] == "left_company"
    assert punch(client, auth, "out", request_id).status_code == 409
    monkeypatch.setattr(workplace, "utc_now", lambda: NOW + dt.timedelta(minutes=2))
    assert punch(client, auth).status_code == 200
    result = client.get("/api/workplace", headers=auth).json()
    assert result["members"][0]["status"] == "in_company"
    assert len(result["events"]) == 3


def test_taipei_midnight_resets_old_status_and_ignores_future_events(setup_workplace, monkeypatch):
    session, client = setup_workplace
    auth = headers(session)
    punch(client, auth)
    monkeypatch.setattr(workplace, "utc_now", lambda: dt.datetime(2031, 4, 17, 16, 0, tzinfo=dt.UTC))
    result = client.get("/api/workplace", headers=auth).json()
    assert result["date"] == "2031-04-18"
    assert result["events"] == []
    assert result["members"][0]["status"] == "no_record"
    monkeypatch.setattr(workplace, "utc_now", lambda: NOW - dt.timedelta(seconds=1))
    assert client.get("/api/workplace", headers=auth).json()["events"] == []


def test_manager_sees_own_team_status_and_never_personal_goals(setup_workplace):
    session, client = setup_workplace
    auth = headers(session)
    punch(client, auth)
    client.post("/api/workplace/goals", headers=auth, json={"title": "私人目標"})
    result = client.get("/api/workplace", headers=headers(session, "M1")).json()
    assert {person["id"] for person in result["members"]} == {"M1", "S1", "S2"}
    assert next(person for person in result["members"] if person["id"] == "S1")["status"] == "in_company"
    assert result["events"] == result["goals"] == []
    assert {person["id"] for person in client.get("/api/workplace", headers=headers(session, "M2")).json()["members"]} == {"M2", "S3"}
    assert len(client.get("/api/workplace", headers=headers(session, "IT1")).json()["members"]) == 6


def test_goals_persist_edit_complete_delete_and_enforce_owner(setup_workplace):
    session, client = setup_workplace
    auth = headers(session)
    response = client.post("/api/workplace/goals", headers=auth, json={"title": "  完成本月拜訪  ", "due_date": "2031-05-01", "note": "五家", "progress": 25})
    assert response.status_code == 201
    goal = response.json()
    assert goal["title"] == "完成本月拜訪"
    path = f'/api/workplace/goals/{goal["id"]}'
    assert client.put(path, headers=headers(session, "M1"), json={"title": "改掉"}).status_code == 404
    assert client.delete(path, headers=headers(session, "S2")).status_code == 404
    response = client.put(path, headers=auth, json={"title": "完成本月拜訪", "progress": 100})
    assert response.status_code == 200
    assert client.get("/api/workplace", headers=auth).json()["goals"][0]["progress"] == 100
    assert client.delete(path, headers=auth).status_code == 204
    assert client.get("/api/workplace", headers=auth).json()["goals"] == []
    for body in ({"title": "   "}, {"title": "目標", "progress": 101}, {"title": "目標", "progress": 1.5}, {"title": "目標", "due_date": "invalid"}):
        assert client.post("/api/workplace/goals", headers=auth, json=body).status_code == 422


def test_proxy_records_attendance_and_goals_for_real_account(setup_workplace):
    session, client = setup_workplace
    session.add(AppUser(id="X1", name="訪客", role="sales", region="北區", acts_as_user_id="S1"))
    session.flush()
    auth = headers(session, "X1")
    assert punch(client, auth).status_code == 200
    assert client.post("/api/workplace/goals", headers=auth, json={"title": "自己的目標"}).status_code == 201
    result = client.get("/api/workplace", headers=auth).json()
    assert result["user_id"] == "X1"
    assert result["members"][0]["id"] == "X1"
    assert result["members"][0]["status"] == "in_company"
    original = client.get("/api/workplace", headers=headers(session)).json()
    assert original["goals"] == original["events"] == []


def test_import_is_idempotent_validates_source_and_rolls_back_conflicts(setup_workplace):
    session, client = setup_workplace
    auth = headers(session, "IT1")
    event = {"external_id": "clock-1", "user_id": "S1", "direction": "in", "occurred_at": "2031-04-17T08:30:00+08:00"}
    body = {"source": "office-clock", "events": [event]}
    assert client.post("/api/workplace/events", headers=headers(session), json=body).status_code == 403
    assert client.post("/api/workplace/events", headers=auth, json=body).json() == {"inserted": 1, "skipped": 0}
    assert client.post("/api/workplace/events", headers=auth, json=body).json() == {"inserted": 0, "skipped": 1}
    conflict = {"source": "office-clock", "events": [{**event, "external_id": "new"}, {**event, "direction": "out"}]}
    assert client.post("/api/workplace/events", headers=auth, json=conflict).status_code == 409
    assert session.scalar(select(func.count()).select_from(AttendanceEvent)) == 1
    for invalid in ({**event, "user_id": "unknown"}, {**event, "occurred_at": "2031-04-17T08:30:00"}, {**event, "occurred_at": "2031-04-18T08:30:00+08:00"}):
        assert client.post("/api/workplace/events", headers=auth, json={"source": "office-clock", "events": [invalid]}).status_code == 422
    assert client.post("/api/workplace/events", headers=auth, json={"source": "personal", "events": [event]}).status_code == 422


def test_equal_timestamps_consistently_show_exit(setup_workplace):
    session, client = setup_workplace
    event = {"external_id": "same-1", "user_id": "S1", "direction": "in", "occurred_at": "2031-04-17T08:30:00+08:00"}
    assert client.post("/api/workplace/events", headers=headers(session, "IT1"), json={"source": "office-clock", "events": [event, {**event, "external_id": "same-2", "direction": "out"}]}).status_code == 200
    assert client.get("/api/workplace", headers=headers(session)).json()["members"][0]["status"] == "left_company"


def test_previous_schema_adds_workplace_tables_without_reseeding(interaction_session):
    from sqlalchemy import inspect
    from app.models import AppSetting, SalesTransaction
    from scripts.upgrade_schema import PRE_WORKPLACE_VERSION, upgrade

    session = interaction_session
    session.add(AppSetting(key="schema_version", value=PRE_WORKPLACE_VERSION))
    session.flush()
    assert "既有資料保留" in upgrade(session.connection())
    assert {"attendance_event", "work_goal"} <= set(inspect(session.connection()).get_table_names())
    assert session.scalar(select(func.count()).select_from(SalesTransaction)) == 6
