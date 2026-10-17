"""排程共用工作的 Postgres 鎖與外部同步錯誤隔離。"""

import datetime as dt
from unittest.mock import Mock

from fastapi import HTTPException
from sqlalchemy import delete, select, text
from sqlalchemy.orm import sessionmaker

from app.jobs import calendar
from app.models import PlannerCalendar


def test_reminder_lock_skips_duplicate_worker_and_releases_after_completion(engine, monkeypatch):
    factory = sessionmaker(engine)
    monkeypatch.setattr(calendar, "session_factory", lambda: factory)
    generate, push = Mock(), Mock()
    monkeypatch.setattr(calendar.planner_notifications, "generate", generate)
    monkeypatch.setattr(calendar.planner_notifications, "send_pending_push", push)
    lock = text("SELECT pg_try_advisory_xact_lock(hashtext('meddemo-calendar-jobs'))")
    with factory() as guard:
        assert guard.scalar(lock)
        calendar.reminders()
        generate.assert_not_called()
        push.assert_not_called()

    def check_lock_held(_session):
        with factory() as other:
            assert not other.scalar(lock)

    push.side_effect = check_lock_held
    calendar.reminders()
    assert generate.call_count > 0
    push.assert_called_once()
    with factory() as guard:
        assert guard.scalar(lock)


def test_sync_lock_and_failures_do_not_stop_other_calendars(engine, monkeypatch):
    factory = sessionmaker(engine)
    monkeypatch.setattr(calendar, "session_factory", lambda: factory)
    ids = {"scheduler-http-error", "scheduler-unexpected-error", "scheduler-success"}
    with factory() as session:
        for identity in ids:
            session.add(PlannerCalendar(id=identity, owner_id="U01", name=identity,
                color="#10B981", source="ics", remote_url="https://calendar.example.test/feed.ics"))
        session.commit()
    calls = []

    def sync(_session, item):
        calls.append(item.id)
        if item.id == "scheduler-http-error":
            raise HTTPException(502, "外部服務暫時無法使用")
        if item.id == "scheduler-unexpected-error":
            raise RuntimeError("外部回傳資料無效")
        item.synced_at = dt.datetime.now(dt.UTC)

    monkeypatch.setattr(calendar.planner_sync, "sync", sync)
    lock = text("SELECT pg_try_advisory_xact_lock(hashtext('meddemo-calendar-sync'))")
    try:
        with factory() as guard:
            assert guard.scalar(lock)
            calendar.sync_calendars()
            assert calls == []
        # 已在編輯的日曆跳過，其他日曆仍會同步。
        with factory() as editing:
            editing.scalar(select(PlannerCalendar).where(PlannerCalendar.id == "scheduler-success").with_for_update())
            calendar.sync_calendars()
            assert "scheduler-success" not in calls
        calendar.sync_calendars()
        assert set(calls) >= ids
        with factory() as session:
            assert session.get(PlannerCalendar, "scheduler-http-error").sync_error == "外部服務暫時無法使用"
            assert session.get(PlannerCalendar, "scheduler-success").synced_at is not None
            assert session.scalar(lock)
    finally:
        with factory() as session:
            session.execute(delete(PlannerCalendar).where(PlannerCalendar.id.in_(ids)))
            session.commit()
