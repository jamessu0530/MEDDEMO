"""訓練優惠與合約的簽核模型，權重寫進 backend/app/resources/approval_model.json。

    uv run --project backend python backend/scripts/train_approval_model.py

資料是資料庫裡已經有結果的優惠與合約申請單：特徵用送單當下存在單上的那一份，標籤是核准（1）或駁回、退回（0）。
系統核准的單不算：那是模型自己的判斷，不是人的。人簽過的新單會自動變成下一次訓練的資料，
但不會自動重新訓練，要更新模型就重跑這支程式。
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.db import session_factory  # noqa: E402
from app.models import OaExpenseForm  # noqa: E402
from app.services import approvals, customer_profile, logreg  # noqa: E402

# 最後四分之一的申請單當測試期，照時間切（跟今日路線的模型一樣）
TEST_RATIO = 0.25
# 門檻從低到高試：挑最低、測試期上「模型說會過的真的有過」至少 95%、而且至少有 20 張的那一個。
# 都達不到就不訂門檻，那一種申請不做系統核准
THRESHOLDS = (0.80, 0.85, 0.90, 0.95)
MIN_PRECISION = 0.95
MIN_APPROVED = 20
KIND_LABEL = {"discount": "優惠", "contract": "合約"}


def load_rows(session, kind):
    """每張有結果的申請單一列：(申請日, 特徵, 有沒有核准, 規則上能不能由系統核准)。"""
    forms = session.scalars(
        select(OaExpenseForm)
        .where(
            OaExpenseForm.kind == kind,
            OaExpenseForm.status.in_(("approved", "rejected", "returned")),
            OaExpenseForm.auto_approved.is_(False),
        )
        .order_by(OaExpenseForm.request_date, OaExpenseForm.created_at, OaExpenseForm.id)
    ).all()
    names = approvals.FEATURES[kind]
    rows = []
    for form in forms:
        features = form.model_features or {}
        # 特徵不齊的單（例如之後加了新特徵、舊單上沒有）不拿來訓練
        if any(name not in features for name in names):
            continue
        # 系統核准只碰規則上最高到區處主管、客戶帳款沒有超過 60 天的單，門檻也只在這些單上挑
        eligible = form.required_level == "manager" and features["ar_age_days"] <= customer_profile.AR_WATCH_DAYS
        rows.append((form.request_date, features, 1 if form.status == "approved" else 0, eligible, form.required_level))
    return rows


def pick_threshold(scored):
    """scored 是測試期上規則允許系統核准的單：[(機率, 有沒有核准)]。
    回傳（門檻, 各個門檻的張數與命中率）；沒有一個門檻達標，門檻就是 None。"""
    table = []
    chosen = None
    for threshold in THRESHOLDS:
        hits = [label for probability, label in scored if probability >= threshold]
        precision = sum(hits) / len(hits) if hits else None
        table.append({"threshold": threshold, "approved": len(hits), "precision": precision})
        if chosen is None and len(hits) >= MIN_APPROVED and precision >= MIN_PRECISION:
            chosen = threshold
    return chosen, table


def train(rows, kind):
    names = list(approvals.FEATURES[kind])
    split = int(len(rows) * (1 - TEST_RATIO))
    train_rows, test_rows = rows[:split], rows[split:]
    model = logreg.fit([(features, label) for _, features, label, _, _ in train_rows], names)
    scored = [(logreg.predict(features, model, names), label, eligible, level) for _, features, label, eligible, level in test_rows]
    eligible = [(p, label) for p, label, allowed, _ in scored if allowed]
    threshold, table = pick_threshold(eligible)
    chosen = next((row for row in table if row["threshold"] == threshold), None)
    manager_level = [item for item in scored if item[3] == "manager"]
    # 門檻以下、改送人簽的單（沒有門檻就是全部），以及其中主管本來會核准的
    deferred = [label for p, label in eligible if threshold is None or p < threshold]
    metrics = {
        # 全部測試單的 AUC。裡面有一大塊是規則本身就分得開的（深折扣、帳款拖很久），所以會比模型真正在用的那一群高
        "auc": logreg.auc([(p, label) for p, label, _, _ in scored]),
        # 模型真正在作用的那一群：規則允許系統核准的（主管級、帳款沒超過 60 天）
        "eligible_rows": len(eligible),
        "eligible_auc": logreg.auc(eligible),
        # 不用模型、規則允許的全部核准時，有過的比例：模型的命中率要跟這個比
        "baseline_precision": sum(label for _, label in eligible) / len(eligible) if eligible else None,
        "deferred": len(deferred),
        "deferred_approved": sum(deferred),
        # 門檻上「模型說會過的真的有過」的比例，以及那是幾張
        "precision_at_threshold": chosen["precision"] if chosen else None,
        "approved_at_threshold": chosen["approved"] if chosen else 0,
        # 測試期的主管級申請有幾成會由系統核准（其餘照舊送區處主管）
        "auto_share": chosen["approved"] / len(manager_level) if chosen and manager_level else 0,
        "train_rows": len(train_rows),
        "test_rows": len(test_rows),
        "test_approval_rate": sum(label for _, label, _, _ in scored) / len(scored),
        "test_manager_rows": len(manager_level),
        "thresholds": table,
        "train_period": [str(train_rows[0][0]), str(train_rows[-1][0])],
        "test_period": [str(test_rows[0][0]), str(test_rows[-1][0])],
    }
    return {"features": names, **model, "threshold": threshold, "metrics": metrics}


def report(kind, model):
    metrics = model["metrics"]
    print(f"【{KIND_LABEL[kind]}】訓練 {metrics['train_rows']} 張（{metrics['train_period'][0]}～{metrics['train_period'][1]}），"
          f"測試 {metrics['test_rows']} 張（{metrics['test_period'][0]}～{metrics['test_period'][1]}）")
    print(f"  測試期核准的比例 {metrics['test_approval_rate']:.1%}，AUC {metrics['auc']:.3f}（全部測試單）")
    print(f"  測試期主管級的申請 {metrics['test_manager_rows']} 張，其中規則允許系統核准的（帳款沒有超過 60 天）"
          f" {metrics['eligible_rows']} 張：AUC {metrics['eligible_auc']:.3f}；不用模型、全部核准的話有過的比例 {metrics['baseline_precision']:.1%}")
    print("  各門檻上模型說會過的張數與真的有過的比例（只算規則允許系統核准的）：")
    for row in metrics["thresholds"]:
        precision = "—" if row["precision"] is None else f"{row['precision']:.1%}"
        print(f"    {row['threshold']:.2f}：{row['approved']:3d} 張，{precision}")
    if model["threshold"] is None:
        print(f"  沒有一個門檻達到「命中率 {MIN_PRECISION:.0%}、至少 {MIN_APPROVED} 張」：不訂門檻，這一種申請不做系統核准")
    else:
        print(f"  門檻 {model['threshold']:.2f}：命中率 {metrics['precision_at_threshold']:.1%}（{metrics['approved_at_threshold']} 張），"
              f"主管級的申請有 {metrics['auto_share']:.1%} 會由系統核准")
        print(f"  代價：門檻以下改送人簽的 {metrics['deferred']} 張裡，{metrics['deferred_approved']} 張主管本來會核准")
    for name, value in sorted(model["weights"].items(), key=lambda kv: -abs(kv[1])):
        print(f"  {name:20s} {value:+.3f}")


def main() -> None:
    payload = {}
    with session_factory()() as session:
        for kind in approvals.FEATURES:
            rows = load_rows(session, kind)
            if len(rows) < 2 * MIN_APPROVED:
                print(f"資料庫裡有結果的{KIND_LABEL[kind]}申請單只有 {len(rows)} 張，先灌假資料")
                return
            payload[kind] = train(rows, kind)
            report(kind, payload[kind])
    approvals.MODEL_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"權重寫進 {approvals.MODEL_FILE}")


if __name__ == "__main__":
    main()
