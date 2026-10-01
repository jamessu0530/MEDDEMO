"""提問的背景工作（由 RQ worker 執行）：數字題走反覆查詢，知識題走 CRAG。

每一步都即時寫進 query_trace，畫面輪詢時就看得到它查到第幾輪、查了什麼。
"""

import datetime as dt
import logging

from sqlalchemy import select, text
from sqlalchemy.orm import Session, undefer

from app.db import session_factory
from app.embeddings import Embedder, optional_embedder
from app.llm import LLM, Media, get_llm
from app.models import AppUser, AskRecord, Attachment, QueryTrace
from app.services.attachment_processing import describe_and_embed
from app.services.data_agent import answer_data
from app.services.memory_answer import answer_memory
from app.services.scope import Scope
from app.services.knowledge import answer_knowledge

log = logging.getLogger(__name__)


def look_at_attachment(
    session: Session, ask_id: str, llm: LLM, embedder: Embedder | None, on_step
) -> tuple[list[Media], str | None]:
    """提問附的檔案：先請 AI 寫說明、算向量（頻道的附件在背景工作做，這裡回答馬上要用，當場做）。
    回傳 (要給模型看的原檔, 說明)；看不懂也照常回答，只是少了說明。"""
    attachment = session.scalar(
        select(Attachment).where(Attachment.ask_id == ask_id).options(undefer(Attachment.content))
    )
    if attachment is None:
        return [], None
    try:
        describe_and_embed(session, attachment, llm=llm, embedder=embedder)
        session.commit()
        on_step(1, "attachment", decision=attachment.caption or f"附了「{attachment.filename}」")
    except Exception as exc:
        log.warning("提問的附件處理失敗 ask=%s：%s", ask_id, exc)
        session.rollback()
        on_step(1, "attachment", decision=f"沒能先看懂「{attachment.filename}」，直接連同檔案一起回答")
    return [(attachment.content, attachment.mime_type)], attachment.caption


def run_ask(ask_id: str) -> None:
    with session_factory()() as session:
        record = session.get(AskRecord, ask_id)
        if record is None:
            return
        record.status = "running"
        session.commit()

        def on_step(round_number, step, *, sql=None, search_query=None, row_count=None, decision=""):
            session.add(
                QueryTrace(
                    ask_id=ask_id, round=round_number, step=step, sql=sql,
                    search_query=search_query, row_count=row_count, decision=decision,
                )
            )
            session.commit()

        try:
            llm = get_llm()
            embedder = optional_embedder()
            media, note = look_at_attachment(session, ask_id, llm, embedder, on_step)
            if record.kind == "memory":
                asker = session.get(AppUser, record.user_id)
                result = answer_memory(session, llm, asker, record.question, on_step, embedder, media=media, note=note)
                record.status, record.answer, record.evidence = result.status, result.answer, result.evidence
            elif record.kind == "data":
                today = session.scalar(text("SELECT app_today()"))
                asker = session.get(AppUser, record.user_id)
                result = answer_data(
                    session.get_bind(), llm, record.question, today, on_step, Scope.for_user(asker), media=media, note=note
                )
                record.status, record.answer, record.evidence = result.status, result.answer, result.evidence
            else:
                # 附了檔案：向量檢索用「問題 + 檔案」合成的向量，拿盒子、仿單、海報的照片就找得到相關的規定與話術
                embed_query = (lambda query: embedder.embed_query(query, media)) if embedder else None
                result = answer_knowledge(session, llm, record.question, on_step, embed_query, media=media, note=note)
                record.status, record.answer = result.status, result.answer
                # reason：刻意不上網的原因（medical／internal），畫面與轉主管 API 依此判斷
                record.evidence = {"route": result.route, "sources": result.sources, "reason": result.reason}
                record.error_message = result.error_message
        except Exception as exc:
            log.warning("提問處理失敗 ask=%s：%s", ask_id, exc)
            session.rollback()
            record.status = "failed"
            record.error_message = f"處理失敗：{exc}"
        record.finished_at = dt.datetime.now(dt.UTC)
        session.commit()
