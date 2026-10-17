"""新增獨立的日曆示範資料，保留既有行程與使用者修改。

    uv run --project backend python data/seed/seed_calendar.py --all-users
    uv run --project backend python data/seed/seed_calendar.py --user U01

日期預設使用真實台北今天，可用 --today YYYY-MM-DD 指定。重複執行不重複新增。
"""

import argparse
import datetime as dt
import sys
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.dialects.postgresql import insert  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db import make_engine  # noqa: E402
from app.models import AppUser, PlannerCalendar, PlannerEvent, PlannerMember  # noqa: E402
from app.schemas.planner import EventInput  # noqa: E402
from app.services.planner import EVENT_FIELDS, default_calendar  # noqa: E402
from app.timeutil import TAIPEI  # noqa: E402


CALENDARS = (
    ("work", "工作行程（示範）", "#2563EB"),
    ("team", "團隊活動（示範）", "#8B5CF6"),
    ("life", "個人生活（示範）", "#059669"),
)


def identity(user_id: str, key: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"meddemo:calendar-demo:{user_id}:{key}"))


def demo_events(today: dt.date) -> list[tuple[str, EventInput]]:
    def at(offset: int, hour: int = 0, minute: int = 0) -> dt.datetime:
        return dt.datetime.combine(today + dt.timedelta(days=offset), dt.time(hour, minute), TAIPEI)

    # key 不含日期，日後重跑也不會覆寫、複製或復原使用者改過／刪除的行程。
    examples = (
        ("visit-before", "work", "藥局新品介紹", at(-3, 10), at(-3, 11), "台北市中山區", "準備新品型錄與陳列建議。", False, None),
        ("weekly", "team", "每週業務交流", at(-2, 9), at(-2, 10), "線上會議", "分享本週客戶回饋與下週重點。", False, "FREQ=WEEKLY;COUNT=4"),
        ("focus", "team", "新品推廣週", at(0), at(1), "", "整理本週推廣重點與展示物料。", True, None),
        ("visit-today", "work", "客戶拜訪・補貨討論", at(0, 9, 30), at(0, 10, 30), "台北市大安區", "帶產品型錄，確認陳列與補貨需求。", False, None),
        ("follow-up", "team", "報價進度討論", at(0, 10), at(0, 11), "辦公室會議室", "與客戶拜訪部分重疊，可切到週／日檢視查看並排效果。", False, None),
        ("walk", "life", "傍晚散步", at(0, 18, 30), at(0, 19, 30), "河濱公園", "下班後留一點時間活動。", False, None),
        ("training", "team", "產品教育訓練", at(1, 14), at(1, 16), "教育訓練室", "新品介紹與常見問題演練。", False, None),
        ("trip", "work", "中區客戶交流", at(2), at(4), "台中市", "兩天的跨日行程，可測試全天與跨日顯示。", True, None),
        ("lunch", "life", "朋友午餐", at(4, 12), at(4, 13, 30), "台北市信義區", "預留午餐與聊天時間。", False, None),
        ("review", "work", "下週拜訪規劃", at(6, 15), at(6, 16), "辦公室", "整理拜訪名單、準備型錄與樣品。", False, None),
    )
    return [
        (key, EventInput(
            calendar_id=calendar, title=title, starts_at=start, ends_at=end,
            location=location, description=f"示範假資料，可自由編輯或刪除。\n{description}",
            all_day=all_day, recurrence=recurrence, reminders=[], attendees=[],
        ))
        for key, calendar, title, start, end, location, description, all_day, recurrence in examples
    ]


def seed_calendar(session: Session, user: AppUser, today: dt.date) -> int:
    default_calendar(session, user)
    for key, name, color in CALENDARS:
        calendar_id = identity(user.id, key)
        session.execute(insert(PlannerCalendar).values(
            id=calendar_id, owner_id=user.id, name=name, color=color, source="local",
        ).on_conflict_do_nothing())
        session.execute(insert(PlannerMember).values(
            calendar_id=calendar_id, user_id=user.id, role="owner", status="accepted", visible=True,
        ).on_conflict_do_nothing())
    inserted = 0
    for key, body in demo_events(today):
        event_id = identity(user.id, key)
        result = session.execute(insert(PlannerEvent).values(
            **body.model_dump(include=set(EVENT_FIELDS)),
            id=event_id, calendar_id=identity(user.id, body.calendar_id),
            uid=f"{event_id}@meddemo-demo", exceptions={}, recurrence_dates=[], sequence=0, dirty=True,
        ).on_conflict_do_nothing().returning(PlannerEvent.id))
        inserted += result.scalar_one_or_none() is not None
    return inserted


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--user", help="只新增指定帳號的示範資料")
    target.add_argument("--all-users", action="store_true", help="為目前每個帳號建立各自的示範日曆")
    parser.add_argument("--today", type=dt.date.fromisoformat, default=dt.datetime.now(TAIPEI).date())
    args = parser.parse_args()
    engine = make_engine()
    try:
        with Session(engine) as session, session.begin():
            query = select(AppUser).order_by(AppUser.id)
            if args.user:
                query = query.where(AppUser.id == args.user)
            users = session.scalars(query).all()
            if not users:
                parser.error("找不到指定的帳號")
            count = sum(seed_calendar(session, user, args.today) for user in users)
        print(f"已為 {len(users)} 個帳號新增 {count} 筆示範行程（基準日期 {args.today}）。")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
