"""第一週出場條件：資料表建好、假資料可查、四個語意層 View 查得出數字、欄位定義確定。"""

import hashlib
import json
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

import conftest
import generate
import psycopg
import pytest
import seed
from jsonschema import Draft202012Validator
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from app import models
from app.db import reset_schema, schema_version

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


def test_approval_history_leaves_the_trip_forms_and_quotes_alone(db):
    # 既有的 5,223 張出差單照舊；歷史優惠單不建報價草稿（會影響今日路線的商機）
    assert rows(db, "SELECT count(*), count(visit_id), count(payload) FROM oa_expense_form WHERE kind = 'trip'")[0] == (5223, 5223, 0)
    assert rows(db, "SELECT count(*) FROM sap_quotation_draft")[0][0] == 295
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


def test_every_customer_sits_on_a_place_in_its_own_region(db):
    # 縣市一個地點，台北市客戶多，拆成十二個行政區；每個地點都有客戶
    by_place = dict(rows(db, "SELECT p.name, count(*) FROM customer c JOIN place p ON p.id = c.place_id GROUP BY 1"))
    assert len(by_place) == 17
    assert by_place["台北市・大安區"] > 0 and by_place["新北市"] > 0
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


def test_seeded_conversations_sit_in_their_channels(db):
    found = dict(rows(db, """
        SELECT CASE ch.kind WHEN 'team' THEN m.name || '小組' WHEN 'place' THEN p.name ELSE cu.name END, count(*)
        FROM channel_message msg
        JOIN channel ch ON ch.id = msg.channel_id
        LEFT JOIN app_user m ON m.id = ch.manager_id
        LEFT JOIN place p ON p.id = ch.place_id
        LEFT JOIN customer cu ON cu.id = ch.customer_id
        GROUP BY 1
    """))
    assert found == {
        "陳建宏小組": 5, "台北市・大安區": 2, "康泰連鎖藥局 · 忠孝店": 2, "許文彬小組": 2, "蔡宗翰小組": 2,
    }
    # 全國 1、整區 3、小組 4、地點 17，加上灌資料建的忠孝店討論串
    assert rows(db, "SELECT count(*) FROM channel")[0][0] == 26
    # 時間都在灌資料之前，同一個頻道裡編號越大越晚
    assert rows(db, "SELECT count(*) FROM channel_message WHERE created_at > now()")[0][0] == 0
    assert rows(db, """
        SELECT count(*) FROM channel_message a JOIN channel_message b
          ON a.channel_id = b.channel_id AND a.id < b.id AND a.created_at > b.created_at
    """)[0][0] == 0


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
        assert rows(conn, "SELECT count(*) FROM customer")[0][0] == 250
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
