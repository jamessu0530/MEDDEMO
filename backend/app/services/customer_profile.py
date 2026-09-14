"""客戶檔案（FR-2）與談判卡（FR-3）。

內容只來自資料庫的數字與內部文件的原文，不讓 AI 生成（NFR-1）：
「進門前三分鐘」的重點是照數字套規則寫出的句子，談判卡的切入點是內部文件的原文段落。
"""

import datetime as dt
import json
from dataclasses import dataclass
from pathlib import Path
from statistics import mean
from typing import Any

from sqlalchemy import column, distinct, func, select, table
from sqlalchemy.orm import Session

from app.models import Customer, DocumentChunk, Product, SalesTransaction, SapQuotationDraft, Visit
from app.services.retrieval import SIMPLE, keyword_tokens
from app.timeutil import local_date

TOPICS_FILE = Path(__file__).resolve().parents[1] / "resources" / "negotiation_topics.json"

# 原型的進貨間隔圖看近六個月
PROFILE_MONTHS = 6
# 客訴、承諾、競品的提醒只看近 90 天，跟 v_customer_summary 的「近 90 天」同一個時間窗
RECENT_DAYS = 90
# 進貨間隔比之前拉長兩成以上才提醒：目前 80 家客戶裡九成的變化在 7% 以內，刻意設計的五家拉長 41%～63%
INTERVAL_ALERT_RATIO = 1.2
# 單次進貨金額的變動一成以內算持平：目前九成客戶的變動在 4% 以內
FLAT_AMOUNT_CHANGE = 0.1
# 帳齡門檻照《付款條件與帳齡管理》：超過 60 天就有處理規定
AR_WATCH_DAYS = 60
# 《連鎖通路合約條件》：合約到期前 3 個月要啟動續約協商
CONTRACT_NOTICE_DAYS = 90
# 摘要最多四句，進門前幾分鐘看得完
MAX_HIGHLIGHTS = 4
# 談判卡比對近 90 天的進貨次數；品項取這家近半年進貨金額最多的四個（原型列三到四個）
TURNOVER_DAYS = 90
TOP_SKU_DAYS = 180
TOP_SKUS = 4
MAX_TIPS = 3
# 跟客戶清單的「上次拜訪」一樣，只算已確認的拜訪
CONFIRMED = ("confirmed", "synced")

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
    visit_id: str
    date: dt.date
    items: str
    amount: float


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


@dataclass
class Turnover:
    sku: str
    name: str
    orders_per_month: float
    region_orders_per_month: float | None


@dataclass
class Margin:
    listing_fee_rate: float
    channel_reward_rate: float
    net_margin_rate: float
    region_net_margin_rate: float | None
    summary: str


@dataclass
class Tip:
    reason: str
    doc_title: str
    section: str
    content: str
    source_name: str


@dataclass
class NegotiationCard:
    turnover: list[Turnover]
    margin: Margin | None
    tips: list[Tip]


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
    rows = session.execute(
        select(SapQuotationDraft.visit_id, SapQuotationDraft.qty, SapQuotationDraft.unit_price, Product.name, Visit.visited_at)
        .join(Product, Product.sku == SapQuotationDraft.sku)
        .join(Visit, Visit.id == SapQuotationDraft.visit_id)
        .where(SapQuotationDraft.customer_id == customer_id, SapQuotationDraft.status == "draft")
        .order_by(Visit.visited_at.desc(), SapQuotationDraft.line_no)
    ).all()
    quotes: dict[str, OpenQuote] = {}
    for row in rows:
        quote = quotes.setdefault(row.visit_id, OpenQuote(row.visit_id, local_date(row.visited_at), "", 0.0))
        quote.items = "、".join(filter(None, [quote.items, f"{row.name} × {row.qty}"]))
        quote.amount += float(row.unit_price) * row.qty
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


def _turnover(session: Session, customer: Customer, today: dt.date) -> list[Turnover]:
    top = session.execute(
        select(SalesTransaction.sku, Product.name)
        .join(Product, Product.sku == SalesTransaction.sku)
        .where(SalesTransaction.customer_id == customer.id, SalesTransaction.date > today - dt.timedelta(days=TOP_SKU_DAYS))
        .group_by(SalesTransaction.sku, Product.name)
        .order_by(func.sum(SalesTransaction.amount).desc())
        .limit(TOP_SKUS)
    ).all()
    skus = [row.sku for row in top]
    # 同區、同類型客戶每個品項近 90 天的進貨次數；同一張訂單算一次
    counts = session.execute(
        select(SalesTransaction.customer_id, SalesTransaction.sku, func.count(distinct(SalesTransaction.order_no)).label("orders"))
        .join(Customer, Customer.id == SalesTransaction.customer_id)
        .where(
            Customer.region == customer.region,
            Customer.type == customer.type,
            SalesTransaction.sku.in_(skus),
            SalesTransaction.date > today - dt.timedelta(days=TURNOVER_DAYS),
        )
        .group_by(SalesTransaction.customer_id, SalesTransaction.sku)
    ).all()
    months = TURNOVER_DAYS / 30
    result = []
    for row in top:
        mine = next((c.orders for c in counts if c.customer_id == customer.id and c.sku == row.sku), 0)
        # 區域平均只算同區同類型、近 90 天也有進這個品項的其他客戶，不含這家自己
        peers = [c.orders for c in counts if c.sku == row.sku and c.customer_id != customer.id]
        result.append(Turnover(row.sku, row.name, round(mine / months, 1), round(mean(peers) / months, 1) if peers else None))
    return result


def _margin(session: Session, customer: Customer, today: dt.date) -> Margin | None:
    since = today - dt.timedelta(days=TURNOVER_DAYS)
    sums = (
        func.sum(SalesTransaction.amount),
        func.sum(SalesTransaction.cost),
        func.sum(SalesTransaction.listing_fee),
        func.sum(SalesTransaction.channel_reward),
    )
    mine = session.execute(select(*sums).where(SalesTransaction.customer_id == customer.id, SalesTransaction.date > since)).one()
    region = session.execute(
        select(*sums)
        .join(Customer, Customer.id == SalesTransaction.customer_id)
        .where(Customer.region == customer.region, Customer.type == customer.type, Customer.id != customer.id, SalesTransaction.date > since)
    ).one()
    if not mine[0]:
        return None
    revenue, cost, listing, reward = (float(value) for value in mine)

    # 淨毛利率一律用加總相除，不能把各家的比率直接平均（《連鎖通路合約條件》淨毛利的計算方式）
    def net_rate(row) -> float | None:
        return (float(row[0]) - float(row[1]) - float(row[2]) - float(row[3])) / float(row[0]) if row[0] else None

    net, region_net = net_rate(mine), net_rate(region)
    summary = f"上架費 {listing / revenue:.0%} ＋ 通路獎勵 {reward / revenue:.0%} 扣掉之後，淨毛利 {net:.0%}"
    if region_net is not None:
        summary += f"，{'低於' if net < region_net else '高於'}同區同類型客戶的平均 {region_net:.0%}"
    return Margin(round(listing / revenue, 4), round(reward / revenue, 4), round(net, 4), round(region_net, 4) if region_net is not None else None, summary)


def _best_section(session: Session, keywords: list[str], used: set[int]) -> DocumentChunk | None:
    tokens = keyword_tokens(" ".join(keywords))
    if not tokens:
        return None
    query = func.to_tsquery(SIMPLE, " | ".join(f"'{token}'" for token in tokens))
    stmt = select(DocumentChunk).where(DocumentChunk.search_tokens.op("@@")(query))
    if used:
        stmt = stmt.where(DocumentChunk.id.not_in(used))
    return session.scalars(stmt.order_by(func.ts_rank_cd(DocumentChunk.search_tokens, query).desc(), DocumentChunk.id).limit(1)).first()


def _tips(session: Session, signals: set[str]) -> list[Tip]:
    topics = json.loads(TOPICS_FILE.read_text(encoding="utf-8"))["topics"]
    tips: list[Tip] = []
    used: set[int] = set()
    for topic in topics:
        if topic["signal"] not in signals:
            continue
        chunk = _best_section(session, topic["keywords"], used)
        if chunk is None:
            continue
        used.add(chunk.id)
        # 切片內容的第一行是「標題｜小節」，畫面上已經另外顯示，這裡只留內文
        body = chunk.chunk_content.split("\n", 1)[-1]
        tips.append(Tip(topic["reason"], chunk.doc_title, chunk.section, body, chunk.source_name))
        if len(tips) == MAX_TIPS:
            break
    return tips


def negotiation_card(session: Session, customer: Customer, profile: Profile) -> NegotiationCard:
    return NegotiationCard(
        turnover=_turnover(session, customer, profile.today),
        margin=_margin(session, customer, profile.today),
        tips=_tips(session, profile.signals),
    )
