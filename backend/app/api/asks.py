"""問答 API：數字查詢（FR-7）與知識查詢（FR-8）共用同一套提問、進度與查詢軌跡。"""

import logging
import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import AskRecord, Escalation, QueryTrace
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


def _detail(session: Session, record: AskRecord) -> AskDetail:
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
    )


def _load(session: Session, ask_id: str) -> AskRecord:
    record = session.get(AskRecord, ask_id)
    if record is None:
        raise HTTPException(404, "找不到這個提問")
    return record


@router.post("", status_code=202, response_model=AskDetail)
def create_ask(session: SessionDep, body: AskInput):
    """提問。查詢要跑好幾輪、呼叫好幾次模型，所以放到背景做，畫面輪詢 GET 看進度（NFR-5）。"""
    record = AskRecord(id=uuid.uuid4().hex, kind=body.kind, question=body.question.strip(), status="queued")
    session.add(record)
    session.commit()
    try:
        visit_queue().enqueue("app.services.asks.run_ask", record.id)
    except Exception as exc:
        log.exception("排入背景工作失敗 ask=%s", record.id)
        record.status = "failed"
        record.error_message = f"背景處理服務暫時連不上，請稍後重試（{exc}）"
        session.commit()
    return _detail(session, record)


@router.get("/{ask_id}", response_model=AskDetail)
def get_ask(session: SessionDep, ask_id: str):
    return _detail(session, _load(session, ask_id))


@router.post("/{ask_id}/escalate", response_model=AskDetail)
def escalate(session: SessionDep, ask_id: str):
    """查不到依據時，把問題轉給主管回答（FR-8.4）。重複按只會有一筆。"""
    record = _load(session, ask_id)
    if record.status not in ("no_evidence", "not_converged"):
        raise HTTPException(409, "只有查不到答案的提問可以轉給主管")
    if session.scalar(select(Escalation.id).where(Escalation.ask_id == record.id)) is None:
        session.add(Escalation(ask_id=record.id, question=record.question))
        session.commit()
    return _detail(session, record)
