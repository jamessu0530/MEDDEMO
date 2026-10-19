"""公開通路與客戶搜尋：PostgreSQL 為主檔，Elasticsearch 僅存搜尋欄位。"""

import json
import logging
import re
import time
import unicodedata
import uuid
from functools import cache
from urllib.parse import urlsplit

import httpx
from opencc import OpenCC
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Customer, PublicOutlet

log = logging.getLogger(__name__)
_paused_until = 0.0


@cache
def _converter():
    return OpenCC("s2t")


def normalize(value: str) -> str:
    value = _converter().convert(unicodedata.normalize("NFKC", value)).lower().replace("臺", "台")
    return re.sub(r"\s+", "", value)


def _index():
    name = settings().elasticsearch_index
    if not re.fullmatch(r"[a-z][a-z0-9_-]{0,60}", name):
        raise ValueError("Elasticsearch 索引名稱無效")
    return name


def _client():
    config = settings()
    url = urlsplit(config.elasticsearch_url)
    allowed = {("127.0.0.1", 19201), ("localhost", 19201), ("elasticsearch", 9200),
        ("elasticsearch.meddemo.svc.cluster.local", 9200)}
    if (url.scheme != "http" or (url.hostname, url.port) not in allowed
        or url.username or url.password or url.path not in ("", "/") or url.query or url.fragment):
        raise ValueError("搜尋服務僅允許本機或 MEDDEMO 內網 Elasticsearch")
    auth = (config.elasticsearch_username, config.elasticsearch_password) if config.elasticsearch_password else None
    return httpx.Client(base_url=config.elasticsearch_url.rstrip("/"), auth=auth, timeout=5.0,
        trust_env=False, follow_redirects=False)


def search_ids(query: str) -> list[str] | None:
    """None 代表未設定或暫停，空清單代表索引沒有符合項目。索引不回傳客戶內容。"""
    global _paused_until
    if not settings().elasticsearch_url or time.monotonic() < _paused_until:
        return None
    keyword = normalize(query)
    if not keyword:
        return []
    clauses = [{"term": {"name.raw": {"value": keyword, "boost": 20}}},
        {"match": {"search_text": {"query": keyword, "boost": 4}}}, {"term": {"customer_id": keyword}}]
    if len(keyword) >= 3:
        clauses.append({"match": {"name": {"query": keyword, "fuzziness": "AUTO:3,6", "max_expansions": 30, "boost": 2}}})
    try:
        with _client() as client:
            result = client.post(f"/{_index()}/_search", json={"size": 10000, "_source": False,
                "query": {"bool": {"should": clauses, "minimum_should_match": 1}},
                "sort": [{"_score": "desc"}, {"customer_id": "asc"}]})
            result.raise_for_status()
            return [hit["_id"] for hit in result.json()["hits"]["hits"]]
    except (httpx.HTTPError, KeyError, ValueError, TypeError):
        _paused_until = time.monotonic() + 10
        log.warning("客戶搜尋索引暫時無法使用，改走資料庫關鍵字搜尋")
        return None


def index_is_healthy(expected_count: int, *, alias: str | None = None) -> bool:
    """部署略過重建前，確認 alias 存在、分片可用且筆數與資料庫一致。"""
    try:
        with _client() as client:
            alias = alias or _index()
            health = client.get(f"/_cluster/health/{alias}", params={"timeout": "1s"})
            health.raise_for_status()
            status = health.json()
            if not isinstance(status, dict) or status.get("timed_out") or status.get("status") not in ("green", "yellow"):
                return False
            count = client.get(f"/{alias}/_count")
            count.raise_for_status()
            return count.json()["count"] == expected_count
    except (httpx.HTTPError, KeyError, TypeError, ValueError):
        return False


def customer_matches(session: Session, query: str) -> list[str]:
    """只產生候選 ID；API 從資料庫載入內容並沿用當下的授權規則。"""
    matches = search_ids(query)
    keyword = normalize(query)
    pattern = "%" + keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    name = func.replace(func.lower(func.regexp_replace(Customer.name, r"\s+", "", "g")), "臺", "台")
    searchable = func.replace(func.lower(func.concat(Customer.city, Customer.area, PublicOutlet.address, PublicOutlet.phone)), "臺", "台")
    # 索引同步間隔內剛新增的資料，也能用文字相符方式查到。
    current = list(session.scalars(select(Customer.id).outerjoin(PublicOutlet, PublicOutlet.customer_id == Customer.id)
        .where(or_(name.ilike(pattern, escape="\\"), searchable.ilike(pattern, escape="\\"), Customer.id.ilike(pattern, escape="\\")))))
    return list(dict.fromkeys([*(matches or []), *current]))


INDEX_SETTINGS = {"settings": {"number_of_shards": 1, "number_of_replicas": 0, "index.max_ngram_diff": 19,
    "analysis": {"tokenizer": {"directory_grams": {"type": "ngram", "min_gram": 1, "max_gram": 20,
        "token_chars": ["letter", "digit"]}},
        "analyzer": {"directory_text": {"type": "custom", "tokenizer": "directory_grams", "filter": ["lowercase"]}}}},
    "mappings": {"dynamic": "strict", "properties": {"customer_id": {"type": "keyword"},
        "name": {"type": "text", "analyzer": "keyword", "fields": {"raw": {"type": "keyword"}}},
        "search_text": {"type": "text", "analyzer": "directory_text", "search_analyzer": "keyword"}}}}


def rebuild(session: Session) -> int:
    """新索引驗證完成後才切換 alias；失敗保留舊索引，資料庫不受影響。"""
    if not settings().elasticsearch_url:
        raise RuntimeError("尚未設定 ELASTICSEARCH_URL")
    session.execute(text("SELECT pg_advisory_xact_lock(hashtext('meddemo-customer-search-rebuild'))"))
    alias = _index()
    target = f"{alias}-v1-{uuid.uuid4().hex}"
    rows = session.execute(select(Customer.id, Customer.name, Customer.city, Customer.area, PublicOutlet.address, PublicOutlet.phone)
        .outerjoin(PublicOutlet, PublicOutlet.customer_id == Customer.id).order_by(Customer.id)).all()
    with _client() as client:
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
                    batch.append(json.dumps({"index": {"_index": target, "_id": row.id}}))
                    batch.append(json.dumps({"customer_id": row.id.lower(), "name": normalize(row.name),
                        "search_text": normalize(" ".join(str(x or "") for x in (row.name, row.city, row.area, row.address, row.phone)))}, ensure_ascii=False))
                result = client.post("/_bulk", content="\n".join(batch) + "\n", headers={"content-type": "application/x-ndjson"})
                result.raise_for_status()
                if result.json().get("errors"):
                    raise RuntimeError("部分搜尋紀錄建立失敗，保留舊索引")
            client.post(f"/{target}/_refresh").raise_for_status()
            count = client.get(f"/{target}/_count")
            count.raise_for_status()
            if count.json()["count"] != len(rows):
                raise RuntimeError("搜尋索引筆數不符，保留舊索引")
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
    log.info("已同步 %s 筆客戶搜尋索引", len(rows))
    return len(rows)
