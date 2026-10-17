"""用外觀描述搜尋型錄照片；圖片向量預先建立，品名永遠由目前型錄的 SKU 取得。"""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import re
from functools import lru_cache
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import NotConfigured, settings
from app.embeddings import DEFAULT_GEMINI_EMBEDDING_MODEL, Embedder
from app.models import Product
from app.services.product_catalog import visible_catalog_products

ROOT = Path(__file__).resolve().parents[3]
INDEX_PATH = ROOT / "data/seed/product-appearance-index.json.gz"
MANIFEST_PATH = ROOT / "frontend/src/data/product-photos.json"
if not MANIFEST_PATH.is_file():
    MANIFEST_PATH = ROOT / "data/seed/product-photo-manifest.json"
DRUG_CATEGORIES = ("一般用藥", "慢性處方")
INDEX_VERSION = 1


class AppearanceUnavailable(RuntimeError):
    pass


def embedding_model() -> str:
    return settings().embedding_model or DEFAULT_GEMINI_EMBEDDING_MODEL


def manifest_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unit_vector(values) -> list[float]:
    vector = [float(value) for value in values]
    if not vector or not all(math.isfinite(value) for value in vector):
        raise ValueError("照片向量格式不正確")
    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        raise ValueError("照片向量不能是零向量")
    return [value / norm for value in vector]


@lru_cache(maxsize=2)
def _load_index(path: str, modified: int, size: int) -> dict:
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        data = json.load(stream)
    if data.get("version") != INDEX_VERSION or not data.get("complete"):
        raise AppearanceUnavailable("商品照片索引尚未完成，請稍後再試")
    sources = {}
    dimension = None
    for key, source in data["sources"].items():
        vector = unit_vector(source["vector"])
        dimension = dimension or len(vector)
        if len(vector) != dimension:
            raise ValueError("照片向量維度不一致")
        sources[key] = {**source, "vector": vector}
    return {**data, "sources": sources, "dimension": dimension}


def load_index(path: Path | None = None, manifest_path: Path | None = None) -> tuple[dict, dict]:
    path, manifest_path = path or INDEX_PATH, manifest_path or MANIFEST_PATH
    try:
        stat = path.stat()
        data = _load_index(str(path), stat.st_mtime_ns, stat.st_size)
        if data["model"] != embedding_model() or data["manifest_sha256"] != manifest_digest(manifest_path):
            raise AppearanceUnavailable("商品照片索引需要更新，請稍後再試")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        return data, manifest
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise AppearanceUnavailable("商品照片搜尋尚未準備好，請稍後再試") from exc


def rank_photos(data: dict, vector: list[float], source_ids: set[str]) -> list[tuple[str, float]]:
    query = unit_vector(vector)
    if len(query) != data["dimension"]:
        raise AppearanceUnavailable("商品照片索引需要更新，請稍後再試")
    scores = [
        (key, sum(a * b for a, b in zip(query, source["vector"], strict=True)))
        for key, source in data["sources"].items() if key in source_ids
    ]
    return sorted(scores, key=lambda item: (-item[1], item[0]))


def search_photos(session: Session, embedder: Embedder | None, query: str, *, drugs_only: bool = True, limit: int = 8) -> list[dict]:
    data, manifest = load_index()
    if embedder is None:
        raise NotConfigured("外觀搜尋尚未設定，請稍後再試")
    statement = select(Product).where(visible_catalog_products())
    if drugs_only:
        statement = statement.where(Product.category.in_(DRUG_CATEGORIES))
    products: dict[str, list[dict]] = {}
    for product in session.scalars(statement.order_by(Product.sku)):
        mapping = manifest["products"].get(product.sku)
        if not product.name.strip() or not mapping or mapping["kind"] not in ("exact", "series"):
            continue
        source_id = mapping["source"]
        if source_id not in data["sources"] or source_id not in manifest["sources"]:
            continue
        products.setdefault(source_id, []).append({
            "sku": product.sku, "name": product.name, "category": product.category,
            "spec": product.spec, "unit": product.unit, "kind": mapping["kind"], "note": mapping.get("note"),
        })
    if not products:
        return []
    vector = embedder.embed_query(query)
    ranked = rank_photos(data, vector, set(products))
    return [
        {"source_id": key, "photo": manifest["sources"][key], "products": products[key]}
        for key, _ in ranked[:limit]
    ]


def is_appearance_question(question: str) -> bool:
    """只攔明確在找外觀的型錄問題；保留銷售數字、頻道照片、用藥問題原本的路徑。"""
    if re.search(r"副作用|怎麼吃|如何吃|能吃|可以吃|能不能吃|劑量|服用|過敏|中毒|吃了|吃完|症狀|治療|療效|作用|懷孕|孕婦|兒童|銷售|業績|營收|退貨|頻道|同事|誰.*(?:說|傳|貼)", question):
        return False
    appearance = re.search(r"[黃黄紅红藍蓝綠绿白黑紫橘粉棕咖啡](?:[黃黄紅红藍蓝綠绿白黑紫橘粉棕咖啡]|色)|圓圓|圓形|橢圓|長條|外觀|包裝.*(?:顏色|長相)", question)
    target = re.search(r"藥|商品|產品|品名|料號", question)
    return bool(appearance and target)


def appearance_answer(hits: list[dict]) -> str:
    if not hits:
        return "目前有照片的型錄裡沒有找到候選商品。可以補充盒子或藥錠、形狀、包裝文字，或改用品名搜尋。"
    examples = []
    for index, hit in enumerate(hits[:3], 1):
        names = "、".join(f"{product['name']}（{product['sku']}）" for product in hit["products"][:3])
        extra = f"，另有 {len(hit['products']) - 3} 個同系列料號" if len(hit["products"]) > 3 else ""
        examples.append(f"{index}. {names}{extra}")
    return "找到以下外觀相近的候選商品：\n" + "\n".join(examples) + "\n請比對照片、品名與料號。同系列照片可能由不同包裝數量的料號共用；僅憑顏色無法確認是哪一項。"
