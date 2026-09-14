"""客戶相關 API：客戶清單、客戶檔案（FR-2）、談判卡（FR-3）。"""

import dataclasses
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import Date, cast, func, select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import AppUser, Customer, Visit
from app.services import customer_profile

router = APIRouter(prefix="/api/customers", tags=["customers"])
SessionDep = Annotated[Session, Depends(get_session)]


class CustomerItem(BaseModel):
    id: str
    name: str
    type: str
    region: str
    grade: str
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
    visit_id: str
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


def _customer_query():
    last_visit = func.max(cast(func.timezone("Asia/Taipei", Visit.visited_at), Date))
    # 上次拜訪只算已確認的紀錄；還在處理或草稿中的不算
    return (
        select(
            Customer.id, Customer.name, Customer.type, Customer.region, Customer.grade,
            AppUser.name.label("owner_name"), last_visit.label("last_visit_date"),
        )
        .join(AppUser, AppUser.id == Customer.owner_user_id)
        .outerjoin(Visit, (Visit.customer_id == Customer.id) & Visit.status.in_(("confirmed", "synced")))
        .group_by(Customer.id, AppUser.name)
        .order_by(Customer.id)
    )


def _load(session: Session, customer_id: str) -> tuple[Customer, CustomerItem]:
    row = session.execute(_customer_query().where(Customer.id == customer_id)).one_or_none()
    if row is None:
        raise HTTPException(404, "找不到這家客戶")
    return session.get(Customer, customer_id), CustomerItem(**row._mapping)


@router.get("", response_model=list[CustomerItem])
def list_customers(session: SessionDep, q: str | None = None):
    """業務開始口述前先選客戶；q 以客戶名稱做部分比對。"""
    stmt = _customer_query()
    if q:
        stmt = stmt.where(Customer.name.contains(q, autoescape=True))
    return [CustomerItem(**row._mapping) for row in session.execute(stmt)]


@router.get("/{customer_id}", response_model=CustomerItem)
def get_customer(session: SessionDep, customer_id: str):
    return _load(session, customer_id)[1]


@router.get("/{customer_id}/profile", response_model=CustomerProfile)
def get_profile(session: SessionDep, customer_id: str):
    """客戶檔案：交易概況、待處理事項、競品紀錄放在同一頁（FR-2）。"""
    customer, item = _load(session, customer_id)
    profile = customer_profile.build_profile(session, customer)
    data = dataclasses.asdict(profile)
    data.pop("signals")
    return CustomerProfile(customer=item, **data)


@router.get("/{customer_id}/negotiation", response_model=NegotiationCard)
def get_negotiation_card(session: SessionDep, customer_id: str):
    """談判卡：只有連鎖客戶有（FR-3）。對照數據來自交易資料，切入點是內部文件的原文段落。"""
    customer, item = _load(session, customer_id)
    if customer.type != "chain":
        raise HTTPException(409, "只有連鎖客戶有談判卡")
    profile = customer_profile.build_profile(session, customer)
    card = customer_profile.negotiation_card(session, customer, profile)
    return NegotiationCard(customer=item, **dataclasses.asdict(card))
