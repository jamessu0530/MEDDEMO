"""新人第一週 API。規則都在 services/first_week.py，這裡只負責認人與回應的形狀。"""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.db import get_session
from app.services import first_week

router = APIRouter(prefix="/api/first-week", tags=["first-week"])
SessionDep = Annotated[Session, Depends(get_session)]


class Newcomer(BaseModel):
    is_newcomer: bool
    # 到職第幾天，到職日當天是 1；沒有人員主檔的帳號（自建與第三方登入）是 null
    day_no: int | None


class Status(Newcomer):
    # 第一週每件事的 id：勾選進度記在手機裡，首頁的入口卡拿它算「完成幾件／共幾件」
    task_ids: list[str]


class Employee(BaseModel):
    employee_no: str | None
    hire_date: dt.date | None
    region: str
    manager_name: str | None
    # 名下客戶所在的縣市，客戶多的在前
    cities: list[str]
    # 自建帳號代理的示範業務；公司帳號是 null
    proxy_of: str | None


class CustomerCounts(BaseModel):
    total: int
    by_type: dict[str, int]
    by_grade: dict[str, int]


class TopProduct(BaseModel):
    sku: str
    name: str
    unit_price: float
    aliases: list[str]


class ProductLine(BaseModel):
    category: str
    sku_count: int
    top: list[TopProduct]


class RunningPromotion(BaseModel):
    name: str
    item_count: int


class KeyCustomer(BaseModel):
    id: str
    name: str
    type: str
    grade: str
    city: str
    amount_last_90d: float


class Task(BaseModel):
    id: str
    text: str
    # App 裡的路徑或一份內部文件的檔名，擇一；文件不在索引裡時兩個都是 null
    to: str | None
    doc: str | None


class Day(BaseModel):
    day: int
    title: str
    tasks: list[Task]


class RequiredDocument(BaseModel):
    source_name: str
    title: str


class FirstWeek(Newcomer):
    employee: Employee
    customers: CustomerCounts
    product_lines: list[ProductLine]
    promotion: RunningPromotion | None
    key_customers: list[KeyCustomer]
    days: list[Day]
    documents: list[RequiredDocument]


@router.get("", response_model=FirstWeek)
def get_first_week(session: SessionDep, user: CurrentUser):
    """整頁的資料。業務帳號都打得開，不是新人也能回來看。"""
    if not first_week.has_page(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "新人第一週是給業務看的，主管與 IT 沒有這一頁")
    return FirstWeek(**first_week.page(session, user))


@router.get("/status", response_model=Status)
def get_status(session: SessionDep, user: CurrentUser):
    """首頁用：要不要顯示入口卡。主管與 IT 一律不是新人，不回 403——首頁不必先分角色再問。"""
    return Status(**first_week.status(session, user))
