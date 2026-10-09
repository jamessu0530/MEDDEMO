"""付款條件（services/payment_terms.py）：到期日、下單時扣的現金折扣，以及假資料怎麼分代碼。"""

import datetime as dt
from collections import Counter
from decimal import Decimal

import generate
import pytest
from sqlalchemy import text

from app.services import payment_terms

AS_OF = dt.date(2026, 10, 28)


@pytest.mark.parametrize(
    ("code", "invoice", "due"),
    [
        # 隔月：下個月月底
        ("RCD1", dt.date(2026, 3, 10), dt.date(2026, 4, 30)),
        ("RCD2", dt.date(2026, 1, 31), dt.date(2026, 2, 28)),
        ("RZ04", dt.date(2026, 12, 5), dt.date(2027, 1, 31)),
        # RM06：發票日加六個月，那個月沒有這一天就取月底
        ("RM06", dt.date(2026, 3, 10), dt.date(2026, 9, 10)),
        ("RM06", dt.date(2026, 8, 31), dt.date(2027, 2, 28)),
    ],
)
def test_the_due_date_follows_the_payment_term(code, invoice, due):
    assert payment_terms.due_date(code, invoice) == due


def test_the_cash_discount_comes_off_the_receivable_when_the_order_is_placed():
    # 文件裡的例子：RCD2 一張 10,000 元的訂單，應收 9,700 元
    assert payment_terms.receivable_amount("RCD2", Decimal(10000)) == Decimal(9700)
    assert payment_terms.receivable_amount("RCD1", Decimal(10000)) == Decimal(9800)
    assert payment_terms.receivable_amount("RM06", Decimal(10000)) == Decimal(10000)
    # 到元，四捨五入
    assert payment_terms.receivable_amount("RZ04", Decimal(1234)) == Decimal(1197)


def test_each_code_reads_as_who_collects_and_the_discount():
    assert payment_terms.describe("RCD2") == "RCD2 隔月匯款，優惠 3%"
    assert payment_terms.describe("RCD1") == "RCD1 隔月業務收款，優惠 2%"
    assert payment_terms.describe("RM06") == "RM06 六個月內收款，沒有優惠"


def rows(db, sql):
    return db.execute(text(sql)).all()


def test_seeded_receivables_follow_each_customers_payment_term(db):
    codes = dict(rows(db, "SELECT id, payment_term FROM customer"))
    # 四種都有；準時付款的連鎖都是 RM06，會拖款的都在隔月的三種
    assert set(Counter(codes.values())) == set(payment_terms.TERMS)
    invoices = rows(db, """
        SELECT r.customer_id, r.invoice_date, r.due_date, r.amount, sum(t.amount)
        FROM receivable r JOIN sales_transaction t ON t.order_no = r.invoice_no
        GROUP BY r.invoice_no
    """)
    for customer_id, invoice_date, due_date, amount, ordered in invoices:
        code = codes[customer_id]
        assert due_date == payment_terms.due_date(code, invoice_date)
        assert amount == payment_terms.receivable_amount(code, Decimal(ordered))


def test_only_the_designed_late_payers_are_overdue_on_demo_day(db):
    # 付款時間照舊（generate.PAY_AFTER_DAYS），準時付款的客戶沒有一家逾期；逾期的都是隔月收款的拖款戶
    overdue = rows(db, """
        SELECT c.id, c.type, c.payment_term, s.ar_overdue_days
        FROM v_customer_summary s JOIN customer c ON c.id = s.customer_id
        WHERE s.ar_overdue_days IS NOT NULL
    """)
    assert 5 <= len(overdue) <= 15
    assert all(code in payment_terms.NEXT_MONTH for _, _, code, _ in overdue)
    late = {cid for cid, _, _, _ in overdue}
    paid_late = {r[0] for r in rows(db, "SELECT DISTINCT customer_id FROM receivable WHERE paid_date > due_date + 15")}
    assert late <= paid_late
    # 有幾家逾期超過 30 天，客戶檔案才看得到「要通報主管」那一句
    assert any(days > payment_terms.ESCALATE_OVERDUE_DAYS for *_, days in overdue)
    assert generate.PAY_AFTER_DAYS == {"chain": 60, "independent": 30, "clinic": 30}


def test_overdue_days_worked_back_from_the_age_match_the_due_dates(db):
    # 簽核單上只存帳齡，逾期天數照付款條件反推；每家客戶都要跟語意層直接用到期日算的一樣
    summary = rows(db, """
        SELECT c.payment_term, s.ar_max_age_days, s.ar_overdue_days
        FROM v_customer_summary s JOIN customer c ON c.id = s.customer_id
    """)
    for code, age, overdue in summary:
        assert payment_terms.overdue_days(code, age or 0, AS_OF) == (overdue or 0)
    assert payment_terms.overdue_days("RCD2", 0, AS_OF) == 0
    # 7/27 開的隔月發票 8/31 到期，到 10/28 逾期 58 天；RM06 的還沒到期
    assert payment_terms.overdue_days("RCD2", 93, AS_OF) == 58
    assert payment_terms.overdue_days("RM06", 93, AS_OF) == 0
