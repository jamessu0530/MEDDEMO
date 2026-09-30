"""優惠與合約簽核：規則決定最高簽到哪一級，模型決定區處主管這一級能不能免。

規則照內部文件（data/documents/04-報價權限.md、05-上架費與通路獎勵.md）。超過主管權限的單一律送人，模型不碰；
規則上主管就能簽的單，模型估計的核准機率過了門檻、客戶又沒有拖太久的帳款，才由系統直接核准。

模型是 logistic regression，權重存在 resources/approval_model.json，用 backend/scripts/train_approval_model.py
重新訓練。特徵在送單當下算好存在單上，之後不回頭改；訓練讀的就是單上那一份。

特徵的定義跟假資料產生器（data/seed/generate.py 的 approval_state、discount_features、contract_features）
是同一組，改了要兩邊一起改，test_approvals.py 會抽歷史單比對。
"""

from __future__ import annotations

import calendar
import datetime as dt
import json
import logging
import math
from pathlib import Path
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import (
    AppUser,
    Customer,
    OaActivity,
    OaApprovalStep,
    OaExpenseForm,
    SalesTransaction,
    SapQuotationDraft,
    Visit,
)
from app.services import customer_profile, logreg, oa, route_model
from app.timeutil import TAIPEI

log = logging.getLogger(__name__)

MODEL_FILE = Path(__file__).resolve().parents[1] / "resources" / "approval_model.json"

# 《報價權限與折扣審核》：業務自己 3%、區處主管 8%、業務處長 12%，再上去總經理。
# 文件沒有寫上限；這裡收到 20% 為止，再深的折扣不是一張報價單該談的事
DISCOUNT_FREE = 3.0
DISCOUNT_MANAGER = 8.0
DISCOUNT_DIRECTOR = 12.0
DISCOUNT_MAX = 20.0
# 折扣每 0.5% 一格
DISCOUNT_STEP = 0.5
# 續約可以選的月數
CONTRACT_TERMS = (12, 24)

# 每一級要經過哪幾關。業務處長、總經理在系統裡沒有帳號，這兩關指派給根節點的 IT 帳號
LEVEL_STEPS = {"manager": ("manager",), "director": ("manager", "director"), "gm": ("manager", "director", "gm")}
STEP_TITLE = {"manager": "區處主管", "director": "業務處長", "gm": "總經理"}
# 區處主管那一關沿用出差單的關卡名稱：業務換主管時，還沒簽的這一關跟著改指派（services/org_admin.py）
STEP_ROLE_LABEL = {"manager": oa.MANAGER_STEP_LABEL, "director": "業務處長", "gm": "總經理"}
AUTO_STEP_LABEL = "系統核准"
PURPOSE = {"discount": "報價折扣", "contract": "連鎖續約"}

# 客戶狀態看近 90 天，跟客戶檔案、談判卡同一個時間窗
STATE_DAYS = customer_profile.RECENT_DAYS

DISCOUNT_FEATURES = (
    "discount_pct", "margin_after", "log_amount", "log_sales_90d", "ar_age_days", "competitor_recent", "grade_weight",
)
CONTRACT_FEATURES = (
    "fee_change", "term_years", "net_margin", "log_sales_90d", "interval_change", "ar_age_days", "grade_weight",
)
FEATURES = {"discount": DISCOUNT_FEATURES, "contract": CONTRACT_FEATURES}


# ── 規則：誰要簽 ───────────────────────────────────────────────────


def discount_level(pct: float) -> str | None:
    """這個折扣最高要簽到哪一級。None 是業務自己的權限，不用開單。"""
    if not 0 <= pct <= DISCOUNT_MAX:
        raise ValueError(f"折扣要在 0～{DISCOUNT_MAX:g}% 之間")
    if pct <= DISCOUNT_FREE:
        return None
    if pct <= DISCOUNT_MANAGER:
        return "manager"
    return "director" if pct <= DISCOUNT_DIRECTOR else "gm"


def contract_level(listing_from: float, listing_to: float, reward_from: float, reward_to: float) -> str:
    """照原費率續約由區處主管核准；上架費率或通路獎勵比率有任何調整，都要再送業務處長。"""
    return "manager" if (listing_from, reward_from) == (listing_to, reward_to) else "director"


# ── 客戶狀態與特徵 ─────────────────────────────────────────────────


def customer_state(session: Session, customer: Customer, as_of: dt.date) -> dict[str, float]:
    """某一天早上這家客戶的狀態，優惠與合約的特徵都從這裡取。

    進貨間隔與帳齡直接用今日路線那一份（route_model.candidates）；進貨金額、淨毛利、競品的時間窗跟客戶檔案一樣。
    """
    since = as_of - dt.timedelta(days=STATE_DAYS)
    revenue, cost, listing, reward = (
        float(value)
        for value in session.execute(
            select(
                func.coalesce(func.sum(SalesTransaction.amount), 0),
                func.coalesce(func.sum(SalesTransaction.cost), 0),
                func.coalesce(func.sum(SalesTransaction.listing_fee), 0),
                func.coalesce(func.sum(SalesTransaction.channel_reward), 0),
            ).where(
                SalesTransaction.customer_id == customer.id, SalesTransaction.date > since, SalesTransaction.date < as_of
            )
        ).one()
    )
    candidate = next(
        c for c in route_model.candidates(session, as_of, owner_id=customer.owner_user_id) if c.customer_id == customer.id
    )
    # 已確認的拜訪有沒有提到競品。送單當天的拜訪也算：剛聽到競品開價就回來申請折扣，是最常見的情形
    visits = session.scalars(
        select(Visit.fields_final).where(
            Visit.customer_id == customer.id,
            Visit.status.in_(customer_profile.CONFIRMED),
            Visit.visited_at >= dt.datetime.combine(since, dt.time.min, TAIPEI),
            Visit.visited_at < dt.datetime.combine(as_of + dt.timedelta(days=1), dt.time.min, TAIPEI),
        )
    )
    return {
        "sales_90d": revenue,
        # 淨毛利率用加總相除（《連鎖通路合約條件》），這段期間沒有進貨就當 0
        "net_margin": (revenue - cost - listing - reward) / revenue if revenue else 0.0,
        "interval_change": candidate.features["interval_change"],
        "ar_age_days": float(candidate.ar_age_days),
        "competitor_recent": 1.0 if any((fields or {}).get("competitor") for fields in visits) else 0.0,
        "grade_weight": route_model.GRADE_WEIGHT[customer.grade],
    }


def discount_features(state: dict[str, float], payload: dict[str, Any]) -> dict[str, float]:
    amount, cost = float(payload["amount"]), float(payload["cost"])
    return {
        "discount_pct": float(payload["discount_pct"]),
        # 折後毛利率＝（折後金額－成本）÷ 折後金額
        "margin_after": (amount - cost) / amount if amount else 0.0,
        # 金額取對數：一張二十萬的報價跟一張兩萬的差十倍，但對簽核的影響沒有差十倍
        "log_amount": math.log1p(amount),
        "log_sales_90d": math.log1p(state["sales_90d"]),
        "ar_age_days": state["ar_age_days"],
        "competitor_recent": state["competitor_recent"],
        "grade_weight": state["grade_weight"],
    }


def contract_features(state: dict[str, float], payload: dict[str, Any]) -> dict[str, float]:
    listing, reward = payload["listing_fee_rate"], payload["channel_reward_rate"]
    return {
        # 兩個費率合計變動幾個百分點，往上調（我們付給通路的變多）是正的
        "fee_change": round(((listing["to"] - listing["from"]) + (reward["to"] - reward["from"])) * 100, 4),
        "term_years": payload["term_months"] / 12,
        "net_margin": state["net_margin"],
        "log_sales_90d": math.log1p(state["sales_90d"]),
        "interval_change": state["interval_change"],
        "ar_age_days": state["ar_age_days"],
        "grade_weight": state["grade_weight"],
    }


# ── 模型 ───────────────────────────────────────────────────────────


def load_model() -> dict[str, Any] | None:
    """讀訓練好的權重。檔案不在或壞掉就回 None，所有單都照規則送人（跟今日路線沒有模型時改用規則一樣）。"""
    if not MODEL_FILE.exists():
        return None
    try:
        return json.loads(MODEL_FILE.read_text(encoding="utf-8"))
    except ValueError:
        log.warning("approval_model.json 讀不出來，當成沒有模型，所有申請照規則送人簽")
        return None


def estimate(kind: str, features: dict[str, float]) -> tuple[float | None, float | None]:
    """（模型估計的核准機率, 這一種申請的門檻）。沒有模型、模型檔裡沒有這一種申請、或少了某個特徵，
    機率就是 None；門檻是 None 代表這一種申請不做系統核准（訓練時達不到命中率的條件）。"""
    model = (load_model() or {}).get(kind)
    if not model:
        return None, None
    try:
        return logreg.predict(features, model, list(FEATURES[kind])), model.get("threshold")
    except (KeyError, TypeError, ZeroDivisionError, OverflowError) as exc:
        log.warning("approval_model.json 的 %s 模型算不出機率（%r），這張申請照規則送人簽", kind, exc)
        return None, None


def auto_detail(probability: float, threshold: float) -> str:
    """系統核准那一筆活動日誌的內容。機率最多寫到 99%：模型估的是機率，四捨五入成 100% 會像是在保證。"""
    return f"模型估計核准機率 {min(probability, 0.99):.0%}，高於門檻 {threshold:.0%}，系統核准"


# ── 送單 ───────────────────────────────────────────────────────────


def add_months(day: dt.date, months: int) -> dt.date:
    """往後加幾個月；落在比較短的月份就取那個月的最後一天（8/31 加 6 個月是 2/28）。"""
    index = day.year * 12 + day.month - 1 + months
    year, month = divmod(index, 12)
    return dt.date(year, month + 1, min(day.day, calendar.monthrange(year, month + 1)[1]))


def contract_terms(session: Session, customer: Customer, today: dt.date) -> dict[str, Any]:
    """目前的合約條件。系統沒有合約表，費率用近 90 天交易的加總相除算出來，跟談判卡的毛利結構同一個算法。"""
    since = today - dt.timedelta(days=STATE_DAYS)
    revenue, listing, reward = session.execute(
        select(
            func.sum(SalesTransaction.amount), func.sum(SalesTransaction.listing_fee), func.sum(SalesTransaction.channel_reward)
        ).where(SalesTransaction.customer_id == customer.id, SalesTransaction.date > since)
    ).one()
    end = customer.contract_end_date
    return {
        "contract_end_date": end,
        "days_left": (end - today).days if end else None,
        # 每筆交易的費用各自四捨五入到元，加總相除會差一點點；取到 0.1 個百分點就是合約上的費率
        "listing_fee_rate": round(float(listing) / float(revenue), 3) if revenue else 0.0,
        "channel_reward_rate": round(float(reward) / float(revenue), 3) if revenue else 0.0,
    }


def contract_payload(
    session: Session, customer: Customer, today: dt.date, *,
    term_months: int, listing_fee_rate: float, channel_reward_rate: float, reason: str,
) -> dict[str, Any]:
    """續約申請的內容：目前的費率與到期日由系統帶出，申請人只填新的條件。"""
    terms = contract_terms(session, customer, today)
    old_end = terms["contract_end_date"]
    # 合約已經過期的從系統日起算，還沒過期的接在原到期日後面
    start = max(old_end, today) if old_end else today
    return {
        "term_months": term_months,
        "listing_fee_rate": {"from": terms["listing_fee_rate"], "to": listing_fee_rate},
        "channel_reward_rate": {"from": terms["channel_reward_rate"], "to": channel_reward_rate},
        "old_end_date": old_end.isoformat() if old_end else None,
        "new_end_date": add_months(start, term_months).isoformat(),
        "reason": reason,
    }


def pending_contract(session: Session, customer_id: str) -> int | None:
    """這家客戶還沒簽完的合約申請。同一家同時只能有一張。"""
    return session.scalar(
        select(OaExpenseForm.id)
        .where(OaExpenseForm.kind == "contract", OaExpenseForm.customer_id == customer_id, OaExpenseForm.status == "pending")
        .order_by(OaExpenseForm.id)
        .limit(1)
    )


def signers(session: Session, applicant: AppUser) -> dict[str, AppUser]:
    """每一級由誰簽：區處主管是申請人的直屬主管（跟出差單一樣），業務處長與總經理是根節點的 IT 帳號。"""
    manager = session.get(AppUser, applicant.manager_id) if applicant.manager_id else None
    if manager is None:
        raise RuntimeError(f"{applicant.name} 沒有直屬主管，申請單送不出去")
    root = session.scalar(
        select(AppUser).where(AppUser.role == "it", AppUser.deactivated_at.is_(None)).order_by(AppUser.id).limit(1)
    )
    if root is None:
        raise RuntimeError("找不到 IT 帳號，業務處長與總經理兩關沒有人可以代簽")
    return {"manager": manager, "director": root, "gm": root}


def submit(session: Session, *, kind: str, applicant: AppUser, customer: Customer, payload: dict[str, Any]) -> OaExpenseForm:
    """開一張優惠或合約申請單：照規則建關卡、算特徵與機率，模型有把握就由系統核准並立刻套用效果。"""
    today = customer_profile.app_today(session)
    if kind == "discount":
        level = discount_level(payload["discount_pct"])
        if level is None:
            raise ValueError("這個折扣在業務的權限內，不用開申請單")
    else:
        listing, reward = payload["listing_fee_rate"], payload["channel_reward_rate"]
        level = contract_level(listing["from"], listing["to"], reward["from"], reward["to"])
    chain = signers(session, applicant)

    state = customer_state(session, customer, today)
    features = discount_features(state, payload) if kind == "discount" else contract_features(state, payload)
    probability, threshold = estimate(kind, features)
    # 四個條件都成立才由系統核准：規則上最高只到區處主管、這一種申請有訂出門檻、機率過門檻、
    # 客戶沒有超過 60 天的帳款。最後一條不交給模型：帳款出問題的客戶再給優惠，應該有人看過
    auto = (
        level == "manager"
        and threshold is not None
        and probability >= threshold
        and state["ar_age_days"] <= customer_profile.AR_WATCH_DAYS
    )

    now = dt.datetime.now(dt.UTC)
    form = OaExpenseForm(
        form_no=oa.next_form_no(session, oa.FORM_NO_PREFIX[kind], today),
        kind=kind,
        applicant_id=applicant.id,
        request_date=today,
        customer_id=customer.id,
        purpose=PURPOSE[kind],
        unit_name=customer.region,
        payload=payload,
        required_level=level,
        model_probability=probability,
        model_features=features,
        auto_approved=auto,
        status="approved" if auto else "pending",
        submitted_at=now,
    )
    session.add(form)
    session.flush()
    session.add(OaApprovalStep(
        form_id=form.id, step_no=1, role_label="請求者", user_id=applicant.id, title="業務", status="done", acted_at=now,
    ))
    session.add(OaActivity(form_id=form.id, action="submitted", actor_id=applicant.id, detail="經辦人送出"))
    if auto:
        session.add(OaApprovalStep(
            form_id=form.id, step_no=2, role_label=AUTO_STEP_LABEL, user_id=None, title="模型", status="done", acted_at=now,
        ))
        session.add(OaActivity(
            form_id=form.id, action="auto_approved", actor_id=None, detail=auto_detail(probability, threshold),
        ))
        session.flush()
        apply_outcome(session, form)
        return form
    # 關卡照規則一次建好：第二關等簽，後面的排隊
    for step_no, step in enumerate(LEVEL_STEPS[level], start=2):
        session.add(OaApprovalStep(
            form_id=form.id, step_no=step_no, role_label=STEP_ROLE_LABEL[step], user_id=chain[step].id,
            title=STEP_TITLE[step], status="pending" if step_no == 2 else "waiting",
        ))
    session.flush()
    return form


def apply_outcome(session: Session, form: OaExpenseForm) -> None:
    """整張單有結果之後的效果：最後一關核准、系統核准，或中途被駁回、退回。還在審核中的單不做事。"""
    if form.status == "pending":
        return
    approved = form.status == "approved"
    if form.kind == "discount":
        # 歷史與示範用的申請單沒有報價（quote_no 是 null）
        if quote_no := form.payload.get("quote_no"):
            session.execute(
                update(SapQuotationDraft)
                .where(SapQuotationDraft.quote_no == quote_no, SapQuotationDraft.status == "pending_approval")
                .values(status="draft" if approved else "rejected")
            )
    elif form.kind == "contract" and approved:
        # 新費率只記在申請單上：系統沒有合約表，交易的費率是假資料產生時定的，不回頭改
        customer = session.get(Customer, form.customer_id)
        customer.contract_end_date = dt.date.fromisoformat(form.payload["new_end_date"])


def approval_out(session: Session, form: OaExpenseForm) -> dict[str, Any]:
    """送出之後回給畫面的結果：核准了沒、是不是系統核准的、現在等誰簽。"""
    waiting = session.scalar(
        select(OaApprovalStep)
        .where(OaApprovalStep.form_id == form.id, OaApprovalStep.status == "pending")
        .order_by(OaApprovalStep.step_no)
    )
    return {
        "form_id": form.id,
        "form_no": form.form_no,
        "status": form.status,
        "auto_approved": form.auto_approved,
        "probability": form.model_probability,
        "waiting_for": {"step": waiting.title, "name": session.get(AppUser, waiting.user_id).name} if waiting else None,
    }


# ── 簽核頁上的理由 ─────────────────────────────────────────────────


def _percent(value: float) -> str:
    return f"{value:g}%"


def _ar_line(ar_age_days: float) -> dict[str, Any]:
    watch = customer_profile.AR_WATCH_DAYS
    if ar_age_days > watch:
        return {"text": f"帳款最久 {ar_age_days:.0f} 天，超過 {watch} 天", "alert": True}
    if ar_age_days > 0:
        return {"text": f"帳款最久 {ar_age_days:.0f} 天", "alert": False}
    return {"text": "沒有未收的帳款", "alert": False}


def reason_lines(form: OaExpenseForm) -> list[dict[str, Any]]:
    """簽核頁上列給主管看的事實，照門檻寫，alert 是要標紅的那一行。

    不用模型的特徵貢獻寫理由（今日路線說明過：貢獻值受標準化影響，會跟真正的原因對不上）。
    """
    payload, features = form.payload or {}, form.model_features or {}
    lines: list[dict[str, Any]] = []
    if form.kind == "discount":
        pct = _percent(payload["discount_pct"])
        if form.required_level == "manager":
            lines.append({"text": f"折扣 {pct}，在區處主管的權限（{_percent(DISCOUNT_MANAGER)}）以內", "alert": False})
        elif form.required_level == "director":
            lines.append({"text": f"折扣 {pct}，超過區處主管的權限（{_percent(DISCOUNT_MANAGER)}），要再送業務處長", "alert": False})
        else:
            lines.append({"text": f"折扣 {pct}，超過業務處長的權限（{_percent(DISCOUNT_DIRECTOR)}），要送到總經理", "alert": False})
        if "margin_after" in features:
            lines.append({"text": f"折後毛利率 {features['margin_after']:.0%}", "alert": False})
    elif form.kind == "contract":
        change = features.get("fee_change", 0.0)
        if form.required_level == "manager":
            lines.append({"text": f"照原費率續約 {payload['term_months']} 個月", "alert": False})
        else:
            direction = "調高" if change > 0 else "調降" if change < 0 else "一升一降，增減"
            lines.append({
                "text": f"上架費率與通路獎勵合計{direction} {abs(change):g} 個百分點，要送業務處長", "alert": False,
            })
        if "net_margin" in features:
            lines.append({"text": f"近 90 天淨毛利率 {features['net_margin']:.0%}", "alert": False})
    if "ar_age_days" in features:
        lines.append(_ar_line(features["ar_age_days"]))
    if form.kind == "discount" and "competitor_recent" in features:
        lines.append({
            "text": f"近 {STATE_DAYS} 天的拜訪{'提到' if features['competitor_recent'] else '沒有提到'}競品", "alert": False,
        })
    return lines


def reasons(form: OaExpenseForm) -> list[str]:
    return [line["text"] for line in reason_lines(form)]
