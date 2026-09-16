"""資料權限：業務只看得到自己負責的客戶，主管只看得到自己轄區（原型登入頁與問答頁的說明）。"""

import datetime as dt

import pytest
from fastapi.testclient import TestClient
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


def test_data_queries_only_see_the_askers_customers(engine):
    sql = "SELECT count(DISTINCT customer_id) FROM v_customer_summary"
    assert run_readonly(engine, sql).rows == [[250]]
    assert run_readonly(engine, sql, Scope(owner_id="U01")).rows == [[50]]
    assert run_readonly(engine, sql, Scope(region="北區")).rows == [[100]]
    # 四個 View 都有過濾
    for view in ("v_monthly_sales", "v_visit_signal", "v_margin_breakdown"):
        owners = run_readonly(engine, f"SELECT count(DISTINCT customer_id) FROM {view}", Scope(owner_id="U01")).rows
        assert owners[0][0] <= 50


def test_the_model_cannot_lift_the_filter(engine):
    scope = Scope(owner_id="U01")
    with pytest.raises(QueryRejected):
        run_readonly(engine, "SELECT set_config('app.scope_owner', '', true)", scope)
    # 文字檢查擋不住 Unicode 跳脫的函式名稱，要靠資料庫收回的權限擋下
    sneaky = """WITH x AS (SELECT U&"set\\005fconfig"('app.scope_owner', '', true))
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
