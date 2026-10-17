"""一般行曆的資料隔離、共享、邀請、重複例外、ICS 與提醒。"""

import datetime as dt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import AppUser, PlannerCalendar, PlannerEvent, PlannerNotification
from app.services import planner_notifications


@pytest.fixture
def api():
    return TestClient(app)


@pytest.fixture
def mine(tx, api, auth):
    headers = auth("U01")
    response = api.get("/api/planner", headers=headers)
    assert response.status_code == 200, response.text
    return headers, response.json()["calendars"][0]["id"]


def payload(calendar_id, **changes):
    return {"calendar_id": calendar_id, "title": "讀書會", "starts_at": "2026-10-20T09:00:00+08:00", "ends_at": "2026-10-20T10:00:00+08:00",
            "timezone": "Asia/Taipei", "all_day": False, "location": "台北圖書館", "description": "帶筆記本", "url": "", "recurrence": None, "reminders": [15], "attendees": [], **changes}


def create(api, mine, **changes):
    headers, calendar_id = mine
    response = api.post("/api/planner/events", json=payload(calendar_id, **changes), headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def change_body(event, **changes):
    fields = {key: event[key] for key in payload(event["calendar_id"])}
    fields["attendees"] = [a["email"] for a in event["attendees"]]
    return {**fields, "expected_sequence": event["sequence"], "scope": "all", **changes}


def test_create_search_edit_and_stale_version(api, mine, auth):
    event = create(api, mine)
    assert api.get(f"/api/planner/events/{event['id']}", headers=auth("U02")).status_code == 404
    assert api.get("/api/planner/search?q=筆記本", headers=mine[0]).json()["events"][0]["id"] == event["id"]
    changed = api.put(f"/api/planner/events/{event['id']}", json=change_body(event, title="新標題"), headers=mine[0])
    assert changed.status_code == 200 and changed.json()["sequence"] == event["sequence"] + 1
    assert api.put(f"/api/planner/events/{event['id']}", json=change_body(event, title="過期修改"), headers=mine[0]).status_code == 409
    assert api.delete(f"/api/planner/events/{event['id']}?expected_sequence={event['sequence']}", headers=mine[0]).status_code == 409


def test_calendar_share_requires_acceptance_and_enforces_read_only(api, mine, auth):
    headers, calendar_id = mine
    created = create(api, mine)
    assert api.post(f"/api/planner/calendars/{calendar_id}/members", json={"user_id": "U02", "role": "reader"}, headers=headers).status_code == 201
    assert api.get(f"/api/planner/events/{created['id']}", headers=auth("U02")).status_code == 404
    assert api.put(f"/api/planner/calendars/{calendar_id}/response", json={"status": "accepted"}, headers=auth("U02")).status_code == 200
    assert api.get(f"/api/planner/events/{created['id']}", headers=auth("U02")).json()["can_edit"] is False
    assert api.post("/api/planner/events", json=payload(calendar_id), headers=auth("U02")).status_code == 403
    assert api.post(f"/api/planner/calendars/{calendar_id}/members", json={"user_id": "U02", "role": "editor"}, headers=headers).status_code == 201
    assert api.post("/api/planner/events", json=payload(calendar_id), headers=auth("U02")).status_code == 201
    assert api.delete(f"/api/planner/calendars/{calendar_id}/members/U02", headers=headers).status_code == 204
    assert api.get(f"/api/planner/events/{created['id']}", headers=auth("U02")).status_code == 404


def test_event_guest_cannot_read_other_calendar_events(api, mine, tx, auth):
    guest_email = tx.get(AppUser, "U02").email
    invited, private = create(api, mine, attendees=[guest_email]), create(api, mine, title="私人行程")
    assert api.get(f"/api/planner/events/{invited['id']}", headers=auth("U02")).json()["calendar_id"] == "invitations"
    assert api.get(f"/api/planner/events/{private['id']}", headers=auth("U02")).status_code == 404
    assert api.put(f"/api/planner/events/{invited['id']}/response", json={"status": "accepted"}, headers=auth("U02")).status_code == 200
    assert api.get(f"/api/planner/events/{invited['id']}", headers=mine[0]).json()["attendees"][0]["status"] == "accepted"
    assert api.put(f"/api/planner/events/{invited['id']}", json=change_body(invited, title="越權修改"), headers=auth("U02")).status_code == 404


def test_one_occurrence_moves_outside_series_range_without_losing_others(api, mine):
    event = create(api, mine, recurrence="FREQ=WEEKLY;COUNT=3")
    response = api.put(f"/api/planner/events/{event['id']}", headers=mine[0], json=change_body(event, scope="one", occurrence=event["starts_at"],
        starts_at="2026-12-20T09:00:00+08:00", ends_at="2026-12-20T10:00:00+08:00"))
    assert response.status_code == 200, response.text
    found = api.get("/api/planner/events", params={"start": "2026-12-20T00:00:00+08:00", "end": "2026-12-21T00:00:00+08:00"}, headers=mine[0]).json()["events"]
    assert len(found) == 1 and found[0]["occurrence"] == event["occurrence"]
    remaining = api.get("/api/planner/events", params={"start": "2026-10-01T00:00:00+08:00", "end": "2026-11-10T00:00:00+08:00"}, headers=mine[0]).json()["events"]
    assert len(remaining) == 2
    linked = api.get(f"/api/planner/events/{event['id']}?date=2026-12-20", headers=mine[0]).json()
    assert linked["starts_at"].startswith("2026-12-20")
    assert linked["recurrence"] == "FREQ=WEEKLY;COUNT=3"
    search = api.get("/api/planner/search?q=讀書會", headers=mine[0]).json()["events"]
    assert all(row["starts_at"] != event["starts_at"] for row in search)


def test_feed_token_is_revocable_and_calendar_import_preserves_uid(api, mine):
    event = create(api, mine, recurrence="FREQ=WEEKLY;COUNT=3", title="中文、逗號；換行\n活動")
    headers, calendar_id = mine
    exported = api.get(f"/api/planner/calendars/{calendar_id}/export.ics", headers=headers)
    assert exported.status_code == 200 and b"BEGIN:VCALENDAR" in exported.content
    assert b"BEGIN:VTIMEZONE" in exported.content
    imported = api.post(f"/api/planner/calendars/{calendar_id}/import", headers=headers, files={"file": ("calendar.ics", exported.content, "text/calendar")})
    assert imported.status_code == 200 and imported.json()["imported"] == 1
    assert api.get("/api/planner/search?q=活動", headers=headers).json()["events"][0]["id"] == event["id"]
    link = api.post(f"/api/planner/calendars/{calendar_id}/feed", headers=headers).json()["path"]
    assert api.get(link).status_code == 200
    assert api.get(f"/api/planner/calendars/{calendar_id}/export.ics").status_code == 401
    assert api.delete(f"/api/planner/calendars/{calendar_id}/feed", headers=headers).status_code == 204
    assert api.get(link).status_code == 404


def test_reminders_are_deduplicated_and_removed_when_event_cancelled(api, mine, tx):
    now = dt.datetime.now(dt.UTC).replace(microsecond=0)
    event = create(api, mine, starts_at=(now + dt.timedelta(minutes=10)).isoformat(), ends_at=(now + dt.timedelta(minutes=70)).isoformat())
    planner_notifications.generate(tx, tx.get(AppUser, "U01"), now)
    planner_notifications.generate(tx, tx.get(AppUser, "U01"), now)
    tx.flush()
    assert len(tx.scalars(select(PlannerNotification).where(PlannerNotification.event_id == event["id"])).all()) == 1
    changed = api.put(f"/api/planner/events/{event['id']}", headers=mine[0], json=change_body(event, title="更新附註後的標題"))
    assert changed.status_code == 200
    tx.expire_all()
    planner_notifications.generate(tx, tx.get(AppUser, "U01"), now)
    notices = tx.scalars(select(PlannerNotification).where(PlannerNotification.event_id == event["id"])).all()
    assert len(notices) == 1 and notices[0].read_at is not None
    event = changed.json()
    assert api.delete(f"/api/planner/events/{event['id']}?expected_sequence={event['sequence']}", headers=mine[0]).status_code == 204
    assert tx.scalars(select(PlannerNotification).where(PlannerNotification.event_id == event["id"])).all() == []


def test_self_registered_account_does_not_share_demonstration_calendar(api, mine):
    registered = api.post("/api/auth/register", json={"email": "calendar-private@example.com", "name": "日曆測試", "password": "calendar-test-password"})
    assert registered.status_code == 201, registered.text
    account = registered.json()
    assert account["user"]["acting_as"]["id"] == "U01"
    workspace = api.get("/api/planner", headers={"Authorization": f"Bearer {account['token']}"}).json()
    assert workspace["calendars"][0]["id"] != mine[1]


def test_all_day_spanning_range_and_visibility(api, mine):
    event = create(api, mine, all_day=True, starts_at="2026-10-20T00:00:00+08:00", ends_at="2026-10-23T00:00:00+08:00")
    found = api.get("/api/planner/events", params={"start": "2026-10-22T00:00:00+08:00", "end": "2026-10-23T00:00:00+08:00"}, headers=mine[0])
    assert [e["id"] for e in found.json()["events"]] == [event["id"]]
    assert api.put(f"/api/planner/calendars/{mine[1]}/visibility", json={"visible": False}, headers=mine[0]).status_code == 204
    assert api.get("/api/planner", headers=mine[0]).json()["calendars"][0]["visible"] is False
