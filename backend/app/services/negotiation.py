"""談判卡（FR-3）：每種客戶都有，圍繞下一個節慶。

連鎖是顧客導向：顧客要買的時候架上有沒有（檔期、主推品類裡架上有什麼、缺什麼）、我方的毛利底線。
獨立藥局與診所是成本導向：這一檔進貨成本多少、賣一個賺多少（當期促銷）、這家的供貨與付款條件。
內容只來自資料庫的數字、設定檔裡人寫的句子與內部文件的原文，不讓 AI 生成（NFR-1）：
節慶那一句話寫在 resources/festivals.json，切入點是內部文件的原文段落，「主管教的做法」是主管寫的方法卡原文。
"""

import datetime as dt
import json
from dataclasses import dataclass
from pathlib import Path
from statistics import mean
from typing import Any

from sqlalchemy import column, distinct, func, select, table
from sqlalchemy.orm import Session

from app.models import METHOD_TAGS, AppUser, Customer, DocumentChunk, Product, SalesTransaction
from app.pricing import SUPPLY_PRICE_FACTOR
from app.services import approvals, festivals, method_cards, payment_terms
from app.services.customer_profile import TOP_SKU_DAYS, Profile
from app.services.retrieval import SIMPLE, keyword_tokens

TOPICS_FILE = Path(__file__).resolve().parents[1] / "resources" / "negotiation_topics.json"

# 談判卡比對近 90 天的進貨次數；品項取這家近半年進貨金額最多的四個（原型列三到四個）
TURNOVER_DAYS = 90
TOP_SKUS = 4
MAX_TIPS = 3
# 方法卡最多帶兩張：切入點已經有三段，再多進門前看不完
MAX_METHODS = 2
# 缺口最多列三個：進門談得完的量
MAX_GAPS = 3
# 《檔期活動申請與成效回報》：單一檔期的檔期費用以客戶前 3 個月平均月進貨金額的 15% 為上限
CAMPAIGN_FEE_MONTHS = 3
CAMPAIGN_FEE_CAP_RATE = 0.15
# 促銷品項最多列五個，一個料號一列
MAX_DEALS = 5
# 《連鎖通路合約條件》：獨立藥局不收上架費，通路獎勵統一為進貨金額的 2%；診所不適用上架費與通路獎勵
CHANNEL_REWARD_RATE = {"independent": 0.02, "clinic": None}
# 《報價權限》：業務可在標準供貨價之外自行給予最多 3%（含）的折扣，超過要簽核。
# 跟開報價的簽核規則是同一個數字，只留一份（services/approvals.py）
FREE_DISCOUNT_PCT = approvals.DISCOUNT_FREE
# 只在連鎖的卡上找切入點的情況：續約那一段（《連鎖通路合約條件》）講的是連鎖的上架費率與通路獎勵比率，
# 獨立藥局沒有上架費，引了對不上。客戶檔案的「進門前三分鐘」照舊提醒合約快到期
CHAIN_ONLY_SIGNALS = {"contract_ending"}

# 促銷品項讀語意層的 View：每個平均價（unit_deal_price）只在 View 裡算一次，
# 卡片上的數字才跟促銷頁、問答查到的一樣
promotion_item = table(
    "v_promotion_item",
    column("promotion_name"),
    column("start_date"),
    column("status"),
    column("category"),
    column("sku"),
    column("item_name"),
    column("group_name"),
    column("deal"),
    column("deal_price"),
    column("unit_deal_price"),
    column("list_price"),
)
IN_PROGRESS = "進行中"


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
class Deal:
    sku: str
    name: str  # 促銷品項名稱，口數寫在括號裡
    group_name: str
    deal: str  # 搭贈說明原文
    deal_price: float  # 每口售價
    unit_deal_price: float  # 搭贈後每個多少
    list_price: float  # 建議售價
    unit_profit: float  # 照建議售價賣一個賺多少
    profit_rate: float
    smallest_deal_price: float  # 這個品項最小一口要多少錢


@dataclass
class Deals:
    items: list[Deal]
    scoped: bool  # 是不是限定在節慶的主推品類
    promotion_name: str | None  # 沒有進行中的促銷就是 None


@dataclass
class Terms:
    supply_rate: float  # 供貨價是建議售價的幾成
    channel_reward_rate: float | None  # 診所不適用
    # 付款條件：「RCD2 隔月匯款，優惠 3%」（services/payment_terms.py）
    payment_term: str
    ar_max_age_days: int | None
    ar_overdue_days: int | None
    free_discount_pct: float
    amount_last_90d: float
    avg_order_amount: float | None


@dataclass
class NegotiationCard:
    orientation: str  # customer＝顧客導向（連鎖），cost＝成本導向（獨立藥局與診所）
    festival: FestivalBlock | None  # 行事曆裡沒有之後的節慶就是 None
    # 顧客導向的四區，成本導向的卡是 None
    campaign: Campaign | None
    shelf: Shelf | None
    gaps: list[Gap] | None
    margin: Margin | None
    # 成本導向的兩區，顧客導向的卡是 None
    deals: Deals | None
    terms: Terms | None
    tips: list[Tip]
    # 主管教的做法：照這家的情況帶出來的方法卡，每張是 method_cards.card_out 的樣子；沒有相關的就是空的
    methods: list[dict[str, Any]]


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


def _best_lots(session: Session, promotion_name: str, categories: list[str] | None) -> list[Deal]:
    """這一期每個料號取搭贈後每個最便宜的那一口，照毛利率由高到低。"""
    c = promotion_item.c
    # 資料表沒有限制建議售價要大於 0：算不出毛利率的品項不列，不讓整張卡因為除以零壞掉
    conditions = [c.promotion_name == promotion_name, c.list_price > 0]
    if categories:
        conditions.append(c.category.in_(categories))
    lots = (
        select(
            c.sku, c.item_name.label("name"), c.group_name, c.deal, c.deal_price, c.unit_deal_price, c.list_price,
            (c.list_price - c.unit_deal_price).label("unit_profit"),
            func.round(1 - c.unit_deal_price / c.list_price, 4).label("profit_rate"),
            # 獨立店在意一次要壓多少貨：同一個料號裡最小的那一口
            func.min(c.deal_price).over(partition_by=c.sku).label("smallest_deal_price"),
            func.row_number().over(partition_by=c.sku, order_by=(c.unit_deal_price, c.deal_price)).label("lot_rank"),
        )
        .where(*conditions)
        .subquery()
    )
    rows = session.execute(
        select(lots).where(lots.c.lot_rank == 1).order_by(lots.c.profit_rate.desc(), lots.c.sku).limit(MAX_DEALS)
    ).all()
    return [
        Deal(
            row.sku, row.name, row.group_name, row.deal, float(row.deal_price), float(row.unit_deal_price),
            float(row.list_price), float(row.unit_profit), float(row.profit_rate), float(row.smallest_deal_price),
        )
        for row in rows
    ]


def _deals(session: Session, categories: list[str] | None) -> Deals:
    """進行中那一期促銷裡屬於主推品類的品項；主推品類裡沒有促銷品項，退回全部品類（scoped 是 False）。"""
    c = promotion_item.c
    promotion_name = session.scalar(
        select(c.promotion_name).where(c.status == IN_PROGRESS).order_by(c.start_date.desc()).limit(1)
    )
    if promotion_name is None:
        return Deals([], False, None)
    items = _best_lots(session, promotion_name, categories) if categories else []
    scoped = bool(items)
    if not items:
        items = _best_lots(session, promotion_name, None)
    return Deals(items, scoped, promotion_name)


def _terms(customer: Customer, profile: Profile) -> Terms:
    stats = profile.stats
    return Terms(
        supply_rate=SUPPLY_PRICE_FACTOR[customer.type],
        channel_reward_rate=CHANNEL_REWARD_RATE[customer.type],
        payment_term=payment_terms.describe(customer.payment_term),
        ar_max_age_days=stats.ar_max_age_days,
        ar_overdue_days=stats.ar_overdue_days,
        free_discount_pct=FREE_DISCOUNT_PCT,
        amount_last_90d=stats.amount_last_90d,
        avg_order_amount=stats.avg_order_amount_last_90d,
    )


def _best_section(session: Session, keywords: list[str]) -> DocumentChunk | None:
    tokens = keyword_tokens(" ".join(keywords))
    if not tokens:
        return None
    query = func.to_tsquery(SIMPLE, " | ".join(f"'{token}'" for token in tokens))
    return session.scalars(
        select(DocumentChunk)
        .where(DocumentChunk.search_tokens.op("@@")(query))
        .order_by(func.ts_rank_cd(DocumentChunk.search_tokens, query).desc(), DocumentChunk.id)
        .limit(1)
    ).first()


def _tips(session: Session, signals: set[str]) -> list[Tip]:
    topics = json.loads(TOPICS_FILE.read_text(encoding="utf-8"))["topics"]
    tips: list[Tip] = []
    used: set[int] = set()
    for topic in topics:
        if topic["signal"] not in signals:
            continue
        chunk = _best_section(session, topic["keywords"])
        # 同一段不列兩次：想要的那一段前面已經列了，就跳過這一筆，不拿次相關的段落充數
        if chunk is None or chunk.id in used:
            continue
        used.add(chunk.id)
        # 切片內容的第一行是「標題｜小節」，畫面上已經另外顯示，這裡只留內文
        body = chunk.chunk_content.split("\n", 1)[-1]
        tips.append(Tip(topic["reason"], chunk.doc_title, chunk.section, body, chunk.source_name))
        if len(tips) == MAX_TIPS:
            break
    return tips


def _methods(session: Session, user: AppUser, customer: Customer, signals: set[str]) -> list[dict[str, Any]]:
    """切入點用的那一組情況直接當標籤（訊號與方法卡的標籤同一組名字；chain 不是標籤，不帶）。
    回饋記在這家客戶上，所以 my_feedback 也看這一家的。"""
    return method_cards.related(
        session, user, tags=signals & set(METHOD_TAGS), customer_type=customer.type, customer_id=customer.id, limit=MAX_METHODS
    )


def negotiation_card(session: Session, customer: Customer, profile: Profile, user: AppUser) -> NegotiationCard:
    """user 是打開這張卡的人：方法卡上「我按過什麼」看的是他。"""
    today = profile.today
    coming = festivals.upcoming(today)
    festival = coming[0] if coming else None
    categories = festival.categories if festival else None
    chain = customer.type == "chain"
    block = None
    if festival:
        # 同一個節慶，連鎖看顧客在買什麼，獨立藥局與診所看這一檔進貨要注意什麼
        note = festival.customer_note if chain else festival.cost_note
        block = FestivalBlock(festival.name, festival.date, (festival.date - today).days, festival.categories, note)

    if chain:
        # 連鎖而且有下一個節慶，切入點先列檔期的規定
        signals = profile.signals | ({"festival"} if festival else set())
        return NegotiationCard(
            orientation="customer",
            festival=block,
            campaign=_campaign(coming, today, profile.stats.amount_last_90d),
            shelf=_shelf(session, customer, today, categories),
            gaps=_gaps(session, customer, today, categories) if categories else [],
            margin=_margin(session, customer, today),
            deals=None,
            terms=None,
            tips=_tips(session, signals),
            methods=_methods(session, user, customer, signals),
        )
    signals = (profile.signals - CHAIN_ONLY_SIGNALS) | {"cost"}
    return NegotiationCard(
        orientation="cost",
        festival=block,
        campaign=None,
        shelf=None,
        gaps=None,
        margin=None,
        deals=_deals(session, categories),
        terms=_terms(customer, profile),
        tips=_tips(session, signals),
        methods=_methods(session, user, customer, signals),
    )
