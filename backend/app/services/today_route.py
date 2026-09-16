"""今日路線：今天該去哪幾家、先去哪一家、為什麼。

排序用學出來的模型（route_model），沒有模型檔就退回規則排序。承諾逾期的客戶不管分數高低都排進來，
因為那是答應過客戶的事，不該讓模型決定。

沒有登入功能，所以三顆鈕（插入下一站／暫緩／誤判）的結果存在使用者手機上，每次要路線時一起送來。
存在伺服器的話，決賽現場多位評審選到同一位業務會互相改到對方的畫面。
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

from sqlalchemy import case, func, select, text
from sqlalchemy.orm import Session

from app.models import AppUser, Customer, Product, SalesTransaction, SapQuotationDraft, Visit
from app.services import customer_profile, route_model
from app.timeutil import TAIPEI, local_date

# 一位業務一天跑 3～5 家，路線取上限。少於這個數字是因為被暫緩或今天客戶不夠
ROUTE_SIZE = 5
# 承諾逾期最多硬排幾家。假資料沒有結案紀錄，逾期的承諾會累積，不設上限的話整條路線都是它
MAX_OVERDUE_STOPS = 2
# 商機最多硬排幾家。模型與承諾逾期排出來的全是壞消息，業務會錯過正在變好的客戶；
# 只保留一站，不排擠模型排的其他客戶
MAX_OPPORTUNITY_STOPS = 1
# 單次進貨金額比之前多幾成算商機。跟「進貨間隔拉長兩成」同一個幅度；
# 假資料裡刻意設計的三家診所多了 29～33%，其他客戶的變動最多 8%
OPPORTUNITY_GROWTH_RATIO = customer_profile.INTERVAL_ALERT_RATIO
# 成長最多的品類是這個時，提醒帶內部文件的比價表（data/documents/17-學名藥比價表.md）
GENERIC_PRICE_CATEGORY = "慢性處方"
# 第一站的出門時間與兩站之間的間隔，跟假資料排拜訪用的節奏一致（9:30 出門、平均 75 分鐘一站）
FIRST_STOP = dt.time(9, 30)
STOP_GAP_MINUTES = 70
# 距上次進貨超過平常間隔的幾倍才算「很久沒進貨」。跟客戶檔案「間隔拉長兩成」用同一個幅度
ORDER_OVERDUE_RATIO = customer_profile.INTERVAL_ALERT_RATIO
# 三顆鈕每按一次，該類提醒的分數調整一成；上下限是五次，免得按久了完全蓋過模型
PERSONAL_STEP = 0.1
PERSONAL_LIMIT = 5

SIGNAL_LABEL = {
    "commitment": "承諾逾期",
    "opportunity": "商機",
    "ar": "帳款逾期",
    "interval": "進貨間隔異常",
    "order": "很久沒進貨",
    "contract": "合約快到期",
    "visit": "很久沒拜訪",
    "routine": "例行拜訪",
}


@dataclass
class Stop:
    customer_id: str
    customer_name: str
    type: str
    grade: str
    planned_time: str
    status: str
    signal: str
    reason: str
    visit_id: str | None = None


@dataclass
class Urgent:
    customer_id: str
    customer_name: str
    signal: str
    headline: str
    detail: str
    note: str | None


@dataclass
class Feedback:
    """使用者手機上存的三顆鈕結果。"""

    snoozed: dict[str, dt.date] = field(default_factory=dict)
    pinned: list[str] = field(default_factory=list)
    signal_weights: dict[str, float] = field(default_factory=dict)


@dataclass
class TodayRoute:
    date: dt.date
    rep: AppUser
    done: int
    total: int
    urgent: Urgent | None
    stops: list[Stop]


def _done_visits(session: Session, user_id: str, today: dt.date) -> list[tuple[Visit, Customer]]:
    """今天已經確認送出的拜訪，照時間排。"""
    rows = session.execute(
        select(Visit, Customer)
        .join(Customer, Customer.id == Visit.customer_id)
        .where(Visit.user_id == user_id, Visit.confirmed_at.is_not(None))
        .order_by(Visit.visited_at)
    ).all()
    return [(v, c) for v, c in rows if local_date(v.visited_at) == today]


def _overdue_commitments(session: Session, user_id: str, today: dt.date) -> dict[str, dt.date]:
    """答應過客戶、期限已經過了的承諾：客戶 → 最晚的那個期限。

    來源跟客戶檔案的「待處理事項」一樣是拜訪紀錄裡的承諾（系統沒有結案紀錄，所以只看近 90 天）。
    這些客戶不管模型給幾分都排進今天：答應客戶的事逾期了，不該讓分數決定要不要去。
    """
    since = today - dt.timedelta(days=customer_profile.RECENT_DAYS)
    rows = session.execute(
        select(Visit.customer_id, Visit.fields_final)
        .join(Customer, Customer.id == Visit.customer_id)
        .where(
            Customer.owner_user_id == user_id,
            Visit.status.in_(customer_profile.CONFIRMED),
            Visit.visited_at >= dt.datetime.combine(since, dt.time.min, TAIPEI),
        )
    ).all()
    overdue: dict[str, dt.date] = {}
    for customer_id, fields in rows:
        commitment = (fields or {}).get("commitment") or {}
        if not commitment.get("due"):
            continue
        due = dt.date.fromisoformat(commitment["due"])
        if 0 < (today - due).days <= customer_profile.RECENT_DAYS:
            overdue[customer_id] = max(overdue.get(customer_id, due), due)
    return overdue


def _opportunities(session: Session, owner_id: str, today: dt.date) -> dict[str, str]:
    """好消息：客戶 → 一句說明。兩種，都是資料裡看得出來、而且業務去了有事可做的：

    - 有下單意向開了報價草稿，但之後這家還沒進過那個品項：報價還沒成交，值得去追
    - 單次進貨金額比之前多兩成以上：客戶在長大，可以談更多品項
    """
    since = today - dt.timedelta(days=customer_profile.RECENT_DAYS)
    found: dict[str, str] = {}

    quotes = session.execute(
        select(SapQuotationDraft.customer_id, SapQuotationDraft.sku, SapQuotationDraft.qty, Product.name,
               func.coalesce(Visit.visited_at, SapQuotationDraft.created_at).label("quoted_at"))
        .join(Customer, Customer.id == SapQuotationDraft.customer_id)
        .join(Product, Product.sku == SapQuotationDraft.sku)
        .outerjoin(Visit, Visit.id == SapQuotationDraft.visit_id)
        .where(Customer.owner_user_id == owner_id, SapQuotationDraft.status == "draft")
        .order_by(text("quoted_at DESC"))
    ).all()
    for q in quotes:
        quoted_on = local_date(q.quoted_at)
        if q.customer_id in found or quoted_on < since:
            continue
        converted = session.scalar(
            select(func.count()).select_from(SalesTransaction).where(
                SalesTransaction.customer_id == q.customer_id, SalesTransaction.sku == q.sku,
                SalesTransaction.date >= quoted_on,
            )
        )
        if not converted:
            found[q.customer_id] = f"{quoted_on:%m/%d} 想進{q.name} × {q.qty}，報價草稿還沒成交"

    growing = session.execute(
        select(customer_profile.customer_summary.c.customer_id,
               customer_profile.customer_summary.c.avg_order_amount_before,
               customer_profile.customer_summary.c.avg_order_amount_last_90d)
        .join(Customer, Customer.id == customer_profile.customer_summary.c.customer_id)
        .where(
            Customer.owner_user_id == owner_id,
            customer_profile.customer_summary.c.avg_order_amount_last_90d
            >= customer_profile.customer_summary.c.avg_order_amount_before * OPPORTUNITY_GROWTH_RATIO,
        )
    ).all()
    for customer_id, before, now in growing:
        if customer_id in found:
            continue
        sentence = f"單次進貨金額從 {float(before) / 10000:.1f} 萬增加到 {float(now) / 10000:.1f} 萬"
        category = _fastest_growing_category(session, customer_id, today)
        if category == GENERIC_PRICE_CATEGORY:
            sentence += "，慢性處方為主，可以帶學名藥比價表"
        elif category:
            sentence += f"，以{category}為主"
        found[customer_id] = sentence
    return found


def _fastest_growing_category(session: Session, customer_id: str, today: dt.date) -> str | None:
    """近 90 天比之前 90 天，進貨金額多最多的品類。"""
    recent_start = today - dt.timedelta(days=customer_profile.RECENT_DAYS)
    earlier_start = recent_start - dt.timedelta(days=customer_profile.RECENT_DAYS)
    rows = session.execute(
        select(
            Product.category,
            func.sum(case((SalesTransaction.date > recent_start, SalesTransaction.amount), else_=0))
            - func.sum(case((SalesTransaction.date <= recent_start, SalesTransaction.amount), else_=0)),
        )
        .join(Product, Product.sku == SalesTransaction.sku)
        .where(SalesTransaction.customer_id == customer_id, SalesTransaction.date > earlier_start,
               SalesTransaction.date <= today)
        .group_by(Product.category)
        .order_by(text("2 DESC"))
    ).first()
    return rows[0] if rows and rows[1] and rows[1] > 0 else None


def _signal_and_reason(candidate: route_model.Candidate, today: dt.date) -> tuple[str, str]:
    """這家為什麼排進來，說一句話。

    排順序是模型的事，這裡只負責解釋。門檻沿用客戶檔案那組（帳齡 60 天、間隔拉長兩成、
    合約前 3 個月），業務在兩個畫面上看到的標準才一樣。不用模型自己的特徵貢獻來寫理由，
    是因為貢獻值受標準化影響：權重接近 0 的特徵，只要那家客戶在該項特別極端，
    算出來的貢獻照樣最大，講出來的理由會跟排序的真正原因對不上（實測過）。
    """
    days_since_visit = (today - candidate.last_visit_date).days if candidate.last_visit_date else None
    days_since_order = (today - candidate.last_order_date).days if candidate.last_order_date else None
    typical_gap = candidate.interval_before or candidate.interval_now

    if candidate.ar_age_days > customer_profile.AR_WATCH_DAYS:
        return "ar", f"帳款最久拖了 {candidate.ar_age_days} 天"
    if (candidate.interval_now and candidate.interval_before
            and candidate.interval_now >= candidate.interval_before * customer_profile.INTERVAL_ALERT_RATIO):
        return "interval", f"進貨間隔 {candidate.interval_before:.0f} → {candidate.interval_now:.0f} 天"
    if days_since_order is not None and typical_gap and days_since_order > typical_gap * ORDER_OVERDUE_RATIO:
        return "order", f"距上次進貨 {days_since_order} 天，平常 {typical_gap:.0f} 天一次"
    if candidate.contract_days_left is not None and candidate.contract_days_left <= customer_profile.CONTRACT_NOTICE_DAYS:
        return "contract", f"合約 {candidate.contract_days_left} 天後到期"
    if days_since_visit is not None:
        return "visit", f"距上次拜訪 {days_since_visit} 天"
    return "routine", "還沒有拜訪紀錄"


# 卡片說明用客戶檔案的「進門前三分鐘」，這裡挑跟排進來的理由同一件事的那一句
HIGHLIGHT_KEYWORD = {
    "commitment": "已過期限",
    "ar": "帳款",
    "interval": "進貨間隔",
    "contract": "合約",
}


def _urgent(session: Session, candidate: route_model.Candidate, signal: str, reason: str) -> Urgent:
    """需立即處理的那張卡：說明的文字跟客戶檔案的「進門前三分鐘」同一套，不另外生成。"""
    customer = session.get(Customer, candidate.customer_id)
    highlights = customer_profile.build_profile(session, customer).highlights
    keyword = HIGHLIGHT_KEYWORD.get(signal)
    matched = next((h for h in highlights if keyword and keyword in h), None)
    detail = matched or reason
    # 補一句別的提醒當背景，例如「間隔拉長」旁邊再提「上次提到競品」
    note = next((h for h in highlights if h != detail), None)
    return Urgent(
        customer_id=candidate.customer_id,
        customer_name=candidate.name,
        signal=signal,
        headline=SIGNAL_LABEL[signal],
        detail=detail,
        note=note,
    )


def build(session: Session, user_id: str, feedback: Feedback | None = None) -> TodayRoute:
    feedback = feedback or Feedback()
    today = customer_profile.app_today(session)
    rep = session.get(AppUser, user_id)
    if rep is None or rep.role != "sales":
        raise LookupError(user_id)

    done = _done_visits(session, user_id, today)
    done_ids = {c.id for _, c in done}
    overdue = _overdue_commitments(session, user_id, today)
    opportunities = _opportunities(session, user_id, today)
    model = route_model.load_model()

    pool = []
    for candidate in route_model.candidates(session, today, owner_id=user_id):
        if candidate.customer_id in done_ids:
            continue
        due = overdue.get(candidate.customer_id)
        # 承諾到期之後又去過，就當作處理完了：系統沒有結案紀錄，只能這樣判斷
        unresolved = due is not None and (candidate.last_visit_date is None or due > candidate.last_visit_date)
        snooze_until = feedback.snoozed.get(candidate.customer_id)
        # 業務按了暫緩就不排，逾期的承諾也一樣：他知道自己今天去不去得了，按了沒反應更難解釋
        if snooze_until and snooze_until > today:
            continue
        signal, reason = _signal_and_reason(candidate, today)
        opportunity = opportunities.get(candidate.customer_id)
        # 商機的說明排在帳款與間隔這類壞消息後面：同一家兩種都有時，先講要處理的問題
        if opportunity and signal not in ("ar", "interval"):
            signal, reason = "opportunity", opportunity
        if unresolved:
            signal, reason = "commitment", f"答應的事 {due:%m/%d} 到期，已經過 {(today - due).days} 天"
        base = route_model.score(candidate.features, model) if model else route_model.rule_score(candidate)
        weight = max(-PERSONAL_LIMIT, min(PERSONAL_LIMIT, feedback.signal_weights.get(signal, 0)))
        pool.append({
            "candidate": candidate, "signal": signal, "reason": reason,
            "score": base * (1 + PERSONAL_STEP * weight),
            # 按過「插入下一站」的排最前面，其次是逾期的承諾，再來才照分數。
            # 這類提醒被按過「誤判」就不再硬排：業務說這種提醒對他沒用，硬排等於不理他
            "rank": (candidate.customer_id in feedback.pinned, unresolved and weight >= 0),
            "opportunity": opportunity,
        })
    pool.sort(key=lambda item: (item["rank"][0], item["rank"][1], item["score"]), reverse=True)
    # 逾期承諾超過上限的，排回分數的隊伍裡，不再硬插到前面
    kept, dropped = [], []
    for item in pool:
        forced = item["rank"][1] and not item["rank"][0]
        (dropped if forced and sum(1 for k in kept if k["rank"][1]) >= MAX_OVERDUE_STOPS else kept).append(item)
    pool = kept + sorted(dropped, key=lambda item: item["score"], reverse=True)
    picked = pool[: max(0, ROUTE_SIZE - len(done))]
    # 路線裡沒有商機、而且有名額時，把分數最高的一家商機換進來（替掉分數最低、不是硬排的那一站）
    picked_ids = {item["candidate"].customer_id for item in picked}
    # 看的是畫面上有沒有標成商機：有商機、但因為同時帳款逾期而標成帳款的那一站不算
    if picked and not any(item["signal"] == "opportunity" for item in picked):
        best = next((item for item in pool if item["opportunity"] and item["candidate"].customer_id not in picked_ids), None)
        replaceable = [i for i, item in enumerate(picked) if not item["rank"][0] and not item["rank"][1]]
        if best and replaceable and MAX_OPPORTUNITY_STOPS:
            best = {**best, "signal": "opportunity", "reason": best["opportunity"]}
            picked[replaceable[-1]] = best

    stops = [
        Stop(
            customer_id=c.id, customer_name=c.name, type=c.type, grade=c.grade,
            planned_time=v.visited_at.astimezone(TAIPEI).strftime("%H:%M"),
            status="done", signal="routine", reason="已完成", visit_id=v.id,
        )
        for v, c in done
    ]
    start = dt.datetime.combine(today, FIRST_STOP) + dt.timedelta(minutes=STOP_GAP_MINUTES * len(stops))
    for n, item in enumerate(picked):
        candidate = item["candidate"]
        stops.append(Stop(
            customer_id=candidate.customer_id, customer_name=candidate.name, type=candidate.type,
            grade=candidate.grade,
            planned_time=(start + dt.timedelta(minutes=STOP_GAP_MINUTES * n)).strftime("%H:%M"),
            status="next" if n == 0 else "todo", signal=item["signal"], reason=item["reason"],
        ))

    urgent = None
    # 只有真的有事才給卡片：「很久沒拜訪」是排序的理由，但不值得用紅卡叫業務立刻處理
    if picked and picked[0]["signal"] not in ("routine", "visit"):
        urgent = _urgent(session, picked[0]["candidate"], picked[0]["signal"], picked[0]["reason"])
    return TodayRoute(date=today, rep=rep, done=len(done), total=len(stops), urgent=urgent, stops=stops)
