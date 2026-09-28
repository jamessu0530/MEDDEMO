"""組織管理與 IT（backend/app/services/org_admin.py、api/admin.py）。

IT 坐在組織樹的根節點上，路徑就是 TW：截到任何共享層級都還是 TW，所以全公司看得到也動得了，
跟「主管看得到屬下」是同一個式子。主管端的提問、通報、簽核也改看組織樹，組織一改就跟著走。

會改組織的測試都跑在一條連線的交易裡（tx fixture）：API 的每個請求與測試本身共用這條連線，
測完整個回滾，別的測試看到的還是原本灌好的組織。
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_session
from app.main import app
from app.models import AppUser, AskRecord, Escalation, OaApprovalStep, OaExpenseForm, OrgChangeLog, Visit
from app.services import risk
from app.services.org import paths_from_reports
from app.services.scope import SELF, Scope
from app.services.sql_executor import run_readonly


@pytest.fixture
def tx(engine):
    """一條連線包一個交易，API 與測試都在裡面，測完回滾。commit 只會結束一個 savepoint。"""
    with engine.connect() as conn:
        outer = conn.begin()

        def session():
            with Session(bind=conn, join_transaction_mode="create_savepoint") as s:
                yield s

        app.dependency_overrides[get_session] = session
        try:
            with Session(bind=conn, join_transaction_mode="create_savepoint") as orm:
                yield orm
        finally:
            app.dependency_overrides.pop(get_session, None)
            outer.rollback()


@pytest.fixture
def client():
    return TestClient(app)


def fresh(orm: Session, user_id: str) -> AppUser:
    """API 在自己的 session 改完，測試這邊要重讀，不要拿身分對照表裡的舊值。"""
    return orm.get(AppUser, user_id, populate_existing=True)


def member(chart: dict, user_id: str) -> dict:
    return next(u for u in chart["users"] if u["id"] == user_id)


def test_it_sits_on_the_root_and_sees_everything(client, auth, engine):
    me = client.get("/api/auth/me", headers=auth("A01")).json()
    assert (me["role"], me["region"]) == ("it", "全國")

    # 三區各挑一家，都不是 IT 的客戶，檔案一樣打得開
    for customer_id in ("C002", "C011", "C017"):
        assert client.get(f"/api/customers/{customer_id}/profile", headers=auth("A01")).status_code == 200
    # 語意層（模型寫的 SQL）也一樣：TW 截到 REGION 還是 TW
    sql = "SELECT count(DISTINCT customer_id) FROM v_customer_summary"
    assert run_readonly(engine, sql, Scope(path="TW")).rows == [[250]]
    # 動得了：SELF 層級也涵蓋每個人
    assert Scope(path="TW").can_see(SELF, "TW.S.M03.U05") is True


def test_the_tree_refuses_a_position_that_does_not_match_the_role():
    units = {"TW": "root", "TW.N": "region"}
    ok = {"A01": ("it", None, "TW"), "M01": ("manager", None, "TW.N"), "U01": ("sales", "M01", None)}
    assert paths_from_reports(units, ok) == {"A01": "TW", "M01": "TW.N.M01", "U01": "TW.N.M01.U01"}

    bad = {
        "主管掛在根節點": {"M09": ("manager", None, "TW")},
        "IT 掛在區上": {"A09": ("it", None, "TW.N")},
        "業務直接掛在區上": {"U09": ("sales", None, "TW.N")},
        "主管接在別人後面": {"M09": ("manager", "M01", None)},
        "業務接在業務後面": {"U09": ("sales", "U01", None)},
        "業務接在 IT 後面": {"U09": ("sales", "A01", None)},
    }
    for case, extra in bad.items():
        with pytest.raises(ValueError, match=next(iter(extra))):
            paths_from_reports(units, ok | extra)
            pytest.fail(case)


def test_only_it_can_open_the_org_admin(client, auth):
    assert client.get("/api/admin/org").status_code == 401
    assert client.get("/api/admin/org", headers=auth("U01")).status_code == 403
    assert client.get("/api/admin/org", headers=auth("M01")).status_code == 403

    chart = client.get("/api/admin/org", headers=auth("A01")).json()
    # 根節點在前，區由北到南
    assert [u["id"] for u in chart["units"]] == ["TW", "TW.N", "TW.C", "TW.S"]
    # 公司帳號全列（自建與第三方登入的不在組織裡，不列）
    assert {u["id"] for u in chart["users"]} >= {"A01", "M01", "M02", "M03", "U01", "U02", "U03", "U04", "U05"}
    assert all(not u["id"].startswith("X") for u in chart["users"])
    assert member(chart, "U01")["customer_count"] == 50
    # 主管端 IT 也進得去
    assert client.get("/api/manager/notices", headers=auth("A01")).status_code == 200
    assert client.get("/api/oa/inbox", headers=auth("A01")).status_code == 200


def test_moving_a_manager_carries_the_team_and_their_region(tx, client, auth):
    # 代理 U01 的自建帳號不在樹上，轄區跟著 U01
    tx.add(AppUser(id="XTEST01", name="自建", role="sales", region="北區", acts_as_user_id="U01"))
    tx.commit()

    response = client.put("/api/admin/users/M01/unit", json={"unit_id": "TW.C"}, headers=auth("A01"))
    assert response.status_code == 200
    assert member(response.json(), "U01")["region"] == "中區"
    assert fresh(tx, "M01").org_path == "TW.C.M01"
    assert fresh(tx, "U02").org_path == "TW.C.M01.U02"
    assert fresh(tx, "XTEST01").region == "中區"
    assert response.json()["log"][0]["detail"] == "陳建宏從北區調到中區，底下 2 位業務跟著調"
    assert response.json()["log"][0]["actor_name"] == "James"

    # 業務跟著主管，不能自己調區
    moved = client.put("/api/admin/users/U01/unit", json={"unit_id": "TW.S"}, headers=auth("A01"))
    assert moved.status_code == 422


def test_changing_a_reps_manager_moves_their_pending_approval(tx, client, auth):
    form = tx.scalar(select(OaExpenseForm).where(OaExpenseForm.applicant_id == "U02").order_by(OaExpenseForm.id))
    step = tx.scalar(select(OaApprovalStep).where(OaApprovalStep.form_id == form.id, OaApprovalStep.step_no == 2))
    form.status, step.status, step.acted_at = "pending", "pending", None
    tx.commit()

    def inbox(user_id):
        return {item["id"] for item in client.get("/api/oa/inbox", headers=auth(user_id)).json()["items"]}

    assert form.id in inbox("M01") and form.id not in inbox("M02")

    response = client.put("/api/admin/users/U02/manager", json={"manager_id": "M02"}, headers=auth("A01"))
    assert response.status_code == 200
    assert fresh(tx, "U02").org_path == "TW.C.M02.U02"
    assert fresh(tx, "U02").region == "中區"
    # 還沒簽的那一關跟著改指派；看不看得到也跟著組織樹走
    assert form.id in inbox("M02") and form.id not in inbox("M01")
    assert client.get(f"/api/oa/forms/{form.id}", headers=auth("M01")).status_code == 404
    assert client.get(f"/api/oa/forms/{form.id}", headers=auth("M02")).json()["can_decide"] is True

    # IT 的簽核匣是全公司的，也能代簽；簽的那一關記實際簽的人
    assert form.id in inbox("A01")
    decided = client.post(f"/api/oa/forms/{form.id}/decide", json={"action": "approve"}, headers=auth("A01")).json()
    assert decided["status"] == "approved"
    assert decided["steps"][-1]["name"] == "James"


def test_notices_and_escalations_reach_the_direct_manager_and_it(tx, client, auth):
    visit = tx.scalar(select(Visit).where(Visit.user_id == "U02", Visit.status == "synced").order_by(Visit.id))
    visit.fields_final = {**(visit.fields_final or {}), "complaint": "測試：補貨延遲"}
    notice = risk.notify_manager(tx, visit)
    assert notice.manager_id == "M01"
    # 自建帳號不在樹上：他轉出去的提問換算成代理的 U01，送到 U01 的主管
    tx.add(AppUser(id="XTEST02", name="自建", role="sales", region="北區", acts_as_user_id="U01"))
    tx.flush()
    tx.add(AskRecord(id="test-admin-ask", user_id="XTEST02", kind="knowledge", question="測試：換貨", status="no_evidence"))
    tx.flush()
    tx.add(Escalation(ask_id="test-admin-ask", question="測試：換貨"))
    tx.commit()

    def notices(user_id):
        return {n["id"] for n in client.get("/api/manager/notices", headers=auth(user_id)).json()}

    def escalations(user_id):
        return {e["ask_id"] for e in client.get("/api/escalations", headers=auth(user_id)).json()}

    assert notice.id in notices("M01") and notice.id in notices("A01") and notice.id not in notices("M02")
    assert "test-admin-ask" in escalations("M01") and "test-admin-ask" in escalations("A01")
    assert "test-admin-ask" not in escalations("M02")

    # 業務換了主管，通報跟著人走（不看通報當時記的 manager_id）
    client.put("/api/admin/users/U02/manager", json={"manager_id": "M02"}, headers=auth("A01"))
    assert notice.id in notices("M02") and notice.id not in notices("M01")


def test_a_deactivated_account_cannot_sign_in(tx, client, auth):
    token = auth("U05")
    refused = client.post("/api/admin/users/U05/deactivate", json={}, headers=auth("A01"))
    assert refused.status_code == 422
    assert refused.json()["detail"] == "李佳蓉名下有 50 家客戶，要指定一位業務接手"

    chart = client.post("/api/admin/users/U05/deactivate", json={"successor_id": "U04"}, headers=auth("A01")).json()
    assert member(chart, "U05")["active"] is False
    assert member(chart, "U05")["customer_count"] == 0
    assert member(chart, "U04")["customer_count"] == 100
    # 停用的人留在樹上原位：他的歷史拜訪照舊給原本的團隊看
    assert fresh(tx, "U05").org_path == "TW.S.M03.U05"

    # 手上的 token 下一個請求就失效；密碼對了也登不進來
    me = client.get("/api/auth/me", headers=token)
    assert (me.status_code, me.json()["detail"]) == (401, "這個帳號已停用，請洽 IT")
    login = client.post("/api/auth/login", json={"email": "u05@meddemo.tw", "password": settings().demo_password})
    assert (login.status_code, login.json()["detail"]) == (401, "這個帳號已停用，請洽 IT")

    assert client.post("/api/admin/users/U05/reactivate", headers=auth("A01")).status_code == 200
    login = client.post("/api/auth/login", json={"email": "u05@meddemo.tw", "password": settings().demo_password})
    assert login.status_code == 200


def test_the_guards_explain_what_cannot_be_done(tx, client, auth):
    it = auth("A01")

    def refused(method, path, body=None):
        response = client.request(method, path, json=body, headers=it)
        assert response.status_code == 422, (path, response.json())
        return response.json()["detail"]

    # 示範業務：所有自建與第三方登入的帳號都看他的客戶
    assert "示範業務" in refused("POST", "/api/admin/users/U01/deactivate", {"successor_id": "U02"})
    assert "示範業務" in refused("PUT", "/api/admin/users/U01/role", {"role": "manager", "unit_id": "TW.N", "successor_id": "U02"})
    # 最高權限不能在畫面上動
    assert refused("POST", "/api/admin/users/A01/deactivate", {}) == "IT 帳號不能在這裡改"
    # 主管底下還有人：停用與降職都不行（降職連停用的屬下也算，否則樹會長到第五層）
    assert "2 位在職的業務" in refused("POST", "/api/admin/users/M03/deactivate", {})
    assert "1 位業務" in refused("PUT", "/api/admin/users/M02/role", {"role": "sales", "manager_id": "M01"})
    # 主管只能是主管；接手客戶的只能是業務
    assert refused("PUT", "/api/admin/users/U03/manager", {"manager_id": "U04"}) == "直屬主管要選一位主管"
    assert refused("PUT", "/api/admin/customers/C002/owner", {"owner_id": "M01"}) == "接手的人要選一位業務"
    # 最高權限開不出來
    assert client.post(
        "/api/admin/users",
        json={"name": "測試", "email": "it2@meddemo.tw", "password": "abcd1234", "role": "it", "unit_id": "TW"},
        headers=it,
    ).status_code == 422
    assert client.put("/api/admin/customers/C999/owner", json={"owner_id": "U01"}, headers=it).status_code == 404
    # 被擋下來的操作不留紀錄
    assert tx.scalar(select(OrgChangeLog.id)) is None


def test_promoting_hands_the_customers_over_and_takes_effect_without_signing_in_again(tx, client, auth):
    token = auth("U02")
    assert "要指定一位業務接手" in client.put(
        "/api/admin/users/U02/role", json={"role": "manager", "unit_id": "TW.C"}, headers=auth("A01")
    ).json()["detail"]

    chart = client.put(
        "/api/admin/users/U02/role",
        json={"role": "manager", "unit_id": "TW.C", "successor_id": "U01"},
        headers=auth("A01"),
    ).json()
    assert member(chart, "U02")["role"] == "manager"
    assert member(chart, "U02")["customer_count"] == 0
    assert member(chart, "U01")["customer_count"] == 100
    assert fresh(tx, "U02").org_path == "TW.C.U02"
    assert chart["log"][0]["detail"] == "王冠宇從業務升為中區主管，50 家客戶移交給林昱辰"
    # 權限每個請求都讀資料庫：同一張 token 馬上就是主管
    assert client.get("/api/auth/me", headers=token).json()["role"] == "manager"
    assert client.get("/api/manager/notices", headers=token).status_code == 200

    # 底下沒有人，可以降回業務
    chart = client.put(
        "/api/admin/users/U02/role", json={"role": "sales", "manager_id": "M01"}, headers=auth("A01")
    ).json()
    assert fresh(tx, "U02").org_path == "TW.N.M01.U02"
    assert member(chart, "U02")["region"] == "北區"


def test_a_new_account_gets_the_next_number_and_can_sign_in(tx, client, auth):
    new_rep = {"name": "測試業務", "email": "New.Rep@meddemo.tw", "role": "sales", "manager_id": "M02"}
    short = client.post("/api/admin/users", json=new_rep | {"password": "short"}, headers=auth("A01"))
    assert short.json()["detail"] == "初始密碼至少要 8 碼"

    created = client.post("/api/admin/users", json=new_rep | {"password": "abcd1234"}, headers=auth("A01"))
    assert created.status_code == 201
    assert member(created.json(), "U06")["region"] == "中區"
    assert fresh(tx, "U06").org_path == "TW.C.M02.U06"
    assert client.post("/api/admin/users", json=new_rep | {"password": "abcd1234"}, headers=auth("A01")).json()[
        "detail"
    ] == "這個 Email 已經有帳號了"

    manager = {"name": "測試主管", "email": "new.boss@meddemo.tw", "password": "abcd1234", "role": "manager", "unit_id": "TW.S"}
    chart = client.post("/api/admin/users", json=manager, headers=auth("A01")).json()
    # M 開頭接著 M03 編；IT 是 A01，不佔主管的號碼
    assert member(chart, "M04")["region"] == "南區"

    login = client.post("/api/auth/login", json={"email": "new.rep@meddemo.tw", "password": "abcd1234"})
    assert login.status_code == 200
    assert login.json()["user"]["role"] == "sales"


def test_it_can_hand_one_customer_to_another_rep(tx, client, auth):
    chart = client.put("/api/admin/customers/C002/owner", json={"owner_id": "U03"}, headers=auth("A01")).json()
    assert chart["log"][0]["detail"].endswith("的負責人從王冠宇改成黃怡君")
    assert client.get("/api/customers/C002", headers=auth("U03")).json()["owner_id"] == "U03"
    assert client.get("/api/customers/C002/profile", headers=auth("U03")).status_code == 200
    assert client.get("/api/customers/C002/profile", headers=auth("U02")).status_code == 404
