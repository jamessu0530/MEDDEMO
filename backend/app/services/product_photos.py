"""已核對的本機型錄照片增量入庫，不下載圖片、不改商品資料。"""

from __future__ import annotations

import datetime as dt
import hashlib
from io import BytesIO
import json
from pathlib import Path
from urllib.parse import quote, urlsplit

from PIL import Image
from sqlalchemy import func, inspect, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.engine import Connection

from app.models import Product, ProductPhoto

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_INVENTORY = ROOT / "data/seed/product-photo-sources-verified-20261017.json"
MANIFEST = ROOT / "frontend/src/data/product-photos.json"
PUBLIC_DIR = ROOT / "frontend/public"
if not MANIFEST.is_file():
    MANIFEST = ROOT / "data/seed/product-photo-manifest.json"
    PUBLIC_DIR = ROOT / "data/seed"


def read_reviewed_photos(inventory: Path = DEFAULT_INVENTORY, *, manifest_path: Path = MANIFEST,
                         public_dir: Path = PUBLIC_DIR) -> list[dict]:
    manifest = json.loads(manifest_path.read_text())
    records, seen = [], set()
    for source in json.loads(inventory.read_text()):
        for review in source.get("reviewedProducts", []):
            sku = review["sku"]
            if sku in seen:
                raise ValueError(f"核對清單重複料號：{sku}")
            seen.add(sku)
            mapping = manifest["products"].get(sku)
            photo = manifest["sources"].get(mapping["source"]) if mapping else None
            if not photo or any(photo[key] != source[key] for key in ("title", "pageUrl", "imageUrl")):
                raise ValueError(f"照片來源與型錄不符：{sku}")
            if mapping["kind"] != review["kind"] or mapping.get("note") != review["note"]:
                raise ValueError(f"照片核對標記與型錄不符：{sku}")
            if review["kind"] not in ("exact", "series", "illustrative"):
                raise ValueError(f"照片未經核對：{sku}")
            if review["kind"] == "illustrative" and (
                review.get("demo") is not True or not review["note"].startswith("Demo參考照：")
            ):
                raise ValueError(f"示意照片缺少Demo標記或差異說明：{sku}")
            for key in ("pageUrl", "imageUrl"):
                url = urlsplit(source[key])
                if url.scheme != "https" or not url.netloc:
                    raise ValueError(f"照片來源不是HTTPS網址：{sku}")
            path = (public_dir / photo["file"].lstrip("/")).resolve()
            if not path.is_relative_to((public_dir / "product-photos").resolve()):
                raise ValueError(f"照片不在型錄目錄：{sku}")
            content = path.read_bytes()
            if len(content) > 2 * 1024 * 1024:
                raise ValueError(f"型錄照片超過2MB：{sku}")
            with Image.open(BytesIO(content)) as image:
                if image.format != "WEBP" or min(image.size) < 45 or max(image.size) > 480:
                    raise ValueError(f"型錄照片格式或尺寸不符：{sku}")
                image.verify()
            records.append({
                "sku": sku, "catalog_name": review["name"], "category": review["category"],
                "source_id": mapping["source"], "title": photo["title"], "page_url": photo["pageUrl"],
                "image_url": photo["imageUrl"], "kind": review["kind"], "note": review["note"],
                "retrieved_on": dt.date.fromisoformat(source["retrievedOn"]),
                "sha256": hashlib.sha256(content).hexdigest(), "content": content,
            })
    if not records:
        raise ValueError("沒有已核對的照片可匯入")
    return records


def ensure_photo_table(connection: Connection) -> None:
    ProductPhoto.__table__.create(connection, checkfirst=True)
    checks = inspect(connection).get_check_constraints("product_photo")
    kind_check = next((row for row in checks if row["name"] == "ck_product_photo_kind"), None)
    if kind_check and "illustrative" not in kind_check["sqltext"]:
        connection.exec_driver_sql("ALTER TABLE product_photo DROP CONSTRAINT ck_product_photo_kind")
        connection.exec_driver_sql("ALTER TABLE product_photo ADD CONSTRAINT ck_product_photo_kind CHECK (kind IN ('exact','series','illustrative'))")


def import_reviewed_photos(connection: Connection, records: list[dict]) -> dict:
    """呼叫端使用單一交易；任一料號或品名不符，整批停止。"""
    connection.execute(text("SELECT pg_advisory_xact_lock(hashtext('meddemo-product-photos'))"))
    skus = [row["sku"] for row in records]
    if not records or len(set(skus)) != len(skus):
        raise ValueError("照片清單為空或包含重複料號")
    products = {row.sku: row for row in connection.execute(
        select(Product.sku, Product.name, Product.category).where(Product.sku.in_(skus))
    )}
    for record in records:
        product = products.get(record["sku"])
        if not product or (product.name, product.category) != (record["catalog_name"], record["category"]):
            raise ValueError(f"資料庫料號、品名或類別不符，停止匯入：{record['sku']}")
    ensure_photo_table(connection)
    columns = [column for column in ProductPhoto.__table__.c if column.name not in ("content", "updated_at")]
    existing = {row["sku"]: dict(row) for row in connection.execute(
        select(*columns).where(ProductPhoto.sku.in_(skus))
    ).mappings()}
    result = {"inserted": 0, "updated": 0, "unchanged": 0, "skus": sorted(skus)}
    for record in records:
        values = {key: value for key, value in record.items() if key != "category"}
        metadata = {key: value for key, value in values.items() if key != "content"}
        previous = existing.get(record["sku"])
        if previous == metadata:
            result["unchanged"] += 1
            continue
        statement = insert(ProductPhoto).values(**values)
        connection.execute(statement.on_conflict_do_update(
            index_elements=[ProductPhoto.sku],
            set_={**{key: value for key, value in values.items() if key != "sku"}, "updated_at": func.now()},
        ))
        result["updated" if previous else "inserted"] += 1
    return result


def photo_metadata(row) -> dict:
    return {
        "src": f"/api/products/{quote(row.sku, safe='')}/photo/{row.sha256}.webp",
        "title": row.title, "sourceUrl": row.page_url, "kind": row.kind, "note": row.note,
    }
