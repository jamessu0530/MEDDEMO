"""登入業務的潛在銷售機會。身分取自 token，不能指定其他業務。"""

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.db import get_session
from app.services import sales_opportunities
from app.services.auth import role_data_user

router = APIRouter(prefix="/api/sales-opportunities", tags=["sales-opportunities"])
SessionDep = Annotated[Session, Depends(get_session)]


class OpportunityOut(BaseModel):
    customer_id: str
    name: str
    type: str
    grade: str | None
    city: str
    area: str
    previous_amount: float
    current_amount: float
    previous_qty: int
    current_qty: int
    previous_orders: int
    current_orders: int
    gap_amount: float
    decline_percent: float | None
    previous_average_order: float | None
    last_order_date: date | None
    amount_declined: bool
    quantity_declined: bool
    is_declining: bool
    is_key_account: bool
    priority: Literal["high", "normal"]


class SummaryOut(BaseModel):
    owned_customers: int
    opportunity_customers: int
    declining_customers: int
    key_accounts: int
    high_priority: int
    gap_amount: float


class OpportunitiesOut(BaseModel):
    as_of: date
    month_start: date
    month_end: date
    previous_start: date
    previous_end: date
    days_remaining: int
    owner_name: str
    summary: SummaryOut
    items: list[OpportunityOut]


@router.get("", response_model=OpportunitiesOut)
def get_opportunities(session: SessionDep, user: CurrentUser):
    rep = role_data_user(user)
    if rep.role != "sales":
        raise HTTPException(403, "潛在銷售僅提供業務查看自己負責的客戶")
    return sales_opportunities.build(session, rep)
