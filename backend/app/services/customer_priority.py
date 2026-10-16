"""主管設定的客戶優先策略：交易指標、可調權重、策略客戶與有版本的預覽。

參考加權 RFM / 多準則決策；分數表示經營偏好，不是成交或流失機率。
設定存於 app_setting 的 customer_priority:<主管工號>，不更動既有資料表。
"""

from __future__ import annotations

import datetime as dt
import json
import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from app.models import AppSetting, AppUser, Customer, Itinerary, ItineraryStop, SalesTransaction, StopArrival, Visit
from app.services import customer_profile
from app.services.scope import SHARING_LEVEL, Scope
from app.timeutil import TAIPEI

PREFIX = "customer_priority:"
METRICS = {
    "revenue": {"label": "營收貢獻", "unit": "元", "description": "統計期間的銷售金額"},
    "growth": {"label": "營收成長", "unit": "%", "description": "與前一個等長期間比較；上期無正營收時不計成長率"},
    "net_margin": {"label": "淨毛利貢獻", "unit": "元", "description": "營收減成本、上架費與通路獎勵"},
    "frequency": {"label": "採購頻率", "unit": "筆", "description": "統計期間的不同訂單數，同張訂單不重複計算品項"},
    "recency": {"label": "距上次採購", "unit": "天", "description": "距最近一次進貨的天數"},
    "visit_gap": {"label": "距上次拜訪", "unit": "天", "description": "距最近一次已確認拜訪的天數"},
}
MetricId = Literal["revenue", "growth", "net_margin", "frequency", "recency", "visit_gap"]


class PriorityError(ValueError):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


class MetricRule(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    metric: MetricId
    weight: float = Field(ge=0, le=100)
    direction: Literal["higher", "lower"] = "higher"


class PriorityCustomer(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    customer_id: str = Field(min_length=1, max_length=64)
    reason: str = Field(min_length=1, max_length=160)
    until: dt.date | None = None


class Strategy(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    name: str = Field(min_length=1, max_length=40)
    days: int = Field(default=90, ge=7, le=365)
    daily_limit: int = Field(default=5, ge=1, le=8)
    metrics: list[MetricRule] = Field(min_length=1, max_length=len(METRICS))
    priority_customers: list[PriorityCustomer] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def valid_rules(self):
        if len({r.metric for r in self.metrics}) != len(self.metrics):
            raise ValueError("同一個指標只能設定一次")
        if sum(r.weight for r in self.metrics) <= 0:
            raise ValueError("至少選一項指標並設定大於零的權重")
        if len({c.customer_id for c in self.priority_customers}) != len(self.priority_customers):
            raise ValueError("指定客戶不能重複")
        return self


class Policy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    strategies: list[Strategy] = Field(min_length=1, max_length=8)
    active_id: str | None = None

    @model_validator(mode="after")
    def valid_strategies(self):
        ids = [s.id for s in self.strategies]
        if len(set(ids)) != len(ids):
            raise ValueError("策略編號不能重複")
        if self.active_id is not None and self.active_id not in ids:
            raise ValueError("啟用的策略必須已儲存")
        return self


def default_strategy() -> Strategy:
    weights = {"revenue": 35, "growth": 20, "net_margin": 25, "frequency": 10, "visit_gap": 10, "recency": 0}
    return Strategy(id="balanced", name="均衡經營", metrics=[
        MetricRule(metric=k, weight=v, direction="lower" if k == "recency" else "higher") for k, v in weights.items()
    ])


def managers(session: Session, viewer: AppUser) -> list[AppUser]:
    return list(session.scalars(select(AppUser).where(
        AppUser.role == "manager", AppUser.deactivated_at.is_(None),
        Scope.for_user(viewer).includes(SHARING_LEVEL["manager_inbox"], AppUser.id),
    ).order_by(AppUser.id)))


def target_manager(session: Session, viewer: AppUser, manager_id: str | None) -> AppUser:
    choices = managers(session, viewer)
    wanted = manager_id or (viewer.id if viewer.role == "manager" else choices[0].id if choices else None)
    found = next((m for m in choices if m.id == wanted), None)
    if found is None:
        raise PriorityError("找不到可設定策略的主管", 404)
    return found


def reps(session: Session, manager: AppUser) -> list[AppUser]:
    return list(session.scalars(select(AppUser).where(
        AppUser.role == "sales", AppUser.acts_as_user_id.is_(None), AppUser.deactivated_at.is_(None),
        Scope.for_user(manager).includes(SHARING_LEVEL["manager_inbox"], AppUser.id),
    ).order_by(AppUser.id)))


def load(session: Session, manager_id: str) -> dict:
    row = session.get(AppSetting, PREFIX + manager_id, populate_existing=True)
    return json.loads(row.value) if row else {
        "revision": 0, "strategies": [default_strategy().model_dump(mode="json")], "active_id": None,
        "updated_at": None, "updated_by": None,
    }


def active_strategy(saved: dict) -> Strategy | None:
    return next((Strategy.model_validate(s) for s in saved["strategies"] if s["id"] == saved["active_id"]), None)


def settings(session: Session, viewer: AppUser, manager_id: str | None) -> dict:
    manager = target_manager(session, viewer, manager_id)
    return {
        **load(session, manager.id), "manager_id": manager.id,
        "managers": [{"id": m.id, "name": m.name} for m in managers(session, viewer)],
        "metrics": [{"id": key, **value} for key, value in METRICS.items()],
    }


def lock_manager(session: Session, manager: AppUser) -> None:
    session.execute(select(AppUser.id).where(AppUser.id == manager.id).with_for_update()).scalar_one()


def save(session: Session, manager: AppUser, viewer: AppUser, revision: int, policy: Policy) -> dict:
    lock_manager(session, manager)
    before = load(session, manager.id)
    if revision != before["revision"]:
        raise PriorityError("策略剛被修改，請重新載入後再儲存", 409)
    allowed = set(session.scalars(select(Customer.id).where(Customer.owner_user_id.in_([r.id for r in reps(session, manager)]))))
    if any(c.customer_id not in allowed for s in policy.strategies for c in s.priority_customers):
        raise PriorityError("指定客戶必須屬於這位主管的團隊", 404)
    payload = {
        **policy.model_dump(mode="json"), "revision": revision + 1,
        "updated_at": dt.datetime.now(dt.UTC).isoformat(), "updated_by": viewer.name,
    }
    row = session.get(AppSetting, PREFIX + manager.id)
    if row:
        row.value = json.dumps(payload, ensure_ascii=False)
    else:
        session.add(AppSetting(key=PREFIX + manager.id, value=json.dumps(payload, ensure_ascii=False)))
    session.flush()
    return payload


def inputs(session: Session, manager: AppUser, days: int, today: dt.date) -> list[dict]:
    """所有計算都限定目前團隊；未來交易與未確認拜訪不進入統計。"""
    owners = reps(session, manager)
    owner_ids, names = [r.id for r in owners], {r.id: r.name for r in owners}
    customers = list(session.scalars(select(Customer).where(Customer.owner_user_id.in_(owner_ids)).order_by(Customer.id)))
    ids = [c.id for c in customers]
    start, previous = today - dt.timedelta(days=days - 1), today - dt.timedelta(days=days * 2 - 1)
    t = SalesTransaction
    aggregates = {row.customer_id: row for row in session.execute(select(
        t.customer_id,
        func.coalesce(func.sum(t.amount).filter(t.date >= start), 0).label("revenue"),
        func.coalesce(func.sum(t.amount).filter(t.date < start), 0).label("previous"),
        func.coalesce(func.sum(t.amount - t.cost - t.listing_fee - t.channel_reward).filter(t.date >= start), 0).label("net_margin"),
        func.count(distinct(t.order_no)).filter(t.date >= start).label("frequency"),
    ).where(t.customer_id.in_(ids), t.date >= previous, t.date <= today).group_by(t.customer_id))}
    orders = dict(session.execute(select(t.customer_id, func.max(t.date)).where(t.customer_id.in_(ids), t.date <= today).group_by(t.customer_id)).all())
    until = dt.datetime.combine(today + dt.timedelta(days=1), dt.time.min, TAIPEI)
    visits = dict(session.execute(select(Visit.customer_id, func.max(Visit.visited_at)).where(
        Visit.customer_id.in_(ids), Visit.status.in_(customer_profile.CONFIRMED),
        Visit.confirmed_at.is_not(None), Visit.visited_at < until,
    ).group_by(Visit.customer_id)).all())
    result = []
    for c in customers:
        a = aggregates.get(c.id)
        revenue, prior = float(a.revenue) if a else 0.0, float(a.previous) if a else 0.0
        result.append({
            "customer_id": c.id, "customer_name": c.name, "owner_id": c.owner_user_id,
            "owner_name": names[c.owner_user_id], "area": c.area,
            "values": {
                "revenue": revenue, "growth": (revenue / prior - 1) * 100 if prior > 0 else None,
                "net_margin": float(a.net_margin) if a else 0.0, "frequency": a.frequency if a else 0,
                "recency": (today - orders[c.id]).days if c.id in orders else None,
                "visit_gap": (today - visits[c.id].astimezone(TAIPEI).date()).days if c.id in visits else None,
            },
        })
    return result


def rank(strategy: Strategy, rows: list[dict], today: dt.date) -> list[dict]:
    """同一團隊共用尺度；無資料與整欄相同均給中性 50 分，避免除零或虛構成長率。"""
    domains = {}
    for rule in strategy.metrics:
        values = [r["values"].get(rule.metric) for r in rows]
        valid = [v for v in values if v is not None and math.isfinite(v)]
        domains[rule.metric] = (min(valid), max(valid)) if valid else None
    total = sum(r.weight for r in strategy.metrics)
    pins = {p.customer_id: p for p in strategy.priority_customers if p.until is None or p.until >= today}
    ranked = []
    for row in rows:
        parts = []
        for rule in strategy.metrics:
            raw, domain = row["values"].get(rule.metric), domains[rule.metric]
            normalized = (raw - domain[0]) / (domain[1] - domain[0]) * 100 if raw is not None and domain and domain[0] != domain[1] else 50.0
            normalized = normalized if rule.direction == "higher" else 100 - normalized
            weight = rule.weight / total
            parts.append({"metric": rule.metric, "value": raw, "normalized": round(normalized, 2),
                          "weight": round(weight * 100, 4), "contribution": normalized * weight})
        score = sum(p["contribution"] for p in parts)
        pin = pins.get(row["customer_id"])
        top = sorted((p for p in parts if p["weight"] > 0), key=lambda p: (-p["contribution"], p["metric"]))[:2]
        reason = "、".join(f"{METRICS[p['metric']]['label']} {p['contribution']:.1f} 分" for p in top)
        if pin:
            reason = f"主管指定：{pin.reason}；{reason}"
        ranked.append({**row, "score": score, "parts": parts, "priority": bool(pin), "priority_reason": pin.reason if pin else None,
                       "reason": f"{strategy.name} {score:.1f} 分；{reason}"})
    ranked.sort(key=lambda r: (not r["priority"], -r["score"], r["customer_id"]))
    return [{**r, "rank": i + 1, "score": round(r["score"], 2), "parts": [{**p, "contribution": round(p["contribution"], 2)} for p in r["parts"]]} for i, r in enumerate(ranked)]


def for_rep(session: Session, rep: AppUser, today: dt.date) -> tuple[Strategy, list[dict]] | None:
    manager = session.get(AppUser, rep.manager_id) if rep.manager_id else None
    if not manager or manager.deactivated_at is not None:
        return None
    strategy = active_strategy(load(session, manager.id))
    if strategy is None:
        return None
    return strategy, [r for r in rank(strategy, inputs(session, manager, strategy.days, today), today) if r["owner_id"] == rep.id]


def rebuild_block(session: Session, itinerary: Itinerary) -> str | None:
    started = session.scalar(select(StopArrival.customer_id).where(StopArrival.itinerary_id == itinerary.id).limit(1))
    if started or session.scalar(select(Visit.id).where(
        Visit.user_id == itinerary.user_id, Visit.confirmed_at.is_not(None),
        Visit.visited_at >= dt.datetime.combine(itinerary.date, dt.time.min, TAIPEI),
        Visit.visited_at < dt.datetime.combine(itinerary.date + dt.timedelta(days=1), dt.time.min, TAIPEI),
    ).limit(1)):
        return "今天已有到站或確認拜訪，保留正在執行的行程"
    generated = (itinerary.skip_reasons or {}).get("_priority_generated_version", 1)
    if itinerary.version != generated:
        return "今天的行程已手動調整，保留業務安排"
    return None


def preview(session: Session, manager: AppUser, strategy: Strategy) -> dict:
    today = customer_profile.app_today(session)
    current = load(session, manager.id)
    allowed = inputs(session, manager, strategy.days, today)
    if {c.customer_id for c in strategy.priority_customers} - {r["customer_id"] for r in allowed}:
        raise PriorityError("指定客戶必須屬於這位主管的團隊", 404)
    ranked = rank(strategy, allowed, today)
    baseline = active_strategy(current)
    before = {r["customer_id"]: r["rank"] for r in rank(baseline, inputs(session, manager, baseline.days, today), today)} if baseline else {}
    routes = []
    from app.services import today_route
    for rep in reps(session, manager):
        done = {c.id for _, c in today_route.done_visits(session, rep.id, today)}
        snoozed = today_route.load_feedback(session, rep.id, today).snoozed
        available = [r for r in ranked if r["owner_id"] == rep.id and r["customer_id"] not in done and r["customer_id"] not in snoozed]
        selected = available[:max(0, strategy.daily_limit - len(done))]
        itinerary = session.scalar(select(Itinerary).where(Itinerary.user_id == rep.id, Itinerary.date == today))
        old = list(session.scalars(select(ItineraryStop.customer_id).where(ItineraryStop.itinerary_id == itinerary.id).order_by(ItineraryStop.position))) if itinerary else []
        blocked = rebuild_block(session, itinerary) if itinerary else None
        routes.append({"rep_id": rep.id, "rep_name": rep.name, "version": itinerary.version if itinerary else 0,
                       "current_ids": old, "suggested_ids": [r["customer_id"] for r in selected], "blocked": blocked,
                       "priority_overflow": max(0, sum(r["priority"] for r in available) - len(selected))})
    return {"date": today, "revision": current["revision"], "baseline_name": baseline.name if baseline else None,
            "rows": [{**r, "previous_rank": before.get(r["customer_id"])} for r in ranked], "routes": routes}


def apply_today(session: Session, manager: AppUser, rep_id: str, revision: int, version: int) -> Itinerary:
    from app.services import itinerary as service
    lock_manager(session, manager)
    saved = load(session, manager.id)
    if saved["revision"] != revision:
        raise PriorityError("策略剛被修改，請重新預覽", 409)
    if active_strategy(saved) is None:
        raise PriorityError("請先啟用一份策略")
    rep = next((r for r in reps(session, manager) if r.id == rep_id), None)
    if rep is None:
        raise PriorityError("找不到這位業務", 404)
    today = customer_profile.app_today(session)
    found = session.scalar(select(Itinerary).where(Itinerary.user_id == rep.id, Itinerary.date == today))
    if found:
        try:
            service._lock(session, found)
        except service.VersionConflict:
            raise PriorityError("行程已重置，請重新預覽", 409) from None
        if found.version != version:
            raise PriorityError("行程剛被修改，請重新預覽", 409)
        if blocked := rebuild_block(session, found):
            raise PriorityError(blocked, 409)
        return service.rebuild_priority(session, found, rep)
    if version != 0:
        raise PriorityError("行程已重置，請重新預覽", 409)
    # 與一般首次讀取共用唯一鍵與並行建立處理；剛被建立時不覆寫另一份行程。
    found = service.get_or_create(session, rep.id)
    if rebuild_block(session, found):
        raise PriorityError("行程剛被修改，請重新預覽", 409)
    return found
