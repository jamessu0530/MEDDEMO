"""本機的獨立日曆排程：python -m app.jobs.calendar_scheduler。"""

import datetime as dt
import logging
import signal

from apscheduler.schedulers.blocking import BlockingScheduler

from app.jobs.calendar import reminders, sync_calendars

logger = logging.getLogger(__name__)


def create_scheduler() -> BlockingScheduler:
    # 行程與通知保存在既有資料表；固定的兩項工作每次啟動重新註冊即可。
    scheduler = BlockingScheduler(
        timezone=dt.UTC,
        job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 60},
    )
    now = dt.datetime.now(dt.UTC)
    scheduler.add_job(
        reminders, "cron", minute="*", second=0,
        id="calendar-reminders", name="日曆到期提醒", next_run_time=now,
    )
    scheduler.add_job(
        sync_calendars, "cron", minute="*/5", second=0,
        id="calendar-sync", name="外部日曆同步", next_run_time=now,
    )
    return scheduler


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    scheduler = create_scheduler()

    def stop(signum, _frame):
        logger.info("收到停止訊號 %s，等待執行中的日曆工作完成", signum)
        raise SystemExit(0)

    previous_handlers = {sig: signal.signal(sig, stop) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        logger.info("日曆排程啟動：每分鐘檢查提醒，每五分鐘同步；啟動時立即檢查")
        scheduler.start()
    finally:
        if scheduler.running:
            scheduler.shutdown(wait=True)
        for sig, handler in previous_handlers.items():
            signal.signal(sig, handler)


if __name__ == "__main__":
    main()
