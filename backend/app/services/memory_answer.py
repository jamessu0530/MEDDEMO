"""問答頁的「頻道記憶」（docs/superpowers/specs/2026-09-28-channels-design.md「問答頁：頻道記憶」，附件見
2026-10-01-attachments-design.md）。

候選是提問者看得到的重點與附件：自己看得到的頻道裡的，加上全公司往上傳的。有向量就依相似度挑重點 30 條、附件 6 個
（提問附了照片就用照片和問題合成的向量，等於以圖找圖），沒有就取最近的。模型只根據這些回答、每句標出處編號；
附件只給說明，不送原檔。不接轉主管，也不接語音問答。
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.embeddings import Embedder
from app.llm import LLM, Media
from app.models import AppUser
from app.services import memory_search
from app.services.channel_memory import CATEGORY_LABEL
from app.timeutil import TAIPEI

ITEMS = 30
ATTACHMENTS = 6
NO_EVIDENCE = "頻道記憶裡找不到相關的重點。可以到頻道裡問問同事，或 @熊熊滾。"

SYSTEM = """你是醫藥通路業務團隊的 AI 助理「熊熊滾」。根據下面從各個頻道整理出來的重點與附件說明，回答業務的問題。
- 只能根據這些內容回答，不要補沒寫到的事；每一句後面標出處編號，例如 [1]、[2][5]。
- 用繁體中文，口語、簡短，最多 300 字。
- 找不到答得出來的內容，answerable 填 false，answer 用一句話說找不到什麼。"""
SCHEMA = {
    "type": "object",
    "properties": {"answerable": {"type": "boolean"}, "answer": {"type": "string"}},
    "required": ["answerable", "answer"],
    "additionalProperties": False,
}


@dataclass
class MemoryAnswer:
    status: str  # answered / no_evidence
    answer: str
    evidence: dict[str, Any]


def _caption(hit: memory_search.AttachmentHit) -> str:
    """看不到原頻道的附件（靠往上傳才看得到）只給往上傳的寫法：AI 寫說明時參考過原訊息的文字，
    直接給說明可能把原頻道的內容帶出去。搜尋頁也是這樣顯示。"""
    if hit.reachable:
        return hit.attachment.caption or hit.attachment.filename
    return hit.shared_text or hit.attachment.filename


def answer_memory(
    session: Session,
    llm: LLM,
    user: AppUser,
    question: str,
    on_step: Callable[..., None],
    embedder: Embedder | None,
    *,
    media: Sequence[Media] = (),
    note: str | None = None,
) -> MemoryAnswer:
    scope = memory_search.scope_for(session, user)
    vector = embedder.embed_query(question, media) if embedder is not None else None
    items, total = memory_search.search_memory(session, scope, vector, ITEMS)
    files = memory_search.search_attachments(session, scope, text=f"{question} {note or ''}", vector=vector, limit=ATTACHMENTS)
    on_step(
        1, "search", search_query=question, row_count=len(items) + len(files),
        decision=f"從 {total} 條記憶挑出 {len(items)} 條、附件挑出 {len(files)} 個",
    )
    evidence_items = [
        {"index": index, "channel_name": hit.channel_name, "date": hit.item.updated_at.astimezone(TAIPEI).date().isoformat(),
         "category": hit.item.category, "text": hit.text}
        for index, hit in enumerate(items, start=1)
    ]
    evidence_files = [
        {"index": index, "attachment_id": hit.attachment.id, "channel_name": hit.channel_name,
         "date": hit.created_at.astimezone(TAIPEI).date().isoformat(),
         "caption": _caption(hit), "message_id": hit.message_id,
         "channel_id": hit.channel_id if hit.reachable else None}
        for index, hit in enumerate(files, start=len(items) + 1)
    ]
    evidence = {"items": evidence_items, "attachments": evidence_files}
    if not items and not files:
        on_step(1, "stop", decision="沒有看得到的重點或附件")
        return MemoryAnswer("no_evidence", NO_EVIDENCE, evidence)
    lines = [f"[{e['index']}]（{e['channel_name']}，{e['date']}，{CATEGORY_LABEL[e['category']]}）{e['text']}" for e in evidence_items]
    lines += [f"[{e['index']}]（{e['channel_name']}，{e['date']}，附件）{e['caption']}" for e in evidence_files]
    prompt = f"問題：{question}"
    if note:
        prompt += f"\n業務附了一個檔案（放在最前面），內容大致是：{note}"
    prompt += "\n\n重點與附件：\n" + "\n".join(lines)
    result = llm.json(system=SYSTEM, prompt=prompt, schema=SCHEMA, effort="low", media=media)
    answer = result["answer"].strip()
    if not result["answerable"] or not answer:
        on_step(1, "stop", decision="模型判斷這些重點答不出來")
        return MemoryAnswer("no_evidence", answer or NO_EVIDENCE, evidence)
    on_step(1, "answer", decision="根據頻道記憶整理答案")
    return MemoryAnswer("answered", answer, evidence)
