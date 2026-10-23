"""Read-only recommendations using current order access and current supply prices."""

from __future__ import annotations

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppUser, Customer, Product, SalesTransaction
from app.pricing import supply_price
from app.services import order_workspace
from app.services.customer_profile import app_today
from app.services.product_catalog import visible_catalog_products
from app.services.product_recommendation_model import CatalogItem, HISTORY_DAYS, MODEL_VERSION, Purchase, PurchaseModel
from app.services.scope import SHARING_LEVEL, Scope


def load_purchases(session: Session, user: AppUser, channel: str, as_of: dt.date) -> list[Purchase]:
    rows = session.execute(select(SalesTransaction.customer_id, SalesTransaction.sku,
        SalesTransaction.order_no, SalesTransaction.date)
        .join(Customer, Customer.id == SalesTransaction.customer_id)
        .join(Product, Product.sku == SalesTransaction.sku)
        .where(Customer.type == channel, Scope.for_user(user).customers_at(SHARING_LEVEL["sales_figures"]),
               SalesTransaction.date.between(as_of - dt.timedelta(days=HISTORY_DAYS - 1), as_of),
               visible_catalog_products()).distinct())
    return [Purchase(row.customer_id, row.sku, row.order_no, row.date) for row in rows]


def recommend(session: Session, user: AppUser, customer_id: str, limit=12, exclude: list[str] | None = None) -> dict:
    target = order_workspace.customer(session, user, customer_id)
    as_of = app_today(session)
    products = list(session.scalars(select(Product).where(visible_catalog_products()).order_by(Product.sku)))
    products = [item for item in products if supply_price(item.unit_price, target.type) > 0]
    by_sku = {item.sku: item for item in products}
    model = PurchaseModel([CatalogItem(item.sku, item.name, item.category, item.spec, item.unit) for item in products],
                          load_purchases(session, user, target.type, as_of), as_of)
    ranked = model.rank(target.id, limit, exclude or [])
    items = []
    for rank, recommendation in enumerate(ranked, 1):
        product = by_sku[recommendation["sku"]]
        items.append({**recommendation, "rank": rank, "name": product.name, "category": product.category,
            "spec": product.spec, "unit": product.unit, "unit_price": supply_price(product.unit_price, target.type)})
    history = len(model.order_heads.get(target.id, {}))
    peers = len(set(model.profiles) - {target.id})
    if not model.profiles:
        message = "同通路近一年沒有可對應目前型錄的成交紀錄，請先從商品型錄選品。"
    elif not items:
        message = "目前沒有其他可推薦的品項，請從商品型錄選擇其他商品。"
    elif history:
        message = "依客戶採購與同通路成交紀錄提供選品參考；請核對供貨條件與本次數量。"
    else:
        message = "這位客戶近一年尚無成交紀錄，先提供同通路常購品項。"
    return {"items": items, "as_of": as_of, "customer_id": target.id, "customer_name": target.name,
        "channel": target.type, "history_days": HISTORY_DAYS, "history_orders": history, "peer_customers": peers,
        "model_version": MODEL_VERSION, "message": message}
