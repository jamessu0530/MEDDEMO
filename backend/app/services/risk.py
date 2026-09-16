"""風險分與主管通報。

風險分不另外發明權重：就是客戶檔案「進門前三分鐘」已經在判斷的五件壞事，符合幾件就幾分（0～5）。
業務在客戶檔案看到的提醒、主管收到的分數，用的是同一套標準。
合約快到期沒算進來：那是行事曆上的事，不是客戶的行為出了問題。

拜訪提到競品或客訴才通報：這兩項是客戶可能被搶走的直接訊號；下單意向、承諾是好消息或例行事項。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppUser, Customer, ManagerNotice, Visit
from app.services import customer_profile

RISK_MAX = 5


def risk_items(profile: customer_profile.Profile) -> list[str]:
    items = []
    if profile.stats.interval_alert:
        items.append("進貨間隔拉長")
    if any(c.overdue and c.by == "us" for c in profile.commitments):
        items.append("答應客戶的事逾期")
    if "competitor" in profile.signals:
        items.append("近 90 天提到競品")
    if profile.complaints:
        items.append("近 90 天有客訴")
    if "ar_overdue" in profile.signals:
        items.append(f"有帳款超過 {customer_profile.AR_WATCH_DAYS} 天沒收")
    return items


def notice_reason(fields: dict) -> str | None:
    parts = []
    if names := [c["name"] for c in fields.get("competitor") or []]:
        parts.append(f"提到競品{'、'.join(names)}")
    if fields.get("complaint"):
        parts.append(f"客訴：{fields['complaint']}")
    return "；".join(parts) or None


def notify_manager(session: Session, visit: Visit) -> ManagerNotice | None:
    """確認送出之後呼叫。這次拜訪沒提到競品或客訴就不通報；同一筆拜訪只通報一次。"""
    reason = notice_reason(visit.fields_final or {})
    if reason is None:
        return None
    existing = session.scalar(select(ManagerNotice).where(ManagerNotice.visit_id == visit.id))
    if existing is not None:
        return existing
    customer = session.get(Customer, visit.customer_id)
    manager = session.scalar(
        select(AppUser).where(AppUser.role == "manager", AppUser.region == customer.region).order_by(AppUser.id)
    )
    if manager is None:
        return None
    items = risk_items(customer_profile.build_profile(session, customer))
    notice = ManagerNotice(
        visit_id=visit.id, customer_id=customer.id, rep_id=visit.user_id, manager_id=manager.id,
        reason=reason, score=len(items), items=items,
    )
    session.add(notice)
    return notice


def first_competitors(session: Session, visit: Visit, fields: dict) -> list[str]:
    """這次提到、而且這家客戶以前確認過的拜訪從沒提過的競品（原型抽欄位畫面的「首次」）。"""
    names = [c["name"] for c in fields.get("competitor") or []]
    if not names:
        return []
    earlier = session.scalars(
        select(Visit.fields_final).where(
            Visit.customer_id == visit.customer_id,
            Visit.status.in_(customer_profile.CONFIRMED),
            # 用編號比先後，不用拜訪時間：假資料的拜訪日期排在決賽日（2026-10-28）之前，
            # 展示時真的錄的拜訪卻是現在的時間，比時間會變成「比所有舊紀錄都早」。
            # 編號由 visit_seq 照建立順序發，固定五位數補零，字串比較就是先後
            Visit.id < visit.id,
        )
    )
    seen = {c["name"] for f in earlier for c in (f or {}).get("competitor") or []}
    return [name for name in names if name not in seen]
