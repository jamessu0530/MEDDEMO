"""正式商品清單：商品頁與確認頁共用，排除舊版示範品項。"""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Product
from app.services.product_catalog import visible_catalog_products

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
        select(Product.sku, Product.name, Product.category, Product.spec, Product.unit, Product.aliases, Product.common)
        .where(visible_catalog_products()).order_by(Product.sku)
    )
    return [ProductItem(**row._mapping) for row in rows]
