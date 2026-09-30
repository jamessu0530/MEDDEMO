"""共用的 logistic regression：今日路線與簽核兩支訓練程式都用它。"""

import math
import random

from app.services import logreg


def test_fit_learns_the_direction_of_a_feature():
    # 人造資料：x 越大越容易是 1，noise 跟結果無關
    rng = random.Random(7)
    rows = []
    for _ in range(400):
        x, noise = rng.uniform(-2, 2), rng.uniform(-2, 2)
        rows.append(({"x": x, "noise": noise}, 1 if rng.random() < 1 / (1 + math.exp(-2.5 * x)) else 0))
    names = ["x", "noise"]
    model = logreg.fit(rows, names)

    assert set(model) == {"mean", "sd", "weights", "bias"}
    assert model["weights"]["x"] > 1
    assert abs(model["weights"]["noise"]) < 0.3
    scored = [(logreg.predict(features, model, names), label) for features, label in rows]
    assert logreg.auc(scored) > 0.8
    assert logreg.predict({"x": 2, "noise": 0}, model, names) > 0.9 > 0.1 > logreg.predict({"x": -2, "noise": 0}, model, names)


def test_a_feature_that_never_varies_does_not_divide_by_zero():
    rows = [({"x": float(i % 2), "same": 5.0}, i % 2) for i in range(20)]
    model = logreg.fit(rows, ["x", "same"], epochs=50)
    assert model["sd"]["same"] == 1.0
    assert 0 < logreg.predict({"x": 1.0, "same": 5.0}, model, ["x", "same"]) < 1


def test_auc_is_the_chance_a_positive_outranks_a_negative():
    assert logreg.auc([(0.9, 1), (0.8, 1), (0.2, 0), (0.1, 0)]) == 1.0
    assert logreg.auc([(0.1, 1), (0.2, 1), (0.8, 0), (0.9, 0)]) == 0.0
    # 同分算一半
    assert logreg.auc([(0.5, 1), (0.5, 0)]) == 0.5
    assert logreg.auc([(0.7, 1), (0.5, 1), (0.5, 0), (0.3, 0)]) == 0.875
    # 只有一種結果算不出來
    assert math.isnan(logreg.auc([(0.5, 1), (0.6, 1)]))
