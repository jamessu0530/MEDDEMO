"""頻道的搜尋頁：用文字找照片與檔案、以圖找圖（docs/superpowers/specs/2026-10-01-attachments-design.md「搜尋頁」）。

只搜附件，不搜文字訊息；附件的關鍵字包含所屬訊息的文字，所以打「忠孝店補貨」，那則訊息附的照片也找得到。
搜得到的範圍跟看板一樣：自己看得到的頻道，加上全公司往上傳的。搜尋用的照片走一樣的檢查，但不存。
"""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from app.api.attachments import AttachmentItem, attachment_item
from app.api.auth import CurrentUser
from app.db import get_session
from app.embeddings import optional_embedder
from app.services import attachments, channels, memory_search

router = APIRouter(tags=["channels"])
SessionDep = Annotated[Session, Depends(get_session)]
QUERY_LIMIT = 200


class SearchHit(BaseModel):
    attachment: AttachmentItem
    message_id: int
    channel_id: int
    channel_name: str
    author_name: str | None
    created_at: dt.datetime
    caption: str | None
    # 看得到原頻道的，點了跳回原訊息；靠往上傳才搜得到的，只開大圖，下面寫往上傳的寫法
    reachable: bool
    shared_text: str | None


@router.post("/api/channels/search", response_model=list[SearchHit])
async def search(request: Request, session: SessionDep, user: CurrentUser):
    """multipart：q（文字）、image（一張照片）、channel_id（只搜這個頻道），都可以省略，但 q 與 image 至少一個。"""
    form = await request.form(max_files=2, max_fields=5)
    text = form.get("q")
    text = text.strip()[:QUERY_LIMIT] if isinstance(text, str) else ""
    uploads = [item for item in form.getlist("image") if isinstance(item, UploadFile)]
    if len(uploads) > 1:
        raise HTTPException(422, "一次只能用一張照片找")
    raw = await uploads[0].read(attachments.MAX_FILE_BYTES + 1) if uploads else None
    channel_value = form.get("channel_id")
    # 讀完表單之後的事（整理照片、算向量、查資料庫）都是同步的，丟到執行緒裡跑，不卡住其他請求
    return await run_in_threadpool(search_sync, session, user, text, raw, uploads[0].filename if uploads else None, channel_value)


def search_sync(session: Session, user, text: str, raw: bytes | None, filename: str | None, channel_value) -> list[SearchHit]:
    if not text and raw is None:
        raise HTTPException(422, "打字或附一張照片來找")
    media = []
    if raw is not None:
        try:
            prepared = attachments.prepare(raw, filename)
        except attachments.Rejected as exc:
            raise HTTPException(exc.status, str(exc)) from None
        if prepared.kind != "image":
            raise HTTPException(415, "以圖找圖只能用照片")
        media = [(prepared.content, prepared.mime_type)]
    channel_id = None
    if isinstance(channel_value, str) and channel_value.strip():
        try:
            channel_id = channels.get_channel(session, user, int(channel_value)).id
        except (ValueError, channels.NotFound):
            raise HTTPException(404, "找不到這個頻道") from None
    embedder = optional_embedder()
    vector = None
    if embedder is not None:
        try:
            vector = embedder.embed_query(text, media)
        except Exception:
            vector = None  # 算不出向量就只走關鍵字，跟知識檢索一樣
    if vector is None and not text:
        raise HTTPException(503, "以圖找圖暫時不能用，請改打字找")
    scope = memory_search.scope_for(session, user)
    hits = memory_search.search_attachments(session, scope, text=text, vector=vector, channel_id=channel_id)
    return [
        SearchHit(
            attachment=attachment_item(hit.attachment, user), message_id=hit.message_id, channel_id=hit.channel_id,
            channel_name=hit.channel_name, author_name=hit.author_name, created_at=hit.created_at,
            caption=hit.attachment.caption, reachable=hit.reachable, shared_text=hit.shared_text,
        )
        for hit in hits
    ]
