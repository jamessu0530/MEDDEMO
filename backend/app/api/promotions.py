"""促銷方案：底部分頁「促銷」一次拿到每一期與品項，在手機上切換期數、篩選品項。

直接讀語意層的 v_promotion 與 v_promotion_item，不在這裡另算：狀態、每 PCS 平均單價與折扣率
只在 View 裡算一次，頁面上的數字跟問答查到的一定一樣。促銷不分客戶，登入的人都看得到。
"""

import datetime as dt
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.db import get_session

router = APIRouter(prefix="/api/promotions", tags=["promotions"])
SessionDep = Annotated[Session, Depends(get_session)]


class PromotionItemOut(BaseModel):
    code: str
    group_name: str
    name: str
    sku: str
    spec: str
    unit: str
    deal: str
    buy_qty: int
    free_qty: int
    deal_price: float
    unit_deal_price: float
    list_price: float
    ship_price: float
    discount_rate: float


class PromotionOut(BaseModel):
    name: str
    type: str
    department: str
    start_date: dt.date
    end_date: dt.date
    status: Literal["未開始", "進行中", "已結束"]
    pm_note: str
    items: list[PromotionItemOut]


@router.get("", response_model=list[PromotionOut])
def list_promotions(session: SessionDep, user: CurrentUser):
    """新的一期在前；品項照促銷品項編號排，同一個品牌的編號本來就連在一起。"""
    items: dict[str, list[PromotionItemOut]] = {}
    for row in session.execute(text("""
        SELECT promotion_name, item_code AS code, group_name, item_name AS name, sku, spec, unit, deal,
               buy_qty, free_qty, deal_price, unit_deal_price, list_price, ship_price, discount_rate
        FROM v_promotion_item ORDER BY item_code
    """)).mappings():
        items.setdefault(row["promotion_name"], []).append(PromotionItemOut(**row))
    return [
        PromotionOut(**row, items=items.get(row["name"], []))
        for row in session.execute(text("""
            SELECT promotion_name AS name, promotion_type AS type, department, start_date, end_date, status, pm_note
            FROM v_promotion ORDER BY start_date DESC
        """)).mappings()
    ]
