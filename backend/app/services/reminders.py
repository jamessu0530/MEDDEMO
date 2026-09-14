import datetime as dt

from sqlalchemy.orm import Session

from app.models import FollowUpReminder, Visit


def create_reminder(session: Session, visit: Visit) -> FollowUpReminder | None:
    """FR-6.4：有追蹤日就用追蹤日，只有承諾期限就用承諾期限；兩者都沒有就不建。"""
    fields = visit.fields_final
    commitment = fields.get("commitment") or {}
    due = fields.get("follow_up_date") or commitment.get("due")
    if not due:
        return None
    reminder = FollowUpReminder(
        visit_id=visit.id,
        customer_id=visit.customer_id,
        user_id=visit.user_id,
        due_date=dt.date.fromisoformat(due),
        note=commitment.get("text") or "再訪追蹤",
    )
    session.add(reminder)
    return reminder
