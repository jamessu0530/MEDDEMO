"""logistic regression 的訓練、預測與 AUC：純 Python 實作，不用額外套件。

今日路線（scripts/train_route_model.py）與簽核（scripts/train_approval_model.py）兩支訓練程式共用。
資料都只有幾千筆、特徵不到十個，整批梯度下降跑幾百輪就收斂，不需要 numpy。
"""

from __future__ import annotations

import bisect
import math
from typing import Any

EPOCHS = 600
LEARNING_RATE = 0.3
# L2 正則化：資料只有幾千筆、正例比例懸殊時，不加的話權重容易被少數極端的樣本帶著跑
L2 = 0.001


def fit(
    rows: list[tuple[dict[str, float], int]],
    names: list[str],
    *,
    epochs: int = EPOCHS,
    learning_rate: float = LEARNING_RATE,
    l2: float = L2,
) -> dict[str, Any]:
    """rows 是 [(特徵, 標籤 0 或 1)]。特徵先標準化再訓練，平均與標準差一起回傳，預測時要用同一組。"""
    mean = {k: sum(f[k] for f, _ in rows) / len(rows) for k in names}
    # 整欄都一樣的特徵標準差是 0，除下去會出錯；當成 1，標準化之後整欄都是 0、不影響結果
    sd = {k: (sum((f[k] - mean[k]) ** 2 for f, _ in rows) / len(rows)) ** 0.5 or 1.0 for k in names}
    x = [[(f[k] - mean[k]) / sd[k] for k in names] for f, _ in rows]
    y = [label for _, label in rows]
    w = [0.0] * len(names)
    bias = 0.0
    for _ in range(epochs):
        gw = [0.0] * len(names)
        gb = 0.0
        for xi, yi in zip(x, y):
            p = 1 / (1 + math.exp(-(sum(wj * v for wj, v in zip(w, xi)) + bias)))
            err = p - yi
            gb += err
            for j, v in enumerate(xi):
                gw[j] += err * v
        for j in range(len(names)):
            w[j] -= learning_rate * (gw[j] / len(x) + l2 * w[j])
        bias -= learning_rate * gb / len(x)
    return {"mean": mean, "sd": sd, "weights": dict(zip(names, w)), "bias": bias}


def predict(features: dict[str, float], model: dict[str, Any], names: list[str]) -> float:
    """模型算出的機率。少了任何一個特徵會丟 KeyError，由呼叫端決定要不要當成沒有模型。"""
    total = model["bias"] + sum(
        model["weights"][k] * (features[k] - model["mean"][k]) / model["sd"][k] for k in names
    )
    return 1 / (1 + math.exp(-total))


def auc(scored: list[tuple[float, int]]) -> float:
    """scored 是 [(分數, 標籤)]。回傳隨機抓一個正例與一個負例，正例分數較高的機率；同分算一半。"""
    pos = sorted(s for s, label in scored if label)
    neg = sorted(s for s, label in scored if not label)
    if not pos or not neg:
        return float("nan")
    total = sum(bisect.bisect_left(neg, s) + (bisect.bisect_right(neg, s) - bisect.bisect_left(neg, s)) / 2 for s in pos)
    return total / (len(pos) * len(neg))
