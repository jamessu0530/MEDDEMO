"""數字評測題的標準答案要跟假資料一致：用 SQL 重算一次，假資料一改，過期的答案馬上會被抓到。"""

import importlib.util
import json
from pathlib import Path

import pytest
from sqlalchemy import text

ROOT = Path(__file__).resolve().parents[2]
ITEMS = {i["id"]: i for i in json.loads((ROOT / "data/eval/data_questions.json").read_text(encoding="utf-8"))["items"]}
_spec = importlib.util.spec_from_file_location("eval_ask", ROOT / "backend" / "scripts" / "eval_ask.py")
eval_ask = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(eval_ask)

# 每題的標準答案怎麼從資料算出來；回傳的值要出現在題目的 names／keywords／numbers 裡
GOLD_SQL = {
    "D03": """SELECT sum(amount) FILTER (WHERE month >= '2026-08-01'), sum(amount) FILTER (WHERE month >= '2026-05-01' AND month < '2026-08-01')
              FROM v_monthly_sales WHERE customer_name = '康泰連鎖藥局 · 忠孝店' AND sku = 'HS-FO30'""",
    "D04": """SELECT customer_name FROM v_monthly_sales GROUP BY customer_name
              ORDER BY sum(amount) FILTER (WHERE month = '2026-08-01') - sum(amount) FILTER (WHERE month = '2026-09-01') DESC NULLS LAST LIMIT 1""",
    "D05": "SELECT customer_name, ar_max_age_days FROM v_customer_summary ORDER BY ar_max_age_days DESC NULLS LAST LIMIT 1",
    "D06": "SELECT amount_last_90d FROM v_customer_summary WHERE customer_name = '康泰連鎖藥局 · 忠孝店'",
    "D07": "SELECT count(*) FROM v_customer_summary WHERE region = '北區' AND customer_type = 'chain'",
    "D08": "SELECT category FROM v_margin_breakdown GROUP BY category ORDER BY sum(net_margin) / sum(revenue) LIMIT 1",
    "D09": "SELECT count(*) FROM v_visit_signal WHERE competitor_names LIKE '%御松田%' AND visit_date > app_today() - 90",
    "D10": "SELECT sum(amount) FROM v_monthly_sales WHERE region = '南區' AND category = '保健品' AND month = '2026-09-01'",
}


@pytest.mark.parametrize("question_id", sorted(GOLD_SQL))
def test_gold_answer_still_matches_the_data(db, question_id):
    item = ITEMS[question_id]
    values = db.execute(text(GOLD_SQL[question_id])).one()
    answer_text = " ".join(str(v) for v in values)
    assert eval_ask.score_data(item, answer_text) == [], (question_id, values)


def test_scoring_understands_wan_and_punctuation():
    item = {"names": ["德安藥局逢甲"], "min_names": 1, "numbers": [369432]}
    assert eval_ask.score_data(item, "德安藥局（逢甲）近 90 天進貨約 36.9 萬元") == []
    assert eval_ask.score_data(item, "康泰忠孝店約 30 萬元") != []
