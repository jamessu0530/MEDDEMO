"""讀一份內部文件：標題加各小節的原文。新人第一週頁的必讀文件點開的就是這裡。

從 document_chunk 讀，不讀磁碟上的檔案：看到的跟問答檢索、引用的是同一份索引。
登入就能讀，不分角色——這些文件本來就是全公司問答查得到的內容。
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.db import get_session
from app.models import DocumentChunk

router = APIRouter(prefix="/api/documents", tags=["documents"])
SessionDep = Annotated[Session, Depends(get_session)]


class Section(BaseModel):
    section: str
    content: str


class Document(BaseModel):
    source_name: str
    title: str
    sections: list[Section]


@router.get("/{source_name}", response_model=Document)
def get_document(session: SessionDep, source_name: str, user: CurrentUser):
    """source_name 是 data/documents/ 的檔名，例如 09-拜訪紀錄.md；小節照文件裡的順序。"""
    # 只取要顯示的欄位：整列撈回來會連向量一起帶
    chunks = session.execute(
        select(DocumentChunk.doc_title, DocumentChunk.section, DocumentChunk.chunk_content)
        .where(DocumentChunk.source_name == source_name)
        .order_by(DocumentChunk.chunk_index)
    ).all()
    if not chunks:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "找不到這份文件")
    return Document(
        source_name=source_name,
        title=chunks[0].doc_title,
        # 切片內容的第一行是「標題｜小節」（services/documents.py 的 chunk_text），畫面上已經另外顯示，這裡只留內文
        sections=[Section(section=c.section, content=c.chunk_content.split("\n", 1)[-1]) for c in chunks],
    )
