"""資料權限：組織是一棵樹，每個人的位置決定他看得到什麼（backend/app/services/scope.py）。

可見範圍 = 把自己的路徑截到該種資料的共享層級，再看對方在不在底下；主管的路徑比較短、
截不動，所以「主管看得到、動得了屬下的」是同一個式子的結果，不是另一條規則。
每一種資料停在哪一級寫在 SHARING_LEVEL：客戶清單全公司、業績數字同區、拜訪紀錄同團隊、
客戶檔案與報價只有負責人（和他的主管）。

同一條規則有兩個執法點，這裡兩邊都測：API 走 ORM，模型寫的 SQL 走四個語意層 View。
"""

import datetime as dt
import re

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.asks import mentioned_customers
from app.db import SEMANTIC_LAYER
from app.main import app
from app.models import AppUser, AskRecord, Visit
from app.services.scope import SHARING_LEVEL, Scope
from app.services.sql_executor import QueryRejected, run_readonly


@pytest.fixture
def client(engine):
    return TestClient(app)


def test_everyone_sees_every_customer_but_only_acts_on_their_own(client, auth):
    assert client.get("/api/customers").status_code == 401
    # 客戶清單是全國共享的：名稱、類型、區、等級、負責人
    assert len(client.get("/api/customers", headers=auth("U01")).json()) == 250
    assert len(client.get("/api/customers", headers=auth("M01")).json()) == 250
    assert client.get("/api/customers/C002", headers=auth("U03")).status_code == 200

    # 但檔案、議價卡、報價還是只有負責人與他的主管看得到。C002 是王冠宇（U02）的
    assert client.get("/api/customers/C002/profile", headers=auth("U01")).status_code == 404
    assert client.get("/api/customers/C002/profile", headers=auth("U02")).status_code == 200
    assert client.get("/api/customers/C002/profile", headers=auth("M01")).status_code == 200
    assert client.get("/api/customers/C002/negotiation", headers=auth("M02")).status_code == 404
    assert client.get("/api/customers/C002/quote-items", headers=auth("U01")).status_code == 404


def test_the_customer_list_hides_visit_dates_from_outside_the_team(client, auth):
    """客戶清單是全公司的，但「上次拜訪」是拜訪資料算出來的，拜訪資料只到團隊層級。

    規格寫的全公司欄位只有名稱、類型、區、縣市、等級、負責人，上次拜訪不在裡面；
    別區的客戶照樣列出來，只是這一欄是空的。
    """
    def listed(user_id):
        return {c["id"]: c for c in client.get("/api/customers", headers=auth(user_id)).json()}

    north = listed("U01")
    assert len(north) == 250  # 清單本身沒有縮水
    assert north["C001"]["last_visit_date"] is not None  # 自己的客戶
    assert north["C002"]["last_visit_date"] is not None  # 同團隊 U02 的客戶
    assert north["C017"]["last_visit_date"] is None      # 南區 U04 的客戶
    assert north["C017"]["owner_name"] and north["C017"]["region"] == "南區"  # 其他欄位照給

    # C017 確實有拜訪紀錄，上一行的 None 是擋下來的，不是本來就沒有
    assert listed("U04")["C017"]["last_visit_date"] is not None
    # 主管的路徑比較短，看得到屬下的。M01 是 U01 與 U02 的主管
    assert listed("M01")["C002"]["last_visit_date"] is not None
    assert listed("M01")["C017"]["last_visit_date"] is None


def test_recording_a_visit_for_someone_elses_customer_is_refused(client, auth):
    response = client.post(
        "/api/visits/audio", data={"customer_id": "C002"},
        files={"file": ("visit.webm", b"fake-audio", "audio/webm")}, headers=auth("U01"),
    )
    assert response.status_code == 404


def test_teammates_can_read_a_visit_but_only_the_owner_can_change_it(client, auth, engine):
    with Session(engine) as session:
        visit = session.scalars(
            select(Visit).where(Visit.user_id == "U02", Visit.status.in_(("confirmed", "synced")))
        ).first()
        visit_id = visit.id

    # U01 與 U02 同一個團隊（都在 M01 底下）
    assert client.get(f"/api/visits/{visit_id}", headers=auth("U01")).status_code == 200
    assert client.get(f"/api/visits/{visit_id}", headers=auth("M01")).status_code == 200
    # U03 在中區，看不到
    assert client.get(f"/api/visits/{visit_id}", headers=auth("U03")).status_code == 404
    # 看得到不等於能改：同團隊的拜訪唯讀
    assert client.delete(f"/api/visits/{visit_id}", headers=auth("U01")).status_code == 404


def test_every_mutating_visit_endpoint_stays_with_the_owner_not_just_delete(client, auth, engine):
    """六支寫入端點都要在 _load 加 write=True；只測 DELETE 會漏掉另外五支忘記加的情形。"""
    with Session(engine) as session:
        visit = session.scalars(
            select(Visit).where(Visit.user_id == "U02", Visit.status.in_(("confirmed", "synced")))
        ).first()
        visit_id = visit.id

    assert client.put(f"/api/visits/{visit_id}/fields", json={"fields": {}}, headers=auth("U01")).status_code == 404
    assert client.post(f"/api/visits/{visit_id}/confirm", headers=auth("U01")).status_code == 404
    assert client.post(f"/api/visits/{visit_id}/reprocess", headers=auth("U01")).status_code == 404
    assert client.post(f"/api/visits/{visit_id}/transcript", json={"text": "x"}, headers=auth("U01")).status_code == 404
    assert client.post(f"/api/visits/{visit_id}/writeback/crm/retry", headers=auth("U01")).status_code == 404


def test_a_manager_can_act_on_his_reports_visit_even_though_a_teammate_cannot(client, auth, engine):
    """SELF 一律涵蓋主管（主管的路徑比較短、截不掉），拜訪不做例外——這是選擇，不是漏網。

    看回應碼：M01 拿到的 409 是端點自己的狀態檢查（已確認的紀錄不能再改欄位），代表權限這一關
    已經過了；同一支端點對別區的 U03 是 404，對同團隊的 U01 也是 404。這個 409 不是巧合，
    它就是「主管過得了權限」的訊號，改成 404 就是把這個決定悄悄改掉了。
    """
    with Session(engine) as session:
        visit_id = session.scalars(
            select(Visit).where(Visit.user_id == "U02", Visit.status.in_(("confirmed", "synced")))
        ).first().id

    assert client.put(f"/api/visits/{visit_id}/fields", json={"fields": {}}, headers=auth("M01")).status_code == 409
    assert client.put(f"/api/visits/{visit_id}/fields", json={"fields": {}}, headers=auth("U01")).status_code == 404
    assert client.put(f"/api/visits/{visit_id}/fields", json={"fields": {}}, headers=auth("U03")).status_code == 404


def test_quoting_for_someone_elses_customer_is_refused(client, auth):
    body = {"items": [{"sku": "RX-TAM02", "qty": 10}]}
    assert client.post("/api/customers/C002/quotes", json=body, headers=auth("U01")).status_code == 404


def test_sales_figures_stop_at_the_region(engine):
    sql = "SELECT count(DISTINCT customer_id) FROM v_customer_summary"
    assert run_readonly(engine, sql).rows == [[250]]
    # U01 在 REGION 層級看得到整個北區，不只自己的 50 家
    assert run_readonly(engine, sql, Scope(path="TW.N.M01.U01")).rows == [[100]]
    assert run_readonly(engine, sql, Scope(path="TW.N.M01")).rows == [[100]]
    assert run_readonly(engine, sql, Scope(path="TW.C.M02.U03")).rows == [[50]]
    for view in ("v_monthly_sales", "v_margin_breakdown"):
        # 北區 100 家全部都有交易，所以是剛好 100；寫 <= 100 的話少過濾到一區以外的幾家也測不出來
        rows = run_readonly(engine, f"SELECT count(DISTINCT customer_id) FROM {view}", Scope(path="TW.N.M01.U01")).rows
        assert rows[0][0] == 100


def test_the_sql_views_declare_the_same_depths_as_python():
    """同一條規則有兩個執法點：ORM（API）與語意層的四個 View（模型寫的 SQL）。

    View 的深度是寫死在 semantic_layer.sql 裡的整數，沒辦法引用 Python 的 SHARING_LEVEL，
    兩邊各改各的也不會有人報錯——這個測試是唯一會發現「只改了一邊」的機制，所以它直接
    從 SQL 檔把深度讀出來，跟 SHARING_LEVEL 比對，而不是各自抄一份常數。
    """
    sql = SEMANTIC_LAYER.read_text(encoding="utf-8")
    # 依 CREATE VIEW 切段，再抓每一段裡的 app_in_scope(<別名>.org_path, <深度>)。
    # app_in_scope 的函式定義與 GRANT 在第一個 View 之前、參數也不是 <別名>.org_path，不會被抓進來
    blocks = re.split(r"CREATE VIEW (\w+) AS", sql)[1:]
    declared = {
        name: [int(depth) for depth in re.findall(r"app_in_scope\(\s*\w+\.org_path\s*,\s*(\d+)\s*\)", body)]
        for name, body in zip(blocks[::2], blocks[1::2], strict=True)
    }
    # 每個 View 一個過濾條件。少了哪個 View、多了新的 View、或深度跟 Python 對不上，都在這裡爆
    assert declared == {
        "v_monthly_sales": [SHARING_LEVEL["sales_figures"]],
        "v_customer_summary": [SHARING_LEVEL["sales_figures"]],
        "v_visit_signal": [SHARING_LEVEL["visit_record"]],
        "v_margin_breakdown": [SHARING_LEVEL["sales_figures"]],
        # 促銷方案不分客戶，全公司共用
        "v_promotion": [],
        "v_promotion_item": [],
    }


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


def test_a_scope_with_no_path_denies_everyone_instead_of_allowing_everyone():
    """org_path 是 nullable 欄位（models.py）。for_user() 解出 None 時絕對不能跟 everything() 撞在一起，
    否則沒有路徑的使用者會變成看得到全公司——比對舊機制（owner_id 一定有值）還危險。"""
    from app.services.scope import SELF, Scope

    lost = Scope(path=None)
    assert lost.unfiltered is False
    assert lost != Scope.everything()
    assert lost.can_see(SELF, "TW.N.M01.U01") is False
    assert lost.can_see(SELF, None) is False


def test_a_scope_with_no_path_sees_no_customers_through_the_orm(engine):
    from sqlalchemy import select
    from sqlalchemy.orm import Session as OrmSession

    from app.models import Customer
    from app.services.scope import SELF, Scope

    lost = Scope(path=None)
    with OrmSession(engine) as session:
        rows = session.execute(select(Customer.id).where(lost.customers_at(SELF))).all()
    assert rows == []


def test_a_scope_with_no_path_sees_no_rows_in_the_semantic_layer(engine):
    from app.services.scope import Scope

    lost = Scope(path=None)
    sql = "SELECT count(DISTINCT customer_id) FROM v_customer_summary"
    assert run_readonly(engine, sql, lost).rows == [[0]]


def test_a_fifth_level_in_the_org_tree_is_refused_instead_of_leaking_upward():
    """深度就是共享層級，所以葉節點一定要剛好在第四層（SELF）。

    業務底下再掛一個人的話，他的路徑截到 SELF 剛好等於業務本人的路徑，於是看得到業務的
    報價、議價卡與客戶檔案——權限往上漏，而且四個 View 與 ORM 兩邊都會這樣。
    這種樹寧可在灌資料時就炸掉，錯誤訊息要指出是誰。
    """
    from app.services.org import paths_from_reports

    units = {"TW": "root", "TW.N": "region"}
    flat = {"M01": ("manager", None, "TW.N"), "U01": ("sales", "M01", None)}
    assert paths_from_reports(units, flat) == {"M01": "TW.N.M01", "U01": "TW.N.M01.U01"}

    with pytest.raises(ValueError, match="S01"):
        paths_from_reports(units, flat | {"S01": ("sales", "U01", None)})


def test_a_level_shallower_than_root_is_a_bug_not_a_wildcard():
    """level=0 在 Python 這邊截成空字串、誰都看不到，SQL 那邊 subpath(p, 0, 0) 卻是空 ltree、
    @> 對誰都成立、變成全部看得到。兩邊不一致而且是往放寬的方向，所以在 Python 直接拒收。"""
    from app.services.scope import ROOT, Scope

    sales = Scope(path="TW.N.M01.U01")
    assert sales.prefix(ROOT) == "TW"
    with pytest.raises(ValueError):
        sales.prefix(0)
    with pytest.raises(ValueError):
        sales.can_see(-1, "TW.C.M02.U03")
    # 不過濾的 scope 也一樣要炸：level 算錯是呼叫端的 bug，不是「剛好沒差」
    with pytest.raises(ValueError):
        Scope.everything().prefix(0)


def test_org_paths_are_rebuilt_from_the_reporting_line(engine):
    with Session(engine) as session:
        paths = {u.id: u.org_path for u in session.scalars(select(AppUser)).all()}
    assert paths == {
        "U01": "TW.N.M01.U01",
        "U02": "TW.N.M01.U02",
        "U03": "TW.C.M02.U03",
        "U04": "TW.S.M03.U04",
        # 南區兩組：頻道的整區看板才看得到「各組」
        "U05": "TW.S.M04.U05",
        "M01": "TW.N.M01",
        "M02": "TW.C.M02",
        "M03": "TW.S.M03",
        "M04": "TW.S.M04",
        # IT 坐在根節點上，路徑就是根節點本身
        "A01": "TW",
    }
