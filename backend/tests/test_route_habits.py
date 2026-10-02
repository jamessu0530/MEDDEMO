"""排序習慣：比對、那句話、換成排序規則、預設值、驗證、示範業務的三條。"""

import datetime as dt

import pytest
from sqlalchemy import select

from app.models import Customer, RouteHabit
from app.services import route_habits as rh

NAMES = {"C1": "德安藥局 · 板橋", "C2": "佑生藥局 · 大安"}


def customer(cid, type_="independent", chain=None, area="大安"):
    # 沒加進 session 的物件，只拿來比對
    return Customer(id=cid, name=NAMES.get(cid, cid), type=type_, chain_group=chain, area=area)


def habit(hid, kind, subject, object_=None, weekday=None, active=True, **extra):
    spec = rh.HabitSpec(kind, subject, object_, weekday=weekday, **extra)
    return RouteHabit(
        id=hid, user_id="U01", kind=kind, subject=subject, object=object_, weekday=weekday, active=active,
        text=rh.describe(spec, NAMES), source="manual", window_kind=extra.get("window_kind"),
        window_time=extra.get("window_time"), duration_minutes=extra.get("duration_minutes"),
    )


def entries(*habits):
    return [(f"habit:{h.id}", rh.spec_of(h), h.text) for h in habits]


KANGTAI = customer("C3", "chain", "康泰連鎖藥局", "中和")
CLINIC = customer("C4", "clinic", area="大安")
BANQIAO = customer("C1", area="板橋")


def test_targets_match_by_customer_chain_type_and_area():
    assert rh.matches({"by": "customer", "value": "C3"}, KANGTAI)
    assert rh.matches({"by": "chain", "value": "康泰連鎖藥局"}, KANGTAI)
    assert not rh.matches({"by": "chain", "value": "康泰連鎖藥局"}, CLINIC)
    assert rh.matches({"by": "type", "value": "clinic"}, CLINIC)
    assert rh.matches({"by": "area", "value": "板橋"}, BANQIAO)
    assert not rh.matches({"by": "area", "value": "板橋"}, CLINIC)


def test_the_sentence_is_written_from_the_fields():
    spec = rh.HabitSpec
    assert rh.describe(spec("precedence", {"by": "chain", "value": "康泰連鎖藥局"}, {"by": "type", "value": "clinic"}), NAMES) == "康泰連鎖藥局的店排在診所前面"
    # 店名有「 · 」，前後空一格，才不會讀成「大安排最後」
    assert rh.describe(spec("precedence", {"by": "customer", "value": "C1"}, {"by": "customer", "value": "C2"}), NAMES) == "德安藥局 · 板橋 排在 佑生藥局 · 大安 前面"
    assert rh.describe(spec("first", {"by": "area", "value": "板橋"}, weekday=0), NAMES) == "星期一先跑板橋"
    assert rh.describe(spec("last", {"by": "customer", "value": "C2"}, weekday=2), NAMES) == "星期三 佑生藥局 · 大安 排最後"
    assert rh.describe(spec("window", {"by": "customer", "value": "C2"}, window_kind="before", window_time=dt.time(11, 0)), NAMES) == "佑生藥局 · 大安 都 11:00 以前到"
    assert rh.describe(spec("window", {"by": "type", "value": "clinic"}, window_kind="at", window_time=dt.time(9, 30)), NAMES) == "診所都約 09:30 到"
    assert rh.describe(spec("duration", {"by": "customer", "value": "C1"}, duration_minutes=60), NAMES) == "去 德安藥局 · 板橋 都停 60 分"


def test_weekday_and_switch_decide_whether_a_habit_applies():
    wednesday = dt.date(2026, 10, 28)
    assert rh.applies_on(habit(1, "first", {"by": "area", "value": "板橋"}), wednesday)
    assert rh.applies_on(habit(2, "first", {"by": "area", "value": "板橋"}, weekday=2), wednesday)
    assert not rh.applies_on(habit(3, "first", {"by": "area", "value": "板橋"}, weekday=0), wednesday)
    assert not rh.applies_on(habit(4, "first", {"by": "area", "value": "板橋"}, active=False), wednesday)


def test_a_precedence_habit_becomes_pairs_under_one_id():
    other_kangtai = customer("C5", "chain", "康泰連鎖藥局", "大安")
    rule = habit(7, "precedence", {"by": "chain", "value": "康泰連鎖藥局"}, {"by": "area", "value": "大安"})
    out = rh.rules(entries(rule), [KANGTAI, other_kangtai, CLINIC, BANQIAO])
    # C5 是康泰、也在大安，兩邊都符合就不算；剩下康泰中和店（C3）要在大安的診所（C4）前面
    assert [(r.id, r.kind, r.customer_ids) for r in out] == [("habit:7", "precedence", ("C3", "C4"))]


def test_first_and_last_cover_every_matching_stop():
    first = habit(1, "first", {"by": "area", "value": "大安"})
    last = habit(2, "last", {"by": "chain", "value": "福安連鎖藥局"})
    out = rh.rules(entries(first, last), [KANGTAI, CLINIC, customer("C6", area="大安"), BANQIAO])
    # 今天沒有福安的店，「排最後」那條就沒有規則
    assert [(r.id, r.kind, r.customer_ids) for r in out] == [("habit:1", "first", ("C4", "C6"))]


def test_window_and_duration_are_only_defaults_and_the_newest_wins():
    older = habit(1, "duration", {"by": "type", "value": "clinic"}, duration_minutes=60)
    newer = habit(2, "duration", {"by": "customer", "value": "C4"}, duration_minutes=20)
    window = habit(3, "window", {"by": "type", "value": "clinic"}, window_kind="before", window_time=dt.time(11, 0))
    assert rh.rules(entries(older, newer, window), [CLINIC, BANQIAO]) == []
    assert rh.defaults([older, newer, window], CLINIC) == (("before", dt.time(11, 0)), 20)
    assert rh.defaults([older, newer, window], BANQIAO) == (None, None)


def test_create_writes_the_sentence_and_only_takes_own_customers(tx):
    mine = tx.scalars(select(Customer).where(Customer.owner_user_id == "U01").order_by(Customer.id)).first()
    theirs = tx.scalars(select(Customer).where(Customer.owner_user_id == "U02")).first()
    made = rh.create(tx, "U01", rh.HabitSpec("duration", {"by": "customer", "value": mine.id}, duration_minutes=60), "manual")
    assert made.id and made.text == f"去 {mine.name} 都停 60 分" and made.active and made.object is None
    with pytest.raises(rh.InvalidHabit, match="只能選自己的客戶"):
        rh.create(tx, "U01", rh.HabitSpec("first", {"by": "customer", "value": theirs.id}), "manual")
    with pytest.raises(rh.InvalidHabit, match="同一個對象"):
        rh.create(tx, "U01", rh.HabitSpec("precedence", {"by": "type", "value": "clinic"}, {"by": "type", "value": "clinic"}), "manual")
    with pytest.raises(rh.InvalidHabit, match="約的時間"):
        rh.create(tx, "U01", rh.HabitSpec("window", {"by": "type", "value": "clinic"}, window_kind="before"), "manual")
    with pytest.raises(LookupError):
        rh.find(tx, "U02", made.id)


def test_the_demo_rep_starts_with_three_habits(tx):
    habits = rh.mine(tx, "U01")
    assert [(h.text, h.weekday, h.source, h.active) for h in habits] == [
        ("康泰連鎖藥局的店排在診所前面", None, "ai", True),
        ("星期三 敦南內科診所 · 大安 排最後", 2, "manual", True),
        ("杏林診所 · 大安 都 11:00 以前到", None, "manual", True),
    ]
    assert rh.mine(tx, "U02") == []


def test_reset_demo_skips_habits_whose_targets_dont_exist(tx):
    """U03 在中區，沒有康泰連鎖藥局的店：示範的第一條（連鎖體系比對）建不起來，reset_demo 要跳過它，
    不能整個噴 InvalidHabit；其他能建的照建，建出來的對象都要是真的存在的。"""
    options = rh.targets(tx, "U03")
    allowed = {by: {value for value, _ in items} for by, items in options.items()}
    assert "康泰連鎖藥局" not in allowed["chain"]
    rh.reset_demo(tx, "U03")
    habits = rh.mine(tx, "U03")
    assert all(h.subject["value"] in allowed[h.subject["by"]] for h in habits)


def test_reset_demo_puts_the_three_back(tx):
    habits = rh.mine(tx, "U01")
    habits[0].active = False
    rh.create(tx, "U01", rh.HabitSpec("first", {"by": "area", "value": "板橋"}), "prompt")
    tx.flush()
    rh.reset_demo(tx, "U01")
    again = rh.mine(tx, "U01")
    assert len(again) == 3 and all(h.active for h in again)
    assert {h.id for h in again}.isdisjoint({h.id for h in habits})
