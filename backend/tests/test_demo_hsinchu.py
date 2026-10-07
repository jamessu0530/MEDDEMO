"""示範資料的新竹市（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md〈示範資料〉）：
三家新竹的客戶算在林昱辰名下，他今天的建議一定有一站新竹，評審看得到熊熊滾從新北騎進新竹時換車。
新竹這一批另外產生，原本 250 家客戶與它們的交易、帳款、拜訪一筆都不變。"""

import catalog
import generate
import seed
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Customer
from app.services import itinerary as service

AS_OF = seed.DEFAULT_AS_OF


def without_password(data):
    # 密碼雜湊每次的 salt 不同，本來就不會一樣
    for user in data["app_user"]:
        user.pop("password_hash")
    return data


def test_three_hsinchu_customers_belong_to_the_demo_rep(engine):
    with Session(engine) as session:
        found = session.scalars(select(Customer).where(Customer.city == "新竹市").order_by(Customer.id)).all()
    # 接在原本 250 家之後編號，藥局與診所都有
    assert [c.id for c in found] == ["C251", "C252", "C253"]
    assert {c.owner_user_id for c in found} == {catalog.DEMO_USER_ID}
    assert {c.type for c in found} == {"independent", "clinic"}
    assert {(c.region, c.place_id) for c in found} == {("北區", "HSZ")}
    assert {c.area for c in found} == {"東區", "北區", "香山"}


def test_the_hsinchu_batch_leaves_every_other_row_alone(monkeypatch):
    with_hsinchu = without_password(generate.generate(AS_OF))
    monkeypatch.setattr(catalog, "HSINCHU_CUSTOMERS", [])
    before = without_password(generate.generate(AS_OF))
    added = {c["id"] for c in with_hsinchu["customer"] if c["city"] == "新竹市"}
    assert len(added) == 3 and not any(c["city"] == "新竹市" for c in before["customer"])
    visits = {v["id"]: v["customer_id"] for v in with_hsinchu["visit"]}

    def customer_of(table, row):
        if table == "customer":
            return row["id"]
        return row["customer_id"] if "customer_id" in row else visits.get(row.get("visit_id"))

    assert set(with_hsinchu) == set(before)
    for table, rows in before.items():
        # 原本的每一筆都在、內容與順序都一樣（客戶編號、交易、帳款、拜訪與單號都沒有往後挪），
        # 多出來的只接在最後面，而且都是新竹那三家的
        assert with_hsinchu[table][: len(rows)] == rows, table
        assert all(customer_of(table, row) in added for row in with_hsinchu[table][len(rows):]), table
    # 新竹那三家有自己的交易、帳款與拜訪紀錄
    for table in ("customer", "sales_transaction", "receivable", "visit", "crm_visit_record", "oa_expense_form"):
        assert len(with_hsinchu[table]) > len(before[table]), table


def test_the_demo_route_rides_from_new_taipei_into_hsinchu(tx):
    # 跟展示當天一樣：IT 重置示範業務今天的行程，首頁讀取時照模型的建議重新建一份（測試沒有 Google 金鑰，車程是直線估算）
    service.reset_today(tx, catalog.DEMO_USER_ID)
    view = service.view(tx, service.get_or_create(tx, catalog.DEMO_USER_ID))
    cities = [stop.city for stop in view.stops]
    # 「需立即處理」那家照舊鎖在第一站
    assert view.urgent and view.urgent["customer_name"] == "福安連鎖藥局 · 板橋店"
    assert view.stops[0].customer_id == view.urgent["customer_id"]
    # 有一站在新竹，前一站在新北：評審看得到從新北騎進新竹時半路換車
    assert "新竹市" in cities
    hsinchu = cities.index("新竹市")
    assert hsinchu > 0 and cities[hsinchu - 1] == "新北市"
    assert "台北市" in cities
