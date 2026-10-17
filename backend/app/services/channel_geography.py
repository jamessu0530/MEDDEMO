"""全台行政區地點頻道；與公司內部組織分區分開，既有頻道與訊息保留。"""

import json
import re
from functools import cache
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import OrgUnit, Place


@cache
def geography() -> dict:
    root = Path(__file__).resolve().parents[3]
    source = root / "frontend" / "src" / "data" / "taiwan-districts.json"
    if not source.exists():
        source = root / "data" / "seed" / "taiwan-districts.json"
    return json.loads(source.read_text(encoding="utf-8"))


def location_key(name: str) -> str:
    return re.sub(r"[\s・·]", "", name).replace("台", "臺")


def shared_places(session: Session) -> dict[str, Place]:
    # 舊名單可能同時有「北區」與「北 區」；固定選同一筆，不搬移既有客戶或訊息。
    result = {}
    for place in session.scalars(select(Place).where(Place.unit_id == "TW").order_by(Place.id)):
        result.setdefault(location_key(place.name), place)
    return result


def ensure_places(session: Session) -> int:
    """補齊 368 個共用地點，已存在的公開通路地點沿用原編號，可重複執行。"""
    if session.scalar(select(OrgUnit.id).where(OrgUnit.id == "TW")) is None:
        raise ValueError("請先初始化組織，再建立全台地點頻道")
    session.execute(text("SELECT pg_advisory_xact_lock(hashtext('meddemo-channel-geography'))"))
    existing = shared_places(session)
    rows = [
        {"id": f"GEO-{district['code']}", "name": city["name"] + district["name"], "unit_id": "TW"}
        for city in geography()["cities"] for district in city["districts"]
        if location_key(city["name"] + district["name"]) not in existing
    ]
    if rows:
        session.execute(insert(Place).values(rows).on_conflict_do_nothing())
    return len(rows)
