"""主管端：風險通報（原型回寫完成頁的「主管同步收到通報」）。

主管看自己底下業務的通報，IT 看全公司的（SHARING_LEVEL["manager_inbox"]）。
依拜訪的業務在組織樹上的位置過濾，不看轄區，也不看通報當時記的 manager_id：業務換了主管，通報跟著人走。
"""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from app.api.auth import ManagerUser
from app.db import get_session
from app.models import AppUser, Customer, ManagerNotice
from app.services.risk import RISK_MAX
from app.services.scope import SHARING_LEVEL, Scope

router = APIRouter(prefix="/api/manager", tags=["manager"])
SessionDep = Annotated[Session, Depends(get_session)]
Rep = aliased(AppUser)


class NoticeItem(BaseModel):
    id: int
    customer_id: str
    customer_name: str
    rep_name: str
    reason: str
    score: int
    max: int
    items: list[str]
    visit_id: str
    created_at: dt.datetime
    seen_at: dt.datetime | None


class Unseen(BaseModel):
    count: int


def _mine(manager: AppUser):
    return Scope.for_user(manager).includes(SHARING_LEVEL["manager_inbox"], ManagerNotice.rep_id)


def _items(session: Session, manager: AppUser, *criteria) -> list[NoticeItem]:
    rows = session.execute(
        select(ManagerNotice, Customer.name, Rep.name)
        .join(Customer, Customer.id == ManagerNotice.customer_id)
        .join(Rep, Rep.id == ManagerNotice.rep_id)
        .where(_mine(manager), *criteria)
        .order_by(ManagerNotice.created_at.desc(), ManagerNotice.id.desc())
    )
    return [
        NoticeItem(
            id=n.id, customer_id=n.customer_id, customer_name=customer_name, rep_name=rep_name,
            reason=n.reason, score=n.score, max=RISK_MAX, items=n.items, visit_id=n.visit_id,
            created_at=n.created_at, seen_at=n.seen_at,
        )
        for n, customer_name, rep_name in rows
    ]


@router.get("/notices", response_model=list[NoticeItem])
def list_notices(session: SessionDep, manager: ManagerUser):
    return _items(session, manager)


@router.get("/notices/unseen", response_model=Unseen)
def unseen_notices(session: SessionDep, manager: ManagerUser):
    count = session.scalar(
        select(func.count())
        .select_from(ManagerNotice)
        .where(_mine(manager), ManagerNotice.seen_at.is_(None))
    )
    return Unseen(count=count or 0)


@router.post("/notices/{notice_id}/seen", response_model=NoticeItem)
def mark_notice_seen(session: SessionDep, notice_id: int, manager: ManagerUser):
    items = _items(session, manager, ManagerNotice.id == notice_id)
    if not items:
        raise HTTPException(404, "找不到這則通報")
    notice = session.get(ManagerNotice, notice_id)
    if notice.seen_at is None:
        notice.seen_at = dt.datetime.now(dt.UTC)
        session.commit()
    return _items(session, manager, ManagerNotice.id == notice_id)[0]
