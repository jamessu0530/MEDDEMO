"""報價成交（docs/superpowers/specs/2026-10-07-repeat-last-order-design.md）：客戶下單了，把報價寫成今天的進貨。

交易紀錄與應收帳款都寫，報價改成已成交（ordered）。不能復原：之後的進貨間隔、帳齡、問答的數字都跟著變。
"""

import datetime as dt
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import Customer, Product, Receivable, SalesTransaction, SapQuotationDraft
from app.services import approvals
from app.services.customer_profile import app_today

# 《付款條件與帳齡管理》：連鎖 60 天，獨立藥局與診所 30 天。跟假資料（data/seed/generate.py 的 PAYMENT_TERMS）同一組數字
PAYMENT_DAYS = {"chain": 60, "independent": 30, "clinic": 30}


@dataclass
class Placed:
    order_no: str
    date: dt.date
    amount: float


def _fee(amount: Decimal, rate: float) -> Decimal:
    # 每筆交易的費用到元，跟假資料一樣
    return (amount * Decimal(str(rate))).quantize(Decimal("1"), ROUND_HALF_UP)


def place(session: Session, customer: Customer, quote_no: str) -> Placed | None:
    """把一張 draft 的報價寫成系統日的進貨；不是 draft（已經成交、還在等簽核、被駁回）回 None。

    先把狀態改掉再寫交易：兩個人同時按，後到的那個改不到任何一列，不會寫兩次。
    """
    lines = session.execute(
        update(SapQuotationDraft)
        .where(
            SapQuotationDraft.quote_no == quote_no, SapQuotationDraft.customer_id == customer.id,
            SapQuotationDraft.status == "draft",
        )
        .values(status="ordered")
        .returning(SapQuotationDraft.line_no, SapQuotationDraft.sku, SapQuotationDraft.qty, SapQuotationDraft.free_qty, SapQuotationDraft.amount)
    ).all()
    if not lines:
        return None
    lines.sort(key=lambda line: line.line_no)
    today = app_today(session)
    order_no = f"SO{today:%Y%m%d}-{customer.id}-{quote_no}"
    costs = dict(session.execute(select(Product.sku, Product.unit_cost).where(Product.sku.in_({l.sku for l in lines}))).all())
    # 費率跟合約頁同一個算法：近 90 天交易的加總相除；沒有交易就是 0
    terms = approvals.contract_terms(session, customer, today)
    for line in lines:
        # 到貨的數量：促銷的列是付錢的加送的
        qty = line.qty + line.free_qty
        session.add(SalesTransaction(
            order_no=order_no, customer_id=customer.id, date=today, sku=line.sku, qty=qty, amount=line.amount,
            cost=costs[line.sku] * qty, listing_fee=_fee(line.amount, terms["listing_fee_rate"]),
            channel_reward=_fee(line.amount, terms["channel_reward_rate"]),
        ))
    total = sum((line.amount for line in lines), Decimal(0))
    session.add(Receivable(
        invoice_no=order_no, customer_id=customer.id, invoice_date=today,
        due_date=today + dt.timedelta(days=PAYMENT_DAYS[customer.type]), amount=total, paid_date=None,
    ))
    session.flush()
    return Placed(order_no, today, float(total))
