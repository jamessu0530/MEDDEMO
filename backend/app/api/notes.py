"""拜訪備忘與日曆（docs/superpowers/specs/2026-10-07-calendar-notes-design.md）。

備忘的權限跟報價一樣：負責人與他的主管，其他人跟客戶不存在一樣回 404。日曆看的是行程主人負責的客戶，
跟今日路線一樣（代理示範業務的帳號看示範業務的）。
"""

import calendar
import datetime as dt
import re
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.api.customers import _load
from app.db import get_session
from app.models import AppUser, Customer, CustomerNote
from app.services import customer_notes, customer_profile
from app.services.scope import SHARING_LEVEL
from app.timeutil import local_date

router = APIRouter(tags=["notes"])
SessionDep = Annotated[Session, Depends(get_session)]
Kind = Literal["bring", "told"]
# 一句話：要帶什麼、講了什麼條件。資料表也擋在 200 字
TEXT_MAX = 200
MONTH = re.compile(r"\d{4}-\d{2}")


def _text(value: str | None) -> str | None:
    if value is not None and not value.strip():
        raise ValueError("備忘不能空白")
    return value.strip() if value is not None else None


class NoteOut(BaseModel):
    id: int
    customer_id: str
    customer_name: str
    kind: Kind
    text: str
    on_date: dt.date | None
    visit_id: str | None
    created_at: dt.datetime


class NextNotes(BaseModel):
    next: list[NoteOut]


class NoteInput(BaseModel):
    kind: Kind
    text: str = Field(max_length=TEXT_MAX)
    on_date: dt.date | None = None

    _strip = field_validator("text")(_text)


class NotePatch(BaseModel):
    kind: Kind | None = None
    text: str | None = Field(default=None, max_length=TEXT_MAX)
    on_date: dt.date | None = None

    _strip = field_validator("text")(_text)


class CalendarVisit(BaseModel):
    visit_id: str
    customer_id: str
    customer_name: str


class CalendarDay(BaseModel):
    date: dt.date
    visits: list[CalendarVisit]
    notes: list[NoteOut]


class CalendarMonth(BaseModel):
    month: str
    # 系統日：日曆標「今天」用，跟首頁同一天
    today: dt.date
    # 只列有拜訪或有備忘的日子，照日期排
    days: list[CalendarDay]


def _out(note: CustomerNote, customer_name: str) -> NoteOut:
    return NoteOut(
        id=note.id, customer_id=note.customer_id, customer_name=customer_name, kind=note.kind, text=note.text,
        on_date=note.on_date, visit_id=note.visit_id, created_at=note.created_at,
    )


def _load_note(session: Session, note_id: int, user: AppUser) -> tuple[CustomerNote, Customer]:
    """看不到這家客戶，就跟這則備忘不存在一樣。"""
    note = session.get(CustomerNote, note_id)
    if note is None:
        raise HTTPException(404, "找不到這則備忘")
    try:
        customer, _ = _load(session, note.customer_id, user, SHARING_LEVEL["quote"])
    except HTTPException:
        raise HTTPException(404, "找不到這則備忘") from None
    return note, customer


@router.get("/api/customers/{customer_id}/notes", response_model=NextNotes)
def next_notes(session: SessionDep, customer_id: str, user: CurrentUser):
    """下次去這家要記得的：最近一次有備忘的拜訪記下的，加上那之後手寫的。"""
    customer, _ = _load(session, customer_id, user, SHARING_LEVEL["quote"])
    return NextNotes(next=[_out(n, customer.name) for n in customer_notes.next_notes(session, customer.id)])


@router.post("/api/customers/{customer_id}/notes", status_code=201, response_model=NoteOut)
def create_note(session: SessionDep, customer_id: str, body: NoteInput, user: CurrentUser):
    """手寫一則。記實際寫的人：代理示範業務的帳號寫的，記代理的那個帳號。"""
    customer, _ = _load(session, customer_id, user, SHARING_LEVEL["quote"])
    # 講過的一定是某一天講的：沒給就是今天（系統日，跟首頁同一天）
    on_date = body.on_date or (customer_profile.app_today(session) if body.kind == "told" else None)
    note = CustomerNote(customer_id=customer.id, user_id=user.id, kind=body.kind, text=body.text, on_date=on_date)
    session.add(note)
    session.commit()
    return _out(note, customer.name)


@router.patch("/api/notes/{note_id}", response_model=NoteOut)
def update_note(session: SessionDep, note_id: int, body: NotePatch, user: CurrentUser):
    note, customer = _load_note(session, note_id, user)
    changes = body.model_dump(exclude_unset=True)
    kind = changes.get("kind") or note.kind
    on_date = changes["on_date"] if "on_date" in changes else note.on_date
    if kind == "told" and on_date is None:
        raise HTTPException(422, "講過的備忘要有日期")
    note.kind, note.on_date = kind, on_date
    if changes.get("text"):
        note.text = changes["text"]
    session.commit()
    return _out(note, customer.name)


@router.delete("/api/notes/{note_id}", status_code=204)
def delete_note(session: SessionDep, note_id: int, user: CurrentUser):
    note, _ = _load_note(session, note_id, user)
    session.delete(note)
    session.commit()
    return Response(status_code=204)


@router.get("/api/calendar", response_model=CalendarMonth)
def calendar_month(session: SessionDep, user: CurrentUser, month: str | None = None):
    """這個月有東西的每一天：那天確認過的拜訪、日期在那天的備忘。沒給 month 就是系統日那個月。"""
    today = customer_profile.app_today(session)
    if month is None:
        first = today.replace(day=1)
    else:
        try:
            if not MONTH.fullmatch(month):
                raise ValueError(month)
            first = dt.date.fromisoformat(f"{month}-01")
        except ValueError:
            raise HTTPException(422, "month 要寫成 YYYY-MM") from None
    last = first.replace(day=calendar.monthrange(first.year, first.month)[1])
    owner = user.acts_as_user_id or user.id
    days: dict[dt.date, CalendarDay] = {}

    def day(date: dt.date) -> CalendarDay:
        return days.setdefault(date, CalendarDay(date=date, visits=[], notes=[]))

    for visit, name in customer_notes.month_visits(session, owner, first, last):
        day(local_date(visit.visited_at)).visits.append(
            CalendarVisit(visit_id=visit.id, customer_id=visit.customer_id, customer_name=name)
        )
    for note, name in customer_notes.month_notes(session, owner, first, last):
        day(note.on_date).notes.append(_out(note, name))
    return CalendarMonth(month=f"{first:%Y-%m}", today=today, days=sorted(days.values(), key=lambda d: d.date))
