"""主管端：風險通報（原型回寫完成頁的「主管同步收到通報」）。只有主管，只看自己轄區。"""

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


def _items(session: Session, manager: AppUser, *criteria) -> list[NoticeItem]:
    rows = session.execute(
        select(ManagerNotice, Customer.name, Rep.name)
        .join(Customer, Customer.id == ManagerNotice.customer_id)
        .join(Rep, Rep.id == ManagerNotice.rep_id)
        # 用轄區而不是 manager_id 過濾：同一區有兩位主管時，大家都看得到
        .where(Customer.region == manager.region, *criteria)
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
        .join(Customer, Customer.id == ManagerNotice.customer_id)
        .where(Customer.region == manager.region, ManagerNotice.seen_at.is_(None))
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
