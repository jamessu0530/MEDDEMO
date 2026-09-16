"""轉給主管的提問（FR-8.4 延伸）：主管回覆，業務收到通知。

沒有登入（FR-12／13 不在這次範圍），主管端靠網址進入，回覆時選自己是哪一位主管；
業務的首頁定時問有沒有還沒看過的回覆，打開「轉給主管的提問」就標成看過。
"""

import datetime as dt
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from app.api.auth import CurrentUser, ManagerUser
from app.db import get_session
from app.models import AppUser, AskRecord, Escalation

router = APIRouter(prefix="/api/escalations", tags=["escalations"])
SessionDep = Annotated[Session, Depends(get_session)]


class EscalationItem(BaseModel):
    id: int
    ask_id: str
    kind: str
    question: str
    # 系統當時的回覆（查無依據的說明），主管回覆前看得到業務卡在哪裡
    system_answer: str | None
    status: str
    answer: str | None
    answered_by: str | None
    answered_at: dt.datetime | None
    seen_at: dt.datetime | None
    created_at: dt.datetime


class ReplyInput(BaseModel):
    # 主管的回覆多半是幾句做法說明；2000 字夠貼一段規定原文，也擋掉誤貼的整份文件
    answer: str = Field(min_length=1, max_length=2000)


class Unseen(BaseModel):
    count: int


# 提問的人。AppUser 在查詢裡已經拿來 join 回覆的主管，所以另外取別名
Asker = aliased(AppUser)


def _visible_to(user: AppUser) -> Any:
    """業務只看得到自己轉出去的提問；主管只看得到自己轄區業務轉來的。"""
    if user.role == "manager":
        return Asker.region == user.region
    return AskRecord.user_id == user.id


def _items(session: Session, *criteria: Any) -> list[EscalationItem]:
    rows = session.execute(
        select(Escalation, AskRecord.kind, AskRecord.answer, AppUser.name)
        .join(AskRecord, AskRecord.id == Escalation.ask_id)
        .join(Asker, Asker.id == AskRecord.user_id)
        .outerjoin(AppUser, AppUser.id == Escalation.answered_by)
        .where(*criteria)
        .order_by(Escalation.created_at.desc(), Escalation.id.desc())
    )
    return [
        EscalationItem(
            id=e.id,
            ask_id=e.ask_id,
            kind=kind,
            question=e.question,
            system_answer=system_answer,
            status=e.status,
            answer=e.answer,
            answered_by=manager,
            answered_at=e.answered_at,
            seen_at=e.seen_at,
            created_at=e.created_at,
        )
        for e, kind, system_answer, manager in rows
    ]


def _one(session: Session, escalation_id: int, user: AppUser) -> EscalationItem:
    items = _items(session, Escalation.id == escalation_id, _visible_to(user))
    if not items:
        raise HTTPException(404, "找不到這個提問")
    return items[0]


@router.get("", response_model=list[EscalationItem])
def list_escalations(session: SessionDep, user: CurrentUser, status: Literal["open", "answered"] | None = None):
    """主管端分開看待回覆（open）與已回覆（answered）；業務端不帶條件，看全部。新的在前面。"""
    return _items(session, _visible_to(user), *([Escalation.status == status] if status else []))


@router.get("/unseen", response_model=Unseen)
def unseen(session: SessionDep, user: CurrentUser):
    """業務還沒看過的主管回覆有幾則（只算自己轉出去的）。首頁定時問，有就提醒。"""
    count = session.scalar(
        select(func.count())
        .select_from(Escalation)
        .join(AskRecord, AskRecord.id == Escalation.ask_id)
        .where(Escalation.status == "answered", Escalation.seen_at.is_(None), AskRecord.user_id == user.id)
    )
    return Unseen(count=count or 0)


@router.post("/{escalation_id}/reply", response_model=EscalationItem)
def reply(session: SessionDep, escalation_id: int, body: ReplyInput, manager: ManagerUser):
    """主管回覆。回覆後可以再改；改過之後業務會再收到一次提醒。

    回覆者就是登入的主管（FR-12 之前是在畫面上自己選）。
    """
    escalation = session.get(Escalation, escalation_id, with_for_update=True)
    if escalation is None or not _items(session, Escalation.id == escalation_id, _visible_to(manager)):
        raise HTTPException(404, "找不到這個提問")
    answer = body.answer.strip()
    if not answer:
        raise HTTPException(422, "回覆不能是空白")
    escalation.answer = answer
    escalation.answered_by = manager.id
    escalation.answered_at = dt.datetime.now(dt.UTC)
    escalation.status = "answered"
    escalation.seen_at = None
    session.commit()
    return _one(session, escalation_id, manager)


@router.post("/{escalation_id}/seen", response_model=EscalationItem)
def mark_seen(session: SessionDep, escalation_id: int, user: CurrentUser):
    """業務看過主管的回覆。還沒回覆的提問不算看過。只有提問的人自己能標。"""
    escalation = session.get(Escalation, escalation_id, with_for_update=True)
    asker = session.scalar(select(AskRecord.user_id).where(AskRecord.id == escalation.ask_id)) if escalation else None
    if escalation is None or asker != user.id:
        raise HTTPException(404, "找不到這個提問")
    if escalation.status == "answered" and escalation.seen_at is None:
        escalation.seen_at = dt.datetime.now(dt.UTC)
        session.commit()
    return _one(session, escalation_id, user)
