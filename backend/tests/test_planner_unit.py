"""無外部服務的日期／重複規則測試；可用 --noconftest 單獨執行。"""

import datetime as dt
from zoneinfo import ZoneInfo

import pytest
from pydantic import ValidationError

from app.models import PlannerEvent
from app.schemas.planner import EventChange, EventInput
from app.services import planner


def moment(value):
    return dt.datetime.fromisoformat(value)


def event(**changes):
    values = dict(id="event", calendar_id="mine", uid="event@meddemo", title="週會", starts_at=moment("2026-10-05T09:00:00+08:00"),
        ends_at=moment("2026-10-05T10:00:00+08:00"), timezone="Asia/Taipei", all_day=False, location="", description="", url="",
        recurrence="FREQ=WEEKLY;COUNT=5", reminders=[15], exceptions={}, recurrence_dates=[], sequence=0, dirty=True)
    return PlannerEvent(**{**values, **changes})


def dates(item, start="2026-10-01T00:00:00+08:00", end="2026-12-01T00:00:00+08:00"):
    return planner.occurrences(item, moment(start), moment(end))


def test_daily_recurrence_retains_local_hour_across_dst():
    zone = ZoneInfo("America/New_York")
    item = event(starts_at=dt.datetime(2026, 10, 31, 9, tzinfo=zone), ends_at=dt.datetime(2026, 10, 31, 10, tzinfo=zone),
                 timezone="America/New_York", recurrence="FREQ=DAILY;COUNT=3")
    rows = dates(item)
    assert [moment(row["starts_at"]).astimezone(zone).hour for row in rows] == [9, 9, 9]
    assert [moment(row["starts_at"]).hour for row in rows] == [13, 14, 14]


def test_midnight_end_is_exclusive_and_spanning_events_are_visible():
    item = event(starts_at=moment("2026-10-05T23:00:00+08:00"), ends_at=moment("2026-10-06T00:00:00+08:00"), recurrence=None)
    assert len(dates(item, "2026-10-05T00:00:00+08:00", "2026-10-06T00:00:00+08:00")) == 1
    assert dates(item, "2026-10-06T00:00:00+08:00", "2026-10-07T00:00:00+08:00") == []


def test_moved_exception_can_enter_range_from_outside_it_and_cancellation_stays_hidden():
    item = event()
    original = planner.stamp(moment("2026-10-05T09:00:00+08:00"))
    cancelled = planner.stamp(moment("2026-10-12T09:00:00+08:00"))
    item.exceptions = {original: {**planner.snapshot(item), "recurrence": None, "starts_at": "2026-11-20T01:00:00+00:00", "ends_at": "2026-11-20T02:00:00+00:00"}, cancelled: {"cancelled": True}}
    rows = dates(item, "2026-11-20T00:00:00+08:00", "2026-11-21T00:00:00+08:00")
    assert len(rows) == 1 and rows[0]["occurrence"] == original
    assert rows[0]["recurrence"] == item.recurrence
    assert all(row["occurrence"] != cancelled for row in dates(item))


class MemorySession:
    def __init__(self):
        self.added = []

    def execute(self, *args):
        pass

    def add(self, item):
        self.added.append(item)

    def flush(self):
        pass

    def scalars(self, *args):
        return []


def test_edit_future_splits_count_instead_of_adding_extra_occurrences():
    item = event()
    body = EventChange(**{**planner.snapshot(item), "calendar_id": "mine", "attendees": [], "expected_sequence": 0,
        "scope": "future", "occurrence": "2026-10-19T09:00:00+08:00", "starts_at": "2026-10-19T11:00:00+08:00", "ends_at": "2026-10-19T12:00:00+08:00"})
    created = planner.change_event(MemorySession(), item, body)
    old, new = dates(item), dates(created)
    assert len(old) == 2 and len(new) == 3
    assert [moment(row["starts_at"]).astimezone(ZoneInfo("Asia/Taipei")).hour for row in new] == [11, 11, 11]


def test_move_whole_series_keeps_cancelled_occurrence_shifted():
    item = event(exceptions={"2026-10-12T01:00:00+00:00": {"cancelled": True}})
    body = EventChange(**{**planner.snapshot(item), "calendar_id": "mine", "attendees": [], "expected_sequence": 0,
        "starts_at": "2026-10-06T09:00:00+08:00", "ends_at": "2026-10-06T10:00:00+08:00"})
    planner.change_event(MemorySession(), item, body)
    assert "2026-10-13T01:00:00+00:00" in item.exceptions
    assert len(dates(item)) == 4


@pytest.mark.parametrize("rule", ["FREQ=SECONDLY", "FREQ=DAILY;BYSECOND=1", "FREQ=WEEKLY;INTERVAL=0", "FREQ=DAILY;COUNT=10001", "FREQ=DAILY;COUNT=3;UNTIL=20261201T000000Z", "FREQ=DAILY\nEXDATE:20261001"])
def test_unsafe_or_invalid_recurrence_is_rejected(rule):
    with pytest.raises(ValidationError):
        EventInput(**{**planner.snapshot(event()), "calendar_id": "mine", "recurrence": rule})


def test_all_day_requires_midnight_and_positive_duration():
    with pytest.raises(ValidationError):
        EventInput(**{**planner.snapshot(event()), "calendar_id": "mine", "all_day": True})
