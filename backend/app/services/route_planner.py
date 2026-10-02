"""排今天的順序（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈排序程式〉）。

純函式：不碰資料庫、不估車程，車程矩陣由呼叫端給。一天還沒跑的站最多 8 站（40,320 種排法），
用深度優先全部試過——違反規則的分支直接剪掉，已經比目前最好的差也剪掉——保證找到最好的那條：
先比晚到分鐘數，一樣再比總車程。

規則分兩級：先後、排第一、排最後、鎖住的位置一定要守，守不住就不排（回 Conflict，講出是哪幾條）；
約的時間盡量守，趕不上照樣排，記下晚到幾分鐘。

`rule_costs` 算每條規則讓路線多繞多少，對照卡用。
"""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass
from typing import Literal

MAX_OPEN_STOPS = 8

WindowKind = Literal["at", "before", "after"]


@dataclass(frozen=True)
class PlanStop:
    customer_id: str
    point: int  # 在車程矩陣裡是第幾點
    duration: int  # 停留幾分鐘
    window: tuple[WindowKind, dt.time] | None = None  # 約的時間：幾點到／以前／以後


@dataclass(frozen=True)
class Rule:
    """一定要守的規則。precedence 的 customer_ids 是 (前, 後)；first、last 是符合的那幾家；
    lock 是一家，加上它在還沒跑的站裡的位置（0 起算）。"""

    id: str
    text: str  # 給人看的一句話，排不出來時拿來講是哪幾條打架
    kind: Literal["precedence", "first", "last", "lock"]
    customer_ids: tuple[str, ...]
    position: int | None = None


@dataclass(frozen=True)
class Slot:
    customer_id: str
    arrive: dt.datetime
    leave: dt.datetime
    travel_minutes: int  # 從上一站（或出發點）開過來
    late_minutes: int


@dataclass(frozen=True)
class Schedule:
    slots: list[Slot]
    late_minutes: int
    travel_minutes: int


@dataclass(frozen=True)
class Conflict:
    """排不出來：拿掉其中任何一條就排得出來的那幾條；找不到單獨一條擋住的，就是全部的規則。
    同一個 id 的規則只列一條。"""

    rules: list[Rule]


@dataclass(frozen=True)
class RuleCost:
    """守住這條規則讓路線多花多少：跟拿掉這條（同一個 id 一起拿掉）重排的最好排法比。"""

    rule: Rule
    travel_minutes: int  # 多開幾分鐘（晚到變少時可能是負的）
    late_minutes: int  # 多晚到幾分鐘
    without: list[str]  # 不守這條時最好的順序


def _visit(t: dt.datetime, travel: int, stop: PlanStop) -> tuple[dt.datetime, dt.datetime, int]:
    """(到達, 離開, 晚到幾分鐘)。「幾點到」與「以後」早到就等；「幾點到」與「以前」晚到要記下來。"""
    arrive = t + dt.timedelta(minutes=travel)
    begin, late = arrive, 0
    if stop.window:
        kind, at = stop.window
        target = arrive.replace(hour=at.hour, minute=at.minute, second=0, microsecond=0)
        if kind in ("at", "after") and arrive < target:
            begin = target
        if kind in ("at", "before") and arrive > target:
            late = math.ceil((arrive - target).total_seconds() / 60)
    return arrive, begin + dt.timedelta(minutes=stop.duration), late


def schedule(start: dt.datetime, start_point: int, ordered: list[PlanStop], minutes: list[list[int]]) -> Schedule:
    """照給的順序算每一站幾點到、幾點走，不改順序。"""
    t, here, slots = start, start_point, []
    for stop in ordered:
        travel = minutes[here][stop.point]
        arrive, leave, late = _visit(t, travel, stop)
        slots.append(Slot(stop.customer_id, arrive, leave, travel, late))
        t, here = leave, stop.point
    return Schedule(slots, sum(s.late_minutes for s in slots), sum(s.travel_minutes for s in slots))


def violations(ordered: list[str], rules: list[Rule]) -> list[Rule]:
    """這個順序違反哪幾條規則。只看今天行程裡有的客戶；規則提到的客戶不在行程裡就不算違反。
    同一條規則（同一個 id）拆成好幾組兩兩的先後時（習慣「康泰的店排在診所前面」），只列違反的第一組。"""
    position = {cid: i for i, cid in enumerate(ordered)}
    broken: list[Rule] = []
    seen: set[str] = set()
    for rule in rules:
        if rule.id in seen:
            continue
        here = [cid for cid in rule.customer_ids if cid in position]
        if rule.kind == "precedence":
            ok = len(here) < 2 or position[rule.customer_ids[0]] < position[rule.customer_ids[1]]
        elif rule.kind in ("first", "last"):
            chosen = [position[cid] for cid in here]
            others = [i for cid, i in position.items() if cid not in rule.customer_ids]
            if not chosen or not others:
                ok = True
            elif rule.kind == "first":
                ok = max(chosen) < min(others)
            else:
                ok = min(chosen) > max(others)
        else:
            ok = not here or position[here[0]] == rule.position
        if not ok:
            broken.append(rule)
            seen.add(rule.id)
    return broken


def _before(stops: list[PlanStop], rules: list[Rule]) -> dict[str, set[str]]:
    """每一家前面一定要先跑完哪幾家（先後、排第一、排最後換算成兩兩的先後）。"""
    present = {s.customer_id for s in stops}
    before: dict[str, set[str]] = {cid: set() for cid in present}
    for rule in rules:
        if rule.kind == "precedence":
            first, then = rule.customer_ids
            if first in present and then in present:
                before[then].add(first)
        elif rule.kind in ("first", "last"):
            chosen = set(rule.customer_ids) & present
            for other in present - chosen:
                for cid in chosen:
                    if rule.kind == "first":
                        before[other].add(cid)
                    else:
                        before[cid].add(other)
    return before


def _locks(stops: list[PlanStop], rules: list[Rule]) -> dict[int, str] | None:
    """鎖住的位置 → 那一家。同一家重複鎖在同一個位置不算衝突（「需立即處理」的鎖與業務按的鎖可能同時在）；
    兩家鎖在同一個位置、同一家鎖在兩個位置、或位置超出站數，就是排不出來（None）。"""
    present = {s.customer_id for s in stops}
    locks: dict[int, str] = {}
    for rule in rules:
        if rule.kind != "lock" or rule.customer_ids[0] not in present:
            continue
        cid = rule.customer_ids[0]
        if rule.position is None or not 0 <= rule.position < len(stops):
            return None
        if locks.get(rule.position, cid) != cid:
            return None
        if cid in locks.values() and locks.get(rule.position) != cid:
            return None
        locks[rule.position] = cid
    return locks


def _search(
    start: dt.datetime, start_point: int, stops: list[PlanStop], rules: list[Rule], minutes: list[list[int]]
) -> Schedule | None:
    locks = _locks(stops, rules)
    if locks is None:
        return None
    before = _before(stops, rules)
    locked = set(locks.values())
    by_id = {s.customer_id: s for s in stops}
    free = [s for s in stops if s.customer_id not in locked]
    best: list[tuple[int, int, list[PlanStop]]] = []
    order: list[PlanStop] = []
    used: set[str] = set()

    def walk(t: dt.datetime, here: int, late: int, travel: int) -> None:
        # 晚到與車程只會越加越多：已經不比目前最好的好，後面怎麼排都不會變好
        if best and (late, travel) >= best[0][:2]:
            return
        if len(order) == len(stops):
            best[:] = [(late, travel, list(order))]
            return
        position = len(order)
        choices = [by_id[locks[position]]] if position in locks else free
        for stop in choices:
            cid = stop.customer_id
            if cid in used or not before[cid] <= used:
                continue
            leg = minutes[here][stop.point]
            _, leave, stop_late = _visit(t, leg, stop)
            used.add(cid)
            order.append(stop)
            walk(leave, stop.point, late + stop_late, travel + leg)
            order.pop()
            used.discard(cid)

    walk(start, start_point, 0, 0)
    return schedule(start, start_point, best[0][2], minutes) if best else None


def plan(
    start: dt.datetime, start_point: int, stops: list[PlanStop], rules: list[Rule], minutes: list[list[int]]
) -> Schedule | Conflict:
    """守住所有規則、晚到最少、再來車程最短的順序；守不住就回 Conflict。"""
    if len(stops) > MAX_OPEN_STOPS:
        raise ValueError(f"還沒跑的站最多 {MAX_OPEN_STOPS} 站")
    found = _search(start, start_point, stops, rules, minutes)
    if found is not None:
        return found
    # 一條一條拿掉再試；同一個 id 的規則（一條習慣拆成的好幾組先後）一起拿掉，算一條
    ids = list(dict.fromkeys(rule.id for rule in rules))
    first_of = {rule_id: next(r for r in rules if r.id == rule_id) for rule_id in ids}
    blocking = [
        first_of[rule_id] for rule_id in ids
        if _search(start, start_point, stops, [r for r in rules if r.id != rule_id], minutes) is not None
    ]
    return Conflict(blocking or list(first_of.values()))


def rule_costs(
    start: dt.datetime, start_point: int, stops: list[PlanStop], rules: list[Rule], minutes: list[list[int]]
) -> list[RuleCost]:
    """每條規則讓路線多繞多少（對照卡上「守住『…』，比不守多繞 N 分鐘」）。只列拿掉之後真的排得更好的；
    守住全部規則就排不出來時回空的（那是 plan 的 Conflict 要講的事）。"""
    best = _search(start, start_point, stops, rules, minutes)
    if best is None:
        return []
    costs = []
    for rule_id in dict.fromkeys(rule.id for rule in rules):
        without = _search(start, start_point, stops, [r for r in rules if r.id != rule_id], minutes)
        if without is None or (without.late_minutes, without.travel_minutes) >= (best.late_minutes, best.travel_minutes):
            continue
        costs.append(RuleCost(
            rule=next(r for r in rules if r.id == rule_id),
            travel_minutes=best.travel_minutes - without.travel_minutes,
            late_minutes=best.late_minutes - without.late_minutes,
            without=[s.customer_id for s in without.slots],
        ))
    return costs


def cheapest_insert(
    start: dt.datetime, start_point: int, ordered: list[PlanStop], new: PlanStop, rules: list[Rule],
    minutes: list[list[int]],
) -> int:
    """新的一站插在第幾站（還沒跑的站裡，0 起算）晚到與車程增加最少、又不新增規則違反。
    插在哪裡都新增違反就放最後，讓業務自己調。"""
    # 先算出既有順序已經違反哪些規則（基線）
    baseline_violations = set(r.id for r in violations([s.customer_id for s in ordered], rules))
    best_index, best_cost = len(ordered), None
    for index in range(len(ordered) + 1):
        trial = ordered[:index] + [new] + ordered[index:]
        # 只跳過比基線新增違反的位置
        trial_violations = set(r.id for r in violations([s.customer_id for s in trial], rules))
        new_violations = trial_violations - baseline_violations
        if new_violations:
            continue
        result = schedule(start, start_point, trial, minutes)
        cost = (result.late_minutes, result.travel_minutes)
        if best_cost is None or cost < best_cost:
            best_index, best_cost = index, cost
    return best_index
