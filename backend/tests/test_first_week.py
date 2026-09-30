"""新人第一週（backend/app/services/first_week.py、api/first_week.py）。

「你是誰、賣什麼」來自模擬 SAP 的人員主檔，其他數字現查；每天做什麼寫在 resources/first_week.json。
到職第幾天、是不是新人都跟系統日（決賽日 2026-10-28）比，不跟真實時間比。

會新增帳號、改客戶或重建文件索引的測試都跑在 tx 裡，測完回滾。tx 裡才有的帳號別的連線看不到，
conftest 的 auth fixture 簽不出它的 token，所以直接拿帳號物件簽（headers_for）。
"""

import logging
import re
from datetime import date, timedelta
from pathlib import Path

import pytest
import seed
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.main import app
from app.models import AppUser, Customer, Product, SapEmployee
from app.services import auth as auth_service
from app.services import first_week
from app.services.documents import DOCUMENTS_DIR, index_documents

ROOT = Path(__file__).resolve().parents[2]
CATEGORIES = {"保健品", "慢性處方", "一般用藥", "醫材"}


@pytest.fixture
def client(engine):
    return TestClient(app)


def headers_for(user: AppUser) -> dict[str, str]:
    return {"Authorization": f"Bearer {auth_service.create_token(user)}"}


def self_created(tx) -> AppUser:
    """自建與第三方登入的帳號：不在組織樹上、沒有人員主檔，代理示範業務林昱辰。"""
    user = AppUser(id="XFIRSTWK", name="評審", role="sales", region="北區", acts_as_user_id="U01")
    tx.add(user)
    tx.commit()
    return user


def region_ranking(db, region: str) -> dict[str, list[str]]:
    """這一區近 90 天每個類別進貨金額由高到低的料號。用客戶的區算，跟服務裡照組織樹取範圍的寫法互相對照。"""
    ranked: dict[str, list[str]] = {}
    for category, sku in db.execute(text("""
        SELECT p.category, t.sku FROM sales_transaction t
        JOIN customer c ON c.id = t.customer_id
        JOIN product p ON p.sku = t.sku
        WHERE c.region = :region AND t.date > app_today() - 90
        GROUP BY p.category, t.sku
        ORDER BY sum(t.amount) DESC, t.sku
    """), {"region": region}):
        ranked.setdefault(category, []).append(sku)
    return ranked


def test_a_long_serving_rep_is_not_a_newcomer_but_can_still_open_the_page(client, auth):
    # 林昱辰 2021-03-01 到職：到職日當天算第 1 天
    day_no = (seed.DEFAULT_AS_OF - date(2021, 3, 1)).days + 1
    assert client.get("/api/first-week/status", headers=auth("U01")).json() == {"is_newcomer": False, "day_no": day_no}

    page = client.get("/api/first-week", headers=auth("U01")).json()
    assert (page["is_newcomer"], page["day_no"]) == (False, day_no)
    # 哪一區、主管是誰來自組織樹；轄區縣市是名下客戶所在的縣市，客戶多的在前
    assert page["employee"] == {
        "employee_no": "E00342", "hire_date": "2021-03-01", "region": "北區", "manager_name": "陳建宏",
        "cities": ["台北市", "新北市"], "proxy_of": None,
    }
    assert page["customers"] == {
        "total": 50,
        "by_type": {"chain": 16, "independent": 22, "clinic": 12},
        "by_grade": {"A": 10, "B": 26, "C": 14},
    }
    assert page["promotion"] == {"name": "202610保藥特搭活動", "item_count": 37}
    assert [day["day"] for day in page["days"]] == [1, 2, 3, 4, 5]


def test_a_rep_it_just_created_is_on_day_one_and_has_no_customers_yet(tx, client, auth):
    account = {"name": "測試新人", "email": "rookie@meddemo.tw", "password": "abcd1234", "role": "sales", "manager_id": "M02"}
    assert client.post("/api/admin/users", json=account, headers=auth("A01")).status_code == 201
    rookie = headers_for(tx.get(AppUser, "U06"))

    assert client.get("/api/first-week/status", headers=rookie).json() == {"is_newcomer": True, "day_no": 1}
    page = client.get("/api/first-week", headers=rookie).json()
    assert (page["is_newcomer"], page["day_no"]) == (True, 1)
    assert page["employee"] == {
        "employee_no": tx.get(SapEmployee, "U06").employee_no, "hire_date": seed.DEFAULT_AS_OF.isoformat(),
        "region": "中區", "manager_name": "張淑芬", "cities": [], "proxy_of": None,
    }
    # 名下還沒有客戶（等主管分配）：客戶那兩區是空的，其餘照常
    assert page["customers"] == {
        "total": 0, "by_type": {"chain": 0, "independent": 0, "clinic": 0}, "by_grade": {"A": 0, "B": 0, "C": 0},
    }
    assert page["key_customers"] == []
    # 同一區的進貨排名不看自己名下有沒有客戶
    assert {line["category"] for line in page["product_lines"]} == CATEGORIES
    assert all(len(line["top"]) == 3 for line in page["product_lines"])


def test_newcomer_means_the_first_thirty_days(tx, client, auth):
    employee = tx.get(SapEmployee, "U02")

    def status_on_day(day_no: int) -> dict:
        employee.hire_date = seed.DEFAULT_AS_OF - timedelta(days=day_no - 1)
        tx.commit()
        return client.get("/api/first-week/status", headers=auth("U02")).json()

    assert first_week.NEWCOMER_DAYS == 30
    assert status_on_day(30) == {"is_newcomer": True, "day_no": 30}
    assert status_on_day(31) == {"is_newcomer": False, "day_no": 31}


def test_a_self_created_account_is_a_newcomer_looking_at_the_demo_rep(tx, client, auth):
    judge = headers_for(self_created(tx))
    # 沒有人員主檔：一律當新人，沒有到職日所以也沒有「第幾天」
    assert client.get("/api/first-week/status", headers=judge).json() == {"is_newcomer": True, "day_no": None}

    page = client.get("/api/first-week", headers=judge).json()
    assert (page["is_newcomer"], page["day_no"]) == (True, None)
    assert page["employee"] == {
        "employee_no": None, "hire_date": None, "region": "北區", "manager_name": "陳建宏",
        "cities": ["台北市", "新北市"], "proxy_of": "林昱辰",
    }
    # 客戶、產品線、先認識的五家都是林昱辰的
    demo = client.get("/api/first-week", headers=auth("U01")).json()
    assert page["customers"]["total"] == 50
    for key in ("customers", "product_lines", "key_customers"):
        assert page[key] == demo[key]


def test_managers_and_it_have_no_first_week(client, auth):
    assert client.get("/api/first-week").status_code == 401
    assert client.get("/api/first-week/status").status_code == 401
    for user_id in ("M01", "A01"):
        # 首頁問 status 時不必先分角色：主管與 IT 一律不是新人
        assert client.get("/api/first-week/status", headers=auth(user_id)).json() == {"is_newcomer": False, "day_no": None}
        assert client.get("/api/first-week", headers=auth(user_id)).status_code == 403


def test_product_lines_list_the_regions_best_sellers_of_that_category(client, auth, db):
    north = client.get("/api/first-week", headers=auth("U01")).json()["product_lines"]
    # 每條產品線一區，照人員主檔的順序
    assert [line["category"] for line in north] == ["保健品", "慢性處方", "一般用藥", "醫材"]
    counts = dict(db.execute(text("SELECT category, count(*) FROM product GROUP BY 1")).all())
    products = {p.sku: p for p in db.execute(select(Product.sku, Product.name, Product.category, Product.unit_price, Product.aliases))}
    ranking = region_ranking(db, "北區")
    for line in north:
        assert line["sku_count"] == counts[line["category"]]
        assert [item["sku"] for item in line["top"]] == ranking[line["category"]][:3]
        for item in line["top"]:
            product = products[item["sku"]]
            assert product.category == line["category"]
            assert item == {"sku": product.sku, "name": product.name, "unit_price": float(product.unit_price), "aliases": product.aliases}
    # 是整個轄區的排名（sales_figures 那一級），不是自己名下客戶的：同區的另一位業務看到的一樣
    assert client.get("/api/first-week", headers=auth("U02")).json()["product_lines"] == north
    # 別區看的是別區的排名
    central = client.get("/api/first-week", headers=auth("U03")).json()["product_lines"]
    assert {line["category"]: [item["sku"] for item in line["top"]] for line in central} == {
        category: skus[:3] for category, skus in region_ranking(db, "中區").items()
    }
    assert central != north


def test_product_lines_follow_the_employee_master(tx, client, auth):
    tx.get(SapEmployee, "U05").product_lines = ["醫材", "慢性處方"]
    tx.commit()
    lines = client.get("/api/first-week", headers=auth("U05")).json()["product_lines"]
    assert [line["category"] for line in lines] == ["醫材", "慢性處方"]


def test_the_customers_to_meet_first_are_the_reps_own_best_a_grade_accounts(tx, client, auth):
    own = {c.id: c for c in tx.scalars(select(Customer).where(Customer.owner_user_id == "U01"))}
    amounts = dict(tx.execute(text("SELECT customer_id, amount_last_90d FROM v_customer_summary")).all())

    def expected(grade: str) -> list[str]:
        ids = [cid for cid, c in own.items() if c.grade == grade]
        return sorted(ids, key=lambda cid: (-amounts[cid], cid))

    found = client.get("/api/first-week", headers=auth("U01")).json()["key_customers"]
    assert [c["id"] for c in found] == expected("A")[:5]
    for item in found:
        customer = own[item["id"]]
        # 金額跟客戶檔案的「近 3 月進貨」同一個數字
        assert item == {
            "id": customer.id, "name": customer.name, "type": customer.type, "grade": "A", "city": customer.city,
            "amount_last_90d": float(amounts[customer.id]),
        }

    # A 級不足五家時用 B 級補：A 級的排前面，各自照金額
    keep = expected("A")[:3]
    for cid in expected("A")[3:]:
        own[cid].grade = "C"
    tx.commit()
    found = client.get("/api/first-week", headers=auth("U01")).json()["key_customers"]
    assert [c["id"] for c in found] == keep + expected("B")[:2]
    assert [c["grade"] for c in found] == ["A", "A", "A", "B", "B"]


def test_no_running_promotion_means_no_promotion_line(tx, client, auth):
    tx.execute(text("UPDATE promotion SET end_date = app_today() - 1 WHERE id = 'PR-202610'"))
    tx.commit()
    assert client.get("/api/first-week", headers=auth("U01")).json()["promotion"] is None


def test_the_page_carries_the_plan_and_the_titles_of_the_required_documents(tx, client, auth):
    index_documents(tx)
    tx.commit()
    config = first_week.load_config()
    page = client.get("/api/first-week", headers=auth("U01")).json()
    assert [(day["day"], day["title"]) for day in page["days"]] == [(day["day"], day["title"]) for day in config["days"]]
    first = page["days"][0]["tasks"]
    assert first[0] == {"id": "d1-customers", "text": config["days"][0]["tasks"][0]["text"], "to": "/customers", "doc": None}
    assert (first[1]["to"], first[1]["doc"]) == (None, "09-拜訪紀錄.md")
    # 必讀文件附上標題，順序照設定檔
    assert [doc["source_name"] for doc in page["documents"]] == config["documents"]
    assert page["documents"][0] == {"source_name": "09-拜訪紀錄.md", "title": "拜訪紀錄填寫規範"}


def test_a_document_missing_from_the_index_is_left_out_and_logged(tx, client, auth, tmp_path, caplog):
    # 索引裡只有一份：其餘的必讀文件不列，那幾件事也不給連結（點了會是找不到），整頁照常
    (tmp_path / "09-拜訪紀錄.md").write_text((DOCUMENTS_DIR / "09-拜訪紀錄.md").read_text(encoding="utf-8"), encoding="utf-8")
    index_documents(tx, directory=tmp_path)
    tx.commit()
    with caplog.at_level(logging.WARNING, logger="app.services.first_week"):
        response = client.get("/api/first-week", headers=auth("U01"))
    assert response.status_code == 200
    assert [doc["source_name"] for doc in response.json()["documents"]] == ["09-拜訪紀錄.md"]
    tasks = {task["id"]: task for day in response.json()["days"] for task in day["tasks"]}
    assert tasks["d1-doc-visit"]["doc"] == "09-拜訪紀錄.md"
    assert (tasks["d2-doc-quote"]["doc"], tasks["d2-doc-quote"]["to"]) == (None, None)
    assert "04-報價權限.md" in caplog.text


def test_the_config_has_five_days_of_things_that_point_somewhere_real():
    config = first_week.load_config()
    assert [day["day"] for day in config["days"]] == [1, 2, 3, 4, 5]
    assert all(day["title"] and len(day["tasks"]) >= 2 for day in config["days"])
    tasks = [task for day in config["days"] for task in day["tasks"]]
    # 勾選進度用 id 記在手機裡：重複的話勾一件等於勾兩件
    assert len({task["id"] for task in tasks}) == len(tasks)
    # 每件事連到一個地方：App 裡的頁面或一份內部文件，擇一
    assert all(task["text"] and ("to" in task) != ("doc" in task) for task in tasks)
    documents = {path.name for path in DOCUMENTS_DIR.glob("*.md")}
    assert {task["doc"] for task in tasks if "doc" in task} <= documents
    assert config["documents"] and set(config["documents"]) <= documents
    assert len(set(config["documents"])) == len(config["documents"])
    # App 裡的路徑要是真的路由。/methods 由方法卡那一項提供，四項合併之後才在 App.tsx 裡
    routes = set(re.findall(r'<Route\s+path="([^"]+)"', (ROOT / "frontend/src/App.tsx").read_text(encoding="utf-8")))
    assert {task["to"] for task in tasks if "to" in task} <= routes | {"/methods"}
