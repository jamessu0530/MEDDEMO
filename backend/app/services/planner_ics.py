"""RFC 5545 匯入／匯出：保留 UID、時區、全天、RDATE、EXDATE、重複例外與邀請。"""

from __future__ import annotations

import datetime as dt
from copy import deepcopy
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from icalendar import Event
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PlannerAttendee, PlannerCalendar, PlannerEvent
from app.schemas.planner import EventInput
from app.services import planner

MAX_ICS_BYTES = 2 * 1024 * 1024
STATUS_TO_ICS = {"needs_action": "NEEDS-ACTION", "accepted": "ACCEPTED", "tentative": "TENTATIVE", "declined": "DECLINED"}


def moment(value, zone: ZoneInfo) -> dt.datetime:
    if isinstance(value, dt.datetime):
        return value if value.tzinfo else value.replace(tzinfo=zone)
    return dt.datetime.combine(value, dt.time(), zone)


def parse_component(component, calendar_id: str, default_zone="Asia/Taipei") -> EventInput:
    if "DTSTART" not in component:
        raise ValueError("行程缺少 DTSTART")
    start = component.decoded("dtstart")
    tzid = component["dtstart"].params.get("TZID") or getattr(getattr(start, "tzinfo", None), "key", None) or default_zone
    zone = ZoneInfo(str(tzid))
    all_day = not isinstance(start, dt.datetime)
    end = component.decoded("dtend", None)
    if end is None:
        end = moment(start, zone) + component.decoded("duration", dt.timedelta(days=1) if all_day else dt.timedelta(hours=1))
    rule = component["rrule"].to_ical().decode() if "RRULE" in component else None
    if rule and all_day:
        parts = rule.split(";")
        rule = ";".join(f"UNTIL={moment(dt.date.fromisoformat(p[6:]), zone).astimezone(dt.UTC):%Y%m%dT%H%M%SZ}" if p.startswith("UNTIL=") and len(p) == 14 else p for p in parts)
    alarms = []
    for alarm in component.subcomponents:
        if alarm.name == "VALARM":
            trigger = alarm.decoded("trigger", None)
            if isinstance(trigger, dt.timedelta) and alarm.get("trigger").params.get("RELATED", "START") == "START":
                minutes = int(-trigger.total_seconds() / 60)
                if 0 <= minutes <= 20160:
                    alarms.append(minutes)
    addresses = component.get("attendee", [])
    if not isinstance(addresses, list):
        addresses = [addresses]
    return EventInput(calendar_id=calendar_id, title=str(component.get("summary", "未命名行程")),
                      starts_at=moment(start, zone), ends_at=moment(end, zone), timezone=str(tzid), all_day=all_day,
                      location=str(component.get("location", "")), description=str(component.get("description", "")),
                      url=str(component.get("url", "")), recurrence=rule, reminders=sorted(set(alarms))[:5],
                      attendees=[str(a).removeprefix("mailto:").removeprefix("MAILTO:") for a in addresses])


def date_list(component, key, zone):
    values = component.get(key, [])
    if not isinstance(values, list):
        values = [values]
    return [planner.stamp(moment(value.dt, zone)) for group in values for value in group.dts]


def read_ics(raw: bytes, calendar_id: str) -> list[dict]:
    Calendar = ics_library().Calendar
    if len(raw) > MAX_ICS_BYTES:
        raise HTTPException(413, "行事曆檔案上限為 2 MB")
    try:
        root = Calendar.from_ical(raw)
        components = root.walk("VEVENT")
        if root.name != "VCALENDAR" or len(components) > 2000:
            raise ValueError("檔案格式不正確，或行程超過 2000 筆")
        grouped = {}
        for component in components:
            if component.errors:
                raise ValueError("檔案含有無法辨識的行程欄位")
            uid = str(component.get("uid") or f"{uuid4()}@import")
            if len(uid) > 255:
                raise ValueError("行程 UID 過長")
            grouped.setdefault(uid, []).append(component)
        parsed = []
        for uid, group in grouped.items():
            masters = [c for c in group if "RECURRENCE-ID" not in c]
            if len(masters) != 1:
                raise ValueError("每個重複行程須有且僅有一筆主行程")
            master = masters[0]
            body = parse_component(master, calendar_id)
            zone = ZoneInfo(body.timezone)
            exceptions = {key: {"cancelled": True} for key in date_list(master, "exdate", zone)}
            for component in group:
                if "RECURRENCE-ID" not in component:
                    continue
                if component["recurrence-id"].params.get("RANGE"):
                    raise ValueError("請先將 THISANDFUTURE 行程拆成獨立系列再匯入")
                original = planner.stamp(moment(component.decoded("recurrence-id"), zone))
                if str(component.get("status", "")) == "CANCELLED":
                    exceptions[original] = {"cancelled": True}
                else:
                    exception = parse_component(component, calendar_id, body.timezone)
                    exceptions[original] = exception.model_dump(include=set(planner.EVENT_FIELDS), mode="json")
                    exceptions[original]["starts_at"] = planner.stamp(exception.starts_at)
                    exceptions[original]["ends_at"] = planner.stamp(exception.ends_at)
            source = Calendar()
            source.add("version", "2.0")
            for component in group:
                source.add_component(component)
            parsed.append({"uid": uid, "body": body, "exceptions": exceptions, "ical_data": source.to_ical().decode(),
                           "recurrence_dates": date_list(master, "rdate", zone),
                           "cancelled": str(master.get("status", "")) == "CANCELLED", "component": master})
        return parsed
    except (ValueError, TypeError, KeyError, OverflowError) as exc:
        raise HTTPException(422, f"無法讀取行事曆：{str(exc)[:200]}") from None


def import_ics(session: Session, calendar: PlannerCalendar, raw: bytes, *, remote_href=None, remote_etag=None, remote=False) -> list[PlannerEvent]:
    parsed = read_ics(raw, calendar.id)
    result = []
    for item in parsed:
        body = item["body"]
        event = session.scalar(select(PlannerEvent).where(PlannerEvent.calendar_id == calendar.id, PlannerEvent.uid == item["uid"]))
        if event is None:
            event = planner.create_event(session, body)
            event.uid = item["uid"]
        elif remote and event.dirty:
            # 這種情況由同步服務先比對 etag，不能在匯入時蓋過尚未送出的修改。
            continue
        else:
            for key in planner.EVENT_FIELDS:
                setattr(event, key, getattr(body, key))
            planner.set_attendees(session, event, body.attendees)
        event.exceptions, event.recurrence_dates = item["exceptions"], item["recurrence_dates"]
        event.ical_data = item["ical_data"]
        event.deleted_at = dt.datetime.now(dt.UTC) if item["cancelled"] else None
        event.updated_at = dt.datetime.now(dt.UTC)
        event.sequence += 1
        event.dirty = not remote
        if remote:
            event.remote_href, event.remote_etag = remote_href, remote_etag
        # 保留外部邀請的回覆；不能匯入後全部變成未回覆。
        addresses = item["component"].get("attendee", [])
        if not isinstance(addresses, list):
            addresses = [addresses]
        session.flush()
        for address in addresses:
            email = str(address).removeprefix("mailto:").removeprefix("MAILTO:").lower()
            attendee = session.get(PlannerAttendee, (event.id, email))
            status = str(address.params.get("PARTSTAT", "NEEDS-ACTION")).upper()
            if attendee and status in STATUS_TO_ICS.values():
                attendee.status = next(key for key, value in STATUS_TO_ICS.items() if value == status)
        result.append(event)
    session.flush()
    return result


def component_for(data: dict, uid: str, sequence: int, organizer: str | None, attendees: list) -> Event:
    library = ics_library()
    Event, Alarm, vCalAddress = library.Event, library.Alarm, library.vCalAddress
    component = Event()
    component.add("uid", uid)
    component.add("dtstamp", dt.datetime.now(dt.UTC))
    component.add("sequence", sequence)
    component.add("summary", data["title"])
    zone = ZoneInfo(data["timezone"])
    start, end = (dt.datetime.fromisoformat(data[key]).astimezone(zone) for key in ("starts_at", "ends_at"))
    component.add("dtstart", start.date() if data["all_day"] else start)
    component.add("dtend", end.date() if data["all_day"] else end)
    for field in ("location", "description", "url"):
        if data[field]:
            component.add(field, data[field])
    if organizer:
        component.add("organizer", vCalAddress(f"mailto:{organizer}"))
    for attendee in attendees:
        component.add("attendee", vCalAddress(f"mailto:{attendee.email}"), parameters={"PARTSTAT": STATUS_TO_ICS[attendee.status], "RSVP": "TRUE"})
    for minutes in data["reminders"]:
        alarm = Alarm()
        alarm.add("action", "DISPLAY")
        alarm.add("description", data["title"])
        alarm.add("trigger", -dt.timedelta(minutes=minutes))
        component.add_component(alarm)
    return component


def export_ics(session: Session, events: list[PlannerEvent], name: str, organizer: str | None = None, method="PUBLISH") -> bytes:
    library = ics_library()
    Calendar, vRecur = library.Calendar, library.vRecur
    calendar = Calendar()
    calendar.add("prodid", "-//MEDDEMO//Calendar//ZH-TW")
    calendar.add("version", "2.0")
    calendar.add("calscale", "GREGORIAN")
    calendar.add("method", method)
    calendar.add("x-wr-calname", name)
    for event in events:
        if event.deleted_at:
            continue
        data = planner.snapshot(event)
        attendees = session.scalars(select(PlannerAttendee).where(PlannerAttendee.event_id == event.id)).all()
        master = component_for(data, event.uid, event.sequence, organizer, attendees)
        if event.ical_data:
            original = next((c for c in Calendar.from_ical(event.ical_data).walk("VEVENT") if str(c.get("uid")) == event.uid and "RECURRENCE-ID" not in c), None)
            if original is not None:
                edited_fields = {"UID", "DTSTAMP", "SEQUENCE", "SUMMARY", "DTSTART", "DTEND", "DURATION", "LOCATION", "DESCRIPTION", "URL", "RRULE", "RDATE", "EXDATE", "ATTENDEE"}
                for key, value in original.items():
                    if key not in edited_fields:
                        master[key] = deepcopy(value)
                original_attendees = original.get("attendee", [])
                if not isinstance(original_attendees, list):
                    original_attendees = [original_attendees]
                current_attendees = master.get("attendee", [])
                if not isinstance(current_attendees, list):
                    current_attendees = [current_attendees]
                for address in current_attendees:
                    old = next((a for a in original_attendees if str(a).casefold() == str(address).casefold()), None)
                    if old is not None:
                        for key, value in old.params.items():
                            if key not in {"PARTSTAT", "RSVP"}:
                                address.params[key] = deepcopy(value)
        if event.recurrence:
            master.add("rrule", vRecur.from_ical(event.recurrence))
        zone = ZoneInfo(event.timezone)
        for extra in event.recurrence_dates or []:
            when = dt.datetime.fromisoformat(extra).astimezone(zone)
            master.add("rdate", when.date() if event.all_day else when)
        for original, override in (event.exceptions or {}).items():
            when = dt.datetime.fromisoformat(original).astimezone(zone)
            when_value = when.date() if event.all_day else when
            if override.get("cancelled"):
                master.add("exdate", when_value)
            else:
                component = component_for({**data, **override}, event.uid, event.sequence, organizer, attendees)
                component.add("recurrence-id", when_value)
                calendar.add_component(component)
        calendar.add_component(master)
    # 包含 VTIMEZONE，讓 Apple 與其他客戶端正確解讀跨時區和夏令時間。
    calendar.add_missing_timezones()
    return calendar.to_ical()


def ics_library():
    try:
        import icalendar
        return icalendar
    except ImportError:
        raise HTTPException(503, "日曆交換服務尚未完成安裝，請稍後再試") from None
