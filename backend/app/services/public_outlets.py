"""公開通路匯入：以來源內容建立穩定 ID，重跑不重複，不覆蓋既有客戶編輯。"""

import datetime as dt
import hashlib
import json
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import Customer, OrgUnit, Place, PublicOutlet
from app.services.outlet_search import normalize

SOURCE_FILE = Path(__file__).resolve().parents[3] / "data" / "public-outlets" / "cenra-20261016.json"
# 原始碼在 backend/app/services；容器的資料位於 /srv/data。
if not SOURCE_FILE.exists():
    SOURCE_FILE = Path(__file__).resolve().parents[4] / "data" / "public-outlets" / "cenra-20261016.json"


def source_id(record: dict) -> str:
    identity = {k: record[k] for k in ("name", "Address", "tel", "city", "district", "lat", "lng")}
    identity["name"] = normalize(identity["name"])
    identity["Address"] = normalize(identity["Address"])
    return "OUT-" + hashlib.sha256(json.dumps(identity, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:28]


def region(city: str) -> str:
    if city in {"基隆市", "臺北市", "新北市", "桃園市", "新竹市", "新竹縣", "苗栗縣", "宜蘭縣"}:
        return "北區"
    if city in {"臺中市", "彰化縣", "南投縣", "雲林縣"}:
        return "中區"
    if city in {"嘉義市", "嘉義縣", "臺南市", "高雄市", "屏東縣"}:
        return "南區"
    return "東區" if city in {"花蓮縣", "臺東縣"} else "離島" if city in {"澎湖縣", "金門縣", "連江縣"} else "待核對"


def import_snapshot(session: Session, path: Path = SOURCE_FILE) -> dict[str, int]:
    data = json.loads(path.read_text(encoding="utf-8"))
    meta, rows = data["summary"], data["records"]
    if len(rows) != meta["unique_count"] or len({source_id(row) for row in rows}) != len(rows):
        raise ValueError("通路名單筆數或來源識別碼不符，取消匯入")
    if sum(row["duplicate_count"] for row in rows) != meta["raw_count"]:
        raise ValueError("來源總筆數不符，取消匯入")
    if not session.get(OrgUnit, "TW"):
        raise ValueError("請先初始化系統資料，再匯入公開通路")
    session.execute(text("SELECT pg_advisory_xact_lock(hashtext('meddemo-public-outlets-import'))"))
    existing = set(session.scalars(select(PublicOutlet.customer_id)))
    places, customers, sources = {}, [], []
    for row in rows:
        key = source_id(row)
        city = row["city_normalized"] if "縣市待核對" not in row["issues"] else "待核對"
        district = row["district"]
        place_id = "OUTPLACE-" + hashlib.sha256(f"{city}|{district}".encode()).hexdigest()[:20]
        places[place_id] = {"id": place_id, "name": f"{city}{district}", "unit_id": "TW"}
        customers.append({"id": key, "name": row["name"].strip(), "type": "outlet", "chain_group": None,
            "region": region(city), "city": city, "place_id": place_id, "area": district,
            "lat": row["lat"], "lng": row["lng"], "grade": None, "owner_user_id": None,
            "contract_end_date": None, "payment_term": None})
        sources.append({"customer_id": key, "phone": row["tel"], "address": row["Address"], "category": row["name_category"],
            "review_notes": row["issues"], "raw_record": row, "source_url": meta["page_url"], "data_url": meta["data_url"],
            "retrieved_on": dt.date.fromisoformat(meta["retrieved_date"]), "snapshot_sha256": meta["source_sha256"]})
    session.execute(insert(Place).values(list(places.values())).on_conflict_do_nothing(index_elements=[Place.id]))
    for offset in range(0, len(rows), 300):
        session.execute(insert(Customer).values(customers[offset:offset+300]).on_conflict_do_nothing(index_elements=[Customer.id]))
        session.execute(insert(PublicOutlet).values(sources[offset:offset+300]).on_conflict_do_nothing(index_elements=[PublicOutlet.customer_id]))
    return {"source_records": meta["raw_count"], "public_outlets": len(rows),
        "created": sum(row["customer_id"] not in existing for row in sources), "review_records": meta["records_with_issues"]}
