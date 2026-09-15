"""第一週出場條件：資料表建好、假資料可查、四個語意層 View 查得出數字、欄位定義確定。"""

import hashlib
import json
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
VIEWS = ["v_monthly_sales", "v_customer_summary", "v_visit_signal", "v_margin_breakdown"]
SCHEMA = json.loads((ROOT / "backend/app/schemas/visit_fields.schema.json").read_text(encoding="utf-8"))


def rows(conn, sql, **params):
    return conn.execute(text(sql), params).all()


def test_generation_is_deterministic():
    assert generate.generate(AS_OF) == generate.generate(AS_OF)


def test_scale_matches_plan(db):
    assert rows(db, "SELECT count(*) FROM customer")[0][0] == 80
    assert rows(db, "SELECT count(*) FROM product")[0][0] == 40
    assert rows(db, "SELECT count(*) FROM visit")[0][0] == 150
    by_type = dict(rows(db, "SELECT type, count(*) FROM customer GROUP BY type"))
    assert by_type == {"chain": 24, "independent": 36, "clinic": 20}
    first, last, months = rows(db, """
        SELECT min(date), max(date), count(DISTINCT date_trunc('month', date)) FROM sales_transaction
    """)[0]
    assert first >= AS_OF - timedelta(days=365) and last < AS_OF
    assert months >= 12


def test_app_today_is_pinned_to_as_of(db):
    assert rows(db, "SELECT app_today()")[0][0] == AS_OF


def test_seed_records_schema_version_for_the_deploy_check(db):
    assert rows(db, "SELECT value FROM app_setting WHERE key = 'schema_version'")[0][0] == schema_version()


def test_schema_version_matches_the_deploy_workflow_algorithm():
    # CI 在 runner 上用 cat models.py semantic_layer.sql | sha256sum 算指紋，兩邊要算出同一個值
    app_dir = ROOT / "backend" / "app"
    joined = (app_dir / "models.py").read_bytes() + (app_dir / "sql" / "semantic_layer.sql").read_bytes()
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
        visit = models.Visit(customer_id="C001", user_id="U01", visited_at=datetime.now(generate.TAIPEI))
        session.add(visit)
        session.flush()
        # 序號接在假資料的 150 筆之後；前面的測試建過拜訪的話號碼會再往後，所以只比格式與大小
        assert len(visit.id) == 6 and visit.id.startswith("V") and visit.id > "V00150"
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


def test_north_supplement_decline_is_concentrated_in_three_chains_led_by_fish_oil(db):
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
    top3 = {r[0] for r in rows(db, f"""
        SELECT name FROM ({window}) w GROUP BY name
        ORDER BY sum(prior) - sum(recent) DESC LIMIT 3
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
