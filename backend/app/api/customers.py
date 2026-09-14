"""客戶相關 API。"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import Date, cast, func, select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import AppUser, Customer, Visit

router = APIRouter(prefix="/api/customers", tags=["customers"])


class CustomerItem(BaseModel):
    id: str
    name: str
    type: str
    region: str
    grade: str
    owner_name: str
    last_visit_date: date | None


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


@router.get("", response_model=list[CustomerItem])
def list_customers(session: Annotated[Session, Depends(get_session)], q: str | None = None):
    """業務開始口述前先選客戶；q 以客戶名稱做部分比對。"""
    stmt = _customer_query()
    if q:
        stmt = stmt.where(Customer.name.contains(q, autoescape=True))
    return [CustomerItem(**row._mapping) for row in session.execute(stmt)]


@router.get("/{customer_id}", response_model=CustomerItem)
def get_customer(session: Annotated[Session, Depends(get_session)], customer_id: str):
    row = session.execute(_customer_query().where(Customer.id == customer_id)).one_or_none()
    if row is None:
        raise HTTPException(404, "找不到這家客戶")
    return CustomerItem(**row._mapping)
