"""OA 申請單（出差單、優惠、合約）的申請匣與簽核。"""

import datetime as dt
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import literal, or_, select
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser, ManagerUser
from app.db import get_session
from app.models import OA_FORM_STATUSES, Customer
from app.services import oa, oa_legacy

router = APIRouter(prefix="/api/oa", tags=["oa"])
SessionDep = Annotated[Session, Depends(get_session)]


class DecideInput(BaseModel):
    action: Literal["approve", "reject", "return"]
    comment: str | None = Field(default=None, max_length=2000)
    # 畫面上顯示的那一關。有帶而且不是現在等簽的那一關就不簽（409）：IT 連點兩次才不會連簽兩關
    step_no: int | None = None


class LegacyInput(BaseModel):
    template_code: str = Field(max_length=40)
    customer_id: str | None = Field(default=None, max_length=100)
    fields: dict[str, Annotated[str, Field(max_length=2000)]] = Field(default_factory=dict, max_length=30)
    purpose: str = Field(default="", max_length=2000)
    submit: bool = False


class PrefillInput(BaseModel):
    customer_id: str | None = Field(default=None, max_length=100)
    mode: Literal["known", "sample", "text"] = "known"
    text: str = Field(default="", max_length=2000)


@router.get("/templates")
def templates(user: CurrentUser):
    return oa_legacy.catalog()


@router.get("/customers")
def form_customers(session: SessionDep, user: CurrentUser, q: Annotated[str, Query(max_length=100)] = ""):
    """OA 只需要共用的客戶主檔，不依賴訂單工作區或公開通路的額外資料表。"""
    stmt = select(Customer.id, Customer.name, Customer.region, Customer.city, literal("").label("area"))
    if q.strip():
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(or_(Customer.name.ilike(pattern), Customer.id.ilike(pattern), Customer.city.ilike(pattern), Customer.region.ilike(pattern)))
    return [dict(row) for row in session.execute(stmt.order_by(Customer.name, Customer.id).limit(50)).mappings()]


@router.post("/templates/{code}/prefill")
def prefill_template(code: str, body: PrefillInput, session: SessionDep, user: CurrentUser):
    return oa_legacy.prefill(session, user, code, body.customer_id, body.mode, body.text)


@router.post("/forms", status_code=201)
def create_legacy_form(body: LegacyInput, session: SessionDep, user: CurrentUser):
    form = oa_legacy.save(session, user, body.template_code, body.customer_id, body.fields, body.purpose, submit=body.submit)
    session.commit()
    return oa.detail(session, form, user)


@router.put("/forms/{form_id}")
def update_legacy_form(form_id: int, body: LegacyInput, session: SessionDep, user: CurrentUser):
    form = oa_legacy.save(session, user, body.template_code, body.customer_id, body.fields, body.purpose, form_id=form_id, submit=body.submit)
    session.commit()
    return oa.detail(session, form, user)


@router.get("/forms")
def list_forms(
    session: SessionDep,
    user: CurrentUser,
    status: Annotated[str | None, Query()] = None,
    application: Annotated[str | None, Query(max_length=40)] = None,
    q: Annotated[str, Query(max_length=100)] = "",
    company: Annotated[str, Query(max_length=100)] = "",
    unit: Annotated[str, Query(max_length=100)] = "",
    submitted_date: dt.date | None = None,
):
    if status and status not in OA_FORM_STATUSES:
        status = None
    return oa.list_mine(session, user, status, application=application, query=q, company=company, unit=unit, submitted_date=submitted_date)


@router.get("/inbox")
def inbox(session: SessionDep, user: ManagerUser):
    return oa.list_inbox(session, user)


@router.get("/auto-approved")
def auto_approved(session: SessionDep, user: ManagerUser):
    """模型有把握、由系統核准的單，給主管事後查。"""
    return oa.list_auto_approved(session, user)


@router.get("/forms/{form_id}")
def get_form(session: SessionDep, form_id: int, user: CurrentUser):
    return oa.detail(session, oa.load_form(session, form_id, user), user)


@router.post("/forms/{form_id}/decide")
def decide_form(session: SessionDep, form_id: int, body: DecideInput, user: CurrentUser):
    form = oa.load_form(session, form_id, user)
    oa.decide(session, form, user, body.action, body.comment.strip() if body.comment else None, body.step_no)
    session.commit()
    return oa.detail(session, form, user)
