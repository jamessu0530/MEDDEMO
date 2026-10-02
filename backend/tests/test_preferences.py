"""帳號設定（api/preferences.py）：配色與字體大小跟著帳號，換手機登入也一樣。

會寫入的測試都跑在 tx fixture 的交易裡（conftest.py），測完回滾。
"""

import pytest
from fastapi.testclient import TestClient
from test_presence import connect, next_of

from app import realtime
from app.main import app
from app.models import UserPreference


@pytest.fixture
def client():
    return TestClient(app)


def mine(client, headers) -> dict:
    response = client.get("/api/preferences/me", headers=headers)
    assert response.status_code == 200
    return response.json()


def save(client, headers, **changes) -> dict:
    response = client.patch("/api/preferences/me", json=changes, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_an_account_that_never_saved_has_no_settings_yet(tx, client, auth):
    # 都是 null：手機看到這個就把自己現在的設定傳上來，換成存伺服器之前選的深色不會不見
    assert mine(client, auth("U02")) == {"skin": None, "text_size": None}


def test_each_change_only_touches_what_it_sends(tx, client, auth):
    # 第一次只改配色：字體大小用預設，不是 null
    assert save(client, auth("U02"), skin="dark") == {"skin": "dark", "text_size": "standard"}
    # 另一支手機改字體大小，不會把配色蓋回淺色
    assert save(client, auth("U02"), text_size="xlarge") == {"skin": "dark", "text_size": "xlarge"}
    assert mine(client, auth("U02")) == {"skin": "dark", "text_size": "xlarge"}
    # 別的帳號不受影響
    assert mine(client, auth("U03")) == {"skin": None, "text_size": None}
    assert tx.get(UserPreference, "U02").skin == "dark"


@pytest.mark.parametrize("changes", [{"skin": "mono"}, {"text_size": "huge"}])
def test_unknown_values_are_rejected(tx, client, auth, changes):
    assert client.patch("/api/preferences/me", json=changes, headers=auth("U02")).status_code == 422
    assert mine(client, auth("U02")) == {"skin": None, "text_size": None}


def test_settings_need_a_sign_in(client):
    assert client.get("/api/preferences/me").status_code == 401
    assert client.patch("/api/preferences/me", json={"skin": "dark"}).status_code == 401


def test_saving_tells_only_that_accounts_other_devices(tx, client, auth, monkeypatch):
    published = []
    monkeypatch.setattr(realtime, "publish", published.append)
    save(client, auth("U02"), skin="dark")
    assert published == [{"type": "preferences", "user_id": "U02"}]


def test_the_socket_forwards_a_settings_change_only_to_the_same_account(tx, client, engine, auth):
    with client.websocket_connect("/api/ws") as u02, client.websocket_connect("/api/ws") as u03:
        connect(u02, engine, "U02")
        connect(u03, engine, "U03")
        save(client, auth("U02"), skin="dark")
        assert next_of(u02, "preferences") == {"type": "preferences"}
        # 之後發一個大家都會收到的事件：U03 先收到的是它，代表 U02 改設定的事件沒有轉給 U03
        realtime.avatars_changed()
        while (event := u03.receive_json())["type"] not in ("preferences", "avatars"):
            pass
        assert event == {"type": "avatars"}


def test_deleting_an_account_deletes_its_settings(tx, client):
    registered = client.post(
        "/api/auth/register", json={"name": "評審", "email": "prefs@delete.test", "password": "password123"}
    )
    assert registered.status_code == 201
    headers = {"Authorization": f"Bearer {registered.json()['token']}"}
    user_id = registered.json()["user"]["id"]
    save(client, headers, text_size="large")
    assert client.delete("/api/auth/me", headers=headers).status_code == 204
    tx.expire_all()
    assert tx.get(UserPreference, user_id) is None
