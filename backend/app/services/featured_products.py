"""經理按節慶指定團隊主推料號；保存於 app_setting，既有資料庫無須重建。"""

from __future__ import annotations

import datetime as dt
import json

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models import AppSetting, AppUser, Customer, Product
from app.pricing import supply_price
from app.services import customer_priority, customer_profile, festivals
from app.services.product_catalog import visible_catalog_products

PREFIX = "featured_products:"
MAX_PRODUCTS = 100


class FeaturedError(ValueError):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


class Selection(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    manager_id: str = Field(min_length=1, max_length=64)
    festival_id: str = Field(min_length=1, max_length=80)
    revision: int = Field(ge=0)
    skus: list[str] = Field(max_length=MAX_PRODUCTS)

    @model_validator(mode="after")
    def unique_skus(self):
        if any(not sku or len(sku) > 80 for sku in self.skus):
            raise ValueError("請選擇有效的商品料號")
        if len(set(self.skus)) != len(self.skus):
            raise ValueError("同一個品項只能選一次")
        return self


class FeaturedProduct(BaseModel):
    sku: str
    name: str
    category: str
    spec: str
    unit: str
    supply_price: float | None
    unit_cost: float | None
    unit_margin: float | None
    margin_rate: float | None
    price_source: str
    deal: str | None


class FeaturedBlock(BaseModel):
    manager_id: str
    manager_name: str
    festival_id: str
    items: list[FeaturedProduct]


def _key(manager_id: str, festival_id: str) -> str:
    return f"{PREFIX}{manager_id}:{festival_id}"


def load(session: Session, manager_id: str, festival_id: str) -> dict:
    row = session.get(AppSetting, _key(manager_id, festival_id), populate_existing=True)
    return json.loads(row.value) if row else {
        "skus": [], "revision": 0, "updated_at": None, "updated_by": None,
    }


def target_manager(session: Session, viewer: AppUser, manager_id: str | None) -> AppUser:
    try:
        return customer_priority.target_manager(session, viewer, manager_id)
    except customer_priority.PriorityError:
        raise FeaturedError("找不到可設定主推品項的主管", 404) from None


def _calendar(session: Session, festival_id: str | None):
    coming = festivals.upcoming(customer_profile.app_today(session))
    chosen = next((f for f in coming if f.id == festival_id), None) if festival_id else next(iter(coming), None)
    if festival_id and chosen is None:
        raise FeaturedError("找不到可設定的節慶檔期", 404)
    return coming, chosen


def settings(session: Session, viewer: AppUser, manager_id: str | None = None, festival_id: str | None = None) -> dict:
    manager = target_manager(session, viewer, manager_id)
    coming, chosen = _calendar(session, festival_id)
    current = load(session, manager.id, chosen.id) if chosen else {
        "skus": [], "revision": 0, "updated_at": None, "updated_by": None,
    }
    return {
        **current, "manager_id": manager.id, "festival_id": chosen.id if chosen else None,
        "managers": [{"id": m.id, "name": m.name} for m in customer_priority.managers(session, viewer)],
        "festivals": [{"id": f.id, "name": f.name, "date": f.date, "categories": f.categories} for f in coming],
        "max_products": MAX_PRODUCTS,
    }


def save(session: Session, viewer: AppUser, selection: Selection) -> dict:
    manager = target_manager(session, viewer, selection.manager_id)
    _calendar(session, selection.festival_id)
    # 鎖主管列也涵蓋尚未建立設定的首次儲存；另一頁的舊版本不得蓋掉新設定。
    customer_priority.lock_manager(session, manager)
    before = load(session, manager.id, selection.festival_id)
    if before["revision"] != selection.revision:
        raise FeaturedError("主推品項剛被修改，請重新載入後再儲存", 409)
    known = set(session.scalars(select(Product.sku).where(
        visible_catalog_products(), Product.sku.in_(selection.skus),
    )))
    if known != set(selection.skus):
        raise FeaturedError("部分品項已不在商品清單，請重新載入後再選擇")
    payload = {
        "skus": selection.skus, "revision": before["revision"] + 1,
        "updated_at": dt.datetime.now(dt.UTC).isoformat(), "updated_by": viewer.name,
    }
    row = session.get(AppSetting, _key(manager.id, selection.festival_id))
    if row:
        row.value = json.dumps(payload, ensure_ascii=False)
    else:
        session.add(AppSetting(key=_key(manager.id, selection.festival_id), value=json.dumps(payload, ensure_ascii=False)))
    session.flush()
    return settings(session, viewer, manager.id, selection.festival_id)


def for_customer(session: Session, customer: Customer, festival: festivals.Festival | None) -> FeaturedBlock | None:
    """依客戶所屬團隊取設定，任何人查看同一家都拿到相同的主推品項。"""
    if festival is None or customer.owner_user_id is None:
        return None
    owner = session.get(AppUser, customer.owner_user_id)
    manager = session.get(AppUser, owner.manager_id) if owner and owner.manager_id else None
    if manager is None or manager.role != "manager" or manager.deactivated_at is not None:
        return None
    skus = load(session, manager.id, festival.id)["skus"]
    if not skus:
        return None
    products = {p.sku: p for p in session.scalars(select(Product).where(
        visible_catalog_products(), Product.sku.in_(skus),
    ))}
    # 與成本導向談判卡相同：最新進行中促銷，每個料號取搭贈後單價最低的一口。
    offers = {row["sku"]: row for row in session.execute(text("""
        WITH current_promotion AS (
            SELECT promotion_name FROM v_promotion_item WHERE status = '進行中'
            ORDER BY start_date DESC, promotion_name LIMIT 1
        )
        SELECT DISTINCT ON (sku) sku, unit_deal_price, deal, promotion_name
        FROM v_promotion_item
        WHERE promotion_name = (SELECT promotion_name FROM current_promotion)
          AND sku = ANY(:skus)
        ORDER BY sku, unit_deal_price, deal_price, item_code
    """), {"skus": skus}).mappings()}
    items = []
    for sku in skus:
        product = products.get(sku)
        if product is None:
            continue
        offer = offers.get(sku)
        price = float(offer["unit_deal_price"]) if offer else float(supply_price(product.unit_price, customer.type))
        # 型錄缺價或缺成本時不把 0 當成 100% 毛利；負毛利仍如實列出。
        price = price if price > 0 else None
        cost = float(product.unit_cost) if product.unit_cost > 0 else None
        margin = round(price - cost, 2) if price is not None and cost is not None else None
        items.append(FeaturedProduct(
            sku=sku, name=product.name, category=product.category, spec=product.spec, unit=product.unit,
            supply_price=price, unit_cost=cost, unit_margin=margin,
            margin_rate=round(margin / price, 4) if margin is not None else None,
            price_source=offer["promotion_name"] if offer else "標準供貨價",
            deal=offer["deal"] if offer else None,
        ))
    return FeaturedBlock(manager_id=manager.id, manager_name=manager.name, festival_id=festival.id, items=items) if items else None
