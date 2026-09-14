"""重建資料庫並灌入假資料。

    uv run --project backend python data/seed/seed.py [--as-of 2026-10-28]

會清掉整個 public schema，依 SQLAlchemy models 重建資料表與語意層 View，再重新產生資料。
"""

import argparse
import sys
from datetime import date
from pathlib import Path

# macOS 上 .venv 會被標成隱藏，Python 就略過可編輯安裝的 .pth、找不到 app；直接把 backend 加進搜尋路徑
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from sqlalchemy import insert, text  # noqa: E402
from sqlalchemy.orm import Session

import generate
from app import models
from app.db import make_engine, reset_schema, schema_version
from app.embeddings import optional_embedder
from app.services.documents import index_documents

# 決賽日。評測題庫的標準答案以這一天為「今天」計算
DEFAULT_AS_OF = date(2026, 10, 28)

# 依外鍵相依的順序寫入
TABLES = [
    ("app_user", models.AppUser),
    ("product", models.Product),
    ("customer", models.Customer),
    ("sales_transaction", models.SalesTransaction),
    ("receivable", models.Receivable),
    ("visit", models.Visit),
    ("crm_visit_record", models.CrmVisitRecord),
    ("sap_quotation_draft", models.SapQuotationDraft),
    ("oa_expense_form", models.OaExpenseForm),
    ("writeback_log", models.WritebackLog),
]


def seed(url: str | None, as_of: date) -> dict[str, int]:
    data = generate.generate(as_of)
    engine = make_engine(url)
    reset_schema(engine)
    with Session(engine) as session, session.begin():
        session.add_all([
            models.AppSetting(key="as_of_date", value=as_of.isoformat()),
            # 部署流程拿它比對：程式裡的資料表定義一改，就知道 VM 上的資料庫要重建
            models.AppSetting(key="schema_version", value=schema_version()),
        ])
        for name, model in TABLES:
            session.execute(insert(model), data[name])
        # 假資料的拜訪編號是直接指定的，序號要接在後面，新拜訪才不會撞號
        session.execute(text("SELECT setval('visit_seq', :n)"), {"n": len(data["visit"])})
        # 內部文件建索引；有設定 embedding 服務才一併算向量，否則只建關鍵字索引
        embedder = optional_embedder()
        chunks = index_documents(session, embed=embedder.embed_documents if embedder else None)
    engine.dispose()
    return {name: len(data[name]) for name, _ in TABLES} | {"document_chunk": chunks}


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--as-of", type=date.fromisoformat, default=DEFAULT_AS_OF)
    parser.add_argument("--database-url", help="預設讀環境變數 DATABASE_URL")
    args = parser.parse_args()
    counts = seed(args.database_url, args.as_of)
    print(f"as_of={args.as_of}")
    for name, n in counts.items():
        print(f"{name:22} {n:6}")


if __name__ == "__main__":
    main()
