import csv
import datetime as dt
import io

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.models import AppUser, Customer, Product, Receivable, SalesTransaction, Visit
from app.services import auth, report_details as detail, reports


def point(**filters):
    return {"label": " / ".join(filters.values()), "filters": [{"dimension": key, "key": value} for key, value in filters.items()]}


def config(**changes):
    slicers = changes.get("slicers", [])
    if not any(item["dimension"] == "owner" for item in slicers):
        changes["slicers"] = [{"dimension": "owner", "keys": ["S1", "S2"]}, *slicers]
    return reports.ReportQuery.model_validate({
        "slicers": [{"dimension": "owner", "keys": ["S1", "S2"]}], "name": "下鑽驗收", "template": "manager", "period": "custom",
        "date_range": {"start": "2031-01-01", "end": "2031-04-17"},
        "cards": [{"id": "source", "title": "業績", "metric": "sales", "dimension": "customer", "visual": "bar", "limit": 3}],
        **changes,
    })


def temporal(dimension="year", **changes):
    return config(cards=[{"id": "source", "title": "日期", "metric": "sales", "dimension": dimension,
        "visual": "stacked_column", "legend": "owner", "limit": 3}], **changes)


def body(report=None, **changes):
    return detail.DetailsInput.model_validate({"config": (report or config()).model_dump(), "card_id": "source", **changes})


def rows(session, query=None, user="M1", **changes):
    return detail.details(session, session.get(AppUser, user), body(query, **changes))


def data(session, query):
    return reports.data(session, session.get(AppUser, "M1"), query).cards[0]


@pytest.mark.parametrize(("dimension", "keys", "values"), [
    ("year", ["2030", "2031"], [0, 1750]),
    ("quarter", ["2030-Q4", "2031-Q1", "2031-Q2"], [0, 400, 1350]),
])
def test_date_hierarchy_orders_and_pads_real_calendar_buckets(interaction_session, dimension, keys, values):
    report = temporal(dimension, date_range={"start": "2030-12-01", "end": "2031-04-17"})
    result = data(interaction_session, report)
    assert [item.key for item in result.points] == keys
    assert [item.value for item in result.points] == values
    assert result.total == 1750


def test_down_to_quarter_month_and_raw_rows_preserves_exact_series_owner(interaction_session):
    quarter = temporal("quarter", drill_filters={"source": [{"dimension": "year", "key": "2031"}, {"dimension": "owner", "key": "S2"}]})
    assert [item.value for item in data(interaction_session, quarter).points] == [300, 700]
    month = temporal("month", drill_filters={"source": [{"dimension": "year", "key": "2031"}, {"dimension": "quarter", "key": "2031-Q1"}, {"dimension": "owner", "key": "S2"}]})
    assert [item.key for item in data(interaction_session, month).points] == ["2031-01", "2031-02", "2031-03"]
    assert [item.value for item in data(interaction_session, month).points] == [300, 0, 0]
    result = rows(interaction_session, month, point=point(month="2031-01", owner="S2"))
    assert result.total == 300 and result.total_rows == 1
    assert result.rows[0].values["order"] == "O2"
    assert data(interaction_session, temporal()).total == 1750


def test_date_slicer_and_fixed_scope_intersect_without_replacing_each_other(interaction_session):
    report = temporal("quarter", slicers=[{"dimension": "quarter", "keys": ["2031-Q1", "2031-Q2"]}],
        pages=[{"id": "overview", "name": "頁", "filters": [{"dimension": "owner", "key": "S1"}]}],
        drill_filters={"source": [{"dimension": "year", "key": "2031"}]})
    assert data(interaction_session, report).total == 750
    assert rows(interaction_session, report).total == 750


def test_date_point_bounds_intersect_page_and_card_dates(interaction_session):
    report = temporal("month", pages=[{"id": "overview", "name": "頁", "date_range": {"start": "2031-04-03", "end": "2031-04-10"}}])
    result = rows(interaction_session, report, point=point(month="2031-04", owner="S1"))
    assert result.start == dt.date(2031, 4, 3) and result.end == dt.date(2031, 4, 10)
    assert result.total == 250 and result.total_rows == 1
    empty = rows(interaction_session, report, point=point(month="2031-01"))
    assert empty.total_rows == 0 and "日期條件沒有交集" in empty.note


@pytest.mark.parametrize(("dimension", "key"), [
    ("year", "0000"), ("year", "203"), ("year", "２０３１"),
    ("quarter", "2031-Q0"), ("quarter", "2031-Q5"), ("quarter", "0000-Q1"), ("quarter", "2031-q1"),
])
def test_invalid_calendar_keys_rejected(dimension, key):
    with pytest.raises(ValidationError):
        reports.ReportFilter(dimension=dimension, key=key)


@pytest.mark.parametrize("metric", ["customers", "overdue"])
@pytest.mark.parametrize("dimension", ["year", "quarter"])
def test_snapshots_do_not_allow_historical_axes(metric, dimension):
    with pytest.raises(ValidationError):
        config(cards=[{"id": "source", "title": "快照", "metric": metric, "dimension": dimension, "visual": "column"}])


@pytest.mark.parametrize("drill", [
    {"missing": [{"dimension": "year", "key": "2031"}]},
    {"source": [{"dimension": "customer", "key": "C1"}]},
    {"source": [{"dimension": "year", "key": "2031"}, {"dimension": "year", "key": "2030"}]},
])
def test_invalid_drill_sources_rejected(drill):
    with pytest.raises(ValidationError):
        temporal("month", drill_filters=drill)


@pytest.mark.parametrize(("dimension", "key", "orders", "total"), [
    ("customer", "C1", {"O0", "O1"}, 500),
    ("product", "P2", {"O5"}, 250),
    ("owner", "S2", {"O2", "O3"}, 1000),
])
def test_customer_product_and_owner_points_return_actual_transactions(interaction_session, dimension, key, orders, total):
    report = config(cards=[{"id": "source", "title": "實際明細", "metric": "sales", "dimension": dimension, "visual": "bar"}])
    result = rows(interaction_session, report, point=point(**{dimension: key}))
    assert result.total == total and result.total_rows == len(orders)
    assert {item.values["order"] for item in result.rows} == orders
    assert all("sku" in item.values and "quantity" in item.values for item in result.rows)


def test_pagination_sorting_and_unique_tie_break_are_stable_and_totals_unpaginated(interaction_session):
    first = rows(interaction_session, page_size=1, sort_by="amount", sort_direction="desc")
    second = rows(interaction_session, page_size=1, page=2, sort_by="amount", sort_direction="desc")
    assert first.total_rows == second.total_rows == 5 and first.total == second.total == 1750
    assert first.rows[0].values["order"] == "O3" and second.rows[0].values["order"] == "O1"
    dates = rows(interaction_session, sort_by="date", sort_direction="asc")
    assert [item.values["order"] for item in dates.rows][:2] == ["O0", "O2"]
    assert rows(interaction_session, page=100).rows == []


def test_margin_detail_matches_fee_inclusive_chart_and_sorts_by_margin(interaction_session):
    record = interaction_session.query(SalesTransaction).filter_by(order_no="O1").one()
    record.cost, record.listing_fee, record.channel_reward = 300, 80, 40
    interaction_session.flush()
    report = config(cards=[{"id": "source", "title": "淨毛利", "metric": "net_margin", "dimension": "customer", "visual": "bar"}])
    result = rows(interaction_session, report, sort_by="net_margin", sort_direction="asc")
    assert result.total == data(interaction_session, report).total == 655
    assert result.rows[0].values["net_margin"] == -20
    assert result.rows[0].values["listing_fee"] == 80
    assert rows(interaction_session, report, sort_by="amount", sort_direction="asc").rows[0].values["order"] == "O0"
    assert next(item for item in result.columns if item.key == "net_margin").sort_key == "net_margin"
    exported = detail.export_csv(interaction_session, interaction_session.get(AppUser, "M1"), body(report, sort_by="net_margin", sort_direction="asc"))
    assert next(csv.DictReader(io.StringIO(exported.lstrip("\ufeff"))))["淨毛利（元）"].startswith("-20")


@pytest.mark.parametrize("customer", ["C3", "' OR 1=1 --"])
def test_details_and_export_never_expand_customer_permission(interaction_session, customer):
    request = body(point=point(customer=customer))
    user = interaction_session.get(AppUser, "M1")
    assert detail.details(interaction_session, user, request).total_rows == 0
    assert len(list(csv.reader(io.StringIO(detail.export_csv(interaction_session, user, request))))) == 1


def test_owner_permission_checked_for_point_and_drill(interaction_session):
    report = config(cards=[{"id": "source", "title": "業務", "metric": "sales", "dimension": "owner", "visual": "bar"}])
    with pytest.raises(reports.OwnerNotAllowed):
        rows(interaction_session, report, point=point(owner="UNKNOWN_OWNER"))
    with pytest.raises(reports.OwnerNotAllowed):
        rows(interaction_session, report, user="S1", point=point(owner="UNKNOWN_OWNER"))
    with pytest.raises(reports.OwnerNotAllowed):
        rows(interaction_session, temporal("month", drill_filters={"source": [{"dimension": "owner", "key": "UNKNOWN_OWNER"}]}))
    assert rows(interaction_session, user="S1").total == 1750


def test_missing_organization_scope_has_no_detail_or_export_access(interaction_session):
    user = AppUser(id="UNPLACED", name="未分配", role="manager", region="北區", unit_id="TW.N", org_path=None)
    result = detail.details(interaction_session, user, body())
    assert result.total_rows == 5 and result.total == 1750
    assert len(list(csv.reader(io.StringIO(detail.export_csv(interaction_session, user, body()))))) == 6


def test_highlight_scope_and_none_match_chart_semantics(interaction_session):
    report = config(cards=[
        {"id": "selector", "title": "來源", "metric": "sales", "dimension": "owner", "visual": "bar"},
        {"id": "source", "title": "醒目提示", "metric": "sales", "dimension": "customer", "visual": "bar", "interaction": "highlight"},
    ], selection_groups=[{"source_id": "selector", "points": [point(owner="S2")]}])
    assert rows(interaction_session, report, selection_scope="chart").total == 1750
    assert rows(interaction_session, report, selection_scope="selected").total == 1000
    assert rows(interaction_session, report, selection_scope="selected", point=point(customer="C1")).total == 0
    report.cards[1] = report.cards[1].model_copy(update={"interaction": "none"})
    assert rows(interaction_session, report, selection_scope="selected").total == 1750


def test_visit_details_use_actual_visitor_taipei_time_and_omit_private_media(interaction_session):
    for index, (date, user, status) in enumerate((
        ("2031-04-09T16:00:00+00:00", "S2", "confirmed"),
        ("2031-04-10T15:59:59+00:00", "S1", "synced"),
        ("2031-04-10T16:00:00+00:00", "S1", "confirmed"),
        ("2031-04-10T08:00:00+00:00", "S3", "confirmed"),
        ("2031-04-10T08:00:00+00:00", "S1", "draft"),
    )):
        interaction_session.add(Visit(id=f"V{index}", user_id=user, customer_id="C1", visited_at=dt.datetime.fromisoformat(date), status=status,
            audio_url="private", transcript="private", fields_final={"private": True}))
    interaction_session.flush()
    report = config(cards=[{"id": "source", "title": "拜訪", "metric": "visits", "dimension": "owner", "visual": "bar"}],
        date_range={"start": "2031-04-10", "end": "2031-04-10"})
    result = rows(interaction_session, report, point=point(owner="S2"))
    assert result.total_rows == result.total == 1
    assert result.rows[0].values["date"] == "2031-04-10T00:00:00+08:00"
    assert result.rows[0].values["owner"] == "S2" and result.rows[0].values["status"] == "已確認"
    assert not {"audio_url", "transcript", "fields_final"} & result.rows[0].values.keys()
    assert rows(interaction_session, report).total_rows == 2
    assert rows(interaction_session, report, user="S1").total_rows == 2


def test_receivable_snapshot_includes_older_invoices_but_excludes_paid_future_and_other_team(interaction_session):
    for name, customer, invoice, due, paid in (
        ("OLD", "C1", "2029-01-01", "2029-02-01", None),
        ("PAID", "C1", "2031-03-01", "2031-04-01", "2031-04-15"),
        ("NOTDUE", "C1", "2031-04-01", "2031-04-17", None),
        ("FUTURE", "C1", "2031-04-18", "2031-04-01", None),
        ("OUTSIDE", "C3", "2031-03-01", "2031-04-01", None),
    ):
        interaction_session.add(Receivable(invoice_no=name, customer_id=customer, invoice_date=dt.date.fromisoformat(invoice),
            due_date=dt.date.fromisoformat(due), paid_date=dt.date.fromisoformat(paid) if paid else None, amount=100))
    interaction_session.flush()
    report = config(cards=[{"id": "source", "title": "逾期", "metric": "overdue", "dimension": "customer", "visual": "bar"}],
        date_range={"start": "2031-04-10", "end": "2031-04-10"})
    result = rows(interaction_session, report, sort_by="due_date")
    assert result.total_rows == 1 and result.total == 100
    assert result.rows[0].values["order"] == "OLD"
    assert result.rows[0].values["overdue_days"] == (dt.date(2031, 4, 17) - dt.date(2029, 2, 1)).days
    assert "快照" in result.note


def test_customer_snapshot_filters_current_list_and_explicitly_ignores_time(interaction_session):
    report = config(cards=[{"id": "source", "title": "客戶", "metric": "customers", "dimension": "customer_type", "visual": "bar"}],
        date_range={"start": "2001-01-01", "end": "2001-01-02"}, filters=[{"dimension": "year", "key": "2001"}])
    result = rows(interaction_session, report, point=point(customer_type="chain"), sort_by="customer")
    assert result.total == result.total_rows == 1 and result.rows[0].values["customer_id"] == "C4"
    assert result.rows[0].values["customer_type"] == "連鎖藥局" and "年份" in result.note and "快照" in result.note
    with pytest.raises(detail.DetailSortNotAllowed):
        rows(interaction_session, report, sort_by="amount")


def test_full_csv_ignores_chart_rank_and_page_limits_and_quotes_unsafe_text(interaction_session):
    interaction_session.get(Customer, "C1").name = '=HYPERLINK("x"),\n診所'
    interaction_session.get(Product, "P1").name = "@商品"
    for index in range(106):
        interaction_session.add(SalesTransaction(order_no=f"MORE-{index}", customer_id="C1", date=dt.date(2031, 4, 1), sku="P1", qty=1, amount=1, cost=0))
    interaction_session.flush()
    request = body(page_size=1, page=2)
    assert detail.details(interaction_session, interaction_session.get(AppUser, "M1"), request).total_rows == 111
    exported = detail.export_csv(interaction_session, interaction_session.get(AppUser, "M1"), request)
    assert exported.startswith("\ufeff")
    records = list(csv.DictReader(io.StringIO(exported.lstrip("\ufeff"))))
    assert len(records) == 111
    assert sum(float(item["業績（元）"]) for item in records) == 1856
    unsafe = next(item for item in records if item["訂單編號"] == "O1")
    assert unsafe["客戶"] == '\'=HYPERLINK("x"),\n診所'
    assert unsafe["商品"] == "'@商品"


@pytest.mark.parametrize("changes", [
    {"card_id": "missing"}, {"point": point(owner="S1")},
    {"page": 0}, {"page": 1.1}, {"page_size": 101},
])
def test_invalid_details_inputs_rejected(changes):
    with pytest.raises(ValidationError):
        body(**changes)


def test_details_api_authorization_csv_and_query_only_drill(interaction_session):
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {auth.create_token(interaction_session.get(AppUser, 'M1'))}"}
    report = temporal("month", drill_filters={"source": [{"dimension": "quarter", "key": "2031-Q1"}, {"dimension": "owner", "key": "S2"}]})
    payload = body(report, page_size=1).model_dump(mode="json")
    assert client.post("/api/reports/details", json=payload).status_code == 401
    result = client.post("/api/reports/details", json=payload, headers=headers)
    assert result.status_code == 200 and result.json()["total"] == 300
    exported = client.post("/api/reports/details/export", json=payload, headers=headers)
    assert exported.status_code == 200 and "text/csv" in exported.headers["content-type"]
    assert "attachment" in exported.headers["content-disposition"] and "O2" in exported.text and "O3" not in exported.text
    assert client.put("/api/reports/config", json=report.model_dump(mode="json"), headers=headers).status_code == 422
    forged = body(config(cards=[{"id": "source", "title": "業務", "metric": "sales", "dimension": "owner", "visual": "bar"}]), point=point(owner="UNKNOWN_OWNER")).model_dump(mode="json")
    assert client.post("/api/reports/details", json=forged, headers=headers).status_code == 403
    assert client.post("/api/reports/details/export", json=forged, headers=headers).status_code == 403
