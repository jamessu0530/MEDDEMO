"""經理端改為客戶提問後，原本的動向追蹤入口不得再提供資料。"""

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.mark.parametrize("path", ["/api/manager/itineraries", "/api/manager/itineraries/U01", "/api/manager/locations"])
def test_tracking_is_retired_for_managers_and_it(tx, auth, path):
    client = TestClient(app)
    for user_id in ("M01", "A01"):
        response = client.get(path, headers=auth(user_id))
        assert response.status_code == 410
        assert response.json() == {"detail": "團隊動向追蹤已停用，請改看提問地圖。"}
    assert client.get(path, headers=auth("U01")).status_code == 403
    assert client.get(path).status_code == 401
