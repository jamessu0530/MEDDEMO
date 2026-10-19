"""藥局業績、匿名藥品查詢與單品叫貨分析；僅聚合已成交交易。"""

from __future__ import annotations

import datetime as dt
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, literal, select
from sqlalchemy.orm import Session

from app.models import AppUser, Customer, Product, ProductQueryEvent, SalesTransaction
from app.services.outlet_search import normalize
from app.services.scope import Scope, SHARING_LEVEL

TAIPEI = dt.timezone(dt.timedelta(hours=8))
View = Literal["pharmacy_sales", "product_queries", "product_orders"]


class BusinessQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    view: View = "pharmacy_sales"
    start: dt.date | None = None
    end: dt.date | None = None
    sku: str | None = Field(default=None, min_length=1, max_length=80)
    q: str = Field(default="", max_length=100)
    customer_type: Literal["all", "pharmacies", "chain", "independent", "clinic", "outlet"] = "all"
    page: int = Field(default=1, ge=1, le=100_000, strict=True)
    page_size: int = Field(default=25, ge=1, le=100, strict=True)

    @model_validator(mode="after")
    def valid_range(self) -> Self:
        if self.start and self.end and self.start > self.end:
            raise ValueError("起始日期不能晚於結束日期")
        if self.end == dt.date.max:
            raise ValueError("結束日期超出可用範圍")
        if self.view == "product_orders" and not self.sku:
            raise ValueError("請先選擇要查詢訂購紀錄的藥品")
        if self.view == "product_queries" and self.customer_type != "all":
            raise ValueError("藥品查詢沒有藥局關聯，不能按客戶類型篩選")
        if self.view == "pharmacy_sales" and self.sku:
            raise ValueError("單品訂購紀錄請使用藥品訂購分析")
        return self


class BusinessProduct(BaseModel):
    sku: str
    name: str
    spec: str
    unit: str


class BusinessRow(BaseModel):
    key: str
    name: str
    customer_type: str | None = None
    spec: str | None = None
    unit: str | None = None
    sales: float = 0
    order_count: int = 0
    quantity: int | None = None
    query_count: int | None = None
    last_order_date: dt.date | None = None


class BusinessTotals(BaseModel):
    sales: float
    order_count: int
    quantity: int | None
    query_count: int | None


class BusinessData(BaseModel):
    view: View
    rows: list[BusinessRow]
    total: int
    page: int
    page_size: int
    totals: BusinessTotals
    product: BusinessProduct | None = None
    tracked_since: dt.datetime | None = None


class ProductNotFound(ValueError):
    pass


def _product_search_text():
    return func.replace(func.lower(func.regexp_replace(func.concat(
        Product.name, " ", Product.sku, " ", Product.category, " ", Product.spec,
        " ", func.array_to_string(Product.aliases, " "),
    ), r"\s+", "", "g")), "臺", "台")


def products(session: Session, q: str) -> list[BusinessProduct]:
    # 歷史交易可能使用已退出公開型錄的品項，仍須可選取查詢。
    statement = select(Product.sku, Product.name, Product.spec, Product.unit)
    if keyword := normalize(q):
        statement = statement.where(_product_search_text().contains(keyword, autoescape=True))
    rows = session.execute(statement.order_by(Product.name, Product.sku).limit(50))
    return [BusinessProduct(**row._mapping) for row in rows]


def _date_filters(column, query: BusinessQuery, *, timestamp=False):
    conditions = []
    if query.start:
        conditions.append(column >= (dt.datetime.combine(query.start, dt.time.min, TAIPEI) if timestamp else query.start))
    if query.end:
        conditions.append(column < dt.datetime.combine(query.end + dt.timedelta(days=1), dt.time.min, TAIPEI)
            if timestamp else column <= query.end)
    return conditions


def data(session: Session, user: AppUser, query: BusinessQuery) -> BusinessData:
    scope = Scope.for_user(user)
    selected = session.get(Product, query.sku) if query.sku else None
    if query.sku and selected is None:
        raise ProductNotFound("找不到這項藥品，請重新選擇")
    product = BusinessProduct(sku=selected.sku, name=selected.name, spec=selected.spec, unit=selected.unit) if selected else None
    keyword = normalize(query.q)
    tracked_since = None

    if query.view == "product_queries":
        events = select(ProductQueryEvent.sku, func.count().label("query_count")).where(
            *_date_filters(ProductQueryEvent.recorded_at, query, timestamp=True)
        ).group_by(ProductQueryEvent.sku).subquery()
        count = func.coalesce(events.c.query_count, 0)
        statement = select(Product.sku.label("key"), Product.name, Product.spec, Product.unit,
            count.label("query_count")).outerjoin(events, events.c.sku == Product.sku)
        if query.sku:
            statement = statement.where(Product.sku == query.sku)
        else:
            # 沒查過的商品不佔據排行；指定單品則明確顯示 0 次。
            statement = statement.where(count > 0)
        if keyword:
            statement = statement.where(_product_search_text().contains(keyword, autoescape=True))
        tracked_since = session.scalar(select(func.min(ProductQueryEvent.recorded_at)))
        value_column = "query_count"
    else:
        conditions = [scope.customers_at(SHARING_LEVEL["sales_figures"])]
        if query.customer_type == "pharmacies":
            conditions.append(Customer.type.in_(("chain", "independent")))
        elif query.customer_type != "all":
            conditions.append(Customer.type == query.customer_type)
        if keyword:
            text = func.replace(func.lower(func.regexp_replace(func.concat(Customer.name, " ", Customer.id), r"\s+", "", "g")), "臺", "台")
            conditions.append(text.contains(keyword, autoescape=True))
        transactions = select(SalesTransaction.customer_id,
            func.sum(SalesTransaction.amount).label("sales"),
            func.count(func.distinct(SalesTransaction.order_no)).label("order_count"),
            func.sum(SalesTransaction.qty).label("quantity"),
            func.max(SalesTransaction.date).label("last_order_date"),
        ).where(*_date_filters(SalesTransaction.date, query))
        if query.sku:
            transactions = transactions.where(SalesTransaction.sku == query.sku)
        transactions = transactions.group_by(SalesTransaction.customer_id).subquery()
        statement = select(Customer.id.label("key"), Customer.name, Customer.type.label("customer_type"),
            func.coalesce(transactions.c.sales, 0).label("sales"),
            func.coalesce(transactions.c.order_count, 0).label("order_count"), transactions.c.last_order_date)
        if query.view == "product_orders":
            statement = statement.add_columns(transactions.c.quantity)
            statement = statement.join(transactions, transactions.c.customer_id == Customer.id)
            value_column = "quantity"
        else:
            # 每家客戶都列出，期間內沒有成交也顯示 0。
            statement = statement.outerjoin(transactions, transactions.c.customer_id == Customer.id)
            value_column = "sales"
        statement = statement.where(*conditions)

    grouped = statement.subquery()
    totals = session.execute(select(func.count().label("total"), *[
        (func.coalesce(func.sum(grouped.c[key]), 0) if key in grouped.c else literal(0)).label(key)
        for key in ("sales", "order_count", "quantity", "query_count")
    ]).select_from(grouped)).one()
    total = totals.total
    page = min(query.page, max(1, (total + query.page_size - 1) // query.page_size))
    rows = session.execute(select(grouped).order_by(grouped.c[value_column].desc(), grouped.c.name, grouped.c.key)
        .offset((page - 1) * query.page_size).limit(query.page_size))
    return BusinessData(view=query.view, rows=[BusinessRow(**row._mapping) for row in rows], total=total,
        page=page, page_size=query.page_size, product=product, tracked_since=tracked_since,
        totals=BusinessTotals(sales=totals.sales, order_count=totals.order_count,
            quantity=totals.quantity if query.view == "product_orders" else None,
            query_count=totals.query_count if query.view == "product_queries" else None))
