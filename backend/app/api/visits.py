"""拜訪紀錄 API：口述上傳、欄位確認、回寫三套系統（FR-4〜FR-6）。"""

import datetime as dt
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import WRITEBACK_TARGETS, Customer, FollowUpReminder, Visit, VisitAudio
from app.services import privacy, writeback
from app.services.extraction import empty_fields, missing_sap_details, unsourced_fields, validate_fields
from app.services.reminders import create_reminder
from app.tasks import get_progress, visit_queue

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/visits", tags=["visits"])
SessionDep = Annotated[Session, Depends(get_session)]

# 口述一段通常一分鐘上下，20MB 留了很大的餘裕，只擋掉明顯是錄音沒停的檔案。
# Nginx 預設只收 1MB，frontend/nginx.conf 要設成同一個上限。
MAX_AUDIO_BYTES = 20 * 1024 * 1024


class WritebackItem(BaseModel):
    target: str
    status: str
    error_message: str | None
    attempt: int


class ReminderItem(BaseModel):
    due_date: dt.date
    note: str


class VisitDetail(BaseModel):
    id: str
    customer_id: str
    customer_name: str
    status: str
    stage: str | None
    error_message: str | None
    visited_at: dt.datetime
    transcript: str
    fields: dict[str, Any]
    sources: dict[str, str]
    unsourced: list[str]
    writeback: list[WritebackItem]
    reminder: ReminderItem | None


class TranscriptInput(BaseModel):
    text: str = Field(min_length=1)


class FieldsInput(BaseModel):
    fields: dict[str, Any]


def _load(session: Session, visit_id: str, *, lock: bool = False) -> Visit:
    visit = session.get(Visit, visit_id, with_for_update=lock)
    if visit is None:
        raise HTTPException(404, "找不到這筆拜訪紀錄")
    return visit


def _detail(session: Session, visit: Visit) -> VisitDetail:
    fields = visit.fields_final or empty_fields()
    raw = visit.fields_raw or empty_fields()
    sources = visit.field_sources or {}
    # 只標 AI 整理出來、業務還沒改過的欄位；業務自己改的內容由業務負責
    unsourced = [key for key in unsourced_fields(raw, sources, visit.transcript) if fields.get(key) == raw.get(key)]
    reminder = session.scalar(select(FollowUpReminder).where(FollowUpReminder.visit_id == visit.id))
    return VisitDetail(
        id=visit.id,
        customer_id=visit.customer_id,
        customer_name=session.get(Customer, visit.customer_id).name,
        status=visit.status,
        stage=get_progress(visit.id) if visit.status == "processing" else None,
        error_message=visit.error_message,
        visited_at=visit.visited_at,
        transcript=visit.transcript,
        fields=fields,
        sources=sources,
        unsourced=unsourced,
        writeback=[
            WritebackItem(target=e.target, status=e.status, error_message=e.error_message, attempt=e.attempt)
            for e in writeback.latest_results(session, visit.id)
        ],
        reminder=ReminderItem(due_date=reminder.due_date, note=reminder.note) if reminder else None,
    )


def _enqueue(session: Session, visit: Visit, job: str) -> None:
    try:
        visit_queue().enqueue(f"app.services.visit_processing.{job}", visit.id)
    except Exception as exc:
        # Redis 連不上時不能讓紀錄卡在「處理中」，改成失敗，讓業務稍後重試或手動輸入
        log.exception("排入背景工作失敗 visit=%s", visit.id)
        visit.status = "failed"
        visit.error_message = f"背景處理服務暫時連不上，請稍後重試（{exc}）"
        session.commit()


@router.post("/audio", status_code=202, response_model=VisitDetail)
def upload_audio(
    session: SessionDep,
    response: Response,
    file: Annotated[UploadFile, File()],
    customer_id: Annotated[str, Form()],
    client_ref: Annotated[str | None, Form()] = None,
):
    """上傳口述錄音。轉文字和整理欄位在背景做，畫面輪詢 GET /api/visits/{id} 看進度。"""
    if client_ref and (existing := session.scalar(select(Visit).where(Visit.client_ref == client_ref))):
        response.status_code = 200  # 同一段錄音重送：不重建，也不再轉一次文字
        return _detail(session, existing)
    customer = session.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(404, "找不到這家客戶")
    content = file.file.read(MAX_AUDIO_BYTES + 1)
    if len(content) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "錄音檔太大，請縮短後重錄")
    if not content:
        raise HTTPException(422, "錄音檔是空的，請重錄")

    visit = Visit(
        customer_id=customer.id,
        user_id=customer.owner_user_id,
        visited_at=dt.datetime.now(dt.UTC),
        status="processing",
        client_ref=client_ref,
    )
    session.add(visit)
    try:
        session.flush()
    except IntegrityError:
        # 兩個重送請求同時到：另一個已經建好了，回傳那一筆
        session.rollback()
        response.status_code = 200
        return _detail(session, session.scalar(select(Visit).where(Visit.client_ref == client_ref)))
    session.add(VisitAudio(visit_id=visit.id, content=content, mime_type=file.content_type or "application/octet-stream"))
    session.commit()
    _enqueue(session, visit, "process_audio")
    return _detail(session, visit)


@router.get("/{visit_id}", response_model=VisitDetail)
def get_visit(session: SessionDep, visit_id: str):
    return _detail(session, _load(session, visit_id))


@router.post("/{visit_id}/transcript", status_code=202, response_model=VisitDetail)
def submit_transcript(session: SessionDep, visit_id: str, body: TranscriptInput):
    """轉文字失敗時手動輸入逐字稿，或修改逐字稿後重新整理欄位（會覆蓋目前的欄位）。"""
    visit = _load(session, visit_id, lock=True)
    if visit.status not in ("failed", "draft"):
        raise HTTPException(409, "這筆紀錄目前不能修改逐字稿")
    visit.transcript = body.text.strip()
    visit.status = "processing"
    visit.error_message = None
    session.commit()
    _enqueue(session, visit, "extract_transcript")
    return _detail(session, visit)


@router.post("/{visit_id}/reprocess", status_code=202, response_model=VisitDetail)
def reprocess(session: SessionDep, visit_id: str):
    """用同一段錄音重新處理：轉文字失敗之後，或背景工作中斷（例如 Redis 重啟、排隊的工作不見）
    而一直停在處理中時。重複排入也無妨，兩次處理寫進去的結果相同。"""
    visit = _load(session, visit_id, lock=True)
    if visit.status not in ("failed", "processing") or session.get(VisitAudio, visit.id) is None:
        raise HTTPException(409, "只有轉文字失敗或處理中斷、而且有錄音的紀錄可以重試")
    visit.status = "processing"
    visit.error_message = None
    session.commit()
    _enqueue(session, visit, "process_audio")
    return _detail(session, visit)


@router.put("/{visit_id}/fields", response_model=VisitDetail)
def update_fields(session: SessionDep, visit_id: str, body: FieldsInput):
    """逐格修改（FR-5.3）。原始抽取結果保留在 fields_raw，不會被覆蓋。"""
    visit = _load(session, visit_id, lock=True)
    if visit.status != "draft":
        raise HTTPException(409, "只有待確認的紀錄可以修改欄位")
    if errors := validate_fields(body.fields):
        raise HTTPException(422, errors)
    visit.fields_final = body.fields
    session.commit()
    return _detail(session, visit)


@router.post("/{visit_id}/confirm", response_model=VisitDetail)
def confirm(session: SessionDep, visit_id: str):
    """確認後寫回三套系統（FR-6），並依追蹤日或承諾期限建立提醒。"""
    visit = _load(session, visit_id, lock=True)
    if visit.status != "draft":
        raise HTTPException(409, "這筆紀錄不是待確認狀態")
    fields = visit.fields_final or empty_fields()
    if problems := validate_fields(fields) + missing_sap_details(fields):
        raise HTTPException(422, problems)
    visit.fields_final = fields
    visit.status = "confirmed"
    visit.confirmed_at = dt.datetime.now(dt.UTC)
    # NFR-8：送出之後的用途（AI 查詢、客戶檔案）都算後續利用，逐字稿先去識別；送出前業務要對著原文核對
    privacy.deidentify_visit(session, visit)
    create_reminder(session, visit)
    session.commit()

    results = writeback.dispatch(visit.id)
    if all(r.status in ("success", "skipped") for r in results):
        visit.status = "synced"
        session.commit()
    return _detail(session, visit)


@router.post("/{visit_id}/writeback/{target}/retry", response_model=VisitDetail)
def retry_writeback(session: SessionDep, visit_id: str, target: str):
    """只重送失敗的那一套（FR-6.3），寫成功的不會被重寫。"""
    if target not in WRITEBACK_TARGETS:
        raise HTTPException(404, "沒有這個目標系統")
    visit = _load(session, visit_id)
    latest = {e.target: e.status for e in writeback.latest_results(session, visit.id)}
    if visit.status != "confirmed" or latest.get(target) != "failed":
        raise HTTPException(409, "只能重送寫入失敗的項目")
    writeback.write_target(visit.id, target)
    session.expire_all()
    if all(e.status in ("success", "skipped") for e in writeback.latest_results(session, visit.id)):
        visit.status = "synced"
        session.commit()
    return _detail(session, visit)


@router.delete("/{visit_id}", status_code=204)
def discard(session: SessionDep, visit_id: str):
    """放棄這次的口述（FR-5.5 整段重錄），錄音一併刪除。已確認的紀錄不能刪。"""
    visit = _load(session, visit_id, lock=True)
    if visit.status not in ("processing", "failed", "draft"):
        raise HTTPException(409, "已確認的紀錄不能刪除")
    session.delete(visit)
    session.commit()
