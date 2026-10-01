"""排序習慣（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈排序習慣〉）。

每位業務自己的、長期有效的排法，可以只在星期幾套用。先後、排第一、排最後換成排序程式一定要守的規則
（route_planner.Rule）；約的時段、停留多久只在新增一站（含每天的建議）時當那一站的預設值，之後業務改了就以那一站的為準。
對象比對今天行程裡的站：客戶比 id、連鎖體系比 chain_group、客戶類型比 type、地區比 area。
"""

from __future__ import annotations

import dataclasses
import datetime as dt
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import CUSTOMER_TYPES, Customer, RouteHabit
from app.services import route_planner

TARGET_KINDS = ("customer", "chain", "type", "area")
# 換成排序規則的種類；window、duration 只當新增一站時的預設值
RULE_KINDS = ("precedence", "first", "last")
TYPE_LABEL = {"chain": "連鎖藥局", "independent": "獨立藥局", "clinic": "診所"}
# date.weekday() 的 0 是星期一
WEEKDAY_LABEL = "一二三四五六日"
WINDOW_TEXT = {"at": "都約 {} 到", "before": "都 {} 以前到", "after": "都 {} 以後到"}

Target = dict[str, Any]  # {"by": "customer"／"chain"／"type"／"area", "value": ...}


class InvalidHabit(ValueError):
    """習慣的欄位不合：對象不是這位業務的、種類缺欄位。訊息是寫給業務看的中文。"""


@dataclass(frozen=True)
class HabitSpec:
    """一條習慣的內容：還沒存的（習慣頁新增、拖完答應的、跟熊熊滾說的），或從存著的那一列取出來的。"""

    kind: str
    subject: Target
    object: Target | None = None
    window_kind: str | None = None
    window_time: dt.time | None = None
    duration_minutes: int | None = None
    weekday: int | None = None


@dataclass(frozen=True)
class DemoHabit:
    spec: HabitSpec
    source: str
    days_ago: int  # 幾天前記的：兩條衝突時新的優先，先後要固定


# 示範業務（林昱辰，U01）一開始就有的三條習慣，灌資料與 IT 重置示範業務的行程時都照這份重建。
# 客戶寫店名，建立時才查成 id（假資料的編號由產生程式決定）
DEMO_HABITS = [
    DemoHabit(HabitSpec("precedence", {"by": "chain", "value": "康泰連鎖藥局"}, {"by": "type", "value": "clinic"}), "ai", 20),
    DemoHabit(HabitSpec("last", {"by": "customer", "value": "敦南內科診所 · 大安"}, weekday=2), "manual", 12),
    DemoHabit(
        HabitSpec("window", {"by": "customer", "value": "杏林診所 · 大安"}, window_kind="before", window_time=dt.time(11, 0)),
        "manual", 5,
    ),
]


def spec_of(habit: RouteHabit) -> HabitSpec:
    return HabitSpec(
        kind=habit.kind, subject=habit.subject, object=habit.object, window_kind=habit.window_kind,
        window_time=habit.window_time, duration_minutes=habit.duration_minutes, weekday=habit.weekday,
    )


def matches(target: Target, customer: Customer) -> bool:
    field = {"customer": customer.id, "chain": customer.chain_group, "type": customer.type, "area": customer.area}
    return field.get(target["by"]) == target["value"]


def touches(spec: HabitSpec, customer: Customer) -> bool:
    """這條習慣有沒有提到這一家（先後的前後兩邊都算）。"""
    return matches(spec.subject, customer) or (spec.object is not None and matches(spec.object, customer))


def label(target: Target, names: dict[str, str]) -> str:
    """對象給人看的名字：客戶寫店名，連鎖體系寫「康泰連鎖藥局的店」，類型寫「診所」，地區寫「板橋」。"""
    by, value = target["by"], target["value"]
    if by == "customer":
        return names.get(value, value)
    if by == "chain":
        return f"{value}的店"
    if by == "type":
        return TYPE_LABEL.get(value, value)
    return value


def _part(target: Target, names: dict[str, str]) -> str:
    # 店名有「 · 」（「杏林診所 · 大安」），前後空一格，才不會跟後面的字黏在一起讀錯（「大安排最後」）
    text = label(target, names)
    return f" {text} " if target["by"] == "customer" else text


def describe(spec: HabitSpec, names: dict[str, str]) -> str:
    """給人看的那一句話，由欄位產生，例如「康泰連鎖藥局的店排在診所前面」「星期一先跑板橋」。
    names 是客戶 id → 店名，對象是客戶時用。"""
    who = _part(spec.subject, names)
    if spec.kind == "precedence":
        core = f"{who}排在{_part(spec.object, names)}前面"
    elif spec.kind == "first":
        core = f"先跑{who}"
    elif spec.kind == "last":
        core = f"{who}排最後"
    elif spec.kind == "window":
        core = who + WINDOW_TEXT[spec.window_kind].format(spec.window_time.strftime("%H:%M"))
    else:
        core = f"去{who}都停 {spec.duration_minutes} 分"
    if spec.weekday is not None:
        core = f"星期{WEEKDAY_LABEL[spec.weekday]}{core}"
    return " ".join(core.split())


def applies_on(habit: RouteHabit, day: dt.date) -> bool:
    return habit.active and (habit.weekday is None or habit.weekday == day.weekday())


def mine(session: Session, user_id: str) -> list[RouteHabit]:
    """這位業務所有的習慣（含停用的），舊的在前。"""
    return list(session.scalars(
        select(RouteHabit).where(RouteHabit.user_id == user_id).order_by(RouteHabit.created_at, RouteHabit.id)
    ))


def for_day(session: Session, user_id: str, day: dt.date) -> list[RouteHabit]:
    """這一天套用的習慣（啟用中、星期幾對得上），舊的在前：兩條衝突時新的優先。"""
    return [habit for habit in mine(session, user_id) if applies_on(habit, day)]


def find(session: Session, user_id: str, habit_id: int) -> RouteHabit:
    habit = session.get(RouteHabit, habit_id)
    if habit is None or habit.user_id != user_id:
        raise LookupError(habit_id)
    return habit


def rules(entries: Iterable[tuple[str, HabitSpec, str]], customers: list[Customer]) -> list[route_planner.Rule]:
    """先後、排第一、排最後換成排序程式的規則；entries 是 (規則 id, 習慣, 那句話)，customers 是還沒跑的站。
    先後是「符合 A 的每一站都在符合 B 的每一站前面」：拆成兩兩的先後，id 都是同一條習慣的；同時符合 A 和 B 的站不算。
    排第一、排最後是符合的那幾家一起排在其他站前面、後面。今天沒有符合的站就沒有規則。"""
    out: list[route_planner.Rule] = []
    for key, spec, text in entries:
        if spec.kind not in RULE_KINDS:
            continue
        chosen = [c.id for c in customers if matches(spec.subject, c)]
        if spec.kind == "precedence":
            then = [c.id for c in customers if matches(spec.object, c)]
            both = set(chosen) & set(then)
            out += [
                route_planner.Rule(id=key, text=text, kind="precedence", customer_ids=(first, second))
                for first in chosen if first not in both
                for second in then if second not in both
            ]
        elif chosen:
            out.append(route_planner.Rule(id=key, text=text, kind=spec.kind, customer_ids=tuple(chosen)))
    return out


def defaults(habits: list[RouteHabit], customer: Customer) -> tuple[tuple[str, dt.time] | None, int | None]:
    """新增一站時，習慣給這一家的 (約的時間, 停留分鐘數)；同一家有好幾條時新的優先（habits 照舊到新排）。"""
    window, duration = None, None
    for habit in habits:
        if not matches(habit.subject, customer):
            continue
        if habit.kind == "window":
            window = (habit.window_kind, habit.window_time)
        elif habit.kind == "duration":
            duration = habit.duration_minutes
    return window, duration


def targets(session: Session, user_id: str) -> dict[str, list[tuple[str, str]]]:
    """新增習慣能選的對象，(值, 給人看的名字)：自己的客戶、他們的連鎖體系、三種客戶類型、他們所在的地區。"""
    customers = list(session.scalars(select(Customer).where(Customer.owner_user_id == user_id).order_by(Customer.name)))
    return {
        "customer": [(c.id, c.name) for c in customers],
        "chain": [(g, g) for g in sorted({c.chain_group for c in customers if c.chain_group})],
        "type": [(t, TYPE_LABEL[t]) for t in CUSTOMER_TYPES],
        "area": [(a, a) for a in sorted({c.area for c in customers})],
    }


def validate(spec: HabitSpec, options: dict[str, list[tuple[str, str]]]) -> None:
    """欄位不合就丟 InvalidHabit：種類缺欄位、對象不在 options 裡（不是自己的客戶、客戶沒有的連鎖體系或地區）。"""
    if spec.kind not in (*RULE_KINDS, "window", "duration"):
        raise InvalidHabit("不知道這種習慣")
    if spec.kind == "precedence" and spec.object is None:
        raise InvalidHabit("先後要選前後兩個對象")
    allowed = {by: {value for value, _ in items} for by, items in options.items()}
    for target in [spec.subject] + ([spec.object] if spec.kind == "precedence" else []):
        if target.get("by") not in allowed or target.get("value") not in allowed[target["by"]]:
            raise InvalidHabit("找不到這個對象，只能選自己的客戶")
    if spec.kind == "precedence" and spec.subject == spec.object:
        raise InvalidHabit("前後不能是同一個對象")
    if spec.kind == "window" and (spec.window_kind not in ("at", "before", "after") or spec.window_time is None):
        raise InvalidHabit("約的時間要選幾點到、以前或以後，再填時間")
    if spec.kind == "duration" and not spec.duration_minutes:
        raise InvalidHabit("停留要填幾分鐘")
    if spec.weekday is not None and not 0 <= spec.weekday <= 6:
        raise InvalidHabit("星期幾只能是星期一到星期日")


def create(
    session: Session, user_id: str, spec: HabitSpec, source: str, created_at: dt.datetime | None = None
) -> RouteHabit:
    """新增一條習慣（先驗證）。不回頭改今天已存的行程：要套用的話，業務回去按「幫我排順一點」。"""
    options = targets(session, user_id)
    validate(spec, options)
    window = spec.kind == "window"
    habit = RouteHabit(
        user_id=user_id, kind=spec.kind, subject=dict(spec.subject),
        object=dict(spec.object) if spec.kind == "precedence" else None,
        window_kind=spec.window_kind if window else None, window_time=spec.window_time if window else None,
        duration_minutes=spec.duration_minutes if spec.kind == "duration" else None,
        weekday=spec.weekday, text=describe(spec, dict(options["customer"])), source=source,
    )
    if created_at is not None:
        habit.created_at = created_at
    session.add(habit)
    session.flush()
    return habit


def reset_demo(session: Session, user_id: str) -> None:
    """刪掉這位業務所有的習慣，照 DEMO_HABITS 重建。灌資料、IT 重置示範業務的行程時用：
    評審代理示範業務時加的、停用的習慣不會一直累積到下一批評審。找不到店名、連鎖體系、地區的那一條就跳過
    （例如中區的業務沒有康泰連鎖藥局的店，示範的第一條就建不起來）。"""
    session.execute(delete(RouteHabit).where(RouteHabit.user_id == user_id))
    options = targets(session, user_id)
    allowed = {by: {value for value, _ in items} for by, items in options.items()}
    ids = {name: cid for cid, name in options["customer"]}
    now = dt.datetime.now(dt.UTC)
    for demo in DEMO_HABITS:
        subject = demo.spec.subject
        if subject["by"] == "customer":
            if subject["value"] not in ids:
                continue
            subject = {"by": "customer", "value": ids[subject["value"]]}
        elif subject["value"] not in allowed.get(subject["by"], set()):
            continue
        spec = dataclasses.replace(demo.spec, subject=subject)
        create(session, user_id, spec, demo.source, created_at=now - dt.timedelta(days=demo.days_ago))
