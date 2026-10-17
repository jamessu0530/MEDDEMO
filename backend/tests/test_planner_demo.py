"""示範日曆使用正常行程權限，重跑不覆寫既有資料。"""

import datetime as dt

from sqlalchemy import select

from app.models import AppUser, PlannerCalendar, PlannerEvent
from app.services import planner
from app.timeutil import TAIPEI
from seed_calendar import demo_events, seed_calendar


TODAY = dt.date(2026, 10, 17)


def test_demo_can_be_viewed_and_edited_only_by_its_owner(tx):
    owner, other = tx.get(AppUser, "U01"), tx.get(AppUser, "U02")
    assert seed_calendar(tx, owner, TODAY) == 10
    events = planner.accessible_events(tx, owner)
    assert len(events) == 10
    assert planner.accessible_events(tx, other) == []
    for event in events:
        calendar = planner.calendar_access(tx, event.calendar_id, owner, edit=True)
        assert calendar.owner_id == owner.id and calendar.source == "local"
        assert event.reminders == []
    assert seed_calendar(tx, other, TODAY) == 10
    assert not {e.id for e in events} & {e.id for e in planner.accessible_events(tx, other)}


def test_rerun_preserves_edits_deletions_visibility_and_existing_events(tx):
    owner = tx.get(AppUser, "U01")
    planner.default_calendar(tx, owner)
    calendar = tx.scalar(select(PlannerCalendar).where(PlannerCalendar.owner_id == owner.id))
    original = planner.create_event(tx, demo_events(TODAY)[0][1].model_copy(update={"calendar_id": calendar.id, "title": "我的原有行程"}))
    assert seed_calendar(tx, owner, TODAY) == 10
    examples = [e for e in planner.accessible_events(tx, owner) if e.id != original.id]
    edited, deleted = examples[:2]
    edited.title = "我修改的行程"
    deleted.deleted_at = dt.datetime.now(TAIPEI)
    members = planner.calendars_for(tx, owner)
    for c, member in members:
        if "（示範）" in c.name:
            member.visible = False
    tx.flush()
    assert seed_calendar(tx, owner, TODAY + dt.timedelta(days=30)) == 0
    tx.expire_all()
    assert tx.get(PlannerEvent, original.id).title == "我的原有行程"
    assert tx.get(PlannerEvent, edited.id).title == "我修改的行程"
    assert tx.get(PlannerEvent, deleted.id).deleted_at is not None
    assert all(not member.visible for c, member in planner.calendars_for(tx, owner) if "（示範）" in c.name)
    assert len(tx.scalars(select(PlannerEvent)).all()) == 11


def test_demo_dates_cover_today_overlap_recurrence_and_exclusive_all_day_end():
    examples = dict(demo_events(TODAY))
    assert all(not e.attendees and not e.reminders for e in examples.values())
    assert examples["visit-today"].starts_at.astimezone(TAIPEI).date() == TODAY
    assert examples["follow-up"].starts_at < examples["visit-today"].ends_at
    trip = examples["trip"]
    assert trip.all_day and trip.ends_at - trip.starts_at == dt.timedelta(days=2)
    assert trip.starts_at.timetz().replace(tzinfo=None) == dt.time()
    weekly = planner.PlannerEvent(**examples["weekly"].model_dump(include=set(planner.EVENT_FIELDS)))
    start = dt.datetime.combine(TODAY - dt.timedelta(days=7), dt.time(), TAIPEI)
    occurrences = planner.occurrences(weekly, start, start + dt.timedelta(days=40))
    assert len(occurrences) == 4
