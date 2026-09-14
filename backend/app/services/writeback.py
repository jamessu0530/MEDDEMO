"""一次寫回三套系統（FR-6）。

三個目標各用自己的交易平行寫入，任一個失敗不影響其他兩個；每一次嘗試都在 writeback_log 留一列。
"""

import datetime as dt
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.db import session_factory
from app.models import (
    WRITEBACK_TARGETS,
    CrmVisitRecord,
    Customer,
    OaExpenseForm,
    Product,
    SapQuotationDraft,
    Visit,
    WritebackLog,
)
from app.pricing import supply_price
from app.tasks import redis
from app.timeutil import local_date

TARGET_LABEL = {"crm": "CRM", "sap": "SAP", "oa": "OA"}


class NothingToWrite(Exception):
    """這個目標這次不需要寫，例如沒有購買意向就不必開報價草稿。"""


class TargetDown(RuntimeError):
    """模擬系統被設成停機。"""


@dataclass
class WritebackResult:
    target: str
    status: str
    error_message: str | None
    attempt: int


# 三套系統在展示版本裡是模擬的；SDD 5.3 要用它們驗證部分失敗，所以要能把其中一套設成停機。
# 開關放 Redis，API 和背景工作看到的是同一份狀態。
def _down_key(target: str) -> str:
    return f"mock:{target}:down"


def is_mock_down(target: str) -> bool:
    return bool(redis().exists(_down_key(target)))


def set_mock_down(target: str, down: bool) -> None:
    if down:
        redis().set(_down_key(target), "1")
    else:
        redis().delete(_down_key(target))


def intent_summary(fields: dict[str, Any]) -> str | None:
    items = fields.get("intent") or []
    return "、".join(f"{i['product_text']} × {i['qty']}{i['unit'] or ''}" for i in items) or None


def _write_crm(session: Session, visit: Visit) -> None:
    fields = visit.fields_final
    commitment = fields["commitment"]
    follow_up = fields["follow_up_date"]
    session.execute(
        insert(CrmVisitRecord).values(
            visit_id=visit.id,
            customer_id=visit.customer_id,
            rep_id=visit.user_id,
            visit_date=local_date(visit.visited_at),
            competitor="、".join(c["name"] for c in fields["competitor"] or []) or None,
            complaint=fields["complaint"],
            intent_summary=intent_summary(fields),
            commitment=f"{commitment['text']}（{commitment['due'] or '未定'} 前）" if commitment else None,
            follow_up_date=dt.date.fromisoformat(follow_up) if follow_up else None,
        ).on_conflict_do_nothing(index_elements=["visit_id"])
    )


def _write_sap(session: Session, visit: Visit) -> None:
    items = visit.fields_final["intent"] or []
    if not items:
        raise NothingToWrite("這次沒有購買意向，不需要報價草稿")
    prices = dict(session.execute(select(Product.sku, Product.unit_price).where(Product.sku.in_([i["sku"] for i in items]))).all())
    customer_type = session.get(Customer, visit.customer_id).type
    for line_no, item in enumerate(items, start=1):
        if not item.get("qty") or item.get("sku") not in prices:
            raise ValueError(f"意向第 {line_no} 項缺少品項或數量")
        session.execute(
            insert(SapQuotationDraft).values(
                visit_id=visit.id, line_no=line_no, customer_id=visit.customer_id, sku=item["sku"], qty=item["qty"],
                # 報價以標準供貨價為基準（連鎖 9 折、獨立藥局 95 折、診所原價），與歷史報價一致
                unit_price=supply_price(prices[item["sku"]], customer_type),
            ).on_conflict_do_nothing(index_elements=["visit_id", "line_no"])
        )


def _write_oa(session: Session, visit: Visit) -> None:
    session.execute(
        insert(OaExpenseForm).values(
            visit_id=visit.id, applicant_id=visit.user_id, trip_date=local_date(visit.visited_at),
            customer_id=visit.customer_id, purpose="客戶拜訪",
        ).on_conflict_do_nothing(index_elements=["visit_id"])
    )


WRITERS = {"crm": _write_crm, "sap": _write_sap, "oa": _write_oa}


def write_target(visit_id: str, target: str) -> WritebackResult:
    """寫一個目標系統。先記一筆 pending，寫入與結果在同一個交易裡提交；失敗就只記下原因。"""
    with session_factory()() as session:
        last_attempt = session.scalar(
            select(func.max(WritebackLog.attempt)).where(WritebackLog.visit_id == visit_id, WritebackLog.target == target)
        )
        entry = WritebackLog(visit_id=visit_id, target=target, attempt=(last_attempt or 0) + 1, status="pending")
        session.add(entry)
        session.commit()
        try:
            if is_mock_down(target):
                raise TargetDown(f"{TARGET_LABEL[target]} 回應逾時（模擬系統停機中）")
            WRITERS[target](session, session.get(Visit, visit_id))
            status, message = "success", None
        except NothingToWrite as exc:
            session.rollback()
            status, message = "skipped", str(exc)
        except Exception as exc:
            session.rollback()
            status, message = "failed", str(exc)
        entry.status = status
        entry.error_message = message
        entry.finished_at = dt.datetime.now(dt.UTC)
        session.commit()
        return WritebackResult(target, status, message, entry.attempt)


def dispatch(visit_id: str) -> list[WritebackResult]:
    with ThreadPoolExecutor(max_workers=len(WRITEBACK_TARGETS)) as pool:
        return list(pool.map(lambda target: write_target(visit_id, target), WRITEBACK_TARGETS))


def latest_results(session: Session, visit_id: str) -> list[WritebackLog]:
    """每個目標最近一次的嘗試。"""
    entries = session.scalars(
        select(WritebackLog).where(WritebackLog.visit_id == visit_id).order_by(WritebackLog.attempt.desc())
    )
    latest: dict[str, WritebackLog] = {}
    for entry in entries:
        latest.setdefault(entry.target, entry)
    return [latest[target] for target in WRITEBACK_TARGETS if target in latest]
