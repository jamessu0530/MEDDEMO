"""行事曆的權限、重複展開與編輯。日期一律採半開區間 [start, end)。"""

import datetime as dt
from itertools import islice
from uuid import uuid4
from zoneinfo import ZoneInfo

from dateutil.rrule import rrulestr
from fastapi import HTTPException
from sqlalchemy import delete, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import AppUser, PlannerAttendee, PlannerCalendar, PlannerEvent, PlannerMember, PlannerNotification, UserIdentity
from app.schemas.planner import EventInput

EVENT_FIELDS = ("title", "starts_at", "ends_at", "timezone", "all_day", "location", "description", "url", "recurrence", "reminders")


def stamp(value: dt.datetime) -> str:
    return value.astimezone(dt.UTC).isoformat()


def emails_for(session: Session, user: AppUser) -> set[str]:
    emails = set(session.scalars(select(UserIdentity.email).where(UserIdentity.user_id == user.id)))
    emails.add(user.email)
    return {e.lower() for e in emails if e}


def default_calendar(session: Session, user: AppUser) -> None:
    # 固定 ID + ON CONFLICT：兩個分頁首次打開時只建一本，不借用示範業務的日曆。
    from uuid import NAMESPACE_URL, uuid5

    if session.scalar(select(PlannerCalendar.id).where(PlannerCalendar.owner_id == user.id).limit(1)):
        return
    identity = str(uuid5(NAMESPACE_URL, f"meddemo:calendar:{user.id}"))
    session.execute(insert(PlannerCalendar).values(id=identity, owner_id=user.id, name="我的日曆", color="#9B51E0", source="local").on_conflict_do_nothing())
    session.execute(insert(PlannerMember).values(calendar_id=identity, user_id=user.id, role="owner", status="accepted", visible=True).on_conflict_do_nothing())


def calendars_for(session: Session, user: AppUser, *, pending=False):
    query = select(PlannerCalendar, PlannerMember).join(PlannerMember, PlannerMember.calendar_id == PlannerCalendar.id).where(PlannerMember.user_id == user.id)
    if not pending:
        query = query.where(PlannerMember.status == "accepted")
    return session.execute(query.order_by(PlannerCalendar.created_at, PlannerCalendar.id)).all()


def calendar_access(session: Session, calendar_id: str, user: AppUser, *, edit=False, owner=False) -> PlannerCalendar:
    calendar = session.get(PlannerCalendar, calendar_id)
    member = session.get(PlannerMember, (calendar_id, user.id))
    if not calendar or not member or member.status != "accepted":
        raise HTTPException(404, "找不到這本日曆")
    if owner and member.role != "owner":
        raise HTTPException(403, "只有日曆擁有者可以操作")
    if edit and (member.role == "reader" or calendar.source == "ics"):
        raise HTTPException(403, "這本日曆只能檢視")
    return calendar


def accessible_events(session: Session, user: AppUser):
    calendars = select(PlannerMember.calendar_id).where(PlannerMember.user_id == user.id, PlannerMember.status == "accepted")
    invitations = select(PlannerAttendee.event_id).where(PlannerAttendee.email.in_(emails_for(session, user)))
    return session.scalars(select(PlannerEvent).where(
        or_(PlannerEvent.calendar_id.in_(calendars), PlannerEvent.id.in_(invitations)), PlannerEvent.deleted_at.is_(None),
    ).order_by(PlannerEvent.starts_at, PlannerEvent.id)).all()


def event_access(session: Session, event_id: str, user: AppUser, *, edit=False) -> PlannerEvent:
    event = session.scalar(select(PlannerEvent).where(PlannerEvent.id == event_id).with_for_update()) if edit else session.get(PlannerEvent, event_id)
    if not event or event.deleted_at is not None:
        raise HTTPException(404, "找不到這個行程")
    if edit:
        calendar_access(session, event.calendar_id, user, edit=True)
    else:
        member = session.get(PlannerMember, (event.calendar_id, user.id))
        invited = session.scalar(select(PlannerAttendee).where(PlannerAttendee.event_id == event.id, PlannerAttendee.email.in_(emails_for(session, user))))
        if not (member and member.status == "accepted") and not invited:
            raise HTTPException(404, "找不到這個行程")
    return event


def snapshot(event: PlannerEvent) -> dict:
    return {key: stamp(getattr(event, key)) if key in {"starts_at", "ends_at"} else getattr(event, key) for key in EVENT_FIELDS}


def occurrences(event: PlannerEvent, start: dt.datetime, end: dt.datetime) -> list[dict]:
    zone = ZoneInfo(event.timezone)
    base_start, base_end = event.starts_at.astimezone(zone), event.ends_at.astimezone(zone)
    duration = base_end - base_start
    exceptions = event.exceptions or {}
    if event.recurrence:
        rule = rrulestr(event.recurrence, dtstart=base_start)
        candidates = islice(rule.xafter(start.astimezone(zone) - duration, inc=True), 6001)
    else:
        candidates = [base_start]
    result = []
    count = 0
    for occurrence in candidates:
        if occurrence >= end:
            break
        count += 1
        if count > 6000:
            raise HTTPException(422, "這段日期的重複行程太多，請縮小日期範圍")
        original = stamp(occurrence)
        if original in exceptions:
            continue
        finish = occurrence + duration
        if occurrence < end and finish > start:
            result.append({**snapshot(event), "starts_at": stamp(occurrence), "ends_at": stamp(finish), "occurrence": original})
    for extra in event.recurrence_dates or []:
        occurrence = dt.datetime.fromisoformat(extra).astimezone(zone)
        original = stamp(occurrence)
        if original not in exceptions and not any(r["occurrence"] == original for r in result) and occurrence < end and occurrence + duration > start:
            result.append({**snapshot(event), "starts_at": original, "ends_at": stamp(occurrence + duration), "occurrence": original})
    # 單次改期後可以移出原本的查詢區間；覆寫要獨立檢查，不能只改展開後的清單。
    for original, override in exceptions.items():
        if override.get("cancelled"):
            continue
        begin, finish = dt.datetime.fromisoformat(override["starts_at"]), dt.datetime.fromisoformat(override["ends_at"])
        if begin < end and finish > start:
            result.append({**snapshot(event), **override, "recurrence": event.recurrence, "occurrence": original})
    return sorted(result, key=lambda value: value["starts_at"])


def validate_occurrence(event: PlannerEvent, occurrence: dt.datetime | None) -> dt.datetime:
    if occurrence is None or occurrence.tzinfo is None:
        raise HTTPException(422, "請指定要修改的這一次行程")
    if stamp(occurrence) in (event.exceptions or {}) or stamp(occurrence) in (event.recurrence_dates or []):
        return occurrence
    zone = ZoneInfo(event.timezone)
    if event.recurrence:
        candidate = rrulestr(event.recurrence, dtstart=event.starts_at.astimezone(zone)).before(occurrence.astimezone(zone), inc=True)
        valid = candidate is not None and stamp(candidate) == stamp(occurrence)
    else:
        valid = stamp(event.starts_at) == stamp(occurrence)
    if not valid:
        raise HTTPException(422, "這個日期不是此行程的發生時間")
    return occurrence


def set_attendees(session: Session, event: PlannerEvent, emails: list[str], *, reset=False):
    existing = {a.email: a for a in session.scalars(select(PlannerAttendee).where(PlannerAttendee.event_id == event.id))}
    for email, attendee in existing.items():
        if email not in emails:
            session.delete(attendee)
        elif reset:
            attendee.status = "needs_action"
    for email in set(emails) - existing.keys():
        session.add(PlannerAttendee(event_id=event.id, email=email, status="needs_action"))


def create_event(session: Session, body: EventInput) -> PlannerEvent:
    identity = str(uuid4())
    event = PlannerEvent(id=identity, uid=f"{identity}@meddemo", calendar_id=body.calendar_id,
                         **body.model_dump(include=set(EVENT_FIELDS)), exceptions={}, recurrence_dates=[], dirty=True, sequence=0)
    session.add(event)
    session.flush()
    set_attendees(session, event, body.attendees)
    return event


def touch(event: PlannerEvent):
    event.sequence += 1
    event.updated_at = dt.datetime.now(dt.UTC)
    event.dirty = True


def truncate(event: PlannerEvent, occurrence: dt.datetime):
    if not event.recurrence or occurrence <= event.starts_at:
        event.deleted_at = dt.datetime.now(dt.UTC)
    else:
        parts = [p for p in event.recurrence.split(";") if not p.startswith(("UNTIL=", "COUNT="))]
        parts.append(f"UNTIL={(occurrence.astimezone(dt.UTC) - dt.timedelta(seconds=1)):%Y%m%dT%H%M%SZ}")
        event.recurrence = ";".join(parts)
    event.exceptions = {key: value for key, value in (event.exceptions or {}).items() if dt.datetime.fromisoformat(key) < occurrence}
    event.recurrence_dates = [key for key in (event.recurrence_dates or []) if dt.datetime.fromisoformat(key) < occurrence]
    touch(event)


def event_output(session: Session, event: PlannerEvent, user: AppUser, occurrence: dict | None = None) -> dict:
    calendar = session.get(PlannerCalendar, event.calendar_id)
    member = session.get(PlannerMember, (calendar.id, user.id))
    member_access = bool(member and member.status == "accepted")
    emails = emails_for(session, user)
    attendees = [{"email": a.email, "status": a.status, "is_me": a.email in emails} for a in session.scalars(select(PlannerAttendee).where(PlannerAttendee.event_id == event.id).order_by(PlannerAttendee.email))]
    return {
        **(occurrence or snapshot(event)), "id": event.id, "uid": event.uid,
        "calendar_id": calendar.id if member_access else "invitations", "calendar_name": calendar.name,
        "color": calendar.color, "source": calendar.source,
        "can_edit": bool(member_access and member.role != "reader" and calendar.source != "ics"),
        "sequence": event.sequence, "attendees": attendees, "recurrence": event.recurrence,
        "series": snapshot(event),
        "occurrence": occurrence["occurrence"] if occurrence else stamp(event.starts_at),
    }


def delete_event(session: Session, event: PlannerEvent, scope: str, occurrence: dt.datetime | None):
    session.execute(delete(PlannerNotification).where(PlannerNotification.event_id == event.id))
    if scope == "one" and event.recurrence:
        when = validate_occurrence(event, occurrence)
        event.exceptions = {**(event.exceptions or {}), stamp(when): {"cancelled": True}}
        touch(event)
    elif scope == "future":
        truncate(event, validate_occurrence(event, occurrence))
    else:
        event.deleted_at = dt.datetime.now(dt.UTC)
        touch(event)


def change_event(session: Session, event: PlannerEvent, body) -> PlannerEvent:
    if event.sequence != body.expected_sequence:
        raise HTTPException(409, "行程剛被其他人修改，請重新載入再編輯")
    # 保留去重鍵：改標題／附註後不能把已提醒過的同一時間重新建立成未讀。
    notification_filter = [PlannerNotification.event_id == event.id]
    if body.scope == "one" and body.occurrence:
        override = (event.exceptions or {}).get(stamp(body.occurrence), {})
        actual_start = dt.datetime.fromisoformat(override["starts_at"]) if override.get("starts_at") else body.occurrence
        notification_filter.append(PlannerNotification.occurrence == actual_start)
    session.execute(update(PlannerNotification).where(*notification_filter).values(read_at=dt.datetime.now(dt.UTC)))
    if body.scope == "one" and event.recurrence:
        when = validate_occurrence(event, body.occurrence)
        payload = body.model_dump(include=set(EVENT_FIELDS), mode="json")
        payload["starts_at"], payload["ends_at"] = stamp(body.starts_at), stamp(body.ends_at)
        event.exceptions = {**(event.exceptions or {}), stamp(when): payload}
        touch(event)
        return event
    if body.scope == "future" and event.recurrence:
        when = validate_occurrence(event, body.occurrence)
        if when > event.starts_at:
            payload = body.model_dump(include=set(EventInput.model_fields))
            if payload["recurrence"] == event.recurrence and "COUNT=" in event.recurrence:
                parts = dict(p.split("=", 1) for p in event.recurrence.split(";"))
                rule = rrulestr(event.recurrence, dtstart=event.starts_at.astimezone(ZoneInfo(event.timezone)))
                before = sum(1 for occurrence in rule if occurrence < when)
                parts["COUNT"] = str(max(1, int(parts["COUNT"]) - before))
                payload["recurrence"] = ";".join(f"{key}={value}" for key, value in parts.items())
            delta = body.starts_at - when
            future_exceptions = shift_exceptions({key: value for key, value in (event.exceptions or {}).items() if dt.datetime.fromisoformat(key) >= when}, delta, delta)
            future_dates = [stamp(dt.datetime.fromisoformat(key) + delta) for key in (event.recurrence_dates or []) if dt.datetime.fromisoformat(key) >= when]
            truncate(event, when)
            created = create_event(session, EventInput.model_validate(payload))
            created.exceptions, created.recurrence_dates = future_exceptions, future_dates
            return created
    reset = any(getattr(event, key) != getattr(body, key) for key in ("starts_at", "ends_at", "recurrence"))
    if event.recurrence != body.recurrence:
        event.exceptions, event.recurrence_dates = {}, []
    elif reset:
        delta = body.starts_at - event.starts_at
        end_delta = body.ends_at - event.ends_at
        event.exceptions = shift_exceptions(event.exceptions or {}, delta, end_delta)
        event.recurrence_dates = [stamp(dt.datetime.fromisoformat(key) + delta) for key in (event.recurrence_dates or [])]
    for key in EVENT_FIELDS:
        setattr(event, key, getattr(body, key))
    event.calendar_id = body.calendar_id
    set_attendees(session, event, body.attendees, reset=reset)
    touch(event)
    return event


def shift_exceptions(exceptions: dict, delta: dt.timedelta, end_delta: dt.timedelta) -> dict:
    result = {}
    for original, value in exceptions.items():
        shifted = dict(value)
        if not shifted.get("cancelled"):
            shifted["starts_at"] = stamp(dt.datetime.fromisoformat(value["starts_at"]) + delta)
            shifted["ends_at"] = stamp(dt.datetime.fromisoformat(value["ends_at"]) + end_delta)
        result[stamp(dt.datetime.fromisoformat(original) + delta)] = shifted
    return result
