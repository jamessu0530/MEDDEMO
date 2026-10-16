import datetime as dt

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.models import AppSetting, AppUser, Product, SalesTransaction, Visit
from app.services import auth, report_details, reports


def config(metric="sales", card=None, **changes):
    slicers = changes.get("slicers", [])
    if not any(item["dimension"] == "owner" for item in slicers):
        changes["slicers"] = [{"dimension": "owner", "keys": ["S1", "S2"]}, *slicers]
    return reports.ReportQuery.model_validate({
        "slicers": [{"dimension": "owner", "keys": ["S1", "S2"]}], "name": "指標驗收", "template": "manager", "period": "this_month",
        "cards": [{"id": "target", "title": "指標", "metric": metric, "dimension": "none", "visual": "kpi", **(card or {})}],
        **changes,
    })


def result(session, body, user="M1"):
    return reports.data(session, session.get(AppUser, user), body).cards[-1]


def transaction(session, name, date, amount, *, customer="C1", cost=0, sku="P1", fee=0, reward=0):
    session.add(SalesTransaction(order_no=name, customer_id=customer, date=dt.date.fromisoformat(date), sku=sku, qty=1,
        amount=amount, cost=cost, listing_fee=fee, channel_reward=reward))
    session.flush()


def seed_previous(session):
    transaction(session, "PREV1", "2031-03-17", 200, cost=80, fee=20, reward=10)
    transaction(session, "PREV2", "2031-03-01", 100, customer="C2", cost=50)
    transaction(session, "PREV3", "2031-03-05", 200, customer="C4", cost=50)
    transaction(session, "TOO-LATE", "2031-03-18", 999)
    transaction(session, "OUTSIDE", "2031-03-01", 999, customer="C3")


@pytest.mark.parametrize(("metric", "expected"), [("order_count", 3), ("avg_order_value", 1450 / 3), ("net_margin_rate", 745 / 1450)])
def test_new_metrics_use_one_scope_and_deduplicate_order_items(interaction_session, metric, expected):
    transaction(interaction_session, "O1", "2031-04-17", 100, sku="P2", fee=20, reward=10)
    data = result(interaction_session, config(metric))
    assert data.total == pytest.approx(expected) and data.row_count == 4
    assert "加總" in data.note or "計一次" in data.note
    raw = report_details.details(interaction_session, interaction_session.get(AppUser, "M1"), report_details.DetailsInput(config=config(metric), card_id="target"))
    assert raw.total == pytest.approx(expected) and raw.total_rows == 4
    assert all("sku" in row.values for row in raw.rows)


def test_same_order_number_for_different_customers_counts_separately(interaction_session):
    transaction(interaction_session, "O1", "2031-04-17", 50, customer="C2")
    assert result(interaction_session, config("order_count")).total == 4


@pytest.mark.parametrize(("metric", "expected"), [("order_count", 2), ("avg_order_value", 175), ("net_margin_rate", 225 / 350)])
def test_product_slicer_uses_selected_items_and_their_matched_orders(interaction_session, metric, expected):
    transaction(interaction_session, "O1", "2031-04-17", 100, sku="P2")
    body = config(metric, slicers=[{"dimension": "product", "keys": ["P2"]}])
    assert result(interaction_session, body).total == pytest.approx(expected)


def test_zero_sales_is_undefined_rate_but_real_zero_average_and_one_order(interaction_session):
    sale = interaction_session.query(SalesTransaction).filter_by(order_no="O1").one()
    sale.amount, sale.cost = 0, 10
    interaction_session.flush()
    changes = {"filters": [{"dimension": "customer", "key": "C1"}]}
    assert result(interaction_session, config("net_margin_rate", **changes)).total is None
    assert result(interaction_session, config("avg_order_value", **changes)).total == 0
    assert result(interaction_session, config("order_count", **changes)).total == 1


@pytest.mark.parametrize(("metric", "expected"), [("net_margin_rate", None), ("avg_order_value", None), ("order_count", 0)])
def test_empty_scope_and_calendar_buckets_keep_null_semantics(interaction_session, metric, expected):
    empty = result(interaction_session, config(metric, filters=[{"dimension": "customer", "key": "missing"}]))
    assert empty.total == expected and empty.row_count == 0
    trend = result(interaction_session, config(metric, card={"dimension": "month", "visual": "line"}, period="custom", date_range={"start": "2031-01-01", "end": "2031-04-17"}))
    assert trend.points[1].value == trend.points[2].value == expected
    assert trend.points[1].row_count == 0


@pytest.mark.parametrize(("metric", "expected"), [("net_margin_rate", .25), ("order_count", 1), ("avg_order_value", 400)])
def test_other_series_recalculates_weighted_rates_averages_and_distinct_orders(interaction_session, metric, expected):
    for index in range(3, 12):
        sku = f"P{index}"
        interaction_session.add(Product(sku=sku, name=sku, category="測試", spec="盒", unit="盒", unit_price=100, unit_cost=40))
        interaction_session.flush()
        transaction(interaction_session, "BUNDLE", "2031-04-10", 100, sku=sku, cost=(index - 2) * 10)
    data = result(interaction_session, config(metric, card={"dimension": "owner", "legend": "product", "visual": "column"}))
    other = next(series for series in data.series if series.key == "__other__")
    assert next(point for point in other.points if point.key == "S1").value == pytest.approx(expected)
    if metric == "order_count":
        assert data.total == 4
    elif metric == "avg_order_value":
        assert data.total == pytest.approx(2250 / 4)
    else:
        assert data.total == .5


def test_average_and_rate_matrix_row_and_report_totals_are_aggregate_values(interaction_session):
    transaction(interaction_session, "O1", "2031-04-17", 100, sku="P2")
    rate = result(interaction_session, config("net_margin_rate", card={"dimension": "customer", "legend": "product", "visual": "matrix"}))
    row = next(point for point in rate.points if point.key == "C1")
    assert row.value == .6 and rate.total == pytest.approx(775 / 1450)
    avg = result(interaction_session, config("avg_order_value", card={"dimension": "customer", "legend": "product", "visual": "matrix"}))
    assert next(point for point in avg.points if point.key == "C1").value == 500
    assert avg.total == pytest.approx(1450 / 3)


def test_previous_month_uses_same_cutoff_and_permissions_not_full_previous_month(interaction_session):
    seed_previous(interaction_session)
    data = result(interaction_session, config(card={"comparison": "previous_month"}))
    assert data.total == 1350 and data.comparison.start == dt.date(2031, 3, 1) and data.comparison.end == dt.date(2031, 3, 17)
    assert data.comparison.value.previous == 500 and data.comparison.value.relative_change == pytest.approx(1.7)
    own = result(interaction_session, config(card={"comparison": "previous_month"}), user="S1")
    assert own.total == 1350 and own.comparison.value.previous == 500


def test_previous_year_and_partial_custom_range_map_categories_to_current_dates(interaction_session):
    transaction(interaction_session, "LAST-YEAR", "2030-04-03", 200, customer="C2")
    transaction(interaction_session, "BEFORE-RANGE", "2030-04-02", 900, customer="C2")
    body = config(card={"dimension": "month", "visual": "line", "comparison": "previous_year"}, period="custom", date_range={"start": "2031-04-03", "end": "2031-04-10"})
    data = result(interaction_session, body)
    assert data.total == 950 and data.comparison.value.previous == 200
    assert data.points[0].key == "2031-04" and data.points[0].comparison.previous == 200
    assert data.comparison.start == dt.date(2030, 4, 3) and data.comparison.end == dt.date(2030, 4, 10)


def test_fixed_page_slicer_and_drill_dates_shift_together_across_year_boundary(interaction_session):
    transaction(interaction_session, "DEC", "2030-12-15", 100, customer="C2")
    body = config(card={"dimension": "month", "visual": "line", "legend": "owner", "comparison": "previous_month"},
        period="custom", date_range={"start": "2031-01-01", "end": "2031-03-31"},
        filters=[{"dimension": "year", "key": "2031"}],
        slicers=[{"dimension": "month", "keys": ["2031-01"]}],
        pages=[{"id": "overview", "name": "分頁", "filters": [{"dimension": "quarter", "key": "2031-Q1"}]}],
        drill_filters={"target": [{"dimension": "year", "key": "2031"}, {"dimension": "quarter", "key": "2031-Q1"}, {"dimension": "owner", "key": "S2"}]})
    data = result(interaction_session, body)
    assert data.total == 300 and data.comparison.value.previous == 100
    assert data.points[0].comparison.relative_change == 2
    assert data.series[0].points[0].comparison.previous == 100


@pytest.mark.parametrize("mode", ["filter", "highlight", "none"])
def test_temporal_live_selections_and_highlight_comparisons_keep_exact_pairs(interaction_session, mode):
    seed_previous(interaction_session)
    body = config(card={"interaction": mode, "comparison": "previous_month"})
    body.cards.insert(0, reports.ReportCard(id="selector", title="日期業務", metric="sales", dimension="month", legend="owner", visual="column"))
    body = reports.ReportQuery.model_validate(body.model_dump() | {"selection_groups": [{"source_id": "selector", "points": [{"label": "四月 S2", "filters": [{"dimension": "month", "key": "2031-04"}, {"dimension": "owner", "key": "S2"}]}]}]})
    data = result(interaction_session, body)
    if mode == "filter":
        assert data.total == 700 and data.comparison.value.previous == 100
    else:
        assert data.total == 1350 and data.comparison.value.previous == 500
    if mode == "highlight":
        assert data.highlight.total == 700 and data.highlight.comparison.value.previous == 100


@pytest.mark.parametrize(("previous", "cost", "expected_status"), [(None, 0, "no_previous_data"), (0, 0, "previous_zero"), (100, 200, "negative_baseline")])
def test_missing_zero_and_negative_baselines_never_produce_infinite_growth(interaction_session, previous, cost, expected_status):
    if previous is not None:
        transaction(interaction_session, "PREV", "2031-03-01", previous, cost=cost)
    data = result(interaction_session, config("net_margin", card={"comparison": "previous_month"}))
    assert data.comparison.value.status == expected_status
    assert data.comparison.value.relative_change is None


def test_rate_changes_are_percentage_point_differences_including_zero_baseline(interaction_session):
    transaction(interaction_session, "BREAKEVEN", "2031-03-01", 100, cost=100)
    data = result(interaction_session, config("net_margin_rate", card={"comparison": "previous_month"}))
    assert data.comparison.value.status == "ok" and data.comparison.value.previous == 0
    assert data.comparison.value.delta == .5 and data.comparison.value.relative_change is None


def test_zero_revenue_comparison_is_distinguished_from_no_previous_rows(interaction_session):
    transaction(interaction_session, "ZERO-REVENUE", "2031-03-01", 0, cost=10)
    data = result(interaction_session, config("net_margin_rate", card={"comparison": "previous_month"}))
    assert data.comparison.value.previous_rows == 1 and data.comparison.value.status == "previous_undefined"


@pytest.mark.parametrize(("metric", "current", "selected", "previous"), [
    ("net_margin_rate", 745 / 1450, .54, .45),
    ("avg_order_value", 1450 / 3, 500, 200),
    ("order_count", 3, 1, 1),
])
def test_new_metric_highlights_recompute_subset_and_prior_without_proportions(interaction_session, metric, current, selected, previous):
    seed_previous(interaction_session)
    transaction(interaction_session, "O1", "2031-04-17", 100, sku="P2", fee=20, reward=10)
    body = config(metric, card={"interaction": "highlight", "comparison": "previous_month"})
    body.cards.insert(0, reports.ReportCard(id="selector", title="客戶", metric="sales", dimension="customer", visual="bar"))
    body = reports.ReportQuery.model_validate(body.model_dump() | {"selection_groups": [{"source_id": "selector", "points": [{"label": "C1", "filters": [{"dimension": "customer", "key": "C1"}]}]}]})
    data = result(interaction_session, body)
    assert data.total == pytest.approx(current)
    assert data.highlight.total == pytest.approx(selected)
    assert data.highlight.comparison.value.previous == pytest.approx(previous)
    if metric != "order_count":
        assert data.highlight.total > data.total


@pytest.mark.parametrize(("date", "offset", "expected"), [("2032-02-29", -12, "2031-02-28"), ("2031-02-28", -1, "2031-01-31"), ("2031-04-17", -1, "2031-03-17"), ("2031-03-31", -1, "2031-02-28")])
def test_calendar_shift_handles_full_months_leap_days_and_partial_periods(date, offset, expected):
    assert reports.shift_calendar_date(dt.date.fromisoformat(date), offset).isoformat() == expected


def test_complete_month_uses_complete_comparison_month(interaction_session):
    interaction_session.get(AppSetting, "as_of_date").value = "2031-03-17"
    interaction_session.flush()
    data = result(interaction_session, config(card={"comparison": "previous_month"}, period="last_month"))
    assert data.comparison.start == dt.date(2031, 1, 1) and data.comparison.end == dt.date(2031, 1, 31)


def test_visit_comparison_respects_taipei_dates_and_actual_visitor(interaction_session):
    for name, date, user in [("NOW", "2031-04-10T00:00:00+08:00", "S1"), ("PRIOR", "2031-03-17T15:59:59+00:00", "S1"), ("LATE", "2031-03-17T16:00:00+00:00", "S1"), ("FOREIGN", "2031-03-10T00:00:00+08:00", "S3")]:
        interaction_session.add(Visit(id=name, customer_id="C1", user_id=user, visited_at=dt.datetime.fromisoformat(date), status="confirmed"))
    interaction_session.flush()
    data = result(interaction_session, config("visits", card={"comparison": "previous_month"}))
    assert data.total == 1 and data.comparison.value.previous == 1 and data.comparison.value.relative_change == 0


def test_calendar_underflow_is_reported_without_fabricated_prior_data(interaction_session):
    body = config(card={"comparison": "previous_year"}, period="custom", date_range={"start": "0001-01-01", "end": "0001-01-02"})
    data = result(interaction_session, body)
    assert data.comparison.start is None and data.comparison.value.status == "date_out_of_range"


@pytest.mark.parametrize("metric", ["net_margin_rate", "avg_order_value", "order_count"])
@pytest.mark.parametrize("visual", ["pie", "stacked_column", "percent_bar"])
def test_nonadditive_metrics_reject_part_whole_visuals(metric, visual):
    with pytest.raises(ValidationError):
        config(metric, card={"visual": visual, "dimension": "customer", "legend": "product" if visual != "pie" else None})


@pytest.mark.parametrize("metric", ["customers", "overdue"])
def test_snapshot_comparison_rejected(metric):
    with pytest.raises(ValidationError):
        config(metric, card={"comparison": "previous_year"})


def test_new_metrics_comparison_settings_and_nulls_roundtrip_through_authenticated_api(interaction_session):
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {auth.create_token(interaction_session.get(AppUser, 'M1'))}"}
    body = reports.ReportConfig.model_validate(config("net_margin_rate", card={"comparison": "previous_year"}).model_dump(exclude={"selection_groups", "drill_filters", "matrix_views"}))
    assert client.put("/api/reports/config", headers=headers, json=body.model_dump(mode="json")).status_code == 200
    stored = client.get("/api/reports", headers=headers).json()["config"]
    assert stored["cards"][0]["metric"] == "net_margin_rate" and stored["cards"][0]["comparison"] == "previous_year"
    body.filters = [reports.ReportFilter(dimension="customer", key="missing")]
    queried = client.post("/api/reports/data", headers=headers, json=body.model_dump(mode="json"))
    assert queried.status_code == 200 and queried.json()["cards"][0]["total"] is None
    assert "NaN" not in queried.text and "Infinity" not in queried.text
