"""第一週出場條件：資料表建好、假資料可查、四個語意層 View 查得出數字、欄位定義確定。"""

import hashlib
import json
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

import generate
import psycopg
import pytest
import seed
from jsonschema import Draft202012Validator
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from app import models
from app.db import schema_version

ROOT = Path(__file__).resolve().parents[2]
AS_OF = seed.DEFAULT_AS_OF
VIEWS = [
    "v_monthly_sales", "v_customer_summary", "v_visit_signal", "v_margin_breakdown",
    "v_promotion", "v_promotion_item",
]
SCHEMA = json.loads((ROOT / "backend/app/schemas/visit_fields.schema.json").read_text(encoding="utf-8"))


def rows(conn, sql, **params):
    return conn.execute(text(sql), params).all()


def test_generation_is_deterministic():
    first, second = generate.generate(AS_OF), generate.generate(AS_OF)
    # 密碼雜湊每次的 salt 不同，本來就不會一樣；其餘每一筆都要相同
    for data in (first, second):
        for user in data["app_user"]:
            user.pop("password_hash")
    assert first == second


def test_scale_matches_plan(db):
    assert rows(db, "SELECT count(*) FROM customer")[0][0] == 250
    # 40 個虛構品項，加上促銷方案照搬的 20 個真實品項
    assert rows(db, "SELECT count(*) FROM product")[0][0] == 60
    by_type = dict(rows(db, "SELECT type, count(*) FROM customer GROUP BY type"))
    assert by_type == {"chain": 76, "independent": 112, "clinic": 62}
    first, last, months = rows(db, """
        SELECT min(date), max(date), count(DISTINCT date_trunc('month', date)) FROM sales_transaction
    """)[0]
    assert first >= AS_OF - timedelta(days=365) and last < AS_OF
    assert months >= 12


def test_each_rep_visits_three_to_five_customers_every_weekday(db):
    # 一位業務負責 50 家，一天跑 3～5 家、只跑平日；記錄的這一年裡每個平日都有出門
    reps = ["U01", "U02", "U03", "U04", "U05"]
    assert dict(rows(db, "SELECT owner_user_id, count(*) FROM customer GROUP BY 1")) == dict.fromkeys(reps, 50)
    per_day = rows(db, """
        SELECT user_id, (visited_at AT TIME ZONE 'Asia/Taipei')::date, count(*) FROM visit GROUP BY 1, 2
    """)
    assert all(3 <= n <= 5 and day.weekday() < 5 for _, day, n in per_day)
    first = AS_OF - timedelta(days=generate.HISTORY_DAYS - 1)
    weekdays = sum((first + timedelta(days=i)).weekday() < 5 for i in range(generate.HISTORY_DAYS - 1))
    assert Counter(rep for rep, _, _ in per_day) == dict.fromkeys(reps, weekdays)


def test_app_today_is_pinned_to_as_of(db):
    assert rows(db, "SELECT app_today()")[0][0] == AS_OF


def test_seed_records_schema_version_for_the_deploy_check(db):
    assert rows(db, "SELECT value FROM app_setting WHERE key = 'schema_version'")[0][0] == schema_version()


def test_schema_version_matches_the_deploy_workflow_algorithm():
    # CI 在 runner 上用 cat 把這幾個檔案接起來再 sha256sum 算指紋，檔案順序與清單兩邊要一模一樣
    files = [
        "backend/app/models.py",
        "backend/app/sql/semantic_layer.sql",
        "backend/app/services/org.py",
        "data/seed/generate.py",
        "data/seed/catalog.py",
    ]
    workflow = (ROOT / ".github" / "workflows" / "ci-cd.yml").read_text(encoding="utf-8")
    assert f"cat {' '.join(files)} | sha256sum" in workflow
    joined = b"".join((ROOT / f).read_bytes() for f in files)
    assert schema_version() == hashlib.sha256(joined).hexdigest()[:12]


def test_every_view_returns_numbers(db):
    # 要取出全部欄位：count(*) 會讓規劃器跳過沒用到的欄位，欄位運算出錯也測不出來
    for view in VIEWS:
        assert rows(db, f"SELECT * FROM {view}"), view
    assert rows(db, "SELECT sum(amount) FROM v_monthly_sales")[0][0] > 0
    assert rows(db, "SELECT count(*) FROM v_customer_summary WHERE interval_last_90d IS NULL")[0][0] == 0
    net, revenue = rows(db, "SELECT sum(net_margin), sum(revenue) FROM v_margin_breakdown")[0]
    assert 0 < net < revenue


def test_semantic_reader_sees_views_but_not_tables(db):
    db.exec_driver_sql("SET LOCAL ROLE semantic_reader")
    for view in VIEWS:
        db.exec_driver_sql(f"SELECT count(*) FROM {view}")
    with pytest.raises(ProgrammingError) as exc:
        db.exec_driver_sql("SELECT 1 FROM sales_transaction LIMIT 1")
    assert isinstance(exc.value.orig, psycopg.errors.InsufficientPrivilege)


def test_new_visit_draft_gets_defaults_from_database(engine):
    with Session(engine) as session:
        last = session.scalar(text("SELECT max(id) FROM visit"))
        visit = models.Visit(customer_id="C001", user_id="U01", visited_at=datetime.now(generate.TAIPEI))
        session.add(visit)
        session.flush()
        # 序號要接在假資料最後一筆之後才不會撞號，編號格式也跟假資料一樣
        assert len(visit.id) == 6 and visit.id.startswith("V") and visit.id > last
        assert visit.status == "draft" and visit.transcript == ""
        session.rollback()


def test_exactly_the_five_designed_customers_have_longer_intervals_at_flat_order_size(db):
    # 1.4 取自原型「進貨間隔拉長 4 成」；±15% 算持平
    found = {r[0] for r in rows(db, """
        SELECT customer_name FROM v_customer_summary
        WHERE interval_last_90d >= 1.4 * interval_before
          AND abs(avg_order_amount_last_90d / avg_order_amount_before - 1) <= 0.15
    """)}
    assert found == set(generate.SCENARIO_CUSTOMERS)


def test_north_supplement_decline_is_led_by_fish_oil_in_the_three_chains(db):
    # 北區保健品近 90 天比前 90 天少，縮最多的品項是魚油，魚油縮最多的就是刻意設計的三家；
    # 按保健品掉的金額排，前兩名也是其中兩家，數字題 D01 才答得出來。忠孝店前後兩段剛好都進
    # 三次貨、總金額只掉兩萬，排不進前面，所以三家一起比的是魚油
    window = """
        SELECT c.name, t.sku,
               sum(t.amount) FILTER (WHERE t.date > app_today() - 90) AS recent,
               sum(t.amount) FILTER (WHERE t.date <= app_today() - 90 AND t.date > app_today() - 180) AS prior
        FROM sales_transaction t
        JOIN customer c ON c.id = t.customer_id
        JOIN product p ON p.sku = t.sku
        WHERE c.region = '北區' AND p.category = '保健品'
        GROUP BY c.name, t.sku
    """
    recent, prior = rows(db, f"SELECT sum(recent), sum(prior) FROM ({window}) w")[0]
    assert recent < prior
    assert rows(db, f"SELECT sku FROM ({window}) w GROUP BY sku ORDER BY sum(prior) - sum(recent) DESC LIMIT 1")[0][0] == "HS-FO30"
    top2 = {r[0] for r in rows(db, f"""
        SELECT name FROM ({window}) w GROUP BY name ORDER BY sum(prior) - sum(recent) DESC NULLS LAST LIMIT 2
    """)}
    assert top2 < generate.NORTH_DECLINE
    top3 = {r[0] for r in rows(db, f"""
        SELECT name FROM ({window}) w WHERE sku = 'HS-FO30'
        ORDER BY coalesce(prior, 0) - coalesce(recent, 0) DESC LIMIT 3
    """)}
    assert top3 == generate.NORTH_DECLINE
    worst_sku = rows(db, f"""
        SELECT sku FROM ({window}) w WHERE name = ANY(:names) GROUP BY sku
        ORDER BY sum(recent) / sum(prior) LIMIT 1
    """, names=list(generate.NORTH_DECLINE))[0][0]
    assert worst_sku == "HS-FO30"


def test_two_of_the_three_recently_mention_yusongtian(db):
    mentioned = {r[0] for r in rows(db, """
        SELECT DISTINCT customer_name FROM v_visit_signal
        WHERE competitor_names LIKE :pattern AND visit_date > app_today() - 90
          AND customer_name = ANY(:names)
    """, pattern="%御松田%", names=list(generate.NORTH_DECLINE))}
    assert mentioned == {"康泰連鎖藥局 · 忠孝店", "福安連鎖藥局 · 板橋店"}


def test_visit_fields_follow_schema_and_quote_the_transcript(db):
    validator = Draft202012Validator(SCHEMA, format_checker=Draft202012Validator.FORMAT_CHECKER)
    for visit_id, transcript, fields, sources in rows(db, "SELECT id, transcript, fields_final, field_sources FROM visit"):
        errors = [e.message for e in validator.iter_errors(fields)]
        assert not errors, (visit_id, errors)
        assert set(sources) == {k for k, v in fields.items() if v is not None}, visit_id
        for key, quote in sources.items():
            assert quote in transcript, (visit_id, key)


def test_every_synced_visit_landed_in_all_three_targets(db):
    assert rows(db, """
        SELECT count(*) FROM visit v
        WHERE NOT EXISTS (SELECT 1 FROM crm_visit_record r WHERE r.visit_id = v.id)
           OR NOT EXISTS (SELECT 1 FROM oa_expense_form o WHERE o.visit_id = v.id)
    """)[0][0] == 0
    intent_lines = rows(db, """
        SELECT coalesce(sum(jsonb_array_length(fields_final->'intent')), 0) FROM visit
        WHERE jsonb_typeof(fields_final->'intent') = 'array'
    """)[0][0]
    assert rows(db, "SELECT count(*) FROM sap_quotation_draft")[0][0] == intent_lines
    skipped = rows(db, "SELECT count(*) FROM writeback_log WHERE target = 'sap' AND status = 'skipped'")[0][0]
    no_intent = rows(db, "SELECT count(*) FROM visit WHERE fields_final->'intent' = 'null'::jsonb")[0][0]
    assert skipped == no_intent > 0


def test_promotions_run_monthly_up_to_the_as_of_month(db):
    # 202608 是照搬的那一期，之後每月模擬一期，決賽日那一期是進行中
    assert rows(db, "SELECT promotion_name, start_date, end_date, status FROM v_promotion ORDER BY start_date") == [
        ("202608保藥特搭活動", datetime(2026, 8, 1).date(), datetime(2026, 8, 31).date(), "已結束"),
        ("202609保藥特搭活動", datetime(2026, 9, 1).date(), datetime(2026, 9, 30).date(), "已結束"),
        ("202610保藥特搭活動", datetime(2026, 10, 1).date(), datetime(2026, 10, 31).date(), "進行中"),
    ]
    assert dict(rows(db, "SELECT promotion_name, count(*) FROM v_promotion_item GROUP BY 1")) == {
        "202608保藥特搭活動": 37, "202609保藥特搭活動": 37, "202610保藥特搭活動": 37,
    }


def test_promotion_prices_match_the_cyh_page(db):
    # 每 PCS 平均單價是 CYH 頁面上的數字：一口買幾送幾讀錯，這裡就對不上
    found = dict(rows(db, """
        SELECT item_code, unit_deal_price FROM v_promotion_item
        WHERE promotion_name = '202608保藥特搭活動'
          AND item_code IN ('PP-027919', 'PP-027930', 'PP-027918', 'PP-027929', 'PP-027954')
    """))
    assert {code: float(price) for code, price in found.items()} == {
        "PP-027919": 962.50,  # 骨營膠囊小口 <11+1>
        "PP-027930": 91.67,   # 金舒胃得小口 <10+1>+1，共送 2
        "PP-027918": 442.86,  # 骨營粉劑直走 7 盒
        "PP-027929": 117.19,  # 雄讚大口 <100+28>
        "PP-027954": 500.00,  # 蔓越莓 1+1
    }


def test_expired_pm_rules_drop_out_of_later_promotions(db):
    notes = dict(rows(db, "SELECT promotion_name, pm_note FROM v_promotion"))
    # 骨營粉劑實銷做到 8 月、黴癒滿額贈做到 9 月，沒寫期限的兩段每期都在
    assert "骨營粉劑實銷活動" in notes["202608保藥特搭活動"]
    assert "骨營粉劑實銷活動" not in notes["202609保藥特搭活動"]
    assert "黴癒8-9月品牌滿額贈" in notes["202609保藥特搭活動"]
    assert "黴癒8-9月品牌滿額贈" not in notes["202610保藥特搭活動"]
    assert all("骨營滿額贈" in n and "中化健康360保健品" in n for n in notes.values())
    deals = dict(rows(db, """
        SELECT promotion_name, deal FROM v_promotion_item WHERE item_name = 'LISIM CREAM乳膏'
    """))
    assert deals["202609保藥特搭活動"] == "<42+8>, 黴癒滿額贈活動"
    assert deals["202610保藥特搭活動"] == "<42+8>"


def test_promotion_products_have_no_sales_history(db):
    # 真實品項只進品項表，常進品項照舊從虛構的 40 個抽，交易與評測答案不受影響
    assert rows(db, """
        SELECT count(*) FROM sales_transaction t
        WHERE t.sku IN (SELECT sku FROM promotion_item)
    """)[0][0] == 0
