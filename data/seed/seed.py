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
from app.services.org import paths_from_reports, rebuild_org_paths

# 決賽日。評測題庫的標準答案以這一天為「今天」計算
DEFAULT_AS_OF = date(2026, 10, 28)

# 依外鍵相依的順序寫入
TABLES = [
    ("org_unit", models.OrgUnit),
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
            rows = data[name]
            if name == "app_user":
                # org_position 約束是一般 CHECK 約束，Postgres 不支援延遲檢查：
                # manager_id／unit_id 有值的那一列，org_path 得在同一筆 INSERT 就一起帶著，
                # 沒有「先插入、稍後用 rebuild_org_paths 補上」的空間，所以先在寫入前算好路徑
                unit_ids = {u["id"] for u in data["org_unit"]}
                reports = {u["id"]: (u["manager_id"], u["unit_id"]) for u in rows}
                paths = paths_from_reports(unit_ids, reports)
                rows = [{**u, "org_path": paths[u["id"]]} for u in rows]
                # manager_id 指向同一張表：經理要先寫進去，業務那幾列的外鍵才成立
                rows.sort(key=lambda u: u["manager_id"] is not None)
            session.execute(insert(model), rows)
        # 跟 services/org.py 的演算法核對一次：未來透過管理介面改組織架構時，也是呼叫這個函式重算
        rebuild_org_paths(session)
        # 歷史出差單當已核准：請求者與區處主管兩關都過，申請匣才不會被幾千張舊單塞滿
        session.execute(text("""
            INSERT INTO oa_approval_step (form_id, step_no, role_label, user_id, title, status, acted_at)
            SELECT o.id, 1, '請求者', o.applicant_id, '業務', 'done', o.created_at
            FROM oa_expense_form o
        """))
        session.execute(text("""
            INSERT INTO oa_approval_step (form_id, step_no, role_label, user_id, title, status, acted_at)
            SELECT o.id, 2, '經辦人的主管', m.id, '區處主管', 'done', o.created_at
            FROM oa_expense_form o
            JOIN customer c ON c.id = o.customer_id
            -- 一個區可能有不只一位主管，所以要挑一位，而且要跟 App 挑的是同一位
            -- （services/oa.py 與 services/risk.py 都取該區工號最小的），否則歷史簽核會對不上現在的行為
            JOIN LATERAL (
              SELECT id FROM app_user WHERE role = 'manager' AND region = c.region ORDER BY id LIMIT 1
            ) m ON true
        """))
        session.execute(text("""
            INSERT INTO oa_activity (form_id, action, actor_id, detail, created_at)
            SELECT o.id, 'submitted', o.applicant_id, '經辦人送出', o.created_at
            FROM oa_expense_form o
        """))
        session.execute(text("""
            INSERT INTO oa_activity (form_id, action, actor_id, detail, created_at)
            SELECT o.id, 'approved', m.id, '簽核者', o.created_at
            FROM oa_expense_form o
            JOIN customer c ON c.id = o.customer_id
            -- 一個區可能有不只一位主管，所以要挑一位，而且要跟 App 挑的是同一位
            -- （services/oa.py 與 services/risk.py 都取該區工號最小的），否則歷史簽核會對不上現在的行為
            JOIN LATERAL (
              SELECT id FROM app_user WHERE role = 'manager' AND region = c.region ORDER BY id LIMIT 1
            ) m ON true
        """))
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
