"""正式商品清單：商品頁與確認頁共用，排除舊版示範品項。"""

import datetime as dt
import logging
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, undefer

from app.db import get_session
from app.api.auth import CurrentUser
from app.config import NotConfigured
from app.embeddings import optional_embedder
from app.models import Product, ProductBrowseProfile, ProductPhoto, ProductQueryEvent
from app.services import product_appearance, product_photos, product_search
from app.services.product_catalog import visible_catalog_products

router = APIRouter(prefix="/api/products", tags=["products"])
log = logging.getLogger(__name__)


class PhotoItem(BaseModel):
    src: str
    title: str
    sourceUrl: str
    kind: Literal["exact", "series", "illustrative"]
    note: str


class ProductItem(BaseModel):
    sku: str
    name: str
    category: str
    spec: str
    unit: str
    aliases: list[str]
    common: bool
    photo: PhotoItem | None = None


@router.get("", response_model=list[ProductItem])
def list_products(session: Annotated[Session, Depends(get_session)]):
    rows = session.execute(
        select(Product, ProductPhoto).outerjoin(ProductPhoto, and_(
            ProductPhoto.sku == Product.sku, ProductPhoto.catalog_name == Product.name,
        ))
        .where(visible_catalog_products()).order_by(Product.sku)
    )
    return [ProductItem(
        **{key: getattr(product, key) for key in ("sku", "name", "category", "spec", "unit", "aliases", "common")},
        photo=product_photos.photo_metadata(photo) if photo else None,
    ) for product, photo in rows]


@router.get("/search")
def search_products(session: Annotated[Session, Depends(get_session)], user: CurrentUser,
                    q: str = Query(min_length=1, max_length=200), category: str | None = None):
    query = q.strip()
    if not query:
        raise HTTPException(422, "請輸入商品名稱、料號或規格")
    return {"skus": product_search.matching_skus(session, query, category)}


@router.get("/{sku}/photo/{version}.webp")
def get_product_photo(sku: str, version: str, session: Annotated[Session, Depends(get_session)]):
    photo = session.scalar(
        select(ProductPhoto).join(Product, Product.sku == ProductPhoto.sku)
        .where(ProductPhoto.sku == sku, ProductPhoto.sha256 == version,
               ProductPhoto.catalog_name == Product.name, visible_catalog_products())
        .options(undefer(ProductPhoto.content))
    )
    if photo is None:
        raise HTTPException(404, "找不到這張商品照片")
    return Response(photo.content, media_type="image/webp", headers={
        "Cache-Control": "public, max-age=31536000, immutable", "ETag": f'"{photo.sha256}"',
        "X-Content-Type-Options": "nosniff",
    })


class AppearanceSearch(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    drugs_only: bool = True


@router.post("/appearance-search")
def appearance_search(body: AppearanceSearch, session: Annotated[Session, Depends(get_session)], user: CurrentUser):
    query = body.query.strip()
    if not query:
        raise HTTPException(422, "請描述商品的顏色、形狀或包裝")
    try:
        hits = product_appearance.search_photos(session, optional_embedder(), query, drugs_only=body.drugs_only)
    except (NotConfigured, product_appearance.AppearanceUnavailable) as exc:
        raise HTTPException(503, str(exc)) from None
    except Exception:
        log.exception("商品外觀搜尋失敗")
        raise HTTPException(503, "外觀搜尋暫時無法使用，請稍後重試") from None
    return {"matches": hits, "message": product_appearance.appearance_answer(hits)}


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
        if event.kind == "detail":
            # 與個人偏好一起提交；網路重送或超過 recent_events 的舊事件仍只計一次。
            recorded = session.scalar(insert(ProductQueryEvent).values(id=event_id, sku=event.sku)
                .on_conflict_do_nothing(index_elements=[ProductQueryEvent.id]).returning(ProductQueryEvent.id))
            if recorded is None:
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
