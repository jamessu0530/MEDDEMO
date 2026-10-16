"""從完整主檔挑語音名稱候選；相似發音只用來找候選，絕不改寫逐字稿。"""

import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache

from opencc import OpenCC
from pypinyin import Style, lazy_pinyin
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Customer, SalesTransaction
from app.services.scope import SHARING_LEVEL, Scope

_TRADITIONAL = OpenCC("s2t")
_CHINESE = re.compile(r"[一-鿿]+")
MAX_CUSTOMER_CANDIDATES = 5


def recent_product_skus(customer_id: str):
    return (select(SalesTransaction.sku).where(SalesTransaction.customer_id == customer_id)
        .group_by(SalesTransaction.sku).order_by(func.max(SalesTransaction.date).desc(), SalesTransaction.sku).limit(32))


def normalized(text: str) -> str:
    return "".join(c for c in _TRADITIONAL.convert(unicodedata.normalize("NFKC", text)).lower().replace("臺", "台") if c.isalnum())


def _indexed(text: str) -> tuple[str, list[int]]:
    chars, positions = [], []
    for i, char in enumerate(text):
        for value in normalized(char):
            chars.append(value)
            positions.append(i)
    return "".join(chars), positions


@lru_cache(maxsize=8192)
def _sounds(text: str) -> tuple[str, ...]:
    sounds = lazy_pinyin(text, style=Style.NORMAL)
    if len(sounds) != len(text):
        sounds = [lazy_pinyin(char, style=Style.NORMAL)[0] for char in text]
    flat = [re.sub(r"^(zh|ch|sh)", lambda m: m[0][0], s) for s in sounds]
    return tuple(s[:-1] if s.endswith(("ing", "eng")) else s for s in flat)


@dataclass(frozen=True)
class NameMatch:
    quote: str
    score: int
    # 供介面區分文字吻合與近音候選；不當成模型信心值。
    kind: str


class NameMatcher:
    def __init__(self, transcript: str):
        self.text = transcript
        self.key, self.positions = _indexed(transcript)
        self.runs = [(m.start(), m.group(), _sounds(m.group())) for m in _CHINESE.finditer(transcript)]
        self.windows: dict[int, dict[tuple[str, ...], str]] = {}
        self.near: dict[int, dict[tuple[str, ...], str]] = {}

    def _phonetic_match(self, target: tuple[str, ...]) -> tuple[str, int] | None:
        size = len(target)
        if size not in self.windows:
            windows, near = {}, {}
            for _, run, sounds in self.runs:
                for i in range(len(sounds) - size + 1):
                    key, quote = sounds[i:i + size], run[i:i + size]
                    windows.setdefault(key, quote)
                    if 5 <= size <= 12:
                        for at in range(size):
                            near.setdefault((*key[:at], "", *key[at + 1:]), quote)
            self.windows[size], self.near[size] = windows, near
        if quote := self.windows[size].get(target):
            return quote, 0
        for at in range(size):
            if quote := self.near[size].get((*target[:at], "", *target[at + 1:])):
                return quote, 1
        return None

    def match(self, terms: list[str], *, partial: bool = False) -> NameMatch | None:
        best = None
        for term in dict.fromkeys(terms):
            key = normalized(term)
            if len(key) < 2:
                continue
            start = self.key.find(key)
            # 英文名稱不能只對到另一個單字的中間（Zan / tizanidine）。
            while start >= 0:
                end = start + len(key)
                before = normalized(self.text[self.positions[start] - 1]) if self.positions[start] else ""
                after = normalized(self.text[self.positions[end - 1] + 1:self.positions[end - 1] + 2])
                left_word = before.isalnum() if key[0].isdigit() else before.isalpha()
                right_word = after.isalnum() if key[-1].isdigit() else after.isalpha()
                left_ok = not key[0].isascii() or not (before.isascii() and left_word)
                right_ok = not key[-1].isascii() or not (after.isascii() and right_word)
                if left_ok and right_ok:
                    found = NameMatch(self.text[self.positions[start]:self.positions[end - 1] + 1], 100 + len(key), "exact")
                    best = max((best, found), key=lambda m: m.score if m else -1)
                    break
                start = self.key.find(key, start + 1)
            if best and best.kind == "exact":
                continue
            for part in _CHINESE.findall(term):
                if len(part) < 3:
                    continue
                target = _sounds(part)
                if phonetic := self._phonetic_match(target):
                    quote, errors = phonetic
                    found = NameMatch(quote, 60 + len(part) - errors * 10, "phonetic")
                    best = max((best, found), key=lambda m: m.score if m else -1)
                # 完整型錄的長品名可用三字以上片段召回，例如「海藻鈣」。只當候選，不直接選 SKU。
                if partial and not best:
                    for size in range(min(len(part), 8), 2, -1):
                        hits = [part[i:i + size] for i in range(len(part) - size + 1) if normalized(part[i:i + size]) in self.key]
                        if hits:
                            fragment = hits[0]
                            at = self.key.index(normalized(fragment))
                            best = NameMatch(self.text[self.positions[at]:self.positions[at + len(normalized(fragment)) - 1] + 1], 30 + size, "partial")
                            break
        return best


def customer_terms(name: str) -> list[str]:
    parts = [p.strip() for p in re.split(r"[·・]", name) if p.strip()]
    if not parts:
        return []
    store, *branches = parts
    brand = re.sub(r"連鎖藥局|健康藥局|藥局|藥妝", "", store)
    return list(dict.fromkeys([name, "".join(parts), *(brand + branch for branch in branches), *branches]))


def customer_candidates(session: Session, transcript: str, scope: Scope) -> list[dict[str, str]]:
    if not transcript.strip():
        return []
    matcher = NameMatcher(transcript)
    candidates = []
    for customer_id, name in session.execute(select(Customer.id, Customer.name)
        .where(scope.customers_at(SHARING_LEVEL["customer_profile"])).order_by(Customer.id)):
        match = matcher.match(customer_terms(name))
        if match:
            candidates.append((match.score, {"id": customer_id, "name": name, "quote": match.quote, "match_kind": match.kind}))
    return [item for _, item in sorted(candidates, key=lambda c: -c[0])[:MAX_CUSTOMER_CANDIDATES]]
