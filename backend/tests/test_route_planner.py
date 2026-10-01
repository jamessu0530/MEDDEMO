"""排序程式：守規則、晚到最少、車程最短。"""

import datetime as dt
import random
import time

import pytest

from app.services import route_planner as rp
from app.timeutil import TAIPEI

START = dt.datetime(2026, 10, 28, 9, 0, tzinfo=TAIPEI)
# 一條直線上的點：0 是出發點，每差一格開 10 分鐘
XS = [0, 1, 2, 3, 0.5]
LINE = [[round(abs(a - b) * 10) for b in XS] for a in XS]


def stop(cid, point, duration=30, window=None):
    return rp.PlanStop(customer_id=cid, point=point, duration=duration, window=window)


def order_of(result):
    assert isinstance(result, rp.Schedule), result
    return [s.customer_id for s in result.slots]


def test_picks_the_shortest_drive():
    result = rp.plan(START, 0, [stop("C", 3), stop("A", 1), stop("B", 2)], [], LINE)
    assert order_of(result) == ["A", "B", "C"]
    assert result.travel_minutes == 30


def test_precedence_is_kept_even_when_it_is_longer():
    before_a = rp.Rule(id="today:B>A", text="先 B 再 A", kind="precedence", customer_ids=("B", "A"))
    result = rp.plan(START, 0, [stop("A", 1), stop("B", 2), stop("C", 3)], [before_a], LINE)
    order = order_of(result)
    assert order.index("B") < order.index("A")
    assert result.travel_minutes == 50


def test_lateness_matters_more_than_driving():
    # A 在 30 分鐘外、約 09:40 以前到；先去近的 B 會晚到，所以先去 A，車程比較長也一樣
    far = stop("A", 3, window=("before", dt.time(9, 40)))
    result = rp.plan(START, 0, [stop("B", 1), far], [], LINE)
    assert order_of(result) == ["A", "B"]
    assert result.late_minutes == 0


def test_unavoidable_lateness_is_reported():
    result = rp.plan(START, 0, [stop("A", 3, window=("before", dt.time(9, 10)))], [], LINE)
    assert result.late_minutes == 20
    assert result.slots[0].late_minutes == 20


def test_after_and_at_windows_wait_for_the_time():
    result = rp.schedule(START, 0, [stop("A", 1, duration=20, window=("after", dt.time(10, 0)))], LINE)
    slot = result.slots[0]
    assert slot.arrive == START + dt.timedelta(minutes=10)
    assert slot.leave == dt.datetime(2026, 10, 28, 10, 20, tzinfo=TAIPEI)
    late = rp.schedule(START, 0, [stop("A", 3, window=("at", dt.time(9, 15)))], LINE)
    assert late.slots[0].late_minutes == 15


def test_a_locked_stop_stays_where_it_is():
    lock = rp.Rule(id="lock:C", text="C 排第一站", kind="lock", customer_ids=("C",), position=0)
    result = rp.plan(START, 0, [stop("A", 1), stop("B", 2), stop("C", 3)], [lock], LINE)
    assert order_of(result)[0] == "C"


def test_first_and_last_rules():
    first = rp.Rule(id="habit:1", text="C 排第一", kind="first", customer_ids=("C",))
    last = rp.Rule(id="habit:2", text="A 排最後", kind="last", customer_ids=("A",))
    result = rp.plan(START, 0, [stop("A", 1), stop("B", 2), stop("C", 3)], [first, last], LINE)
    assert order_of(result) == ["C", "B", "A"]


def test_contradicting_rules_are_named():
    a_first = rp.Rule(id="today:A>B", text="先 A 再 B", kind="precedence", customer_ids=("A", "B"))
    b_first = rp.Rule(id="today:B>A", text="先 B 再 A", kind="precedence", customer_ids=("B", "A"))
    result = rp.plan(START, 0, [stop("A", 1), stop("B", 2)], [a_first, b_first], LINE)
    assert isinstance(result, rp.Conflict)
    assert {r.id for r in result.rules} == {"today:A>B", "today:B>A"}


def test_a_lock_that_breaks_a_precedence_is_a_conflict():
    lock = rp.Rule(id="lock:A", text="A 排第一站", kind="lock", customer_ids=("A",), position=0)
    after_b = rp.Rule(id="today:B>A", text="先 B 再 A", kind="precedence", customer_ids=("B", "A"))
    result = rp.plan(START, 0, [stop("A", 1), stop("B", 2)], [lock, after_b], LINE)
    assert isinstance(result, rp.Conflict)
    assert {r.id for r in result.rules} == {"lock:A", "today:B>A"}


def test_rules_about_absent_customers_are_ignored():
    rule = rp.Rule(id="today:X>A", text="先 X 再 A", kind="precedence", customer_ids=("X", "A"))
    assert order_of(rp.plan(START, 0, [stop("A", 1)], [rule], LINE)) == ["A"]


def test_no_stops_is_an_empty_plan():
    result = rp.plan(START, 0, [], [], LINE)
    assert result.slots == [] and result.travel_minutes == 0


def test_more_than_eight_open_stops_is_refused():
    with pytest.raises(ValueError):
        rp.plan(START, 0, [stop(f"S{i}", 1) for i in range(9)], [], LINE)


def test_eight_stops_are_planned_within_a_second():
    rng = random.Random(7)
    points = [(rng.random(), rng.random()) for _ in range(9)]
    minutes = [[round(((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5 * 60) for b in points] for a in points]
    stops = [stop(f"S{i}", i + 1) for i in range(8)]
    began = time.perf_counter()
    result = rp.plan(START, 0, stops, [], minutes)
    assert time.perf_counter() - began < 1.0
    assert len(order_of(result)) == 8


def test_violations_lists_the_broken_rules():
    before = rp.Rule(id="today:B>A", text="先 B 再 A", kind="precedence", customer_ids=("B", "A"))
    lock = rp.Rule(id="lock:C", text="C 排第一站", kind="lock", customer_ids=("C",), position=0)
    last = rp.Rule(id="habit:1", text="B 排最後", kind="last", customer_ids=("B",))
    assert rp.violations(["C", "B", "A"], [before, lock, last]) == [last]
    assert rp.violations(["A", "B", "C"], [before, lock, last]) == [before, lock, last]


def test_cheapest_insert_goes_between_its_neighbours():
    assert rp.cheapest_insert(START, 0, [stop("A", 1), stop("C", 3)], stop("B", 2), [], LINE) == 1


def test_cheapest_insert_does_not_move_a_locked_stop():
    # X 就在出發點旁邊，沒有鎖的話排第一最順（5 + 25 + 10 = 40 分鐘）；
    # A 鎖在第一站，X 只能插在 A 後面，排最後（30 + 10 + 15 = 55）比插中間（30 + 25 + 15 = 70）順
    ordered = [stop("A", 3), stop("C", 2)]
    assert rp.cheapest_insert(START, 0, ordered, stop("X", 4), [], LINE) == 0
    lock = rp.Rule(id="lock:A", text="A 排第一站", kind="lock", customer_ids=("A",), position=0)
    assert rp.cheapest_insert(START, 0, ordered, stop("X", 4), [lock], LINE) == 2


def test_cheapest_insert_ignores_rules_the_order_already_breaks():
    # 既有的順序已經違反「A 排最後」的規則（A 在第一位），
    # 插 B 在中間不會新增違反，所以應該選成本最低的位置（1）
    last_rule = rp.Rule(id="habit:last", text="A 排最後", kind="last", customer_ids=("A",))
    ordered = [stop("A", 1), stop("C", 3)]
    assert rp.cheapest_insert(START, 0, ordered, stop("B", 2), [last_rule], LINE) == 1


def test_a_first_rule_can_cover_several_customers():
    # 「先跑康泰的店」符合兩家：兩家都要排在其他站前面
    first = rp.Rule(id="habit:1", text="先跑康泰的店", kind="first", customer_ids=("B", "C"))
    order = order_of(rp.plan(START, 0, [stop("A", 1), stop("B", 2), stop("C", 3)], [first], LINE))
    assert set(order[:2]) == {"B", "C"} and order[2] == "A"
    assert rp.violations(["B", "A", "C"], [first]) == [first]


def test_a_last_rule_can_cover_several_customers():
    last = rp.Rule(id="habit:1", text="診所排最後", kind="last", customer_ids=("A", "B"))
    order = order_of(rp.plan(START, 0, [stop("A", 1), stop("B", 2), stop("C", 3)], [last], LINE))
    assert order[0] == "C"
    assert rp.violations(["A", "C", "B"], [last]) == [last]


def test_first_and_last_on_the_same_customer_conflict():
    first = rp.Rule(id="habit:1", text="A 排第一", kind="first", customer_ids=("A",))
    last = rp.Rule(id="habit:2", text="A 排最後", kind="last", customer_ids=("A",))
    result = rp.plan(START, 0, [stop("A", 1), stop("B", 2)], [first, last], LINE)
    assert isinstance(result, rp.Conflict)
    assert {r.id for r in result.rules} == {"habit:1", "habit:2"}


def test_two_first_rules_for_different_customers_conflict():
    a_first = rp.Rule(id="habit:1", text="A 排第一", kind="first", customer_ids=("A",))
    b_first = rp.Rule(id="habit:2", text="B 排第一", kind="first", customer_ids=("B",))
    result = rp.plan(START, 0, [stop("A", 1), stop("B", 2), stop("C", 3)], [a_first, b_first], LINE)
    assert isinstance(result, rp.Conflict)
    assert {r.id for r in result.rules} == {"habit:1", "habit:2"}


def test_a_lock_past_the_last_stop_is_a_conflict():
    lock = rp.Rule(id="lock:A", text="A 鎖在第 4 站", kind="lock", customer_ids=("A",), position=3)
    result = rp.plan(START, 0, [stop("A", 1), stop("B", 2)], [lock], LINE)
    assert isinstance(result, rp.Conflict) and result.rules == [lock]
    assert rp.violations(["A", "B"], [lock]) == [lock]


def test_locking_the_same_customer_twice_at_the_same_place_is_fine():
    # 「需立即處理」的鎖與業務自己按的鎖可能同時在：同一家、同一個位置，不算衝突
    lock = rp.Rule(id="lock:C", text="C 排第一站", kind="lock", customer_ids=("C",), position=0)
    again = rp.Rule(id="urgent:C", text="C 需立即處理", kind="lock", customer_ids=("C",), position=0)
    assert order_of(rp.plan(START, 0, [stop("A", 1), stop("B", 2), stop("C", 3)], [lock, again], LINE))[0] == "C"


def test_two_customers_locked_at_the_same_place_conflict():
    lock_a = rp.Rule(id="lock:A", text="A 鎖在第 1 站", kind="lock", customer_ids=("A",), position=0)
    lock_b = rp.Rule(id="lock:B", text="B 鎖在第 1 站", kind="lock", customer_ids=("B",), position=0)
    result = rp.plan(START, 0, [stop("A", 1), stop("B", 2)], [lock_a, lock_b], LINE)
    assert isinstance(result, rp.Conflict)
    assert {r.id for r in result.rules} == {"lock:A", "lock:B"}


def test_the_same_customer_locked_at_two_places_is_a_conflict():
    first = rp.Rule(id="lock:A", text="A 鎖在第 1 站", kind="lock", customer_ids=("A",), position=0)
    second = rp.Rule(id="urgent:A", text="A 鎖在第 2 站", kind="lock", customer_ids=("A",), position=1)
    assert isinstance(rp.plan(START, 0, [stop("A", 1), stop("B", 2)], [first, second], LINE), rp.Conflict)


def test_one_rule_split_into_pairs_is_reported_once():
    # 「B、C 排在 A 前面」這條習慣拆成兩組兩兩的先後，id 一樣；A 又鎖在第一站
    pairs = [
        rp.Rule(id="habit:7", text="B、C 排在 A 前面", kind="precedence", customer_ids=("B", "A")),
        rp.Rule(id="habit:7", text="B、C 排在 A 前面", kind="precedence", customer_ids=("C", "A")),
    ]
    lock = rp.Rule(id="lock:A", text="A 排第一站", kind="lock", customer_ids=("A",), position=0)
    result = rp.plan(START, 0, [stop("A", 1), stop("B", 2), stop("C", 3)], [*pairs, lock], LINE)
    assert isinstance(result, rp.Conflict)
    # 整條習慣拿掉就排得出來，所以它也是擋住的那幾條之一；只列一次
    assert sorted(r.id for r in result.rules) == ["habit:7", "lock:A"]
    assert [r.id for r in rp.violations(["A", "B", "C"], pairs)] == ["habit:7"]
