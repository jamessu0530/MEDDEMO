"""提問的背景工作（由 RQ worker 執行）：數字題走反覆查詢，知識題走 CRAG。

每一步都即時寫進 query_trace，畫面輪詢時就看得到它查到第幾輪、查了什麼。
"""

import datetime as dt
import logging

from sqlalchemy import text

from app.db import session_factory
from app.embeddings import optional_embedder
from app.llm import get_llm
from app.models import AskRecord, QueryTrace
from app.services.data_agent import answer_data
from app.services.knowledge import answer_knowledge

log = logging.getLogger(__name__)


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
            if record.kind == "data":
                today = session.scalar(text("SELECT app_today()"))
                result = answer_data(session.get_bind(), llm, record.question, today, on_step)
                record.status, record.answer, record.evidence = result.status, result.answer, result.evidence
            else:
                embedder = optional_embedder()
                result = answer_knowledge(session, llm, record.question, on_step, embedder.embed_query if embedder else None)
                record.status, record.answer = result.status, result.answer
                record.evidence = {"route": result.route, "sources": result.sources}
                record.error_message = result.error_message
        except Exception as exc:
            log.warning("提問處理失敗 ask=%s：%s", ask_id, exc)
            session.rollback()
            record.status = "failed"
            record.error_message = f"處理失敗：{exc}"
        record.finished_at = dt.datetime.now(dt.UTC)
        session.commit()
