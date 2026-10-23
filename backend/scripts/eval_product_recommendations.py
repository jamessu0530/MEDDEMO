"""Compare five recommenders with a global temporal split, never random SKU rows.

uv run --project backend --extra recommendation-eval python backend/scripts/eval_product_recommendations.py --cutoff 2026-09-30
Use --demo for a small, explicitly synthetic smoke dataset; --without-als runs
the four dependency-free baselines. No DB tables, orders or settings are changed.
"""

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.product_recommendation_evaluation import evaluate  # noqa: E402
from app.services.product_recommendation_model import CatalogItem, Purchase  # noqa: E402


def demo_data():
    items = [CatalogItem(sku, name, category, "盒", "盒") for sku, name, category in [
        ("P1", "維生素 A", "保健用品"), ("P2", "維生素 B", "保健用品"), ("P3", "保健新品", "保健用品"),
        ("P4", "院所品項", "院所用品"), ("P5", "院所新品", "院所用品")]]
    cutoff = dt.date(2026, 9, 30)
    channels = {**{f"shop-{at}": "independent" for at in range(12)}, **{f"clinic-{at}": "clinic" for at in range(4)}}
    purchases = []
    for customer in channels:
        for day in (dt.date(2026, 8, 1), dt.date(2026, 8, 20), dt.date(2026, 9, 10)):
            skus = ["P1", "P2"] if customer.startswith("shop") else ["P4"]
            if customer in ("shop-0", "shop-1"):
                skus = ["P1"]
            purchases.extend(Purchase(customer, sku, f"{customer}-{day}", day) for sku in skus)
        skus = ["P2", "P3"] if customer.startswith("shop") else ["P4", "P5"]
        purchases.extend(Purchase(customer, sku, f"{customer}-test", dt.date(2026, 10, 10)) for sku in skus)
    return items, purchases, channels, cutoff, dt.date(2026, 10, 23)


def database_data(cutoff, as_of):
    from sqlalchemy import select
    from app.db import session_factory
    from app.models import Customer, Product, SalesTransaction
    from app.services.customer_profile import app_today
    from app.services.product_catalog import visible_catalog_products
    from app.services.product_recommendation_model import HISTORY_DAYS

    with session_factory()() as session:
        as_of = as_of or app_today(session)
        cutoff = cutoff or as_of - dt.timedelta(days=30)
        products = list(session.scalars(select(Product).where(visible_catalog_products(), Product.unit_price > 0)))
        items = [CatalogItem(item.sku, item.name, item.category, item.spec, item.unit) for item in products]
        channels = dict(session.execute(select(Customer.id, Customer.type)).all())
        rows = session.execute(select(SalesTransaction.customer_id, SalesTransaction.sku, SalesTransaction.order_no, SalesTransaction.date)
            .where(SalesTransaction.date.between(cutoff - dt.timedelta(days=HISTORY_DAYS - 1), as_of),
                   SalesTransaction.sku.in_([item.sku for item in items])).distinct())
        purchases = [Purchase(row.customer_id, row.sku, row.order_no, row.date) for row in rows]
    return items, purchases, channels, cutoff, as_of


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cutoff", type=dt.date.fromisoformat)
    parser.add_argument("--as-of", type=dt.date.fromisoformat)
    parser.add_argument("--k", type=int, default=5)
    parser.add_argument("--without-als", action="store_true")
    parser.add_argument("--demo", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.demo and (args.cutoff or args.as_of):
        parser.error("--demo 使用固定合成資料期間，請勿同時指定日期。")
    data = demo_data() if args.demo else database_data(args.cutoff, args.as_of)
    try:
        result = evaluate(*data, k=args.k, include_als=not args.without_als)
    except ImportError as exc:
        parser.error(f"ALS 評估需安裝 recommendation-eval extra，或明確指定 --without-als：{exc}")
    except ValueError as exc:
        parser.error(str(exc))
    result["data_source"] = "synthetic_demo_not_business_evidence" if args.demo else "database_not_independently_validated"
    output = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output)
    print(output, end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
