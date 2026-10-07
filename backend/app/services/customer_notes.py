"""拜訪備忘（docs/superpowers/specs/2026-10-07-calendar-notes-design.md）。

三個規則都寫在這裡，客戶檔案、今日路線、日曆讀同一份：確認拜訪時怎麼寫、下次去這家列哪幾則、一個月的日曆。
先後一律用流水號，不用 created_at：同一個交易裡建的幾則 created_at 一樣。
"""

import datetime as dt
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Customer, CustomerNote, Visit
from app.timeutil import TAIPEI, local_date

# 確認過的拜訪：回寫成功與否都算，日曆上那天就是有去
CONFIRMED = ("confirmed", "synced")


def ordered(notes: Iterable[CustomerNote]) -> list[CustomerNote]:
    """要帶的排前面（出門前要準備），同種照建立的先後。"""
    return sorted(notes, key=lambda n: (n.kind != "bring", n.id))


def notes_from_visit(session: Session, visit: Visit) -> list[CustomerNote]:
    """確認拜訪時把 notes 欄位寫進備忘表。要帶的沒講日期就放追蹤日；講過的放拜訪日。"""
    fields = visit.fields_final or {}
    follow_up = fields.get("follow_up_date")
    made = []
    for item in fields.get("notes") or []:
        if item["kind"] == "told":
            on_date = local_date(visit.visited_at)
        else:
            day = item.get("date") or follow_up
            on_date = dt.date.fromisoformat(day) if day else None
        note = CustomerNote(
            customer_id=visit.customer_id, user_id=visit.user_id, kind=item["kind"], text=item["text"],
            on_date=on_date, visit_id=visit.id,
        )
        session.add(note)
        made.append(note)
    session.flush()
    return made


def next_notes(session: Session, customer_id: str) -> list[CustomerNote]:
    """下次去這家要記得的：最近一次有備忘的拜訪記下的，加上那之後手寫的。沒有拜訪來的就列全部手寫的。"""
    latest = session.scalars(
        select(CustomerNote)
        .where(CustomerNote.customer_id == customer_id, CustomerNote.visit_id.is_not(None))
        .order_by(CustomerNote.id.desc())
        .limit(1)
    ).first()
    query = select(CustomerNote).where(CustomerNote.customer_id == customer_id)
    if latest is None:
        query = query.where(CustomerNote.visit_id.is_(None))
    else:
        query = query.where(
            (CustomerNote.visit_id == latest.visit_id)
            | (CustomerNote.visit_id.is_(None) & (CustomerNote.id > latest.id))
        )
    return ordered(session.scalars(query))


def month_notes(session: Session, owner_id: str, first: dt.date, last: dt.date) -> list[tuple[CustomerNote, str]]:
    """這位業務負責的客戶，日期落在這段期間的備忘（附客戶名稱），照日期排，同一天要帶的在前。"""
    rows = session.execute(
        select(CustomerNote, Customer.name)
        .join(Customer, Customer.id == CustomerNote.customer_id)
        .where(Customer.owner_user_id == owner_id, CustomerNote.on_date.between(first, last))
    ).all()
    return sorted(((note, name) for note, name in rows), key=lambda r: (r[0].on_date, r[0].kind != "bring", r[0].id))


def month_visits(session: Session, owner_id: str, first: dt.date, last: dt.date) -> list[tuple[Visit, str]]:
    """這位業務負責的客戶，這段期間確認過的拜訪（附客戶名稱），照拜訪時間排。"""
    start = dt.datetime.combine(first, dt.time(), TAIPEI)
    end = dt.datetime.combine(last + dt.timedelta(days=1), dt.time(), TAIPEI)
    rows = session.execute(
        select(Visit, Customer.name)
        .join(Customer, Customer.id == Visit.customer_id)
        .where(
            Customer.owner_user_id == owner_id, Visit.status.in_(CONFIRMED),
            Visit.visited_at >= start, Visit.visited_at < end,
        )
        .order_by(Visit.visited_at)
    ).all()
    return [(visit, name) for visit, name in rows]
