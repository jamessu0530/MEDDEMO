import pytest
from sqlalchemy import func, inspect, select

from app.db import schema_version
from app.models import AppSetting, LearningCompletion, SalesTransaction, UserReportConfig
from scripts.upgrade_schema import PRE_ACCOUNT_MEMORY_VERSION, PRE_GHOST_VERSION, PRE_BUSINESS_REPORTS_VERSION, PRE_CUSTOMER_INQUIRIES_VERSION, PRE_WORKPLACE_VERSION, PRE_TASKS_VERSION, PRE_DEPLOYED_TASKS_VERSION, PRE_INQUIRY_MAP_VERSION
from scripts.upgrade_schema import FROM_VERSION, PREVIOUS_VERSION, ORDERS_VERSION, REPORTS_VERSION, PRODUCT_BROWSING_VERSION, PUBLIC_OUTLETS_VERSION, PRE_CALENDAR_VERSION, PRE_OA_VERSION, PRE_CATALOG_CLEANUP_VERSION, PRE_STOREFRONT_VERSION, PRE_PRODUCT_PHOTOS_VERSION, PRE_DEMO_PHOTOS_VERSION, TO_VERSION, upgrade


def test_additive_upgrade_preserves_transactions_reports_and_existing_progress(interaction_session):
    s = interaction_session
    s.add(AppSetting(key="schema_version", value=FROM_VERSION))
    saved = {"name": "保留使用者內容", "custom": [1, 2, 3]}
    s.add(UserReportConfig(user_id="S1", config=saved)); s.flush()
    before = s.scalar(select(func.count()).select_from(SalesTransaction))
    result = upgrade(s.connection())
    assert "既有資料保留" in result
    assert s.scalar(select(func.count()).select_from(SalesTransaction)) == before == 6
    s.expire_all()
    assert s.get(UserReportConfig, "S1").config == saved
    assert s.get(AppSetting, "schema_version").value == TO_VERSION == schema_version()
    assert {"sales_order", "learning_completion", "mascot_wardrobe", "mascot_collectible", "mascot_encounter", "attendance_event", "work_goal"} <= set(inspect(s.connection()).get_table_names())
    s.add(LearningCompletion(user_id="S1", lesson_id="customer-v1")); s.flush()
    assert "無須更新" in upgrade(s.connection())
    assert s.get(LearningCompletion, ("S1", "customer-v1")) is not None


@pytest.mark.parametrize("version", [PREVIOUS_VERSION, ORDERS_VERSION, REPORTS_VERSION, PRODUCT_BROWSING_VERSION, PUBLIC_OUTLETS_VERSION, PRE_CALENDAR_VERSION, PRE_OA_VERSION, PRE_CATALOG_CLEANUP_VERSION, PRE_STOREFRONT_VERSION, PRE_PRODUCT_PHOTOS_VERSION, PRE_DEMO_PHOTOS_VERSION, PRE_ACCOUNT_MEMORY_VERSION, PRE_GHOST_VERSION, PRE_BUSINESS_REPORTS_VERSION, PRE_CUSTOMER_INQUIRIES_VERSION, PRE_WORKPLACE_VERSION, PRE_TASKS_VERSION, PRE_DEPLOYED_TASKS_VERSION, PRE_INQUIRY_MAP_VERSION])
def test_current_deployed_schema_can_upgrade_without_reseeding(interaction_session, version):
    s = interaction_session
    s.add(AppSetting(key="schema_version", value=version)); s.flush()
    assert "既有資料保留" in upgrade(s.connection())
    assert "sales_order" in inspect(s.connection()).get_table_names()
    assert "report_dataset" in inspect(s.connection()).get_table_names()
    assert "product_browse_profile" in inspect(s.connection()).get_table_names()
    assert "product_query_event" in inspect(s.connection()).get_table_names()
    assert "public_outlet" in inspect(s.connection()).get_table_names()
    assert "outlet_storefront" in inspect(s.connection()).get_table_names()
    assert "product_photo" in inspect(s.connection()).get_table_names()
    assert {"assistant_memory_entry", "assistant_memory_node"} <= set(inspect(s.connection()).get_table_names())
    assert {"planner_calendar", "planner_member", "planner_event", "planner_attendee", "planner_notification", "planner_push_subscription"} <= set(inspect(s.connection()).get_table_names())
    assert s.scalar(select(func.count()).select_from(SalesTransaction)) == 6


@pytest.mark.parametrize("current,target", [("unknown", TO_VERSION), (FROM_VERSION, "future"), (None, TO_VERSION)])
def test_unknown_upgrade_never_changes_version_or_user_data(interaction_session, current, target):
    s = interaction_session
    if current: s.add(AppSetting(key="schema_version", value=current))
    s.flush()
    before = s.scalar(select(func.count()).select_from(SalesTransaction))
    with pytest.raises(RuntimeError, match="停止部署，不重灌"):
        upgrade(s.connection(), target)
    assert s.scalar(select(func.count()).select_from(SalesTransaction)) == before
    s.expire_all()
    row = s.get(AppSetting, "schema_version")
    assert (row.value if row else None) == current


def test_orders_schema_upgrade_keeps_legacy_constraints_and_allows_unassigned_public_outlets(interaction_session):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError
    from app.models import Customer
    s = interaction_session
    # Reconstruct the deployed customer's constraints, rather than testing only the new metadata.
    s.execute(text("DROP INDEX uq_customer_legacy_name"))
    s.execute(text("ALTER TABLE customer DROP CONSTRAINT ck_customer_legacy_fields"))
    s.execute(text("ALTER TABLE customer ADD CONSTRAINT uq_customer_name UNIQUE(name)"))
    for column in ("owner_user_id", "grade", "payment_term"):
        s.execute(text(f"ALTER TABLE customer ALTER COLUMN {column} SET NOT NULL"))
    s.add(AppSetting(key="schema_version", value=ORDERS_VERSION)); s.flush()
    assert "既有資料保留" in upgrade(s.connection())
    assert s.scalar(select(func.count()).select_from(SalesTransaction)) == 6
    public = dict(type="outlet", name="公開同名藥局", region="北區", city="臺北", place_id="TPE", area="中正", lat=25, lng=121)
    s.add_all([Customer(id="OUT-A", **public), Customer(id="OUT-B", **public)]); s.flush()
    assert s.get(Customer, "OUT-A").owner_user_id is None
    with pytest.raises(IntegrityError):
        with s.begin_nested():
            s.add(Customer(id="BROKEN-LEGACY", **{**public, "type": "clinic", "name": "未完成的舊型客戶"})); s.flush()
    assert s.get(Customer, "C1").owner_user_id == "S1"


def test_ghost_upgrade_preserves_existing_queries_as_normal_conversations(interaction_session):
    from sqlalchemy import text
    from app.models import AskRecord
    s = interaction_session
    AskRecord.__table__.create(s.connection(), checkfirst=True)
    s.add(AskRecord(id="keep-query", user_id="S1", kind="knowledge", question="保留的問題", status="answered"))
    s.flush()
    s.execute(text("ALTER TABLE ask_record DROP COLUMN ghost"))
    s.add(AppSetting(key="schema_version", value=PRE_GHOST_VERSION))
    s.flush()
    upgrade(s.connection())
    s.expire_all()
    record = s.get(AskRecord, "keep-query")
    assert record.question == "保留的問題"
    assert record.ghost is False


def test_customer_inquiry_upgrade_preserves_queries_without_sharing_old_history(interaction_session):
    from sqlalchemy import text
    from app.models import AskRecord
    s = interaction_session
    AskRecord.__table__.create(s.connection(), checkfirst=True)
    s.add(AskRecord(id="private-old-query", user_id="S1", kind="knowledge", question="既有客戶問題", status="answered"))
    s.flush()
    s.execute(text("ALTER TABLE ask_record DROP COLUMN customer_ids"))
    s.add(AppSetting(key="schema_version", value=PRE_CUSTOMER_INQUIRIES_VERSION))
    s.flush()
    upgrade(s.connection())
    s.expire_all()
    saved = s.get(AskRecord, "private-old-query")
    assert saved.question == "既有客戶問題" and saved.customer_ids is None


def test_inquiry_map_upgrade_preserves_questions_without_inventing_locations(interaction_session):
    from sqlalchemy import text
    from app.models import AskRecord
    s = interaction_session
    AskRecord.__table__.create(s.connection(), checkfirst=True)
    s.add(AskRecord(id="without-gps", user_id="S1", kind="data", question="舊提問", customer_ids=["C1"], status="answered"))
    s.flush()
    s.execute(text("ALTER TABLE ask_record DROP COLUMN inquiry_location"))
    s.add(AppSetting(key="schema_version", value=PRE_INQUIRY_MAP_VERSION)); s.flush()
    upgrade(s.connection())
    s.expire_all()
    row = s.get(AskRecord, "without-gps")
    assert row.question == "舊提問" and row.customer_ids == ["C1"] and row.inquiry_location is None
