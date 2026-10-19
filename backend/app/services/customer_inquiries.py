"""提問的客戶關聯與單次定位。客戶由問題與情境辨識；地點僅來自該次定位，不讀私人對話或 AI 答案。"""

import datetime as dt
import re
import unicodedata
from urllib.parse import parse_qs, unquote, urlsplit

from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppUser, Customer
from app.services.assistant_context import PageContext
from app.services.scope import SHARING_LEVEL, Scope
from app.services.travel import straight_km


def _compact(value: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKC", value).casefold() if c.isalnum())


def _aliases(name: str) -> set[str]:
    store, _, branch = name.partition(" · ")
    brand = store.replace("連鎖藥局", "").replace("健康藥局", "").replace("藥局", "").replace("藥妝", "")
    return {_compact(name), _compact(brand + branch)} if branch else {_compact(name)}


def _page_customer(page: PageContext | None) -> str | None:
    if page is None or not page.path.startswith("/") or page.path.startswith("//"):
        return None
    parsed = urlsplit(page.path)
    parts = parsed.path.strip("/").split("/")
    if parts[0] == "customers" and len(parts) > 1:
        return unquote(parts[1])
    if parts[0] == "orders":
        return parse_qs(parsed.query).get("customer_id", [None])[0]
    return None


def associated_customer_ids(
    session: Session, user: AppUser, question: str, page: PageContext | None = None, context_used: bool = False,
) -> list[str]:
    candidates = session.execute(select(Customer.id, Customer.name).where(
        Scope.for_user(user).customers_at(SHARING_LEVEL["customer_profile"])
    )).all()
    known = {row.id for row in candidates}
    context_id = _page_customer(page)
    aliases: dict[str, set[str]] = {}
    for customer_id, name in candidates:
        for alias in _aliases(name):
            if len(alias) >= 3:
                aliases.setdefault(alias, set()).add(customer_id)
    text = _compact(question)
    matched = set()
    for customer_id in known:
        if re.search(rf"(?<![a-zA-Z0-9_]){re.escape(customer_id)}(?![a-zA-Z0-9_])", question, re.I):
            matched.add(customer_id)
    for alias, ids in aliases.items():
        if alias in text:
            if len(ids) == 1:
                matched.update(ids)
            elif context_id in ids:
                matched.add(context_id)
    # 明講別家客戶就以問題為準；公司通用題不因停在客戶頁就分享出去。
    if not matched and context_id in known and (context_used or re.search(r"這家|這間|這個客戶|該客戶|該店|對方", question)):
        matched.add(context_id)
    return sorted(matched)


class InquiryLocationInput(BaseModel):
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lng: float = Field(ge=-180, le=180, allow_inf_nan=False)
    accuracy_m: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    captured_at: AwareDatetime


def inquiry_location_snapshot(session: Session, user: AppUser, fix: InquiryLocationInput | None) -> dict | None:
    """只接受這次提問取得的新定位；附近店名與座標一同凍結，後續移動不會改寫。"""
    if fix is None or user.role != "sales":
        return None
    age = dt.datetime.now(dt.UTC) - fix.captured_at
    if not -dt.timedelta(seconds=30) <= age <= dt.timedelta(minutes=5):
        return None
    result = fix.model_dump(mode="json") | {"place_name": None}
    # 粗略定位只標座標；提問內容提到的客戶不等於人在那家店。
    if fix.accuracy_m is not None and fix.accuracy_m <= 200:
        candidates = session.execute(select(Customer.name, Customer.lat, Customer.lng).where(
            Customer.owner_user_id == (user.acts_as_user_id or user.id),
            Customer.lat.is_not(None), Customer.lng.is_not(None),
        )).all()
        nearby = [(straight_km((fix.lat, fix.lng), (row.lat, row.lng)), row.name) for row in candidates]
        if nearby:
            distance, name = min(nearby)
            if distance <= 0.2:
                result["place_name"] = f"{name}附近"
    return result
