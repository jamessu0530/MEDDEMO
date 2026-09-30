"""模擬 OA 申請單：開單、申請匣、逐關簽核。

三種申請單共用這一套：出差單（拜訪確認後自動開）、優惠與合約申請單（services/approvals.py 開）。
這裡只管申請單本身；誰要簽、模型怎麼估、核准之後的效果都在 approvals.py。
"""

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

KIND_LABELS = {"trip": "出差單", "discount": "優惠申請單", "contract": "合約申請單"}
# 單號開頭，後面是年月加五碼流水號，三種各自編號
FORM_NO_PREFIX = {"trip": "OA", "discount": "DC", "contract": "CT"}
# 沒有簽核人的關卡與活動日誌（系統核准）在畫面上顯示的名字
SYSTEM_NAME = "系統（模型）"
# 第二關「經辦人的主管」。業務換主管時，還沒簽的這一關跟著改指派（services/org_admin.py）
MANAGER_STEP_LABEL = "經辦人的主管"
# 進得了簽核匣的角色（跟 api/auth.py 的 MANAGER_SIDE_ROLES 一致；這裡不能反過來引用 api 層）
INBOX_ROLES = ("manager", "it")


def next_form_no(session: Session, prefix: str, day: dt.date) -> str:
    """prefix 是 FORM_NO_PREFIX 裡的開頭。流水號接在同一種、同一個月最後一張後面。"""
    prefix = f"{prefix}{day:%Y%m}"
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
        form_no=next_form_no(session, FORM_NO_PREFIX["trip"], local_date(visit.visited_at)),
        kind="trip",
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


def _percent(value: float) -> str:
    """6.0 → 6%、6.5 → 6.5%。"""
    return f"{value:g}%"


def _rate_change(label: str, rate: dict[str, float]) -> str | None:
    if rate["from"] == rate["to"]:
        return None
    return f"{label} {_percent(rate['from'] * 100)} → {_percent(rate['to'] * 100)}"


def summary(form: OaExpenseForm, customer: Customer) -> str:
    """清單與簽核匣上的一句話：這張單在申請什麼。"""
    payload = form.payload or {}
    if form.kind == "discount":
        return f"折扣 {_percent(payload['discount_pct'])}，報價 NT$ {payload['amount']:,.0f}"
    if form.kind == "contract":
        changes = list(filter(None, [
            _rate_change("上架費率", payload["listing_fee_rate"]),
            _rate_change("通路獎勵", payload["channel_reward_rate"]),
        ]))
        return f"續約 {payload['term_months']} 個月，{'、'.join(changes) or '費率不變'}"
    return f"{customer.name}，{form.trip_date.month}/{form.trip_date.day} 拜訪"


def _model(form: OaExpenseForm) -> dict[str, Any] | None:
    """模型對這張單的估計，簽核頁給主管參考。出差單不經過模型。"""
    if form.kind == "trip":
        return None
    return {"probability": form.model_probability, "auto_approved": form.auto_approved}


def _item(session: Session, form: OaExpenseForm) -> dict[str, Any]:
    applicant = session.get(AppUser, form.applicant_id)
    customer = session.get(Customer, form.customer_id)
    pending = session.scalar(
        select(OaApprovalStep).where(OaApprovalStep.form_id == form.id, OaApprovalStep.status == "pending").order_by(OaApprovalStep.step_no)
    )
    approver = session.get(AppUser, pending.user_id) if pending and pending.user_id else None
    return {
        "id": form.id,
        "form_no": form.form_no,
        "kind": form.kind,
        "kind_label": KIND_LABELS[form.kind],
        "summary": summary(form, customer),
        "status": form.status,
        "applicant_name": applicant.name,
        "customer_name": customer.name,
        # 出差單是拜訪日，另外兩種是送單當下的系統日
        "trip_date": form.trip_date.isoformat() if form.trip_date else None,
        "request_date": form.request_date.isoformat() if form.request_date else None,
        "submitted_at": form.submitted_at or form.created_at,
        "approver_name": approver.name if approver else None,
        "model": _model(form),
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
    ids = {s.user_id for s in steps} | {c.author_id for c in comments} | {a.uploaded_by for a in attachments} | {x.actor_id for x in activity} | {applicant.id}
    users = {u.id: u for u in session.scalars(select(AppUser).where(AppUser.id.in_(ids - {None}))).all()}

    def name(user_id: str | None) -> str:
        # 沒有人的關卡與日誌是系統做的（模型有把握、系統核准）
        return users[user_id].name if user_id else SYSTEM_NAME

    return {
        "id": form.id,
        "form_no": form.form_no,
        "kind": form.kind,
        "kind_label": KIND_LABELS[form.kind],
        "flow_name": f"{KIND_LABELS[form.kind]}_簽核流程",
        "summary": summary(form, customer),
        "status": form.status,
        "visit_id": form.visit_id,
        "applicant_name": applicant.name,
        "applicant_title": "業務",
        "applicant_id": applicant.id,
        "unit_name": form.unit_name,
        "trip_date": form.trip_date.isoformat() if form.trip_date else None,
        "request_date": form.request_date.isoformat() if form.request_date else None,
        "customer_id": customer.id,
        "customer_name": customer.name,
        "purpose": form.purpose,
        "payload": form.payload,
        "model": _model(form),
        "submitted_at": form.submitted_at or form.created_at,
        "steps": [
            {
                "step_no": s.step_no,
                "role_label": s.role_label,
                "title": s.title,
                "name": name(s.user_id),
                "status": s.status,
                "acted_at": s.acted_at,
            }
            for s in steps
        ],
        "comments": [
            {"id": c.id, "author_name": name(c.author_id), "body": c.body, "created_at": c.created_at}
            for c in comments
        ],
        "attachments": [
            {"id": a.id, "filename": a.filename, "uploaded_by": name(a.uploaded_by), "created_at": a.created_at}
            for a in attachments
        ],
        "activity": [
            {
                "id": x.id,
                "action": x.action,
                "detail": x.detail,
                "actor_name": name(x.actor_id),
                "actor_unit": users[x.actor_id].region if x.actor_id else "",
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
        # 出差單只有一關，日誌照舊寫「簽核者」；多關的單寫出是哪一關核准的
        detail = "簽核者" if form.kind == "trip" else f"{step.title}核准"
        session.add(OaActivity(form_id=form.id, action="approved", actor_id=user.id, detail=detail))
        # 逐關推進：還有下一關就換它等簽，整張單還在審核中；沒有下一關了才是已核准
        following = session.scalar(
            select(OaApprovalStep)
            .where(OaApprovalStep.form_id == form.id, OaApprovalStep.status == "waiting")
            .order_by(OaApprovalStep.step_no)
        )
        if following:
            following.status = "pending"
        else:
            form.status = "approved"
    elif action == "reject":
        form.status = "rejected"
        session.add(OaActivity(form_id=form.id, action="rejected", actor_id=user.id, detail="已駁回"))
    else:
        form.status = "returned"
        session.add(OaActivity(form_id=form.id, action="returned", actor_id=user.id, detail="已退回"))
    return form
