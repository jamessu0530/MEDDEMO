"""可儲存空白草稿的訂單工作區，沿用既有供貨價、訂單入帳與 SAP 展示服務。"""

import base64
import datetime as dt
import json
import uuid
from decimal import Decimal, ROUND_HALF_UP

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, literal, select
from sqlalchemy.orm import Session

from app.models import AppUser, Customer, PAYMENT_TERM_CODES, Product, PublicOutlet, SalesOrder, SalesTransaction, SapQuotationDraft
from app.pricing import supply_price
from app.services import customer_profile, orders, writeback
from app.services.scope import SHARING_LEVEL, Scope
from app.services.product_catalog import visible_catalog_products

CENT = Decimal("0.01")
TAIPEI = dt.timezone(dt.timedelta(hours=8))


class OrderError(ValueError):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


class ItemInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    sku: str = Field(min_length=1, max_length=80)
    qty: int = Field(ge=1, le=100000, strict=True)
    unit_price: Decimal = Field(ge=0, le=10000000, max_digits=10, decimal_places=2)


class OrderInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    customer_id: str = Field(min_length=1, max_length=64)
    ship_to_id: str = Field(min_length=1, max_length=64)
    shipping_date: dt.date
    shipping_address: str = Field(default="", max_length=240)
    recipient: str = Field(default="", max_length=80)
    payment_term: str = Field(max_length=8)
    purchase_no: str = Field(default="", max_length=80)
    note: str = Field(default="", max_length=1000)
    items: list[ItemInput] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def valid(self):
        if self.payment_term not in PAYMENT_TERM_CODES:
            raise ValueError("請選擇有效的付款條件")
        if len({item.sku for item in self.items}) != len(self.items):
            raise ValueError("同一產品只需加入一次，請調整數量")
        if sum(item.qty * item.unit_price for item in self.items) > Decimal("9999999999.99"):
            raise ValueError("訂單總額超過上限")
        return self


class SaveInput(OrderInput):
    revision: int = Field(ge=1, strict=True)


def customer(session: Session, user: AppUser, customer_id: str) -> Customer:
    found = session.scalar(select(Customer).where(Customer.id == customer_id, Scope.for_user(user).customers_at(SHARING_LEVEL["quote"])))
    if found is None:
        raise OrderError("找不到這家可操作的客戶", 404)
    return found


def _load(session: Session, user: AppUser, order_id: str, lock=False) -> SalesOrder:
    statement = select(SalesOrder).join(Customer, Customer.id == SalesOrder.customer_id).where(
        SalesOrder.id == order_id, Scope.for_user(user).customers_at(SHARING_LEVEL["quote"])
    )
    if lock:
        statement = statement.with_for_update(of=SalesOrder)
    order = session.scalar(statement.execution_options(populate_existing=True))
    if order is None:
        raise OrderError("找不到這張訂單", 404)
    return order


def _products(session: Session, items, *, for_write: bool = False) -> dict[str, Product]:
    skus = {item.sku if isinstance(item, ItemInput) else item["sku"] for item in items}
    query = select(Product).where(Product.sku.in_(skus))
    if for_write:
        query = query.where(visible_catalog_products())
    found = {row.sku: row for row in session.scalars(query)}
    if set(found) != skus:
        raise OrderError("部分產品已不存在，請重新選擇產品")
    return found


def price_check(product: Product, customer_type: str, price: Decimal):
    standard = Decimal(supply_price(product.unit_price, customer_type))
    floor = (standard * Decimal("0.97")).quantize(CENT, ROUND_HALF_UP)
    if standard <= 0:
        return "gray", "尚無標準供貨價，請先確認商品價格", standard, floor
    if price >= standard:
        return "green", "不低於標準供貨價", standard, floor
    if price >= floor:
        return "yellow", "低於標準價，仍在業務 3% 優惠權限內", standard, floor
    return "red", "超過業務 3% 優惠權限，需先透過開報價申請優惠", standard, floor


def _item_out(product: Product, kind: str, item: dict, index: int):
    price = Decimal(str(item["unit_price"]))
    light, message, standard, floor = price_check(product, kind, price)
    return {**item, "line_no": (index + 1) * 10, "name": product.name, "category": product.category,
        "spec": product.spec, "unit": product.unit, "unit_price": float(price),
        "amount": float((price * item["qty"]).quantize(CENT)), "standard_price": float(standard),
        "minimum_price": float(floor), "price_status": light, "price_message": message}


def detail(session: Session, user: AppUser, order_id: str):
    if order_id.startswith("history-"):
        return historical_detail(session, user, order_id)
    order = _load(session, user, order_id)
    target = customer(session, user, order.customer_id)
    products = _products(session, order.items)
    ship = session.get(Customer, order.ship_to_id)
    owner = session.get(AppUser, target.owner_user_id) if target.owner_user_id else None
    items = [_item_out(products[item["sku"]], target.type, item, i) for i, item in enumerate(order.items)]
    return {"id": order.id, "order_no": order.order_no, "customer_id": target.id, "customer_name": target.name,
        "ship_to_id": order.ship_to_id, "ship_to_name": ship.name, "shipping_address": order.shipping_address,
        "recipient": order.recipient, "shipping_date": order.shipping_date, "payment_term": order.payment_term,
        "purchase_no": order.purchase_no, "note": order.note, "status": order.status, "revision": order.revision,
        "order_type": "Z200 標準出貨", "currency": "TWD", "owner_id": owner.id if owner else None, "owner_name": owner.name if owner else None,
        "amount": float(order.amount), "items": items, "sap_order_no": order.sap_order_no, "as_of": customer_profile.app_today(session),
        "created_at": order.created_at, "updated_at": order.updated_at, "readonly": order.status != "draft", "source": "workspace"}


def create(session: Session, user: AppUser, body: OrderInput, *, commit: bool = True):
    customer(session, user, body.customer_id)
    customer(session, user, body.ship_to_id)
    _products(session, body.items, for_write=True)
    key = uuid.uuid4().hex
    today = customer_profile.app_today(session)
    payload = body.model_dump(exclude={"items"})
    order = SalesOrder(id=key, order_no=f"OD{today:%Y%m%d}-{key[:12].upper()}", created_by=user.id,
        **payload, items=[item.model_dump(mode="json") for item in body.items], status="draft", revision=1,
        amount=sum((item.unit_price * item.qty for item in body.items), Decimal(0)))
    session.add(order)
    session.commit() if commit else session.flush()
    return detail(session, user, key)


def save(session: Session, user: AppUser, order_id: str, body: SaveInput, *, commit: bool = True):
    order = _load(session, user, order_id, lock=True)
    if order.status != "draft":
        raise OrderError("生效訂單不能修改，請建立新訂單", 409)
    if order.revision != body.revision:
        raise OrderError("訂單已被其他頁面修改，請重新載入後再編輯", 409)
    customer(session, user, body.customer_id)
    customer(session, user, body.ship_to_id)
    _products(session, body.items, for_write=True)
    for key, value in body.model_dump(exclude={"items", "revision"}).items():
        setattr(order, key, value)
    order.items = [item.model_dump(mode="json") for item in body.items]
    order.amount = sum((item.unit_price * item.qty for item in body.items), Decimal(0))
    order.revision += 1
    order.updated_at = dt.datetime.now(dt.timezone.utc)
    session.commit() if commit else session.flush()
    return detail(session, user, order_id)


def submit(session: Session, user: AppUser, order_id: str, revision: int):
    order = _load(session, user, order_id, lock=True)
    if order.status == "effective":
        return detail(session, user, order_id)
    if order.revision != revision:
        raise OrderError("訂單已變更，請重新載入再送出", 409)
    target = customer(session, user, order.customer_id)
    customer(session, user, order.ship_to_id)
    if not order.items:
        raise OrderError("請先新增至少一項產品")
    if not order.shipping_address.strip():
        raise OrderError("請填寫完整收貨地址")
    if order.shipping_date < customer_profile.app_today(session):
        raise OrderError("指定出貨日期不能早於資料基準日")
    products = _products(session, order.items, for_write=True)
    for item in order.items:
        status, message, _, _ = price_check(products[item["sku"]], target.type, Decimal(item["unit_price"]))
        if status in {"red", "gray"}:
            raise OrderError(f"{products[item['sku']].name}：{message}")
    if writeback.is_mock_down("sap"):
        raise OrderError("SAP 暫時無法連線，草稿已保留，請稍後重試", 503)
    quote_no = f"WEB-{order.id}"
    for index, item in enumerate(order.items):
        price = Decimal(item["unit_price"])
        session.add(SapQuotationDraft(quote_no=quote_no, created_by=order.created_by, line_no=(index + 1) * 10,
            customer_id=target.id, sku=item["sku"], qty=item["qty"], unit_price=price, discount_pct=0,
            amount=(price * item["qty"]).quantize(CENT), free_qty=0, status="draft"))
    session.flush()
    # 沿用付款條件計算與入帳邏輯；指定出貨日供排程使用，銷售及應收依現有系統日入帳。
    placed = orders.place(session, target, quote_no, payment_term=order.payment_term)
    if placed is None:
        raise OrderError("訂單未完成同步，請重新載入", 409)
    order.status, order.sap_order_no = "effective", placed.order_no
    order.revision += 1
    order.updated_at = dt.datetime.now(dt.timezone.utc)
    session.commit()
    return detail(session, user, order_id)


def history_id(customer_id: str, order_no: str):
    return "history-" + base64.urlsafe_b64encode(json.dumps([customer_id, order_no]).encode()).decode().rstrip("=")


def historical_detail(session: Session, user: AppUser, order_id: str):
    try:
        encoded = order_id.removeprefix("history-")
        if len(encoded) > 2048:
            raise ValueError()
        customer_id, number = json.loads(base64.b64decode(encoded + "=" * (-len(encoded) % 4), altchars=b"-_", validate=True))
        if not isinstance(customer_id, str) or not isinstance(number, str):
            raise ValueError()
    except (ValueError, TypeError):
        raise OrderError("找不到這張訂單", 404) from None
    target = customer(session, user, customer_id)
    rows = session.execute(select(SalesTransaction, Product).join(Product, Product.sku == SalesTransaction.sku).where(
        SalesTransaction.customer_id == target.id, SalesTransaction.order_no == number).order_by(SalesTransaction.id)).all()
    if not rows:
        raise OrderError("找不到這張訂單", 404)
    owner = session.get(AppUser, target.owner_user_id) if target.owner_user_id else None
    items = []
    grouped = {}
    for transaction, product in rows:
        entry = grouped.setdefault(product.sku, {"product": product, "qty": 0, "amount": Decimal(0)})
        entry["qty"] += transaction.qty
        entry["amount"] += transaction.amount
    for i, entry in enumerate(grouped.values()):
        product = entry["product"]
        price = (entry["amount"] / entry["qty"]).quantize(CENT)
        item = _item_out(product, target.type, {"sku": product.sku, "qty": entry["qty"], "unit_price": str(price)}, i)
        item.update(amount=float(entry["amount"]), price_status="gray", price_message="歷史成交價格，不套用目前價格檢查")
        items.append(item)
    day = min(row[0].date for row in rows)
    stamp = dt.datetime.combine(day, dt.time(), TAIPEI)
    return {"id": order_id, "order_no": number, "customer_id": target.id, "customer_name": target.name,
        "ship_to_id": target.id, "ship_to_name": "未記錄", "shipping_address": "", "recipient": "",
        "shipping_date": day, "payment_term": target.payment_term, "purchase_no": "", "note": "歷史交易未記錄的收貨資訊以空白呈現。",
        "status": "effective", "revision": 1, "order_type": "歷史交易", "currency": "TWD", "owner_id": owner.id if owner else None,
        "owner_name": owner.name if owner else None, "amount": float(sum((transaction.amount for transaction, _ in rows), Decimal(0))), "items": items, "sap_order_no": None,
        "as_of": customer_profile.app_today(session),
        "created_at": stamp, "updated_at": None, "readonly": True, "source": "history"}


def list_orders(session: Session, user: AppUser, q="", status="all", page=1, page_size=25, sort="updated_desc"):
    # 交易表包含展示用種子資料；訂單工作區只列使用者建立的草稿與生效訂單。
    scope = Scope.for_user(user).customers_at(SHARING_LEVEL["quote"])
    fresh = select(SalesOrder.id.label("id"), SalesOrder.order_no.label("order_no"), Customer.id.label("customer_id"),
        Customer.name.label("customer_name"), SalesOrder.status.label("status"), SalesOrder.shipping_date.label("shipping_date"),
        SalesOrder.updated_at.label("updated_at"), SalesOrder.sap_order_no.label("sap_order_no"), AppUser.id.label("owner_id"),
        AppUser.name.label("owner_name"), SalesOrder.amount.label("amount"), literal("workspace").label("source")) \
        .join(Customer, Customer.id == SalesOrder.customer_id).outerjoin(AppUser, AppUser.id == Customer.owner_user_id).where(scope)
    if q:
        from app.services.outlet_search import customer_matches
        matching = Customer.id.in_(customer_matches(session, q))
        pattern = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        fresh = fresh.where(matching | Customer.name.ilike(pattern, escape="\\") | SalesOrder.order_no.ilike(pattern, escape="\\") | SalesOrder.sap_order_no.ilike(pattern, escape="\\"))
    if status != "all":
        fresh = fresh.where(SalesOrder.status == status)
    combined = fresh.subquery()
    total = session.scalar(select(func.count()).select_from(combined))
    key = combined.c.amount if sort == "amount_desc" else combined.c.shipping_date if sort == "shipping_desc" else combined.c.updated_at
    query = select(combined).order_by(key.desc(), combined.c.order_no.desc(), combined.c.customer_id).offset((page - 1) * page_size).limit(page_size)
    items = []
    for row in session.execute(query).mappings():
        item = dict(row)
        item["amount"] = float(item["amount"])
        items.append(item)
    return {"items": items, "total": total, "page": page, "page_size": page_size, "as_of": customer_profile.app_today(session), "integration": "demo"}



def catalog(session: Session, user: AppUser, customer_id: str, q="", page=1):
    target = customer(session, user, customer_id)
    query = select(Product).where(visible_catalog_products())
    if q:
        pattern = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        query = query.where(Product.name.ilike(pattern, escape="\\") | Product.sku.ilike(pattern, escape="\\") | Product.category.ilike(pattern, escape="\\"))
    total = session.scalar(select(func.count()).select_from(query.subquery()))
    products = session.scalars(query.order_by(Product.common.desc(), Product.sku).offset((page - 1) * 25).limit(25))
    return {"items": [{"sku": product.sku, "name": product.name, "category": product.category, "spec": product.spec, "unit": product.unit,
        "unit_price": supply_price(product.unit_price, target.type)} for product in products], "total": total, "page": page, "page_size": 25}


def last_purchase(session: Session, user: AppUser, customer_id: str, *, source_order_no: str | None = None):
    """最近一張已成交交易；同料號合併，重新加入時使用目前客戶供貨價。"""
    target = customer(session, user, customer_id)
    first_day = func.min(SalesTransaction.date)
    head = session.execute(select(SalesTransaction.order_no, first_day.label("date"))
        .where(SalesTransaction.customer_id == target.id,
               SalesTransaction.order_no == source_order_no if source_order_no else literal(True))
        .group_by(SalesTransaction.order_no)
        .order_by(first_day.desc(), SalesTransaction.order_no.desc()).limit(1)).one_or_none()
    if head is None:
        return None
    rows = session.execute(select(SalesTransaction.sku, func.sum(SalesTransaction.qty).label("qty"),
        func.sum(SalesTransaction.amount).label("amount"))
        .where(SalesTransaction.customer_id == target.id, SalesTransaction.order_no == head.order_no)
        .group_by(SalesTransaction.sku)
        .order_by(func.sum(SalesTransaction.amount).desc(), SalesTransaction.sku)).all()
    products = {product.sku: product for product in session.scalars(select(Product)
        .where(Product.sku.in_([row.sku for row in rows]), visible_catalog_products()))}
    items = []
    for row in rows:
        product = products.get(row.sku)
        if product is None:
            continue
        items.append({"sku": product.sku, "name": product.name, "category": product.category,
            "spec": product.spec, "unit": product.unit, "unit_price": supply_price(product.unit_price, target.type),
            "last_qty": int(row.qty), "last_unit_price": float((row.amount / row.qty).quantize(CENT, ROUND_HALF_UP))})
    return {"order_no": head.order_no, "date": head.date, "items": items, "unavailable_count": len(rows) - len(items)}


def _customer_out(row: Customer, owner_name, address, phone):
    return {"id": row.id, "name": row.name, "owner_name": owner_name, "owner_id": row.owner_user_id,
        "payment_term": row.payment_term, "region": row.region, "city": row.city, "area": row.area,
        "address": address, "phone": phone}


def customer_defaults(session: Session, user: AppUser, customer_id: str):
    target = customer(session, user, customer_id)
    owner = session.get(AppUser, target.owner_user_id) if target.owner_user_id else None
    outlet = session.get(PublicOutlet, target.id)
    return {"customer": _customer_out(target, owner.name if owner else None,
        outlet.address if outlet else None, outlet.phone if outlet else None),
        "as_of": customer_profile.app_today(session)}


def customers(session: Session, user: AppUser, q: str = ""):
    from app.services.outlet_search import customer_matches
    matches = customer_matches(session, q) if q else None
    rows = session.execute(select(Customer, AppUser.name, PublicOutlet.address, PublicOutlet.phone)
        .outerjoin(AppUser, AppUser.id == Customer.owner_user_id)
        .outerjoin(PublicOutlet, PublicOutlet.customer_id == Customer.id).where(
        Scope.for_user(user).customers_at(SHARING_LEVEL["quote"]),
        Customer.id.in_(matches) if matches is not None else literal(True)).order_by(Customer.name)).all()
    return [_customer_out(row, name, address, phone) for row, name, address, phone in rows]
