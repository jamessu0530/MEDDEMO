import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.models import AppUser
from app.services import auth, reports


def query(**changes):
    return reports.ReportQuery.model_validate({
        "name": "分批載入", "template": "manager", "period": "this_month",
        "pages": [{"id": "overview", "name": "總覽"}, {"id": "other", "name": "其他"}],
        "cards": [
            {"id": "total", "title": "業績", "metric": "sales", "dimension": "none", "visual": "kpi"},
            {"id": "other", "page_id": "other", "title": "其他", "metric": "sales", "dimension": "customer", "visual": "bar"},
        ], **changes,
    })


def test_lean_workspace_skips_expensive_filter_options(interaction_session, monkeypatch):
    from app.api import reports as api
    headers = {"Authorization": f"Bearer {auth.create_token(interaction_session.get(AppUser, 'M1'))}"}
    original = reports.filter_options
    calls = []
    def filters(session, user):
        calls.append(user.id)
        return original(session, user)
    monkeypatch.setattr(api.service, "filter_options", filters)
    client = TestClient(app)
    lean = client.get("/api/reports?include_filters=false", headers=headers)
    assert lean.status_code == 200 and lean.json()["filter_options"] is None
    assert calls == []
    options = client.get("/api/reports/filter-options", headers=headers)
    legacy = client.get("/api/reports", headers=headers)
    assert options.status_code == legacy.status_code == 200
    assert options.json() == legacy.json()["filter_options"]
    assert calls == ["M1", "M1"]


def test_subset_keeps_cross_page_selection_and_skips_other_sql(interaction_session, monkeypatch):
    body = query(selection_groups=[{"source_id": "other", "points": [{"label": "C1", "filters": [{"dimension": "customer", "key": "C1"}]}]}])
    user = interaction_session.get(AppUser, "M1")
    expected = reports.data(interaction_session, user, body).cards[0]
    original = reports._compared_card
    calls = []
    def card_data(session, card, *args, **kwargs):
        calls.append(card.id)
        return original(session, card, *args, **kwargs)
    monkeypatch.setattr(reports, "_compared_card", card_data)
    subset = reports.data(interaction_session, user, body.model_copy(update={"requested_card_ids": ["total"]}))
    assert calls == ["total"]
    assert subset.cards == [expected]
    assert subset.cards[0].total == 400


def test_empty_page_does_not_compute_cards(interaction_session, monkeypatch):
    def unexpected(*args, **kwargs):
        pytest.fail("empty page queried a card")
    monkeypatch.setattr(reports, "_compared_card", unexpected)
    assert reports.data(interaction_session, interaction_session.get(AppUser, "M1"), query(requested_card_ids=[])).cards == []


@pytest.mark.parametrize("ids", [["unknown"], ["total", "total"]])
def test_rejects_unknown_or_duplicate_requested_ids(ids):
    with pytest.raises(ValidationError, match="查詢圖表"):
        query(requested_card_ids=ids)


def test_request_subset_cannot_be_saved_as_report_config():
    with pytest.raises(ValidationError, match="requested_card_ids"):
        reports.ReportConfig.model_validate(query(requested_card_ids=["total"]).model_dump())


def test_subset_retains_owner_authorization(interaction_session):
    body = query(requested_card_ids=["total"], cards=[
        {"id": "total", "title": "業績", "metric": "sales", "dimension": "none", "visual": "kpi"},
        {"id": "other", "title": "其他", "metric": "sales", "dimension": "customer", "visual": "bar", "filters": [{"dimension": "owner", "key": "not-an-owner"}]},
    ])
    with pytest.raises(reports.OwnerNotAllowed):
        reports.data(interaction_session, interaction_session.get(AppUser, "M1"), body)
