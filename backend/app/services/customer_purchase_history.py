"""商家叫貨關鍵字：只從已成交的交易明細產生，不把報價或意向當成叫貨。"""

from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Customer, Product, SalesTransaction
from app.services.outlet_search import normalize
from app.services.scope import SHARING_LEVEL, Scope


@dataclass(frozen=True)
class PurchasedProduct:
    sku: str
    name: str
    category: str
    spec: str
    unit: str
    aliases: list[str]
    order_count: int
    total_qty: int
    last_order_date: date


def product_search_text():
    return func.replace(func.lower(func.regexp_replace(func.concat(
        Product.name, " ", Product.sku, " ", Product.category, " ", Product.spec,
        " ", func.array_to_string(Product.aliases, " "),
    ), r"\s+", "", "g")), "臺", "台")


def matching_customers(session: Session, scope: Scope, query: str) -> list[str]:
    """直接查交易主檔，成交後不必等待搜尋索引重建。"""
    keyword = normalize(query)
    if not keyword:
        return []
    return list(session.scalars(
        select(SalesTransaction.customer_id)
        .join(Customer, Customer.id == SalesTransaction.customer_id)
        .join(Product, Product.sku == SalesTransaction.sku)
        .where(
            scope.customers_at(SHARING_LEVEL["sales_figures"]),
            product_search_text().contains(keyword, autoescape=True),
        )
        .distinct().order_by(SalesTransaction.customer_id)
    ))


def for_customers(session: Session, scope: Scope, customer_ids: list[str]) -> dict[str, list[PurchasedProduct]]:
    """一批客戶一次聚合；每個料號一筆，累計叫貨量最多的排前面。"""
    result: dict[str, list[PurchasedProduct]] = {key: [] for key in customer_ids}
    if not customer_ids:
        return result
    last_date = func.max(SalesTransaction.date)
    count = func.count(func.distinct(SalesTransaction.order_no))
    total_qty = func.sum(SalesTransaction.qty)
    rows = session.execute(
        select(
            SalesTransaction.customer_id, Product.sku, Product.name, Product.category,
            Product.spec, Product.unit, Product.aliases,
            count.label("order_count"), total_qty.label("total_qty"),
            last_date.label("last_order_date"),
        )
        .join(Product, Product.sku == SalesTransaction.sku)
        .join(Customer, Customer.id == SalesTransaction.customer_id)
        .where(
            SalesTransaction.customer_id.in_(customer_ids),
            scope.customers_at(SHARING_LEVEL["sales_figures"]),
        )
        .group_by(SalesTransaction.customer_id, Product.sku)
        .order_by(total_qty.desc(), count.desc(), last_date.desc(), Product.sku)
    )
    for row in rows:
        data = dict(row._mapping)
        customer_id = data.pop("customer_id")
        result[customer_id].append(PurchasedProduct(**data))
    return result
