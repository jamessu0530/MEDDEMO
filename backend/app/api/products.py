"""品項清單：確認頁修改「意向」時挑品項用。"""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Product

router = APIRouter(prefix="/api/products", tags=["products"])


class ProductItem(BaseModel):
    sku: str
    name: str
    category: str
    unit: str
    aliases: list[str]


@router.get("", response_model=list[ProductItem])
def list_products(session: Annotated[Session, Depends(get_session)]):
    rows = session.execute(
        select(Product.sku, Product.name, Product.category, Product.unit, Product.aliases).order_by(Product.sku)
    )
    return [ProductItem(**row._mapping) for row in rows]
