"""拜訪備忘的規則：確認時怎麼寫、下次去這家列哪幾則、一個月的日曆。"""

import datetime as dt

from app.models import CustomerNote, Visit
from app.services import customer_notes, extraction

TAIPEI = dt.timezone(dt.timedelta(hours=8))


def visit(tx, customer_id="C003", notes=None, follow_up=None, day=dt.date(2026, 10, 20)):
    fields = {
        "competitor": None, "complaint": None, "intent": None, "commitment": None,
        "follow_up_date": follow_up, "notes": notes,
    }
    v = Visit(
        customer_id=customer_id, user_id="U01", visited_at=dt.datetime.combine(day, dt.time(10), TAIPEI),
        fields_raw=fields, fields_final=fields, status="confirmed",
    )
    tx.add(v)
    tx.flush()
    return v


def hand_written(tx, text, kind="bring", customer_id="C003", on_date=None):
    tx.add(CustomerNote(customer_id=customer_id, user_id="U01", kind=kind, text=text, on_date=on_date))
    tx.flush()


def test_notes_from_a_visit_get_their_dates(tx):
    v = visit(tx, notes=[
        {"kind": "bring", "text": "骨營 DM", "date": "2026-11-02"},
        {"kind": "bring", "text": "試用包", "date": None},
        {"kind": "told", "text": "小口買 22 送 1", "date": None},
    ], follow_up="2026-10-30")
    made = customer_notes.notes_from_visit(tx, v)
    assert [(n.kind, n.text, n.on_date, n.visit_id, n.user_id) for n in made] == [
        ("bring", "骨營 DM", dt.date(2026, 11, 2), v.id, "U01"),
        # 沒講日期就放追蹤日
        ("bring", "試用包", dt.date(2026, 10, 30), v.id, "U01"),
        # 講過的放拜訪日
        ("told", "小口買 22 送 1", dt.date(2026, 10, 20), v.id, "U01"),
    ]
    no_follow_up = visit(tx, notes=[{"kind": "bring", "text": "POP", "date": None}])
    assert customer_notes.notes_from_visit(tx, no_follow_up)[0].on_date is None
    assert customer_notes.notes_from_visit(tx, visit(tx)) == []


def test_the_newest_visit_with_notes_replaces_the_older_ones(tx):
    customer_notes.notes_from_visit(tx, visit(tx, notes=[{"kind": "bring", "text": "舊的 DM", "date": None}]))
    tx.flush()
    hand_written(tx, "手寫的舊話", kind="told", on_date=dt.date(2026, 10, 2))
    customer_notes.notes_from_visit(tx, visit(tx, notes=[
        {"kind": "told", "text": "新的條件", "date": None},
        {"kind": "bring", "text": "新的試用包", "date": None},
    ]))
    tx.flush()
    hand_written(tx, "之後手寫的")
    # 沒有備忘的拜訪不會把舊的蓋掉
    visit(tx)
    assert [n.text for n in customer_notes.next_notes(tx, "C003")] == ["新的試用包", "之後手寫的", "新的條件"]


def test_without_visit_notes_all_hand_written_ones_show(tx):
    hand_written(tx, "寫的第一則", kind="told", customer_id="C005", on_date=dt.date(2026, 10, 3))
    hand_written(tx, "寫的第二則", customer_id="C005")
    # 要帶的排前面
    assert [n.text for n in customer_notes.next_notes(tx, "C005")] == ["寫的第二則", "寫的第一則"]
    assert customer_notes.next_notes(tx, "C007") == []


def test_the_prompt_asks_for_notes():
    prompt = extraction.build_prompt("逐字稿", dt.date(2026, 10, 28), [])
    assert "10. notes" in prompt and "bring" in prompt and "told" in prompt
    assert "notes" in extraction.FIELD_KEYS


def test_a_month_of_notes_and_visits_for_one_rep(tx):
    first, last = dt.date(2026, 10, 1), dt.date(2026, 10, 31)
    notes = customer_notes.month_notes(tx, "U01", first, last)
    # 示範資料：忠孝店 10/30 要帶貨架卡；沒日期的不上日曆
    assert ("C001", dt.date(2026, 10, 30), "bring") in {(n.customer_id, n.on_date, n.kind) for n, _ in notes}
    assert all(n.on_date is not None and first <= n.on_date <= last for n, _ in notes)
    assert [n.on_date for n, _ in notes] == sorted(n.on_date for n, _ in notes)
    visits = customer_notes.month_visits(tx, "U01", first, last)
    assert visits and all(v.status in ("confirmed", "synced") for v, _ in visits)
    assert all(first <= v.visited_at.astimezone(TAIPEI).date() <= last for v, _ in visits)
    # 別人的客戶不列
    assert customer_notes.month_notes(tx, "U02", first, last) == []
