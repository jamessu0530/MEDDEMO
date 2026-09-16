"""第三方登入：第一次登入自動開業務帳號、Email 帳號也能綁、一個第三方帳號只屬於一個人。

真的去打 Google／GitHub／Facebook 要有各家的 App 設定，測試裡把「驗證憑證」換成假的，
只測我們自己的規則；各家驗證函式另外測「沒設定」與「憑證是假的」這兩種會擋下來的情況。
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.config import settings
from app.main import app
from app.models import AppUser, UserIdentity
from app.services import oauth


@pytest.fixture
def client(engine):
    with Session(engine) as session:
        session.execute(delete(UserIdentity))
        # 前一個測試自動開的帳號也清掉
        session.execute(delete(AppUser).where(AppUser.id.like("X%")))
        session.commit()
    return TestClient(app)


@pytest.fixture
def fake_google(monkeypatch):
    """把 Google 的驗證換成假的：credential 寫什麼，subject 就是什麼。"""

    def verify(credential):
        if credential == "bad":
            raise oauth.OAuthError("Google 登入驗證失敗，請再試一次")
        return oauth.ExternalIdentity("google", credential, f"{credential}@gmail.com", f"評審 {credential}")

    monkeypatch.setattr(oauth, "verify_google", verify)


def google_login(client, subject):
    return client.post("/api/auth/oauth/google/login", json={"credential": subject})


def test_providers_hides_what_is_not_configured(client, env):
    env(GOOGLE_CLIENT_ID="", GITHUB_CLIENT_ID="", GITHUB_CLIENT_SECRET="", FACEBOOK_APP_ID="", FACEBOOK_APP_SECRET="")
    assert client.get("/api/auth/providers").json() == {"google": None, "github": None, "facebook": None}
    env(GOOGLE_CLIENT_ID="abc.apps.googleusercontent.com", GITHUB_CLIENT_ID="Iv1.x")
    body = client.get("/api/auth/providers").json()
    assert body["google"] == {"client_id": "abc.apps.googleusercontent.com"}
    # 只有 id 沒有 secret 換不了 token，不算設定好；也不能把 secret 回給前端
    assert body["github"] is None
    assert "secret" not in str(body).lower()


def test_first_sign_in_opens_a_sales_account_that_sees_the_demo_rep(client, fake_google):
    first = google_login(client, "g-judge")
    assert first.status_code == 200
    user = first.json()["user"]
    assert user["id"].startswith("X") and user["name"] == "評審 g-judge"
    # 一律是業務，不會自動變主管；沒有密碼；看的是示範業務的資料
    assert user["role"] == "sales"
    assert user["has_password"] is False and user["email"] is None
    assert user["acting_as"] == {"id": "U01", "name": "林昱辰"}
    assert [(i["provider"], i["email"]) for i in user["linked"]] == [("google", "g-judge@gmail.com")]

    # 第二次登入回到同一個帳號，不會再開一個
    again = google_login(client, "g-judge")
    assert again.json()["user"]["id"] == user["id"]

    headers = {"Authorization": f"Bearer {again.json()['token']}"}
    route = client.post("/api/route/today", json={}, headers=headers).json()
    assert route["rep"]["id"] == "U01" and len(route["stops"]) == 5
    assert client.post("/api/escalations/1/reply", json={"answer": "x"}, headers=headers).status_code == 403


def test_an_external_account_cannot_lock_itself_out(client, fake_google):
    token = google_login(client, "g-lonely").json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    blocked = client.delete("/api/auth/oauth/google", headers=headers)
    assert blocked.status_code == 409 and "唯一的登入方式" in blocked.json()["detail"]
    no_password = client.post(
        "/api/auth/change-password", json={"current_password": "x", "new_password": "whatever-123"}, headers=headers
    )
    assert no_password.status_code == 400 and "沒有密碼" in no_password.json()["detail"]


def test_link_then_sign_in(client, auth, fake_google):
    linked = client.post("/api/auth/oauth/google/link", json={"credential": "g-lin"}, headers=auth("U01"))
    assert linked.status_code == 200
    assert [(i["provider"], i["email"]) for i in linked.json()["linked"]] == [("google", "g-lin@gmail.com")]

    signed_in = google_login(client, "g-lin")
    assert signed_in.status_code == 200
    assert signed_in.json()["user"]["id"] == "U01"
    # 第三方登入跟 Email 登入一樣會踢掉別的裝置
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {signed_in.json()['token']}"})
    assert me.json()["linked"][0]["provider"] == "google"


def test_one_external_account_belongs_to_one_person(client, auth, fake_google):
    assert client.post("/api/auth/oauth/google/link", json={"credential": "g-shared"}, headers=auth("U01")).status_code == 200
    taken = client.post("/api/auth/oauth/google/link", json={"credential": "g-shared"}, headers=auth("U02"))
    assert taken.status_code == 409 and "別的帳號" in taken.json()["detail"]
    # 同一人綁第二個 Google 要先解除
    second = client.post("/api/auth/oauth/google/link", json={"credential": "g-other"}, headers=auth("U01"))
    assert second.status_code == 409 and "解除綁定" in second.json()["detail"]


def test_an_email_account_can_unlink(client, auth, fake_google):
    headers = auth("U03")
    client.post("/api/auth/oauth/google/link", json={"credential": "g-huang"}, headers=headers)
    assert client.delete("/api/auth/oauth/google", headers=headers).json()["linked"] == []
    # 解除之後同一個 Google 再來登入，就是當作新人自動開帳號，不會回到黃怡君的帳號
    assert google_login(client, "g-huang").json()["user"]["id"] != "U03"


def test_linking_requires_being_signed_in_and_a_valid_credential(client, auth, fake_google):
    assert client.post("/api/auth/oauth/google/link", json={"credential": "g-x"}).status_code == 401
    # 已經登入時憑證不對是 400 不是 401：401 會讓前端以為登入過期把人登出
    assert client.post("/api/auth/oauth/google/link", json={"credential": "bad"}, headers=auth()).status_code == 400
    assert client.post("/api/auth/oauth/google/link", json={}, headers=auth()).status_code == 422
    assert client.post("/api/auth/oauth/twitter/login", json={"credential": "x"}).status_code == 422


def test_real_verifiers_refuse_when_not_configured(env):
    env(GOOGLE_CLIENT_ID="", GITHUB_CLIENT_ID="", GITHUB_CLIENT_SECRET="", FACEBOOK_APP_ID="", FACEBOOK_APP_SECRET="")
    for call in (
        lambda: oauth.verify_google("x"),
        lambda: oauth.verify_github("code", "https://example.com/cb"),
        lambda: oauth.verify_facebook("token"),
    ):
        with pytest.raises(oauth.NotConfigured):
            call()


def test_google_rejects_a_forged_token(env, monkeypatch):
    env(GOOGLE_CLIENT_ID="abc.apps.googleusercontent.com")
    # 不去網路上抓 Google 的公鑰（測試不連外）；給一份不含這張 token 金鑰編號的公鑰清單，
    # 走的是真的驗簽章流程
    from google.oauth2 import id_token as google_id_token

    monkeypatch.setattr(google_id_token, "_fetch_certs", lambda request, url: {"other-key": "-----BEGIN CERTIFICATE-----"})
    # 格式像 JWT 但不是 Google 簽的：驗簽章那一步就要擋下，不能只解開來看內容
    forged = "eyJhbGciOiJSUzI1NiIsImtpZCI6IngifQ.eyJzdWIiOiIxMjMiLCJhdWQiOiJhYmMifQ.c2lnbmF0dXJl"
    with pytest.raises(oauth.OAuthError):
        oauth.verify_google(forged)
    assert settings().google_client_id == "abc.apps.googleusercontent.com"


def test_facebook_token_for_another_app_is_rejected(env, monkeypatch):
    """debug_token 說 token 有效，但是發給別的 App：不能讓別的 App 拿到的 token 冒用。"""
    env(FACEBOOK_APP_ID="111", FACEBOOK_APP_SECRET="s")

    class Response:
        status_code = 200

        def __init__(self, payload):
            self._payload = payload

        def json(self):
            return self._payload

    def fake_get(url, params=None, timeout=None):
        if url.endswith("/debug_token"):
            return Response({"data": {"is_valid": True, "app_id": "999", "user_id": "fb-1"}})
        return Response({"id": "fb-1"})

    monkeypatch.setattr(oauth.httpx, "get", fake_get)
    with pytest.raises(oauth.OAuthError):
        oauth.verify_facebook("token-from-another-app")

    def fake_get_ok(url, params=None, timeout=None):
        if url.endswith("/debug_token"):
            return Response({"data": {"is_valid": True, "app_id": "111", "user_id": "fb-1"}})
        return Response({"id": "fb-1", "email": "a@b.c"})

    monkeypatch.setattr(oauth.httpx, "get", fake_get_ok)
    assert oauth.verify_facebook("good").subject == "fb-1"
