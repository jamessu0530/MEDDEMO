"""已知版本的附加式升級；保留既有交易、帳號、報表與使用者設定。"""

import sys
import re
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import inspect, select, text, update  # noqa: E402
from sqlalchemy.engine import Connection  # noqa: E402

from app.db import make_engine, schema_version, SEMANTIC_LAYER, PRODUCT_CATALOG  # noqa: E402
from app.models import AppSetting, LearningCompletion, SapEmployee, MascotCollectible, MascotEncounter, MascotWardrobe, SalesOrder, ReportDataset, ProductBrowseProfile, ProductPhoto, PublicOutlet, OutletStorefront, PLANNER_TABLES  # noqa: E402
from app.services.product_photos import ensure_photo_table  # noqa: E402
from app.models import AssistantMemoryEntry, AssistantMemoryNode, AssistantTaskExecution  # noqa: E402
from app.models import ProductQueryEvent  # noqa: E402
from app.models import AttendanceEvent, WorkGoal  # noqa: E402

# 保留前一輪的升級起點，同時支援目前已部署版本新增訂單工作區。
# 未知版本不得自動重灌：新增升級路徑，或由維運明確選擇 workflow 的 reseed。
FROM_VERSION = "da9e482ae109"
PREVIOUS_VERSION = "20ea4eee38ef"
ORDERS_VERSION = "e5f5f7ae1005"
REPORTS_VERSION = "a04a685630e5"
PRODUCT_BROWSING_VERSION = "6214a6a90ab3"
PUBLIC_OUTLETS_VERSION = "a0627cc80f56"
PRE_CALENDAR_VERSION = "5222ff8c6a9e"
PRE_OA_VERSION = "1fe8ef6529d7"
PRE_CATALOG_CLEANUP_VERSION = "4b81265a2f52"
PRE_STOREFRONT_VERSION = "04fd21a6ec6e"
PRE_PRODUCT_PHOTOS_VERSION = "3789bb963999"
PRE_DEMO_PHOTOS_VERSION = "d81d24554fa4"
PRE_ACCOUNT_MEMORY_VERSION = "5f7bf8fd171e"
PRE_GHOST_VERSION = "c6e724970b10"
PRE_BUSINESS_REPORTS_VERSION = "dfd34c52f1f0"
PRE_CUSTOMER_INQUIRIES_VERSION = "64a83d29677f"
PRE_WORKPLACE_VERSION = "d73bdff86947"
PRE_TASKS_VERSION = "e1fbd025761b"
PRE_DEPLOYED_TASKS_VERSION = "4804e87a1e5e"
PRE_INQUIRY_MAP_VERSION = "dc5261b3e8e6"
TO_VERSION = "30dc533d81d0"


def upgrade_customer_columns(connection: Connection) -> None:
    """補齊舊客戶表的可空欄位；未知付款條件、地址區域與座標不造值。"""
    if not inspect(connection).has_table("customer"):
        return
    connection.exec_driver_sql("""ALTER TABLE customer
        ADD COLUMN IF NOT EXISTS area VARCHAR,
        ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS payment_term VARCHAR;
    """)
    PublicOutlet.__table__.create(connection, checkfirst=True)


def upgrade_customer_inquiries(connection: Connection) -> None:
    """只新增可空的客戶關聯，舊問題不回溯公開。"""
    if inspect(connection).has_table("ask_record"):
        connection.exec_driver_sql("ALTER TABLE ask_record ADD COLUMN IF NOT EXISTS customer_ids JSONB, ADD COLUMN IF NOT EXISTS inquiry_location JSONB")


def upgrade_oa_forms(connection: Connection) -> None:
    """只擴充既有 OA 表，不改全站版本；供尚有其他未升級功能的本機資料庫使用。"""
    inspector = inspect(connection)
    if not inspector.has_table("oa_expense_form"):
        return
    expected = {"id", "form_no", "customer_id", "visit_id", "trip_date", "applicant_id", "status", "purpose", "unit_name", "created_at", "submitted_at"}
    if not expected <= {column["name"] for column in inspector.get_columns("oa_expense_form")}:
        raise RuntimeError("OA 資料表結構不符，停止升級，不修改資料。")
    # OA 共用全站 AI 的課程資格查詢；舊出差單版本尚無此表。只建缺少的表，不新增或改寫過關紀錄。
    LearningCompletion.__table__.create(connection, checkfirst=True)
    SapEmployee.__table__.create(connection, checkfirst=True)
    connection.exec_driver_sql("""ALTER TABLE oa_expense_form
            ADD COLUMN IF NOT EXISTS kind VARCHAR NOT NULL DEFAULT 'trip',
            ADD COLUMN IF NOT EXISTS request_date DATE,
            ADD COLUMN IF NOT EXISTS payload JSONB,
            ADD COLUMN IF NOT EXISTS required_level VARCHAR NOT NULL DEFAULT 'manager',
            ADD COLUMN IF NOT EXISTS model_probability DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS model_features JSONB,
            ADD COLUMN IF NOT EXISTS auto_approved BOOLEAN NOT NULL DEFAULT false,
            ALTER COLUMN customer_id DROP NOT NULL,
            ALTER COLUMN visit_id DROP NOT NULL,
            ALTER COLUMN trip_date DROP NOT NULL;
        ALTER TABLE oa_expense_form DROP CONSTRAINT IF EXISTS ck_oa_expense_form_kind;
        ALTER TABLE oa_expense_form ADD CONSTRAINT ck_oa_expense_form_kind CHECK (kind IN ('trip','discount','contract','legacy'));
        ALTER TABLE oa_expense_form DROP CONSTRAINT IF EXISTS ck_oa_expense_form_kind_fields;
        ALTER TABLE oa_expense_form ADD CONSTRAINT ck_oa_expense_form_kind_fields CHECK (
            (kind = 'trip' AND customer_id IS NOT NULL AND visit_id IS NOT NULL AND trip_date IS NOT NULL AND payload IS NULL)
            OR (kind IN ('discount','contract') AND customer_id IS NOT NULL AND visit_id IS NULL AND trip_date IS NULL AND payload IS NOT NULL AND request_date IS NOT NULL)
            OR (kind = 'legacy' AND visit_id IS NULL AND trip_date IS NULL AND payload IS NOT NULL AND request_date IS NOT NULL)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_oa_expense_form_pending_contract
            ON oa_expense_form(customer_id) WHERE kind = 'contract' AND status = 'pending';
    """)


def upgrade(connection: Connection, target: str | None = None) -> str:
    expected = target or schema_version()
    connection.execute(text("SELECT pg_advisory_xact_lock(hashtext('meddemo-schema-upgrade'))"))
    current = connection.scalar(select(AppSetting.value).where(AppSetting.key == "schema_version").with_for_update())
    if current == expected:
        return "資料表已是目前版本，無須更新。"
    if current not in {FROM_VERSION, PREVIOUS_VERSION, ORDERS_VERSION, REPORTS_VERSION, PRODUCT_BROWSING_VERSION, PUBLIC_OUTLETS_VERSION, PRE_CALENDAR_VERSION, PRE_OA_VERSION, PRE_CATALOG_CLEANUP_VERSION, PRE_STOREFRONT_VERSION, PRE_PRODUCT_PHOTOS_VERSION, PRE_DEMO_PHOTOS_VERSION, PRE_ACCOUNT_MEMORY_VERSION, PRE_GHOST_VERSION, PRE_BUSINESS_REPORTS_VERSION, PRE_CUSTOMER_INQUIRIES_VERSION, PRE_WORKPLACE_VERSION, PRE_TASKS_VERSION, PRE_DEPLOYED_TASKS_VERSION, PRE_INQUIRY_MAP_VERSION} or expected != TO_VERSION:
        raise RuntimeError(f"沒有保留資料的升級路徑：{current or '未記錄版本'} → {expected}；停止部署，不重灌。")
    for model in (LearningCompletion, MascotWardrobe, MascotCollectible, MascotEncounter, SalesOrder, ReportDataset, ProductBrowseProfile, ProductPhoto, PublicOutlet, OutletStorefront, AssistantMemoryEntry, AssistantMemoryNode, AssistantTaskExecution):
        model.__table__.create(connection, checkfirst=True)
    ProductQueryEvent.__table__.create(connection, checkfirst=True)
    AttendanceEvent.__table__.create(connection, checkfirst=True)
    WorkGoal.__table__.create(connection, checkfirst=True)
    ensure_photo_table(connection)
    if inspect(connection).has_table("ask_record"):
        connection.exec_driver_sql("ALTER TABLE ask_record ADD COLUMN IF NOT EXISTS ghost boolean NOT NULL DEFAULT false")
    upgrade_customer_inquiries(connection)
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
    upgrade_oa_forms(connection)
    connection.exec_driver_sql("ALTER TABLE product ADD COLUMN IF NOT EXISTS common boolean NOT NULL DEFAULT false")
    connection.exec_driver_sql(PRODUCT_CATALOG.read_text(encoding="utf-8"), execution_options={"no_parameters": True})
    connection.exec_driver_sql("""DO $$ BEGIN
        IF to_regclass('public.method_card') IS NOT NULL THEN
            ALTER TABLE method_card DROP CONSTRAINT IF EXISTS ck_method_card_customer_type;
            ALTER TABLE method_card ADD CONSTRAINT ck_method_card_customer_type CHECK (customer_type IN ('chain','independent','clinic','outlet'));
        END IF;
    END $$;""")
    connection.execute(update(AppSetting).where(AppSetting.key == "schema_version").values(value=expected))
    return f"已升級藥品查詢統計、OA 模擬表單、一般日曆、公開通路、商品偏好、匯入資料、訂單、課程與收藏表：{current} → {expected}；既有資料保留。"


if __name__ == "__main__":
    engine = make_engine()
    try:
        with engine.begin() as connection:
            if "--customer-inquiries-only" in sys.argv:
                connection.execute(text("SELECT pg_advisory_xact_lock(hashtext('meddemo-schema-upgrade'))"))
                upgrade_customer_inquiries(connection)
                print("已新增客戶提問關聯，舊提問與全站 schema_version 保留，不回溯公開。")
            elif "--customer-columns-only" in sys.argv:
                connection.execute(text("SELECT pg_advisory_xact_lock(hashtext('meddemo-schema-upgrade'))"))
                upgrade_customer_columns(connection)
                print("已補齊客戶欄位；未知資料保留空白，全站版本與既有內容保留。")
            elif "--oa-only" in sys.argv:
                connection.execute(text("SELECT pg_advisory_xact_lock(hashtext('meddemo-schema-upgrade'))"))
                upgrade_oa_forms(connection)
                print("已擴充 OA 模擬表單，既有資料與全站 schema_version 保留。")
            else:
                print(upgrade(connection))
    finally:
        engine.dispose()
