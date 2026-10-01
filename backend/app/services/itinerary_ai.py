"""跟熊熊滾說要怎麼排（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈跟熊熊滾說要怎麼排：後端〉）。

AI 只負責聽懂話：Gemini 把一句話翻成固定格式的操作（schemas/itinerary_ops.schema.json），
順序一律由排序程式算（route_planner），AI 不可能排出違反規則的順序。
操作先驗證（只留這位業務自己的客戶與習慣，不合的轉成「找不到」），再在目前行程的草稿上依序做完，
算出「現在 → 改成」的對照卡，存成提案。業務按「套用」時，版本要跟算提案時一樣，
照存下來的操作在最新的行程上再做一次（不信前端傳來的內容），照調整清單存檔的規則寫進去。
"""

from __future__ import annotations

import datetime as dt
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.llm import LLM, get_llm
from app.models import Customer, Itinerary, ItineraryProposal, RouteHabit
from app.services import itinerary as itinerary_service
from app.services import route_habits, today_route

# 提案只留最近 7 天：套用要看當天的行程，舊的只剩下查問題時有用
PROPOSAL_RETENTION = dt.timedelta(days=7)
SCHEMA_FILE = Path(__file__).resolve().parents[1] / "schemas" / "itinerary_ops.schema.json"
SCHEMA: dict[str, Any] = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
WEEKDAY = "一二三四五六日"
WINDOW_WORD = {"at": "到", "before": "以前到", "after": "以後到"}
# 這幾種操作要動行程上的某一站
STOP_OPS = ("move", "remove", "set_window", "set_duration", "set_note", "lock", "unlock")
CUSTOMER_FIELDS = ("customer_id", "before", "after")

SYSTEM = """你是「熊熊滾」，幫醫藥業務調整今天的拜訪行程。你只負責聽懂業務說的話，把它翻成操作清單；順序由系統的排序程式算，你不用自己排。

規則：
- 客戶一律用下面清單裡的 id（customer_id、before、after、candidates）。清單裡沒有的店不要自己編 id，改用 not_found，mention 寫業務說的名字。
- 業務說的名字對到兩家以上（例如只說「康泰」），從上下文又看不出是哪一家：只回一個 ask_which，mention 寫他說的名字，candidates 列可能的客戶 id（最多 5 家），不要回其他操作。
- 「先去 A 再去 B」「A 要在 B 前面」：add_precedence（before 是 A、after 是 B），再加一個 optimize。
- 「幫我排順一點」「重排」「怎麼跑比較順」：optimize。
- 把某一家移到第幾站、移到某一家的前面或後面：move（to_position 是下面行程上的站號，從 1 起算、含已完成的站；或 before／after 寫另一家的 id）。
- 今天也要去、加一家：add；今天不去了：remove。
- 約時間：set_window（kind：at 幾點到、before 幾點以前、after 幾點以後、none 不約了；time 寫 24 小時制 HH:MM）。待多久：set_duration（minutes）。備註：set_note。鎖住、解鎖：lock、unlock。
- 業務說「以後」「每次」「每個星期幾」「記住」：add_habit。對象 by 是 customer（客戶 id）、chain（連鎖體系，例如「康泰連鎖藥局」）、type（chain 連鎖藥局、independent 獨立藥局、clinic 診所）、area（地區，例如「板橋」）。kind：precedence（subject 排在 object 前面）、first（先跑）、last（排最後）、window（約的時段，填 window_kind、window_time）、duration（停留，填 duration_minutes）。weekday 0 是星期一、6 是星期日，每天就不填。今天的行程也要照這條排的話，再加一個 optimize。
- 業務說某一條習慣不要了、先停掉：disable_habit（habit_id 用下面習慣清單的 id）。
- 只是問問題（例如「為什麼杏林排第一？」「今天幾點收工？」），不要改行程：只回一個 answer，text 用繁體中文、一到三句，照下面行程寫的時間與理由回答，不要編造。
- 一句話裡有好幾件事就回好幾個操作，照業務說的順序。不要回業務沒有要求的操作。"""


class ProposalNotFound(LookupError):
    """找不到這個提案，或不是這位業務的。"""


class NotApplicable(ValueError):
    """這個提案不能套用：只是回答、要選一個、排不出來，或沒有要改的。"""


@dataclass
class Built:
    """操作在目前行程的草稿上依序做完的結果（還沒排順路）。"""

    draft: itinerary_service.Draft
    optimize: bool = False
    phrases: list[str] = field(default_factory=list)  # 說明做了什麼，接成對照卡上的那一句
    notes: list[str] = field(default_factory=list)  # 做不到的部分
    habits_added: list[str] = field(default_factory=list)
    habits_disabled: list[str] = field(default_factory=list)


def ask(
    session: Session, user_id: str, question: str, customer_id: str | None = None, llm: LLM | None = None
) -> ItineraryProposal:
    """跟熊熊滾說一句話：呼叫一次 Gemini 把話翻成操作，算出對照卡存成提案。
    customer_id 是「要選一個」時業務按的那一家，跟原句一起再送一次。Gemini 沒設定丟 NotConfigured。"""
    itinerary = itinerary_service.get_or_create(session, user_id)
    llm = llm or get_llm()
    operations = interpret(session, itinerary, question, customer_id, llm)
    return _propose(session, itinerary, question, operations)


def optimize(session: Session, user_id: str) -> ItineraryProposal:
    """「幫我排順一點」：整條重排，回同一種對照卡。不呼叫 Gemini。"""
    itinerary = itinerary_service.get_or_create(session, user_id)
    return _propose(session, itinerary, None, [{"op": "optimize"}])


def apply(session: Session, user_id: str, proposal_id: int) -> Itinerary:
    """套用提案：版本要跟算提案時一樣，照存下來的操作在最新的行程上再做一次（不信前端傳來的內容），
    照調整清單存檔的規則寫進去（順序還違反的今天的先後拿掉、習慣今天不套用）。"""
    itinerary = itinerary_service.get_or_create(session, user_id)
    proposal = session.get(ItineraryProposal, proposal_id)
    owner = session.get(Itinerary, proposal.itinerary_id) if proposal else None
    if proposal is None or owner is None or owner.user_id != user_id:
        raise ProposalNotFound(proposal_id)
    if proposal.result["kind"] != "proposal" or not proposal.result["changed"]:
        raise NotApplicable(proposal_id)
    if proposal.itinerary_id != itinerary.id or proposal.base_version != itinerary.version:
        raise itinerary_service.VersionConflict
    try:
        # 問完之後客戶可能轉給別的業務了（同一天、版本不會變）：套用前拿存下來的操作重新驗證一次，
        # 不是這位業務的客戶就轉成「找不到」，不然 _build 直接用存著的客戶 id 查名字會 KeyError
        operations = normalize(
            proposal.operations, _customers(session, user_id),
            {h.id for h in route_habits.mine(session, user_id) if h.active},
        )
        built = _build(session, itinerary, operations)
        draft, _, _ = _settle(session, itinerary, built)
    except itinerary_service.InvalidDraft:
        raise itinerary_service.VersionConflict from None
    if draft is None:
        # 問完之後習慣改了（習慣頁不會改行程的版本），現在排不出來：當成行程改過了，請業務重算
        raise itinerary_service.VersionConflict
    return itinerary_service.save(session, user_id, proposal.base_version, draft, habit_source="ai")


def interpret(
    session: Session, itinerary: Itinerary, question: str, customer_id: str | None, llm: LLM
) -> list[dict[str, Any]]:
    """呼叫一次 Gemini，把業務的話翻成操作清單，再驗證成只有這位業務自己的客戶與習慣。"""
    customers = _customers(session, itinerary.user_id)
    habits = [h for h in route_habits.mine(session, itinerary.user_id) if h.active]
    prompt = _prompt(session, itinerary, question, customer_id, customers, habits)
    raw = llm.json(system=SYSTEM, prompt=prompt, schema=SCHEMA, effort="low")
    return normalize(raw.get("operations") or [], customers, {h.id for h in habits})


def normalize(
    operations: list[dict[str, Any]], customers: dict[str, Customer], habit_ids: set[int]
) -> list[dict[str, Any]]:
    """只留這位業務自己的客戶與習慣：提到不認得的客戶（別人的、編出來的、直接寫店名的）或不是他的習慣，
    整個操作換成 not_found（mention 是原本寫的）；欄位不合的（時間格式、分鐘數、少了必要的客戶）直接丟掉。"""
    out: list[dict[str, Any]] = []
    for op in operations:
        name = op.get("op")
        if name == "answer":
            if op.get("text"):
                out.append({"op": "answer", "text": str(op["text"])})
        elif name == "not_found":
            out.append({"op": "not_found", "mention": str(op.get("mention") or "")})
        elif name == "ask_which":
            mine = [cid for cid in op.get("candidates") or [] if cid in customers][:5]
            mention = str(op.get("mention") or "")
            out.append({"op": "ask_which", "mention": mention, "candidates": mine} if mine else {"op": "not_found", "mention": mention})
        elif name == "optimize":
            out.append({"op": "optimize"})
        elif name == "disable_habit":
            habit_id = op.get("habit_id")
            out.append({"op": name, "habit_id": habit_id} if habit_id in habit_ids else {"op": "not_found", "mention": f"習慣 {habit_id}"})
        elif name == "add_habit":
            if isinstance(op.get("habit"), dict):
                out.append({"op": name, "habit": op["habit"]})
        elif name in (*STOP_OPS, "add", "add_precedence", "remove_precedence"):
            refs = {key: op[key] for key in CUSTOMER_FIELDS if op.get(key)}
            unknown = next((value for value in refs.values() if value not in customers), None)
            if unknown is not None:
                out.append({"op": "not_found", "mention": str(unknown)})
                continue
            clean = _clean(name, op, refs)
            if clean is not None:
                out.append(clean)
    return out


def _clean(name: str, op: dict[str, Any], refs: dict[str, str]) -> dict[str, Any] | None:
    """一個提到客戶的操作只留要用的欄位；少了必要的、格式不合就是 None。"""
    if name in ("add_precedence", "remove_precedence"):
        before, after = refs.get("before"), refs.get("after")
        return {"op": name, "before": before, "after": after} if before and after and before != after else None
    if "customer_id" not in refs:
        return None
    clean: dict[str, Any] = {"op": name, "customer_id": refs["customer_id"]}
    if name == "move":
        position = op.get("to_position")
        if isinstance(position, int):
            clean["to_position"] = position
        elif refs.get("before") or refs.get("after"):
            clean.update({key: refs[key] for key in ("before", "after") if key in refs})
        else:
            return None
    elif name == "set_window":
        kind, time = op.get("kind"), str(op.get("time") or "")
        if kind == "none":
            clean["kind"] = "none"
        elif kind in ("at", "before", "after") and TIME.match(time):
            clean.update(kind=kind, time=time)
        else:
            return None
    elif name == "set_duration":
        minutes = op.get("minutes")
        if not isinstance(minutes, int) or not 5 <= minutes <= 480:
            return None
        clean["minutes"] = minutes
    elif name == "set_note":
        clean["text"] = str(op.get("text") or "").strip()[:200]
    return clean


def _propose(
    session: Session, itinerary: Itinerary, question: str | None, operations: list[dict[str, Any]]
) -> ItineraryProposal:
    proposal = ItineraryProposal(
        itinerary_id=itinerary.id, base_version=itinerary.version, question=question, operations=operations,
        result=_result(session, itinerary, operations),
    )
    session.add(proposal)
    session.flush()
    return proposal


def _result(session: Session, itinerary: Itinerary, operations: list[dict[str, Any]]) -> dict[str, Any]:
    """對照卡的內容。有 ask_which 就只回「要選一個」；只有 answer（加上找不到的）就只回答；
    其他照操作算出新的行程：排不出來是 conflict，排得出來是 proposal（changed 是 False 時沒有「套用」）。"""
    customers = _customers(session, itinerary.user_id)
    pick = next((op for op in operations if op["op"] == "ask_which"), None)
    if pick:
        return _card("ask_which", mention=pick["mention"], candidates=[
            {"customer_id": cid, "customer_name": customers[cid].name} for cid in pick["candidates"]
        ])
    acting = [op for op in operations if op["op"] not in ("answer", "not_found")]
    answers = [op["text"] for op in operations if op["op"] == "answer"]
    if answers and not acting:
        notes = [f"找不到『{op['mention']}』" for op in operations if op["op"] == "not_found" and op["mention"]]
        return _card("answer", text=answers[0], notes=notes)
    built = _build(session, itinerary, operations)
    before = itinerary_service.view(session, itinerary)
    draft, conflict, costs = _settle(session, itinerary, built)
    if draft is None:
        return _card(
            "conflict", summary="，".join(built.phrases), conflict=conflict, notes=built.notes, before=_side(before),
            estimated=before.estimated,
        )
    original = itinerary_service.draft_of(session, itinerary)
    phrases = list(built.phrases)
    if built.optimize:
        moved = [s.customer_id for s in draft.stops] != [s.customer_id for s in built.draft.stops]
        if moved:
            phrases.append("重新排了順序")
    changed = (
        (draft.stops, draft.precedences) != (original.stops, original.precedences)
        or bool(built.habits_added or built.habits_disabled)
    )
    if not changed:
        summary = "現在的順序已經是最順的了" if built.optimize and not built.phrases else "沒有要改的"
        return _card("proposal", summary=summary, notes=built.notes, before=_side(before), estimated=before.estimated)
    after = itinerary_service.shown(session, itinerary, draft)
    rules = {rule.id: rule for rule in after.rules}
    dropped = [
        f"拿掉今天的先後『{rules[rid].text}』，因為跟這個順序不合" if rid.startswith("today:")
        else f"今天不套用『{rules[rid].text}』，因為跟這個順序不合"
        for rid in after.violations
    ]
    late = [
        f"{stop.customer_name} 會晚到 {stop.late_minutes} 分"
        for stop in after.stops if stop.status != "done" and stop.late_minutes > 0
    ]
    return _card(
        "proposal", summary="，".join(phrases), changed=True, before=_side(before), after=_side(after),
        rule_costs=costs, late=late, habits_added=built.habits_added, habits_disabled=built.habits_disabled,
        dropped=dropped, notes=built.notes, estimated=before.estimated or after.estimated,
    )


def _card(kind: str, **values: Any) -> dict[str, Any]:
    """對照卡的每一個欄位都在，前端不用猜哪個有、哪個沒有。"""
    empty: dict[str, Any] = {
        "kind": kind, "summary": "", "changed": False, "before": None, "after": None, "rule_costs": [], "late": [],
        "habits_added": [], "habits_disabled": [], "dropped": [], "notes": [], "conflict": [], "mention": None,
        "candidates": [], "text": None, "estimated": True,
    }
    return empty | values


def _side(view: itinerary_service.ItineraryView) -> dict[str, Any]:
    """對照卡的一欄：還沒跑的站（幾點到、會晚到幾分）與總車程。"""
    return {
        "stops": [
            {
                "customer_id": s.customer_id, "customer_name": s.customer_name, "planned_time": s.planned_time,
                "late_minutes": s.late_minutes,
            }
            for s in view.stops if s.status != "done"
        ],
        "travel_minutes": view.travel_minutes,
        "travel_km": view.travel_km,
    }


def _settle(
    session: Session, itinerary: Itinerary, built: Built
) -> tuple[itinerary_service.Draft | None, list[str], list[str]]:
    """要排順路就整條重排。回 (最後的草稿, 擋住的規則, 每條規則讓路線多繞多少)；排不出來時草稿是 None。"""
    if not built.optimize:
        return built.draft, [], []
    result = itinerary_service.optimized(session, itinerary, built.draft)
    return result.draft, result.conflict, result.costs


def _build(session: Session, itinerary: Itinerary, operations: list[dict[str, Any]]) -> Built:
    """在目前行程的草稿上依序做完這些操作（不存）。做不到的寫進 notes。
    加了今天的先後或今天就套用的習慣、順序卻違反它，就當成也要排順路：不然套用時，新的規則會因為順序不合被拿掉。"""
    draft = itinerary_service.draft_of(session, itinerary)
    draft.new_source = "ai"
    built = Built(draft)
    customers = _customers(session, itinerary.user_id)
    names = {cid: c.name for cid, c in customers.items()}
    visits = today_route.done_visits(session, itinerary.user_id, itinerary.date)
    done = {c.id for _, c in visits}
    habits = {h.id: h for h in route_habits.mine(session, itinerary.user_id)}
    options = route_habits.targets(session, itinerary.user_id)
    new_rules: set[str] = set()

    def stop_of(cid: str) -> itinerary_service.DraftStop | None:
        found = next((s for s in built.draft.stops if s.customer_id == cid), None)
        if found is None:
            built.notes.append(f"{names[cid]} 今天已經去過了" if cid in done else f"{names[cid]} 不在今天的行程裡")
        return found

    for op in operations:
        name = op["op"]
        if name == "not_found":
            if op["mention"]:
                built.notes.append(f"找不到『{op['mention']}』")
        elif name == "optimize":
            built.optimize = True
        elif name == "add":
            cid = op["customer_id"]
            try:
                built.draft = itinerary_service.with_stop(session, itinerary, built.draft, cid)
                built.phrases.append(f"加了 {names[cid]}")
            except itinerary_service.InvalidDraft as exc:
                built.notes.append(f"{names[cid]}：{exc}")
        elif name in STOP_OPS:
            stop = stop_of(op["customer_id"])
            if stop is not None:
                _change_stop(built, stop, op, names, len(visits))
        elif name in ("add_precedence", "remove_precedence"):
            pair = (op["before"], op["after"])
            if stop_of(pair[0]) is None or stop_of(pair[1]) is None:
                continue
            text = f"{names[pair[0]]} 排在 {names[pair[1]]} 前面"
            if name == "add_precedence" and pair not in built.draft.precedences:
                built.draft.precedences.append(pair)
                built.phrases.append(f"加了一條『{text}』")
                new_rules.add(f"today:{pair[0]}>{pair[1]}")
            elif name == "remove_precedence" and pair in built.draft.precedences:
                built.draft.precedences.remove(pair)
                built.phrases.append(f"拿掉『{text}』")
        elif name == "add_habit":
            _add_habit(built, op["habit"], options, names, itinerary.date, new_rules)
        elif name == "disable_habit":
            habit = habits.get(op["habit_id"])
            if habit is None:
                # 問完之後在習慣頁刪掉了
                built.notes.append(f"找不到『習慣 {op['habit_id']}』")
                continue
            built.draft.disabled_habit_ids.append(habit.id)
            built.habits_disabled.append(habit.text)
            built.phrases.append(f"停用習慣『{habit.text}』")
    if not built.optimize and new_rules & set(itinerary_service.broken_rules(session, itinerary, built.draft)):
        built.optimize = True
    return built


def _change_stop(
    built: Built, stop: itinerary_service.DraftStop, op: dict[str, Any], names: dict[str, str], done: int
) -> None:
    """改行程上的一站：移動、拿掉、約的時間、停留、備註、鎖住。done 是跑完幾站，站號要扣掉。"""
    name, cid, stops = op["op"], op["customer_id"], built.draft.stops
    label = names[cid]
    if name == "remove":
        stops.remove(stop)
        built.draft.precedences = [p for p in built.draft.precedences if cid not in p]
        built.phrases.append(f"拿掉 {label}")
    elif name == "move":
        rest = [s for s in stops if s is not stop]
        if "to_position" in op:
            index = min(max(op["to_position"] - 1 - done, 0), len(rest))
            phrase = f"{label} 移到第 {op['to_position']} 站"
        else:
            other = op.get("before") or op.get("after")
            anchor = next((n for n, s in enumerate(rest) if s.customer_id == other), None)
            if anchor is None:
                built.notes.append(f"{names[other]} 不在今天的行程裡")
                return
            index = anchor if op.get("before") else anchor + 1
            phrase = f"{label} 移到 {names[other]} {'前面' if op.get('before') else '後面'}"
        built.draft.stops = [*rest[:index], stop, *rest[index:]]
        built.phrases.append(phrase)
    elif name == "set_window":
        if op["kind"] == "none":
            stop.window_kind, stop.window_time = None, None
            built.phrases.append(f"{label} 不約時間")
        else:
            stop.window_kind, stop.window_time = op["kind"], dt.time.fromisoformat(op["time"])
            built.phrases.append(f"{label} 約 {op['time']} {WINDOW_WORD[op['kind']]}")
    elif name == "set_duration":
        stop.duration_minutes = op["minutes"]
        built.phrases.append(f"{label} 停 {op['minutes']} 分")
    elif name == "set_note":
        stop.note = op["text"] or None
        built.phrases.append(f"{label} 的備註改成『{op['text']}』" if op["text"] else f"拿掉 {label} 的備註")
    elif name in ("lock", "unlock"):
        stop.locked = name == "lock"
        built.phrases.append(f"鎖住 {label}" if stop.locked else f"{label} 解鎖")


def _add_habit(
    built: Built, raw: dict[str, Any], options: dict[str, list[tuple[str, str]]], names: dict[str, str],
    today: dt.date, new_rules: set[str],
) -> None:
    """要記的習慣先驗證（對象要是這位業務自己的），套用時才建。今天就套用的先後、先跑、排最後算新的規則。"""
    try:
        time = raw.get("window_time")
        spec = route_habits.HabitSpec(
            kind=raw.get("kind", ""), subject=raw.get("subject") or {}, object=raw.get("object"),
            window_kind=raw.get("window_kind"), window_time=dt.time.fromisoformat(time) if time and TIME.match(time) else None,
            duration_minutes=raw.get("duration_minutes"), weekday=raw.get("weekday"),
        )
        route_habits.validate(spec, options)
    except route_habits.InvalidHabit as exc:
        built.notes.append(f"記不起來這條習慣：{exc}")
        return
    built.draft.habits.append(itinerary_service.PendingHabit(spec))
    text = route_habits.describe(spec, names)
    built.habits_added.append(text)
    built.phrases.append(f"記了一條習慣『{text}』")
    if spec.kind in route_habits.RULE_KINDS and (spec.weekday is None or spec.weekday == today.weekday()):
        new_rules.add(f"new:{len(built.draft.habits) - 1}")


def _prompt(
    session: Session, itinerary: Itinerary, question: str, customer_id: str | None,
    customers: dict[str, Customer], habits: list[RouteHabit],
) -> str:
    """給 Gemini 的提示：今天的行程、今天設的先後、他的習慣、他的客戶清單、今天星期幾，最後是業務說的話。"""
    view = itinerary_service.view(session, itinerary)
    names = {s.customer_id: s.customer_name for s in view.stops}
    lines = [
        f"今天：{itinerary.date:%Y-%m-%d}（星期{WEEKDAY[itinerary.date.weekday()]}）",
        "",
        "今天的行程（站號. 客戶（id）：幾點到、停多久、約的時間、鎖住、備註；為什麼排這家）：",
    ]
    for n, stop in enumerate(view.stops, start=1):
        if stop.status == "done":
            lines.append(f"{n}. {stop.customer_name}（{stop.customer_id}）：{stop.planned_time} 已完成")
            continue
        details = [f"{stop.planned_time} 到", f"停 {stop.duration_minutes} 分"]
        if stop.window_kind:
            details.append(f"約 {stop.window_time} {WINDOW_WORD[stop.window_kind]}")
        if stop.late_minutes:
            details.append(f"會晚到 {stop.late_minutes} 分")
        if stop.locked:
            details.append("鎖住")
        if stop.note:
            details.append(f"備註：{stop.note}")
        reason = f"{today_route.SIGNAL_LABEL.get(stop.signal, '')}：{stop.reason}"
        lines.append(f"{n}. {stop.customer_name}（{stop.customer_id}）：{'，'.join(details)}；{reason}")
    if view.precedences:
        lines += ["", "今天設的先後："]
        lines += [f"{names[p.before]}（{p.before}）要在 {names[p.after]}（{p.after}）前面" for p in view.precedences]
    lines += ["", "他的排序習慣（id：那句話）："]
    lines += [f"{h.id}：{h.text}" for h in habits] or ["（沒有）"]
    lines += ["", "他的客戶（名稱：id）："]
    lines += [f"{c.name}：{c.id}" for c in customers.values()]
    lines += ["", f"業務說：「{question}」"]
    if customer_id in customers:
        lines.append(f"（他剛才選了：{customers[customer_id].name}（{customer_id}））")
    return "\n".join(lines)


def _customers(session: Session, rep_id: str) -> dict[str, Customer]:
    """這位業務自己的客戶（照名稱排）：只有這些 id 是 AI 可以用的。"""
    return {
        c.id: c
        for c in session.scalars(select(Customer).where(Customer.owner_user_id == rep_id).order_by(Customer.name))
    }


def purge_proposals(session: Session, now: dt.datetime | None = None) -> int:
    """刪掉超過保存期限的提案，回傳刪了幾筆（jobs/retention.py 每天跑一次）。"""
    cutoff = (now or dt.datetime.now(dt.UTC)) - PROPOSAL_RETENTION
    return session.execute(delete(ItineraryProposal).where(ItineraryProposal.created_at < cutoff)).rowcount
