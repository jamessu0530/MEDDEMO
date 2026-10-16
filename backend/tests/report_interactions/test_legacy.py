from fastapi.testclient import TestClient

from app.main import app
from app.models import AppUser
from app.services import auth, reports


def test_old_report_payload_still_queries_and_defaults_to_filter(interaction_session):
    config = reports.ReportConfig.model_validate({
        "name": "舊報表", "template": "manager", "period": "this_month",
        "cards": [{"id": "total", "title": "業績", "metric": "sales", "dimension": "none", "visual": "kpi"}],
    })
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {auth.create_token(interaction_session.get(AppUser, 'M1'))}"}
    response = client.post("/api/reports/data", json=config.model_dump(mode="json"), headers=headers)
    assert response.status_code == 200
    card = response.json()["cards"][0]
    assert card["total"] == 2250 and card["highlight"] is None
    assert config.cards[0].interaction == "filter"
