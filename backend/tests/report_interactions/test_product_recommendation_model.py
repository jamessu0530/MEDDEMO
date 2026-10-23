import datetime as dt
import math

import pytest

from app.services.product_recommendation_evaluation import ALSRanking, evaluate, ranking_metrics
from app.services.product_recommendation_model import CatalogItem, Purchase, PurchaseModel

TODAY = dt.date(2031, 4, 17)
CATALOG = [CatalogItem(sku, f"維生素 {sku}", "保健用品", "30 入", "盒") for sku in "ABC"]


def bought(customer, sku, order, ago=0):
    return Purchase(customer, sku, order, TODAY - dt.timedelta(days=ago))


def test_purchase_signal_counts_orders_not_duplicate_lines_and_respects_date_window():
    model = PurchaseModel(CATALOG, [bought("T", "A", "same", 10)] * 10 + [
        bought("T", "A", "next", 5), bought("T", "B", "old", 365),
        bought("T", "C", "edge", 364), bought("T", "B", "future", -1),
        bought("T", "missing", "unknown"),
    ], TODAY)
    assert set(model.profiles["T"]) == {"A", "C"}
    assert model.profiles["T"]["A"] == pytest.approx(math.log1p(2) * 2 ** (-5 / 180))
    assert len(model.order_heads["T"]) == 3


def test_item_cf_uses_cosine_and_distinct_customer_support_with_explainable_evidence():
    rows = [bought("T", "A", "t")]
    rows += [bought(customer, sku, customer) for customer, skus in (("U1", "AB"), ("U2", "AB"), ("U3", "AC")) for sku in skus]
    model = PurchaseModel(CATALOG, rows, TODAY)
    scores, evidence = model.related("T")
    assert scores == pytest.approx({"B": (1 / math.sqrt(2)) * 2 / 5})
    assert evidence == {"B": ("A", 2)}  # A/C has only one distinct co-buyer.
    result = next(item for item in model.rank("T") if item["sku"] == "B")
    assert result["source"] == "related"
    assert "2 家客戶" in result["reasons"][0] and "維生素 A" in result["reasons"][0]
    assert [item["sku"] for item in model.rank("T", method="item_cf")][:1] == ["B"]


def test_replenishment_requires_three_distinct_dates_and_uses_median_gap():
    rows = [bought("T", "A", str(ago), ago) for ago in (40, 30, 20)]
    rows += [bought("T", "B", str(ago), ago) for ago in (40, 30)]
    rows += [bought("T", "C", str(ago), ago) for ago in (20, 10, 0)]
    model = PurchaseModel(CATALOG, rows, TODAY)
    scores, evidence = model.replenishment("T")
    assert scores == {"A": 2.0} and evidence == {"A": (20, 10.0)}
    result = next(item for item in model.rank("T") if item["sku"] == "A")
    assert result["source"] == "replenishment" and "中位間隔 10 天" in result["reasons"][0]


def test_content_cold_items_are_labeled_capped_and_confined_to_purchased_categories():
    catalog = CATALOG + [CatalogItem(f"COLD-{n}", "維生素新品", "保健用品") for n in range(20)]
    catalog += [CatalogItem("OTHER", "維生素院所品", "院所用品")]
    model = PurchaseModel(catalog, [bought("T", "A", "one")], TODAY)
    ranked = model.rank("T", 12)
    cold = [item for item in ranked if item["sku"] not in model.buyers]
    assert len(cold) == 2 and "OTHER" not in {item["sku"] for item in ranked}
    assert all(item["source"] == "content" and "尚無本品成交紀錄" in item["reasons"][1] for item in cold)
    assert all("療效" not in "".join(item["reasons"]) for item in ranked)


def test_new_customer_uses_cohort_popularity_and_no_data_produces_no_fabricated_ranking():
    model = PurchaseModel(CATALOG, [bought("U", "B", "one")], TODAY)
    assert [item["sku"] for item in model.rank("NEW")] == ["B"]
    assert model.rank("NEW")[0]["source"] == "popular"
    assert PurchaseModel(CATALOG, [], TODAY).rank("NEW") == []


def test_exclusions_limit_and_stable_order_apply_to_every_ranker():
    model = PurchaseModel(CATALOG, [bought("T", sku, "one") for sku in "ABC"], TODAY)
    for method in ("hybrid", "item_cf", "popular", "last"):
        first = model.rank("T", 1, ["A", "B"], method)
        assert [item["sku"] for item in first] == ["C"]
        assert first == model.rank("T", 1, ["A", "B"], method)
    assert all(math.isfinite(item["score"]) and item["score"] > 0 for item in model.rank("T"))


def test_ranking_metrics_count_distinct_skus_and_penalize_short_lists():
    scores = ranking_metrics(["A", "A", "X", "B"], {"A", "B"}, 5)
    assert scores["precision"] == 2 / 5 and scores["recall"] == 1
    assert scores["ndcg"] == pytest.approx((1 + 1 / math.log2(4)) / (1 + 1 / math.log2(3)))


def test_global_temporal_split_does_not_learn_test_or_future_sales():
    cutoff = TODAY - dt.timedelta(days=10)
    purchases = [bought("T", "A", "train", 20), bought("T", "B", "test", 1)]
    args = (CATALOG, purchases, {"T": "independent", "OTHER": "clinic"}, cutoff, TODAY)
    result = evaluate(*args, k=3, include_als=False)
    assert result["training_orders"] == 1 and result["test_customers"] == 1
    assert result["methods"]["channel_popular"]["recall"] == 0
    assert result["methods"]["channel_popular"]["cold_item_recall"] == 0
    assert result["methods"]["hybrid"]["cold_item_recall"] > 0
    assert result == evaluate(CATALOG, purchases + [bought("T", "C", "future", -1)], args[2], cutoff, TODAY, k=3, include_als=False)


def test_evaluation_handles_empty_holdout_and_validates_period():
    result = evaluate(CATALOG, [], {}, TODAY - dt.timedelta(days=1), TODAY, include_als=False)
    assert result["test_customers"] == 0 and result["methods"]["hybrid"]["recall"] is None
    with pytest.raises(ValueError):
        evaluate(CATALOG, [], {}, TODAY, TODAY, include_als=False)


def test_real_als_fits_user_item_confidence_matrix_and_permits_repeat_purchases():
    pytest.importorskip("implicit")
    rows = [bought(customer, sku, "one") for customer, skus in (("T", "AB"), ("U", "BC")) for sku in skus]
    model = PurchaseModel(CATALOG, rows, TODAY)
    als = ALSRanking(model)
    assert als.matrix.shape == (2, 3)
    assert als.matrix[als.customers["T"], als.skus.index("A")] == pytest.approx(1 + 20 * model.profiles["T"]["A"])
    assert set(als.rank("T", 3)) == {"A", "B", "C"}
    assert als.rank("NEW", 2) == model.ordered(model.popularity)[:2]
