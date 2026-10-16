import datetime as dt

import pytest

from app.models import AppUser, Customer, Receivable, SalesTransaction
from app.services import report_details, reports


@pytest.fixture
def shared_outlet(interaction_session):
    session = interaction_session
    session.add(Customer(id="OUT-SHARED", name="公開通路", type="outlet", region="北區", city="臺北",
        place_id="TPE", area="中正", lat=25, lng=121))
    session.flush()
    return session


def config(metric="customers", **patch):
    return reports.ReportQuery.model_validate({"name": "共用通路報表", "template": "manager", "period": "this_month", "owner_id": None,
        "cards": [{"id": "shared", "title": "共用通路", "metric": metric, "dimension": "owner", "visual": "bar", "limit": 10}], **patch})


@pytest.mark.parametrize("user_id", ["M1", "S1", "S3"])
def test_unassigned_outlets_remain_in_owner_groups_filters_and_raw_details(shared_outlet, user_id):
    session = shared_outlet
    user = session.get(AppUser, user_id)
    body = config()
    card = reports.data(session, user, body).cards[0]
    assert card.total == sum(point.value for point in card.points) == 5
    point = next(point for point in card.points if point.key == reports.SHARED_OWNER)
    assert point.label == "共用通路" and point.value == 1
    assert reports.data(session, user, config(owner_id=reports.SHARED_OWNER)).cards[0].total == 1
    filtered = config(filters=[{"dimension": "owner", "key": reports.SHARED_OWNER}])
    assert reports.data(session, user, filtered).cards[0].total == 1
    details = report_details.details(session, user, report_details.DetailsInput(config=body, card_id="shared"))
    assert details.total_rows == len(details.rows) == 5
    assert next(row.values for row in details.rows if row.values["customer_id"] == "OUT-SHARED")["owner"] == "共用通路"


@pytest.mark.parametrize("metric", ["sales", "overdue"])
def test_unassigned_outlet_transactions_keep_totals_and_detail_rows(shared_outlet, metric):
    session = shared_outlet
    session.add(SalesTransaction(order_no="PUBLIC-ORDER", customer_id="OUT-SHARED", date=dt.date(2031, 4, 17),
        sku="P1", qty=1, amount=600, cost=200, listing_fee=0, channel_reward=0))
    session.add(Receivable(invoice_no="PUBLIC-INVOICE", customer_id="OUT-SHARED", invoice_date=dt.date(2031, 4, 1),
        due_date=dt.date(2031, 4, 10), amount=600))
    session.flush()
    user = session.get(AppUser, "S3")
    body = config(metric, owner_id=reports.SHARED_OWNER)
    card = reports.data(session, user, body).cards[0]
    assert card.total == card.points[0].value == 600
    details = report_details.details(session, user, report_details.DetailsInput(config=body, card_id="shared"))
    assert details.total == 600 and details.total_rows == len(details.rows) == 1
    assert details.rows[0].values["owner"] == "共用通路"
