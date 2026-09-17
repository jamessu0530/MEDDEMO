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
        "has_password": True, "linked": [], "acting_as": None, "can_rename": False,
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
        wrong = client.post(
            "/api/auth/change-password",
            json={"current_password": "not-the-password", "new_password": new_password},
            headers=headers,
        )
        # 400 不是 401：人還是登入著，前端看到 401 會把人登出
        assert wrong.status_code == 400 and wrong.json()["detail"] == auth.WRONG_CURRENT_PASSWORD
        assert client.get("/api/auth/me", headers=headers).status_code == 200
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


def test_an_empty_password_never_signs_in(client):
    """9/16 線上出過事：DEMO_PASSWORD 沒設、部署傳進空字串，八個帳號被灌成空白密碼。"""
    assert client.post("/api/auth/login", json={"email": "u01@meddemo.tw", "password": ""}).status_code == 422
    assert auth.verify_password("", auth.hash_password("")) is False


def test_a_blank_demo_password_setting_falls_back_to_the_default(env):
    from app.config import DEFAULT_DEMO_PASSWORD

    env(DEMO_PASSWORD="")
    assert settings().demo_password == DEFAULT_DEMO_PASSWORD
    env(DEMO_PASSWORD="   ")
    assert settings().demo_password == DEFAULT_DEMO_PASSWORD


def test_seeding_refuses_a_short_password(env):
    import datetime as dt

    import generate

    env(DEMO_PASSWORD="short")
    with pytest.raises(ValueError, match="至少要 8 碼"):
        generate.generate(dt.date(2026, 10, 28))


def _cleanup_registered(engine):
    from sqlalchemy import text as sql

    with engine.begin() as conn:
        conn.execute(sql("DELETE FROM app_user WHERE id LIKE 'X%' AND email LIKE '%@register.test'"))


def test_anyone_can_create_an_account_and_is_signed_in(client, engine):
    try:
        created = client.post(
            "/api/auth/register", json={"name": " 陳評審 ", "email": " Judge@Register.test ", "password": "judge-pass-1"}
        )
        assert created.status_code == 201
        user = created.json()["user"]
        assert user["id"].startswith("X") and user["name"] == "陳評審" and user["email"] == "judge@register.test"
        # 自己建立的帳號一律是業務，看示範業務的客戶
        assert user["role"] == "sales" and user["has_password"] is True
        assert user["acting_as"] == {"id": "U01", "name": "林昱辰"}
        headers = {"Authorization": f"Bearer {created.json()['token']}"}
        assert client.get("/api/auth/me", headers=headers).status_code == 200
        assert len(client.get("/api/customers", headers=headers).json()) == 50

        # 之後用同一組 Email 密碼登入得進去；同一個 Email 不能再建一次
        assert client.post("/api/auth/login", json={"email": "judge@register.test", "password": "judge-pass-1"}).status_code == 200
        again = client.post("/api/auth/register", json={"name": "重複", "email": "JUDGE@register.test", "password": "another-pass"})
        assert again.status_code == 409 and "直接登入" in again.json()["detail"]
    finally:
        _cleanup_registered(engine)


def test_company_emails_cannot_be_registered_again(client):
    taken = client.post("/api/auth/register", json={"name": "冒名", "email": "u01@meddemo.tw", "password": "whatever-123"})
    assert taken.status_code == 409


def test_bad_registrations_are_rejected(client):
    post = lambda body: client.post("/api/auth/register", json=body).status_code
    assert post({"name": "陳評審", "email": "not-an-email", "password": "long-enough-1"}) == 422
    assert post({"name": "陳評審", "email": "a@register.test", "password": "short"}) == 422
    assert post({"name": "   ", "email": "b@register.test", "password": "long-enough-1"}) == 422
    assert post({"name": "", "email": "c@register.test", "password": "long-enough-1"}) == 422


def test_an_email_used_by_a_third_party_account_points_to_that_provider(client, engine):
    from sqlalchemy.orm import Session as OrmSession

    from app.models import AppUser, UserIdentity

    with OrmSession(engine) as session:
        session.add(AppUser(id="XGOOGLE1", name="G", role="sales", region="北區", email=None, password_hash=None, acts_as_user_id="U01"))
        session.flush()
        session.add(UserIdentity(user_id="XGOOGLE1", provider="google", subject="g-sub-1", email="g@register.test"))
        session.commit()
    try:
        register = client.post("/api/auth/register", json={"name": "谷歌", "email": "g@register.test", "password": "long-enough-1"})
        assert register.status_code == 409 and "請用 Google 登入" in register.json()["detail"]
        login = client.post("/api/auth/login", json={"email": "g@register.test", "password": "whatever-1"})
        assert login.status_code == 401 and "請用 Google 登入" in login.json()["detail"]
    finally:
        with OrmSession(engine) as session:
            session.delete(session.get(AppUser, "XGOOGLE1"))
            session.commit()


def test_a_self_created_account_can_rename_itself(client, engine):
    try:
        created = client.post(
            "/api/auth/register", json={"name": "陳評審", "email": "rename@register.test", "password": "judge-pass-1"}
        ).json()
        headers = {"Authorization": f"Bearer {created['token']}"}
        assert created["user"]["can_rename"] is True

        renamed = client.patch("/api/auth/me/profile", json={"name": "  Judge   Chen  "}, headers=headers)
        assert renamed.status_code == 200
        # 頭尾空白去掉、中間連續空白併成一個；英文姓名的空白要留著
        assert renamed.json()["name"] == "Judge Chen"
        assert client.get("/api/auth/me", headers=headers).json()["name"] == "Judge Chen"

        for bad, message in (("陳", "2～32"), ("很" * 33, "2～32"), ("fuckname", "不當用字")):
            rejected = client.patch("/api/auth/me/profile", json={"name": bad}, headers=headers)
            assert rejected.status_code == 422 and message in rejected.json()["detail"]
        # 名字不用唯一：業務同名很正常
        assert client.patch("/api/auth/me/profile", json={"name": "林昱辰"}, headers=headers).status_code == 200
    finally:
        _cleanup_registered(engine)


def test_company_accounts_cannot_rename(client, auth):
    response = client.patch("/api/auth/me/profile", json={"name": "亂改的名字"}, headers=auth("U01"))
    assert response.status_code == 403
    assert client.get("/api/auth/me", headers=auth("U01")).json()["name"] == "林昱辰"


def test_registration_uses_the_same_name_rules(client):
    post = lambda name: client.post(
        "/api/auth/register", json={"name": name, "email": "rules@register.test", "password": "long-enough-1"}
    )
    assert post("陳").status_code == 422
    assert "不當用字" in post("傻逼").json()["detail"]


def test_a_self_created_account_can_delete_itself_with_its_data(client, engine):
    from sqlalchemy import text as sql

    created = client.post(
        "/api/auth/register", json={"name": "要刪的人", "email": "delete@register.test", "password": "judge-pass-1"}
    ).json()
    headers = {"Authorization": f"Bearer {created['token']}"}
    user_id = created["user"]["id"]
    quote = client.post("/api/customers/C001/quotes", json={"items": [{"sku": "HS-FO30", "qty": 1}]}, headers=headers).json()
    client.post("/api/asks", json={"kind": "knowledge", "question": "測試：刪帳號前問的"}, headers=headers)
    try:
        assert client.delete("/api/auth/me", headers=headers).status_code == 204
        assert client.get("/api/auth/me", headers=headers).status_code == 401
        assert client.post("/api/auth/login", json={"email": "delete@register.test", "password": "judge-pass-1"}).status_code == 401
        with engine.connect() as conn:
            assert conn.execute(sql("SELECT count(*) FROM app_user WHERE id = :u"), {"u": user_id}).scalar_one() == 0
            assert conn.execute(sql("SELECT count(*) FROM ask_record WHERE user_id = :u"), {"u": user_id}).scalar_one() == 0
            # 報價草稿是客戶的交易紀錄，留著，只清掉是誰開的
            assert conn.execute(
                sql("SELECT created_by FROM sap_quotation_draft WHERE quote_no = :q"), {"q": quote["quote_no"]}
            ).scalar_one() is None
    finally:
        with engine.begin() as conn:
            conn.execute(sql("DELETE FROM sap_quotation_draft WHERE quote_no = :q"), {"q": quote["quote_no"]})
        _cleanup_registered(engine)


def test_company_accounts_cannot_be_deleted(client, auth):
    assert client.delete("/api/auth/me", headers=auth("U02")).status_code == 403

