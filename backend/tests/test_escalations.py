"""提問轉介已移除，舊 API 不再接受讀寫。"""

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.mark.parametrize(("method", "path"), [
    ("POST", "/api/asks/legacy-ask/escalate"),
    ("GET", "/api/escalations"),
    ("GET", "/api/escalations/unseen"),
    ("POST", "/api/escalations/1/reply"),
    ("POST", "/api/escalations/1/seen"),
])
def test_removed_escalation_endpoints_return_not_found(method, path):
    with TestClient(app) as client:
        assert client.request(method, path, json={"answer": "舊的回覆"}).status_code == 404


def test_ask_response_no_longer_advertises_escalations():
    schema = app.openapi()
    assert "escalation_id" not in schema["components"]["schemas"]["AskDetail"]["properties"]
    assert not any("escalat" in path for path in schema["paths"])
