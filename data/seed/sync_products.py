"""把新型錄加入現有資料庫，保留原有品項、客戶、交易與帳號。

    uv run --project backend python data/seed/sync_products.py

可重複執行；既有料號不覆寫。舊資料庫會補上 common 欄位與 AI 的商品型錄 View。
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

import catalog  # noqa: E402
import generate  # noqa: E402
from sqlalchemy import Connection, bindparam, text  # noqa: E402
from sqlalchemy.dialects.postgresql import insert  # noqa: E402

from app.db import PRODUCT_CATALOG, make_engine  # noqa: E402
from app.models import Product  # noqa: E402


def sync_product_catalog(conn: Connection) -> dict[str, int]:
    """由呼叫端包成一個交易：新增欄位、匯入與 View 的權限一起成功或回滾。"""
    before = conn.scalar(text("SELECT count(*) FROM product"))
    conn.exec_driver_sql("ALTER TABLE product ADD COLUMN IF NOT EXISTS common boolean NOT NULL DEFAULT false")
    common = {p[0] for p in catalog.PRODUCTS} | {p[0] for p in catalog.PROMO_PRODUCTS} | set(catalog.COMMON_REAL_PRODUCTS)
    conn.execute(
        text("UPDATE product SET common = true WHERE sku IN :skus").bindparams(bindparam("skus", expanding=True)),
        {"skus": sorted(common)},
    )
    rows = generate.real_product_rows()
    inserted = []
    if rows:
        stmt = insert(Product).values(rows).on_conflict_do_nothing(index_elements=[Product.sku]).returning(Product.sku)
        inserted = list(conn.execute(stmt).scalars())
    conn.exec_driver_sql(PRODUCT_CATALOG.read_text(encoding="utf-8"), execution_options={"no_parameters": True})
    return {"before": before, "catalog": len(rows), "inserted": len(inserted), "total": conn.scalar(text("SELECT count(*) FROM product"))}


def main() -> None:
    engine = make_engine()
    try:
        with engine.begin() as conn:
            counts = sync_product_catalog(conn)
        print(json.dumps(counts, ensure_ascii=False))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
