"""資料權限：業務只看得到自己負責的客戶，主管只看得到自己轄區（原型登入頁與問答頁的說明）。"""

import datetime as dt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.asks import mentioned_customers
from app.main import app
from app.models import AppUser, AskRecord
from app.services.scope import Scope
from app.services.sql_executor import QueryRejected, run_readonly


@pytest.fixture
def client(engine):
    return TestClient(app)


def test_sales_see_their_own_customers_and_managers_their_region(client, auth):
    assert client.get("/api/customers").status_code == 401
    assert len(client.get("/api/customers", headers=auth("U01")).json()) == 50
    assert len(client.get("/api/customers", headers=auth("M01")).json()) == 100  # 北區兩位業務
    # 康泰南京店（C002）是王冠宇的：林昱辰打開就當作不存在，北區主管看得到，中區主管看不到
    assert client.get("/api/customers/C002/profile", headers=auth("U01")).status_code == 404
    assert client.get("/api/customers/C002/profile", headers=auth("U02")).status_code == 200
    assert client.get("/api/customers/C002/profile", headers=auth("M01")).status_code == 200
    assert client.get("/api/customers/C002/negotiation", headers=auth("M02")).status_code == 404


def test_recording_a_visit_for_someone_elses_customer_is_refused(client, auth):
    response = client.post(
        "/api/visits/audio", data={"customer_id": "C002"},
        files={"file": ("visit.webm", b"fake-audio", "audio/webm")}, headers=auth("U01"),
    )
    assert response.status_code == 404


def test_sales_figures_stop_at_the_region(engine):
    sql = "SELECT count(DISTINCT customer_id) FROM v_customer_summary"
    assert run_readonly(engine, sql).rows == [[250]]
    # U01 在 REGION 層級看得到整個北區，不只自己的 50 家
    assert run_readonly(engine, sql, Scope(path="TW.N.M01.U01")).rows == [[100]]
    assert run_readonly(engine, sql, Scope(path="TW.N.M01")).rows == [[100]]
    assert run_readonly(engine, sql, Scope(path="TW.C.M02.U03")).rows == [[50]]
    for view in ("v_monthly_sales", "v_margin_breakdown"):
        rows = run_readonly(engine, f"SELECT count(DISTINCT customer_id) FROM {view}", Scope(path="TW.N.M01.U01")).rows
        assert rows[0][0] <= 100


def test_visit_records_stop_at_the_team(engine):
    sql = "SELECT count(DISTINCT rep_id) FROM v_visit_signal"
    # 同一個團隊（U01 與 U02）看得到彼此的拜訪，看不到別區的
    assert run_readonly(engine, sql, Scope(path="TW.N.M01.U01")).rows == [[2]]
    assert run_readonly(engine, sql, Scope(path="TW.C.M02.U03")).rows == [[1]]


def test_the_model_cannot_lift_the_filter(engine):
    scope = Scope(path="TW.N.M01.U01")
    with pytest.raises(QueryRejected):
        run_readonly(engine, "SELECT set_config('app.scope_path', '', true)", scope)
    # 文字檢查擋不住 Unicode 跳脫的函式名稱，要靠資料庫收回的權限擋下
    sneaky = """WITH x AS (SELECT U&"set\\005fconfig"('app.scope_path', '', true))
                SELECT (SELECT count(*) FROM x), count(DISTINCT customer_id) FROM v_customer_summary"""
    with pytest.raises(Exception, match="permission denied"):
        run_readonly(engine, sneaky, scope)


def test_customers_named_in_an_answer_are_limited_to_the_asker(engine):
    record = AskRecord(
        id="scope-test", user_id="U01", kind="data", question="北區保健品為什麼下滑",
        answer="衰退集中在康泰忠孝店與康泰連鎖藥局 · 南京店，其次是福安板橋店。", status="answered",
    )
    with Session(engine) as session:
        u01, u02 = session.get(AppUser, "U01"), session.get(AppUser, "U02")
        # 南京店是王冠宇的，林昱辰的答案裡提到也不能排進他的路線
        assert [c.name for c in mentioned_customers(session, record, u01)] == ["康泰連鎖藥局 · 忠孝店", "福安連鎖藥局 · 板橋店"]
        assert [c.name for c in mentioned_customers(session, record, u02)] == ["康泰連鎖藥局 · 南京店"]
        record.kind = "knowledge"
        assert mentioned_customers(session, record, u01) == []


def test_the_org_tree_is_stored_as_ltree_paths(engine):
    from sqlalchemy import text as sql_text

    with engine.connect() as conn:
        assert conn.execute(sql_text("SELECT 1 FROM pg_extension WHERE extname = 'ltree'")).scalar() == 1
        kind = conn.execute(sql_text("""
            SELECT format_type(a.atttypid, a.atttypmod)
            FROM pg_attribute a
            WHERE a.attrelid = 'app_user'::regclass AND a.attname = 'org_path'
        """)).scalar()
        assert kind == "ltree"


def test_a_shallower_path_covers_everyone_below_it():
    from app.services.scope import REGION, SELF, TEAM, Scope

    sales = Scope(path="TW.N.M01.U01")
    assert sales.can_see(SELF, "TW.N.M01.U01") is True
    assert sales.can_see(SELF, "TW.N.M01.U02") is False
    assert sales.can_see(TEAM, "TW.N.M01.U02") is True
    assert sales.can_see(TEAM, "TW.C.M02.U03") is False
    assert sales.can_see(REGION, "TW.N.M01") is True

    # 主管的路徑截不到 SELF 的深度，所以在 SELF 層級就已經涵蓋屬下
    manager = Scope(path="TW.N.M01")
    assert manager.prefix(SELF) == "TW.N.M01"
    assert manager.can_see(SELF, "TW.N.M01.U01") is True
    assert manager.can_see(SELF, "TW.C.M02.U03") is False

    # everything()：評測與背景排程用，不過濾
    assert Scope.everything().can_see(SELF, "TW.C.M02.U03") is True


def test_org_paths_are_rebuilt_from_the_reporting_line(engine):
    with Session(engine) as session:
        paths = {u.id: u.org_path for u in session.scalars(select(AppUser)).all()}
    assert paths == {
        "U01": "TW.N.M01.U01",
        "U02": "TW.N.M01.U02",
        "U03": "TW.C.M02.U03",
        "U04": "TW.S.M03.U04",
        "U05": "TW.S.M03.U05",
        "M01": "TW.N.M01",
        "M02": "TW.C.M02",
        "M03": "TW.S.M03",
    }
