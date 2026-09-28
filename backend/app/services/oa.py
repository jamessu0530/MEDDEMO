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
from app.services.scope import SHARING_LEVEL, Scope
from app.timeutil import local_date

KIND_LABEL = "出差單"
FLOW_NAME = "出差單_簽核流程"
# 第二關「經辦人的主管」。業務換主管時，還沒簽的這一關跟著改指派（services/org_admin.py）
MANAGER_STEP_LABEL = "經辦人的主管"
# 進得了簽核匣的角色（跟 api/auth.py 的 MANAGER_SIDE_ROLES 一致；這裡不能反過來引用 api 層）
INBOX_ROLES = ("manager", "it")


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
    # 簽核的是申請人的直屬主管，不是「該區工號最小的主管」：一區可以有好幾位主管，各帶各的人
    manager = session.get(AppUser, applicant.manager_id) if applicant.manager_id else None
    if manager is None:
        raise RuntimeError(f"{applicant.name} 沒有直屬主管，出差單送不出去")
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
            form_id=form.id, step_no=2, role_label=MANAGER_STEP_LABEL, user_id=manager.id,
            title="區處主管", status="pending",
        )
    )
    session.add(OaActivity(form_id=form.id, action="submitted", actor_id=applicant.id, detail="經辦人送出"))
    return form


def form_id_for_visit(session: Session, visit_id: str) -> int | None:
    return session.scalar(select(OaExpenseForm.id).where(OaExpenseForm.visit_id == visit_id))


def _visible(session: Session, user: AppUser, form: OaExpenseForm) -> bool:
    """申請人在我的範圍內：業務是自己（自建帳號是代理的那位），主管是自己底下的人，IT 是全公司。"""
    applicant = session.get(AppUser, form.applicant_id)
    return Scope.for_user(user).can_see(SHARING_LEVEL["oa_form"], applicant.org_path)


def _step_to_decide(session: Session, form: OaExpenseForm, user: AppUser) -> OaApprovalStep | None:
    """這張單現在等這個人簽的那一關：指派給他、還沒簽的。IT 可以代簽任何一關還沒簽的。"""
    stmt = select(OaApprovalStep).where(OaApprovalStep.form_id == form.id, OaApprovalStep.status == "pending")
    if user.role != "it":
        stmt = stmt.where(OaApprovalStep.user_id == user.id)
    return session.scalar(stmt.order_by(OaApprovalStep.step_no))


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
    owner = Scope.for_user(user).acting_user_id
    if owner is None:
        return {"items": [], "counts": {s: 0 for s in OA_FORM_STATUSES}}
    where = [OaExpenseForm.applicant_id == owner]
    counts = _counts(session, *where)
    if status:
        where.append(OaExpenseForm.status == status)
    forms = session.scalars(select(OaExpenseForm).where(*where).order_by(OaExpenseForm.created_at.desc(), OaExpenseForm.id.desc()).limit(50)).all()
    return {"items": [_item(session, form) for form in forms], "counts": counts}


def list_inbox(session: Session, user: AppUser) -> dict[str, Any]:
    if user.role not in INBOX_ROLES:
        raise HTTPException(403, "只有主管可以看簽核匣")
    # 主管看指派給自己的；IT 看全公司還沒簽的
    pending_ids = select(OaApprovalStep.form_id).where(OaApprovalStep.status == "pending")
    if user.role != "it":
        pending_ids = pending_ids.where(OaApprovalStep.user_id == user.id)
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
        "can_decide": bool(user and _step_to_decide(session, form, user)),
    }


def decide(session: Session, form: OaExpenseForm, user: AppUser, action: Literal["approve", "reject", "return"], comment: str | None) -> OaExpenseForm:
    step = _step_to_decide(session, form, user)
    if step is None:
        raise HTTPException(403, "這張單現在不是等你簽核")
    # IT 代簽時，這一關記實際簽的人，流程圖上才不會顯示成原本指派的主管簽的
    step.user_id = user.id
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
