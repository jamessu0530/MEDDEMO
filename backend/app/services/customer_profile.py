"""客戶檔案（FR-2）。談判卡（FR-3）在 services/negotiation.py。

內容只來自資料庫的數字，不讓 AI 生成（NFR-1）：「進門前三分鐘」的重點是照數字套規則寫出的句子。
"""

import datetime as dt
from dataclasses import dataclass
from statistics import mean
from typing import Any

from sqlalchemy import column, func, select, table
from sqlalchemy.orm import Session

from app.models import Customer, Product, PromotionItem, SalesTransaction, SapQuotationDraft, Visit
from app.services import promo_packs
from app.timeutil import local_date

# 原型的進貨間隔圖看近六個月
PROFILE_MONTHS = 6
# 客訴、承諾、競品的提醒只看近 90 天，跟 v_customer_summary 的「近 90 天」同一個時間窗
RECENT_DAYS = 90
# 進貨間隔比之前拉長兩成以上才提醒：目前 250 家客戶裡，刻意設計的五家以外九成的變化在 8% 以內、
# 最多 13%，那五家拉長 41%～63%
INTERVAL_ALERT_RATIO = 1.2
# 單次進貨金額的變動一成以內算持平：目前 250 家九成的變動在 4% 以內，最多 8%
FLAT_AMOUNT_CHANGE = 0.1
# 帳齡門檻照《付款條件與帳齡管理》：超過 60 天就有處理規定
AR_WATCH_DAYS = 60
# 《連鎖通路合約條件》：合約到期前 3 個月要啟動續約協商
CONTRACT_NOTICE_DAYS = 90
# 摘要最多四句，進門前幾分鐘看得完
MAX_HIGHLIGHTS = 4
# 「這家常進什麼」看近半年：談判卡的架上品項與開報價的品項清單用同一個時間窗
TOP_SKU_DAYS = 180
# 跟客戶清單的「上次拜訪」一樣，只算已確認的拜訪
CONFIRMED = ("confirmed", "synced")
# 待處理事項列哪些報價：可以送出的草稿與還在等簽核的
OPEN_QUOTE_STATUSES = ("draft", "pending_approval")

customer_summary = table(
    "v_customer_summary",
    column("customer_id"),
    column("amount_last_90d"),
    column("amount_prev_90d"),
    column("avg_order_amount_last_90d"),
    column("avg_order_amount_before"),
    column("interval_last_90d"),
    column("interval_before"),
    column("ar_outstanding"),
    column("ar_max_age_days"),
    column("last_order_date"),
)


@dataclass
class Stats:
    amount_last_90d: float
    amount_prev_90d: float
    avg_order_amount_last_90d: float | None
    avg_order_amount_before: float | None
    interval_last_90d: float | None
    interval_before: float | None
    interval_alert: bool
    ar_outstanding: float
    ar_max_age_days: int | None
    last_order_date: dt.date | None
    last_visit_date: dt.date | None


@dataclass
class MonthlyInterval:
    month: str  # 2026-05
    gap_days: float | None  # 這個月沒有進貨就是 None


@dataclass
class OpenQuote:
    quote_no: str
    visit_id: str | None
    date: dt.date
    items: str
    amount: float
    status: str  # draft＝可以送給客戶，pending_approval＝折扣還在等簽核


@dataclass
class Commitment:
    visit_id: str
    visit_date: dt.date
    by: str  # us＝我方答應客戶，customer＝客戶答應我方
    text: str
    due: dt.date | None
    overdue: bool


@dataclass
class Complaint:
    visit_id: str
    visit_date: dt.date
    text: str


@dataclass
class Competitor:
    name: str
    mentions: int
    last_date: dt.date
    detail: str | None


@dataclass
class Profile:
    today: dt.date
    highlights: list[str]
    stats: Stats
    intervals: list[MonthlyInterval]
    open_quotes: list[OpenQuote]
    commitments: list[Commitment]
    complaints: list[Complaint]
    competitors: list[Competitor]
    signals: set[str]


def app_today(session: Session) -> dt.date:
    return session.scalar(select(func.app_today()))


def _float(value: Any) -> float | None:
    return None if value is None else float(value)


def _md(day: dt.date) -> str:
    return f"{day.month}/{day.day}"


def _wan(amount: float) -> str:
    return f"{amount / 10000:.1f} 萬"


def _month_starts(today: dt.date, count: int) -> list[dt.date]:
    starts = []
    year, month = today.year, today.month
    for _ in range(count):
        starts.append(dt.date(year, month, 1))
        year, month = (year, month - 1) if month > 1 else (year - 1, 12)
    return list(reversed(starts))


def _monthly_intervals(session: Session, customer_id: str, today: dt.date) -> list[MonthlyInterval]:
    """每個月進貨的平均間隔：每次進貨距離上一次幾天，算在這次進貨的月份。算法跟 v_customer_summary 相同。"""
    dates = list(
        session.scalars(
            select(func.min(SalesTransaction.date))
            .where(SalesTransaction.customer_id == customer_id)
            .group_by(SalesTransaction.order_no)
            .order_by(func.min(SalesTransaction.date))
        )
    )
    gaps = [(later, (later - earlier).days) for earlier, later in zip(dates, dates[1:])]
    result = []
    for start in _month_starts(today, PROFILE_MONTHS):
        values = [gap for day, gap in gaps if (day.year, day.month) == (start.year, start.month)]
        result.append(MonthlyInterval(f"{start:%Y-%m}", round(mean(values), 1) if values else None))
    return result


def _open_quotes(session: Session, customer_id: str) -> list[OpenQuote]:
    """還沒結案的報價草稿。拜訪回寫開的與客戶檔案直接開的都算，同一個單號併成一張。

    折扣還在等簽核的也列出來（畫面上標「待簽核」），被駁回或退回的不列。
    """
    rows = session.execute(
        select(
            SapQuotationDraft.quote_no, SapQuotationDraft.visit_id, SapQuotationDraft.qty, SapQuotationDraft.packs,
            SapQuotationDraft.amount, SapQuotationDraft.created_at, SapQuotationDraft.status, Product.name,
            PromotionItem.name.label("pack_name"), Visit.visited_at,
        )
        .join(Product, Product.sku == SapQuotationDraft.sku)
        .outerjoin(PromotionItem, PromotionItem.code == SapQuotationDraft.promo_code)
        .outerjoin(Visit, Visit.id == SapQuotationDraft.visit_id)
        .where(SapQuotationDraft.customer_id == customer_id, SapQuotationDraft.status.in_(OPEN_QUOTE_STATUSES))
        .order_by(func.coalesce(Visit.visited_at, SapQuotationDraft.created_at).desc(), SapQuotationDraft.line_no)
    ).all()
    quotes: dict[str, OpenQuote] = {}
    for row in rows:
        day = local_date(row.visited_at or row.created_at)
        quote = quotes.setdefault(row.quote_no, OpenQuote(row.quote_no, row.visit_id, day, "", 0.0, row.status))
        label = promo_packs.line_label(row.name, row.qty, row.pack_name, row.packs)
        quote.items = "、".join(filter(None, [quote.items, label]))
        quote.amount += float(row.amount)
    return list(quotes.values())


def build_profile(session: Session, customer: Customer) -> Profile:
    today = app_today(session)
    recent_since = today - dt.timedelta(days=RECENT_DAYS)
    summary = session.execute(select(customer_summary).where(customer_summary.c.customer_id == customer.id)).one()
    visits = session.execute(
        select(Visit.id, Visit.visited_at, Visit.fields_final)
        .where(Visit.customer_id == customer.id, Visit.status.in_(CONFIRMED))
        .order_by(Visit.visited_at.desc())
    ).all()

    commitments, complaints, competitors = [], [], {}
    for visit in visits:
        fields = visit.fields_final or {}
        day = local_date(visit.visited_at)
        commitment = fields.get("commitment")
        if commitment:
            due = dt.date.fromisoformat(commitment["due"]) if commitment.get("due") else None
            # 沒有結案紀錄，只列近 90 天內到期（或拜訪）的承諾，太舊的不再提醒
            if (due or day) >= recent_since:
                commitments.append(Commitment(visit.id, day, commitment["by"], commitment["text"], due, bool(due and due < today)))
        if fields.get("complaint") and day >= recent_since:
            complaints.append(Complaint(visit.id, day, fields["complaint"]))
        for item in fields.get("competitor") or []:
            known = competitors.get(item["name"])
            if known:
                known.mentions += 1
            else:
                competitors[item["name"]] = Competitor(item["name"], 1, day, item.get("detail"))

    interval_now, interval_before = _float(summary.interval_last_90d), _float(summary.interval_before)
    interval_alert = bool(interval_now and interval_before and interval_now >= interval_before * INTERVAL_ALERT_RATIO)
    stats = Stats(
        amount_last_90d=float(summary.amount_last_90d),
        amount_prev_90d=float(summary.amount_prev_90d),
        avg_order_amount_last_90d=_float(summary.avg_order_amount_last_90d),
        avg_order_amount_before=_float(summary.avg_order_amount_before),
        interval_last_90d=interval_now,
        interval_before=interval_before,
        interval_alert=interval_alert,
        ar_outstanding=float(summary.ar_outstanding),
        ar_max_age_days=summary.ar_max_age_days,
        last_order_date=summary.last_order_date,
        last_visit_date=local_date(visits[0].visited_at) if visits else None,
    )

    signals = {"chain"} if customer.type == "chain" else set()
    highlights = []
    if interval_alert:
        signals.add("interval_up")
        sentence = f"進貨間隔從 {interval_before:.0f} 天拉長到 {interval_now:.0f} 天"
        if stats.avg_order_amount_last_90d and stats.avg_order_amount_before:
            change = stats.avg_order_amount_last_90d / stats.avg_order_amount_before - 1
            sentence += "，單次金額持平" if abs(change) < FLAT_AMOUNT_CHANGE else f"，單次金額{'增加' if change > 0 else '減少'} {abs(change):.0%}"
        highlights.append(sentence)
    overdue = [c for c in commitments if c.overdue and c.by == "us"]
    if overdue:
        highlights.append(f"答應客戶的「{overdue[0].text}」已過期限（{_md(overdue[0].due)}）")
    recent_competitor = next((v for v in visits if local_date(v.visited_at) >= recent_since and (v.fields_final or {}).get("competitor")), None)
    if recent_competitor:
        signals.add("competitor")
        names = "、".join(item["name"] for item in recent_competitor.fields_final["competitor"])
        highlights.append(f"{_md(local_date(recent_competitor.visited_at))} 拜訪提到競品{names}")
    if complaints:
        highlights.append(f"客訴：{complaints[0].text}（{_md(complaints[0].visit_date)}）")
    if stats.ar_max_age_days and stats.ar_max_age_days > AR_WATCH_DAYS:
        signals.add("ar_overdue")
        highlights.append(f"有帳款超過 {AR_WATCH_DAYS} 天沒收，最久 {stats.ar_max_age_days} 天")
    if customer.contract_end_date and 0 <= (customer.contract_end_date - today).days <= CONTRACT_NOTICE_DAYS:
        signals.add("contract_ending")
        highlights.append(f"合約 {customer.contract_end_date:%Y/%m/%d} 到期，要開始談續約")
    if not highlights:
        highlights.append(f"近期進貨穩定，近 90 天進貨 {_wan(stats.amount_last_90d)}")

    return Profile(
        today=today,
        highlights=highlights[:MAX_HIGHLIGHTS],
        stats=stats,
        intervals=_monthly_intervals(session, customer.id, today),
        open_quotes=_open_quotes(session, customer.id),
        commitments=commitments,
        complaints=complaints,
        competitors=sorted(competitors.values(), key=lambda c: c.last_date, reverse=True),
        signals=signals,
    )
