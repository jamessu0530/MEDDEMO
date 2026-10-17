"""每分鐘檢查提醒、每五分鐘同步外部日曆。"""

import datetime as dt
import logging

from fastapi import HTTPException
from sqlalchemy import delete, select, text

from app.db import session_factory
from app.models import AppUser, PlannerCalendar, PlannerNotification
from app.services import planner_notifications, planner_sync

logger = logging.getLogger(__name__)


def reminders(now: dt.datetime | None = None) -> None:
    """建立到期提醒並推播；同時啟動的工作由資料庫鎖避免重複處理。"""
    now = now or dt.datetime.now(dt.UTC)
    factory = session_factory()
    with factory() as session:
        if not session.scalar(text("SELECT pg_try_advisory_xact_lock(hashtext('meddemo-calendar-jobs'))")):
            return
        for user in session.scalars(select(AppUser).where(AppUser.deactivated_at.is_(None))):
            planner_notifications.generate(session, user, now)
        planner_notifications.send_pending_push(session)
        session.execute(delete(PlannerNotification).where(PlannerNotification.due_at < now - dt.timedelta(days=7)))
        session.commit()


def sync_calendars() -> None:
    """每本日曆分開提交；一個供應商失敗不會阻止其他日曆。"""
    factory = session_factory()
    with factory() as lock_session:
        if not lock_session.scalar(text("SELECT pg_try_advisory_xact_lock(hashtext('meddemo-calendar-sync'))")):
            return
        ids = lock_session.scalars(select(PlannerCalendar.id).where(PlannerCalendar.source != "local")).all()
        for identity in ids:
            with factory() as session:
                calendar = session.scalar(select(PlannerCalendar).where(PlannerCalendar.id == identity).with_for_update(skip_locked=True))
                if not calendar:
                    continue
                try:
                    planner_sync.sync(session, calendar)
                    session.commit()
                except HTTPException as exc:
                    session.rollback()
                    calendar = session.get(PlannerCalendar, identity)
                    if calendar:
                        calendar.sync_error = str(exc.detail)[:500]
                        session.commit()
                except Exception:
                    session.rollback()
                    logger.exception("日曆背景同步失敗：%s", identity)


def tick() -> None:
    """正式環境 CronJob 的單次入口；本機常駐排程分別呼叫上述兩項工作。"""
    now = dt.datetime.now(dt.UTC)
    try:
        reminders(now)
    finally:
        if now.minute % 5 == 0:
            sync_calendars()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    tick()
