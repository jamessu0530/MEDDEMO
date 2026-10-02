"""跟熊熊滾說要怎麼排：提示、操作的驗證與套用、對照卡、提案的存取與套用。Gemini 一律用假的。"""

import datetime as dt

import pytest
from route_fakes import FakeLLM
from sqlalchemy import delete, select

from app.config import NotConfigured
from app.llm import api_schema
from app.models import Customer, ItineraryProposal, RouteHabit, Visit
from app.services import itinerary as service
from app.services import itinerary_ai, route_habits
from app.timeutil import TAIPEI


def proposal(tx, itinerary, days_ago=0):
    row = ItineraryProposal(
        itinerary_id=itinerary.id, base_version=itinerary.version, question="測試", operations=[],
        result={"kind": "answer"},
        created_at=dt.datetime.now(dt.UTC) - dt.timedelta(days=days_ago),
    )
    tx.add(row)
    tx.flush()
    return row


def test_old_proposals_are_purged_after_seven_days(tx):
    itinerary = service.get_or_create(tx, "U01")
    fresh, old = proposal(tx, itinerary), proposal(tx, itinerary, days_ago=8)
    assert itinerary_ai.purge_proposals(tx) == 1
    left = set(tx.scalars(select(ItineraryProposal.id)))
    assert fresh.id in left and old.id not in left


def route(tx):
    """U01 今天的行程（沒有排序習慣，順序就是模型的建議排順路）：(行程, 站的 id, 店名)。"""
    tx.execute(delete(RouteHabit).where(RouteHabit.user_id == "U01"))
    itinerary = service.get_or_create(tx, "U01")
    stops = service.view(tx, itinerary).stops
    return itinerary, [s.customer_id for s in stops], {s.customer_id: s.customer_name for s in stops}


def mine_not_on_route(tx, ids):
    return tx.scalars(
        select(Customer).where(Customer.owner_user_id == "U01", Customer.id.not_in(ids)).order_by(Customer.id)
    ).first()


def ask(tx, *ops, question="測試", customer_id=None):
    return itinerary_ai.ask(tx, "U01", question, customer_id, llm=FakeLLM(list(ops)))


def order(side):
    return [s["customer_id"] for s in side["stops"]]


def test_the_prompt_has_the_route_the_customers_and_the_habits(tx):
    itinerary, ids, names = route(tx)
    habit = route_habits.create(tx, "U01", route_habits.HabitSpec("first", {"by": "area", "value": "板橋"}), "manual")
    llm = FakeLLM([{"op": "answer", "text": "因為帳款逾期最久。"}])
    proposal = itinerary_ai.ask(tx, "U01", "為什麼第一站排這家？", llm=llm)
    prompt = llm.prompts[0]
    assert "星期三" in prompt and "為什麼第一站排這家？" in prompt
    assert f"1. {names[ids[0]]}（{ids[0]}）" in prompt and f"{habit.id}：{habit.text}" in prompt
    other = mine_not_on_route(tx, ids)
    assert f"{other.name}：{other.id}" in prompt
    theirs = tx.scalars(select(Customer).where(Customer.owner_user_id == "U02")).first()
    assert theirs.id not in prompt
    assert (proposal.result["kind"], proposal.result["text"]) == ("answer", "因為帳款逾期最久。")
    assert proposal.question == "為什麼第一站排這家？" and proposal.base_version == itinerary.version


def test_a_chosen_customer_is_passed_back_to_the_model(tx):
    _, ids, names = route(tx)
    llm = FakeLLM([{"op": "remove", "customer_id": ids[2]}])
    itinerary_ai.ask(tx, "U01", "康泰今天不去了", ids[2], llm=llm)
    assert f"他剛才選了：{names[ids[2]]}（{ids[2]}）" in llm.prompts[0]


def test_moving_a_stop_and_applying_it(tx):
    itinerary, ids, names = route(tx)
    proposal = ask(tx, {"op": "move", "customer_id": ids[4], "to_position": 2})
    result = proposal.result
    assert result["kind"] == "proposal" and result["changed"]
    assert result["summary"] == f"{names[ids[4]]} 移到第 2 站"
    assert order(result["before"]) == ids and order(result["after"]) == [ids[0], ids[4], *ids[1:4]]
    itinerary_ai.apply(tx, "U01", proposal.id)
    view = service.view(tx, itinerary)
    assert [s.customer_id for s in view.stops] == [ids[0], ids[4], *ids[1:4]] and view.version == 2


def test_adding_and_removing_stops(tx):
    itinerary, ids, names = route(tx)
    other = mine_not_on_route(tx, ids)
    proposal = ask(tx, {"op": "add", "customer_id": other.id}, {"op": "remove", "customer_id": ids[3]})
    result = proposal.result
    assert result["summary"] == f"加了 {other.name}，拿掉 {names[ids[3]]}"
    assert other.id in order(result["after"]) and ids[3] not in order(result["after"])
    itinerary_ai.apply(tx, "U01", proposal.id)
    stops = {s.customer_id: s for s in service.view(tx, itinerary).stops}
    assert stops[other.id].source == "ai" and ids[3] not in stops


def test_other_reps_customers_are_not_found(tx):
    _, ids, _ = route(tx)
    theirs = tx.scalars(select(Customer.id).where(Customer.owner_user_id == "U02")).first()
    proposal = ask(tx, {"op": "add", "customer_id": theirs}, {"op": "remove", "customer_id": "德安"})
    result = proposal.result
    assert result["notes"] == [f"找不到『{theirs}』", "找不到『德安』"]
    assert result["changed"] is False and result["summary"] == "沒有要改的"
    assert proposal.operations == [{"op": "not_found", "mention": theirs}, {"op": "not_found", "mention": "德安"}]


def test_the_schema_sent_to_gemini_has_no_limit_on_the_operation_count():
    # 加了 maxItems，Gemini 會把整份 schema 拒絕（400 INVALID_ARGUMENT）：上限改在程式裡截
    assert "maxItems" not in api_schema(itinerary_ai.SCHEMA)["properties"]["operations"]


def test_more_than_twelve_operations_are_cut(tx):
    route(tx)
    proposal = ask(tx, *({"op": "not_found", "mention": f"店{n}"} for n in range(15)))
    assert [op["mention"] for op in proposal.operations] == [f"店{n}" for n in range(itinerary_ai.MAX_OPERATIONS)]


def test_times_stays_notes_and_locks(tx):
    itinerary, ids, names = route(tx)
    proposal = ask(
        tx,
        {"op": "set_window", "customer_id": ids[1], "kind": "before", "time": "09:40"},
        {"op": "set_duration", "customer_id": ids[2], "minutes": 90},
        {"op": "set_note", "customer_id": ids[3], "text": "找王藥師"},
        {"op": "lock", "customer_id": ids[4]},
        {"op": "unlock", "customer_id": ids[0]},
        {"op": "set_window", "customer_id": ids[3], "kind": "around", "time": "9 點"},
    )
    result = proposal.result
    assert result["summary"] == (
        f"{names[ids[1]]} 約 09:40 以前到，{names[ids[2]]} 停 90 分，{names[ids[3]]} 的備註改成『找王藥師』，"
        f"鎖住 {names[ids[4]]}，{names[ids[0]]} 解鎖"
    )
    assert any(line.startswith(names[ids[1]]) and "會晚到" in line for line in result["late"])
    itinerary_ai.apply(tx, "U01", proposal.id)
    stops = {s.customer_id: s for s in service.view(tx, itinerary).stops}
    assert (stops[ids[1]].window_kind, stops[ids[1]].window_time) == ("before", "09:40")
    assert stops[ids[2]].duration_minutes == 90 and stops[ids[3]].note == "找王藥師"
    assert stops[ids[4]].locked and not stops[ids[0]].locked


def test_a_new_precedence_replans_the_route(tx):
    _, ids, names = route(tx)
    # 沒叫排順路也一樣：新加的先後順序不合，不重排的話套用時就會被拿掉
    proposal = ask(tx, {"op": "add_precedence", "before": ids[4], "after": ids[1]})
    result = proposal.result
    assert result["summary"] == f"加了一條『{names[ids[4]]} 排在 {names[ids[1]]} 前面』，重新排了順序"
    after = order(result["after"])
    assert after[0] == ids[0] and after.index(ids[4]) < after.index(ids[1])
    assert any(line.startswith(f"守住『{names[ids[4]]} 排在 {names[ids[1]]} 前面』") for line in result["rule_costs"])
    assert result["dropped"] == []


def test_the_optimize_button_on_an_already_smooth_route(tx):
    route(tx)
    proposal = itinerary_ai.optimize(tx, "U01")
    result = proposal.result
    assert proposal.question is None and proposal.operations == [{"op": "optimize"}]
    assert result["changed"] is False and result["summary"] == "現在的順序已經是最順的了"
    with pytest.raises(itinerary_ai.NotApplicable):
        itinerary_ai.apply(tx, "U01", proposal.id)


def test_rules_that_cannot_be_kept_are_named_and_cannot_be_applied(tx):
    _, ids, names = route(tx)
    proposal = ask(tx, {"op": "add_precedence", "before": ids[2], "after": ids[0]}, {"op": "optimize"})
    result = proposal.result
    assert result["kind"] == "conflict" and len(result["conflict"]) == 2
    assert f"{names[ids[2]]} 排在 {names[ids[0]]} 前面" in result["conflict"]
    with pytest.raises(itinerary_ai.NotApplicable):
        itinerary_ai.apply(tx, "U01", proposal.id)


def test_adding_and_disabling_habits(tx):
    itinerary, ids, names = route(tx)
    old = route_habits.create(tx, "U01", route_habits.HabitSpec("last", {"by": "customer", "value": ids[1]}), "manual")
    theirs = tx.scalars(select(Customer.id).where(Customer.owner_user_id == "U02")).first()
    proposal = ask(
        tx,
        {"op": "add_habit", "habit": {"kind": "first", "subject": {"by": "area", "value": "板橋"}, "weekday": 0}},
        {"op": "add_habit", "habit": {"kind": "first", "subject": {"by": "customer", "value": theirs}}},
        {"op": "disable_habit", "habit_id": old.id},
        {"op": "disable_habit", "habit_id": 999999},
    )
    result = proposal.result
    assert result["habits_added"] == ["星期一先跑板橋"] and result["habits_disabled"] == [old.text]
    assert result["notes"] == ["記不起來這條習慣：找不到這個對象，只能選自己的客戶", "找不到『習慣 999999』"]
    itinerary_ai.apply(tx, "U01", proposal.id)
    habits = {h.text: h for h in route_habits.mine(tx, "U01")}
    assert habits["星期一先跑板橋"].source == "ai" and not habits[old.text].active


def test_a_habit_for_another_weekday_does_not_apply_today(tx):
    # 今天是星期三：加一條只在星期五套用的習慣，今天的順序不該被它鎖住，也不該出現「今天不套用」的提示
    itinerary, ids, names = route(tx)
    proposal = ask(
        tx,
        {"op": "add_habit", "habit": {"kind": "first", "subject": {"by": "customer", "value": ids[4]}, "weekday": 4}},
        {"op": "optimize"},
    )
    result = proposal.result
    text = f"星期五先跑 {names[ids[4]]}"
    assert result["kind"] == "proposal" and result["dropped"] == []
    assert result["habits_added"] == [text]
    assert order(result["after"]) == ids  # 星期五的習慣沒有把 ids[4] 排到第一站
    itinerary_ai.apply(tx, "U01", proposal.id)
    habit = tx.scalars(select(RouteHabit).where(RouteHabit.user_id == "U01", RouteHabit.text == text)).one()
    assert habit.weekday == 4 and habit.source == "ai"
    view = service.view(tx, itinerary)
    assert view.skipped_habits == []


def test_an_ambiguous_name_asks_which_one(tx):
    _, ids, names = route(tx)
    theirs = tx.scalars(select(Customer.id).where(Customer.owner_user_id == "U02")).first()
    proposal = ask(
        tx, {"op": "ask_which", "mention": "康泰", "candidates": [ids[1], ids[2], theirs]}, {"op": "optimize"},
    )
    result = proposal.result
    assert result["kind"] == "ask_which" and result["mention"] == "康泰"
    assert result["candidates"] == [
        {"customer_id": ids[1], "customer_name": names[ids[1]]}, {"customer_id": ids[2], "customer_name": names[ids[2]]},
    ]


def test_applying_checks_the_version_owner_and_kind(tx):
    itinerary, ids, _ = route(tx)
    moved = ask(tx, {"op": "move", "customer_id": ids[4], "to_position": 2})
    answer = ask(tx, {"op": "answer", "text": "好"})
    with pytest.raises(itinerary_ai.NotApplicable):
        itinerary_ai.apply(tx, "U01", answer.id)
    with pytest.raises(itinerary_ai.ProposalNotFound):
        itinerary_ai.apply(tx, "U02", moved.id)
    with pytest.raises(itinerary_ai.ProposalNotFound):
        itinerary_ai.apply(tx, "U01", 999999)
    service.apply_feedback(tx, "U01", ids[3], "pin", itinerary.version)
    with pytest.raises(service.VersionConflict):
        itinerary_ai.apply(tx, "U01", moved.id)


def test_applying_after_the_customer_changed_owner(tx):
    # 問完之後那家被轉給別的業務了（同一天、版本沒變）：重新驗證後這個操作變成「找不到」，拿掉就沒有真的做，
    # 重算出來的順序跟卡片上的「改成」（少了這家）不一樣，套用要擋下來，不能因為查不到名字就炸掉（KeyError → 500）
    itinerary, ids, _ = route(tx)
    proposal = ask(tx, {"op": "remove", "customer_id": ids[3]})
    before_version = itinerary.version
    tx.get(Customer, ids[3]).owner_user_id = "U02"
    tx.flush()
    with pytest.raises(service.VersionConflict):
        itinerary_ai.apply(tx, "U01", proposal.id)
    view = service.view(tx, itinerary)
    stops = {s.customer_id for s in view.stops}
    assert ids[3] in stops and view.version == before_version


def test_applying_after_a_stop_was_confirmed_as_done(tx):
    # 問完之後有一站確認拜訪了（確認不會改版本）：少了那一站，重算出來還沒跑的站跟卡片上的「改成」對不起來，
    # 套用要擋下來，不能因為版本號沒變就直接存
    itinerary, ids, _ = route(tx)
    proposal = ask(tx, {"op": "move", "customer_id": ids[4], "to_position": 2})
    at = dt.datetime(2026, 10, 28, 9, 40, tzinfo=TAIPEI)
    tx.add(Visit(
        id="VTEST9", customer_id=ids[0], user_id="U01", visited_at=at,
        transcript="測試", status="synced", confirmed_at=at,
    ))
    tx.flush()
    with pytest.raises(service.VersionConflict):
        itinerary_ai.apply(tx, "U01", proposal.id)


def test_asking_without_gemini_configured(tx):
    route(tx)
    with pytest.raises(NotConfigured):
        itinerary_ai.ask(tx, "U01", "幫我排順一點")
