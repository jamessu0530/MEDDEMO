"""Email 密碼登入（FR-12）：登入、換裝置、改密碼、主管才進得去的頁面。"""

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import auth


@pytest.fixture
def client(engine):
    return TestClient(app)


def login(client, user_id="U01", password=None):
    return client.post(
        "/api/auth/login",
        json={"email": f"{user_id.lower()}@meddemo.tw", "password": password or settings().demo_password},
    )


def test_login_returns_a_token_and_who_you_are(client):
    body = login(client).json()
    assert body["user"] == {
        "id": "U01", "name": "林昱辰", "role": "sales", "region": "北區", "email": "u01@meddemo.tw",
    }
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.json() == body["user"]


def test_email_is_case_insensitive(client):
    assert client.post(
        "/api/auth/login", json={"email": " U01@Meddemo.TW ", "password": settings().demo_password}
    ).status_code == 200


def test_wrong_password_and_unknown_email_say_what_to_do(client):
    wrong = login(client, password="wrong-password")
    assert wrong.status_code == 401 and wrong.json()["detail"] == auth.WRONG_PASSWORD
    missing = client.post("/api/auth/login", json={"email": "nobody@meddemo.tw", "password": "whatever"})
    assert missing.status_code == 401 and missing.json()["detail"] == auth.EMAIL_NOT_FOUND


def test_requests_without_a_token_are_rejected(client):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer nope"}).json()["detail"] == auth.TOKEN_EXPIRED


def test_logging_in_again_kicks_out_the_other_device(client):
    first = {"Authorization": f"Bearer {login(client).json()['token']}"}
    assert client.get("/api/auth/me", headers=first).status_code == 200
    second = {"Authorization": f"Bearer {login(client).json()['token']}"}
    kicked = client.get("/api/auth/me", headers=first)
    assert kicked.status_code == 401 and kicked.json()["detail"] == auth.SESSION_SUPERSEDED
    assert client.get("/api/auth/me", headers=second).status_code == 200


def test_logout_makes_the_token_useless(client):
    headers = {"Authorization": f"Bearer {login(client).json()['token']}"}
    assert client.post("/api/auth/logout", headers=headers).status_code == 204
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_changing_the_password(client):
    headers = {"Authorization": f"Bearer {login(client, 'U05').json()['token']}"}
    new_password = "new-password-1234"
    try:
        assert client.post(
            "/api/auth/change-password",
            json={"current_password": "not-the-password", "new_password": new_password},
            headers=headers,
        ).json()["detail"] == auth.WRONG_CURRENT_PASSWORD
        # 太短的新密碼擋在欄位驗證
        assert client.post(
            "/api/auth/change-password",
            json={"current_password": settings().demo_password, "new_password": "short"},
            headers=headers,
        ).status_code == 422

        changed = client.post(
            "/api/auth/change-password",
            json={"current_password": settings().demo_password, "new_password": new_password},
            headers=headers,
        )
        assert changed.status_code == 200
        # 改完換一張新的 token，舊的失效，但人不必重新登入
        assert client.get("/api/auth/me", headers=headers).status_code == 401
        fresh = {"Authorization": f"Bearer {changed.json()['token']}"}
        assert client.get("/api/auth/me", headers=fresh).status_code == 200
        assert login(client, "U05").status_code == 401
        assert login(client, "U05", password=new_password).status_code == 200
    finally:
        # 別的測試還要用預設密碼登入，改回來
        headers = {"Authorization": f"Bearer {login(client, 'U05', password=new_password).json()['token']}"}
        client.post(
            "/api/auth/change-password",
            json={"current_password": new_password, "new_password": settings().demo_password},
            headers=headers,
        )


def test_usage_limits_count_per_account_when_logged_in(client):
    """有登入就按帳號算，沒登入才按 IP：決賽現場大家連同一個 Wi-Fi，不然會共用一份額度。"""
    from app import usage

    token = login(client).json()["token"]
    request = type("R", (), {"headers": {"authorization": f"Bearer {token}"}, "client": None})()
    assert usage.client_address(request) == "user:U01"
    anonymous = type("R", (), {"headers": {"cf-connecting-ip": "1.2.3.4"}, "client": None})()
    assert usage.client_address(anonymous) == "1.2.3.4"
