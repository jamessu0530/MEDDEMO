"""OA 申請單（出差單、優惠、合約）的申請匣與簽核。"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser, ManagerUser
from app.db import get_session
from app.models import OA_FORM_STATUSES
from app.services import oa

router = APIRouter(prefix="/api/oa", tags=["oa"])
SessionDep = Annotated[Session, Depends(get_session)]


class DecideInput(BaseModel):
    action: Literal["approve", "reject", "return"]
    comment: str | None = Field(default=None, max_length=2000)
    # 畫面上顯示的那一關。有帶而且不是現在等簽的那一關就不簽（409）：IT 連點兩次才不會連簽兩關
    step_no: int | None = None


@router.get("/forms")
def list_forms(
    session: SessionDep,
    user: CurrentUser,
    status: Annotated[str | None, Query()] = None,
):
    if status and status not in OA_FORM_STATUSES:
        status = None
    return oa.list_mine(session, user, status)


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
