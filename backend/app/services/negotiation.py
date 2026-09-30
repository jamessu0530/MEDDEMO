"""談判卡（FR-3）：每種客戶都有，圍繞下一個節慶。

連鎖是顧客導向：顧客要買的時候架上有沒有（檔期、主推品類裡架上有什麼、缺什麼）、我方的毛利底線。
內容只來自資料庫的數字、設定檔裡人寫的句子與內部文件的原文，不讓 AI 生成（NFR-1）：
節慶那一句話寫在 resources/festivals.json，切入點是內部文件的原文段落。
"""

import datetime as dt
import json
from dataclasses import dataclass
from pathlib import Path
from statistics import mean

from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from app.models import Customer, DocumentChunk, Product, SalesTransaction
from app.services import festivals
from app.services.customer_profile import TOP_SKU_DAYS, Profile
from app.services.retrieval import SIMPLE, keyword_tokens

TOPICS_FILE = Path(__file__).resolve().parents[1] / "resources" / "negotiation_topics.json"

# 談判卡比對近 90 天的進貨次數；品項取這家近半年進貨金額最多的四個（原型列三到四個）
TURNOVER_DAYS = 90
TOP_SKUS = 4
MAX_TIPS = 3
# 缺口最多列三個：進門談得完的量
MAX_GAPS = 3
# 《檔期活動申請與成效回報》：單一檔期的檔期費用以客戶前 3 個月平均月進貨金額的 15% 為上限
CAMPAIGN_FEE_MONTHS = 3
CAMPAIGN_FEE_CAP_RATE = 0.15


@dataclass
class FestivalBlock:
    name: str
    date: dt.date
    days_left: int
    categories: list[str]
    note: str  # 連鎖是 customer_note，獨立藥局與診所是 cost_note


@dataclass
class Campaign:
    festival_name: str  # 還來得及申請檔期的那個節慶
    festival_date: dt.date
    apply_by: dt.date
    days_to_apply: int
    fee_cap: float
    missed: list[str]  # 排在它前面、申請期限已過的節慶名稱


@dataclass
class ShelfItem:
    sku: str
    name: str
    orders_per_month: float
    region_orders_per_month: float | None


@dataclass
class Shelf:
    items: list[ShelfItem]
    scoped: bool  # 是不是限定在節慶的主推品類


@dataclass
class Gap:
    sku: str
    name: str
    peers_with: int  # 同區其他連鎖近 90 天有進的家數
    peers_total: int


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
    orientation: str  # customer＝顧客導向（連鎖）
    festival: FestivalBlock | None  # 行事曆裡沒有之後的節慶就是 None
    campaign: Campaign | None
    shelf: Shelf | None
    gaps: list[Gap] | None
    margin: Margin | None
    tips: list[Tip]


def _campaign(coming: list[festivals.Festival], today: dt.date, amount_last_90d: float) -> Campaign | None:
    """由近到遠找第一個還來得及申請檔期的節慶；申請期限當天還算來得及。"""
    missed = []
    for festival in coming:
        if festival.apply_by >= today:
            fee_cap = round(amount_last_90d / CAMPAIGN_FEE_MONTHS * CAMPAIGN_FEE_CAP_RATE)
            return Campaign(festival.name, festival.date, festival.apply_by, (festival.apply_by - today).days, fee_cap, missed)
        missed.append(festival.name)
    return None


def _top_skus(session: Session, customer: Customer, today: dt.date, categories: list[str] | None):
    conditions = [SalesTransaction.customer_id == customer.id, SalesTransaction.date > today - dt.timedelta(days=TOP_SKU_DAYS)]
    if categories:
        conditions.append(Product.category.in_(categories))
    return session.execute(
        select(SalesTransaction.sku, Product.name)
        .join(Product, Product.sku == SalesTransaction.sku)
        .where(*conditions)
        .group_by(SalesTransaction.sku, Product.name)
        .order_by(func.sum(SalesTransaction.amount).desc())
        .limit(TOP_SKUS)
    ).all()


def _shelf(session: Session, customer: Customer, today: dt.date, categories: list[str] | None) -> Shelf:
    """這家近半年進貨金額最高的幾個品項，近 90 天每月進貨幾次，對照同區同類型客戶的平均。

    有節慶就只看主推品類；主推品類裡這家一項都沒進，退回不分品類（scoped 是 False，畫面上註明）。
    """
    top = _top_skus(session, customer, today, categories) if categories else []
    scoped = bool(top)
    if not top:
        top = _top_skus(session, customer, today, None)
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
        result.append(ShelfItem(row.sku, row.name, round(mine / months, 1), round(mean(peers) / months, 1) if peers else None))
    return Shelf(result, scoped)


def _gaps(session: Session, customer: Customer, today: dt.date, categories: list[str]) -> list[Gap]:
    """主推品類裡，同區其他連鎖近 90 天超過一半有進、這家近半年沒進過的品項，最多人進的排前面。"""
    peers = (Customer.region == customer.region, Customer.type == customer.type, Customer.id != customer.id)
    peers_total = session.scalar(select(func.count()).select_from(Customer).where(*peers))
    stocked = select(SalesTransaction.sku).where(
        SalesTransaction.customer_id == customer.id, SalesTransaction.date > today - dt.timedelta(days=TOP_SKU_DAYS)
    )
    peers_with = func.count(distinct(SalesTransaction.customer_id))
    rows = session.execute(
        select(Product.sku, Product.name, peers_with.label("peers_with"))
        .join(SalesTransaction, SalesTransaction.sku == Product.sku)
        .join(Customer, Customer.id == SalesTransaction.customer_id)
        .where(
            *peers,
            Product.category.in_(categories),
            SalesTransaction.date > today - dt.timedelta(days=TURNOVER_DAYS),
            Product.sku.not_in(stocked),
        )
        .group_by(Product.sku, Product.name)
        .having(peers_with * 2 > peers_total)
        .order_by(peers_with.desc(), Product.sku)
        .limit(MAX_GAPS)
    ).all()
    return [Gap(row.sku, row.name, row.peers_with, peers_total) for row in rows]


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
    today = profile.today
    coming = festivals.upcoming(today)
    festival = coming[0] if coming else None
    categories = festival.categories if festival else None
    return NegotiationCard(
        orientation="customer",
        festival=FestivalBlock(festival.name, festival.date, (festival.date - today).days, festival.categories, festival.customer_note)
        if festival
        else None,
        campaign=_campaign(coming, today, profile.stats.amount_last_90d),
        shelf=_shelf(session, customer, today, categories),
        gaps=_gaps(session, customer, today, categories) if categories else [],
        margin=_margin(session, customer, today),
        tips=_tips(session, profile.signals),
    )
