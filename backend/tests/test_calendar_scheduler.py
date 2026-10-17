"""常駐排程的時間、工作隔離與停止行為；不需資料庫或外部服務。"""

import datetime as dt
import signal
from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from apscheduler.schedulers.background import BackgroundScheduler

from app.jobs import calendar, calendar_scheduler


def test_schedule_starts_immediately_and_then_uses_minute_boundaries():
    before = dt.datetime.now(dt.UTC)
    scheduler = calendar_scheduler.create_scheduler()
    after = dt.datetime.now(dt.UTC)
    reminder = scheduler.get_job("calendar-reminders")
    sync = scheduler.get_job("calendar-sync")
    assert before <= reminder.next_run_time <= after
    assert reminder.next_run_time == sync.next_run_time
    now = dt.datetime(2026, 10, 17, 12, 1, 30, tzinfo=dt.UTC)
    assert reminder.trigger.get_next_fire_time(None, now) == now.replace(minute=2, second=0)
    assert sync.trigger.get_next_fire_time(None, now) == now.replace(minute=5, second=0)


def test_slow_sync_does_not_block_reminders_or_overlap_and_failed_job_retries(monkeypatch):
    sync_started, release_sync, reminders_repeated = Event(), Event(), Event()
    calls = {"reminders": 0, "sync": 0}

    def reminders():
        calls["reminders"] += 1
        if calls["reminders"] == 1:
            raise RuntimeError("暫時無法連線，下一輪應繼續")
        if calls["reminders"] >= 5:
            reminders_repeated.set()

    def sync():
        calls["sync"] += 1
        sync_started.set()
        assert release_sync.wait(5)

    monkeypatch.setattr(calendar_scheduler, "BlockingScheduler", BackgroundScheduler)
    monkeypatch.setattr(calendar_scheduler, "reminders", reminders)
    monkeypatch.setattr(calendar_scheduler, "sync_calendars", sync)
    scheduler = calendar_scheduler.create_scheduler()
    for job in scheduler.get_jobs():
        scheduler.reschedule_job(job.id, trigger="interval", seconds=0.03)
    scheduler.start()
    try:
        assert sync_started.wait(3)
        assert reminders_repeated.wait(3)
        assert calls["sync"] == 1
        for job in scheduler.get_jobs():
            assert job.coalesce and job.max_instances == 1
    finally:
        scheduler.pause()
        release_sync.set()
        scheduler.shutdown(wait=True)


@pytest.mark.parametrize("sig", [signal.SIGINT, signal.SIGTERM])
def test_stop_waits_for_running_work_and_restores_signal_handlers(monkeypatch, sig):
    previous = {value: signal.getsignal(value) for value in (signal.SIGINT, signal.SIGTERM)}
    scheduler = Mock(running=True)
    scheduler.start.side_effect = lambda: signal.getsignal(sig)(sig, None)
    monkeypatch.setattr(calendar_scheduler, "create_scheduler", lambda: scheduler)
    with pytest.raises(SystemExit) as exc:
        calendar_scheduler.main()
    assert exc.value.code == 0
    scheduler.shutdown.assert_called_once_with(wait=True)
    assert all(signal.getsignal(value) == handler for value, handler in previous.items())


@pytest.mark.parametrize("minute", [10, 11])
@pytest.mark.parametrize("reminder_fails", [False, True])
def test_cron_entrypoint_keeps_five_minute_sync_even_if_reminders_fail(monkeypatch, minute, reminder_fails):
    now = dt.datetime(2026, 10, 17, 12, minute, tzinfo=dt.UTC)
    clock = SimpleNamespace(datetime=SimpleNamespace(now=lambda _tz: now), UTC=dt.UTC)
    reminder, sync = Mock(), Mock()
    if reminder_fails:
        reminder.side_effect = RuntimeError("提醒暫時失敗")
    monkeypatch.setattr(calendar, "dt", clock)
    monkeypatch.setattr(calendar, "reminders", reminder)
    monkeypatch.setattr(calendar, "sync_calendars", sync)
    if reminder_fails:
        with pytest.raises(RuntimeError):
            calendar.tick()
    else:
        calendar.tick()
    reminder.assert_called_once_with(now)
    assert sync.call_count == (1 if minute % 5 == 0 else 0)
