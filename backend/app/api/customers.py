"""客戶相關 API：客戶清單、客戶檔案（FR-2）、談判卡（FR-3）。"""

import dataclasses
from datetime import date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import Date, case, cast, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.db import get_session
from app.models import AppUser, Customer, Product, SalesTransaction, SapQuotationDraft, Visit
from app.pricing import supply_price
from app.services import customer_profile, negotiation, writeback
from app.services.scope import SHARING_LEVEL, Scope

router = APIRouter(prefix="/api/customers", tags=["customers"])
SessionDep = Annotated[Session, Depends(get_session)]


class CustomerItem(BaseModel):
    id: str
    name: str
    type: str
    region: str
    grade: str
    # 負責業務。IT 在客戶檔案頁換負責人時，要知道現在是誰
    owner_id: str
    owner_name: str
    last_visit_date: date | None


class ProfileStats(BaseModel):
    amount_last_90d: float
    amount_prev_90d: float
    avg_order_amount_last_90d: float | None
    avg_order_amount_before: float | None
    interval_last_90d: float | None
    interval_before: float | None
    interval_alert: bool
    ar_outstanding: float
    ar_max_age_days: int | None
    last_order_date: date | None
    last_visit_date: date | None


class MonthlyInterval(BaseModel):
    month: str
    gap_days: float | None


class OpenQuote(BaseModel):
    quote_no: str
    visit_id: str | None
    date: date
    items: str
    amount: float


class Commitment(BaseModel):
    visit_id: str
    visit_date: date
    by: str
    text: str
    due: date | None
    overdue: bool


class Complaint(BaseModel):
    visit_id: str
    visit_date: date
    text: str


class Competitor(BaseModel):
    name: str
    mentions: int
    last_date: date
    detail: str | None


class CustomerProfile(BaseModel):
    customer: CustomerItem
    today: date
    highlights: list[str]
    stats: ProfileStats
    intervals: list[MonthlyInterval]
    open_quotes: list[OpenQuote]
    commitments: list[Commitment]
    complaints: list[Complaint]
    competitors: list[Competitor]


class Turnover(BaseModel):
    sku: str
    name: str
    orders_per_month: float
    region_orders_per_month: float | None


class Margin(BaseModel):
    listing_fee_rate: float
    channel_reward_rate: float
    net_margin_rate: float
    region_net_margin_rate: float | None
    summary: str


class Tip(BaseModel):
    reason: str
    doc_title: str
    section: str
    content: str
    source_name: str


class NegotiationCard(BaseModel):
    customer: CustomerItem
    turnover: list[Turnover]
    margin: Margin | None
    tips: list[Tip]


def _customer_query(scope: Scope):
    """客戶清單一列的內容。上次拜訪只算已確認的紀錄；還在處理或草稿中的不算。

    清單本身是全公司共用的，但「上次拜訪」是從拜訪紀錄算出來的，拜訪紀錄在別的地方都停在
    團隊層級——同一個欄位不該因為換了一支 API 就看得更遠，所以看不到這家客戶拜訪的人拿到 NULL，
    其他欄位照常。過濾寫在 SQL 裡而不是撈回來再抹掉，日期不會先離開資料庫。
    """
    last_visit = func.max(cast(func.timezone("Asia/Taipei", Visit.visited_at), Date))
    # 沒有 else，條件不成立就是 NULL
    visible_last_visit = case((scope.customers_at(SHARING_LEVEL["visit_record"]), last_visit))
    return (
        select(
            Customer.id, Customer.name, Customer.type, Customer.region, Customer.grade,
            Customer.owner_user_id.label("owner_id"), AppUser.name.label("owner_name"),
            visible_last_visit.label("last_visit_date"),
        )
        .join(AppUser, AppUser.id == Customer.owner_user_id)
        .outerjoin(Visit, (Visit.customer_id == Customer.id) & Visit.status.in_(("confirmed", "synced")))
        .group_by(Customer.id, AppUser.name)
        .order_by(Customer.id)
    )


def _load(session: Session, customer_id: str, user: AppUser, level: int) -> tuple[Customer, CustomerItem]:
    """看不到的客戶跟不存在一樣回 404，不透露這個編號是別人的客戶。

    level 是這次要求的資料屬於哪一種共享層級，由呼叫端從 SHARING_LEVEL 取（services/scope.py）：
    客戶本身全公司共用，檔案、議價卡與報價是負責人自己的。
    """
    scope = Scope.for_user(user)
    row = session.execute(
        _customer_query(scope).where(Customer.id == customer_id, scope.customers_at(level))
    ).one_or_none()
    if row is None:
        raise HTTPException(404, "找不到這家客戶")
    return session.get(Customer, customer_id), CustomerItem(**row._mapping)


@router.get("", response_model=list[CustomerItem])
def list_customers(session: SessionDep, user: CurrentUser, q: str | None = None):
    """業務開始口述前先選客戶；q 以客戶名稱做部分比對。客戶清單全國共享（services/scope.py）。"""
    scope = Scope.for_user(user)
    stmt = _customer_query(scope).where(scope.customers_at(SHARING_LEVEL["customer_basic"]))
    if q:
        stmt = stmt.where(Customer.name.contains(q, autoescape=True))
    return [CustomerItem(**row._mapping) for row in session.execute(stmt)]


@router.get("/{customer_id}", response_model=CustomerItem)
def get_customer(session: SessionDep, customer_id: str, user: CurrentUser):
    return _load(session, customer_id, user, SHARING_LEVEL["customer_basic"])[1]


@router.get("/{customer_id}/profile", response_model=CustomerProfile)
def get_profile(session: SessionDep, customer_id: str, user: CurrentUser):
    """客戶檔案：交易概況、待處理事項、競品紀錄放在同一頁（FR-2）。

    停在 customer_profile：內容是近 90 天進貨金額、帳齡、未結報價、承諾與客訴，是負責人自己的
    經營資料，不是客戶清單那種「這家店叫什麼名字」的共用資訊。
    """
    customer, item = _load(session, customer_id, user, SHARING_LEVEL["customer_profile"])
    profile = customer_profile.build_profile(session, customer)
    data = dataclasses.asdict(profile)
    data.pop("signals")
    return CustomerProfile(customer=item, **data)


@router.get("/{customer_id}/negotiation", response_model=NegotiationCard)
def get_negotiation_card(session: SessionDep, customer_id: str, user: CurrentUser):
    """談判卡：只有連鎖客戶有（FR-3）。對照數據來自交易資料，切入點是內部文件的原文段落。"""
    customer, item = _load(session, customer_id, user, SHARING_LEVEL["customer_profile"])
    if customer.type != "chain":
        raise HTTPException(409, "只有連鎖客戶有談判卡")
    profile = customer_profile.build_profile(session, customer)
    card = negotiation.negotiation_card(session, customer, profile)
    return NegotiationCard(customer=item, **dataclasses.asdict(card))


# ── 開報價（原型客戶檔案的「開報價」）────────────────────────────────

# 報價頁列這家客戶近半年進過的品項，跟談判卡看的時間窗一樣
QUOTE_ITEM_DAYS = customer_profile.TOP_SKU_DAYS
# 一張報價最多幾項：這家客戶常進的品項大約 10～15 項，再多多半是誤操作
MAX_QUOTE_LINES = 20


class QuoteItemOption(BaseModel):
    sku: str
    name: str
    spec: str
    unit: str
    unit_price: int
    usual_qty: int


class QuoteLineInput(BaseModel):
    sku: str
    qty: int = Field(gt=0)


class QuoteInput(BaseModel):
    items: list[QuoteLineInput] = Field(min_length=1, max_length=MAX_QUOTE_LINES)


class QuoteLine(BaseModel):
    sku: str
    name: str
    qty: int
    unit_price: int
    amount: int


class Quote(BaseModel):
    quote_no: str
    customer_id: str
    items: list[QuoteLine]
    amount: int
    created_at: datetime


@router.get("/{customer_id}/quote-items", response_model=list[QuoteItemOption])
def quote_items(session: SessionDep, customer_id: str, user: CurrentUser):
    """開報價時可以選的品項：這家客戶近半年進過的，照進貨金額排序。數量預設是平常一次進多少。"""
    customer, _ = _load(session, customer_id, user, SHARING_LEVEL["quote"])
    today = customer_profile.app_today(session)
    rows = session.execute(
        select(
            Product.sku, Product.name, Product.spec, Product.unit, Product.unit_price,
            func.round(func.avg(SalesTransaction.qty)).label("usual_qty"),
        )
        .join(SalesTransaction, SalesTransaction.sku == Product.sku)
        .where(
            SalesTransaction.customer_id == customer.id,
            SalesTransaction.date > today - timedelta(days=QUOTE_ITEM_DAYS),
        )
        .group_by(Product.sku)
        .order_by(func.sum(SalesTransaction.amount).desc())
    ).all()
    return [
        QuoteItemOption(
            sku=r.sku, name=r.name, spec=r.spec, unit=r.unit,
            unit_price=supply_price(r.unit_price, customer.type), usual_qty=int(r.usual_qty or 1),
        )
        for r in rows
    ]


def _next_quote_no(session: Session, today: date) -> str:
    prefix = f"Q{today:%Y%m%d}-"
    count = session.scalar(
        select(func.count(func.distinct(SapQuotationDraft.quote_no))).where(SapQuotationDraft.quote_no.like(f"{prefix}%"))
    )
    return f"{prefix}{(count or 0) + 1:04d}"


@router.post("/{customer_id}/quotes", status_code=201, response_model=Quote)
def create_quote(session: SessionDep, customer_id: str, body: QuoteInput, user: CurrentUser):
    """在客戶檔案直接開 SAP 報價草稿，不必先有一次拜訪。"""
    customer, _ = _load(session, customer_id, user, SHARING_LEVEL["quote"])
    skus = [line.sku for line in body.items]
    if len(set(skus)) != len(skus):
        raise HTTPException(422, "同一個品項只能列一次")
    products = {p.sku: p for p in session.scalars(select(Product).where(Product.sku.in_(skus)))}
    if missing := [sku for sku in skus if sku not in products]:
        raise HTTPException(422, f"找不到品項：{'、'.join(missing)}")
    # 跟拜訪回寫一樣受模擬系統開關影響：展示「SAP 停機」時這裡也開不成
    if writeback.is_mock_down("sap"):
        raise HTTPException(503, "SAP 暫時連不上，報價草稿沒有開成，請稍後再試")

    today = customer_profile.app_today(session)
    for _attempt in range(3):  # 兩個人同時開報價可能拿到同一個單號，撞到唯一限制就換下一號
        quote_no = _next_quote_no(session, today)
        lines = [
            SapQuotationDraft(
                quote_no=quote_no, visit_id=None, created_by=user.id, line_no=n, customer_id=customer.id,
                sku=line.sku, qty=line.qty, unit_price=supply_price(products[line.sku].unit_price, customer.type),
            )
            for n, line in enumerate(body.items, start=1)
        ]
        session.add_all(lines)
        try:
            session.commit()
            break
        except IntegrityError:
            session.rollback()
    else:
        raise HTTPException(409, "報價單號衝突，請再送一次")

    items = [
        QuoteLine(
            sku=l.sku, name=products[l.sku].name, qty=l.qty, unit_price=int(l.unit_price), amount=int(l.unit_price) * l.qty
        )
        for l in lines
    ]
    return Quote(
        quote_no=quote_no, customer_id=customer.id, items=items, amount=sum(i.amount for i in items),
        created_at=lines[0].created_at,
    )

