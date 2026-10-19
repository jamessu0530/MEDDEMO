"""辨識業務提問的客戶。只用提問與已使用的情境，不讀私人對話或 AI 答案。"""

import re
import unicodedata
from urllib.parse import parse_qs, unquote, urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppUser, Customer
from app.services.assistant_context import PageContext
from app.services.scope import SHARING_LEVEL, Scope


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
