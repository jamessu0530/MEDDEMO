"""完整商品型錄：商品頁與確認頁共用，和 AI 查詢讀同一個 v_product。"""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_session

router = APIRouter(prefix="/api/products", tags=["products"])


class ProductItem(BaseModel):
    sku: str
    name: str
    category: str
    spec: str
    unit: str
    aliases: list[str]
    common: bool


@router.get("", response_model=list[ProductItem])
def list_products(session: Annotated[Session, Depends(get_session)]):
    rows = session.execute(
        text("SELECT sku, product_name AS name, category, spec, unit, aliases, common FROM v_product ORDER BY sku")
    )
    return [ProductItem(**row._mapping) for row in rows]
