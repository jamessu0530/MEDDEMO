"""今日路線的排序模型：從拜訪紀錄學「哪種狀態的客戶，去了比較有收穫」。

特徵都是出門前就知道的事（進貨、帳款、合約、上次拜訪），標籤是那次拜訪有沒有留下
競品、客訴、下單意向或承諾。模型是 logistic regression，權重存在 resources/route_model.json，
用 backend/scripts/train_route_model.py 重新訓練。

特徵的定義跟假資料產生器（data/seed/generate.py 的 customer_features）是同一組，改了要兩邊一起改。
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

MODEL_FILE = Path(__file__).resolve().parents[1] / "resources" / "route_model.json"

# 各等級大約幾天拜訪一次，用來把「距上次幾天」換算成「拖了幾倍」。跟假資料的排程同一組數字
VISIT_GAP_BY_GRADE = {"A": 12, "B": 17, "C": 32}
# 合約剩多久算「開始要談續約」。內部文件寫的是 3 個月，這裡用兩倍當斜坡的起點，分數才是連續的
CONTRACT_HORIZON_DAYS = 180
# 這家客戶沒有進貨紀錄可算間隔時的替代值
DEFAULT_ORDER_GAP = 30

FEATURES = ("interval_change", "visit_gap", "order_gap", "ar_age_days", "contract_soon", "grade_weight")
GRADE_WEIGHT = {"A": 3.0, "B": 2.0, "C": 1.0}

# 每個特徵對應的提醒類型，用來說明「為什麼排這家」。順序就是同分時的優先順序
SIGNAL_BY_FEATURE = {
    "ar_age_days": "ar",
    "interval_change": "interval",
    "order_gap": "order",
    "contract_soon": "contract",
    "visit_gap": "visit",
}

_FEATURE_SQL = text("""
WITH order_days AS (
    SELECT DISTINCT customer_id, date FROM sales_transaction WHERE date < :as_of
), gaps AS (
    SELECT customer_id, date,
           date - lag(date) OVER (PARTITION BY customer_id ORDER BY date) AS gap
    FROM order_days
), orders AS (
    SELECT customer_id,
           max(date) AS last_order_date,
           avg(gap) FILTER (WHERE date > :as_of - 90) AS gap_now,
           avg(gap) FILTER (WHERE date <= :as_of - 90 AND date > :as_of - 180) AS gap_before
    FROM gaps GROUP BY customer_id
), visits AS (
    SELECT customer_id, max((visited_at AT TIME ZONE 'Asia/Taipei')::date) AS last_visit_date
    FROM visit WHERE (visited_at AT TIME ZONE 'Asia/Taipei')::date < :as_of GROUP BY customer_id
), ar AS (
    SELECT customer_id, max(:as_of - invoice_date) AS ar_age_days
    FROM receivable
    WHERE invoice_date <= :as_of AND (paid_date IS NULL OR paid_date > :as_of)
    GROUP BY customer_id
)
SELECT c.id, c.name, c.type, c.grade, c.chain_group, c.owner_user_id,
       c.contract_end_date, o.last_order_date, o.gap_now, o.gap_before,
       v.last_visit_date, COALESCE(ar.ar_age_days, 0) AS ar_age_days
FROM customer c
LEFT JOIN orders o ON o.customer_id = c.id
LEFT JOIN visits v ON v.customer_id = c.id
LEFT JOIN ar ON ar.customer_id = c.id
-- 明寫型別：參數是 NULL 時 Postgres 推不出型別
WHERE (CAST(:owner_id AS text) IS NULL OR c.owner_user_id = CAST(:owner_id AS text))
""")


@dataclass
class Candidate:
    """一家客戶在某一天的狀態，以及算出來的特徵。"""

    customer_id: str
    name: str
    type: str
    grade: str
    chain_group: str | None
    owner_user_id: str
    last_visit_date: date | None
    last_order_date: date | None
    interval_now: float | None
    interval_before: float | None
    ar_age_days: int
    contract_days_left: int | None
    features: dict[str, float]


def candidates(session: Session, as_of: date, owner_id: str | None = None) -> list[Candidate]:
    """某一天、某位業務名下所有客戶的狀態與特徵。owner_id 留空就是全部客戶（訓練用）。"""
    rows = session.execute(_FEATURE_SQL, {"as_of": as_of, "owner_id": owner_id}).mappings().all()
    out = []
    for r in rows:
        gap_now = float(r["gap_now"]) if r["gap_now"] is not None else None
        gap_before = float(r["gap_before"]) if r["gap_before"] is not None else None
        typical_gap = gap_before or gap_now or DEFAULT_ORDER_GAP
        contract_left = (r["contract_end_date"] - as_of).days if r["contract_end_date"] else None
        # 沒有拜訪紀錄的客戶當作剛好照正常間隔來，不給它「拖太久」的加成
        visit_gap_days = (as_of - r["last_visit_date"]).days if r["last_visit_date"] else VISIT_GAP_BY_GRADE[r["grade"]]
        order_gap_days = (as_of - r["last_order_date"]).days if r["last_order_date"] else typical_gap
        features = {
            "interval_change": gap_now / gap_before - 1 if gap_now and gap_before else 0.0,
            "visit_gap": visit_gap_days / VISIT_GAP_BY_GRADE[r["grade"]],
            "order_gap": order_gap_days / typical_gap,
            "ar_age_days": float(r["ar_age_days"]),
            "contract_soon": max(0.0, 1 - contract_left / CONTRACT_HORIZON_DAYS) if contract_left is not None else 0.0,
            "grade_weight": GRADE_WEIGHT[r["grade"]],
        }
        out.append(Candidate(
            customer_id=r["id"], name=r["name"], type=r["type"], grade=r["grade"],
            chain_group=r["chain_group"], owner_user_id=r["owner_user_id"],
            last_visit_date=r["last_visit_date"], last_order_date=r["last_order_date"],
            interval_now=gap_now, interval_before=gap_before, ar_age_days=int(r["ar_age_days"]),
            contract_days_left=contract_left, features=features,
        ))
    return out


def load_model() -> dict[str, Any] | None:
    """讀訓練好的權重。檔案不在（例如還沒訓練過）就回 None，呼叫端改用規則排序。"""
    if not MODEL_FILE.exists():
        return None
    return json.loads(MODEL_FILE.read_text(encoding="utf-8"))


def standardize(features: dict[str, float], model: dict[str, Any]) -> dict[str, float]:
    return {k: (features[k] - model["mean"][k]) / model["sd"][k] for k in FEATURES}


def score(features: dict[str, float], model: dict[str, Any]) -> float:
    """模型算出的機率：這次去，會不會留下競品、客訴、意向或承諾。"""
    z = standardize(features, model)
    total = model["bias"] + sum(model["weights"][k] * z[k] for k in FEATURES)
    return 1 / (1 + math.exp(-total))


def contributions(features: dict[str, float], model: dict[str, Any]) -> list[tuple[str, float]]:
    """每個特徵把分數往上推了多少，由大到小。用來說明「為什麼排這家」。"""
    z = standardize(features, model)
    items = [(k, model["weights"][k] * z[k]) for k in FEATURES]
    return sorted(items, key=lambda kv: kv[1], reverse=True)


def rule_score(candidate: Candidate) -> float:
    """沒有模型時的排序：距上次拜訪幾倍 × 等級權重，跟假資料排拜訪的規則一樣。"""
    return candidate.features["visit_gap"] * candidate.features["grade_weight"]
