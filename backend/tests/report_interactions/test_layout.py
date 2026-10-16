import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.services import auth
from app.main import app
from app.models import AppUser
from app.services import reports


def config(**patch):
    return reports.ReportConfig.model_validate({
        "name": "版面驗收", "template": "manager", "period": "this_month",
        "pages": [{"id": "overview", "name": "總覽", "desktop_layout": "free"}],
        "cards": [{"id": "sales", "title": "業績", "metric": "sales", "dimension": "owner", "visual": "bar", **patch}],
    })


@pytest.mark.parametrize("patch", [
    {"desktop_layout": {"x": -1, "y": 0, "w": 12, "h": 20}},
    {"desktop_layout": {"x": 20, "y": 0, "w": 5, "h": 20}},
    {"desktop_layout": {"x": 0, "y": 401, "w": 12, "h": 20}},
    {"desktop_layout": {"x": 0, "y": 0, "w": 3, "h": 20}},
    {"desktop_layout": {"x": 0, "y": 0, "w": 12, "h": 7}},
    {"desktop_layout": {"x": 0, "y": 0, "w": 12, "h": 61}},
    {"desktop_layout": {"x": float("nan"), "y": 0, "w": 12, "h": 20}},
    {"desktop_layout": {"x": 0, "y": float("inf"), "w": 12, "h": 20}},
    {"desktop_layout": {"x": True, "y": 0, "w": 12, "h": 20}},
    {"desktop_layout": {"x": 0, "y": 0, "w": 12, "h": 20, "css": "arbitrary"}},
    {"mobile_layout": {"order": 124, "height": 20}},
    {"mobile_layout": {"order": -1, "height": 20}},
    {"mobile_layout": {"order": True, "height": 20}},
    {"mobile_layout": {"order": 0, "height": 8.5}},
    {"mobile_layout": {"order": 0, "height": 20, "hidden": "false"}},
    {"mobile_layout": {"order": 0, "height": 20, "width": "arbitrary"}},
])
def test_invalid_layout_is_rejected(patch):
    with pytest.raises(ValidationError):
        config(**patch)


def test_legacy_and_fractional_layouts_round_trip_without_converting_legacy():
    legacy = reports.ReportConfig.model_validate({"name": "舊報表", "template": "sales", "period": "this_month", "cards": [{"id": "sales", "title": "業績", "metric": "sales", "dimension": "none", "visual": "kpi"}]})
    assert legacy.pages[0].desktop_layout == "flow"
    assert legacy.cards[0].desktop_layout is None and legacy.cards[0].mobile_layout is None
    body = config(desktop_layout={"x": 1.3, "y": 400, "w": 22.7, "h": 60}, mobile_layout={"order": 0, "width": "half", "height": 8, "hidden": True})
    assert reports.ReportConfig.model_validate_json(body.model_dump_json()) == body


def test_layout_persists_through_api_and_hidden_cards_keep_data_and_scope(interaction_session):
    user = interaction_session.get(AppUser, "M1")
    headers = {"Authorization": f"Bearer {auth.create_token(user)}"}
    client = TestClient(app)
    original = config()
    body = config(desktop_layout={"x": 4, "y": 10, "w": 20, "h": 16}, mobile_layout={"order": 0, "width": "full", "height": 18, "hidden": True})
    saved = client.put("/api/reports/config", headers=headers, json=body.model_dump(mode="json"))
    assert saved.status_code == 200
    assert saved.json() == body.model_dump(mode="json")
    assert client.get("/api/reports", headers=headers).json()["config"] == body.model_dump(mode="json")
    data = client.post("/api/reports/data", headers=headers, json=body.model_dump(mode="json"))
    baseline = client.post("/api/reports/data", headers=headers, json=original.model_dump(mode="json"))
    assert data.status_code == baseline.status_code == 200
    actual, expected = data.json(), baseline.json()
    assert actual.pop("loaded_at") and expected.pop("loaded_at")
    assert actual == expected
    sales_headers = {"Authorization": f"Bearer {auth.create_token(interaction_session.get(AppUser, 'S1'))}"}
    own = client.post("/api/reports/data", headers=sales_headers, json=body.model_dump(mode="json"))
    assert own.json()["cards"][0]["total"] == 650
    body.owner_id = "S3"
    assert client.post("/api/reports/data", headers=sales_headers, json=body.model_dump(mode="json")).status_code == 403
