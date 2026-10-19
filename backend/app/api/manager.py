"""主管端：團隊的客戶提問與客戶策略。"""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.auth import ManagerUser
from app.api.customer_priority import router as priority_router
from app.api.featured_products import router as featured_router
from app.db import get_session
from app.models import AppUser, AskRecord, Customer
from app.services.auth import role_data_user
from app.services.team_itineraries import reps

router = APIRouter(prefix="/api/manager", tags=["manager"])
router.include_router(priority_router)
router.include_router(featured_router)
SessionDep = Annotated[Session, Depends(get_session)]


class TeamRep(BaseModel):
    id: str
    name: str
    region: str


class InquiryCustomer(BaseModel):
    id: str
    name: str


class CustomerInquiry(BaseModel):
    id: str
    rep: TeamRep
    customers: list[InquiryCustomer]
    question: str
    kind: str
    status: str
    created_at: str


class TeamInquiries(BaseModel):
    scope: str
    reps: list[TeamRep]
    items: list[CustomerInquiry]
    total: int


@router.get("/inquiries", response_model=TeamInquiries)
def team_inquiries(
    session: SessionDep, manager: ManagerUser, response: Response,
    days: Annotated[int, Query(ge=1, le=90)] = 7,
    rep: str | None = None,
    needs_help: bool = False,
    q: Annotated[str, Query(max_length=100)] = "",
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
):
    """只列團隊與客戶有關的提問，不回傳答案、私人記憶、位置或行程。"""
    response.headers["Cache-Control"] = "no-store"
    people = reps(session, manager)
    by_id = {person.id: person for person in people}
    if rep is not None and rep not in by_id:
        raise HTTPException(404, "找不到這位業務")
    conditions = [
        AskRecord.user_id.in_([rep] if rep else list(by_id)),
        AskRecord.ghost.is_(False),
        func.jsonb_array_length(AskRecord.customer_ids) > 0,
        AskRecord.created_at >= dt.datetime.now(dt.UTC).replace(tzinfo=None) - dt.timedelta(days=days),
    ]
    if needs_help:
        conditions.append(AskRecord.status.in_(["no_evidence", "not_converged", "failed"]))
    if q.strip():
        escaped = q.strip().replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")
        pattern = f"%{escaped}%"
        customer_match = select(Customer.id).where(
            Customer.name.ilike(pattern), AskRecord.customer_ids.op("?")(Customer.id),
        ).exists()
        conditions.append(or_(
            AskRecord.question.ilike(pattern),
            AskRecord.user_id.in_([person.id for person in people if q.strip() in person.name]),
            customer_match,
        ))
    total = session.scalar(select(func.count()).select_from(AskRecord).where(*conditions)) or 0
    records = list(session.scalars(select(AskRecord).where(*conditions)
        .order_by(AskRecord.created_at.desc(), AskRecord.id.desc()).offset(offset).limit(limit)))
    customer_ids = {customer_id for record in records for customer_id in record.customer_ids}
    customers = {customer.id: customer for customer in session.scalars(select(Customer).where(Customer.id.in_(customer_ids)))}
    def person_out(person: AppUser) -> TeamRep:
        return TeamRep(id=person.id, name=person.name, region=person.region)
    return TeamInquiries(
        scope="全公司" if manager.role == "it" else role_data_user(manager).region,
        reps=[person_out(person) for person in people], total=total,
        items=[CustomerInquiry(
            id=record.id, rep=person_out(by_id[record.user_id]),
            customers=[InquiryCustomer(id=key, name=customers[key].name) for key in record.customer_ids if key in customers],
            question=record.question, kind=record.kind, status=record.status,
            created_at=record.created_at.replace(tzinfo=record.created_at.tzinfo or dt.UTC).isoformat(),
        ) for record in records],
    )


@router.get("/itineraries")
@router.get("/itineraries/{user_id}")
@router.get("/locations")
def retired_tracking(manager: ManagerUser, user_id: str | None = None):
    raise HTTPException(410, "團隊動向追蹤已停用，請改看客戶提問。")
