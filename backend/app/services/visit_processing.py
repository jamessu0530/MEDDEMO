"""背景工作（由 RQ worker 執行）：錄音 → 逐字稿 → 五個欄位。

任何一步失敗，都停在業務可以手動接手的狀態，不會卡在「處理中」。
"""

import logging

from sqlalchemy.orm import Session

from app.db import session_factory
from app.models import Visit, VisitAudio
from app.services.extraction import empty_fields, get_extractor, product_hints, validate_fields
from app.services.transcription import get_transcriber, load_hotwords
from app.tasks import set_progress
from app.timeutil import local_date

log = logging.getLogger(__name__)


def process_audio(visit_id: str) -> None:
    with session_factory()() as session:
        visit = session.get(Visit, visit_id)
        audio = session.get(VisitAudio, visit_id)
        if visit is None or audio is None:
            return  # 業務已經放棄這份草稿
        set_progress(visit_id, "transcribing")
        try:
            transcript = get_transcriber().transcribe(audio.content, audio.mime_type, load_hotwords(session))
        except Exception as exc:
            log.warning("轉文字失敗 visit=%s：%s", visit_id, exc)
            visit.status = "failed"
            visit.error_message = f"轉文字失敗：{exc}"
            session.commit()
            set_progress(visit_id, "failed")
            return
        visit.transcript = transcript.text
        session.commit()
        _extract(session, visit)


def extract_transcript(visit_id: str) -> None:
    """業務手動輸入逐字稿之後，重新整理欄位。"""
    with session_factory()() as session:
        visit = session.get(Visit, visit_id)
        if visit is not None:
            _extract(session, visit)


def _extract(session: Session, visit: Visit) -> None:
    set_progress(visit.id, "extracting")
    note = None
    try:
        extraction = get_extractor().extract(visit.transcript, local_date(visit.visited_at), product_hints(session))
        errors = validate_fields(extraction.fields)
        if errors:
            raise ValueError("；".join(errors))
        fields = extraction.fields
        sources = {key: quote for key, quote in extraction.sources.items() if quote and fields.get(key) is not None}
    except Exception as exc:
        log.warning("整理欄位失敗 visit=%s：%s", visit.id, exc)
        fields, sources = empty_fields(), {}
        note = f"欄位沒有自動整理出來，請手動填寫（{exc}）"
    visit.fields_raw = fields
    visit.fields_final = fields
    visit.field_sources = sources
    visit.error_message = note
    visit.status = "draft"
    session.commit()
    set_progress(visit.id, "done")
