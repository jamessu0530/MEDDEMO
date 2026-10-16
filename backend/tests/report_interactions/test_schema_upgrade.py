import pytest
from sqlalchemy import func, inspect, select

from app.db import schema_version
from app.models import AppSetting, LearningCompletion, SalesTransaction, UserReportConfig
from scripts.upgrade_schema import FROM_VERSION, PREVIOUS_VERSION, TO_VERSION, upgrade


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
    assert {"sales_order", "learning_completion", "mascot_wardrobe", "mascot_collectible", "mascot_encounter"} <= set(inspect(s.connection()).get_table_names())
    s.add(LearningCompletion(user_id="S1", lesson_id="customer-v1")); s.flush()
    assert "無須更新" in upgrade(s.connection())
    assert s.get(LearningCompletion, ("S1", "customer-v1")) is not None


def test_current_deployed_schema_can_upgrade_without_reseeding(interaction_session):
    s = interaction_session
    s.add(AppSetting(key="schema_version", value=PREVIOUS_VERSION)); s.flush()
    assert "既有資料保留" in upgrade(s.connection())
    assert "sales_order" in inspect(s.connection()).get_table_names()
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
