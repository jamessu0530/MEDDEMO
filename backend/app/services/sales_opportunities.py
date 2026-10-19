"""月底補單名單：只看目前負責的客戶，以已入帳交易比較本月累計與上月整月。"""

import datetime as dt
from calendar import monthrange
from decimal import Decimal

from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session

from app.models import AppUser, Customer, SalesTransaction
from app.services.customer_profile import app_today


def month_periods(today: dt.date) -> tuple[dt.date, dt.date, dt.date, dt.date]:
    current_start = today.replace(day=1)
    previous_end = current_start - dt.timedelta(days=1)
    return (
        previous_end.replace(day=1), previous_end, current_start,
        today.replace(day=monthrange(today.year, today.month)[1]),
    )


def build(session: Session, rep: AppUser) -> dict:
    today = app_today(session)
    previous_start, previous_end, current_start, month_end = month_periods(today)
    previous = and_(SalesTransaction.date >= previous_start, SalesTransaction.date <= previous_end)
    current = and_(SalesTransaction.date >= current_start, SalesTransaction.date <= today)

    def total(column, period):
        return func.coalesce(func.sum(case((period, column), else_=0)), 0)

    rows = session.execute(
        select(
            Customer.id, Customer.name, Customer.type, Customer.grade, Customer.city, Customer.area,
            total(SalesTransaction.amount, previous).label("previous_amount"),
            total(SalesTransaction.amount, current).label("current_amount"),
            total(SalesTransaction.qty, previous).label("previous_qty"),
            total(SalesTransaction.qty, current).label("current_qty"),
            func.count(func.distinct(case((previous, SalesTransaction.order_no)))).label("previous_orders"),
            func.count(func.distinct(case((current, SalesTransaction.order_no)))).label("current_orders"),
            func.max(SalesTransaction.date).label("last_order_date"),
        )
        .outerjoin(SalesTransaction, and_(
            SalesTransaction.customer_id == Customer.id, SalesTransaction.date <= today,
        ))
        # 客戶資料雖已全公司共用，這份行動名單仍只看登入業務目前負責的客戶。
        .where(Customer.owner_user_id == rep.id)
        .group_by(Customer.id)
    ).all()

    items = []
    for row in rows:
        amount_declined = row.current_amount < row.previous_amount
        quantity_declined = row.current_qty < row.previous_qty
        declining = amount_declined or quantity_declined
        key_account = row.grade == "A"
        if not declining and not key_account:
            continue
        gap = max(Decimal(0), row.previous_amount - row.current_amount)
        average = row.previous_amount / row.previous_orders if row.previous_orders else None
        items.append({
            "customer_id": row.id, "name": row.name, "type": row.type, "grade": row.grade,
            "city": row.city, "area": row.area,
            "previous_amount": float(row.previous_amount), "current_amount": float(row.current_amount),
            "previous_qty": row.previous_qty, "current_qty": row.current_qty,
            "previous_orders": row.previous_orders, "current_orders": row.current_orders,
            "gap_amount": float(gap),
            "decline_percent": float(gap / row.previous_amount * 100) if row.previous_amount > 0 else None,
            "previous_average_order": float(average) if average is not None else None,
            "last_order_date": row.last_order_date,
            "amount_declined": amount_declined, "quantity_declined": quantity_declined,
            "is_declining": declining, "is_key_account": key_account,
            "priority": "high" if declining and key_account else "normal",
        })
    # 同時命中兩個訊號最先；其餘以補單差額或上月平均一單的金額排序。只是跟進依據，不是成交預測。
    items.sort(key=lambda item: (
        item["priority"] != "high",
        -max(item["gap_amount"], item["previous_average_order"] or 0),
        -item["previous_amount"], item["customer_id"],
    ))
    return {
        "as_of": today, "month_start": current_start, "month_end": month_end,
        "previous_start": previous_start, "previous_end": previous_end,
        "days_remaining": (month_end - today).days, "owner_name": rep.name,
        "summary": {
            "owned_customers": len(rows), "opportunity_customers": len(items),
            "declining_customers": sum(item["is_declining"] for item in items),
            "key_accounts": sum(item["is_key_account"] for item in items),
            "high_priority": sum(item["priority"] == "high" for item in items),
            "gap_amount": sum(item["gap_amount"] for item in items),
        },
        "items": items,
    }
