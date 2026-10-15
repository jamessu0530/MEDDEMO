"""AI 與促銷頁共用折扣基準：各商品類別取最高，保留並列的每一口。"""

import datetime as dt

from app.services.data_agent import answer_data
from app.services.scope import Scope
from app.services.sql_executor import run_readonly

BEST_SQL = """
WITH ranked AS (
    SELECT promotion_name, category, group_name, item_name, item_code, deal,
           deal_price, unit_deal_price, ship_price, discount_rate,
           DENSE_RANK() OVER (PARTITION BY category ORDER BY discount_rate DESC) AS position
    FROM v_promotion_item WHERE status = '進行中'
)
SELECT category, item_name, discount_rate * 100 AS discount_percent
FROM ranked WHERE position = 1 ORDER BY category, item_name
"""


def test_each_category_returns_all_tied_best_offers_with_the_shipping_price_baseline(engine):
    result = run_readonly(engine, BEST_SQL, Scope(path="TW.N.M01.U01"))
    assert result.truncated is False
    # 資料庫的排序語系可能忽略括號／空白；此處驗證所有並列品項及數值。
    assert sorted(result.rows) == sorted([
        ["一般用藥", "LISIM NAIL (灰指甲-2入)", 42.11],
        ["一般用藥", "LISIM NAIL 灰指甲", 42.11],
        ["保健品", "SL葡萄籽光采精萃_60CAP/BTL_A", 50.0],
        ["醫材", "AP磁王磁力貼", 28.57],
    ])


def test_the_data_agent_receives_and_returns_the_promotion_comparison_evidence(engine):
    class PromotionLLM:
        calls = 0

        def json(self, *, system, prompt, **kwargs):
            assert "v_promotion_item" in system and "discount_rate" in system
            assert "DENSE_RANK()" in system and "並列" in system
            self.calls += 1
            if self.calls == 1:
                return {"action": "query", "reason": "比較這一期各商品類別的折扣", "sql": BEST_SQL, "answer": None}
            # 第二輪真的收到查詢資料，不是只測模型預先寫好的結論。
            assert "LISIM NAIL" in prompt and "42.11" in prompt and "50.0" in prompt
            return {"action": "answer", "reason": "查到各類別最高與並列品項", "sql": None,
                    "answer": "一般用藥是 LISIM NAIL 灰指甲與兩入組並列省 42.11%；保健品葡萄籽省 50%；醫材磁力貼省 28.57%，皆相較原出貨價。"}

    trace = []
    result = answer_data(
        engine, PromotionLLM(), "這個月各類別哪個販促的打折比例最多？", dt.date(2026, 10, 28),
        lambda number, step, **fields: trace.append((step, fields)), Scope(path="TW.N.M01.U01"),
    )
    assert result.status == "answered"
    assert [step for step, _ in trace] == ["sql", "answer"]
    assert len(result.evidence["rows"]) == 4
    assert result.evidence["columns"] == ["category", "item_name", "discount_percent"]
