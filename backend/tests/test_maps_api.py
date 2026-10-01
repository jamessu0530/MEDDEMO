"""主管頁的地圖金鑰：有設才給、只給主管端，不寫進前端的建置。"""

from fastapi.testclient import TestClient

from app.main import app


def config(auth, user_id="M01"):
    return TestClient(app).get("/api/maps/config", headers=auth(user_id))


def test_no_browser_key_means_no_map(auth):
    response = config(auth)
    assert response.status_code == 200 and response.json() is None


def test_the_browser_key_and_map_id_come_from_settings(auth, env):
    env(GOOGLE_MAPS_BROWSER_KEY="browser-key", GOOGLE_MAPS_MAP_ID="map-1")
    assert config(auth).json() == {"browser_key": "browser-key", "map_id": "map-1"}


def test_without_a_map_id_the_map_uses_googles_demo_id(auth, env):
    env(GOOGLE_MAPS_BROWSER_KEY="browser-key")
    assert config(auth, "A01").json() == {"browser_key": "browser-key", "map_id": "DEMO_MAP_ID"}


def test_only_the_manager_side_gets_it(auth, env):
    env(GOOGLE_MAPS_BROWSER_KEY="browser-key")
    denied = config(auth, "U01")
    assert denied.status_code == 403 and denied.json()["detail"] == "這個頁面只有主管看得到"
    assert TestClient(app).get("/api/maps/config").status_code == 401
