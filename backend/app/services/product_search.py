"""商品文字搜尋：索引只保存型錄文字，結果仍以目前的正式商品主檔為準。"""

import copy
import json
import logging
import re
import time
import uuid

import httpx
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Product
from app.services import outlet_search
from app.services.product_catalog import visible_catalog_products

log = logging.getLogger(__name__)
_paused_until = 0.0


def _index():
    name = settings().elasticsearch_product_index
    if not re.fullmatch(r"[a-z][a-z0-9_-]{0,60}", name) or name == settings().elasticsearch_index:
        raise ValueError("商品搜尋索引名稱無效或與客戶索引相同")
    return name


INDEX_SETTINGS = copy.deepcopy(outlet_search.INDEX_SETTINGS)
analysis = INDEX_SETTINGS["settings"]["analysis"]
analysis["tokenizer"]["product_fuzzy_grams"] = {
    "type": "ngram", "min_gram": 3, "max_gram": 20, "token_chars": ["letter", "digit"],
}
analysis["analyzer"]["product_fuzzy_text"] = {
    "type": "custom", "tokenizer": "product_fuzzy_grams", "filter": ["lowercase"],
}
properties = INDEX_SETTINGS["mappings"]["properties"]
del properties["customer_id"]
properties["sku"] = {"type": "keyword"}
properties["name"]["fields"]["parts"] = {
    "type": "text", "analyzer": "product_fuzzy_text", "search_analyzer": "keyword",
}
properties["aliases"] = copy.deepcopy(properties["name"])


def search_skus(query: str) -> list[str] | None:
    """None 表示服務未設定或暫時失敗；空清單表示索引沒有命中。"""
    global _paused_until
    if not settings().elasticsearch_url or time.monotonic() < _paused_until:
        return None
    terms = [outlet_search.normalize(term) for term in query.split()]
    terms = [term for term in terms if term]
    if not terms:
        return []
    required = []
    for term in terms:
        clauses = [
            {"term": {"sku": {"value": term, "boost": 40}}},
            {"term": {"name.raw": {"value": term, "boost": 20}}},
            {"term": {"aliases.raw": {"value": term, "boost": 12}}},
            {"match": {"search_text": {"query": term, "boost": 4}}},
        ]
        # 錯字比對涵蓋長品名的局部片段；含數字的劑量／料號維持文字相符。
        if len(term) >= 3 and not any(character.isdigit() for character in term):
            clauses.extend({"match": {field: {"query": term, "fuzziness": "AUTO:3,6",
                "max_expansions": 30, "boost": 2}}} for field in ("name", "aliases", "name.parts", "aliases.parts"))
        required.append({"bool": {"should": clauses, "minimum_should_match": 1}})
    try:
        with outlet_search._client() as client:
            body = {"size": 1000, "_source": False, "query": {"bool": {"must": required}},
                "sort": [{"_score": "desc"}, {"sku": "asc"}]}
            matches = []
            while True:
                result = client.post(f"/{_index()}/_search", json=body)
                result.raise_for_status()
                hits = result.json()["hits"]["hits"]
                matches.extend(hit["_id"] for hit in hits)
                if len(hits) < body["size"]:
                    return matches
                body["search_after"] = hits[-1]["sort"]
    except (httpx.HTTPError, KeyError, ValueError, TypeError):
        _paused_until = time.monotonic() + 10
        log.warning("商品搜尋索引暫時無法使用，改走型錄文字搜尋")
        return None


def catalog_rows(session: Session):
    return session.execute(select(Product.sku, Product.name, Product.category, Product.spec, Product.aliases)
        .where(visible_catalog_products()).order_by(Product.sku)).all()


def matching_skus(session: Session, query: str, category: str | None = None) -> list[str]:
    indexed = search_skus(query)
    terms = [outlet_search.normalize(term) for term in query.split()]
    keyword = outlet_search.normalize(query)
    exact, current, allowed = [], [], set()
    for row in catalog_rows(session):
        if category and row.category != category:
            continue
        allowed.add(row.sku)
        names = [outlet_search.normalize(value) for value in (row.sku, row.name, *row.aliases)]
        searchable = outlet_search.normalize(" ".join((row.sku, row.name, row.category, row.spec, *row.aliases)))
        if all(term in searchable for term in terms):
            current.append(row.sku)
            if keyword in names:
                exact.append(row.sku)
    # 即時讀主檔，讓尚未同步的新商品可查，也排除舊索引殘留的已隱藏或已刪除品項。
    return list(dict.fromkeys(sku for sku in [*exact, *(indexed or []), *current] if sku in allowed))


def index_is_healthy(expected_count: int) -> bool:
    return outlet_search.index_is_healthy(expected_count, alias=_index())


def rebuild(session: Session) -> int:
    """核對新索引筆數後才切換 alias；重建失敗時繼續使用舊索引。"""
    if not settings().elasticsearch_url:
        raise RuntimeError("尚未設定 ELASTICSEARCH_URL")
    session.execute(text("SELECT pg_advisory_xact_lock(hashtext('meddemo-product-search-rebuild'))"))
    alias = _index()
    target = f"{alias}-v1-{uuid.uuid4().hex}"
    rows = catalog_rows(session)
    with outlet_search._client() as client:
        old = client.get(f"/_alias/{alias}")
        if old.status_code not in (200, 404):
            old.raise_for_status()
        old_indexes = list(old.json()) if old.status_code == 200 else []
        client.put(f"/{target}", json=INDEX_SETTINGS).raise_for_status()
        switched = False
        try:
            for offset in range(0, len(rows), 300):
                batch = []
                for row in rows[offset:offset + 300]:
                    batch.append(json.dumps({"index": {"_index": target, "_id": row.sku}}))
                    batch.append(json.dumps({"sku": outlet_search.normalize(row.sku),
                        "name": outlet_search.normalize(row.name),
                        "aliases": [outlet_search.normalize(value) for value in row.aliases],
                        "search_text": outlet_search.normalize(" ".join((row.sku, row.name, row.category, row.spec, *row.aliases)))},
                        ensure_ascii=False))
                result = client.post("/_bulk", content="\n".join(batch) + "\n", headers={"content-type": "application/x-ndjson"})
                result.raise_for_status()
                if result.json().get("errors"):
                    raise RuntimeError("部分商品搜尋紀錄建立失敗，保留舊索引")
            client.post(f"/{target}/_refresh").raise_for_status()
            count = client.get(f"/{target}/_count")
            count.raise_for_status()
            if count.json()["count"] != len(rows):
                raise RuntimeError("商品搜尋索引筆數不符，保留舊索引")
            actions = [{"remove": {"index": index, "alias": alias}} for index in old_indexes]
            actions.append({"add": {"index": target, "alias": alias}})
            client.post("/_aliases", json={"actions": actions}).raise_for_status()
            switched = True
        finally:
            if not switched:
                client.delete(f"/{target}")
        for old_index in old_indexes:
            if re.fullmatch(re.escape(alias) + r"-v1-[0-9a-f]{32}", old_index):
                client.delete(f"/{old_index}").raise_for_status()
    global _paused_until
    _paused_until = 0.0
    log.info("已同步 %s 筆商品搜尋索引", len(rows))
    return len(rows)
