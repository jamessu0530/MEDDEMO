"""談判卡（FR-3）。

內容只來自資料庫的數字與內部文件的原文，不讓 AI 生成（NFR-1）：切入點是內部文件的原文段落。
"""

import datetime as dt
import json
from dataclasses import dataclass
from pathlib import Path
from statistics import mean

from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from app.models import Customer, DocumentChunk, Product, SalesTransaction
from app.services.customer_profile import TOP_SKU_DAYS, Profile
from app.services.retrieval import SIMPLE, keyword_tokens

TOPICS_FILE = Path(__file__).resolve().parents[1] / "resources" / "negotiation_topics.json"

# 談判卡比對近 90 天的進貨次數；品項取這家近半年進貨金額最多的四個（原型列三到四個）
TURNOVER_DAYS = 90
TOP_SKUS = 4
MAX_TIPS = 3


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
