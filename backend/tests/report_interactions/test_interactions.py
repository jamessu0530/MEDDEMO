"""驗證聯動選取的真實 SQL 金額、成對條件、對齊與權限。"""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.models import AppUser
from app.services import auth, reports


def point(**filters):
    return {"label": " / ".join(filters.values()), "filters": [{"dimension": dimension, "key": key} for dimension, key in filters.items()]}


def query(points=None, *, interaction="filter", period="this_month", filters=None, groups=None):
    return reports.ReportQuery.model_validate({
        "slicers": [{"dimension": "owner", "keys": ["S1", "S2"]}], "name": "聯動測試", "template": "manager", "period": period,
        "filters": filters or [],
        "cards": [
            {"id": "source", "title": "來源", "metric": "sales", "dimension": "month", "legend": "owner", "visual": "stacked_column"},
            {"id": "target", "title": "接收圖", "metric": "sales", "dimension": "customer", "visual": "column", "interaction": interaction},
        ],
        "selection_groups": groups if groups is not None else [{"source_id": "source", "points": points or [point(month="2031-04", owner="S1")]}],
    })


def result(session, report, user="M1"):
    return reports.data(session, session.get(AppUser, user), report).cards


def test_series_selection_applies_both_dimensions_and_preserves_source_choices(interaction_session):
    source, target = result(interaction_session, query())
    assert source.total == 1350
    assert {item.key for item in source.series} == {"S1", "S2"}
    assert target.total == 650
    assert {item.key for item in target.points} == {"C1", "C4"}


def test_same_source_uses_union_of_exact_pairs_not_cartesian_values(interaction_session):
    _, target = result(interaction_session, query([point(month="2031-04", owner="S1"), point(month="2031-01", owner="S2")], period="six_months"))
    assert target.total == 950  # 650＋300；不應混入一月 S1 或四月 S2。


def test_different_sources_intersect_and_source_only_skips_its_own_group(interaction_session):
    report = query(groups=[])
    report.cards.append(reports.ReportCard(id="customers", title="客戶", metric="sales", dimension="customer", visual="bar"))
    report = reports.ReportQuery.model_validate(report.model_dump() | {"selection_groups": [
        {"source_id": "source", "points": [point(month="2031-04", owner="S1")]},
        {"source_id": "customers", "points": [point(customer="C2")]},
    ]})
    source, target, customers = result(interaction_session, report)
    assert source.total == 700
    assert target.total == 0
    assert customers.total == 650


def test_fixed_filters_are_intersected_even_when_interactions_disabled(interaction_session):
    report = query(interaction="none", filters=[{"dimension": "owner", "key": "S2"}])
    _, target = result(interaction_session, report)
    assert target.total == 700 and target.highlight is None


def test_highlight_keeps_original_total_order_and_zero_fills_real_selected_values(interaction_session):
    _, target = result(interaction_session, query(interaction="highlight"))
    assert target.total == 1350 and target.highlight.total == 650
    assert [item.key for item in target.points] == ["C2", "C1", "C4"]
    assert [(item.key, item.value) for item in target.highlight.points] == [("C2", 0), ("C1", 400), ("C4", 250)]


def test_highlight_aligns_matrix_series_and_cells(interaction_session):
    report = query(interaction="highlight")
    report.cards[1] = reports.ReportCard(id="target", title="矩陣", metric="sales", dimension="customer_type", legend="product", visual="matrix", interaction="highlight")
    _, target = result(interaction_session, report)
    assert [item.key for item in target.highlight.series] == [item.key for item in target.series]
    assert sum(point.value for item in target.highlight.series for point in item.points) == 650
    assert all([point.key for point in item.points] == [point.key for point in target.points] for item in target.highlight.series)


def test_unknown_owner_selection_is_rejected(interaction_session):
    with pytest.raises(reports.OwnerNotAllowed):
        result(interaction_session, query([point(month="2031-04", owner="UNKNOWN_OWNER")]))
    with pytest.raises(reports.OwnerNotAllowed):
        result(interaction_session, query([point(month="2031-04", owner="UNKNOWN_OWNER")]), user="S1")


@pytest.mark.parametrize("customer", ["C3", "' OR 1=1 --"])
def test_customer_selection_never_expands_scope_or_executes_sql(interaction_session, customer):
    report = query(groups=[])
    report.cards[0] = reports.ReportCard(id="source", title="客戶", metric="sales", dimension="customer", visual="bar")
    report = reports.ReportQuery.model_validate(report.model_dump() | {"selection_groups": [{"source_id": "source", "points": [point(customer=customer)]}]})
    assert result(interaction_session, report)[1].total == 0


def test_unrelated_month_selection_does_not_fabricate_customer_history(interaction_session):
    report = query([point(month="2031-04", owner="S1")])
    report.cards[1] = reports.ReportCard(id="target", title="客戶數", metric="customers", dimension="none", visual="kpi")
    target = result(interaction_session, report)[1]
    assert target.total == 2
    assert "月份篩選未套用" in target.note


def test_clearing_selection_restores_base_data(interaction_session):
    assert result(interaction_session, query(groups=[]))[1].total == 1350


@pytest.mark.parametrize("group", [
    {"source_id": "missing", "points": [point(month="2031-04")]},
    {"source_id": "source", "points": [point(customer="C1")]},
    {"source_id": "source", "points": [point(month="2031-04", owner="__other__")]},
    {"source_id": "source", "points": [point(month="2031-04"), point(month="2031-04")]},
])
def test_invalid_and_duplicate_selection_is_rejected(group):
    with pytest.raises(ValidationError):
        query(groups=[group])


def test_api_accepts_query_selection_but_refuses_to_persist_temporary_selection(interaction_session):
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {auth.create_token(interaction_session.get(AppUser, 'M1'))}"}
    payload = query().model_dump(mode="json")
    response = client.post("/api/reports/data", json=payload, headers=headers)
    assert response.status_code == 200 and response.json()["cards"][1]["total"] == 650
    assert client.put("/api/reports/config", json=payload, headers=headers).status_code == 422
    payload.pop("selection_groups")
    payload.pop("drill_filters")
    payload.pop("matrix_views")
    payload.pop("canvas_selections")
    payload.pop("navigation_page")
    payload.pop("navigation_filters")
    assert client.put("/api/reports/config", json=payload, headers=headers).status_code == 200
    saved = client.get("/api/reports", headers=headers)
    assert saved.status_code == 200 and "selection_groups" not in saved.json()["config"]
