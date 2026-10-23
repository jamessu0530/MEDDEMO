"""Chronological, channel-specific comparisons; no writes or LLM calls."""

from __future__ import annotations

import datetime as dt
import math
from collections import defaultdict

from app.services.product_recommendation_model import CatalogItem, Purchase, PurchaseModel


class ALSRanking:
    def __init__(self, model: PurchaseModel):
        # Optional experiment dependencies stay outside the serving API path.
        import numpy as np
        from implicit.cpu.als import AlternatingLeastSquares
        from scipy.sparse import csr_matrix

        self.customers = {customer: index for index, customer in enumerate(sorted(model.profiles))}
        self.skus = sorted(model.buyers)
        item_ids = {sku: index for index, sku in enumerate(self.skus)}
        rows, columns, confidence = [], [], []
        for customer, profile in model.profiles.items():
            for sku, strength in profile.items():
                rows.append(self.customers[customer])
                columns.append(item_ids[sku])
                confidence.append(1 + 20 * strength)
        self.matrix = csr_matrix((np.asarray(confidence, dtype=np.float32), (rows, columns)),
                                 shape=(len(self.customers), len(self.skus)))
        self.model = None
        if self.customers and self.skus:
            self.model = AlternatingLeastSquares(factors=16, regularization=0.1, iterations=20,
                                                random_state=42, num_threads=1, alpha=1.0)
            self.model.fit(self.matrix, show_progress=False)
        self.fallback = model.ordered(model.popularity)

    def rank(self, customer_id: str, k: int) -> list[str]:
        index = self.customers.get(customer_id)
        if index is None or self.model is None:
            return self.fallback[:k]
        # Reorders are valid for this B2B next-purchase task, in every model.
        ids, scores = self.model.recommend(index, self.matrix[index], N=min(k, len(self.skus)),
                                          filter_already_liked_items=False)
        return [self.skus[int(item)] for item, score in zip(ids, scores) if item >= 0 and math.isfinite(float(score))]


def ranking_metrics(recommended: list[str], relevant: set[str], k: int) -> dict[str, float]:
    # Duplicated SKU lines must not inflate hits, precision or discounted gain.
    recommended = list(dict.fromkeys(recommended))[:k]
    hits = [int(sku in relevant) for sku in recommended]
    ideal = sum(1 / math.log2(index + 2) for index in range(min(k, len(relevant))))
    return {"precision": sum(hits) / k, "recall": sum(hits) / len(relevant) if relevant else 0.0,
            "ndcg": sum(hit / math.log2(index + 2) for index, hit in enumerate(hits)) / ideal if ideal else 0.0}


def evaluate(items: list[CatalogItem], purchases: list[Purchase], channels: dict[str, str],
             cutoff: dt.date, as_of: dt.date, k: int = 5, include_als=True) -> dict:
    if not 1 <= k <= 25 or not cutoff < as_of:
        raise ValueError("評估需使用 1–25 的 K，且訓練截止日須早於測試截止日。")
    catalog = {item.sku for item in items}
    truth: dict[str, set[str]] = defaultdict(set)
    training: dict[str, list[Purchase]] = defaultdict(list)
    for purchase in purchases:
        channel = channels.get(purchase.customer_id)
        if channel is None or purchase.sku not in catalog:
            continue
        if purchase.date <= cutoff:
            training[channel].append(purchase)
        elif purchase.date <= as_of:
            truth[purchase.customer_id].add(purchase.sku)
    models = {channel: PurchaseModel(items, training[channel], cutoff) for channel in set(channels.values())}
    als = {channel: ALSRanking(model) for channel, model in models.items()} if include_als else {}
    methods = {"channel_popular": "popular", "last_purchase": "last", "item_cf": "item_cf", "hybrid": "hybrid"}
    if include_als:
        methods["als"] = "als"
    results = {}
    for name, method in methods.items():
        totals = CounterMetrics()
        seen: set[str] = set()
        cold_hits = cold_total = 0
        for customer_id, relevant in sorted(truth.items()):
            channel = channels[customer_id]
            model = models[channel]
            skus = als[channel].rank(customer_id, k) if method == "als" else [item["sku"] for item in model.rank(customer_id, k, method=method)]
            skus = list(dict.fromkeys(sku for sku in skus if sku in catalog))[:k]
            totals.add(ranking_metrics(skus, relevant, k))
            seen.update(skus)
            cold = relevant - model.buyers.keys()
            cold_hits += len(set(skus) & cold)
            cold_total += len(cold)
        results[name] = {**totals.average(), "catalog_coverage": len(seen) / len(catalog) if catalog else 0.0,
                         "cold_item_recall": cold_hits / cold_total if cold_total else None,
                         "evaluated_customers": len(truth)}
    return {"cutoff": cutoff.isoformat(), "as_of": as_of.isoformat(), "k": k,
            "training_orders": sum(len(orders) for model in models.values() for orders in model.order_heads.values()),
            "test_customers": len(truth), "catalog_items": len(catalog),
            "als_enabled": include_als, "methods": results,
            "limitations": ["離線命中率不代表成交增量或臨床適用性。", "型錄採目前可供商品；未重建歷史上架與供貨資格。",
                            "混合排序的規則權重為預設值，未使用測試期間調參。"]}


class CounterMetrics:
    def __init__(self):
        self.count = 0
        self.totals = {"precision": 0.0, "recall": 0.0, "ndcg": 0.0}

    def add(self, metrics: dict[str, float]):
        self.count += 1
        for key, value in metrics.items():
            self.totals[key] += value

    def average(self):
        return {key: round(value / self.count, 6) if self.count else None for key, value in self.totals.items()}
