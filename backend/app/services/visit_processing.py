"""背景工作（由 RQ worker 執行）：錄音 → 逐字稿 → 五個欄位。

任何一步失敗，都停在業務可以手動接手的狀態，不會卡在「處理中」。
"""

import logging

from sqlalchemy.orm import Session

from app.db import session_factory
from app.models import Customer, Visit, VisitAudio
from app.services import last_order, repeat_order
from app.services.extraction import (
    drop_unknown_packs, drop_unknown_products, empty_fields, get_extractor, product_hints, validate_fields, validate_repeat,
)
from app.services.promo_packs import current_packs
from app.services.scope import Scope
from app.services.speech_names import customer_candidates
from app.services.transcription import INLINE_AUDIO_LIMIT, gemini_audio_mime, get_auto_transcriber, get_taiwanese_transcriber, get_transcriber, visit_hotwords
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
            hotwords = visit_hotwords(session, visit.customer_id)
            if audio.language == "auto":
                transcriber = get_auto_transcriber()
            elif audio.language == "nan-TW":
                transcriber = get_taiwanese_transcriber()
            elif audio.language == "zh-TW":
                transcriber = get_transcriber()
            else:
                transcriber = get_transcriber(audio.language)
            transcript = transcriber.transcribe(audio.content, audio.mime_type, hotwords)
        except Exception as exc:
            log.warning("轉文字失敗 visit=%s：%s", visit_id, exc)
            visit.status = "failed"
            visit.error_message = f"轉文字失敗：{exc}"
            session.commit()
            set_progress(visit_id, "failed")
            return
        visit.transcript = transcript.text
        session.commit()
        _extract(session, visit, transcript.review_note)


def extract_transcript(visit_id: str) -> None:
    """業務手動輸入逐字稿之後，重新整理欄位。"""
    with session_factory()() as session:
        visit = session.get(Visit, visit_id)
        if visit is not None:
            _extract(session, visit)


def _extract(session: Session, visit: Visit, transcription_note: str | None = None) -> None:
    set_progress(visit.id, "extracting")
    note = None
    snapshot = None
    audio = session.get(VisitAudio, visit.id)
    try:
        packs = current_packs(session)
        hints = product_hints(session, visit.transcript, visit.customer_id)
        context = {}
        if audio is not None and audio.language in ("auto", "nan-TW"):
            if len(audio.content) <= INLINE_AUDIO_LIMIT:
                # 台語沒有供應商熱詞參數：在既有抽欄位呼叫附原音核對名稱，不套華語諧音改原文。
                candidates = customer_candidates(session, visit.transcript, Scope.everything())
                terms = [term for p in hints for term in (p.name, *p.aliases)]
                terms += [c["name"] for c in candidates] + visit_hotwords(session, visit.customer_id)
                context = {"name_audio": (audio.content, gemini_audio_mime(audio.mime_type)), "name_terms": terms}
            else:
                note = "錄音檔較大，這次未用原音核對名稱；請核對品名與客戶。"
        extraction = get_extractor().extract(visit.transcript, local_date(visit.visited_at), hints, packs, **context)
        errors = validate_fields(extraction.fields)
        if errors:
            raise ValueError("；".join(errors))
        if repeat_errors := validate_repeat(extraction.repeat_last):
            raise ValueError("；".join(repeat_errors))
        # AI 抽出的口對不上這一期，就清掉讓業務在確認頁選
        fields = {**extraction.fields, "intent": drop_unknown_packs(drop_unknown_products(extraction.fields["intent"], hints), packs)}
        sources = {key: quote for key, quote in extraction.sources.items() if quote and fields.get(key) is not None}
        # 講了跟上次一樣或跟上次比的加減：照上次訂的展開下單意向，快照留給確認頁
        if repeat := repeat_order.normalize(extraction.repeat_last):
            said = extraction.sources.get("repeat_last")
            last = last_order.build(session, session.get(Customer, visit.customer_id))
            expanded = repeat_order.expand(last, repeat, fields["intent"], said, packs, {h.sku: h for h in hints})
            fields["intent"], snapshot = expanded.intent, expanded.snapshot
            if expanded.note:
                note = f"{note}；{expanded.note}" if note else expanded.note
            if fields["intent"] is None:
                sources.pop("intent", None)
            elif not sources.get("intent") and said:
                sources["intent"] = said
    except Exception as exc:
        log.warning("整理欄位失敗 visit=%s：%s", visit.id, exc)
        fields, sources, snapshot = empty_fields(), {}, None
        note = f"欄位沒有自動整理出來，請手動填寫（{exc}）"
    if audio is not None and audio.language == "auto":
        review_note = "華語／台語已自動辨識；請對照原文，核對品名、數量、單位與日期後再送出。"
        note = f"{note}；{review_note}" if note else review_note
    elif audio is not None and audio.language == "nan-TW":
        review_note = "台語辨識可能聽錯品名、數量、單位或日期；請逐欄核對並修正後再送出。"
        note = f"{note}；{review_note}" if note else review_note
    elif audio is not None and audio.language != "zh-TW":
        review_note = "請對照原語言逐字稿，核對中文紀錄的品名、數量、單位與日期後再送出。"
        note = f"{note}；{review_note}" if note else review_note
    if transcription_note:
        note = f"{note}；{transcription_note}" if note else transcription_note
    visit.fields_raw = fields
    visit.fields_final = fields
    visit.field_sources = sources
    visit.repeat_last = snapshot
    visit.error_message = note
    visit.status = "draft"
    session.commit()
    set_progress(visit.id, "done")
