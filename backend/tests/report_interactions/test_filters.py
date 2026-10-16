import datetime as dt
import json

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.models import AppUser, SalesTransaction, UserReportConfig, Visit
from app.services import auth, reports


def config(card_changes=None, **changes):
    slicers = changes.get("slicers", [])
    if not any(item["dimension"] == "owner" for item in slicers):
        changes["slicers"] = [{"dimension": "owner", "keys": ["S1", "S2"]}, *slicers]
    return reports.ReportConfig.model_validate({
        "slicers": [{"dimension": "owner", "keys": ["S1", "S2"]}], "name": "篩選驗收", "template": "manager", "period": "this_month",
        "cards": [{"id": "total", "title": "業績", "metric": "sales", "dimension": "none", "visual": "kpi", **(card_changes or {})}],
        **changes,
    })


def data(session, body, user="M1"):
    return reports.data(session, session.get(AppUser, user), body)


@pytest.mark.parametrize(("dimension", "keys", "total"), [
    ("owner", ["S1", "S2"], 1350),
    ("customer", ["C1", "C2"], 1100),
    ("product", ["P1", "P2"], 1350),
    ("customer_type", ["clinic", "independent"], 1100),
])
def test_slicer_values_use_union_within_one_dimension(interaction_session, dimension, keys, total):
    body = config(slicers=[{"dimension": dimension, "keys": keys}])
    assert data(interaction_session, body).cards[0].total == total


def test_report_page_and_card_conditions_all_intersect(interaction_session):
    body = config(card_changes={"slicers": [{"dimension": "product", "keys": ["P1"]}]},
        slicers=[{"dimension": "owner", "keys": ["S1", "S2"]}],
        pages=[{"id": "overview", "name": "分頁", "slicers": [{"dimension": "customer", "keys": ["C1", "C4"]}]}])
    assert data(interaction_session, body).cards[0].total == 400


def test_same_dimension_on_different_layers_is_intersection_not_override(interaction_session):
    body = config(slicers=[{"dimension": "owner", "keys": ["S1"]}],
        pages=[{"id": "overview", "name": "分頁", "slicers": [{"dimension": "owner", "keys": ["S2"]}]}])
    assert data(interaction_session, body).cards[0].total == 0


def test_page_filter_only_affects_cards_assigned_to_that_page(interaction_session):
    body = config(slicers=[{"dimension": "owner", "keys": ["S1"]}], pages=[
        {"id": "overview", "name": "有條件", "slicers": [{"dimension": "customer", "keys": ["C1"]}]},
        {"id": "all", "name": "未篩選"},
    ])
    body.cards.append(body.cards[0].model_copy(update={"id": "other", "page_id": "all"}))
    assert [item.total for item in data(interaction_session, body).cards] == [400, 650]


def test_legacy_single_filters_remain_intersected_with_new_multi_filters(interaction_session):
    body = config(owner_id="S1", slicers=[{"dimension": "owner", "keys": ["S2"]}])
    assert data(interaction_session, body).cards[0].total == 0


def test_custom_dates_use_exact_days_and_preserve_months(interaction_session):
    body = config(card_changes={"visual": "line", "dimension": "month"}, period="custom", date_range={"start": "2031-01-15", "end": "2031-04-10"})
    result = data(interaction_session, body)
    assert result.start == dt.date(2031, 1, 15) and result.end == dt.date(2031, 4, 10)
    assert result.cards[0].total == 1350
    assert [item.value for item in result.cards[0].points] == [400, 0, 0, 950]


def test_report_page_and_card_dates_intersect_and_exclude_future_records(interaction_session):
    interaction_session.add(SalesTransaction(order_no="FUTURE", customer_id="C1", date=dt.date(2031, 4, 18), sku="P1", qty=1, amount=999, cost=0))
    interaction_session.flush()
    body = config(card_changes={"date_range": {"start": "2031-04-10", "end": "2031-04-17"}},
        period="custom", date_range={"start": "2031-01-01", "end": "2031-04-30"},
        pages=[{"id": "overview", "name": "分頁", "date_range": {"start": "2031-04-03", "end": "2031-04-16"}}])
    result = data(interaction_session, body)
    assert result.end == dt.date(2031, 4, 17)
    assert result.cards[0].total == 250


def test_disjoint_dates_return_empty_points_instead_of_fabricated_months(interaction_session):
    body = config(card_changes={"dimension": "month", "visual": "line", "date_range": {"start": "2031-04-15", "end": "2031-04-17"}},
        pages=[{"id": "overview", "name": "分頁", "date_range": {"start": "2031-04-01", "end": "2031-04-10"}}])
    result = data(interaction_session, body).cards[0]
    assert result.total == 0 and result.points == []
    assert "日期沒有交集" in result.note


def test_custom_visit_days_use_taipei_midnight_and_actual_visitor_scope(interaction_session):
    for index, (timestamp, user) in enumerate((
        ("2031-04-09T16:00:00+00:00", "S1"),
        ("2031-04-10T15:59:59+00:00", "S1"),
        ("2031-04-10T16:00:00+00:00", "S1"),
        ("2031-04-10T08:00:00+00:00", "S3"),
    )):
        interaction_session.add(Visit(id=f"V{index}", user_id=user, customer_id="C1", visited_at=dt.datetime.fromisoformat(timestamp), status="confirmed"))
    interaction_session.flush()
    body = config(card_changes={"metric": "visits"}, period="custom", date_range={"start": "2031-04-10", "end": "2031-04-10"})
    assert data(interaction_session, body).cards[0].total == 2


def test_snapshot_ignores_date_and_unrelated_product_but_applies_customer_slicer(interaction_session):
    body = config(card_changes={"metric": "customers", "date_range": {"start": "2001-01-01", "end": "2001-01-02"}},
        period="custom", date_range={"start": "2002-01-01", "end": "2002-01-02"},
        slicers=[{"dimension": "product", "keys": ["P1"]}],
        pages=[{"id": "overview", "name": "分頁", "slicers": [{"dimension": "customer", "keys": ["C1"]}]}])
    card = data(interaction_session, body).cards[0]
    assert card.total == 1 and "商品篩選未套用" in card.note and "不受期間篩選" in card.note


@pytest.mark.parametrize("level", ["report", "page", "card"])
def test_every_layer_rejects_owner_keys_outside_permission(interaction_session, level):
    slicer = {"dimension": "owner", "keys": ["S1", "UNKNOWN_OWNER"]}
    changes = {"slicers": [slicer]} if level == "report" else {"pages": [{"id": "overview", "name": "分頁", "slicers": [slicer]}]} if level == "page" else {}
    body = config(card_changes={"slicers": [slicer]} if level == "card" else None, **changes)
    with pytest.raises(reports.OwnerNotAllowed):
        data(interaction_session, body)
    with pytest.raises(reports.OwnerNotAllowed):
        reports.save_config(interaction_session, interaction_session.get(AppUser, "M1"), body)


def test_customer_slicer_with_outside_ids_or_sql_text_never_expands_scope(interaction_session):
    body = config(slicers=[{"dimension": "customer", "keys": ["C3", "' OR 1=1 --"]}])
    assert data(interaction_session, body).cards[0].total == 0


def test_filter_choices_and_ai_context_are_scoped_to_actual_user(interaction_session):
    user = interaction_session.get(AppUser, "S1")
    options = reports.filter_options(interaction_session, user)
    assert {item.key for item in options.customer} == {"C1", "C2", "C3", "C4"}
    assert {item.key for item in options.owner} == {"S1", "S2", "S3"}
    assert {item.key for item in options.product} == {"P1", "P2"}
    class LLM:
        def json(self, **kwargs):
            payload = json.loads(kwargs["prompt"])
            assert {item["key"] for item in payload["filter_options"]["customer"]} == {"C1", "C2", "C3", "C4"}
            assert payload["as_of"] == "2031-04-17"
            return {"kind": "clarify", "message": "請指定日期", "config": None}
    assert reports.adjust(interaction_session, user, "調整日期", config(), llm=LLM()).kind == "clarify"


def test_dates_slicers_and_page_filters_roundtrip_without_changing_old_keys(interaction_session):
    user = interaction_session.get(AppUser, "M1")
    body = config(period="custom", date_range={"start": "2031-01-01", "end": "2031-04-17"},
        slicers=[{"dimension": "customer", "keys": ["C1", "C2"]}],
        pages=[{"id": "overview", "name": "分頁", "filters": [{"dimension": "product", "key": "P1"}], "slicers": [{"dimension": "owner", "keys": ["S1", "S2"]}]}])
    reports.save_config(interaction_session, user, body)
    assert reports.get_config(interaction_session, user).model_dump() == body.model_dump()
    client = TestClient(app)
    response = client.get("/api/reports", headers={"Authorization": f"Bearer {auth.create_token(user)}"})
    assert response.status_code == 200 and response.json()["as_of"] == "2031-04-17"
    assert {item["key"] for item in response.json()["filter_options"]["customer"]} == {"C1", "C2", "C3", "C4"}


def test_stale_multi_owner_filters_are_removed_at_every_layer_after_org_change(interaction_session):
    user = interaction_session.get(AppUser, "M1")
    body = config(card_changes={"slicers": [{"dimension": "owner", "keys": ["S2"]}]},
        slicers=[{"dimension": "owner", "keys": ["S1", "S2"]}],
        pages=[{"id": "overview", "name": "分頁", "slicers": [{"dimension": "owner", "keys": ["S2"]}]}])
    interaction_session.add(UserReportConfig(user_id="M1", config=body.model_dump(mode="json")))
    moved = interaction_session.get(AppUser, "S2")
    moved.manager_id, moved.org_path = "M2", "TW.N.M2.S2"
    interaction_session.flush()
    loaded = reports.get_config(interaction_session, user)
    assert loaded.slicers[0].keys == ["S1", "S2"] and loaded.pages[0].slicers[0].keys == ["S2"] and loaded.cards[0].slicers[0].keys == ["S2"]


@pytest.mark.parametrize("changes", [
    {"period": "custom"},
    {"period": "custom", "date_range": {"start": "2031-04-18", "end": "2031-04-17"}},
    {"period": "custom", "date_range": {"start": "2031-02-30", "end": "2031-04-17"}},
    {"period": "custom", "date_range": {"start": "2001-01-01", "end": "2031-04-17"}},
    {"slicers": [{"dimension": "owner", "keys": []}]},
    {"slicers": [{"dimension": "owner", "keys": ["S1", " S1 "]}]},
    {"slicers": [{"dimension": "customer_type", "keys": ["unknown"]}]},
    {"slicers": [{"dimension": "month", "keys": ["2031-13"]}]},
    {"slicers": [{"dimension": "owner", "keys": ["S1"]}, {"dimension": "owner", "keys": ["S2"]}]},
    {"pages": [{"id": "overview", "name": "頁", "date_range": {"start": "2031-04-10", "end": "2031-04-01"}}]},
])
def test_invalid_dates_and_multi_filters_are_rejected(changes):
    with pytest.raises(ValidationError):
        config(**changes)
