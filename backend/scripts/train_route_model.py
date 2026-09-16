"""訓練今日路線的排序模型，權重寫進 backend/app/resources/route_model.json。

    uv run --project backend python backend/scripts/train_route_model.py

資料是資料庫裡的拜訪紀錄：每一筆算出「出門前就知道的」六個特徵，標籤是那次拜訪有沒有留下
競品、客訴、下單意向或承諾。重灌假資料之後要重跑一次，不然權重還是舊資料學到的。
"""

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.db import session_factory  # noqa: E402
from app.models import Visit  # noqa: E402
from app.services import route_model  # noqa: E402

# 最後四分之一的拜訪當測試期。照時間切而不是隨機切，才貼近上線後「拿過去的資料預測以後」的情形
TEST_RATIO = 0.25
EPOCHS = 600
LEARNING_RATE = 0.3
# L2 正則化：資料只有五千多筆、正例約一成，不加的話權重容易被少數極端客戶帶著跑
L2 = 0.001
CONTENT_KEYS = ("competitor", "complaint", "intent", "commitment")


def load_rows(session):
    """每次拜訪一列：(日期, 特徵, 有沒有收穫)。特徵用拜訪當天早上的狀態算。"""
    visits = session.execute(select(Visit.customer_id, Visit.visited_at, Visit.fields_final)).all()
    by_day = defaultdict(list)
    for customer_id, visited_at, fields in visits:
        by_day[visited_at.date()].append((customer_id, fields or {}))
    rows = []
    for day in sorted(by_day):
        features = {c.customer_id: c.features for c in route_model.candidates(session, day)}
        for customer_id, fields in by_day[day]:
            if customer_id in features:
                label = 1 if any(fields.get(k) for k in CONTENT_KEYS) else 0
                rows.append((day, features[customer_id], label))
    return rows


def fit(rows):
    names = list(route_model.FEATURES)
    mean = {k: sum(f[k] for _, f, _ in rows) / len(rows) for k in names}
    sd = {k: (sum((f[k] - mean[k]) ** 2 for _, f, _ in rows) / len(rows)) ** 0.5 or 1.0 for k in names}
    x = [[(f[k] - mean[k]) / sd[k] for k in names] for _, f, _ in rows]
    y = [label for _, _, label in rows]
    w = [0.0] * len(names)
    bias = 0.0
    for _ in range(EPOCHS):
        gw = [0.0] * len(names)
        gb = 0.0
        for xi, yi in zip(x, y):
            p = 1 / (1 + math.exp(-(sum(wj * v for wj, v in zip(w, xi)) + bias)))
            err = p - yi
            gb += err
            for j, v in enumerate(xi):
                gw[j] += err * v
        for j in range(len(names)):
            w[j] -= LEARNING_RATE * (gw[j] / len(x) + L2 * w[j])
        bias -= LEARNING_RATE * gb / len(x)
    return {"mean": mean, "sd": sd, "weights": dict(zip(names, w)), "bias": bias}


def auc(scored):
    """scored 是 [(分數, 標籤)]。回傳隨機抓一個有收穫與一個沒收穫的拜訪，前者分數較高的機率。"""
    pos = sorted(s for s, label in scored if label)
    neg = sorted(s for s, label in scored if not label)
    if not pos or not neg:
        return float("nan")
    import bisect

    total = sum(bisect.bisect_left(neg, s) + (bisect.bisect_right(neg, s) - bisect.bisect_left(neg, s)) / 2 for s in pos)
    return total / (len(pos) * len(neg))


def quintile_hit_rates(scored):
    """按分數排序切五等分，每一等有收穫的比例。給決賽解釋模型有沒有用。"""
    ordered = sorted(scored, key=lambda sl: sl[0], reverse=True)
    size = len(ordered) // 5
    return [sum(label for _, label in ordered[i * size:(i + 1) * size]) / size for i in range(5)]


def main() -> None:
    with session_factory()() as session:
        rows = load_rows(session)
        if not rows:
            print("資料庫裡沒有拜訪紀錄，先灌假資料")
            return
        rows.sort(key=lambda r: r[0])
        split = int(len(rows) * (1 - TEST_RATIO))
        train, test = rows[:split], rows[split:]
        model = fit(train)

        model_scored = [(route_model.score(f, model), label) for _, f, label in test]
        # 對照組：現行規則（距上次拜訪幾倍 × 等級權重），也就是不學習時的排法
        rule_scored = [(f["visit_gap"] * f["grade_weight"], label) for _, f, label in test]
        metrics = {
            "trained_rows": len(train),
            "test_rows": len(test),
            "test_positive_rate": sum(label for _, _, label in test) / len(test),
            "auc": auc(model_scored),
            "rule_auc": auc(rule_scored),
            "quintile_hit_rates": quintile_hit_rates(model_scored),
            "train_period": [str(train[0][0]), str(train[-1][0])],
            "test_period": [str(test[0][0]), str(test[-1][0])],
        }

    payload = {**model, "features": list(route_model.FEATURES), "metrics": metrics}
    route_model.MODEL_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"訓練 {len(train)} 筆（{metrics['train_period'][0]}～{metrics['train_period'][1]}），"
          f"測試 {len(test)} 筆（{metrics['test_period'][0]}～{metrics['test_period'][1]}）")
    print(f"測試期有收穫的比例 {metrics['test_positive_rate']:.1%}")
    print(f"AUC 模型 {metrics['auc']:.3f} / 現行規則 {metrics['rule_auc']:.3f}")
    print("分數由高到低切五等分，每等有收穫的比例：" + "、".join(f"{v:.1%}" for v in metrics["quintile_hit_rates"]))
    for name, value in sorted(model["weights"].items(), key=lambda kv: -abs(kv[1])):
        print(f"  {name:20s} {value:+.3f}")
    print(f"權重寫進 {route_model.MODEL_FILE}")


if __name__ == "__main__":
    main()
