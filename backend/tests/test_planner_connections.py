"""外部協定使用可控制的假服務；不連接任何真實帳號或寄送郵件。"""

import base64
import datetime as dt
import hashlib
import re
from xml.sax.saxutils import escape

import httpx
import pytest
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import AppUser, PlannerCalendar, PlannerEvent, PlannerNotification, PlannerPushSubscription
from app.services import planner_notifications, planner_sync
from app.services.planner_ics import read_ics

ICS = b'''BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//Calendar//EN\r\nBEGIN:VEVENT\r\nUID:external-1@example.test\r\nDTSTAMP:20261001T000000Z\r\nDTSTART;TZID=Asia/Taipei:20261020T090000\r\nDTEND;TZID=Asia/Taipei:20261020T100000\r\nSUMMARY:External event\r\nORGANIZER:mailto:organizer@example.test\r\nX-KEEP-ME:vendor-metadata\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'''
URL = "https://caldav.icloud.com/calendars/test/"


@pytest.fixture
def api():
    return TestClient(app)


@pytest.fixture
def local_calendar(tx, api, auth):
    return api.get("/api/planner", headers=auth()).json()["calendars"][0]["id"]


def test_caldav_encrypted_credentials_conditional_write_and_conflict_resolution(tx, api, auth, env, monkeypatch):
    env(CALENDAR_ENCRYPTION_KEY=Fernet.generate_key().decode())
    monkeypatch.setattr(planner_sync, "remote_url", lambda value: value)
    remote = {"raw": ICS, "etag": '"v1"'}
    calls = []

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        if method == "REPORT":
            item = f'<d:response><d:href>/calendars/test/external.ics</d:href><d:propstat><d:prop><d:getetag>{escape(remote["etag"])}</d:getetag><c:calendar-data>{escape(remote["raw"].decode())}</c:calendar-data></d:prop></d:propstat></d:response>' if remote["raw"] else ""
            body = f'<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">{item}</d:multistatus>'
            return httpx.Response(207, content=body.encode(), request=httpx.Request(method, url))
        if method == "PUT":
            assert kwargs["headers"]["If-Match"] == remote["etag"]
            remote["raw"], remote["etag"] = kwargs["content"], '"v2"'
            return httpx.Response(204, headers={"etag": remote["etag"]}, request=httpx.Request(method, url))
        raise AssertionError(method)

    monkeypatch.setattr(planner_sync, "request", request)
    response = api.post("/api/planner/connections", json={"name": "iCloud", "color": "#10B981", "source": "caldav", "url": URL, "username": "qa@example.test", "password": "app-password-secret"}, headers=auth())
    assert response.status_code == 201, response.text
    calendar_id = response.json()["id"]
    stored = tx.get(PlannerCalendar, calendar_id)
    assert "app-password-secret" not in stored.credentials
    assert planner_sync.decrypt_credentials(stored.credentials)["username"] == "qa@example.test"
    event = tx.scalar(select(PlannerEvent).where(PlannerEvent.calendar_id == calendar_id))
    event.title, event.dirty = "Local edit", True
    tx.flush()
    assert api.post(f"/api/planner/calendars/{calendar_id}/sync", headers=auth()).status_code == 200
    assert b"SUMMARY:Local edit" in remote["raw"]
    assert b"ORGANIZER:mailto:organizer@example.test" in remote["raw"] and b"X-KEEP-ME:vendor-metadata" in remote["raw"]
    tx.expire_all(); event = tx.get(PlannerEvent, event.id)
    assert event.remote_etag == '"v2"' and event.dirty is False
    event.title, event.dirty = "Pending local edit", True; tx.flush()
    remote["raw"], remote["etag"] = ICS.replace(b"External event", b"Remote edit"), '"v3"'
    puts_before = sum(method == "PUT" for method, _, _ in calls)
    assert api.post(f"/api/planner/calendars/{calendar_id}/sync", headers=auth()).status_code == 409
    assert sum(method == "PUT" for method, _, _ in calls) == puts_before
    assert api.post(f"/api/planner/calendars/{calendar_id}/sync?resolution=remote", headers=auth()).status_code == 200
    tx.expire_all(); assert tx.get(PlannerEvent, event.id).title == "Remote edit"


def test_ics_subscription_is_read_only_and_refreshes_removed_events(tx, api, auth, monkeypatch):
    monkeypatch.setattr(planner_sync, "remote_url", lambda value: value)
    raw = [ICS]
    monkeypatch.setattr(planner_sync, "request", lambda method, url, **kwargs: httpx.Response(200, content=raw[0], request=httpx.Request(method, url)))
    result = api.post("/api/planner/connections", json={"name": "節日", "color": "#10B981", "source": "ics", "url": "https://calendar.google.com/test.ics"}, headers=auth())
    assert result.status_code == 201, result.text
    calendar_id = result.json()["id"]
    assert result.json()["can_edit"] is False
    event = tx.scalar(select(PlannerEvent).where(PlannerEvent.calendar_id == calendar_id))
    raw[0] = b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nEND:VCALENDAR\r\n"
    assert api.post(f"/api/planner/calendars/{calendar_id}/sync", headers=auth()).status_code == 200
    tx.expire_all(); assert tx.get(PlannerEvent, event.id).deleted_at is not None


@pytest.mark.parametrize("url", ["http://caldav.icloud.com/", "https://user:pass@caldav.icloud.com/", "https://127.0.0.1/", "https://evil.example.test/", "https://caldav.icloud.com:invalid/"])
def test_remote_urls_reject_credentials_insecure_or_unapproved_destinations(url):
    with pytest.raises(HTTPException) as error:
        planner_sync.remote_url(url)
    assert error.value.status_code == 422


def test_remote_dns_cannot_resolve_to_private_network(monkeypatch):
    monkeypatch.setattr(planner_sync.socket, "getaddrinfo", lambda *args, **kwargs: [(2, 1, 6, "", ("169.254.169.254", 443))])
    with pytest.raises(HTTPException):
        planner_sync.remote_url("https://caldav.icloud.com/")


def test_rdate_exdate_and_recurrence_override_survive_ics():
    raw = ICS.replace(b"SUMMARY:External event", b"RRULE:FREQ=WEEKLY;COUNT=3\r\nRDATE;TZID=Asia/Taipei:20261101T090000\r\nEXDATE;TZID=Asia/Taipei:20261027T090000\r\nSUMMARY:External event")
    result = read_ics(raw, "calendar")[0]
    assert len(result["recurrence_dates"]) == 1 and len(result["exceptions"]) == 1


def test_explicit_mail_invitation_and_anonymous_rsvp(tx, api, auth, env, monkeypatch, local_calendar):
    env(CALENDAR_SMTP_HOST="smtp.example.test", CALENDAR_SMTP_FROM="calendar@example.test", CALENDAR_PUBLIC_BASE_URL="https://calendar.example.test")
    # 舊版每日計數器即使已滿，也不能再阻擋邀請；五分鐘內重複寄送的保護仍保留。
    from app.tasks import redis
    today = dt.datetime.now(dt.UTC).date()
    owner_id = tx.get(PlannerCalendar, local_calendar).owner_id
    old_keys = [f"calendar-mail:{owner_id}:{today}", f"calendar-mail:all:{today}"]
    for key in old_keys:
        redis().set(key, 10000, ex=60)
    messages = []

    class SMTP:
        def __init__(self, *args, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def send_message(self, message): messages.append(message)

    from app.services import planner_mail
    monkeypatch.setattr(planner_mail.smtplib, "SMTP_SSL", SMTP)
    event = api.post("/api/planner/events", json={"calendar_id": local_calendar, "title": "<script>邀請測試</script>", "starts_at": "2030-10-20T09:00:00+08:00", "ends_at": "2030-10-20T10:00:00+08:00", "attendees": ["outside@example.test"]}, headers=auth()).json()
    result = api.post(f"/api/planner/events/{event['id']}/send-invitations?expected_sequence={event['sequence']}", headers=auth())
    assert result.status_code == 200 and result.json()["sent"] == ["outside@example.test"]
    assert all(int(redis().get(key)) == 10000 for key in old_keys)
    assert len(messages) == 1
    message = messages[0]
    assert message["To"] == "outside@example.test" and any(part.get_content_type() == "text/calendar" for part in message.walk())
    token = re.search(r"/api/planner/invitations/([A-Za-z0-9_-]+)", message.get_body(preferencelist=("plain",)).get_content()).group(1)
    page = api.get(f"/api/planner/invitations/{token}")
    assert page.status_code == 200 and "&lt;script&gt;" in page.text and "<script>" not in page.text
    assert api.post(f"/api/planner/invitations/{token}", data={"status": "accepted"}).status_code == 200
    assert api.get(f"/api/planner/events/{event['id']}", headers=auth()).json()["attendees"][0]["status"] == "accepted"
    assert api.post(f"/api/planner/events/{event['id']}/send-invitations?expected_sequence={event['sequence']}", headers=auth()).status_code == 429


def test_background_push_skips_expired_login_and_uses_persistent_dedup(tx, auth, env, monkeypatch):
    key = ec.generate_private_key(ec.SECP256R1()).private_numbers().private_value.to_bytes(32, "big")
    env(CALENDAR_VAPID_PRIVATE_KEY=base64.urlsafe_b64encode(key).decode().rstrip("="), CALENDAR_VAPID_SUBJECT="https://calendar.example.test")
    assert len(base64.urlsafe_b64decode(planner_notifications.push_public_key() + "=")) == 65
    user = tx.get(AppUser, "U01")
    calendar = PlannerCalendar(id="push-calendar", owner_id=user.id, name="push", color="#9B51E0", source="local"); tx.add(calendar); tx.flush()
    event = PlannerEvent(id="push-event", calendar_id=calendar.id, uid="push", title="通知", starts_at=dt.datetime.now(dt.UTC), ends_at=dt.datetime.now(dt.UTC) + dt.timedelta(hours=1), timezone="Asia/Taipei", all_day=False, location="", description="", url="", reminders=[0], exceptions={}, recurrence_dates=[], sequence=0, dirty=True)
    tx.add(event); tx.flush()
    tx.add(PlannerNotification(id="notice", user_id=user.id, event_id=event.id, occurrence=event.starts_at, title=event.title, due_at=event.starts_at))
    tx.add(PlannerPushSubscription(id="subscription", user_id=user.id, session_version=user.session_version - 1, subscription={"endpoint": "https://fcm.googleapis.com/test"})); tx.flush()
    sent = []
    import pywebpush
    monkeypatch.setattr(pywebpush, "webpush", lambda **kwargs: sent.append(kwargs))
    planner_notifications.send_pending_push(tx)
    tx.flush()
    assert sent == [] and tx.get(PlannerPushSubscription, "subscription") is None
    tx.add(PlannerPushSubscription(id="valid-subscription", user_id=user.id, session_version=user.session_version,
        subscription={"endpoint": "https://fcm.googleapis.com/test"}))
    tx.add(PlannerNotification(id="notice-new", user_id=user.id, event_id=event.id,
        occurrence=dt.datetime(2030, 10, 1, 18, tzinfo=dt.UTC), title=event.title, due_at=dt.datetime.now(dt.UTC)))
    tx.flush()
    planner_notifications.send_pending_push(tx); tx.flush()
    planner_notifications.send_pending_push(tx)
    assert len(sent) == 1 and "date=2030-10-02" in sent[0]["data"]
