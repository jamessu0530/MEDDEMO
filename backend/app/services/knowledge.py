"""知識查詢（CRAG，FR-8）。

混合檢索 → 評估段落夠不夠回答 → 夠了才生成答案並附出處；不夠就改寫問法重查，最多兩次；
還是不夠就回覆查無依據，不讓模型自己編答案（FR-8.3、NFR-1）。
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.llm import LLM
from app.services.retrieval import Hit, hybrid_search

MAX_REWRITES = 2  # SDD 流程設計：改寫次數 < 2
# 每次交給評估的段落數：一條規定一段，一個問題通常只對到一兩段；5 段留了餘裕，又不會塞進太多無關內容
TOP_K = 5
NO_EVIDENCE = "內部文件裡找不到可以回答這個問題的依據。"
# 評估相關性與改寫問法接近分類工作，用 low 縮短等待；生成答案要照段落寫對數字，用 medium。之後依評測再調
GRADE_EFFORT = "low"
ANSWER_EFFORT = "medium"

GRADE_SYSTEM = """你負責判斷檢索到的公司內部文件段落，能不能回答業務的問題。只看段落內容，不要用常識補。
relevant_chunk_ids 列出真的跟問題有關的段落編號；sufficient 表示這些段落已經足以完整回答問題；reason 用一句話說明。"""

GRADE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["sufficient", "relevant_chunk_ids", "reason"],
    "properties": {
        "sufficient": {"type": "boolean"},
        "relevant_chunk_ids": {"type": "array", "items": {"type": "integer"}},
        "reason": {"type": "string"},
    },
}

REWRITE_SYSTEM = """業務用口語提問，檢索沒有找到足夠的公司內部文件。請把問題改寫成比較可能出現在公司規定文件裡的講法，
例如用「近效期」「退貨」「折扣審核」「帳齡」這類正式名詞。query 只放改寫後的檢索字句，reason 說明怎麼改的。"""

REWRITE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["query", "reason"],
    "properties": {"query": {"type": "string"}, "reason": {"type": "string"}},
}

ANSWER_SYSTEM = """你是業務助理，只能根據提供的公司內部文件段落回答，不能加上段落以外的內容或常識。
用繁體中文簡短直接地回答，寫出關鍵的數字或條件。cited_chunk_ids 列出你用到的段落編號。
如果這些段落其實回答不了這個問題，answerable 填 false。"""

ANSWER_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["answerable", "answer", "cited_chunk_ids"],
    "properties": {
        "answerable": {"type": "boolean"},
        "answer": {"type": "string"},
        "cited_chunk_ids": {"type": "array", "items": {"type": "integer"}},
    },
}


@dataclass
class KnowledgeAnswer:
    status: str  # answered / no_evidence
    answer: str
    sources: list[dict[str, Any]]


OnStep = Callable[..., None]


def _render(hits: list[Hit]) -> str:
    return "\n\n".join(f"[段落 {h.chunk_id}]\n{h.content}" for h in hits)


def _source(hit: Hit) -> dict[str, Any]:
    return {"chunk_id": hit.chunk_id, "source_name": hit.source_name, "doc_title": hit.doc_title, "section": hit.section, "content": hit.content}


def answer_knowledge(
    session: Session,
    llm: LLM,
    question: str,
    on_step: OnStep,
    embed_query: Callable[[str], list[float]] | None = None,
) -> KnowledgeAnswer:
    query = question
    for attempt in range(MAX_REWRITES + 1):
        round_number = attempt + 1
        hits = hybrid_search(session, query, TOP_K, embed_query(query) if embed_query else None)
        relevant: list[Hit] = []
        sufficient = False
        reason = "沒有檢索到任何段落"
        if hits:
            # 相關性一律對照原本的問題判斷，改寫只是為了換個方式去找
            grade = llm.json(
                system=GRADE_SYSTEM, prompt=f"問題：{question}\n\n{_render(hits)}", schema=GRADE_SCHEMA, effort=GRADE_EFFORT
            )
            wanted = set(grade["relevant_chunk_ids"])
            relevant = [h for h in hits if h.chunk_id in wanted]
            sufficient = bool(grade["sufficient"] and relevant)
            reason = grade["reason"]
        on_step(round_number, "search", search_query=query, row_count=len(hits), decision=f"{'足夠' if sufficient else '不足'}：{reason}")

        if sufficient:
            reply = llm.json(
                system=ANSWER_SYSTEM, prompt=f"問題：{question}\n\n{_render(relevant)}", schema=ANSWER_SCHEMA, effort=ANSWER_EFFORT
            )
            # 只承認真的交給模型的段落；引用不存在的段落等於沒有依據
            cited = [h for h in relevant if h.chunk_id in set(reply["cited_chunk_ids"])]
            if reply["answerable"] and cited:
                on_step(round_number, "answer", decision=f"根據 {len(cited)} 段文件回答")
                return KnowledgeAnswer("answered", reply["answer"], [_source(h) for h in cited])
            on_step(round_number, "answer", decision="段落看似相關，但回答不了這個問題")

        if attempt < MAX_REWRITES:
            rewrite = llm.json(
                system=REWRITE_SYSTEM,
                prompt=f"原本的問題：{question}\n上一次的檢索字句：{query}",
                schema=REWRITE_SCHEMA,
                effort=GRADE_EFFORT,
            )
            query = rewrite["query"]
            on_step(round_number, "rewrite", search_query=query, decision=rewrite["reason"])

    return KnowledgeAnswer("no_evidence", NO_EVIDENCE, [])
