"""一般日曆：獨立行程、分類、共享／邀請、ICS、CalDAV 與提醒。"""

import datetime as dt
import base64
import hashlib
import html
import secrets
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy import delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.api.auth import CurrentAccount as CurrentUser
from app.db import get_session
from app.models import AppUser, PlannerAttendee, PlannerCalendar, PlannerEvent, PlannerMember, PlannerNotification, PlannerPushSubscription, UserIdentity
from app.schemas.planner import CalendarInput, ConnectionInput, DiscoverInput, EventChange, EventInput
from app.services import planner, planner_ics, planner_mail, planner_notifications, planner_sync
from app.timeutil import TAIPEI

router = APIRouter(prefix="/api/planner", tags=["calendar"])
SessionDep = Annotated[Session, Depends(get_session)]


def calendar_output(calendar: PlannerCalendar, member: PlannerMember):
    return {"id": calendar.id, "name": calendar.name, "color": calendar.color, "source": calendar.source,
            "role": member.role, "status": member.status, "visible": member.visible,
            "can_edit": member.role != "reader" and calendar.source != "ics" and member.status == "accepted",
            "synced_at": calendar.synced_at, "sync_error": calendar.sync_error, "feed_enabled": bool(calendar.feed_token_hash)}


@router.get("")
def workspace(session: SessionDep, user: CurrentUser):
    planner.default_calendar(session, user)
    session.commit()
    invitations = session.scalars(select(PlannerEvent).join(PlannerAttendee).where(
        PlannerAttendee.email.in_(planner.emails_for(session, user)), PlannerAttendee.status == "needs_action",
        PlannerEvent.deleted_at.is_(None),
    ).distinct()).all()
    return {"today": dt.datetime.now(TAIPEI).date(), "timezone": "Asia/Taipei",
            "calendars": [calendar_output(c, m) for c, m in planner.calendars_for(session, user, pending=True)],
            "invitations": [planner.event_output(session, e, user) for e in invitations],
            "push_public_key": planner_notifications.push_public_key(), "email_invites_enabled": planner_mail.configured()}


@router.get("/events")
def list_events(session: SessionDep, user: CurrentUser, start: dt.datetime, end: dt.datetime):
    if not start.tzinfo or not end.tzinfo or end <= start or end - start > dt.timedelta(days=370):
        raise HTTPException(422, "請指定含時區、最長一年的有效日期範圍")
    result = []
    for event in planner.accessible_events(session, user):
        expanded = planner.occurrences(event, start, end)
        if expanded:
            metadata = planner.event_output(session, event, user)
            result.extend({**metadata, **occurrence} for occurrence in expanded)
        if len(result) > 10000:
            raise HTTPException(422, "這段日期的行程太多，請縮小日期範圍")
    return {"events": sorted(result, key=lambda e: (e["starts_at"], e["title"], e["id"]))}


@router.get("/search")
def search(session: SessionDep, user: CurrentUser, q: str = Query(min_length=1, max_length=200)):
    query = q.strip().casefold()
    if not query:
        return {"events": []}
    matches = []
    for event in planner.accessible_events(session, user):
        emitted = set()
        if any(query in (getattr(event, key) or "").casefold() for key in ("title", "location", "description")):
            # 搜尋結果指向實際存在的一次，不能把已取消／改期的 DTSTART 當成原時間顯示。
            candidates = planner.occurrences(event, event.starts_at - dt.timedelta(days=1), event.starts_at + dt.timedelta(days=370))
            first = next((o for o in candidates if any(query in (o.get(key) or "").casefold() for key in ("title", "location", "description"))), None)
            if first:
                matches.append(planner.event_output(session, event, user, first))
                emitted.add(first["occurrence"])
        for original, override in (event.exceptions or {}).items():
            if original not in emitted and not override.get("cancelled") and any(query in (override.get(key) or "").casefold() for key in ("title", "location", "description")):
                matches.append(planner.event_output(session, event, user, {**planner.snapshot(event), **override, "occurrence": original}))
        if len(matches) > 100:
            break
    return {"events": matches[:100], "truncated": len(matches) > 100}


@router.get("/events/{event_id}")
def get_event(session: SessionDep, user: CurrentUser, event_id: str, date: dt.date | None = None):
    event = planner.event_access(session, event_id, user)
    if date:
        start = dt.datetime.combine(date, dt.time(), TAIPEI)
        expanded = planner.occurrences(event, start, start + dt.timedelta(days=1))
        if expanded:
            return planner.event_output(session, event, user, expanded[0])
    return planner.event_output(session, event, user)


@router.post("/events", status_code=201)
def create_event(session: SessionDep, user: CurrentUser, body: EventInput):
    planner.calendar_access(session, body.calendar_id, user, edit=True)
    event = planner.create_event(session, body)
    session.commit()
    return planner.event_output(session, event, user)


@router.put("/events/{event_id}")
def update_event(session: SessionDep, user: CurrentUser, event_id: str, body: EventChange):
    event = planner.event_access(session, event_id, user, edit=True)
    if body.calendar_id != event.calendar_id:
        source = session.get(PlannerCalendar, event.calendar_id)
        target = planner.calendar_access(session, body.calendar_id, user, edit=True)
        if source.source != "local" or target.source != "local":
            raise HTTPException(422, "外部日曆的行程請用複製，避免移動時破壞同步")
        if body.scope != "all":
            raise HTTPException(422, "移動日曆請選擇整個系列")
    event = planner.change_event(session, event, body)
    session.commit()
    return planner.event_output(session, event, user)


@router.delete("/events/{event_id}", status_code=204)
def delete_event(session: SessionDep, user: CurrentUser, event_id: str, expected_sequence: int,
                 scope: Literal["all", "one", "future"] = "all", occurrence: dt.datetime | None = None):
    event = planner.event_access(session, event_id, user, edit=True)
    if event.sequence != expected_sequence:
        raise HTTPException(409, "行程剛被其他人修改，請重新載入")
    planner.delete_event(session, event, scope, occurrence)
    session.commit()
    return Response(status_code=204)


class RSVP(BaseModel):
    status: Literal["accepted", "tentative", "declined"]


@router.put("/events/{event_id}/response")
def respond(session: SessionDep, user: CurrentUser, event_id: str, body: RSVP):
    event = planner.event_access(session, event_id, user)
    if session.get(PlannerCalendar, event.calendar_id).source == "ics":
        raise HTTPException(422, "這是唯讀訂閱，請在原始日曆回覆邀請")
    attendees = session.scalars(select(PlannerAttendee).where(PlannerAttendee.event_id == event_id, PlannerAttendee.email.in_(planner.emails_for(session, user)))).all()
    if not attendees:
        raise HTTPException(403, "你不是這個行程的受邀者")
    for attendee in attendees:
        attendee.status = body.status
    if body.status == "declined":
        session.execute(delete(PlannerNotification).where(PlannerNotification.event_id == event_id, PlannerNotification.user_id == user.id))
    event.dirty = True
    session.commit()
    return {"status": body.status}


@router.get("/events/{event_id}/invitation.ics")
def invitation_file(session: SessionDep, user: CurrentUser, event_id: str):
    event = planner.event_access(session, event_id, user)
    calendar = session.get(PlannerCalendar, event.calendar_id)
    organizer = session.get(AppUser, calendar.owner_id)
    return Response(planner_ics.export_ics(session, [event], event.title, organizer.email, "REQUEST"),
                    media_type="text/calendar", headers={"Content-Disposition": 'attachment; filename="invitation.ics"', "Cache-Control": "no-store"})


@router.post("/events/{event_id}/send-invitations")
def send_invitations(session: SessionDep, user: CurrentUser, event_id: str, expected_sequence: int):
    event = planner.event_access(session, event_id, user, edit=True)
    if event.sequence != expected_sequence:
        raise HTTPException(409, "行程剛被修改，請重新載入後再傳送邀請")
    return planner_mail.send(session, event)


def public_invitation(session: Session, token: str):
    attendee = session.scalar(select(PlannerAttendee).where(PlannerAttendee.response_token_hash == hashlib.sha256(token.encode()).hexdigest()))
    event = session.get(PlannerEvent, attendee.event_id) if attendee else None
    if not event or event.deleted_at or (not event.recurrence and event.ends_at < dt.datetime.now(dt.UTC) - dt.timedelta(days=30)):
        raise HTTPException(404, "邀請已失效或行程已取消")
    return attendee, event


def invitation_page(token: str, attendee: PlannerAttendee, event: PlannerEvent, *, saved=False):
    title = html.escape(event.title)
    start = html.escape(event.starts_at.astimezone(ZoneInfo(event.timezone)).strftime("%Y/%m/%d %H:%M"))
    status = {"needs_action": "尚未回覆", "accepted": "已接受", "tentative": "暫定", "declined": "已拒絕"}[attendee.status]
    body = f'''<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title} · 行程邀請</title><style>body{{font-family:system-ui,sans-serif;background:#f6f5f9;color:#1a1626;padding:24px}}main{{max-width:520px;margin:8vh auto;background:white;padding:28px;border:1px solid #e6e2ec;border-radius:20px}}p{{line-height:1.7;overflow-wrap:anywhere}}button{{font:inherit;border:0;border-radius:12px;padding:12px 20px;margin:4px;background:#f1eef6;cursor:pointer}}button:first-child{{background:#9b51e0;color:white}}.notes{{white-space:pre-wrap}}</style></head><body><main><p>行程邀請</p><h1>{title}</h1><p>{start}（{html.escape(event.timezone)}）{' · 全天' if event.all_day else ''}</p><p>{html.escape(event.location)}</p><p class="notes">{html.escape(event.description)}</p><p>{'回覆已儲存。' if saved else ''}目前狀態：{status}</p><form method="post" action="/api/planner/invitations/{html.escape(token, quote=True)}"><button name="status" value="accepted">接受</button><button name="status" value="tentative">暫定</button><button name="status" value="declined">拒絕</button></form></main></body></html>'''
    return HTMLResponse(body, headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"})


@router.get("/invitations/{token}", response_class=HTMLResponse)
def show_invitation(session: SessionDep, token: str):
    attendee, event = public_invitation(session, token)
    return invitation_page(token, attendee, event)


@router.post("/invitations/{token}", response_class=HTMLResponse)
def reply_invitation(session: SessionDep, token: str, status: Annotated[Literal["accepted", "tentative", "declined"], Form()]):
    attendee, event = public_invitation(session, token)
    attendee.status, event.dirty = status, True
    session.commit()
    return invitation_page(token, attendee, event, saved=True)


@router.post("/calendars", status_code=201)
def create_calendar(session: SessionDep, user: CurrentUser, body: CalendarInput):
    calendar = PlannerCalendar(id=str(uuid4()), owner_id=user.id, **body.model_dump(), source="local")
    session.add(calendar)
    session.flush()
    member = PlannerMember(calendar_id=calendar.id, user_id=user.id, role="owner", status="accepted", visible=True)
    session.add(member)
    session.commit()
    return calendar_output(calendar, member)


@router.patch("/calendars/{calendar_id}")
def edit_calendar(session: SessionDep, user: CurrentUser, calendar_id: str, body: CalendarInput):
    calendar = planner.calendar_access(session, calendar_id, user, owner=True)
    calendar.name, calendar.color = body.name, body.color
    session.commit()
    return calendar_output(calendar, session.get(PlannerMember, (calendar.id, user.id)))


class Visibility(BaseModel):
    visible: bool


@router.put("/calendars/{calendar_id}/visibility", status_code=204)
def set_visibility(session: SessionDep, user: CurrentUser, calendar_id: str, body: Visibility):
    planner.calendar_access(session, calendar_id, user)
    session.get(PlannerMember, (calendar_id, user.id)).visible = body.visible
    session.commit()
    return Response(status_code=204)


@router.delete("/calendars/{calendar_id}", status_code=204)
def delete_calendar(session: SessionDep, user: CurrentUser, calendar_id: str):
    calendar = planner.calendar_access(session, calendar_id, user, owner=True)
    count = session.scalar(select(func.count()).select_from(PlannerCalendar).where(PlannerCalendar.owner_id == user.id, PlannerCalendar.source == "local"))
    if calendar.source == "local" and count <= 1:
        raise HTTPException(422, "請至少保留一本自己的日曆")
    session.delete(calendar)
    session.commit()
    return Response(status_code=204)


@router.get("/people")
def people(session: SessionDep, user: CurrentUser, q: str = Query(min_length=2, max_length=100)):
    needle = q.strip().replace("%", "\\%").replace("_", "\\_")
    rows = session.scalars(select(AppUser).where(AppUser.deactivated_at.is_(None), AppUser.id != user.id,
        or_(AppUser.name.ilike(f"%{needle}%"), AppUser.email.ilike(f"%{needle}%"))).order_by(AppUser.name).limit(20)).all()
    return {"people": [{"id": p.id, "name": p.name, "email": p.email} for p in rows]}


@router.get("/calendars/{calendar_id}/members")
def list_members(session: SessionDep, user: CurrentUser, calendar_id: str):
    planner.calendar_access(session, calendar_id, user, owner=True)
    return {"members": [{"user_id": m.user_id, "name": u.name, "email": u.email, "role": m.role, "status": m.status}
            for m, u in session.execute(select(PlannerMember, AppUser).join(AppUser, AppUser.id == PlannerMember.user_id).where(PlannerMember.calendar_id == calendar_id))]}


class MemberInput(BaseModel):
    user_id: str
    role: Literal["editor", "reader"]


@router.post("/calendars/{calendar_id}/members", status_code=201)
def share_calendar(session: SessionDep, user: CurrentUser, calendar_id: str, body: MemberInput):
    calendar = planner.calendar_access(session, calendar_id, user, owner=True)
    target = session.get(AppUser, body.user_id)
    if not target or target.deactivated_at:
        raise HTTPException(404, "找不到這位使用者")
    if target.id == calendar.owner_id:
        raise HTTPException(422, "不需要邀請自己")
    member = session.get(PlannerMember, (calendar.id, target.id))
    if member:
        member.role = body.role
        if member.status == "declined":
            member.status = "pending"
    else:
        session.add(PlannerMember(calendar_id=calendar.id, user_id=target.id, role=body.role, status="pending", visible=True))
    session.commit()
    return {"message": "已送出站內共享邀請"}


@router.delete("/calendars/{calendar_id}/members/{user_id}", status_code=204)
def remove_member(session: SessionDep, user: CurrentUser, calendar_id: str, user_id: str):
    calendar = planner.calendar_access(session, calendar_id, user, owner=user_id != user.id)
    if user_id == calendar.owner_id:
        raise HTTPException(422, "無法移除日曆擁有者")
    session.execute(delete(PlannerMember).where(PlannerMember.calendar_id == calendar_id, PlannerMember.user_id == user_id))
    session.commit()
    return Response(status_code=204)


@router.put("/calendars/{calendar_id}/response")
def respond_calendar(session: SessionDep, user: CurrentUser, calendar_id: str, body: RSVP):
    member = session.get(PlannerMember, (calendar_id, user.id))
    if not member or member.role == "owner":
        raise HTTPException(404, "找不到這份共享邀請")
    if body.status == "tentative":
        raise HTTPException(422, "共享日曆請選擇接受或拒絕")
    member.status = body.status
    session.commit()
    return {"status": member.status}


@router.get("/calendars/{calendar_id}/export.ics")
def export_calendar(session: SessionDep, user: CurrentUser, calendar_id: str):
    calendar = planner.calendar_access(session, calendar_id, user)
    events = session.scalars(select(PlannerEvent).where(PlannerEvent.calendar_id == calendar.id, PlannerEvent.deleted_at.is_(None))).all()
    return Response(planner_ics.export_ics(session, events, calendar.name), media_type="text/calendar",
                    headers={"Content-Disposition": 'attachment; filename="calendar.ics"', "Cache-Control": "no-store"})


@router.post("/calendars/{calendar_id}/import")
async def import_calendar(session: SessionDep, user: CurrentUser, calendar_id: str, file: Annotated[UploadFile, File()]):
    calendar = planner.calendar_access(session, calendar_id, user, edit=True)
    raw = await file.read(planner_ics.MAX_ICS_BYTES + 1)
    events = planner_ics.import_ics(session, calendar, raw)
    session.commit()
    return {"imported": len(events)}


@router.post("/calendars/{calendar_id}/feed")
def enable_feed(session: SessionDep, user: CurrentUser, calendar_id: str):
    calendar = planner.calendar_access(session, calendar_id, user, owner=True)
    token = secrets.token_urlsafe(32)
    calendar.feed_token_hash = hashlib.sha256(token.encode()).hexdigest()
    session.commit()
    return {"path": f"/api/planner/feeds/{token}.ics"}


@router.delete("/calendars/{calendar_id}/feed", status_code=204)
def disable_feed(session: SessionDep, user: CurrentUser, calendar_id: str):
    planner.calendar_access(session, calendar_id, user, owner=True).feed_token_hash = None
    session.commit()
    return Response(status_code=204)


@router.get("/feeds/{token}.ics")
def planner_feed(session: SessionDep, token: str):
    calendar = session.scalar(select(PlannerCalendar).where(PlannerCalendar.feed_token_hash == hashlib.sha256(token.encode()).hexdigest()))
    if not calendar:
        raise HTTPException(404, "訂閱連結不存在或已撤銷")
    events = session.scalars(select(PlannerEvent).where(PlannerEvent.calendar_id == calendar.id, PlannerEvent.deleted_at.is_(None))).all()
    return Response(planner_ics.export_ics(session, events, calendar.name), media_type="text/calendar",
                    headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})


@router.post("/connections/discover")
def discover(session: SessionDep, user: CurrentUser, body: DiscoverInput):
    return {"calendars": planner_sync.discover(body.url, body.username, body.password)}


@router.post("/connections", status_code=201)
def connect(session: SessionDep, user: CurrentUser, body: ConnectionInput):
    url = planner_sync.remote_url(body.url)
    credentials = None
    if body.source == "caldav":
        if not body.username or not body.password:
            raise HTTPException(422, "請填寫 CalDAV 帳號與 App 專用密碼")
        credentials = planner_sync.encrypt_credentials(body.username, body.password)
    calendar = PlannerCalendar(id=str(uuid4()), owner_id=user.id, name=body.name, color=body.color,
                               source=body.source, remote_url=url, credentials=credentials)
    session.add(calendar)
    session.flush()
    member = PlannerMember(calendar_id=calendar.id, user_id=user.id, role="owner", status="accepted", visible=True)
    session.add(member)
    planner_sync.sync(session, calendar)
    session.commit()
    return calendar_output(calendar, member)


@router.post("/calendars/{calendar_id}/sync")
def sync_calendar(session: SessionDep, user: CurrentUser, calendar_id: str, resolution: Literal["local", "remote"] | None = None):
    planner.calendar_access(session, calendar_id, user, owner=True)
    calendar = session.scalar(select(PlannerCalendar).where(PlannerCalendar.id == calendar_id).with_for_update())
    if calendar.source == "local":
        raise HTTPException(422, "這本日曆沒有連接外部服務")
    try:
        planner_sync.sync(session, calendar, resolution)
        session.commit()
    except HTTPException as exc:
        session.rollback()
        calendar = session.get(PlannerCalendar, calendar_id)
        calendar.sync_error = exc.detail
        session.commit()
        raise
    return {"synced_at": calendar.synced_at}


@router.get("/notifications")
def notifications(session: SessionDep, user: CurrentUser):
    planner_notifications.generate(session, user)
    session.commit()
    rows = session.scalars(select(PlannerNotification).where(PlannerNotification.user_id == user.id, PlannerNotification.read_at.is_(None))
                           .where(PlannerNotification.due_at >= dt.datetime.now(dt.UTC) - dt.timedelta(days=7))
                           .order_by(PlannerNotification.due_at.desc()).limit(50)).all()
    return {"notifications": [{"id": n.id, "event_id": n.event_id, "title": n.title, "starts_at": n.occurrence, "due_at": n.due_at} for n in rows]}


@router.put("/notifications/{notification_id}/read", status_code=204)
def read_notification(session: SessionDep, user: CurrentUser, notification_id: str):
    notification = session.get(PlannerNotification, notification_id)
    if not notification or notification.user_id != user.id:
        raise HTTPException(404, "找不到這則提醒")
    notification.read_at = dt.datetime.now(dt.UTC)
    session.commit()
    return Response(status_code=204)


class PushInput(BaseModel):
    endpoint: str = Field(max_length=2000)
    keys: dict[str, str]


@router.post("/push", status_code=201)
def save_push(session: SessionDep, user: CurrentUser, body: PushInput):
    if not planner_notifications.push_public_key():
        raise HTTPException(503, "伺服器尚未啟用背景推播，站內提醒仍可使用")
    try:
        endpoint = urlsplit(body.endpoint)
        port = endpoint.port
    except ValueError:
        raise HTTPException(422, "推播端點格式不正確") from None
    host = endpoint.hostname or ""
    allowed = host == "fcm.googleapis.com" or any(host.endswith(suffix) for suffix in (".push.apple.com", ".push.services.mozilla.com", ".notify.windows.com"))
    if endpoint.scheme != "https" or port not in (None, 443) or endpoint.username or endpoint.fragment or not allowed:
        raise HTTPException(422, "不是支援的瀏覽器推播端點")
    if set(body.keys) != {"p256dh", "auth"} or any(not 10 <= len(value) <= 200 for value in body.keys.values()):
        raise HTTPException(422, "推播訂閱金鑰格式不正確")
    try:
        decoded = {key: base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True) for key, value in body.keys.items()}
        if len(decoded["p256dh"]) != 65 or len(decoded["auth"]) != 16:
            raise ValueError()
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), decoded["p256dh"])
    except ValueError:
        raise HTTPException(422, "推播訂閱金鑰格式不正確") from None
    identity = hashlib.sha256(body.endpoint.encode()).hexdigest()
    session.execute(insert(PlannerPushSubscription).values(id=identity, user_id=user.id, session_version=user.session_version, subscription=body.model_dump())
                    .on_conflict_do_update(index_elements=["id"], set_={"user_id": user.id, "session_version": user.session_version, "subscription": body.model_dump()}))
    session.commit()
    return {"subscribed": True}


@router.delete("/push", status_code=204)
def remove_push(session: SessionDep, user: CurrentUser, endpoint: str):
    session.execute(delete(PlannerPushSubscription).where(PlannerPushSubscription.id == hashlib.sha256(endpoint.encode()).hexdigest(), PlannerPushSubscription.user_id == user.id))
    session.commit()
    return Response(status_code=204)
