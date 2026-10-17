"""已知版本的附加式升級；保留既有交易、帳號、報表與使用者設定。"""

import sys
import re
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select, text, update  # noqa: E402
from sqlalchemy.engine import Connection  # noqa: E402

from app.db import make_engine, schema_version, SEMANTIC_LAYER  # noqa: E402
from app.models import AppSetting, LearningCompletion, MascotCollectible, MascotEncounter, MascotWardrobe, SalesOrder, ReportDataset, ProductBrowseProfile, PublicOutlet, PLANNER_TABLES  # noqa: E402

# 保留前一輪的升級起點，同時支援目前已部署版本新增訂單工作區。
# 未知版本不得自動重灌：新增升級路徑，或由維運明確選擇 workflow 的 reseed。
FROM_VERSION = "da9e482ae109"
PREVIOUS_VERSION = "20ea4eee38ef"
ORDERS_VERSION = "e5f5f7ae1005"
REPORTS_VERSION = "a04a685630e5"
PRODUCT_BROWSING_VERSION = "6214a6a90ab3"
PUBLIC_OUTLETS_VERSION = "a0627cc80f56"
PRE_CALENDAR_VERSION = "5222ff8c6a9e"
TO_VERSION = "1fe8ef6529d7"


def upgrade(connection: Connection, target: str | None = None) -> str:
    expected = target or schema_version()
    connection.execute(text("SELECT pg_advisory_xact_lock(hashtext('meddemo-schema-upgrade'))"))
    current = connection.scalar(select(AppSetting.value).where(AppSetting.key == "schema_version").with_for_update())
    if current == expected:
        return "資料表已是目前版本，無須更新。"
    if current not in {FROM_VERSION, PREVIOUS_VERSION, ORDERS_VERSION, REPORTS_VERSION, PRODUCT_BROWSING_VERSION, PUBLIC_OUTLETS_VERSION, PRE_CALENDAR_VERSION} or expected != TO_VERSION:
        raise RuntimeError(f"沒有保留資料的升級路徑：{current or '未記錄版本'} → {expected}；停止部署，不重灌。")
    for model in (LearningCompletion, MascotWardrobe, MascotCollectible, MascotEncounter, SalesOrder, ReportDataset, ProductBrowseProfile, PublicOutlet):
        model.__table__.create(connection, checkfirst=True)
    for model in PLANNER_TABLES:
        model.__table__.create(connection, checkfirst=True)
    # 只有新匯入的公開通路允許缺業務、評級、付款條件；既有客戶的必要欄位以 CHECK 繼續保護。
    connection.exec_driver_sql("""ALTER TABLE customer
        ALTER COLUMN owner_user_id DROP NOT NULL,
        ALTER COLUMN grade DROP NOT NULL,
        ALTER COLUMN payment_term DROP NOT NULL;
        ALTER TABLE customer DROP CONSTRAINT IF EXISTS ck_customer_legacy_fields;
        ALTER TABLE customer ADD CONSTRAINT ck_customer_legacy_fields CHECK
            (type = 'outlet' OR (owner_user_id IS NOT NULL AND grade IS NOT NULL AND payment_term IS NOT NULL));
        CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_legacy_name ON customer(name) WHERE type <> 'outlet';
        ALTER TABLE customer DROP CONSTRAINT IF EXISTS uq_customer_name;
        ALTER TABLE customer DROP CONSTRAINT IF EXISTS ck_customer_type;
        ALTER TABLE customer ADD CONSTRAINT ck_customer_type CHECK (type IN ('chain','independent','clinic','outlet'));
    """)
    # 使用者明確核准全員共用業績、帳款、報價與已確認拜訪。重建查詢定義，不修改或刪除任何既有列。
    sql = SEMANTIC_LAYER.read_text()
    function = re.search(r"CREATE FUNCTION app_in_scope\(.*?\$\$;", sql, re.S)
    connection.exec_driver_sql(function.group().replace("CREATE FUNCTION ", "CREATE OR REPLACE FUNCTION "), execution_options={"no_parameters": True})
    for definition in re.finditer(r"CREATE VIEW (?:v_monthly_sales|v_customer_summary|v_visit_signal|v_margin_breakdown) AS.*?;", sql, re.S):
        connection.exec_driver_sql(definition.group().replace("CREATE VIEW ", "CREATE OR REPLACE VIEW "), execution_options={"no_parameters": True})
    connection.exec_driver_sql("""DO $$ BEGIN
        IF to_regclass('public.method_card') IS NOT NULL THEN
            ALTER TABLE method_card DROP CONSTRAINT IF EXISTS ck_method_card_customer_type;
            ALTER TABLE method_card ADD CONSTRAINT ck_method_card_customer_type CHECK (customer_type IN ('chain','independent','clinic','outlet'));
        END IF;
    END $$;""")
    connection.execute(update(AppSetting).where(AppSetting.key == "schema_version").values(value=expected))
    return f"已升級一般日曆、公開通路、商品偏好、匯入資料、訂單、課程與收藏表：{current} → {expected}；既有資料保留。"


if __name__ == "__main__":
    engine = make_engine()
    try:
        with engine.begin() as connection:
            print(upgrade(connection))
    finally:
        engine.dispose()
