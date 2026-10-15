"""個人頁（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈個人頁〉〈API〉）：
三格事蹟數字、獎牌、賣最多的藥局與每月業績。

獎牌只算首頁點過的站（stop_arrival），以前的拜訪不算：示範業務一年拜訪過名下全部 53 家，算進來的話一打開就全部解鎖，
評審看不到解鎖的那一刻。解鎖日期用那份行程的日期（系統日），跟畫面上的「今天」一致，不用真實時間。
"""

import datetime as dt
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AppUser, Customer, Itinerary, SalesTransaction, StopArrival, Visit
from app.services.customer_profile import app_today
from app.services.achievement_catalog import medal_details
from app.timeutil import TAIPEI

# 每一類三級（銅、銀、金）的門檻：跑過幾家藥局、跑過幾個縣市
MEDAL_TIERS = {"stores": (1, 3, 5), "cities": (1, 2, 3)}
# 三格數字與前五名看近一年；每月業績看含這個月的近六個月
YEAR_DAYS = 365
MONTHS = 6
TOP_CUSTOMERS = 5


@dataclass
class Medal:
    kind: str  # stores：跑過的藥局；cities：跑過的縣市
    tier: int  # 1 銅、2 銀、3 金
    need: int
    have: int
    unlocked_on: dt.date | None
    # 解鎖的那一刻（第 N 家第一次點到的真實時間）：系統日固定，IT 重置前後 unlocked_on 一樣，
    # 前端靠這個判斷「這面看過了沒」，重置之後再解鎖會再演一次
    unlocked_at: dt.datetime | None
    title: str = ""
    condition: str = ""
    unit: str = ""
    action_path: str | None = None

    def __post_init__(self):
        for name, value in medal_details(self.kind, self.tier, self.need).items():
            setattr(self, name, value)


@dataclass
class Stats:
    visits_last_year: int
    customers: int
    sales_last_year: float


@dataclass
class TopCustomer:
    customer_id: str
    name: str
    amount: float


@dataclass
class MonthSales:
    month: str  # 2026-05
    amount: float
    through: dt.date | None  # 這個月：算到哪天（系統日，月底那天也照寫）；其他月是 None


@dataclass
class Me:
    name: str
    region: str
    stats: Stats
    medals: list[Medal]
    top_customers: list[TopCustomer]
    monthly: list[MonthSales]


def medals(session: Session, rep_id: str) -> list[Medal]:
    """這位業務所有行程裡點過的站：不同的客戶幾家、不同的縣市幾個。第 N 家（第 N 個縣市）第一次點到的那份行程的日期就是解鎖日。"""
    rows = session.execute(
        select(StopArrival.customer_id, Customer.city, StopArrival.first_at, Itinerary.date)
        .join(Customer, Customer.id == StopArrival.customer_id)
        .join(Itinerary, Itinerary.id == StopArrival.itinerary_id)
        .where(Itinerary.user_id == rep_id)
        .order_by(StopArrival.first_at, StopArrival.customer_id)
    ).all()
    # 每多一家（一個縣市）記一筆：（那份行程的日期，第一次點到的時間）
    store_firsts: list[tuple[dt.date, dt.datetime]] = []
    city_firsts: list[tuple[dt.date, dt.datetime]] = []
    stores: set[str] = set()
    cities: set[str] = set()
    for customer_id, city, first_at, day in rows:
        if customer_id not in stores:
            stores.add(customer_id)
            store_firsts.append((day, first_at))
        if city and city not in cities:
            cities.add(city)
            city_firsts.append((day, first_at))
    return [
        Medal(kind, tier, need, len(firsts), *(firsts[need - 1] if len(firsts) >= need else (None, None)))
        for kind, firsts in (("stores", store_firsts), ("cities", city_firsts))
        for tier, need in enumerate(MEDAL_TIERS[kind], start=1)
    ]


def newly_unlocked(before: list[Medal], after: list[Medal]) -> list[Medal]:
    """點這一站之前還沒解鎖、點了之後解鎖的（首頁跳「解鎖銀牌：跑過 3 家藥局」用）。"""
    was = {(m.kind, m.tier) for m in before if m.unlocked_on}
    return [m for m in after if m.unlocked_on and (m.kind, m.tier) not in was]


def _months(today: dt.date, count: int) -> list[dt.date]:
    """含這個月往前 count 個月的第一天，由舊到新。"""
    starts, year, month = [], today.year, today.month
    for _ in range(count):
        starts.append(dt.date(year, month, 1))
        year, month = (year, month - 1) if month > 1 else (year - 1, 12)
    return starts[::-1]


def build(session: Session, rep: AppUser, learning_user_id: str | None = None) -> Me:
    today = app_today(session)
    year_from = today - dt.timedelta(days=YEAR_DAYS)
    owned = Customer.owner_user_id == rep.id

    def sales(*where):
        return (
            select(func.coalesce(func.sum(SalesTransaction.amount), 0))
            .join(Customer, Customer.id == SalesTransaction.customer_id)
            .where(owned, *where)
        )

    in_year = (SalesTransaction.date > year_from, SalesTransaction.date <= today)
    # 拜訪照台北時間的日期算，跟首頁、日曆同一套（timeutil.local_date）
    since = dt.datetime.combine(year_from + dt.timedelta(days=1), dt.time(), TAIPEI)
    until = dt.datetime.combine(today + dt.timedelta(days=1), dt.time(), TAIPEI)
    stats = Stats(
        visits_last_year=session.scalar(
            select(func.count()).select_from(Visit).where(
                Visit.user_id == rep.id, Visit.confirmed_at.is_not(None), Visit.visited_at >= since, Visit.visited_at < until
            )
        ),
        customers=session.scalar(select(func.count()).select_from(Customer).where(owned)),
        sales_last_year=float(session.scalar(sales(*in_year))),
    )
    amount = func.sum(SalesTransaction.amount)
    top = session.execute(
        select(Customer.id, Customer.name, amount)
        .join(SalesTransaction, SalesTransaction.customer_id == Customer.id)
        .where(owned, *in_year)
        .group_by(Customer.id, Customer.name)
        .order_by(amount.desc(), Customer.id)
        .limit(TOP_CUSTOMERS)
    ).all()
    monthly = []
    for start in _months(today, MONTHS):
        end = (start.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
        current = start.year == today.year and start.month == today.month
        total = session.scalar(sales(SalesTransaction.date >= start, SalesTransaction.date <= min(end, today)))
        monthly.append(MonthSales(f"{start:%Y-%m}", float(total), today if current else None))
    from app.services import product_learning
    return Me(
        name=rep.name, region=rep.region, stats=stats,
        medals=medals(session, rep.id) + product_learning.medals(session, learning_user_id or rep.id),
        top_customers=[TopCustomer(cid, name, float(total)) for cid, name, total in top], monthly=monthly,
    )
