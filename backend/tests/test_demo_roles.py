"""切換示範角色保留本人身分：權限、共用資料範圍、還原與帳號管理。"""

import datetime as dt

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import AppUser
from app.services import auth as auth_service
from app.services import oauth


@pytest.fixture
def client(tx):
    return TestClient(app)


def headers(token):
    return {"Authorization": f"Bearer {token}"}


def switch(client, authorization, role):
    response = client.post("/api/auth/demo-role", headers=authorization, json={"role": role})
    assert response.status_code == 200, response.text
    return response.json()


def test_disabled_demo_keeps_normal_permissions(client, auth):
    authorization = auth("U02")
    assert client.get("/api/auth/me", headers=authorization).json()["demo"] is None
    assert client.post("/api/auth/demo-role", headers=authorization, json={"role": "it"}).status_code == 403
    assert client.get("/api/admin/org", headers=authorization).status_code == 403
    assert client.get("/api/manager/customer-priority", headers=authorization).status_code == 403


@pytest.mark.parametrize("account_id", ["U01", "U02", "M02", "A01"])
@pytest.mark.parametrize("role,target_id", [("sales", "U01"), ("manager", "M01"), ("it", "A01")])
def test_every_account_can_switch_without_changing_accounts(client, auth, tx, env, account_id, role, target_id):
    env(DEMO_ROLE_SWITCH="true")
    account = tx.get(AppUser, account_id)
    target = tx.get(AppUser, target_id)
    before = {user.id: (user.role, user.session_version, user.password_hash, user.org_path) for user in (account, target)}
    authorization = auth(account_id)
    original_profile = client.get("/api/auth/me", headers=authorization).json()
    claims = auth_service.token_claims(authorization["Authorization"].removeprefix("Bearer "))
    result = switch(client, authorization, role)
    for field in ("id", "name", "email", "region", "has_password", "can_rename", "linked"):
        assert result["user"][field] == original_profile[field]
    assert result["user"]["role"] == role
    assert result["user"]["demo"]["role"] == role
    assert result["user"]["demo"]["account"] == {
        key: value for key, value in original_profile.items() if key != "demo"
    }
    switched_claims = auth_service.token_claims(result["token"])
    assert (switched_claims["sub"], switched_claims["sv"], switched_claims["exp"]) == (
        account_id, claims["sv"], claims["exp"],
    )
    assert client.get("/api/auth/me", headers=headers(result["token"])).json() == result["user"]
    assert client.get("/api/manager/customer-priority", headers=headers(result["token"])).status_code == (403 if role == "sales" else 200)
    assert client.get("/api/admin/org", headers=headers(result["token"])).status_code == (200 if role == "it" else 403)
    tx.expire_all()
    for user_id, original in before.items():
        user = tx.get(AppUser, user_id)
        assert (user.role, user.session_version, user.password_hash, user.org_path) == original


def test_switches_keep_original_account_and_restore_it(client, auth, env):
    env(DEMO_ROLE_SWITCH="true")
    authorization = auth("U02")
    for role in ("it", "manager", "sales"):
        result = switch(client, authorization, role)
        assert result["user"]["demo"]["account"]["id"] == "U02"
        authorization = headers(result["token"])
    restored = switch(client, authorization, None)
    assert restored["user"]["id"] == "U02"
    assert restored["user"]["demo"]["role"] is None
    assert client.get("/api/admin/org", headers=headers(restored["token"])).status_code == 403


def test_manager_data_scope_matches_demo_manager(client, auth, env):
    env(DEMO_ROLE_SWITCH="true")
    demo = switch(client, auth("U04"), "manager")
    for path in ("/api/manager/customer-priority", "/api/oa/inbox"):
        expected = client.get(path, headers=auth("M01"))
        actual = client.get(path, headers=headers(demo["token"]))
        assert expected.status_code == actual.status_code == 200
        assert actual.json() == expected.json()


def test_disabling_demo_revokes_existing_demo_permissions(client, auth, env):
    env(DEMO_ROLE_SWITCH="true")
    demo = switch(client, auth("U02"), "it")
    authorization = headers(demo["token"])
    assert client.get("/api/admin/org", headers=authorization).status_code == 200
    env(DEMO_ROLE_SWITCH="false")
    me = client.get("/api/auth/me", headers=authorization).json()
    assert me["id"] == "U02" and me["role"] == "sales" and me["demo"] is None
    assert client.get("/api/admin/org", headers=authorization).status_code == 403
    assert client.get("/api/manager/customer-priority", headers=authorization).status_code == 403


def test_logout_invalidates_real_account_only(client, auth, tx, env):
    env(DEMO_ROLE_SWITCH="true")
    original_it = auth("A01")
    account_version = tx.get(AppUser, "U02").session_version
    demo = switch(client, auth("U02"), "it")
    assert client.post("/api/auth/logout", headers=headers(demo["token"])).status_code == 204
    assert client.get("/api/auth/me", headers=headers(demo["token"])).status_code == 401
    assert client.get("/api/auth/me", headers=original_it).status_code == 200
    tx.expire_all()
    assert tx.get(AppUser, "U02").session_version == account_version + 1


@pytest.mark.parametrize("role,target_id", [("sales", "U01"), ("manager", "M01"), ("it", "A01")])
def test_registered_accounts_can_demo_and_account_edits_stay_personal(client, tx, env, monkeypatch, role, target_id):
    env(DEMO_ROLE_SWITCH="true")
    registered = client.post("/api/auth/register", json={
        "name": "展示評審", "email": "demo-judge@example.test", "password": "judge-demo-1234",
    })
    assert registered.status_code == 201
    original = registered.json()
    target = tx.get(AppUser, target_id)
    target_name, target_password = target.name, target.password_hash
    demo = switch(client, headers(original["token"]), role)
    assert demo["user"]["demo"]["account"]["email"] == "demo-judge@example.test"
    assert demo["user"]["demo"]["account"]["has_password"] is True
    assert demo["user"]["demo"]["account"]["can_rename"] is True
    authorization = headers(demo["token"])
    renamed = client.patch("/api/auth/me/profile", headers=authorization, json={"name": "新評審名稱"})
    assert renamed.status_code == 200
    assert renamed.json()["demo"]["account"]["name"] == "新評審名稱"
    assert renamed.json()["id"] == original["user"]["id"]
    assert renamed.json()["name"] == "新評審名稱"
    assert renamed.json()["role"] == role
    monkeypatch.setattr(oauth, "verify_google", lambda credential: oauth.ExternalIdentity(
        "google", credential, "judge-linked@example.test", "評審 Google",
    ))
    linked = client.post("/api/auth/oauth/google/link", headers=authorization, json={"credential": "judge-google"})
    assert linked.status_code == 200
    assert linked.json()["id"] == original["user"]["id"]
    assert linked.json()["name"] == "新評審名稱"
    assert linked.json()["demo"]["account"]["linked"][0]["email"] == "judge-linked@example.test"
    unlinked = client.delete("/api/auth/oauth/google", headers=authorization)
    assert unlinked.status_code == 200
    assert unlinked.json()["demo"]["account"]["linked"] == []
    changed = client.post("/api/auth/change-password", headers=authorization, json={
        "current_password": "judge-demo-1234", "new_password": "judge-new-1234",
    })
    assert changed.status_code == 200
    assert changed.json()["user"]["id"] == original["user"]["id"]
    assert changed.json()["user"]["demo"]["role"] is None
    tx.expire_all()
    assert tx.get(AppUser, target_id).name == target_name
    assert tx.get(AppUser, target_id).password_hash == target_password
    assert tx.get(AppUser, original["user"]["id"]).role == "sales"


def test_delete_in_demo_deletes_real_account_only(client, tx, env):
    env(DEMO_ROLE_SWITCH="true")
    original = client.post("/api/auth/register", json={
        "name": "刪除評審", "email": "demo-delete@example.test", "password": "judge-demo-1234",
    }).json()
    demo = switch(client, headers(original["token"]), "it")
    assert client.delete("/api/auth/me", headers=headers(demo["token"])).status_code == 204
    tx.expire_all()
    assert tx.get(AppUser, original["user"]["id"]) is None
    assert tx.get(AppUser, "A01") is not None


def test_demo_requires_login_and_valid_role(client, auth, env):
    env(DEMO_ROLE_SWITCH="true")
    assert client.post("/api/auth/demo-role", json={"role": "it"}).status_code == 401
    assert client.post("/api/auth/demo-role", headers=headers("forged"), json={"role": "it"}).status_code == 401
    assert client.post("/api/auth/demo-role", headers=auth("U01"), json={"role": "owner"}).status_code == 422


def test_switch_does_not_extend_session_or_log_out_other_viewers(client, auth, tx, env):
    env(DEMO_ROLE_SWITCH="true")
    expires = int((dt.datetime.now(dt.UTC) + dt.timedelta(minutes=5)).timestamp())
    token = auth_service.create_token(tx.get(AppUser, "U02"), expires_at=expires)
    first = switch(client, headers(token), "it")
    second = switch(client, auth("U04"), "it")
    assert auth_service.token_claims(first["token"])["exp"] == expires
    for viewer in (first, second):
        assert client.get("/api/admin/org", headers=headers(viewer["token"])).status_code == 200


def test_disabled_demo_character_is_not_used(client, auth, tx, env):
    env(DEMO_ROLE_SWITCH="true")
    tx.get(AppUser, "M01").deactivated_at = dt.datetime.now(dt.UTC)
    tx.commit()
    response = client.post("/api/auth/demo-role", headers=auth("U02"), json={"role": "manager"})
    assert response.status_code == 409


def test_google_account_can_demo_and_bindings_belong_to_real_account(client, tx, env, monkeypatch):
    env(DEMO_ROLE_SWITCH="true")
    monkeypatch.setattr(oauth, "verify_google", lambda credential: oauth.ExternalIdentity(
        "google", credential, f"{credential}@example.test", "Google 展示評審",
    ))
    signed_in = client.post("/api/auth/oauth/google/login", json={"credential": "demo-google-judge"})
    assert signed_in.status_code == 200
    original = signed_in.json()
    demo = switch(client, headers(original["token"]), "it")
    assert client.get("/api/admin/org", headers=headers(demo["token"])).status_code == 200
    assert demo["user"]["demo"]["account"]["id"] == original["user"]["id"]
    assert demo["user"]["id"] == original["user"]["id"]
    assert demo["user"]["name"] == "Google 展示評審"
    assert demo["user"]["demo"]["account"]["has_password"] is False
    assert demo["user"]["demo"]["account"]["linked"][0]["email"] == "demo-google-judge@example.test"
    # 不能因為目前展示 IT 就把另一個 Google 綁到 A01。
    linked = client.post("/api/auth/oauth/google/link", headers=headers(demo["token"]), json={"credential": "demo-another-google"})
    assert linked.status_code == 409
    unlinked = client.delete("/api/auth/oauth/google", headers=headers(demo["token"]))
    assert unlinked.status_code == 409 and "唯一" in unlinked.json()["detail"]
    tx.expire_all()
    assert tx.get(AppUser, original["user"]["id"]).role == "sales"
    restored = switch(client, headers(demo["token"]), None)
    assert restored["user"]["id"] == original["user"]["id"]
    assert restored["user"]["has_password"] is False
    assert restored["user"]["linked"][0]["provider"] == "google"


def test_james_keeps_his_name_on_personal_page_after_switching_roles(client, env):
    env(DEMO_ROLE_SWITCH="true")
    original = client.post("/api/auth/register", json={
        "name": "james su", "email": "james-personal@example.test", "password": "james-demo-1234",
    }).json()
    authorization = headers(original["token"])
    for role in ("manager", "it", "sales"):
        result = switch(client, authorization, role)
        assert result["user"]["id"] == original["user"]["id"]
        assert result["user"]["name"] == "james su"
        authorization = headers(result["token"])
    personal = client.get("/api/me", headers=authorization)
    assert personal.status_code == 200
    assert personal.json()["name"] == "james su"
    assert client.get("/api/itinerary/today", headers=authorization).status_code == 200


def test_messages_in_demo_are_authored_by_the_logged_in_person(client, auth, env):
    env(DEMO_ROLE_SWITCH="true")
    original = client.get("/api/auth/me", headers=auth("U02")).json()
    demo = switch(client, auth("U02"), "manager")
    authorization = headers(demo["token"])
    channels = client.get("/api/channels", headers=authorization).json()
    national = next(channel for channel in channels if channel["name"] == "全國")
    response = client.post(f"/api/channels/{national['id']}/messages", headers=authorization, json={"body": "以本人身分發言"})
    assert response.status_code == 201, response.text
    assert response.json()["author_id"] == original["id"]
    assert response.json()["author_name"] == original["name"]
