"""附件上傳後的處理：請 AI 寫說明（是什麼、圖上看得到的字），算 embedding-2 向量
（docs/superpowers/specs/2026-10-01-attachments-design.md）。

頻道附件排在 channels 佇列背景做（process_attachment）；提問附件在提問的背景工作裡當場做（describe_and_embed），
回答馬上要用。說明與向量都是「做一次、之後一直用」：搜尋、整理記憶、@AI 平常只讀說明，不必每次重看原檔。
"""

from __future__ import annotations

import io
import logging

from pypdf import PdfReader, PdfWriter
from rq import Retry, get_current_job
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session, undefer

from app.config import NotConfigured
from app.db import session_factory
from app.embeddings import Embedder, optional_embedder
from app.llm import LLM, get_llm
from app.models import AskRecord, Attachment, AttachmentVector, ChannelMessage
from app.services.attachments import search_text
from app.services.retrieval import SIMPLE, to_tsvector_input
from app.tasks import channels_queue

log = logging.getLogger(__name__)
# embedding-2 一次最多 6 頁 PDF：長的切段，每段一個向量
PDF_PAGES_PER_VECTOR = 6
# 失敗重試兩次，間隔 30 秒（RQ 的 Retry 要 worker 開 --with-scheduler）
RETRY = Retry(max=2, interval=30)
CAPTION_LIMIT = 200
CAPTION_SYSTEM = f"""你在幫醫藥公司的業務系統整理同事上傳的照片與 PDF，寫一段說明讓之後搜得到、AI 看得懂。
用繁體中文，{CAPTION_LIMIT} 字以內，不要條列、不要開場白：
1. 先說這是什麼：店內陳列、貨架、促銷海報、DM、價目表、報價單、仿單、產品外盒、衛教單張、合約、其他文件。
2. 再寫看得到的字：品牌、品名、規格、價格、活動條件與期間、日期、店名或診所名稱。看不清楚的字不要猜。
3. 照片裡有人的話，不描述長相，也不猜是誰。
4. PDF 只寫標題與前幾頁的重點。"""
CAPTION_SCHEMA = {
    "type": "object",
    "properties": {"caption": {"type": "string", "description": f"{CAPTION_LIMIT} 字以內的說明"}},
    "required": ["caption"],
    "additionalProperties": False,
}


def pdf_segments(content: bytes) -> list[tuple[bytes, int, int]]:
    """把 PDF 切成每份最多 6 頁：(這一份的 PDF, 第幾頁開始, 第幾頁結束)，頁數從 1 起算。6 頁以內就是原檔。"""
    reader = PdfReader(io.BytesIO(content))
    total = len(reader.pages)
    if total <= PDF_PAGES_PER_VECTOR:
        return [(content, 1, total)]
    segments = []
    for start in range(0, total, PDF_PAGES_PER_VECTOR):
        writer = PdfWriter()
        for page in reader.pages[start : start + PDF_PAGES_PER_VECTOR]:
            writer.add_page(page)
        buffer = io.BytesIO()
        writer.write(buffer)
        segments.append((buffer.getvalue(), start + 1, min(start + PDF_PAGES_PER_VECTOR, total)))
    return segments


def context_of(session: Session, attachment: Attachment) -> str:
    """附件所屬的文字：頻道訊息的內容，或提問的問題。寫說明與關鍵字都用得到。"""
    if attachment.message_id is not None:
        return session.scalar(select(ChannelMessage.body).where(ChannelMessage.id == attachment.message_id)) or ""
    return session.scalar(select(AskRecord.question).where(AskRecord.id == attachment.ask_id)) or ""


def describe(llm: LLM, attachment: Attachment, context: str) -> str:
    prompt = f"檔名：{attachment.filename}"
    if context.strip():
        prompt += f"\n同事附上這個檔案時寫的話：「{context.strip()}」"
    result = llm.json(
        system=CAPTION_SYSTEM, prompt=prompt, schema=CAPTION_SCHEMA, effort="low",
        media=[(attachment.content, attachment.mime_type)],
    )
    return result["caption"].strip()[: CAPTION_LIMIT * 2]


def embed(session: Session, embedder: Embedder, attachment: Attachment) -> int:
    """算向量並換掉舊的（重試時不會留下兩份）。回傳寫了幾列。"""
    if attachment.kind == "pdf":
        segments = pdf_segments(attachment.content)
        items = [(data, attachment.mime_type) for data, _, _ in segments]
        pages = [(start, end) for _, start, end in segments]
    else:
        items = [(attachment.content, attachment.mime_type)]
        pages = [(None, None)]
    vectors = embedder.embed_media(items)
    session.execute(delete(AttachmentVector).where(AttachmentVector.attachment_id == attachment.id))
    for (page_from, page_to), vector in zip(pages, vectors, strict=True):
        session.add(AttachmentVector(attachment_id=attachment.id, page_from=page_from, page_to=page_to, embedding=vector))
    return len(vectors)


def optional_llm() -> LLM | None:
    try:
        return get_llm()
    except NotConfigured:
        return None


def describe_and_embed(
    session: Session, attachment: Attachment, *, llm: LLM | None = None, embedder: Embedder | None = None, caption: bool = True
) -> None:
    """寫說明、算向量、重算關鍵字，設成 ready。沒設定 AI 模型就不寫說明，沒設定 embedding 就不算向量。
    caption=False 給灌示範資料用：說明是手寫的，只補向量。出錯直接丟出去，由呼叫端決定重試或記失敗。"""
    context = context_of(session, attachment)
    if caption and llm is not None:
        attachment.caption = describe(llm, attachment, context)
    if embedder is not None:
        embed(session, embedder, attachment)
    attachment.search_tokens = func.to_tsvector(SIMPLE, to_tsvector_input(search_text(attachment, context)))
    attachment.status = "ready"
    session.flush()


def process_attachment(attachment_id: int) -> None:
    """背景工作：頻道附件上傳後排進 channels 佇列。最後一次重試還是失敗就設成 failed：
    圖照樣看得到，只是向量搜不到（關鍵字還搜得到檔名與訊息文字）。"""
    with session_factory()() as session:
        attachment = session.get(Attachment, attachment_id, options=[undefer(Attachment.content)])
        if attachment is None:
            return  # 處理前訊息就被 IT 刪了
        try:
            describe_and_embed(session, attachment, llm=optional_llm(), embedder=optional_embedder())
            session.commit()
        except Exception:
            session.rollback()
            job = get_current_job()
            if job is not None and job.retries_left:
                raise
            log.exception("附件處理失敗 attachment=%s", attachment_id)
            session.execute(update(Attachment).where(Attachment.id == attachment_id).values(status="failed"))
            session.commit()


def enqueue(attachment_ids: list[int]) -> None:
    """排背景工作。Redis 連不上就記 log、留在 pending：訊息已經發出去了，不能因為這個回錯誤。"""
    for attachment_id in attachment_ids:
        try:
            channels_queue().enqueue("app.services.attachment_processing.process_attachment", attachment_id, retry=RETRY)
        except Exception:
            log.exception("排入附件處理失敗 attachment=%s", attachment_id)
