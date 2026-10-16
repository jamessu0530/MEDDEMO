import datetime as dt

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.models import AppUser, Customer, Product, SalesTransaction
from app.services import auth, report_details, report_matrix, reports


METRICS = ["sales", "net_margin", "net_margin_rate", "order_count", "avg_order_value"]


def config(rows=None, columns=None, metrics=None, *, view=None, **changes):
    slicers = changes.get("slicers", [])
    if not any(item["dimension"] == "owner" for item in slicers):
        changes["slicers"] = [{"dimension": "owner", "keys": ["S1", "S2"]}, *slicers]
    rows = rows or ["owner", "customer_type", "customer"]
    columns = ["year", "quarter", "month"] if columns is None else columns
    metrics = metrics or METRICS
    card_changes = changes.pop("card", {})
    body = {
        "slicers": [{"dimension": "owner", "keys": ["S1", "S2"]}], "name": "矩陣驗收", "template": "manager", "period": "custom", "date_range": {"start": "2031-01-01", "end": "2031-04-17"},
        "cards": [{"id": "matrix", "title": "階層矩陣", "metric": metrics[0], "dimension": rows[0], "legend": columns[0] if columns else None,
            "visual": "matrix", "limit": 3, "matrix": {"rows": rows, "columns": columns, "metrics": metrics}, **card_changes}],
        "matrix_views": {"matrix": view or {"row_expand_depth": 3, "column_expand_depth": 3}}, **changes,
    }
    return reports.ReportQuery.model_validate(body)


def result(session, body, user="M1"):
    return reports.data(session, session.get(AppUser, user), body).cards[0]


def path(**filters):
    return [reports.ReportFilter(dimension=dimension, key=key) for dimension, key in filters.items()]


def cell(data, row=None, column=None):
    row_id, column_id = report_matrix.path_id(row or []), report_matrix.path_id(column or [])
    return next(item for item in data.cells if item.row_id == row_id and item.column_id == column_id)


def test_three_level_axes_multiple_measures_and_grand_totals(interaction_session):
    data = result(interaction_session, config()).matrix
    assert data.row_total == 8 and data.column_total == 7
    assert data.totals == {"sales": 1750, "net_margin": 875, "net_margin_rate": .5, "order_count": 5, "avg_order_value": 350}
    detail = cell(data, path(owner="S1", customer_type="clinic", customer="C1"), path(year="2031", quarter="2031-Q2", month="2031-04"))
    assert detail.values["sales"] == 400 and detail.values["net_margin"] == 200 and detail.row_count == 1
    assert cell(data, path(owner="S1")).values["sales"] == 750
    assert cell(data, column=path(year="2031", quarter="2031-Q1")).values["sales"] == 400
    empty = cell(data, path(owner="S1"), path(year="2031", quarter="2031-Q1", month="2031-02"))
    assert empty.values["sales"] == empty.values["order_count"] == 0
    assert empty.values["net_margin_rate"] is None and empty.values["avg_order_value"] is None and empty.row_count == 0


def test_subtotals_recalculate_distinct_orders_averages_and_weighted_rates(interaction_session):
    interaction_session.add(SalesTransaction(order_no="O1", customer_id="C1", date=dt.date(2031, 4, 17), sku="P2", qty=1, amount=100, cost=0, listing_fee=20, channel_reward=10))
    interaction_session.flush()
    data = result(interaction_session, config(rows=["customer"], columns=["product"], period="this_month", date_range=None)).matrix
    first = cell(data, path(customer="C1"), path(product="P1"))
    second = cell(data, path(customer="C1"), path(product="P2"))
    total = cell(data, path(customer="C1"))
    assert first.values["order_count"] == second.values["order_count"] == total.values["order_count"] == 1
    assert total.values["avg_order_value"] == 500 and total.values["net_margin_rate"] == .54
    assert data.totals["order_count"] == 3 and data.totals["avg_order_value"] == pytest.approx(1450 / 3)
    assert data.totals["net_margin_rate"] == pytest.approx(745 / 1450)


def test_default_collapsed_expansion_and_explicit_collapse_override(interaction_session):
    first = result(interaction_session, config(view={"row_expand_depth": 1, "column_expand_depth": 1})).matrix
    assert first.row_total == 2 and first.column_total == 1 and not any(node.expanded for node in first.rows)
    expanded = result(interaction_session, config(view={"expanded_rows": [[item.model_dump() for item in path(owner="S1")]], "column_expand_depth": 3})).matrix
    assert expanded.row_total == 4 and expanded.column_total == 7
    collapsed = result(interaction_session, config(view={"row_expand_depth": 3, "column_expand_depth": 3,
        "collapsed_rows": [[item.model_dump() for item in path(owner="S1")]], "collapsed_columns": [[item.model_dump() for item in path(year="2031")]]})).matrix
    assert collapsed.row_total == 4 and collapsed.column_total == 1


def test_no_column_axis_still_returns_each_measure_and_root_totals(interaction_session):
    data = result(interaction_session, config(rows=["customer"], columns=[])).matrix
    assert data.columns == [] and data.column_total == 0
    assert cell(data, path(customer="C2")).values["sales"] == 1000
    assert cell(data).values["sales"] == 1750


def test_empty_non_date_axes_return_correct_root_zeros_and_nulls(interaction_session):
    data = result(interaction_session, config(rows=["customer"], columns=["product"], filters=[{"dimension": "customer", "key": "missing"}])).matrix
    assert data.rows == data.columns == []
    assert data.totals["sales"] == 0 and data.totals["net_margin_rate"] is None


def test_paging_shows_all_groups_beyond_old_top_n_and_keeps_complete_totals(interaction_session):
    for index in range(31):
        customer = f"NEW{index:02}"
        interaction_session.add(Customer(id=customer, name=customer, type="clinic", region="北區", city="臺北", place_id="TPE", grade="A", owner_user_id="S1", area="中正", lat=25, lng=121, payment_term="RM06"))
        interaction_session.flush()
        interaction_session.add(SalesTransaction(order_no=customer, customer_id=customer, date=dt.date(2031, 4, 1), sku="P1", qty=1, amount=10, cost=5))
    interaction_session.flush()
    body = config(rows=["owner", "customer"], columns=["product"], period="this_month", date_range=None, view={"row_expand_depth": 2, "row_page_size": 25})
    first = result(interaction_session, body).matrix
    second = result(interaction_session, config(rows=["owner", "customer"], columns=["product"], period="this_month", date_range=None,
        view={"row_expand_depth": 2, "row_page_size": 25, "row_page": 2})).matrix
    assert first.row_total == second.row_total == 36 and len(first.rows) == 25 and len(second.rows) == 11
    assert not {node.id for node in first.rows} & {node.id for node in second.rows}
    assert first.totals["sales"] == second.totals["sales"] == 1660
    assert cell(first).values["order_count"] == cell(second).values["order_count"] == 34


def test_column_paging_has_no_other_bucket_and_grand_totals_ignore_current_page(interaction_session):
    for index in range(12):
        sku = f"NEW{index:02}"
        interaction_session.add(Product(sku=sku, name=sku, category="測試", spec="盒", unit="盒", unit_price=10, unit_cost=5))
        interaction_session.flush()
        interaction_session.add(SalesTransaction(order_no="BUNDLE", customer_id="C1", date=dt.date(2031, 4, 1), sku=sku, qty=1, amount=10, cost=5))
    interaction_session.flush()
    body = config(rows=["owner"], columns=["product"], view={"column_page_size": 5, "column_page": 2}, period="this_month", date_range=None)
    data = result(interaction_session, body).matrix
    assert data.column_total == 14 and data.column_page == 2 and len(data.columns) == 5
    assert all(node.id != "__other__" and node.label != "其他" for node in data.columns)
    assert data.totals["sales"] == 1470 and data.totals["order_count"] == 4


def test_show_subtotals_controls_values_without_changing_aggregates(interaction_session):
    data = result(interaction_session, config(card={"matrix": {"rows": ["owner", "customer_type", "customer"], "columns": ["year", "quarter", "month"], "metrics": METRICS, "show_subtotals": False}})).matrix
    assert any(node.expanded and not node.show_values for node in data.rows)
    assert all(not node.expanded for node in data.columns)
    assert data.totals["sales"] == 1750


def test_matrix_cell_full_prefix_filters_open_exact_rows_and_requested_measure(interaction_session):
    body = config()
    filters = [*path(owner="S1", customer_type="clinic", customer="C1"), *path(year="2031", quarter="2031-Q2", month="2031-04")]
    request = report_details.DetailsInput(config=body, card_id="matrix", point=reports.ReportSelectionPoint(filters=filters, label="C1 四月", metric="net_margin_rate"))
    detail = report_details.details(interaction_session, interaction_session.get(AppUser, "M1"), request)
    assert detail.total_rows == 1 and detail.total == .5 and detail.metric == "net_margin_rate"
    assert detail.rows[0].values["order"] == "O1"


def test_row_grand_total_column_selection_does_not_require_outer_row_dimension(interaction_session):
    body = config()
    point = reports.ReportSelectionPoint(filters=path(year="2031", quarter="2031-Q1", month="2031-01"), label="一月總計")
    raw = report_details.details(interaction_session, interaction_session.get(AppUser, "M1"), report_details.DetailsInput(config=body, card_id="matrix", point=point))
    assert raw.total == 400 and raw.total_rows == 2


def test_full_matrix_cell_predicate_links_other_charts_without_losing_hierarchy(interaction_session):
    body = config()
    body.cards.append(reports.ReportCard(id="target", title="接受圖", metric="sales", dimension="none", visual="kpi"))
    body = reports.ReportQuery.model_validate(body.model_dump() | {"selection_groups": [{"source_id": "matrix", "points": [{"label": "C1 四月", "filters": [item.model_dump() for item in [*path(owner="S1", customer_type="clinic", customer="C1"), *path(year="2031", quarter="2031-Q2", month="2031-04")]]}]}]})
    data = reports.data(interaction_session, interaction_session.get(AppUser, "M1"), body)
    assert data.cards[0].total == 1750 and data.cards[1].total == 400


def test_view_owner_paths_outside_permission_rejected(interaction_session):
    body = config(view={"expanded_rows": [[item.model_dump() for item in path(owner="UNKNOWN_OWNER")]]})
    with pytest.raises(reports.OwnerNotAllowed):
        result(interaction_session, body)
    assert result(interaction_session, config(), user="S1").matrix.totals["sales"] == 1750


def test_compare_all_cell_metrics_with_same_current_shape_and_period_shift(interaction_session):
    interaction_session.add(SalesTransaction(order_no="PRIOR", customer_id="C1", date=dt.date(2031, 3, 10), sku="P1", qty=1, amount=200, cost=50))
    interaction_session.flush()
    data = result(interaction_session, config(card={"comparison": "previous_month"})).matrix
    current = cell(data, path(owner="S1", customer_type="clinic", customer="C1"), path(year="2031", quarter="2031-Q2", month="2031-04"))
    assert current.comparisons["sales"].previous == 200 and current.comparisons["sales"].relative_change == 1
    assert current.comparisons["net_margin_rate"].previous == .75 and current.comparisons["net_margin_rate"].delta == -.25
    assert current.comparisons["order_count"].previous == 1


def test_highlight_matrix_keeps_original_nodes_and_recalculates_subsets(interaction_session):
    body = config(card={"interaction": "highlight"})
    body.cards.append(reports.ReportCard(id="selector", title="客戶", metric="sales", dimension="customer", visual="bar"))
    body = reports.ReportQuery.model_validate(body.model_dump() | {"selection_groups": [{"source_id": "selector", "points": [{"label": "C1", "filters": [{"dimension": "customer", "key": "C1"}]}]}]})
    data = result(interaction_session, body)
    assert data.matrix.totals["sales"] == 1750 and data.highlight.matrix.totals["sales"] == 500
    assert [node.id for node in data.matrix.rows] == [node.id for node in data.highlight.matrix.rows]
    assert cell(data.highlight.matrix, path(owner="S2")).values["sales"] == 0


@pytest.mark.parametrize("changes", [
    {"rows": ["owner", "owner"]}, {"rows": ["owner"], "columns": ["owner"]},
    {"rows": []}, {"rows": ["owner", "customer", "product", "month"]},
    {"metrics": ["sales", "visits"]}, {"metrics": ["sales", "sales"]},
    {"metrics": ["customers"], "rows": ["month"]},
])
def test_invalid_matrix_schema_rejected(changes):
    with pytest.raises(ValidationError):
        reports.MatrixOptions.model_validate({"rows": ["owner"], "columns": ["product"], "metrics": ["sales"], **changes})


@pytest.mark.parametrize("view", [
    {"expanded_rows": [[{"dimension": "customer", "key": "C1"}]]},
    {"expanded_columns": [[{"dimension": "month", "key": "2031-01"}]]},
    {"row_page_size": 101}, {"column_page_size": 26}, {"row_page": 0},
])
def test_invalid_view_prefix_or_page_rejected(view):
    with pytest.raises(ValidationError):
        config(view=view)


def test_matrix_options_save_but_temporary_views_do_not_persist(interaction_session):
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {auth.create_token(interaction_session.get(AppUser, 'M1'))}"}
    body = config()
    payload = body.model_dump(mode="json")
    assert client.post("/api/reports/data", headers=headers, json=payload).status_code == 200
    assert client.put("/api/reports/config", headers=headers, json=payload).status_code == 422
    for key in ("selection_groups", "drill_filters", "matrix_views"):
        payload.pop(key)
    assert client.put("/api/reports/config", headers=headers, json=payload).status_code == 200
    assert client.get("/api/reports", headers=headers).json()["config"]["cards"][0]["matrix"]["metrics"] == METRICS
