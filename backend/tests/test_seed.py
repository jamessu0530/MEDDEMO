"""第一週出場條件：資料表建好、假資料可查、四個語意層 View 查得出數字、欄位定義確定。"""

import hashlib
import json
import re
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

import catalog
import conftest
import generate
import psycopg
import pytest
import seed
from jsonschema import Draft202012Validator
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.orm import Session

from app import models
from app.db import reset_schema, schema_version
from app.services import extraction, transcription

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
    # 250 家，加上示範業務在新竹市的三家（catalog.HSINCHU_CUSTOMERS：兩家獨立藥局、一家診所）
    assert rows(db, "SELECT count(*) FROM customer")[0][0] == 253
    # 40 個虛構品項、促銷方案照搬的 20 個真實品項，加上真實型錄（data/seed/products.tsv）
    real = generate.read_real_products()
    assert len(real) > 1500
    assert rows(db, "SELECT count(*) FROM product")[0][0] == 60 + len(real)
    by_type = dict(rows(db, "SELECT type, count(*) FROM customer GROUP BY type"))
    assert by_type == {"chain": 76, "independent": 114, "clinic": 63}
    first, last, months = rows(db, """
        SELECT min(date), max(date), count(DISTINCT date_trunc('month', date)) FROM sales_transaction
    """)[0]
    assert first >= AS_OF - timedelta(days=365) and last < AS_OF
    assert months >= 12


def test_each_rep_visits_three_to_five_customers_every_weekday(db):
    # 一位業務負責 50 家（示範業務多新竹那三家），一天跑 3～5 家、只跑平日；記錄的這一年裡每個平日都有出門
    reps = ["U01", "U02", "U03", "U04", "U05"]
    assert dict(rows(db, "SELECT owner_user_id, count(*) FROM customer GROUP BY 1")) == dict.fromkeys(reps, 50) | {"U01": 53}
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
        "backend/app/embeddings.py",
        "data/seed/generate.py",
        "data/seed/catalog.py",
        "data/seed/products.tsv",
        "backend/app/services/payment_terms.py",
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
    assert rows(db, "SELECT count(*) FROM sap_quotation_draft WHERE visit_id IS NOT NULL")[0][0] == intent_lines
    # 歷史報價草稿沒有促銷：每一列的金額就是單價 × 數量
    assert rows(db, "SELECT count(*) FROM sap_quotation_draft WHERE visit_id IS NOT NULL AND (amount <> unit_price * qty OR promo_code IS NOT NULL)")[0][0] == 0
    skipped = rows(db, "SELECT count(*) FROM writeback_log WHERE target = 'sap' AND status = 'skipped'")[0][0]
    no_intent = rows(db, "SELECT count(*) FROM visit WHERE fields_final->'intent' = 'null'::jsonb")[0][0]
    assert skipped == no_intent > 0


def test_approval_history_has_both_outcomes_and_complete_features(db):
    # 簽核模型的訓練資料：優惠 900 張、合約 300 張，全部已經有結果，過與不過都有
    outcomes = {(kind, status): n for kind, status, n in rows(db, """
        SELECT kind, status, count(*) FROM oa_expense_form
        WHERE kind <> 'trip' AND status <> 'pending' AND NOT auto_approved GROUP BY 1, 2
    """)}
    for kind, total in (("discount", 900), ("contract", 300)):
        counts = {status: outcomes.get((kind, status), 0) for status in ("approved", "rejected", "returned")}
        assert sum(counts.values()) == total
        # 大多數會過，但被退的也夠多，模型才有東西學
        assert 0.6 < counts["approved"] / total < 0.9 and counts["rejected"] > 20 and counts["returned"] > 10
    # 折扣大多落在主管權限內，少數到處長，很少到總經理；合約約三分之二照原費率
    levels = {(kind, level): n for kind, level, n in rows(db, """
        SELECT kind, required_level, count(*) FROM oa_expense_form WHERE kind <> 'trip' AND status <> 'pending'
        AND NOT auto_approved GROUP BY 1, 2
    """)}
    assert levels["discount", "manager"] > 600 > 250 > levels["discount", "director"] > 100 > levels["discount", "gm"] > 20
    assert 180 < levels["contract", "manager"] < 220 and ("contract", "gm") not in levels
    # 特徵在送單當下就存在單上，每一張都齊全
    assert rows(db, """
        SELECT kind, array_agg(DISTINCT k ORDER BY k) FROM oa_expense_form, jsonb_object_keys(model_features) k
        WHERE kind <> 'trip' GROUP BY 1 ORDER BY 1
    """) == [
        ("contract", sorted(generate_features("contract"))),
        ("discount", sorted(generate_features("discount"))),
    ]
    assert rows(db, "SELECT count(*) FROM oa_expense_form WHERE kind <> 'trip' AND model_features IS NULL")[0][0] == 0
    # 申請日都在有完整 90 天進貨紀錄的期間，而且是平日
    first, last, weekend = rows(db, """
        SELECT min(request_date), max(request_date), count(*) FILTER (WHERE extract(isodow FROM request_date) > 5)
        FROM oa_expense_form WHERE kind <> 'trip'
    """)[0]
    assert first >= AS_OF - timedelta(days=generate.APPROVAL_HISTORY_DAYS) and last < AS_OF and weekend == 0


def generate_features(kind):
    from app.services import approvals

    return approvals.FEATURES[kind]


def test_every_seeded_trip_form_has_two_signed_steps_and_two_log_lines(db):
    # 出差單的關卡與日誌在 seed.py 用 SQL 補（只補 kind = 'trip' 的）：請求者與直屬主管兩關都簽完，
    # 日誌是送出與核准兩筆。優惠與合約的單另外補，不能混進來
    assert rows(db, """
        SELECT count(*) FROM oa_expense_form o
        JOIN app_user a ON a.id = o.applicant_id
        WHERE o.kind = 'trip' AND (
            (SELECT array_agg((s.role_label || '/' || s.user_id || '/' || s.status)::text ORDER BY s.step_no)
             FROM oa_approval_step s WHERE s.form_id = o.id)
            IS DISTINCT FROM ARRAY['請求者/' || o.applicant_id || '/done', '經辦人的主管/' || a.manager_id || '/done']
         OR (SELECT array_agg(x.action::text ORDER BY x.id) FROM oa_activity x WHERE x.form_id = o.id)
            IS DISTINCT FROM ARRAY['submitted', 'approved']
        )
    """)[0][0] == 0
    assert rows(db, "SELECT count(*) FROM oa_expense_form WHERE kind = 'trip' AND status = 'approved'")[0][0] == 5259


def test_approval_history_leaves_the_trip_forms_and_quotes_alone(db):
    # 既有的 5,259 張出差單（新竹那三家的 36 張在內）照舊；歷史優惠單不建報價草稿（會影響今日路線的商機）
    assert rows(db, "SELECT count(*), count(visit_id), count(payload) FROM oa_expense_form WHERE kind = 'trip'")[0] == (5259, 5259, 0)
    assert rows(db, "SELECT count(*) FROM sap_quotation_draft WHERE visit_id IS NOT NULL")[0][0] == 295
    assert rows(db, "SELECT count(*) FROM oa_expense_form WHERE kind = 'discount' AND payload->>'quote_no' IS NOT NULL")[0][0] == 0
    # 單號各自編號，不重複
    assert rows(db, "SELECT DISTINCT left(form_no, 2) FROM oa_expense_form WHERE kind = 'discount'") == [("DC",)]
    assert rows(db, "SELECT DISTINCT left(form_no, 2) FROM oa_expense_form WHERE kind = 'contract'") == [("CT",)]


def test_every_decided_request_has_its_whole_chain_of_signers(db):
    # 關卡與活動日誌在 seed.py 補：人簽過的單每一關都簽完，最後一關的結果就是整張單的結果
    chains = rows(db, """
        SELECT o.required_level, o.status,
               array_agg(s.title ORDER BY s.step_no), array_agg(s.user_id ORDER BY s.step_no),
               bool_and(s.status = 'done' AND s.acted_at IS NOT NULL)
        FROM oa_expense_form o JOIN oa_approval_step s ON s.form_id = o.id
        WHERE o.kind <> 'trip' AND o.status <> 'pending' AND NOT o.auto_approved
        GROUP BY o.id
    """)
    assert len(chains) == 1200
    titles = {"manager": ["業務", "區處主管"], "director": ["業務", "區處主管", "業務處長"], "gm": ["業務", "區處主管", "業務處長", "總經理"]}
    for level, _, chain, signers, all_done in chains:
        assert chain == titles[level] and all_done
        # 業務處長、總經理由根節點的 IT 帳號代簽
        assert signers[0].startswith("U") and signers[1].startswith("M") and set(signers[2:]) <= {"A01"}
    last_actions = dict(rows(db, """
        SELECT DISTINCT o.status, a.action FROM oa_expense_form o
        JOIN oa_activity a ON a.id = (SELECT max(id) FROM oa_activity WHERE form_id = o.id)
        WHERE o.kind <> 'trip' AND o.status <> 'pending' AND NOT o.auto_approved
    """))
    assert last_actions == {"approved": "approved", "rejected": "rejected", "returned": "returned"}


def test_the_demo_requests_wait_in_the_managers_inbox(db):
    # 給展示用：陳建宏的簽核匣兩張優惠（6% 與要再送處長的 10%）與一張合約，林昱辰名下兩張系統核准的
    waiting = rows(db, """
        SELECT o.kind, o.required_level, (o.payload->>'discount_pct')::float, c.name,
               array_agg(s.status ORDER BY s.step_no), array_agg(s.user_id ORDER BY s.step_no)
        FROM oa_expense_form o JOIN customer c ON c.id = o.customer_id JOIN oa_approval_step s ON s.form_id = o.id
        WHERE o.status = 'pending' GROUP BY o.id, c.name ORDER BY o.created_at
    """)
    assert waiting == [
        ("discount", "manager", 6.0, "福安連鎖藥局 · 鶯歌店", ["done", "pending"], ["U01", "M01"]),
        ("discount", "director", 10.0, "福安連鎖藥局 · 板橋店", ["done", "pending", "waiting"], ["U01", "M01", "A01"]),
        ("contract", "director", None, "康泰連鎖藥局 · 蘆洲店", ["done", "pending", "waiting"], ["U01", "M01", "A01"]),
    ]
    # 續約要在到期前 3 個月內才能申請：展示用那張送單當下離到期 41 天
    assert rows(db, """
        SELECT (payload->>'old_end_date')::date - request_date FROM oa_expense_form WHERE kind = 'contract' AND status = 'pending'
    """) == [(41,)]
    automatic = rows(db, """
        SELECT o.applicant_id, o.kind, o.status, array_agg(s.role_label ORDER BY s.step_no),
               array_agg(s.user_id ORDER BY s.step_no),
               (SELECT array_agg(a.action ORDER BY a.id) FROM oa_activity a WHERE a.form_id = o.id)
        FROM oa_expense_form o JOIN oa_approval_step s ON s.form_id = o.id
        WHERE o.auto_approved GROUP BY o.id ORDER BY o.created_at
    """)
    assert automatic == [("U01", "discount", "approved", ["請求者", "系統核准"], ["U01", None], ["submitted", "auto_approved"])] * 2


def test_promotions_run_monthly_up_to_the_as_of_month(db):
    # 202608 是照搬的那一期，之後每月模擬一期，決賽日那一期是進行中
    assert rows(db, "SELECT promotion_name, start_date, end_date, status FROM v_promotion ORDER BY start_date") == [
        ("202608保藥特搭活動", datetime(2026, 8, 1).date(), datetime(2026, 8, 31).date(), "已結束"),
        ("202609保藥特搭活動", datetime(2026, 9, 1).date(), datetime(2026, 9, 30).date(), "已結束"),
        ("202610保藥特搭活動", datetime(2026, 10, 1).date(), datetime(2026, 10, 31).date(), "進行中"),
    ]
    assert dict(rows(db, "SELECT promotion_name, count(*) FROM v_promotion_item GROUP BY 1")) == {
        "202608保藥特搭活動": 37, "202609保藥特搭活動": 37, "202610保藥特搭活動": 34,
    }


def test_the_last_period_changes_three_promotions(db):
    # 202610（決賽日那一期）：40EXa 只剩小口、金舒胃平小口要買的量變多、威鎮凝膠這期沒有；前幾期照舊
    def packs(period, sku):
        return [tuple(r) for r in rows(db, """
            SELECT item_name, buy_qty, free_qty, deal_price::float FROM v_promotion_item
            WHERE promotion_name = :p AND sku = :s ORDER BY item_code
        """, p=f"{period}保藥特搭活動", s=sku)]

    assert [p[0] for p in packs("202609", "F763630")] == ["40EXa眼藥水(小口)", "40EXa眼藥水(中口)", "40EXa眼藥水(大口)"]
    assert [p[0] for p in packs("202610", "F763630")] == ["40EXa眼藥水(小口)"]
    assert packs("202609", "C130082")[0] == ("金舒胃平(小口)", 10, 2, 800.0)
    assert packs("202610", "C130082")[0] == ("金舒胃平(小口)", 15, 2, 1200.0)
    assert packs("202609", "D120013") == [("威鎮凝膠", 11, 2, 990.0)]
    assert packs("202610", "D120013") == []


def test_last_months_quotes_are_ordered(db):
    # 上個月已成交的兩張報價：忠孝店三種變化都有，士林店的口都沒變。口是 202609 那一期的；不補交易
    found = [tuple(r) for r in rows(db, """
        SELECT q.quote_no, q.customer_id, (q.created_at AT TIME ZONE 'Asia/Taipei')::date::text,
               string_agg(coalesce(i.name || ' × ' || q.packs || ' 口', q.sku || ' × ' || q.qty), '、' ORDER BY q.line_no)
        FROM sap_quotation_draft q LEFT JOIN promotion_item i ON i.code = q.promo_code
        WHERE q.status = 'ordered' GROUP BY 1, 2, 3 ORDER BY 1
    """)]
    assert found == [
        ("Q20260930-0001", "C001", "2026-09-30",
         "40EXa眼藥水(中口) × 1 口、金舒胃平(小口) × 3 口、威鎮凝膠 × 2 口、Premium眼藥水(小口) × 1 口、HS-FO30 × 40"),
        ("Q20260930-0002", "C009", "2026-09-30", "Premium眼藥水(小口) × 2 口、骨營膠囊600T(小口) × 1 口"),
    ]
    periods = rows(db, """
        SELECT DISTINCT i.promotion_id FROM sap_quotation_draft q JOIN promotion_item i ON i.code = q.promo_code
        WHERE q.status = 'ordered'
    """)
    assert [p[0] for p in periods] == ["PR-202609"]
    # 金額照報價的算法：口照每口售價 × 口數；魚油 30 入連鎖供貨價 405 × 40
    total = rows(db, "SELECT sum(amount)::float FROM sap_quotation_draft WHERE quote_no = 'Q20260930-0001'")[0][0]
    assert total == 7980 + 800 * 3 + 990 * 2 + 5500 + 405 * 40


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
    # 真實品項（促銷方案與型錄）只進品項表，常進品項照舊從虛構的 40 個抽，交易與評測答案不受影響
    real = [p[0] for p in catalog.PROMO_PRODUCTS] + [r["料號"] for r in generate.read_real_products()]
    assert rows(db, "SELECT count(*) FROM sales_transaction WHERE sku = ANY(:skus)", skus=real)[0][0] == 0


def test_only_common_products_are_handed_to_the_ai_and_the_speech_recognizer(db):
    # 虛構品項、促銷品項與 catalog.COMMON_REAL_PRODUCTS 是常用品項，型錄其他的不是
    common = {r[0] for r in rows(db, "SELECT sku FROM product WHERE common")}
    expected = {p[0] for p in catalog.PRODUCTS} | {p[0] for p in catalog.PROMO_PRODUCTS} | set(catalog.COMMON_REAL_PRODUCTS)
    assert common == expected
    with Session(db) as session:
        assert {hint.sku for hint in extraction.product_hints(session)} == expected
        hotwords = transcription.load_hotwords(session)
    assert "虎讚" in hotwords and "魚油" in hotwords
    assert "日本獅王細潔寬薄牙刷炭能抗菌" not in hotwords


def test_every_customer_sits_on_a_place_in_its_own_region(db):
    # 縣市一個地點，台北市客戶多，拆成十二個行政區；每個地點都有客戶
    by_place = dict(rows(db, "SELECT p.name, count(*) FROM customer c JOIN place p ON p.id = c.place_id GROUP BY 1"))
    assert len(by_place) == 18
    assert by_place["台北市・大安區"] > 0 and by_place["新北市"] > 0 and by_place["新竹市"] == 3
    # 地點所在的區就是客戶的區；台北市的客戶一定對到行政區，其他縣市就是縣市本身
    assert rows(db, """
        SELECT c.name FROM customer c
        JOIN place p ON p.id = c.place_id
        JOIN org_unit u ON u.id = p.unit_id
        WHERE u.name <> c.region
           OR (c.city = '台北市' AND p.name NOT LIKE '台北市・%')
           OR (c.city <> '台北市' AND p.name <> c.city)
    """) == []
    # 連鎖分店與「長春」這種不是行政區名稱的地區，照對照表放
    places = dict(rows(db, "SELECT c.name, p.name FROM customer c JOIN place p ON p.id = c.place_id"))
    assert places["康泰連鎖藥局 · 忠孝店"] == "台北市・大安區"
    assert places["福安連鎖藥局 · 西門店"] == "台北市・萬華區"
    assert places["家家藥局 · 長春"] == "台北市・中山區"


def test_a_taipei_customer_without_a_district_fails_loudly():
    with pytest.raises(ValueError, match="測試藥局 · 天龍"):
        generate.place_of("測試藥局 · 天龍", "independent", "台北市", "天龍")
    with pytest.raises(ValueError, match="康泰連鎖藥局 · 新開店"):
        generate.place_of("康泰連鎖藥局 · 新開店", "chain", "台北市", "新開店")
    assert generate.place_of("德安藥局 · 逢甲", "independent", "台中市", "逢甲") == "TXG"


def test_the_sap_employee_master_covers_reps_and_managers_but_not_it(db):
    # 模擬 SAP 的人員主檔：五位業務與四位主管各一列，IT 沒有
    numbers = dict(rows(db, "SELECT u.id, e.employee_no FROM app_user u LEFT JOIN sap_employee e ON e.user_id = u.id"))
    reps = ["U01", "U02", "U03", "U04", "U05"]
    assert {user for user, number in numbers.items() if number} == {*reps, "M01", "M02", "M03", "M04"}
    assert numbers["A01"] is None
    # 人員編號是 E 加五碼。唯一由資料表的限制保證；IT 開新帳號時接著最大號編，所以格式要固定
    assert all(re.fullmatch(r"E\d{5}", number) for number in numbers.values() if number)
    # 到職日都在一年以前：這九個人在假資料裡有一整年的拜訪紀錄，沒有一個是新人
    assert rows(db, "SELECT count(*) FROM sap_employee WHERE hire_date > app_today() - 365")[0][0] == 0
    # 產品線的值是品項表的類別。業務四條都負責——他們名下的客戶四類都在進；
    # 日用品只在真實型錄裡、沒有交易，沒有人負責
    categories = {r[0] for r in rows(db, "SELECT DISTINCT category FROM product")}
    lines = dict(rows(db, "SELECT user_id, product_lines FROM sap_employee"))
    assert all(lines[user] and set(lines[user]) <= categories for user in lines)
    assert all(set(lines[rep]) == set(catalog.PRODUCT_LINES) for rep in reps)
    assert categories == {*catalog.PRODUCT_LINES, "日用品"}
    assert dict(rows(db, """
        SELECT c.owner_user_id, count(DISTINCT p.category) FROM sales_transaction t
        JOIN customer c ON c.id = t.customer_id JOIN product p ON p.sku = t.sku GROUP BY 1
    """)) == dict.fromkeys(reps, 4)


def test_seeded_conversations_sit_in_their_channels(db):
    found = dict(rows(db, """
        SELECT CASE ch.kind WHEN 'team' THEN m.name || '小組' WHEN 'place' THEN p.name WHEN 'topic' THEN ch.name
          ELSE cu.name END, count(*)
        FROM channel_message msg
        JOIN channel ch ON ch.id = msg.channel_id
        LEFT JOIN app_user m ON m.id = ch.manager_id
        LEFT JOIN place p ON p.id = ch.place_id
        LEFT JOIN customer cu ON cu.id = ch.customer_id
        GROUP BY 1
    """))
    assert found == {
        "陳建宏小組": 5, "台北市・大安區": 2, "康泰連鎖藥局 · 忠孝店": 2, "許文彬小組": 2, "蔡宗翰小組": 2,
        "新品上市": 2, "補貨問題": 1, "公司公告": 1,
    }
    # 全國 1、整區 3、小組 4、地點 18、文字頻道 3，加上灌資料建的忠孝店討論串
    assert rows(db, "SELECT count(*) FROM channel")[0][0] == 30
    # 時間都在灌資料之前，同一個頻道裡編號越大越晚
    assert rows(db, "SELECT count(*) FROM channel_message WHERE created_at > now()")[0][0] == 0
    assert rows(db, """
        SELECT count(*) FROM channel_message a JOIN channel_message b
          ON a.channel_id = b.channel_id AND a.id < b.id AND a.created_at > b.created_at
    """)[0][0] == 0


def test_seeded_conversations_carry_the_drawn_photos_and_pdf(db):
    found = rows(db, """
        SELECT a.filename, a.kind, a.status, a.caption, a.uploader_id = msg.author_id, a.thumbnail IS NOT NULL
        FROM attachment a JOIN channel_message msg ON msg.id = a.message_id
        ORDER BY a.filename
    """)
    assert [f[0] for f in found] == sorted(catalog.SEED_ATTACHMENTS)
    for filename, kind, status, caption, by_author, has_thumbnail in found:
        assert (status, caption, by_author) == ("ready", catalog.SEED_ATTACHMENTS[filename], True)
        assert has_thumbnail == (kind == "image")
    # 每個檔名都畫好了，也都接在某一則對話上
    drawn = {path.name for path in seed.ATTACHMENTS_DIR.iterdir()}
    attached = {name for _, lines in catalog.CONVERSATIONS for line in lines for name in (line[4] if len(line) > 4 else ())}
    assert drawn == attached == set(catalog.SEED_ATTACHMENTS)
    # 說明與所屬訊息的文字都搜得到
    assert rows(db, "SELECT filename FROM attachment WHERE search_tokens @@ to_tsquery('simple', '買十 & 魚油')") == [
        ("yushotian-poster.jpg",)
    ]


def test_seeded_memory_shares_the_poster_but_not_the_quote(db):
    shared = dict(rows(db, """
        SELECT a.filename, bool_or(a.id = ANY(m.shared_attachment_ids))
        FROM memory_item m JOIN attachment a ON a.id = ANY(m.attachment_ids)
        GROUP BY a.filename
    """))
    assert shared["yushotian-poster.jpg"] and shared["zhongxiao-shelf.jpg"]
    assert not shared["kangpule-quote.jpg"]
    # 往上傳的附件一定是那條重點自己的附件；往上傳的都有寫法
    assert rows(db, "SELECT count(*) FROM memory_item WHERE shared AND shared_text IS NULL")[0][0] == 0
    # 來源訊息都在同一個頻道，有記憶的頻道都整理到最後一則
    assert rows(db, """
        SELECT count(*) FROM memory_item m JOIN channel_message msg ON msg.id = ANY(m.source_message_ids)
        WHERE msg.channel_id <> m.channel_id
    """)[0][0] == 0
    assert rows(db, """
        SELECT count(*) FROM channel c
        WHERE EXISTS (SELECT 1 FROM memory_item m WHERE m.channel_id = c.id)
          AND c.memory_through_id IS DISTINCT FROM (SELECT max(id) FROM channel_message WHERE channel_id = c.id)
    """)[0][0] == 0
    assert rows(db, "SELECT count(*) FROM memory_item")[0][0] == sum(len(items) for _, items in catalog.MEMORY)


def test_method_cards_cover_every_tag_and_are_written_by_managers(db):
    assert rows(db, "SELECT count(*) FROM method_card WHERE status = 'published'")[0][0] == len(catalog.METHOD_CARDS)
    tags = Counter(tag for (card_tags,) in rows(db, "SELECT tags FROM method_card WHERE status = 'published'") for tag in card_tags)
    # 談判卡與新人頁之後靠標籤帶出相關的卡：每個標籤都要有卡可帶，新人頁一次帶三張
    assert set(tags) == set(models.METHOD_TAGS)
    assert tags["newcomer"] >= 3
    authors = rows(db, "SELECT u.id, u.role FROM method_card c JOIN app_user u ON u.id = c.author_id GROUP BY 1, 2")
    assert {role for _, role in authors} == {"manager"}
    # 四位主管都有寫，不是只有一區在教
    assert {author for author, _ in authors} == {"M01", "M02", "M03", "M04"}


def test_method_card_feedback_comes_from_reps_on_their_own_customers(db):
    # 回饋的人都是業務，按的地方是自己名下、而且是這張卡適用的那種客戶
    assert rows(db, """
        SELECT count(*) FROM method_card_feedback f
        JOIN method_card m ON m.id = f.card_id
        JOIN app_user u ON u.id = f.user_id
        LEFT JOIN customer c ON c.id = f.customer_id
        WHERE u.role <> 'sales'
           OR c.owner_user_id IS DISTINCT FROM f.user_id
           OR (m.customer_type IS NOT NULL AND c.type <> m.customer_type)
    """)[0][0] == 0
    assert {r[0] for r in rows(db, "SELECT DISTINCT user_id FROM method_card_feedback")} == {"U01", "U02", "U03", "U04", "U05"}
    # 每張卡的採用與沒幫上次數照 catalog 寫的目標
    found = {title: (adopted, not_helped) for title, adopted, not_helped in rows(db, """
        SELECT m.title, count(*) FILTER (WHERE f.helped), count(*) FILTER (WHERE NOT f.helped)
        FROM method_card m LEFT JOIN method_card_feedback f ON f.card_id = m.id GROUP BY m.id
    """)}
    assert found == {card[0]: card[-2:] for card in catalog.METHOD_CARDS}
    # 時間都在灌資料之前，而且在卡片寫好之後
    assert rows(db, """
        SELECT count(*) FROM method_card_feedback f JOIN method_card m ON m.id = f.card_id
        WHERE f.created_at > now() OR f.created_at < m.created_at
    """)[0][0] == 0


def test_generated_method_card_feedback_never_repeats_a_card_rep_and_customer():
    data = generate.generate(AS_OF)
    keys = [(f["card_title"], f["user_id"], f["customer_id"]) for f in data["method_card_feedback"]]
    assert keys and len(set(keys)) == len(keys)
    # 標題是灌資料時把回饋對回卡片的依據，不能重複
    titles = [card["title"] for card in data["method_card"]]
    assert len(set(titles)) == len(titles)
    assert {f["card_title"] for f in data["method_card_feedback"]} <= set(titles)


def test_one_account_has_one_answer_per_card_and_customer_even_without_a_customer(tx):
    card_id = tx.scalar(select(models.MethodCard.id).limit(1))

    def press(customer_id):
        with tx.begin_nested():
            tx.add(models.MethodCardFeedback(card_id=card_id, user_id="A01", customer_id=customer_id, helped=True))

    press(None)
    press("C001")
    # 從方法卡清單按的沒有客戶：NULL 也算同一筆，不然同一個人可以一直按、次數一直加
    for customer_id in (None, "C001"):
        with pytest.raises(IntegrityError):
            press(customer_id)


def test_a_method_card_needs_at_least_one_tag(tx):
    with pytest.raises(IntegrityError), tx.begin_nested():
        tx.add(models.MethodCard(title="沒有標籤的卡", situation="什麼時候用", approach="怎麼做", tags=[], author_id="M01"))


@pytest.fixture
def used_database():
    """一個已經有人在用的資料庫：除了公司帳號，有人自己開了帳號，也有人綁了第三方登入。
    另外建一個庫來重灌，不動其他測試共用的那一個。"""
    name = f"{conftest.TEST_DB}_reseed"
    url = conftest.BASE_URL.set(database=name).render_as_string(hide_password=False)
    admin = create_engine(conftest.ADMIN_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.exec_driver_sql(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
        conn.exec_driver_sql(f"CREATE DATABASE {name}")
    engine = create_engine(url)
    reset_schema(engine)
    with Session(engine) as session, session.begin():
        session.add_all([
            models.OrgUnit(id="TW", name="全國", kind="root"),
            models.OrgUnit(id="TW.N", name="北區", kind="region", parent_id="TW"),
        ])
        session.flush()
        session.add_all([
            models.AppUser(id="A01", name="James", role="it", region="全國", unit_id="TW", org_path="TW"),
            models.AppUser(id="M01", name="陳建宏", role="manager", region="北區", unit_id="TW.N", org_path="TW.N.M01"),
            # 舊的組織裡有、新的假資料裡沒有的主管：他的綁定沒有帳號可以掛，放不回去
            models.AppUser(id="M09", name="舊主管", role="manager", region="北區", unit_id="TW.N", org_path="TW.N.M09"),
        ])
        session.flush()
        session.add(models.AppUser(
            id="U01", name="林昱辰", role="sales", region="北區", manager_id="M01", org_path="TW.N.M01.U01",
        ))
        session.flush()
        session.add(models.AppUser(
            id="XKEEP001", name="評審", role="sales", region="北區", email="keep@reseed.test",
            password_hash="hash-kept", acts_as_user_id="U01", session_version=3,
        ))
        session.flush()
        session.add_all([
            models.UserIdentity(user_id="A01", provider="google", subject="g-it", email="jamessu2026@gmail.com"),
            models.UserIdentity(user_id="XKEEP001", provider="github", subject="gh-keep"),
            models.UserIdentity(user_id="M09", provider="google", subject="g-old"),
        ])
    engine.dispose()
    yield url
    with admin.connect() as conn:
        conn.exec_driver_sql(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
    admin.dispose()


def test_a_reseed_keeps_self_created_accounts_and_sign_in_bindings(used_database):
    # 部署時資料表一改就會重灌（.github/workflows/ci-cd.yml）。重灌不能把人擋在門外：
    # 自己開的帳號要還在，綁過的 Google／GitHub 要還認得，不然下次登入會被當成新來的、另開一個帳號
    counts = seed.seed(used_database, AS_OF)
    engine = create_engine(used_database)
    with engine.connect() as conn:
        kept = rows(conn, """
            SELECT name, role, region, email, password_hash, acts_as_user_id, session_version, org_path::text
            FROM app_user WHERE id = 'XKEEP001'
        """)
        # 密碼與登入版號原樣留著：重灌之後不必重設密碼，手機上的登入狀態也還有效
        assert [tuple(r) for r in kept] == [("評審", "sales", "北區", "keep@reseed.test", "hash-kept", "U01", 3, None)]
        bindings = {tuple(r) for r in rows(conn, "SELECT user_id, provider, subject, email FROM user_identity")}
        # M09 在新的假資料裡不存在，他的綁定跟著消失
        assert bindings == {
            ("A01", "google", "g-it", "jamessu2026@gmail.com"),
            ("XKEEP001", "github", "gh-keep", None),
        }
        # 假資料照常灌好：十個公司帳號加上留下來的那一個
        assert rows(conn, "SELECT count(*) FROM app_user")[0][0] == 11
        assert rows(conn, "SELECT count(*) FROM customer")[0][0] == 253
        # 人員主檔只有公司的業務與主管；留下來的自建帳號沒有（新人第一週頁把他當新人）
        assert rows(conn, "SELECT count(*), count(*) FILTER (WHERE user_id = 'XKEEP001') FROM sap_employee") == [(9, 0)]
    engine.dispose()
    assert (counts["kept_account"], counts["kept_identity"]) == (1, 2)


def test_accounts_that_cannot_go_back_do_not_fail_the_seed(tx):
    account = {
        "id": "XDUP0001", "name": "撞信箱", "role": "sales", "region": "北區", "email": "u01@meddemo.tw",
        "password_hash": "h", "acts_as_user_id": "U01", "session_version": 1,
    }
    binding = {"user_id": "A01", "provider": "google", "subject": "g-it", "email": None}
    # 信箱跟新的公司帳號撞了：這個帳號放不回去，其他的照放
    assert seed.restore_accounts(tx, seed.KeptAccounts(users=[account], identities=[binding])) == (0, 1)
    # 舊資料不合新的資料表（這裡是一種已經不支援的登入方式）：整批放棄，灌資料照常往下走。
    # 這時資料庫已經清空重建了，為了幾筆舊帳號讓整次重灌失敗，線上會剩下一個空的資料庫
    outdated = seed.KeptAccounts(users=[], identities=[binding | {"user_id": "M01", "provider": "myspace"}])
    assert seed.restore_or_skip(tx, outdated) == (0, 0)
    assert tx.scalar(select(func.count()).select_from(models.AppUser)) == 10
    assert tx.scalar(select(func.count()).select_from(models.UserIdentity)) == 1


def test_district_names_follow_the_branch_tables():
    # 台北市的連鎖分店照分店對照表；其他分店去掉「店」就是鄉鎮；不是行政區名稱的地區另外對
    assert generate.district_of("chain", "台北市", "忠孝店") == "大安"
    assert generate.district_of("chain", "新北市", "三重店") == "三重"
    assert generate.district_of("chain", "台中市", "逢甲店") == "西屯"
    assert generate.district_of("chain", "彰化縣", "彰化中正店") == "彰化"
    assert generate.district_of("independent", "台北市", "長春") == "中山"
    assert generate.district_of("independent", "台南市", "開元") == "北區"
    assert generate.district_of("clinic", "高雄市", "左營") == "左營"


def test_every_customer_sits_near_its_district_centre(db):
    found = rows(db, "SELECT id, city, area, lat, lng FROM customer")
    assert len(found) > 100
    for customer_id, city, area, lat, lng in found:
        centre_lat, centre_lng = catalog.DISTRICT_COORDS[(city, area)]
        assert abs(lat - centre_lat) <= generate.LOCATION_JITTER + 1e-9, customer_id
        assert abs(lng - centre_lng) <= generate.LOCATION_JITTER + 1e-9, customer_id
    # 同一區的店錯開，地圖上不會疊在同一點
    assert len({(lat, lng) for *_, lat, lng in found}) == len(found)


def test_each_region_has_an_office_to_start_from(db):
    offices = dict(rows(db, "SELECT id, lat FROM org_unit WHERE kind = 'region'"))
    assert set(offices) == set(catalog.REGION_OFFICE)
    assert all(lat is not None for lat in offices.values())


def test_the_demo_rep_has_three_route_habits(db):
    found = rows(db, "SELECT kind, weekday, source FROM route_habit WHERE user_id = 'U01' ORDER BY created_at")
    assert found == [("precedence", None, "ai"), ("last", 2, "manual"), ("window", None, "manual")]


def test_demo_notes_belong_to_the_demo_rep(db):
    notes = rows(db, """
        SELECT n.kind, n.on_date, c.owner_user_id FROM customer_note n JOIN customer c ON c.id = n.customer_id
    """)
    assert notes and all(owner == "U01" for _, _, owner in notes)
    assert {kind for kind, _, _ in notes} == {"bring", "told"}
    # 有日期與沒日期的要帶的都有，日曆與「下次去」才都有東西看
    assert any(k == "bring" and d is None for k, d, _ in notes) and any(k == "bring" and d for k, d, _ in notes)
