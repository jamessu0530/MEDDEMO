import datetime as dt

import pytest
from pydantic import ValidationError

from app.models import AppUser, Customer, SalesTransaction
from app.services import reports


def config(*, formatting=None, view=None, columns=None, rows=None):
    rows = rows or ["owner", "customer"]
    columns = [] if columns is None else columns
    return reports.ReportQuery.model_validate({
        "slicers": [{"dimension": "owner", "keys": ["S1", "S2"]}], "name": "格式驗收", "template": "manager", "period": "this_month",
        "cards": [{"id": "matrix", "title": "矩陣", "metric": "sales", "dimension": rows[0], "legend": columns[0] if columns else None,
                   "visual": "matrix", "matrix": {"rows": rows, "columns": columns, "metrics": ["sales", "net_margin", "net_margin_rate", "order_count", "avg_order_value"]},
                   "format": formatting or {}}],
        "matrix_views": {"matrix": view or {}},
    })


def data(session, body, user="M1"):
    return reports.data(session, session.get(AppUser, user), body).cards[0]


@pytest.mark.parametrize("invalid", [
    {"numbers": {"sales": {"decimals": -1}}},
    {"numbers": {"sales": {"decimals": 7}}},
    {"numbers": {"sales": {"decimals": True}}},
    {"numbers": {"net_margin_rate": {"unit": "million"}}},
    {"numbers": {"secret": {"unit": "none"}}},
    {"metric_colors": {"sales": "url(javascript:alert(1))"}},
    {"conditional": {"sales": {"color_mode": "rules"}}},
    {"conditional": {"sales": {"color_mode": "gradient", "minimum": 5, "maximum": 5}}},
    {"conditional": {"sales": {"minimum": float("nan")}}},
    {"conditional": {"sales": {"bar_minimum": 1}}},
    {"conditional": {"sales": {"bar_maximum": -1}}},
    {"conditional": {"sales": {"color_mode": "rules", "rules": [{"minimum": 5, "maximum": 4}]}}},
    {"series_colors": [{"dimension": "owner", "key": "S1", "color": "#259688"}] * 2},
    {"tooltip": {"script": "arbitrary"}},
    {"axes": {"x_title": "x" * 61}},
])
def test_invalid_format_is_rejected(invalid):
    with pytest.raises(ValidationError):
        config(formatting=invalid)


def test_format_settings_persist_without_changing_data_or_permission(interaction_session):
    style = {"numbers": {"sales": {"unit": "ten_thousand", "decimals": 3}, "net_margin_rate": {"unit": "none", "decimals": 1}},
             "conditional": {"sales": {"color_mode": "rules", "rules": [{"maximum": 500, "color": "#d76857"}, {"minimum": 500, "color": "#259688"}], "data_bars": True},
                             "net_margin_rate": {"color_mode": "gradient", "minimum": 0, "maximum": 1}},
             "series_colors": [{"dimension": "owner", "key": "S3", "color": "#112233"}],
             "metric_colors": {"sales": "#223344"}, "axes": {"show_y": False, "show_titles": True, "x_title": "業務"}, "tooltip": {"show_rows": False}}
    body = config(formatting=style)
    user = interaction_session.get(AppUser, "M1")
    saved = reports.save_config(interaction_session, user, reports.ReportConfig.model_validate(body.model_dump(exclude={"selection_groups", "drill_filters", "matrix_views", "canvas_selections", "navigation_page", "navigation_filters", "requested_card_ids"})))
    assert saved.cards[0].format == body.cards[0].format
    assert reports.get_config(interaction_session, user).cards[0].format == body.cards[0].format
    assert data(interaction_session, body).model_dump() == data(interaction_session, config()).model_dump()
    assert data(interaction_session, body, "S1").total == 1350


def test_complete_leaf_color_domains_are_stable_across_pages_and_collapse(interaction_session):
    for index in range(31):
        key = f"F{index}"
        interaction_session.add(Customer(id=key, name=key, type="clinic", region="北區", city="臺北", place_id="TPE", grade="A", owner_user_id="S1", area="中正", lat=25, lng=121, payment_term="RM06"))
        interaction_session.add(SalesTransaction(order_no=key, customer_id=key, date=dt.date(2031, 4, 1), sku="P1", qty=1, amount=10, cost=5, listing_fee=0, channel_reward=0))
    interaction_session.flush()
    first = data(interaction_session, config(view={"row_expand_depth": 2, "row_page": 1})).matrix
    second = data(interaction_session, config(view={"row_expand_depth": 2, "row_page": 2})).matrix
    collapsed = data(interaction_session, config(view={"row_expand_depth": 1})).matrix
    assert first.row_total == second.row_total == 36 and collapsed.row_total == 2
    assert first.format_domains == second.format_domains == collapsed.format_domains
    assert first.format_domains["sales"].model_dump() == {"minimum": 10, "maximum": 700}
    assert first.format_domains["net_margin_rate"].model_dump() == {"minimum": .5, "maximum": .5}
    assert first.format_domains["order_count"].model_dump() == {"minimum": 1, "maximum": 1}
    assert first.totals["sales"] == 1660


def test_sparse_matrix_zero_cells_participate_but_undefined_ratios_do_not(interaction_session):
    body = config(rows=["customer"], columns=["month"])
    body.period = "custom"
    body.date_range = reports.ReportDateRange(start=dt.date(2031, 1, 1), end=dt.date(2031, 4, 17))
    matrix = data(interaction_session, body).matrix
    assert matrix.format_domains["sales"].model_dump() == {"minimum": 0, "maximum": 700}
    assert matrix.format_domains["net_margin_rate"].model_dump() == {"minimum": .5, "maximum": .5}
    assert matrix.format_domains["avg_order_value"].model_dump() == {"minimum": 100, "maximum": 700}
    assert matrix.format_domains["order_count"].model_dump() == {"minimum": 0, "maximum": 1}


def test_domains_respect_scope_filters_negative_values_and_actual_zero(interaction_session):
    interaction_session.add(SalesTransaction(order_no="ZERO", customer_id="C1", date=dt.date(2031, 4, 2), sku="P2", qty=1, amount=0, cost=10, listing_fee=0, channel_reward=0))
    interaction_session.flush()
    body = config(rows=["customer"], columns=["product"])
    body.cards[0].slicers = [reports.ReportSlicer(dimension="product", keys=["P2"])]
    matrix = data(interaction_session, body, "S1").matrix
    assert matrix.format_domains["sales"].model_dump() == {"minimum": 0, "maximum": 250}
    assert matrix.format_domains["net_margin"].model_dump() == {"minimum": -10, "maximum": 125}
    assert matrix.format_domains["net_margin_rate"].model_dump() == {"minimum": .5, "maximum": .5}
    assert matrix.format_domains["avg_order_value"].model_dump() == {"minimum": 0, "maximum": 250}
    assert matrix.totals["sales"] == 250
