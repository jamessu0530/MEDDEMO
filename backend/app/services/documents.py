"""內部文件建索引：讀 data/documents 的 Markdown，一個「## 」小節切成一段，存關鍵字與向量。"""

import re
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import delete, func
from sqlalchemy.orm import Session

from app.models import DocumentChunk
from app.services.retrieval import SIMPLE, to_tsvector_input

# 本機是 repo 的 data/documents；映像檔裡是 /srv/data/documents（backend/Dockerfile 會複製過去）
DOCUMENTS_DIR = Path(__file__).resolve().parents[3] / "data" / "documents"
DOC_TYPE = re.compile(r"文件類型：([^｜\n]+)")


@dataclass
class Section:
    source_name: str
    doc_title: str
    doc_type: str
    section: str
    chunk_index: int
    content: str


def parse_document(path: Path) -> list[Section]:
    text = path.read_text(encoding="utf-8")
    title_match = re.search(r"^# (.+)$", text, re.MULTILINE)
    type_match = DOC_TYPE.search(text)
    title = title_match.group(1).strip() if title_match else path.stem
    doc_type = type_match.group(1).strip() if type_match else "未分類"
    sections = []
    for index, block in enumerate(re.split(r"^## ", text, flags=re.MULTILINE)[1:]):
        heading, _, body = block.partition("\n")
        sections.append(Section(path.name, title, doc_type, heading.strip(), index, body.strip()))
    return sections


def chunk_text(section: Section) -> str:
    """交給檢索與模型的段落內容：前面帶文件標題與小節標題，單獨拿出來也知道在講什麼。"""
    return f"{section.doc_title}｜{section.section}\n{section.content}"


def index_documents(session: Session, embed=None, directory: Path = DOCUMENTS_DIR) -> int:
    """重建全部切片。embed 是「一批文字 → 一批向量」的函式；沒有就只建關鍵字索引。"""
    sections = [s for path in sorted(directory.glob("*.md")) for s in parse_document(path)]
    texts = [chunk_text(s) for s in sections]
    vectors = embed(texts) if (embed and texts) else [None] * len(texts)
    session.execute(delete(DocumentChunk))
    for section, content, vector in zip(sections, texts, vectors):
        session.add(
            DocumentChunk(
                source_name=section.source_name,
                doc_title=section.doc_title,
                doc_type=section.doc_type,
                section=section.section,
                chunk_index=section.chunk_index,
                chunk_content=content,
                search_tokens=func.to_tsvector(SIMPLE, to_tsvector_input(content)),
                embedding=vector,
            )
        )
    session.flush()
    return len(sections)
