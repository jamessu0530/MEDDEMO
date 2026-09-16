"""問答 API：數字查詢（FR-7）與知識查詢（FR-8）共用同一套提問、進度與查詢軌跡。"""

import json
import logging
import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.db import get_session
from app.models import AppUser, AskRecord, Customer, Escalation, QueryTrace
from app.services.scope import Scope
from app.tasks import visit_queue

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/asks", tags=["asks"])
SessionDep = Annotated[Session, Depends(get_session)]


class AskInput(BaseModel):
    kind: Literal["data", "knowledge"]
    # 業務口語提問不會超過 500 字；再長多半是誤貼了一大段文字
    question: str = Field(min_length=1, max_length=500)


class TraceItem(BaseModel):
    round: int
    step: str
    sql: str | None
    search_query: str | None
    row_count: int | None
    decision: str


class CustomerRef(BaseModel):
    id: str
    name: str


class AskDetail(BaseModel):
    id: str
    kind: str
    question: str
    status: str
    answer: str | None
    evidence: dict[str, Any] | None
    error_message: str | None
    trace: list[TraceItem]
    escalation_id: int | None
    # 答案或查詢結果裡提到、而且是提問者自己看得到的客戶。畫面上「排入今天的路線」用
    customers: list[CustomerRef] = Field(default_factory=list)


# 答案裡最多抓幾家：原型的例子是「衰退集中 3 家連鎖」；一次排超過一天的量（5 家）也跑不完
MAX_MENTIONED_CUSTOMERS = 5


def _short_names(name: str) -> list[str]:
    """業務口語與模型的答案常把「康泰連鎖藥局 · 忠孝店」寫成「康泰忠孝店」，兩種都要認得。"""
    store, _, area = name.partition(" · ")
    brand = store.replace("連鎖藥局", "").replace("健康藥局", "").replace("藥局", "").replace("藥妝", "")
    return [name, f"{store}{area}", f"{brand}{area}"] if area else [name]


def mentioned_customers(session: Session, record: AskRecord, user: AppUser) -> list[CustomerRef]:
    """數字查詢的答案提到哪幾家客戶。只在提問者看得到的客戶裡找，照答案裡出現的順序。"""
    if record.kind != "data" or not record.answer:
        return []
    text = record.answer + json.dumps((record.evidence or {}).get("rows") or [], ensure_ascii=False)
    candidates = session.execute(
        select(Customer.id, Customer.name).where(Scope.for_user(user).customer_filter())
    ).all()
    found: list[tuple[int, CustomerRef]] = []
    for customer_id, name in candidates:
        positions = [text.find(alias) for alias in _short_names(name) + [customer_id]]
        positions = [pos for pos in positions if pos >= 0]
        if positions:
            found.append((min(positions), CustomerRef(id=customer_id, name=name)))
    return [ref for _, ref in sorted(found, key=lambda item: item[0])][:MAX_MENTIONED_CUSTOMERS]


def _detail(session: Session, record: AskRecord, user: AppUser) -> AskDetail:
    trace = session.scalars(select(QueryTrace).where(QueryTrace.ask_id == record.id).order_by(QueryTrace.id))
    escalation = session.scalar(select(Escalation.id).where(Escalation.ask_id == record.id))
    return AskDetail(
        id=record.id,
        kind=record.kind,
        question=record.question,
        status=record.status,
        answer=record.answer,
        evidence=record.evidence,
        error_message=record.error_message,
        trace=[
            TraceItem(round=t.round, step=t.step, sql=t.sql, search_query=t.search_query, row_count=t.row_count, decision=t.decision)
            for t in trace
        ],
        escalation_id=escalation,
        customers=mentioned_customers(session, record, user),
    )


def _load(session: Session, ask_id: str, user: AppUser) -> AskRecord:
    record = session.get(AskRecord, ask_id)
    # 別人的提問一律當作不存在，不透露這個編號有人用過
    if record is None or record.user_id != user.id:
        raise HTTPException(404, "找不到這個提問")
    return record


@router.post("", status_code=202, response_model=AskDetail)
def create_ask(session: SessionDep, body: AskInput, user: CurrentUser):
    """提問。查詢要跑好幾輪、呼叫好幾次模型，所以放到背景做，畫面輪詢 GET 看進度（NFR-5）。"""
    record = AskRecord(
        id=uuid.uuid4().hex, user_id=user.id, kind=body.kind, question=body.question.strip(), status="queued"
    )
    session.add(record)
    session.commit()
    try:
        visit_queue().enqueue("app.services.asks.run_ask", record.id)
    except Exception as exc:
        log.exception("排入背景工作失敗 ask=%s", record.id)
        record.status = "failed"
        record.error_message = f"背景處理服務暫時連不上，請稍後重試（{exc}）"
        session.commit()
    return _detail(session, record, user)


@router.get("/{ask_id}", response_model=AskDetail)
def get_ask(session: SessionDep, ask_id: str, user: CurrentUser):
    return _detail(session, _load(session, ask_id, user), user)


@router.post("/{ask_id}/escalate", response_model=AskDetail)
def escalate(session: SessionDep, ask_id: str, user: CurrentUser):
    """查不到依據時，把問題轉給主管回答（FR-8.4）。重複按只會有一筆。"""
    record = _load(session, ask_id, user)
    if record.status not in ("no_evidence", "not_converged"):
        raise HTTPException(409, "只有查不到答案的提問可以轉給主管")
    if (record.evidence or {}).get("reason") == "medical":
        # James 2026-09-15：用藥題請業務詢問醫師或藥師，不轉主管（畫面也不給按鈕）
        raise HTTPException(409, "用藥、劑量、療效這類醫療問題請詢問醫師或藥師，不轉給主管")
    if session.scalar(select(Escalation.id).where(Escalation.ask_id == record.id)) is None:
        session.add(Escalation(ask_id=record.id, question=record.question))
        session.commit()
    return _detail(session, record, user)
