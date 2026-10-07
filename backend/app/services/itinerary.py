"""今天的行程（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md）。

當天第一次讀取時照模型的建議建一份存起來：模型挑哪幾家（today_route.pick），套上業務的排序習慣（route_habits），
順序交給 route_planner 排順路，「需立即處理」那家鎖在第一站。之後一律以存著的為準，模型不再重排；業務或主管誰先讀都一樣。
已完成與否不存：跟以前一樣看今天有沒有這家已確認的拜訪紀錄，跑完的站排在最前面。

還沒跑的站，不管是存著的（ItineraryStop）還是調整清單上改到一半的，都先整理成 _Open，
再用同一支 _compose 算時間、車程、要守的規則與違反了哪幾條。
每一段路照業務的預設交通方式（app_user.travel_mode）；另外選的段存在 ItineraryLeg，只認現在還相鄰的兩站
（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md）。
"""

from __future__ import annotations

import dataclasses
import datetime as dt
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import delete, func, inspect, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    LEG_MODES, TRAVEL_MODES, AppUser, Customer, Itinerary, ItineraryLeg, ItineraryPrecedence, ItineraryStop, OrgUnit,
    RouteHabit, RouteSignalWeight, RouteSnooze, Visit,
)
from app.services import customer_profile, route_habits, route_planner, today_route, travel
from app.services.google_routes import TravelMode
from app.timeutil import TAIPEI

# 每站預設停留多久。以前用「平均 70 分鐘一站」排時間，那包含了車程；現在車程另外算
DEFAULT_DURATION = 40
# 暫緩跳過三天：足夠跳過這一趟和隔天的路線，又不會整個週期看不到這家（跟原本手機上的一樣）
SNOOZE_DAYS = 3
# 今天不套用某條習慣的原因（Itinerary.skip_reasons）。每天建立建議時衝突的另外寫「跟『…』衝突」
SKIP_BY_REP = "你選了今天不套用"
SKIP_BY_ORDER = "跟今天排的順序不合"
TOO_MANY = f"今天已經排了 {route_planner.MAX_OPEN_STOPS} 站，要先刪掉一站"
# 加一站的候選裡「順路的」列幾家
NEARBY = 5

FeedbackAction = Literal["pin", "snooze", "misjudge"]


class VersionConflict(Exception):
    """行程在讀取之後被改過：兩個人同時改同一位業務的行程，後存的那一個擋下來。"""


class NotOnItinerary(LookupError):
    """這家不在今天還沒跑的站裡。"""


class InvalidDraft(ValueError):
    """調整清單送來的內容不合：不是自己的客戶、同一家排兩次、超過 8 站、習慣的欄位不對。訊息寫給業務看。"""


class NotALeg(ValueError):
    """這兩家現在不是還沒走的一段（不相鄰，或到的那家已經跑完了）。訊息寫給業務看。"""


@dataclass
class StopView:
    customer_id: str
    customer_name: str
    type: str
    grade: str
    planned_time: str  # 已完成的是拜訪時間，其他是排出來的到達時間
    status: str  # done／next／todo
    signal: str
    reason: str
    visit_id: str | None
    source: str
    duration_minutes: int
    late_minutes: int
    travel_minutes: int | None  # 從上一站開過來；已完成的站是 None
    travel_km: float | None
    window_kind: str | None = None  # 約的時間：at 幾點到、before 以前、after 以後
    window_time: str | None = None  # "HH:MM"
    note: str | None = None
    locked: bool = False
    # 套用在這一站的習慣（存著的才算），調整清單的卡片上標綠色「習慣」
    habit_ids: list[int] = field(default_factory=list)
    # 從上一站（或辦公室）過來的那一段：是不是估算的、實際用哪種交通方式（另外選的，或業務的預設）
    travel_estimated: bool = False
    travel_mode: str = "drive"
    city: str = ""  # 客戶在哪個縣市（熊熊滾騎哪個縣市的座騎）


@dataclass
class RuleView:
    """調整清單要守的規則。鎖住的不列：清單上的位置就是業務排的，不會違反；鎖只在排順路與插入新的一站時有作用。"""

    id: str  # "today:C012>C034"、"habit:17"、"new:0"
    text: str
    kind: str  # precedence／first／last
    source: str  # today：今天設的先後；habit：習慣；new：這次答應要記、按「完成」才存的習慣
    customer_ids: list[str]  # precedence 是 [前, 後]；同一條習慣拆成好幾組時 id 相同


@dataclass
class SkippedHabit:
    id: int
    text: str
    reason: str
    # 每天建立建議時跟別的規則衝突：行程上要提示。業務自己選的、存檔時順序不合的不算
    conflict: bool


@dataclass
class Precedence:
    before: str
    after: str


@dataclass
class ItineraryView:
    date: dt.date
    rep: AppUser
    version: int
    done: int
    total: int
    urgent: dict | None
    stops: list[StopView]
    travel_minutes: int
    travel_km: float
    finish_time: str | None  # 最後一站離開的時間
    estimated: bool  # 車程是直線估算的
    travel_mode: str = "drive"  # 整天的預設交通方式（行程主人的設定）；每一段實際用的見 StopView.travel_mode
    rules: list[RuleView] = field(default_factory=list)
    violations: list[str] = field(default_factory=list)  # 目前的順序違反的規則 id
    precedences: list[Precedence] = field(default_factory=list)  # 今天設的先後
    skipped_habits: list[SkippedHabit] = field(default_factory=list)  # 今天套用、但今天不套用的習慣
    start_city: str | None = None  # 區處辦公室所在的縣市；新開的區沒有
    office_start: bool = True  # 今天從辦公室出發（區處有位置）；新開的區從第一站出發，沒有第一段


@dataclass
class Skipped:
    customer_id: str
    customer_name: str
    reason: str


@dataclass(frozen=True)
class PendingHabit:
    """調整清單上這次答應要記、按「完成」才存的習慣。skip_today：紅框上按了「今天不套用這條」，照樣記下來，只是今天不套用。"""

    spec: route_habits.HabitSpec
    skip_today: bool = False


@dataclass
class DraftStop:
    """調整清單上的一站（還沒跑的）。"""

    customer_id: str
    duration_minutes: int = DEFAULT_DURATION
    window_kind: str | None = None
    window_time: dt.time | None = None
    note: str | None = None
    locked: bool = False


@dataclass
class Draft:
    """改到一半的行程（調整清單上的，或跟熊熊滾說的提案算出來的）：還沒跑的站照順序、今天的先後、
    今天不套用的習慣、這次答應要記的習慣、要停用的習慣。"""

    stops: list[DraftStop]
    precedences: list[tuple[str, str]] = field(default_factory=list)  # (前, 後)
    skipped_habit_ids: list[int] = field(default_factory=list)
    habits: list[PendingHabit] = field(default_factory=list)
    # 新加進來的站記成誰加的：調整清單是 rep，跟熊熊滾說的是 ai
    new_source: str = "rep"
    # 要停用的習慣（跟熊熊滾說「那條不要了」）：算規則時就不算，存檔時停用
    disabled_habit_ids: list[int] = field(default_factory=list)


@dataclass
class Candidate:
    customer_id: str
    customer_name: str
    type: str
    area: str
    signal: str | None = None  # 順路的才有：目前的理由類別
    after_stop: int | None = None  # 插在第幾站後（含跑完的站；0 是排第一站）
    extra_minutes: int | None = None  # 估算多繞幾分鐘


@dataclass
class Candidates:
    nearby: list[Candidate]  # 順路的前幾家，多繞最少的在前
    others: list[Candidate]  # 其他客戶，照名稱
    full: bool  # 還沒跑的站已經 8 站，加不進去


@dataclass
class Optimized:
    """整條重排的結果：新的草稿（排不出來時是 None）、擋住的規則（那句話）、每條規則讓路線多繞多少（對照卡的那一行）。"""

    draft: Draft | None
    conflict: list[str]
    costs: list[str]


@dataclass
class _Open:
    """還沒跑的一站。存著的（ItineraryStop）與調整清單上改到一半的都整理成這個樣子，再算時間與規則。"""

    customer: Customer
    source: str
    signal: str
    reason: str
    duration_minutes: int
    window_kind: str | None
    window_time: dt.time | None
    note: str | None
    locked: bool

    def plan_stop(self, point: int) -> route_planner.PlanStop:
        window = (self.window_kind, self.window_time) if self.window_kind and self.window_time else None
        return route_planner.PlanStop(
            customer_id=self.customer.id, point=point, duration=self.duration_minutes, window=window
        )


@dataclass
class _Day:
    """算一份行程要用的：這份行程、業務、今天跑完的站（照拜訪時間）、存著的每一站、今天套用的習慣。"""

    itinerary: Itinerary
    rep: AppUser
    done: list[tuple[Visit, Customer]]
    rows: list[ItineraryStop]
    habits: list[RouteHabit]

    @property
    def done_ids(self) -> set[str]:
        return {c.id for _, c in self.done}

    def durations(self) -> dict[str, int]:
        return {r.customer_id: r.duration_minutes for r in self.rows}


def get_or_create(session: Session, user_id: str) -> Itinerary:
    """今天的行程，沒有就照模型的建議建一份。不是業務（主管、IT）丟 LookupError。"""
    today = customer_profile.app_today(session)
    rep = session.get(AppUser, user_id)
    if rep is None or rep.role != "sales":
        raise LookupError(user_id)
    found = _find(session, user_id, today)
    if found:
        return found
    try:
        with session.begin_nested():
            return _create(session, rep, today)
    except IntegrityError:
        # 同一位業務兩個請求同時第一次讀：另一個先建好了，用那一份
        found = _find(session, user_id, today)
        if found is None:
            raise
        return found


def view(session: Session, itinerary: Itinerary) -> ItineraryView:
    """畫面要的樣子：跑完的站在前（照拜訪時間），還沒跑的照存著的順序；時間、車程、規則與違反現算。"""
    day = _day(session, itinerary)
    skipped = set(itinerary.skipped_habit_ids)
    return _compose(
        session, day, _saved_open(session, day), _precedences(session, itinerary), skipped,
        _reasons(itinerary, skipped), [],
    )


def stop_order(session: Session, itinerary: Itinerary) -> list[tuple[Customer, bool]]:
    """今天的站，順序跟 view() 的站號一樣：跑完的在前（照拜訪時間），其他照存著的順序；(客戶, 跑完了嗎)。
    不算時間與車程、不問 Google：主管頁收到位置事件時只要站號與座標（services/team_itineraries.py）。"""
    day = _day(session, itinerary)
    return [(c, True) for _, c in day.done] + [(o.customer, False) for o in _saved_open(session, day)]


def path_modes(session: Session, itinerary: Itinerary) -> list[str]:
    """今天每一段的交通方式，順序跟 stop_order 一樣、跟站數一樣多：第 0 個是辦公室到第 1 站，第 n 個是第 n 站到
    第 n + 1 站。地圖的線用；區處沒有位置時線從第一站畫起，呼叫端去掉第 0 個。不算時間、不問 Google。"""
    day = _day(session, itinerary)
    return _leg_modes(session, day, _chain(day, _saved_open(session, day)))


def office(session: Session, rep: AppUser) -> travel.Point | None:
    """區處辦公室的位置：還沒跑任何一站時從這裡出發。區處沒有位置（組織管理新開的區）回 None。"""
    found = _region(session, rep)
    return (found.lat, found.lng) if found and found.lat is not None and found.lng is not None else None


def office_city(session: Session, rep: AppUser) -> str | None:
    """區處辦公室所在的縣市（熊熊滾從辦公室出發時騎哪個縣市的座騎）；新開的區沒有，回 None。"""
    found = _region(session, rep)
    return found.city if found else None


def apply_feedback(session: Session, user_id: str, customer_id: str, action: FeedbackAction, version: int) -> Itinerary:
    """需立即處理的三顆鈕。插入下一站：移到還沒跑的第一站，同類提醒之後排前面一點；
    暫緩：從今天拿掉，三天內的建議不排；誤判：暫緩，再加上同類提醒之後少排一點。"""
    if action not in ("pin", "snooze", "misjudge"):
        raise ValueError(action)
    itinerary = get_or_create(session, user_id)
    _lock(session, itinerary)
    if itinerary.version != version:
        raise VersionConflict
    day = _day(session, itinerary)
    row = next((r for r in day.rows if r.customer_id == customer_id and customer_id not in day.done_ids), None)
    if row is None:
        raise NotOnItinerary(customer_id)
    if action == "pin":
        finished = [r for r in day.rows if r.customer_id in day.done_ids]
        rest = [r for r in day.rows if r.customer_id not in day.done_ids and r is not row]
        _renumber([*finished, row, *rest])
        _adjust_weight(session, user_id, row.signal, 1)
    elif action in ("snooze", "misjudge"):
        _remove(session, itinerary, row)
        _snooze(session, user_id, customer_id, itinerary.date + dt.timedelta(days=SNOOZE_DAYS))
        if action == "misjudge":
            _adjust_weight(session, user_id, row.signal, -1)
    if itinerary.urgent and itinerary.urgent["customer_id"] == customer_id:
        itinerary.urgent = None
    _touch(itinerary)
    session.flush()
    _prune_legs(session, itinerary)
    return itinerary


def add_stops(
    session: Session, user_id: str, customer_ids: list[str], source: str = "ask"
) -> tuple[Itinerary, list[str], list[Skipped]]:
    """把幾家加進今天的行程，各自插在多繞最少、又不新增違反規則（鎖住的站、今天的先後、習慣）的位置，
    約的時間與停留照習慣給的預設值。回傳 (行程, 加進去的店名, 沒加的與原因)。
    加進來的那家一併取消暫緩，否則明天的建議照樣不排它。"""
    itinerary = get_or_create(session, user_id)
    _lock(session, itinerary)
    day = _day(session, itinerary)
    open_ = _saved_open(session, day)
    precedences = _precedences(session, itinerary)
    skipped_habits = set(itinerary.skipped_habit_ids)
    on_route = {r.customer_id for r in day.rows}
    wanted = list(dict.fromkeys(customer_ids))
    found = _customers(session, wanted)
    mine = [cid for cid in wanted if cid in found and found[cid].owner_user_id == user_id]
    labels = today_route.labels(session, user_id, mine) if mine else {}
    added: list[str] = []
    skipped: list[Skipped] = []
    for cid in wanted:
        customer = found.get(cid)
        if customer is None or customer.owner_user_id != user_id:
            skipped.append(Skipped(cid, customer.name if customer else cid, "不是你的客戶"))
            continue
        if cid in day.done_ids:
            skipped.append(Skipped(cid, customer.name, "今天已經去過了"))
            continue
        if cid in on_route:
            skipped.append(Skipped(cid, customer.name, "已經在今天的行程裡"))
            continue
        if len(open_) >= route_planner.MAX_OPEN_STOPS:
            skipped.append(Skipped(cid, customer.name, f"今天已經排了 {route_planner.MAX_OPEN_STOPS} 站"))
            continue
        new = _new_open(customer, source, labels[cid], day.habits)
        open_.insert(_cheapest_index(session, day, open_, new, precedences, skipped_habits), new)
        on_route.add(cid)
        added.append(customer.name)
        session.execute(delete(RouteSnooze).where(RouteSnooze.user_id == user_id, RouteSnooze.customer_id == cid))
    if added:
        _write(session, day, open_)
        _touch(itinerary)
    session.flush()
    if added:
        _prune_legs(session, itinerary)
    return itinerary, added, skipped


def preview(session: Session, user_id: str, draft: Draft, insert: str | None = None) -> ItineraryView:
    """調整清單上的改動算時間、車程與違反的規則，不存。insert 是「加一站」點的那一家：
    插在多繞最少、又不新增違反的位置，約的時間與停留照習慣給的預設值。
    車程一律用直線估算（畫面寫「估計」）：拖一下就算一次，每次都打 Google 太貴；按「完成」存好之後讀到的才是正式的車程。"""
    itinerary = get_or_create(session, user_id)
    day = _day(session, itinerary)
    open_, precedences, skipped, pending = _resolve(session, day, draft)
    if insert is not None:
        open_ = _inserted(session, day, open_, insert, precedences, skipped, pending)
    return _compose(session, day, open_, precedences, skipped, _reasons(itinerary, skipped), pending, estimate=True)


def save(session: Session, user_id: str, version: int, draft: Draft, habit_source: str = "prompt") -> Itinerary:
    """調整清單按「完成」：整份還沒跑的站、今天的先後、今天不套用的習慣、這次答應要記的習慣一次存進去。
    存的時候順序還違反的規則以今天排的為準（設計〈已定案的決定〉第 8 點）：習慣記成今天不套用，今天的先後拿掉。
    habit_source：答應要記的習慣從哪裡來（調整清單是 prompt，跟熊熊滾說的是 ai）；draft.disabled_habit_ids
    裡這位業務的習慣停用。"""
    itinerary = get_or_create(session, user_id)
    _lock(session, itinerary)
    if itinerary.version != version:
        raise VersionConflict
    day = _day(session, itinerary)
    open_, precedences, skipped, pending = _resolve(session, day, draft)
    for habit in route_habits.mine(session, day.rep.id):
        if habit.id in draft.disabled_habit_ids:
            habit.active = False
    reasons = _reasons(itinerary, skipped)
    for item in pending:
        habit = route_habits.create(session, day.rep.id, item.spec, habit_source)
        if route_habits.applies_on(habit, itinerary.date):
            day.habits.append(habit)
            if item.skip_today:
                skipped.add(habit.id)
                reasons[str(habit.id)] = SKIP_BY_REP
    order = [o.customer.id for o in open_]
    for rule in route_planner.violations(order, _rules(open_, precedences, day.habits, skipped)):
        kind, _, key = rule.id.partition(":")
        if kind == "habit":
            skipped.add(int(key))
            reasons[key] = SKIP_BY_ORDER
        elif kind == "today":
            precedences.remove(rule.customer_ids)
    _write(session, day, open_)
    session.execute(delete(ItineraryPrecedence).where(ItineraryPrecedence.itinerary_id == itinerary.id))
    if precedences:
        # 用 Core 寫：同一個 session 裡可能已經載入過舊的那幾列，ORM 物件會撞到 identity map
        session.execute(insert(ItineraryPrecedence).values([
            {"itinerary_id": itinerary.id, "before_customer_id": a, "after_customer_id": b} for a, b in precedences
        ]))
    itinerary.skipped_habit_ids = sorted(skipped)
    itinerary.skip_reasons = {str(i): reasons[str(i)] for i in sorted(skipped)}
    _touch(itinerary)
    session.flush()
    _prune_legs(session, itinerary)
    return itinerary


def candidates(
    session: Session, user_id: str, order: list[str] | None = None, locked: Sequence[str] = ()
) -> Candidates:
    """加一站的候選：自己的客戶，草稿上已經有的、今天跑過的不列。順路的前幾家照估算的多繞分鐘數排
    （插的位置跟真的加的時候一樣，用 cheapest_insert），其他照名稱排。order、locked 是調整清單上目前
    還沒跑的站與鎖住的站，沒給 order 就用存著的。車程一律用直線估算：一次要算約 50 家，加進去之後才用正式的車程重算。"""
    itinerary = get_or_create(session, user_id)
    day = _day(session, itinerary)
    saved = {o.customer.id: o for o in _saved_open(session, day)}
    mine = list(session.scalars(select(Customer).where(Customer.owner_user_id == day.rep.id).order_by(Customer.name)))
    own = {c.id: c for c in mine}
    ids = [
        cid for cid in dict.fromkeys(order if order is not None else list(saved))
        if cid not in day.done_ids and (cid in saved or cid in own)
    ]
    # 沒給 order 就是存著的那份：鎖住的站也照存著的，不然「需立即處理」那家的鎖會被忽略，
    # 插入位置就會跟 preview／_inserted 用的真鎖算出不一樣的站號
    held = set(locked) | ({cid for cid, o in saved.items() if o.locked} if order is None else set())
    open_ = [
        dataclasses.replace(saved[cid], locked=cid in held) if cid in saved
        else _new_open(own[cid], "rep", ("routine", ""), day.habits, locked=cid in held)
        for cid in ids
    ]
    pool = [c for c in mine if c.id not in ids and c.id not in day.done_ids]
    full = len(open_) >= route_planner.MAX_OPEN_STOPS
    nearby: list[Candidate] = []
    if pool and not full:
        start, points = _points(
            session, day.rep, itinerary.date, day.done, day.durations(), [*(o.customer for o in open_), *pool]
        )
        minutes = _estimated(points, day.rep.travel_mode).minutes
        ordered = [o.plan_stop(n + 1) for n, o in enumerate(open_)]
        base = route_planner.schedule(start, 0, ordered, minutes).travel_minutes
        precedences = [(a, b) for a, b in _precedences(session, itinerary) if a in ids and b in ids]
        skipped = set(itinerary.skipped_habit_ids)
        locks = _locks(open_, len(day.done))
        scored = []
        for k, customer in enumerate(pool):
            new = _new_open(customer, "rep", ("routine", ""), day.habits)
            stop = new.plan_stop(len(open_) + 1 + k)
            rules = _rules([*open_, new], precedences, day.habits, skipped) + locks
            index = route_planner.cheapest_insert(start, 0, ordered, stop, rules, minutes)
            trial = [*ordered[:index], stop, *ordered[index:]]
            extra = route_planner.schedule(start, 0, trial, minutes).travel_minutes - base
            scored.append((extra, customer.name, customer, len(day.done) + index))
        scored.sort(key=lambda item: (item[0], item[1]))
        best = scored[:NEARBY]
        labels = today_route.labels(session, day.rep.id, [c.id for _, _, c, _ in best])
        nearby = [
            Candidate(c.id, c.name, c.type, c.area, labels.get(c.id, ("routine", ""))[0], after, extra)
            for extra, _, c, after in best
        ]
    near = {c.customer_id for c in nearby}
    others = [Candidate(c.id, c.name, c.type, c.area) for c in pool if c.id not in near]
    return Candidates(nearby, others, full)


def today_skips(session: Session, user_id: str) -> dict[int, str]:
    """今天的行程裡今天不套用的習慣與原因（習慣頁用）。今天還沒建行程就是沒有，也不為了這個去建。"""
    found = _find(session, user_id, customer_profile.app_today(session))
    if found is None:
        return {}
    return {int(key): reason for key, reason in _reasons(found, set(found.skipped_habit_ids)).items()}


def draft_of(session: Session, itinerary: Itinerary) -> Draft:
    """存著的行程換成草稿（跟前端 lib/itinerary.ts 的 draftFrom 一樣）：還沒跑的站照存著的順序，先後與今天不套用的習慣照舊。"""
    day = _day(session, itinerary)
    return Draft(
        stops=[_draft_stop(o) for o in _saved_open(session, day)],
        precedences=_precedences(session, itinerary),
        skipped_habit_ids=sorted(itinerary.skipped_habit_ids),
    )


def with_stop(session: Session, itinerary: Itinerary, draft: Draft, customer_id: str) -> Draft:
    """草稿加一家，插在多繞最少、又不新增違反的位置；約的時間與停留照習慣給的預設值。
    用正式的車程（跟熊熊滾說的提案，順序由程式挑）。不合（不是自己的客戶、已經在行程裡、今天去過了、已經 8 站）丟 InvalidDraft。"""
    day = _day(session, itinerary)
    open_, precedences, skipped, pending = _resolve(session, day, draft)
    open_ = _inserted(
        session, day, open_, customer_id, precedences, skipped, pending, source=draft.new_source, estimate=False,
    )
    by_id = {s.customer_id: s for s in draft.stops}
    return dataclasses.replace(draft, stops=[by_id.get(o.customer.id) or _draft_stop(o) for o in open_])


def optimized(session: Session, itinerary: Itinerary, draft: Draft) -> Optimized:
    """草稿整條重排（「幫我排順一點」、跟熊熊滾說要排順路）：守住今天的先後、習慣與鎖住的位置，晚到最少、車程最短。
    順序由程式挑，用 travel.matrix。排不出來時回擋住的那幾條規則。現在的順序已經一樣好就不動。"""
    day = _day(session, itinerary)
    open_, precedences, skipped, pending = _resolve(session, day, draft)
    durations = day.durations() | {o.customer.id: o.duration_minutes for o in open_}
    start, points = _points(session, day.rep, itinerary.date, day.done, durations, [o.customer for o in open_])
    matrix = travel.matrix(points, day.rep.travel_mode)
    stops = [o.plan_stop(n + 1) for n, o in enumerate(open_)]
    rules = _rules(open_, precedences, day.habits, skipped, pending) + _locks(open_, len(day.done))
    result = route_planner.plan(start, 0, stops, rules, matrix.minutes)
    if isinstance(result, route_planner.Conflict):
        return Optimized(None, [rule.text for rule in result.rules], [])
    order = [slot.customer_id for slot in result.slots]
    # 現在的順序已經守住規則、而且一樣好（同分的排法不只一種）：不要為了換而換
    current = [s.customer_id for s in stops]
    now = route_planner.schedule(start, 0, stops, matrix.minutes)
    if not route_planner.violations(current, rules) and (now.late_minutes, now.travel_minutes) <= (
        result.late_minutes, result.travel_minutes
    ):
        order = current
    index = {o.customer.id: n + 1 for n, o in enumerate(open_)}

    def km(ids: list[str]) -> float:
        path = [0, *(index[cid] for cid in ids)]
        return sum(matrix.km[a][b] for a, b in zip(path, path[1:]))

    costs = [
        _cost_line(cost, km(order) - km(cost.without))
        for cost in route_planner.rule_costs(start, 0, stops, rules, matrix.minutes)
    ]
    by_id = {o.customer.id: _draft_stop(o) for o in open_}
    return Optimized(dataclasses.replace(draft, stops=[by_id[cid] for cid in order]), [], costs)


def shown(session: Session, itinerary: Itinerary, draft: Draft) -> ItineraryView:
    """草稿照正式車程算的樣子（提案的「改成」）：時間、車程、規則與違反，不存。"""
    day = _day(session, itinerary)
    open_, precedences, skipped, pending = _resolve(session, day, draft)
    return _compose(session, day, open_, precedences, skipped, _reasons(itinerary, skipped), pending)


def broken_rules(session: Session, itinerary: Itinerary, draft: Draft) -> list[str]:
    """草稿的順序違反哪幾條規則（id），只看順序、不算車程。"""
    day = _day(session, itinerary)
    open_, precedences, skipped, pending = _resolve(session, day, draft)
    rules = _rules(open_, precedences, day.habits, skipped, pending)
    return [rule.id for rule in route_planner.violations([o.customer.id for o in open_], rules)]


def set_leg_mode(session: Session, user_id: str, from_id: str | None, to_id: str, mode: str, version: int) -> Itinerary:
    """改一段路的交通方式（首頁的膠囊）。只能改還沒走的段（到的那家還沒跑）；from_id 是 None 代表從辦公室出發。
    跟業務的預設一樣就不存（原本另外選的那一列刪掉），不一樣才存一列；同一段只會有一列。"""
    if mode not in LEG_MODES:
        raise ValueError(mode)
    itinerary = get_or_create(session, user_id)
    _lock(session, itinerary)
    if itinerary.version != version:
        raise VersionConflict
    day = _day(session, itinerary)
    _leg_index(day, _saved_open(session, day), from_id, to_id)
    session.execute(delete(ItineraryLeg).where(
        ItineraryLeg.itinerary_id == itinerary.id,
        ItineraryLeg.from_customer_id.is_not_distinct_from(from_id),
        ItineraryLeg.to_customer_id == to_id,
    ))
    if mode != day.rep.travel_mode:
        session.add(ItineraryLeg(itinerary_id=itinerary.id, from_customer_id=from_id, to_customer_id=to_id, mode=mode))
    _touch(itinerary)
    session.flush()
    return itinerary


def leg_options(session: Session, user_id: str, from_id: str | None, to_id: str) -> list[travel.Option]:
    """這一段四種交通方式各要多久（膠囊的選單）。跟 set_leg_mode 一樣只能問還沒走的段；只讀，不鎖、不比版本。"""
    itinerary = get_or_create(session, user_id)
    day = _day(session, itinerary)
    open_ = _saved_open(session, day)
    n = _leg_index(day, open_, from_id, to_id)
    _, points = _points(session, day.rep, itinerary.date, day.done, day.durations(), [o.customer for o in open_])
    return travel.options(points[n], points[n + 1])


def reset_today(session: Session, user_id: str) -> None:
    """IT 用：刪掉這位業務今天的行程（站、先後與另外選的段跟著 ON DELETE CASCADE 一起刪）、所有的暫緩與訊號權重，
    排序習慣也回到一開始那三條（route_habits.DEMO_HABITS），下次讀取就照模型的建議重新建一份。

    示範業務的行程給所有用第三方登入的評審共用：系統日期固定在決賽日不會換天，行程第一次建好之後
    就一直是存著的那份，按過的暫緩、調整過的權重、加的或停用的習慣也會一直留著、累積影響之後的建議。
    換一批評審之前，IT 用這個清掉，回到當天早上模型原本的建議。
    """
    today = customer_profile.app_today(session)
    session.execute(delete(Itinerary).where(Itinerary.user_id == user_id, Itinerary.date == today))
    session.execute(delete(RouteSnooze).where(RouteSnooze.user_id == user_id))
    session.execute(delete(RouteSignalWeight).where(RouteSignalWeight.user_id == user_id))
    route_habits.reset_demo(session, user_id)
    rep = session.get(AppUser, user_id)
    if rep is not None:
        rep.travel_mode = "drive"


def set_travel_mode(session: Session, user_id: str, mode: str) -> Itinerary:
    """換整天的預設交通方式：存在行程主人身上，之後每天的建議、加一站、排順路與車程都照它算。
    今天的行程換一版：順序是存著的、不動，時間照新的交通方式重算；換版讓還沒套用的提案作廢、主管頁跟著更新。
    今天另外選的段全部刪掉：那些是跟舊的預設比才另外存的，換了預設就每一段都照新的。
    要照新的方式重排順路，按「幫我排順一點」。"""
    if mode not in TRAVEL_MODES:
        raise ValueError(mode)
    itinerary = get_or_create(session, user_id)
    _lock(session, itinerary)
    rep = session.get(AppUser, user_id)
    if rep.travel_mode != mode:
        rep.travel_mode = mode
        session.execute(delete(ItineraryLeg).where(ItineraryLeg.itinerary_id == itinerary.id))
        _touch(itinerary)
    return itinerary


def _find(session: Session, user_id: str, today: dt.date) -> Itinerary | None:
    return session.scalar(select(Itinerary).where(Itinerary.user_id == user_id, Itinerary.date == today))


def _lock(session: Session, itinerary: Itinerary) -> None:
    """鎖住這份行程、重新讀一次。兩個人同時改同一位業務的行程：後到的等前一個存完，再看到版本已經變了。
    讀到之後、鎖住之前行程被刪掉了（IT 重置示範業務的行程）：當成版本對不上，畫面重新載入就會照建議再建一份。
    不用 session.refresh：那支找不到列時丟的例外（InvalidRequestError）太籠統，連「物件不是 persistent」
    「交易狀態已經壞了」這類跟列被刪掉無關的錯誤都會一起被當成版本衝突吞掉。改自己查一次、鎖住、
    刷新同一個 identity map 裡的物件（populate_existing），查無此列才是真的被刪了。"""
    ident = inspect(itinerary).identity[0]  # 不會碰資料庫：物件過期了也拿得到 id
    found = session.scalars(
        select(Itinerary).where(Itinerary.id == ident).with_for_update().execution_options(populate_existing=True)
    ).first()
    if found is None:
        raise VersionConflict


def _create(session: Session, rep: AppUser, today: dt.date) -> Itinerary:
    picked = today_route.pick(session, rep.id, today_route.load_feedback(session, rep.id, today))
    items = {item["candidate"].customer_id: item for item in picked.picked}
    customers = _customers(session, list(items))
    habits = route_habits.for_day(session, rep.id, today)
    urgent_id = picked.urgent.customer_id if picked.urgent else None
    open_ = [
        _new_open(customers[cid], "model", (item["signal"], item["reason"]), habits, locked=cid == urgent_id)
        for cid, item in items.items()
    ]
    start, points = _points(session, rep, today, picked.done, {}, [o.customer for o in open_])
    # 順序還要由程式挑：要整張車程矩陣
    minutes = travel.matrix(points, rep.travel_mode).minutes
    stops = [o.plan_stop(n + 1) for n, o in enumerate(open_)]
    locks = []
    if picked.urgent:
        # 「需立即處理」那家鎖在第一站，其他照順路排；業務之後可以拖走或解鎖
        locks.append(route_planner.Rule(
            id=f"lock:{urgent_id}", text=f"{picked.urgent.customer_name} 排第一站",
            kind="lock", customer_ids=(urgent_id,), position=0,
        ))
    result, skipped, reasons = _fit_habits(start, stops, locks, habits, [o.customer for o in open_], minutes)
    # 只剩鎖也排不出來（不會發生）就照模型挑的順序
    order = [s.customer_id for s in result.slots] if isinstance(result, route_planner.Schedule) else list(items)
    by_id = {o.customer.id: o for o in open_}
    itinerary = Itinerary(
        user_id=rep.id, date=today,
        suggested=[{"customer_id": cid, "signal": items[cid]["signal"], "reason": items[cid]["reason"]} for cid in order],
        urgent=dataclasses.asdict(picked.urgent) if picked.urgent else None,
        skipped_habit_ids=skipped, skip_reasons=reasons,
    )
    session.add(itinerary)
    session.flush()
    session.add_all([_row(itinerary, n, by_id[cid]) for n, cid in enumerate(order)])
    session.flush()
    return itinerary


def _fit_habits(
    start: dt.datetime, stops: list[route_planner.PlanStop], locks: list[route_planner.Rule], habits: list[RouteHabit],
    customers: list[Customer], minutes: list[list[int]],
) -> tuple[route_planner.Schedule | route_planner.Conflict, list[int], dict[str, str]]:
    """每天建立建議：守住鎖與今天套用的習慣排順路。排不出來就一條一條把真的卡住的習慣記成今天不套用，直到排得出來。

    候選（真的卡住的那幾條，不是陪榜的）：優先找拿掉哪一條習慣單獨就能解決——自己一條一條試，不能直接拿
    `route_planner.plan` 的 `Conflict.rules`：那支排不出單一條擋住的規則時，會把當下所有規則整組一起回報，
    跟「真的只有這一條單獨擋住」沒辦法從回傳值分辨，直接當候選會錯殺沒參與衝突的習慣。找不到單獨一條，
    就找跟別的規則（另一條習慣或鎖）兩兩對沖的習慣；兩種都找不到（三條以上的習慣綁在一起才卡住，沒有兩兩對沖）
    才把目前還套用的習慣全部當候選。

    候選裡最舊的那條先記成今天不套用；原因寫它跟哪一條衝突：先找比它新的習慣（新的優先，只找更新的，
    舊的在更早的回合就處理過了），再找鎖住的站。回傳 (排的結果, 今天不套用的習慣, 原因)。"""
    by_key = {f"habit:{h.id}": h for h in habits}
    groups: dict[str, list[route_planner.Rule]] = {}
    entries = [(key, route_habits.spec_of(h), h.text) for key, h in by_key.items()]
    for rule in [*locks, *route_habits.rules(entries, customers)]:
        groups.setdefault(rule.id, []).append(rule)

    def age(key: str) -> tuple[dt.datetime, int]:
        return by_key[key].created_at, by_key[key].id

    def feasible(rules: list[route_planner.Rule]) -> bool:
        return isinstance(route_planner.plan(start, 0, stops, rules, minutes), route_planner.Schedule)

    skipped: list[int] = []
    reasons: dict[str, str] = {}
    while True:
        live = {key: rules for key, rules in groups.items() if key not in by_key or by_key[key].id not in skipped}
        live_rules = [r for rules in live.values() for r in rules]
        result = route_planner.plan(start, 0, stops, live_rules, minutes)
        if isinstance(result, route_planner.Schedule):
            return result, skipped, reasons
        live_habits = [key for key in live if key in by_key]
        single = [key for key in live_habits if feasible([r for k, rs in live.items() if k != key for r in rs])]
        candidates = single or [
            key for key in live_habits if any(not feasible(live[key] + live[other]) for other in live if other != key)
        ] or live_habits
        if not candidates:
            return result, skipped, reasons
        oldest = min(candidates, key=age)
        others = sorted((k for k in live_habits if k != oldest and age(k) > age(oldest)), key=age, reverse=True)
        others += [k for k in live if k not in by_key]
        partner = next((k for k in others if not feasible(live[oldest] + live[k])), None)
        skipped.append(by_key[oldest].id)
        reasons[str(by_key[oldest].id)] = f"跟『{live[partner][0].text}』衝突" if partner else "跟其他幾條一起排不出來"


def _resolve(
    session: Session, day: _Day, draft: Draft
) -> tuple[list[_Open], list[tuple[str, str]], set[int], list[PendingHabit]]:
    """草稿換成 _Open 並檢查。剛跑完的站以伺服器為準：確認拜訪不會改版本，畫面上可能還把它當成還沒跑的站，
    送來的就略過；畫面上拿掉了也不刪（見 _write）。新加的站要是自己的客戶；先後只留兩家都在的；
    今天不套用的只留這位業務自己的習慣。要停用的習慣從 day.habits 拿掉，之後算規則就不算它。"""
    by_row = {r.customer_id: r for r in day.rows}
    stops = [s for s in draft.stops if s.customer_id not in day.done_ids]
    ids = [s.customer_id for s in stops]
    if len(set(ids)) != len(ids):
        raise InvalidDraft("同一家不能排兩次")
    if len(ids) > route_planner.MAX_OPEN_STOPS:
        raise InvalidDraft(TOO_MANY)
    if any((s.window_kind is None) != (s.window_time is None) for s in stops):
        raise InvalidDraft("約的時間要選幾點到、以前或以後，再填時間")
    customers = _customers(session, ids)
    new_ids = [cid for cid in ids if cid not in by_row]
    if any(cid not in customers or customers[cid].owner_user_id != day.rep.id for cid in new_ids):
        raise InvalidDraft("只能排自己的客戶")
    labels = today_route.labels(session, day.rep.id, new_ids) if new_ids else {}
    open_ = []
    for stop in stops:
        row = by_row.get(stop.customer_id)
        source, signal, reason = (row.source, row.signal, row.reason) if row else (draft.new_source, *labels[stop.customer_id])
        open_.append(_Open(
            customers[stop.customer_id], source, signal, reason, stop.duration_minutes, stop.window_kind,
            stop.window_time, (stop.note or "").strip() or None, stop.locked,
        ))
    present = set(ids)
    precedences = list(dict.fromkeys(
        (a, b) for a, b in draft.precedences if a != b and a in present and b in present
    ))
    mine = {habit.id for habit in route_habits.mine(session, day.rep.id)}
    skipped = {i for i in draft.skipped_habit_ids if i in mine}
    # 要停用的習慣：今天的規則就不算它（存檔時才真的停用，見 save）
    disabled = {i for i in draft.disabled_habit_ids if i in mine}
    day.habits = [h for h in day.habits if h.id not in disabled]
    if draft.habits:
        options = route_habits.targets(session, day.rep.id)
        for item in draft.habits:
            try:
                route_habits.validate(item.spec, options)
            except route_habits.InvalidHabit as exc:
                raise InvalidDraft(str(exc)) from None
    return open_, precedences, skipped, list(draft.habits)


def _inserted(
    session: Session, day: _Day, open_: list[_Open], customer_id: str, precedences: list[tuple[str, str]],
    skipped: set[int], pending: Sequence[PendingHabit], source: str = "rep", estimate: bool = True,
) -> list[_Open]:
    """「加一站」點的那一家插進草稿：多繞最少、又不新增違反的位置。
    source：新的一家記成誰加的；estimate：用直線估算（調整清單的「加一站」）還是正式的車程（跟熊熊滾說的提案）。"""
    if any(o.customer.id == customer_id for o in open_):
        raise InvalidDraft("已經在今天的行程裡")
    if customer_id in day.done_ids:
        raise InvalidDraft("今天已經去過了")
    if len(open_) >= route_planner.MAX_OPEN_STOPS:
        raise InvalidDraft(TOO_MANY)
    customer = session.get(Customer, customer_id)
    if customer is None or customer.owner_user_id != day.rep.id:
        raise InvalidDraft("只能排自己的客戶")
    # 草稿上拿掉、又加回來的那一家：來源與理由照存著的
    row = next((r for r in day.rows if r.customer_id == customer_id), None)
    label = (row.signal, row.reason) if row else today_route.labels(session, day.rep.id, [customer_id])[customer_id]
    new = _new_open(customer, row.source if row else source, label, day.habits)
    index = _cheapest_index(session, day, open_, new, precedences, skipped, pending, estimate=estimate)
    return [*open_[:index], new, *open_[index:]]


def _estimated(points: list[travel.Point], mode: TravelMode, modes: Sequence[TravelMode] = ()) -> travel.Matrix:
    """直線估算的車程矩陣：相鄰的段照 modes（每段的交通方式，沒給就照 mode），其他格子照 mode。
    調整清單的 preview（拖一下就算一次）與加一站的候選（一次約 50 家）只用估算，不打 Google。"""
    return travel.fill(points, {}, google=False, mode=mode, modes=modes)


def _draft_stop(stop: _Open) -> DraftStop:
    return DraftStop(
        stop.customer.id, stop.duration_minutes, stop.window_kind, stop.window_time, stop.note, stop.locked,
    )


def _cost_line(cost: route_planner.RuleCost, extra_km: float) -> str:
    """對照卡上一條規則的代價：「守住『德安藥局 · 板橋 排在 佑生藥局 · 大安 前面』，比不守多繞 6 公里、15 分鐘」。"""
    parts = []
    if cost.travel_minutes > 0:
        parts.append(f"多繞 {max(round(extra_km, 1), 0):g} 公里、{cost.travel_minutes} 分鐘")
    if cost.late_minutes > 0:
        parts.append(f"多晚到 {cost.late_minutes} 分")
    return f"守住『{cost.rule.text}』，比不守" + "，".join(parts)


def _day(session: Session, itinerary: Itinerary) -> _Day:
    rep = session.get(AppUser, itinerary.user_id)
    return _Day(
        itinerary=itinerary, rep=rep, done=today_route.done_visits(session, rep.id, itinerary.date),
        rows=_rows(session, itinerary), habits=route_habits.for_day(session, rep.id, itinerary.date),
    )


def _saved_open(session: Session, day: _Day) -> list[_Open]:
    """存著的還沒跑的站，照存著的順序。"""
    rows = [r for r in day.rows if r.customer_id not in day.done_ids]
    customers = _customers(session, [r.customer_id for r in rows])
    return [
        _Open(customers[r.customer_id], r.source, r.signal, r.reason, r.duration_minutes, r.window_kind,
              r.window_time, r.note, r.locked)
        for r in rows
    ]


def _new_open(
    customer: Customer, source: str, label: tuple[str, str], habits: list[RouteHabit], locked: bool = False
) -> _Open:
    """新加進來的一站：約的時間與停留照習慣給的預設值，沒有就不約、停 40 分鐘。"""
    window, duration = route_habits.defaults(habits, customer)
    signal, reason = label
    return _Open(
        customer, source, signal, reason, duration or DEFAULT_DURATION, window[0] if window else None,
        window[1] if window else None, None, locked,
    )


def _row(itinerary: Itinerary, position: int, stop: _Open) -> ItineraryStop:
    return ItineraryStop(
        itinerary_id=itinerary.id, position=position, customer_id=stop.customer.id, source=stop.source,
        signal=stop.signal, reason=stop.reason, duration_minutes=stop.duration_minutes,
        window_kind=stop.window_kind, window_time=stop.window_time, note=stop.note, locked=stop.locked,
    )


def _precedences(session: Session, itinerary: Itinerary) -> list[tuple[str, str]]:
    """今天設的先後 (前, 後)。"""
    return [
        (before, after)
        for before, after in session.execute(
            select(ItineraryPrecedence.before_customer_id, ItineraryPrecedence.after_customer_id)
            .where(ItineraryPrecedence.itinerary_id == itinerary.id)
            .order_by(ItineraryPrecedence.before_customer_id, ItineraryPrecedence.after_customer_id)
        )
    ]


def _start(
    session: Session, rep: AppUser, today: dt.date, done: list[tuple[Visit, Customer]], durations: dict[str, int]
) -> tuple[dt.datetime, travel.Point | None]:
    """從哪裡、幾點出發。還沒跑任何一站：區處辦公室 09:30；跑過了：最後完成那一站，拜訪時間加停留之後。
    區處沒有位置（組織管理新開的區）時回 None，呼叫端改從第一站出發。"""
    if done:
        visit, customer = done[-1]
        minutes = durations.get(customer.id, DEFAULT_DURATION)
        return visit.visited_at.astimezone(TAIPEI) + dt.timedelta(minutes=minutes), _point(customer)
    return dt.datetime.combine(today, today_route.FIRST_STOP, TAIPEI), office(session, rep)


def _points(
    session: Session, rep: AppUser, today: dt.date, done: list[tuple[Visit, Customer]], durations: dict[str, int],
    customers: list[Customer],
) -> tuple[dt.datetime, list[travel.Point]]:
    """出發時間與要算車程的點：第 0 點是出發點，第 n + 1 點是 customers 的第 n 家。區處沒有位置時從第一家出發。"""
    start, origin = _start(session, rep, today, done, durations)
    points = [_point(c) for c in customers]
    return start, [origin or (points[0] if points else (0.0, 0.0)), *points]


def _timed(
    points: list[travel.Point], mode: TravelMode, modes: list[TravelMode], estimate: bool = False,
) -> travel.Matrix:
    """照這個順序跑的車程（順序已經定了：讀取、調整清單的 preview 與存檔）。只會用到相鄰兩點
    （第 n 點到第 n + 1 點）那幾格，所以用 travel.along 照每段的交通方式問 Google，不必問整份矩陣；
    回來的 estimated 跟著 Google 有沒有給（畫面的「（估計）」／Google Maps）。
    順序還要由程式挑的地方（每天的建議、插入新的一站、排順路）直接用 travel.matrix：along 不相鄰的格子是估算的。
    mode：行程主人的預設交通方式；modes：每一段實際用的（_leg_modes）。estimate：只要直線估算（調整清單的 preview）。"""
    return _estimated(points, mode, modes) if estimate else travel.along(points, modes)


def _rules(
    open_: list[_Open], precedences: list[tuple[str, str]], habits: list[RouteHabit], skipped: set[int],
    pending: Sequence[PendingHabit] = (),
) -> list[route_planner.Rule]:
    """還沒跑的站要守的規則：今天設的先後、今天套用的習慣（今天不套用的除外）、這次答應要記的習慣
    （id 是 new: 加上它在草稿裡的順序）。不含鎖住的位置（見 _locks）。"""
    customers = [o.customer for o in open_]
    names = {c.id: c.name for c in customers}
    today = [
        route_planner.Rule(
            id=f"today:{a}>{b}",
            text=route_habits.describe(
                route_habits.HabitSpec("precedence", {"by": "customer", "value": a}, {"by": "customer", "value": b}),
                names,
            ),
            kind="precedence", customer_ids=(a, b),
        )
        for a, b in precedences if a in names and b in names
    ]
    entries = [(f"habit:{h.id}", route_habits.spec_of(h), h.text) for h in habits if h.id not in skipped]
    entries += [
        (f"new:{i}", p.spec, route_habits.describe(p.spec, names)) for i, p in enumerate(pending) if not p.skip_today
    ]
    return today + route_habits.rules(entries, customers)


def _locks(open_: list[_Open], done: int) -> list[route_planner.Rule]:
    """鎖住的站在還沒跑的站裡的位置，排順路與插入新的一站時不動。done 是跑完幾站，寫那句話的站號用。"""
    return [
        route_planner.Rule(
            id=f"lock:{o.customer.id}", text=f"{o.customer.name} 鎖在第 {done + n + 1} 站",
            kind="lock", customer_ids=(o.customer.id,), position=n,
        )
        for n, o in enumerate(open_) if o.locked
    ]


def _cheapest_index(
    session: Session, day: _Day, open_: list[_Open], new: _Open, precedences: list[tuple[str, str]], skipped: set[int],
    pending: Sequence[PendingHabit] = (), estimate: bool = False,
) -> int:
    """新的一站插在還沒跑的站的第幾個位置：多繞最少、又不新增違反（鎖、今天的先後、習慣）。
    estimate：只要直線估算，不打 Google（調整清單的 preview／「加一站」）。候選（candidates）也是用估算算出
    同一家會插在第幾站，兩邊要用同一種車程，不然 Google 的矩陣跟估算的矩陣算出來的位置可能不一樣。"""
    customers = [o.customer for o in open_] + [new.customer]
    durations = day.durations() | {o.customer.id: o.duration_minutes for o in open_}
    start, points = _points(session, day.rep, day.itinerary.date, day.done, durations, customers)
    mode = day.rep.travel_mode
    matrix = _estimated(points, mode) if estimate else travel.matrix(points, mode)
    ordered = [o.plan_stop(n + 1) for n, o in enumerate(open_)]
    rules = _rules([*open_, new], precedences, day.habits, skipped, pending) + _locks(open_, len(day.done))
    return route_planner.cheapest_insert(start, 0, ordered, new.plan_stop(len(open_) + 1), rules, matrix.minutes)


def _write(session: Session, day: _Day, open_: list[_Open]) -> None:
    """還沒跑的站照 open_ 寫回去：拿掉的刪（連今天的先後一起刪）、新的加、其他照 open_ 改欄位與順序；
    跑完的站排最前面、不動。拿掉的是「需立即處理」那家，紅卡跟著收起來。"""
    keep = {o.customer.id for o in open_}
    by_customer = {r.customer_id: r for r in day.rows}
    for row in day.rows:
        if row.customer_id not in keep and row.customer_id not in day.done_ids:
            _remove(session, day.itinerary, row)
    ordered = []
    for o in open_:
        row = by_customer.get(o.customer.id)
        if row is None:
            row = _row(day.itinerary, 0, o)
            session.add(row)
        else:
            row.duration_minutes, row.note, row.locked = o.duration_minutes, o.note, o.locked
            row.window_kind, row.window_time = o.window_kind, o.window_time
        ordered.append(row)
    _renumber([r for r in day.rows if r.customer_id in day.done_ids] + ordered)
    urgent = day.itinerary.urgent
    if urgent and urgent["customer_id"] not in keep and urgent["customer_id"] not in day.done_ids:
        day.itinerary.urgent = None


def _compose(
    session: Session, day: _Day, open_: list[_Open], precedences: list[tuple[str, str]], skipped: set[int],
    reasons: dict[str, str], pending: Sequence[PendingHabit], estimate: bool = False,
) -> ItineraryView:
    itinerary, rep = day.itinerary, day.rep
    durations = day.durations() | {o.customer.id: o.duration_minutes for o in open_}
    start, points = _points(session, rep, itinerary.date, day.done, durations, [o.customer for o in open_])
    # 每一段的交通方式（辦公室 → 跑完的站 → 還沒跑的站）；算時間只要還沒跑的那幾段，第一段從出發點過來
    modes = _leg_modes(session, day, _chain(day, open_))
    ahead = modes[len(day.done):]
    matrix = _timed(points, rep.travel_mode, ahead, estimate)
    planned = route_planner.schedule(start, 0, [o.plan_stop(n + 1) for n, o in enumerate(open_)], matrix.minutes)
    rules = _rules(open_, precedences, day.habits, skipped, pending)
    order = [o.customer.id for o in open_]
    applied = [h for h in day.habits if h.id not in skipped]
    habit_customers: dict[int, set[str]] = {}
    for r in rules:
        kind, _, key = r.id.partition(":")
        if kind == "habit":
            habit_customers.setdefault(int(key), set()).update(r.customer_ids)

    by_row = {r.customer_id: r for r in day.rows}
    stops = []
    for k, (visit, customer) in enumerate(day.done):
        row = by_row.get(customer.id)
        stops.append(StopView(
            customer_id=customer.id, customer_name=customer.name, type=customer.type, grade=customer.grade,
            planned_time=visit.visited_at.astimezone(TAIPEI).strftime("%H:%M"), status="done",
            signal="routine", reason="已完成", visit_id=visit.id, source=row.source if row else "rep",
            duration_minutes=row.duration_minutes if row else DEFAULT_DURATION, late_minutes=0,
            travel_minutes=None, travel_km=None, note=row.note if row else None,
            travel_mode=modes[k], city=customer.city,
        ))
    total_km = 0.0
    for n, (o, slot) in enumerate(zip(open_, planned.slots, strict=True)):
        km = matrix.km[n][n + 1]
        total_km += km
        stops.append(StopView(
            customer_id=o.customer.id, customer_name=o.customer.name, type=o.customer.type, grade=o.customer.grade,
            planned_time=slot.arrive.strftime("%H:%M"), status="next" if n == 0 else "todo",
            signal=o.signal, reason=o.reason, visit_id=None, source=o.source,
            duration_minutes=o.duration_minutes, late_minutes=slot.late_minutes,
            travel_minutes=slot.travel_minutes, travel_km=km,
            window_kind=o.window_kind, window_time=o.window_time.strftime("%H:%M") if o.window_time else None,
            note=o.note, locked=o.locked, habit_ids=_habit_ids(applied, o, habit_customers),
            travel_estimated=matrix.estimated_legs[n], travel_mode=ahead[n], city=o.customer.city,
        ))
    open_ids = set(order)
    urgent = itinerary.urgent if itinerary.urgent and itinerary.urgent["customer_id"] in open_ids else None
    return ItineraryView(
        date=itinerary.date, rep=rep, version=itinerary.version, done=len(day.done), total=len(stops), urgent=urgent,
        stops=stops, travel_minutes=planned.travel_minutes, travel_km=round(total_km, 1),
        finish_time=planned.slots[-1].leave.strftime("%H:%M") if planned.slots else None,
        estimated=matrix.estimated, travel_mode=rep.travel_mode,
        rules=[RuleView(r.id, r.text, r.kind, r.id.split(":")[0], list(r.customer_ids)) for r in rules],
        violations=[r.id for r in route_planner.violations(order, rules)],
        precedences=[Precedence(a, b) for a, b in precedences if a in open_ids and b in open_ids],
        start_city=office_city(session, rep), office_start=office(session, rep) is not None,
        skipped_habits=[
            SkippedHabit(h.id, h.text, reasons[str(h.id)], reasons[str(h.id)] not in (SKIP_BY_REP, SKIP_BY_ORDER))
            for h in day.habits if h.id in skipped
        ],
    )


def _habit_ids(habits: list[RouteHabit], stop: _Open, rule_customers: dict[int, set[str]]) -> list[int]:
    """這一站套用了哪幾條習慣：先後、排第一、排最後今天真的排出規則、而且這一站在規則裡
    （rule_customers：habit id → 今天這條規則牽涉到的站；precedence 兩邊都符合的站不算，見 route_habits.rules），
    或約的時間、停留跟習慣給的一樣。"""
    found = []
    for habit in habits:
        if not route_habits.touches(route_habits.spec_of(habit), stop.customer):
            continue
        same_window = habit.kind == "window" and (stop.window_kind, stop.window_time) == (habit.window_kind, habit.window_time)
        same_stay = habit.kind == "duration" and stop.duration_minutes == habit.duration_minutes
        in_rule = habit.kind in route_habits.RULE_KINDS and stop.customer.id in rule_customers.get(habit.id, set())
        if in_rule or same_window or same_stay:
            found.append(habit.id)
    return found


def _reasons(itinerary: Itinerary, skipped: set[int]) -> dict[str, str]:
    """今天不套用的每一條習慣為什麼不套用：記過原因的照舊，其他（這次在紅框上按了「今天不套用」）寫成業務選的。"""
    saved = itinerary.skip_reasons or {}
    return {str(i): saved.get(str(i), SKIP_BY_REP) for i in skipped}


def _region(session: Session, rep: AppUser) -> OrgUnit | None:
    return session.scalar(select(OrgUnit).where(OrgUnit.kind == "region", OrgUnit.name == rep.region))


def _chain(day: _Day, open_: list[_Open]) -> list[str | None]:
    """今天走的順序：None 是辦公室，接著跑完的站（照拜訪時間）、還沒跑的站（照 open_）。相鄰兩個就是一段路。"""
    return [None, *(c.id for _, c in day.done), *(o.customer.id for o in open_)]


def _leg_modes(session: Session, day: _Day, chain: list[str | None]) -> list[TravelMode]:
    """chain 上每一段（相鄰兩個）的交通方式，共 len(chain) - 1 個：另外選過的照存著的那一列，其他是業務的預設。"""
    saved = {
        (from_id, to_id): mode
        for from_id, to_id, mode in session.execute(
            select(ItineraryLeg.from_customer_id, ItineraryLeg.to_customer_id, ItineraryLeg.mode)
            .where(ItineraryLeg.itinerary_id == day.itinerary.id)
        )
    }
    return [saved.get(leg, day.rep.travel_mode) for leg in zip(chain, chain[1:])]


def _leg_index(day: _Day, open_: list[_Open], from_id: str | None, to_id: str) -> int:
    """這一段是還沒跑的站的第幾段（0 是從出發點到下一站）；不是還沒走的一段丟 NotALeg。"""
    chain, done = _chain(day, open_), len(day.done)
    for n in range(len(open_)):
        if (chain[done + n], chain[done + n + 1]) == (from_id, to_id):
            return n
    raise NotALeg("這兩家現在不是還沒走的一段，請重新整理")


def _prune_legs(session: Session, itinerary: Itinerary) -> None:
    """刪掉不再相鄰的段：存檔、加一站、三顆鈕之後順序可能變了，換了順序的兩站不該沿用原本選的交通方式。
    跑完一站不會改到這裡（確認拜訪不動行程），讀的時候只看現在相鄰的段，所以留著的舊列也不會被用到。"""
    day = _day(session, itinerary)
    chain = _chain(day, _saved_open(session, day))
    keep = set(zip(chain, chain[1:]))
    gone = [
        leg_id
        for leg_id, from_id, to_id in session.execute(
            select(ItineraryLeg.id, ItineraryLeg.from_customer_id, ItineraryLeg.to_customer_id)
            .where(ItineraryLeg.itinerary_id == itinerary.id)
        )
        if (from_id, to_id) not in keep
    ]
    if gone:
        session.execute(delete(ItineraryLeg).where(ItineraryLeg.id.in_(gone)))


def _rows(session: Session, itinerary: Itinerary) -> list[ItineraryStop]:
    return list(session.scalars(
        select(ItineraryStop).where(ItineraryStop.itinerary_id == itinerary.id)
        .order_by(ItineraryStop.position, ItineraryStop.id)
    ))


def _customers(session: Session, ids: list[str]) -> dict[str, Customer]:
    return {c.id: c for c in session.scalars(select(Customer).where(Customer.id.in_(ids)))} if ids else {}


def _point(customer: Customer) -> travel.Point:
    return customer.lat, customer.lng


def _renumber(rows: list[ItineraryStop]) -> None:
    for n, row in enumerate(rows):
        row.position = n


def _remove(session: Session, itinerary: Itinerary, row: ItineraryStop) -> None:
    session.execute(delete(ItineraryPrecedence).where(
        ItineraryPrecedence.itinerary_id == itinerary.id,
        or_(ItineraryPrecedence.before_customer_id == row.customer_id,
            ItineraryPrecedence.after_customer_id == row.customer_id),
    ))
    session.delete(row)


def _snooze(session: Session, user_id: str, customer_id: str, until: dt.date) -> None:
    stmt = insert(RouteSnooze).values(user_id=user_id, customer_id=customer_id, until=until)
    session.execute(stmt.on_conflict_do_update(
        index_elements=["user_id", "customer_id"],
        set_={"until": func.greatest(RouteSnooze.until, stmt.excluded.until)},
    ))


def _adjust_weight(session: Session, user_id: str, signal: str, delta: int) -> None:
    stmt = insert(RouteSignalWeight).values(user_id=user_id, signal=signal, weight=delta)
    session.execute(stmt.on_conflict_do_update(
        index_elements=["user_id", "signal"], set_={"weight": RouteSignalWeight.weight + delta},
    ))


def _touch(itinerary: Itinerary) -> None:
    itinerary.version += 1
    itinerary.updated_at = func.now()
