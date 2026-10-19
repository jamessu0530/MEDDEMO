"""部署用的內容版本檢查；版本只隨成功交易寫入，不新增資料表。"""

import hashlib
import json
from pathlib import Path

from sqlalchemy import func, inspect, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AppSetting, Customer, OutletStorefront, Product, ProductPhoto, PublicOutlet
from app.services import outlet_search, product_photos, product_search, public_outlets, storefront_photos
from app.services.product_catalog import visible_catalog_products

ROOT = Path(__file__).resolve().parents[3]
BACKEND = ROOT / "backend"
SERVICES = Path(__file__).parent
PREFIX = "deployment_sync:"


def fingerprint(paths, extra="") -> str:
    digest = hashlib.sha256(extra.encode())
    for path in paths:
        path = Path(path)
        # 路徑名稱與長度避免不同檔案串接後恰好得到相同內容；不含主機絕對路徑。
        exists = path.is_file()
        content = path.read_bytes() if exists else b""
        digest.update(path.name.encode() + b"\0" + bytes([exists]) + len(content).to_bytes(8, "big") + content)
    return digest.hexdigest()


def stored_version(session: Session, name: str):
    return session.scalar(select(AppSetting.value).where(AppSetting.key == PREFIX + name))


def remember_version(session: Session, name: str, version: str):
    statement = insert(AppSetting).values(key=PREFIX + name, value=version)
    session.execute(statement.on_conflict_do_update(index_elements=[AppSetting.key], set_={"value": version}))


def outlets_ready(session: Session, source: dict, photos: dict) -> bool:
    # 匯入會保留既有來源列與客戶編輯；新快照的來源雜湊不必覆蓋舊列。
    ids = [public_outlets.source_id(row) for row in source["records"]]
    count = session.scalar(select(func.count()).select_from(PublicOutlet).join(Customer)
        .where(PublicOutlet.customer_id.in_(ids)))
    if count != len(ids):
        return False
    ids = [row["customer_id"] for row in photos["records"]]
    return session.scalar(select(func.count()).select_from(OutletStorefront)
        .where(OutletStorefront.outlet_id.in_(ids))) == len(ids)


def photos_ready(session: Session, records: list[dict]) -> bool:
    if not inspect(session.connection()).has_table("product_photo"):
        return False
    expected = {row["sku"]: (row["sha256"], row["catalog_name"], row["category"]) for row in records}
    rows = session.execute(select(ProductPhoto.sku, ProductPhoto.sha256, Product.name, Product.category)
        .join(Product, Product.sku == ProductPhoto.sku).where(ProductPhoto.sku.in_(expected)))
    return {row.sku: (row.sha256, row.name, row.category) for row in rows} == expected


def sync(session: Session, *, force=False) -> dict:
    common = [Path(__file__), BACKEND / "app/models.py", BACKEND / "uv.lock"]
    schema = session.scalar(select(AppSetting.value).where(AppSetting.key == "schema_version")) or ""
    geography = ROOT / "frontend/src/data/taiwan-districts.json"
    if not geography.is_file():
        geography = ROOT / "data/seed/taiwan-districts.json"
    source = json.loads(public_outlets.SOURCE_FILE.read_text())
    storefronts = json.loads(storefront_photos.PHOTO_SOURCE.read_text())
    outlet_version = fingerprint([
        *common, public_outlets.SOURCE_FILE, storefront_photos.PHOTO_SOURCE,
        storefront_photos.GOOGLE_SOURCE, geography,
        *(SERVICES / name for name in (
            "public_outlets.py", "storefront_photos.py", "channel_geography.py", "channels.py", "outlet_search.py",
        )),
    ], schema)
    result = {}
    session.execute(text("SELECT pg_advisory_xact_lock(hashtext('meddemo-deployment-data-sync'))"))
    imported_outlets = force or stored_version(session, "outlets") != outlet_version or not outlets_ready(session, source, storefronts)
    if imported_outlets:
        details = public_outlets.import_snapshot(session)
        details["storefront_photos"] = storefront_photos.import_catalog(session.connection())
        remember_version(session, "outlets", outlet_version)
        session.commit()
        result["outlets"] = {"status": "imported", **details}
    else:
        result["outlets"] = {"status": "unchanged"}
        session.commit()

    records = product_photos.read_reviewed_photos()
    photo_version = fingerprint([
        *common, SERVICES / "product_photos.py", product_photos.DEFAULT_INVENTORY, product_photos.MANIFEST,
    ], schema + json.dumps([row["sha256"] for row in records]))
    session.execute(text("SELECT pg_advisory_xact_lock(hashtext('meddemo-deployment-data-sync'))"))
    if force or stored_version(session, "photos") != photo_version or not photos_ready(session, records):
        details = product_photos.import_reviewed_photos(session.connection(), records)
        remember_version(session, "photos", photo_version)
        session.commit()
        result["photos"] = {"status": "imported", **details}
    else:
        result["photos"] = {"status": "unchanged"}
        session.commit()

    config = settings()
    index_version = fingerprint([*common, SERVICES / "outlet_search.py"],
        schema + outlet_version + json.dumps([config.elasticsearch_url, config.elasticsearch_index]))
    # 與每 15 分鐘的 CronJob 共用重建鎖，避免在另一輪切換 alias 的中途判斷完整性。
    session.execute(text("SELECT pg_advisory_xact_lock(hashtext('meddemo-customer-search-rebuild'))"))
    count = session.scalar(select(func.count()).select_from(Customer))
    if (force or imported_outlets or stored_version(session, "search") != index_version
            or not outlet_search.index_is_healthy(count)):
        count = outlet_search.rebuild(session)
        sample = session.scalar(select(Customer.id).join(PublicOutlet)
            .where(Customer.name == "合康藥局", PublicOutlet.phone == "0224555173"))
        if sample and any(sample not in (outlet_search.search_ids(query) or []) for query in ("合康藥句", "0224555173")):
            raise RuntimeError("中文錯字或電話搜尋實測未通過")
        remember_version(session, "search", index_version)
        result["search"] = {"status": "rebuilt", "indexed_customers": count}
    else:
        result["search"] = {"status": "unchanged", "indexed_customers": count}
    session.commit()
    product_version = fingerprint([
        *common, SERVICES / "product_search.py", SERVICES / "product_catalog.py", SERVICES / "outlet_search.py",
    ], schema + json.dumps([config.elasticsearch_url, config.elasticsearch_product_index]))
    session.execute(text("SELECT pg_advisory_xact_lock(hashtext('meddemo-product-search-rebuild'))"))
    count = session.scalar(select(func.count()).select_from(Product).where(visible_catalog_products()))
    if (force or stored_version(session, "product_search") != product_version
            or not product_search.index_is_healthy(count)):
        count = product_search.rebuild(session)
        remember_version(session, "product_search", product_version)
        result["product_search"] = {"status": "rebuilt", "indexed_products": count}
    else:
        result["product_search"] = {"status": "unchanged", "indexed_products": count}
    session.commit()
    return result
