"""Deterministic B2B product ranking from purchases, never from clinical claims.

Item-CF learns cosine similarities between customer purchase vectors. The hybrid
uses reciprocal-rank fusion with explicit, versioned business rules; its fusion
weights are not learned probabilities. ALS is an offline comparison, not an API
dependency. See docs/product-recommendations.md for assumptions and evaluation.
"""

from __future__ import annotations

import datetime as dt
import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from statistics import median
from typing import Iterable

MODEL_VERSION = "channel-item-cf-content-v1"
HISTORY_DAYS = 365
HALF_LIFE_DAYS = 180
MIN_PAIR_CUSTOMERS = 2
FUSION_WEIGHTS = {"related": 1.0, "replenishment": 1.0, "content": 0.5, "popular": 0.15}


@dataclass(frozen=True)
class CatalogItem:
    sku: str
    name: str
    category: str
    spec: str = ""
    unit: str = ""


@dataclass(frozen=True)
class Purchase:
    customer_id: str
    sku: str
    order_no: str
    date: dt.date


def _features(item: CatalogItem) -> set[str]:
    # Product text similarity is for assortment exploration, not equivalence of
    # ingredients, indications, effects, dosage or substitutability.
    terms = {f"word:{word}" for word in re.findall(r"[a-z]+|[\u3400-\u9fff]{2,}", f"{item.name} {item.spec}".lower())}
    for word in tuple(terms):
        text = word.removeprefix("word:")
        if re.fullmatch(r"[\u3400-\u9fff]+", text):
            terms.update(f"gram:{text[at:at + 2]}" for at in range(len(text) - 1))
    return terms | {f"category:{item.category}", f"unit:{item.unit}"}


class PurchaseModel:
    """One visible customer-channel cohort and one immutable as-of date."""

    def __init__(self, items: Iterable[CatalogItem], purchases: Iterable[Purchase], as_of: dt.date):
        self.items = {item.sku: item for item in items}
        self.as_of = as_of
        self.orders: dict[str, dict[str, dict[str, dt.date]]] = defaultdict(lambda: defaultdict(dict))
        self.order_heads: dict[str, dict[str, dt.date]] = defaultdict(dict)
        start = as_of - dt.timedelta(days=HISTORY_DAYS - 1)
        for purchase in purchases:
            if purchase.sku not in self.items or not start <= purchase.date <= as_of:
                continue
            dates = self.orders[purchase.customer_id][purchase.sku]
            dates[purchase.order_no] = min(dates.get(purchase.order_no, purchase.date), purchase.date)
            heads = self.order_heads[purchase.customer_id]
            heads[purchase.order_no] = min(heads.get(purchase.order_no, purchase.date), purchase.date)
        self.profiles: dict[str, dict[str, float]] = {}
        self.buyers: dict[str, dict[str, float]] = defaultdict(dict)
        for customer, products in self.orders.items():
            profile = {}
            for sku, orders in products.items():
                age = (as_of - max(orders.values())).days
                value = math.log1p(len(orders)) * 2 ** (-age / HALF_LIFE_DAYS)
                profile[sku] = value
                self.buyers[sku][customer] = value
            self.profiles[customer] = profile
        self.norms = {sku: math.sqrt(sum(value * value for value in buyers.values())) for sku, buyers in self.buyers.items()}
        self.popularity = {sku: sum(buyers.values()) for sku, buyers in self.buyers.items()}
        features = {sku: _features(item) for sku, item in self.items.items()}
        frequency = Counter(feature for values in features.values() for feature in values)
        self.content = {}
        for sku, values in features.items():
            weights = {feature: math.log((1 + len(features)) / (1 + frequency[feature])) + 1 for feature in values}
            # Give the product category an explicit feature, without inferring
            # pharmaceutical characteristics from a name or a brand.
            weights[f"category:{self.items[sku].category}"] *= 2
            length = math.sqrt(sum(value * value for value in weights.values()))
            self.content[sku] = {feature: value / length for feature, value in weights.items()}

    @staticmethod
    def ordered(scores: dict[str, float]) -> list[str]:
        return sorted((sku for sku, score in scores.items() if score > 0 and math.isfinite(score)), key=lambda sku: (-scores[sku], sku))

    def related(self, customer_id: str) -> tuple[dict[str, float], dict[str, tuple[str, int]]]:
        profile = self.profiles.get(customer_id, {})
        scores: dict[str, float] = defaultdict(float)
        evidence: dict[str, tuple[str, int]] = {}
        best: dict[str, float] = {}
        anchors = self.ordered(profile)[:40]
        total = sum(profile[sku] for sku in anchors) or 1
        for anchor in anchors:
            dot: dict[str, float] = defaultdict(float)
            count: Counter[str] = Counter()
            for customer, value in self.buyers[anchor].items():
                for sku, other in self.profiles[customer].items():
                    if sku in profile:
                        continue
                    dot[sku] += value * other
                    count[sku] += 1
            for sku, product_dot in dot.items():
                support = count[sku]
                if support < MIN_PAIR_CUSTOMERS:
                    continue
                similarity = product_dot / (self.norms[anchor] * self.norms[sku])
                contribution = profile[anchor] / total * similarity * support / (support + 3)
                scores[sku] += contribution
                if contribution > best.get(sku, 0):
                    evidence[sku], best[sku] = (anchor, support), contribution
        return dict(scores), evidence

    def content_matches(self, customer_id: str) -> tuple[dict[str, float], dict[str, str]]:
        profile = self.profiles.get(customer_id, {})
        anchors = self.ordered(profile)[:40]
        scores, evidence = {}, {}
        total = sum(profile[sku] for sku in anchors) or 1
        for sku, item in self.items.items():
            if sku in profile:
                continue
            best = 0.0
            for anchor in anchors:
                if item.category != self.items[anchor].category:
                    continue
                similarity = sum(value * self.content[sku].get(feature, 0) for feature, value in self.content[anchor].items())
                contribution = similarity * profile[anchor] / total
                if contribution > best:
                    best, evidence[sku] = contribution, anchor
            if best > 0:
                scores[sku] = best
        return scores, evidence

    def replenishment(self, customer_id: str) -> tuple[dict[str, float], dict[str, tuple[int, float]]]:
        scores, evidence = {}, {}
        for sku, orders in self.orders.get(customer_id, {}).items():
            dates = sorted(set(orders.values()))
            if len(dates) < 3:
                continue
            interval = float(median((right - left).days for left, right in zip(dates, dates[1:])))
            elapsed = (self.as_of - dates[-1]).days
            if elapsed >= interval * 0.8:
                scores[sku] = min(3.0, elapsed / interval)
                evidence[sku] = elapsed, interval
        return scores, evidence

    def rank(self, customer_id: str, limit: int = 12, exclude: Iterable[str] = (), method: str = "hybrid") -> list[dict]:
        excluded = set(exclude)
        popular = self.ordered(self.popularity)
        if method == "popular":
            return [{"sku": sku, "score": self.popularity[sku]} for sku in popular if sku not in excluded][:limit]
        if method == "last":
            orders = self.order_heads.get(customer_id, {})
            last = max(orders, key=lambda number: (orders[number], number), default=None)
            skus = [sku for sku, values in self.orders.get(customer_id, {}).items() if last in values]
            return [{"sku": sku, "score": 1.0} for sku in sorted(skus) if sku not in excluded][:limit]
        related, related_evidence = self.related(customer_id)
        if method == "item_cf":
            skus = list(dict.fromkeys(self.ordered(related) + popular))
            return [{"sku": sku, "score": related.get(sku, 0.0)} for sku in skus if sku not in excluded][:limit]
        if method != "hybrid":
            raise ValueError(f"Unknown recommendation method: {method}")
        content, content_evidence = self.content_matches(customer_id)
        replenishment, replenishment_evidence = self.replenishment(customer_id)
        scores: dict[str, float] = defaultdict(float)
        for name, values in (("related", related), ("replenishment", replenishment), ("content", content), ("popular", self.popularity)):
            for rank, sku in enumerate(self.ordered({sku: value for sku, value in values.items() if sku not in excluded}), 1):
                scores[sku] += FUSION_WEIGHTS[name] / (20 + rank)
        result = []
        exploration = 0
        for sku in self.ordered(dict(scores)):
            reasons = []
            source = "popular"
            if sku in replenishment_evidence:
                source = "replenishment"
                elapsed, interval = replenishment_evidence[sku]
                reasons.append(f"距上次採購 {elapsed} 天；過去採購中位間隔 {interval:g} 天，供本次補貨討論參考。")
            if sku in related_evidence:
                if source == "popular":
                    source = "related"
                anchor, support = related_evidence[sku]
                reasons.append(f"同通路有 {support} 家客戶同時採購本品與這家曾買的「{self.items[anchor].name}」。")
            if sku in content_evidence and source == "popular":
                source = "content"
                anchor = content_evidence[sku]
                reasons.append(f"與曾採購的「{self.items[anchor].name}」同屬「{self.items[sku].category}」，依商品資料提供品類探索。")
                if sku not in self.buyers:
                    if exploration >= min(2, max(1, limit // 4)):
                        continue
                    exploration += 1
                    reasons.append("近一年同通路尚無本品成交紀錄，請先核對供貨條件。")
            if not reasons:
                reasons.append(f"近一年同通路有 {len(self.buyers[sku])} 家客戶採購，依成交紀錄排序。")
            result.append({"sku": sku, "score": round(scores[sku], 8), "source": source, "reasons": reasons[:2]})
            if len(result) >= limit:
                break
        return result
