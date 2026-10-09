"""付款條件（《付款條件與帳齡管理》）：每家客戶一種代碼，決定應收帳款的到期日與下單時就扣的現金折扣。

SAP 的代碼：RM06 六個月內收完、沒有優惠；RCD1 隔月由業務親自收、優惠 2%；RCD2 隔月客戶匯款、優惠 3%；
RZ04 隔月由貨運公司收、優惠 3%。「隔月」是下個月月底前要收到。
折扣只扣在應收帳款上，進貨金額（交易紀錄）照原價：毛利與業績的數字不跟著付款方式變。
"""

import calendar
import datetime as dt
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from app.models import PAYMENT_TERM_CODES

# 過了到期日還沒收就提醒業務去收；逾期超過這個天數，還要通報主管
ESCALATE_OVERDUE_DAYS = 30


@dataclass(frozen=True)
class PaymentTerm:
    code: str
    # 誰收、什麼時候收，例如「隔月匯款」
    label: str
    discount: Decimal


TERMS = {
    "RM06": PaymentTerm("RM06", "六個月內收款", Decimal("0")),
    "RCD1": PaymentTerm("RCD1", "隔月業務收款", Decimal("0.02")),
    "RCD2": PaymentTerm("RCD2", "隔月匯款", Decimal("0.03")),
    "RZ04": PaymentTerm("RZ04", "隔月貨運收款", Decimal("0.03")),
}
assert tuple(TERMS) == PAYMENT_TERM_CODES

# 收款時間是「隔月」的三種
NEXT_MONTH = ("RCD1", "RCD2", "RZ04")


def due_date(code: str, invoice_date: dt.date) -> dt.date:
    """RM06 是發票日加六個月（那個月沒有這一天就取月底）；隔月的是下個月的月底。"""
    months = 6 if code == "RM06" else 1
    year, month = divmod(invoice_date.month - 1 + months, 12)
    year, month = invoice_date.year + year, month + 1
    last = calendar.monthrange(year, month)[1]
    return dt.date(year, month, min(invoice_date.day, last) if code == "RM06" else last)


def overdue_days(code: str, ar_age_days: float, day: dt.date) -> int:
    """從帳齡反推最久逾期幾天，沒有逾期是 0。最舊一張未收的發票是 day 往前推帳齡那天開的，
    到期日跟著發票日只會往後，所以它最早到期。簽核單上只存帳齡（模型的特徵），申請當天逾期幾天照這個算。"""
    if ar_age_days <= 0:
        return 0
    oldest = day - dt.timedelta(days=round(ar_age_days))
    return max(0, (day - due_date(code, oldest)).days)


def receivable_amount(code: str, amount: Decimal) -> Decimal:
    """下單時就扣現金折扣：應收帳款少收 2% 或 3%，到元。"""
    return (amount * (1 - TERMS[code].discount)).quantize(Decimal("1"), ROUND_HALF_UP)


def describe(code: str) -> str:
    """「RCD2 隔月匯款，優惠 3%」；沒有優惠的寫「沒有優惠」。"""
    term = TERMS[code]
    discount = f"優惠 {(term.discount * 100).normalize()}%" if term.discount else "沒有優惠"
    return f"{code} {term.label}，{discount}"
