"""正式商品清單：商品頁與確認頁共用，排除舊版示範品項。"""

import datetime as dt
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.db import get_session
from app.api.auth import CurrentUser
from app.models import Product, ProductBrowseProfile
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


class BrowseSignal(BaseModel):
    active_ms: int = 0
    opens: int = 0
    last_seen: str = ""


class BrowseEvent(BaseModel):
    id: UUID
    sku: str = Field(min_length=1, max_length=80)
    kind: Literal["dwell", "detail"]
    active_ms: int = Field(default=0, ge=0, le=60000)


class BrowseEvents(BaseModel):
    events: list[BrowseEvent] = Field(min_length=1, max_length=40)


@router.get("/browse-profile", response_model=dict[str, BrowseSignal])
def browse_profile(session: Annotated[Session, Depends(get_session)], user: CurrentUser):
    row = session.get(ProductBrowseProfile, user.id)
    return row.signals if row else {}


@router.post("/browse-events", response_model=dict[str, BrowseSignal])
def record_browsing(body: BrowseEvents, session: Annotated[Session, Depends(get_session)], user: CurrentUser):
    # 同帳號同時開兩個頁面：鎖住單一帳號的累計資料，避免最後一筆覆蓋前一筆。
    session.execute(insert(ProductBrowseProfile).values(user_id=user.id, signals={}, recent_events=[])
                    .on_conflict_do_nothing(index_elements=[ProductBrowseProfile.user_id]))
    row = session.scalar(select(ProductBrowseProfile).where(ProductBrowseProfile.user_id == user.id).with_for_update())
    assert row is not None
    known = set(session.scalars(select(Product.sku).where(Product.sku.in_({event.sku for event in body.events}))))
    signals = {sku: dict(value) for sku, value in row.signals.items()}
    recent = list(row.recent_events)
    seen = set(recent)
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    for event in body.events:
        event_id = str(event.id)
        if event_id in seen or event.sku not in known:
            continue
        seen.add(event_id)
        recent.append(event_id)
        signal = signals.setdefault(event.sku, {"active_ms": 0, "opens": 0, "last_seen": now})
        if event.kind == "dwell":
            signal["active_ms"] = min(86400000, signal["active_ms"] + event.active_ms)
        else:
            signal["opens"] = min(10000, signal["opens"] + 1)
        signal["last_seen"] = now
    row.signals = signals
    row.recent_events = recent[-1000:]
    row.updated_at = dt.datetime.now(dt.timezone.utc)
    session.commit()
    return signals
