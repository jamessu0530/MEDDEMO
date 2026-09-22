"""模擬 OA 出差單：開單、申請匣、主管簽核。"""

from __future__ import annotations

import datetime as dt
from typing import Any, Literal

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    OA_FORM_STATUSES,
    AppUser,
    Customer,
    OaActivity,
    OaApprovalStep,
    OaAttachment,
    OaComment,
    OaExpenseForm,
    Visit,
)
from app.services.scope import Scope
from app.timeutil import local_date

KIND_LABEL = "出差單"
FLOW_NAME = "出差單_簽核流程"


def region_manager(session: Session, region: str) -> AppUser:
    manager = session.scalar(select(AppUser).where(AppUser.role == "manager", AppUser.region == region).order_by(AppUser.id))
    if manager is None:
        raise RuntimeError(f"找不到{region}的主管")
    return manager


def next_form_no(session: Session, trip_date: dt.date) -> str:
    prefix = f"OA{trip_date:%Y%m}"
    last = session.scalar(select(func.max(OaExpenseForm.form_no)).where(OaExpenseForm.form_no.startswith(prefix)))
    seq = int(last[-5:]) + 1 if last else 1
    return f"{prefix}{seq:05d}"


def create_trip_form(session: Session, visit: Visit) -> OaExpenseForm:
    existing = session.scalar(select(OaExpenseForm).where(OaExpenseForm.visit_id == visit.id))
    if existing:
        return existing
    applicant = session.get(AppUser, visit.user_id)
    customer = session.get(Customer, visit.customer_id)
    manager = region_manager(session, customer.region)
    now = dt.datetime.now(dt.UTC)
    form = OaExpenseForm(
        form_no=next_form_no(session, local_date(visit.visited_at)),
        visit_id=visit.id,
        applicant_id=applicant.id,
        trip_date=local_date(visit.visited_at),
        customer_id=customer.id,
        purpose="客戶拜訪",
        unit_name=customer.region,
        status="pending",
        submitted_at=now,
    )
    session.add(form)
    session.flush()
    session.add(
        OaApprovalStep(
            form_id=form.id, step_no=1, role_label="請求者", user_id=applicant.id,
            title="業務", status="done", acted_at=now,
        )
    )
    session.add(
        OaApprovalStep(
            form_id=form.id, step_no=2, role_label="經辦人的主管", user_id=manager.id,
            title="區處主管", status="pending",
        )
    )
    session.add(OaActivity(form_id=form.id, action="submitted", actor_id=applicant.id, detail="經辦人送出"))
    return form


def form_id_for_visit(session: Session, visit_id: str) -> int | None:
    return session.scalar(select(OaExpenseForm.id).where(OaExpenseForm.visit_id == visit_id))


def _visible(session: Session, user: AppUser, form: OaExpenseForm) -> bool:
    if user.role == "manager":
        return session.get(Customer, form.customer_id).region == user.region
    return form.applicant_id == Scope.for_user(user).owner_id


def load_form(session: Session, form_id: int, user: AppUser) -> OaExpenseForm:
    form = session.get(OaExpenseForm, form_id)
    if form is None or not _visible(session, user, form):
        raise HTTPException(404, "找不到這張申請單")
    return form


def _counts(session: Session, *criteria: Any) -> dict[str, int]:
    rows = session.execute(select(OaExpenseForm.status, func.count()).where(*criteria).group_by(OaExpenseForm.status)).all()
    counts = {status: 0 for status in OA_FORM_STATUSES}
    for status, n in rows:
        counts[status] = n
    return counts


def _item(session: Session, form: OaExpenseForm) -> dict[str, Any]:
    applicant = session.get(AppUser, form.applicant_id)
    customer = session.get(Customer, form.customer_id)
    pending = session.scalar(
        select(OaApprovalStep).where(OaApprovalStep.form_id == form.id, OaApprovalStep.status == "pending").order_by(OaApprovalStep.step_no)
    )
    approver = session.get(AppUser, pending.user_id) if pending else None
    return {
        "id": form.id,
        "form_no": form.form_no,
        "kind": KIND_LABEL,
        "status": form.status,
        "applicant_name": applicant.name,
        "customer_name": customer.name,
        "trip_date": form.trip_date.isoformat(),
        "submitted_at": form.submitted_at or form.created_at,
        "approver_name": approver.name if approver else None,
    }


def list_mine(session: Session, user: AppUser, status: str | None) -> dict[str, Any]:
    owner = Scope.for_user(user).owner_id
    if owner is None:
        return {"items": [], "counts": {s: 0 for s in OA_FORM_STATUSES}}
    where = [OaExpenseForm.applicant_id == owner]
    counts = _counts(session, *where)
    if status:
        where.append(OaExpenseForm.status == status)
    forms = session.scalars(select(OaExpenseForm).where(*where).order_by(OaExpenseForm.created_at.desc(), OaExpenseForm.id.desc()).limit(50)).all()
    return {"items": [_item(session, form) for form in forms], "counts": counts}


def list_inbox(session: Session, user: AppUser) -> dict[str, Any]:
    if user.role != "manager":
        raise HTTPException(403, "只有主管可以看簽核匣")
    pending_ids = select(OaApprovalStep.form_id).where(OaApprovalStep.user_id == user.id, OaApprovalStep.status == "pending")
    forms = session.scalars(
        select(OaExpenseForm).where(OaExpenseForm.id.in_(pending_ids)).order_by(OaExpenseForm.created_at.desc(), OaExpenseForm.id.desc()).limit(50)
    ).all()
    return {"items": [_item(session, form) for form in forms], "counts": {"pending": len(forms)}}


def detail(session: Session, form: OaExpenseForm, user: AppUser | None = None) -> dict[str, Any]:
    applicant = session.get(AppUser, form.applicant_id)
    customer = session.get(Customer, form.customer_id)
    steps = session.scalars(select(OaApprovalStep).where(OaApprovalStep.form_id == form.id).order_by(OaApprovalStep.step_no)).all()
    comments = session.scalars(select(OaComment).where(OaComment.form_id == form.id).order_by(OaComment.created_at, OaComment.id)).all()
    attachments = session.scalars(select(OaAttachment).where(OaAttachment.form_id == form.id).order_by(OaAttachment.created_at, OaAttachment.id)).all()
    activity = session.scalars(select(OaActivity).where(OaActivity.form_id == form.id).order_by(OaActivity.created_at, OaActivity.id)).all()
    users = {u.id: u for u in session.scalars(select(AppUser).where(AppUser.id.in_({s.user_id for s in steps} | {c.author_id for c in comments} | {a.uploaded_by for a in attachments} | {x.actor_id for x in activity} | {applicant.id}))).all()}

    def person(user_id: str) -> AppUser:
        return users[user_id]

    return {
        "id": form.id,
        "form_no": form.form_no,
        "kind": KIND_LABEL,
        "flow_name": FLOW_NAME,
        "status": form.status,
        "visit_id": form.visit_id,
        "applicant_name": applicant.name,
        "applicant_title": "業務",
        "applicant_id": applicant.id,
        "unit_name": form.unit_name,
        "trip_date": form.trip_date.isoformat(),
        "customer_name": customer.name,
        "purpose": form.purpose,
        "submitted_at": form.submitted_at or form.created_at,
        "steps": [
            {
                "step_no": s.step_no,
                "role_label": s.role_label,
                "title": s.title,
                "name": person(s.user_id).name,
                "status": s.status,
                "acted_at": s.acted_at,
            }
            for s in steps
        ],
        "comments": [
            {"id": c.id, "author_name": person(c.author_id).name, "body": c.body, "created_at": c.created_at}
            for c in comments
        ],
        "attachments": [
            {"id": a.id, "filename": a.filename, "uploaded_by": person(a.uploaded_by).name, "created_at": a.created_at}
            for a in attachments
        ],
        "activity": [
            {
                "id": x.id,
                "action": x.action,
                "detail": x.detail,
                "actor_name": person(x.actor_id).name,
                "actor_unit": person(x.actor_id).region,
                "created_at": x.created_at,
            }
            for x in activity
        ],
        "can_decide": bool(user and any(s.user_id == user.id and s.status == "pending" for s in steps)),
    }


def decide(session: Session, form: OaExpenseForm, user: AppUser, action: Literal["approve", "reject", "return"], comment: str | None) -> OaExpenseForm:
    step = session.scalar(
        select(OaApprovalStep).where(
            OaApprovalStep.form_id == form.id, OaApprovalStep.user_id == user.id, OaApprovalStep.status == "pending"
        )
    )
    if step is None:
        raise HTTPException(403, "這張單現在不是等你簽核")
    now = dt.datetime.now(dt.UTC)
    step.status = "done"
    step.acted_at = now
    if comment:
        session.add(OaComment(form_id=form.id, author_id=user.id, body=comment))
    if action == "approve":
        form.status = "approved"
        session.add(OaActivity(form_id=form.id, action="approved", actor_id=user.id, detail="簽核者"))
    elif action == "reject":
        form.status = "rejected"
        session.add(OaActivity(form_id=form.id, action="rejected", actor_id=user.id, detail="已駁回"))
    else:
        form.status = "returned"
        session.add(OaActivity(form_id=form.id, action="returned", actor_id=user.id, detail="已退回"))
    return form
