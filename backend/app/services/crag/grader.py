"""CRAG：檢索充足性分級（correct / ambiguous / incorrect）。

照搬 CARE `app/services/rag/retrieval_grader.py`；模型呼叫改成
`app.llm.LLM.ajson`（拿掉 LangChain 與建構子的 `invoke_grade` 注入參數，
MEDDEMO 的假造測試改用 `JsonLLM` 替身直接接 `LLM` 介面）。
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Protocol

from app.llm import LLM
from app.services.crag.documents import Document

# 分級呼叫用的 thinking 等級。理由同 `rewriter.REWRITE_THINKING_LEVEL`：
# gemini-3.8-flash 關不掉 thinking，low 是有文件保證的最低檔。
#
# CARE 2026-09-14 在醫療題上量的（golden set 55 題，每題同一批 docs、兩檔各 3
# 次、交錯執行），MEDDEMO 還沒量：延遲中位數 1.87 → 1.26 秒，p90 都是 3.0 秒；
# low 的尾巴沒有比較好（>5 秒 7/165 次 vs 3/165，最慢 13.4 vs 7.4 秒）。多數決
# 判定 51/55 相同，31 題 kb 題兩檔都 3/3 判 correct。4 題分歧全是
# ambiguous → incorrect，且全是知識庫確定沒有答案的查核負樣本
# （verdict-010/014/015/016）——ambiguous 在那些題只會多跑一輪改寫檢索、
# 最後仍轉網搜，low 等於少繞一圈。
#
# 判 correct 時分級與投機生成並行，使用者等的是 max(分級, 生成)，而生成比
# 分級慢，所以這條路上幾乎省不到；省到的是 ambiguous／incorrect 那條路。
GRADE_THINKING_LEVEL = "low"

GRADE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "grade": {
            "type": "string",
            "enum": ["correct", "ambiguous", "incorrect"],
        }
    },
    "required": ["grade"],
}


class Grade(str, Enum):
    CORRECT = "correct"
    AMBIGUOUS = "ambiguous"
    INCORRECT = "incorrect"


class RetrievalGrader(Protocol):
    async def grade(self, query: str, docs: list[Document]) -> Grade: ...


def parse_grade(value: str) -> Grade:
    normalized = (value or "").strip().lower()
    try:
        return Grade(normalized)
    except ValueError as exc:
        raise ValueError(f"unknown grade: {value!r}") from exc


def _summarize_docs(docs: list[Document], *, max_chars_per_doc: int) -> str:
    parts: list[str] = []
    for idx, doc in enumerate(docs, start=1):
        text = (doc.page_content or "").strip().replace("\n", " ")
        if max_chars_per_doc > 0:
            text = text[:max_chars_per_doc]
        parts.append(f"{idx}. {text}")
    return "\n".join(parts)


class LLMRetrievalGrader:
    """以 Gemini structured output 判斷檢索是否足以回答問題。"""

    def __init__(self, llm: LLM, *, max_chars_per_doc: int = 400) -> None:
        self._llm = llm
        self._max_chars = max_chars_per_doc

    async def grade(self, query: str, docs: list[Document]) -> Grade:
        summary = _summarize_docs(docs, max_chars_per_doc=self._max_chars)
        prompt = (
            "你是公司內部文件的檢索評分器。根據「業務的問題」與「檢索片段」，"
            "判斷這些片段是否足以回答問題。\n"
            "只輸出 grade：\n"
            "- correct：片段直接相關且足以回答重點\n"
            "- ambiguous：有關但資訊不足或含混，值得改寫查詢再試\n"
            "- incorrect：無關或明顯答不了\n\n"
            f"業務的問題：{query}\n\n"
            f"檢索片段：\n{summary or '(無)'}"
        )
        raw = await self._llm.ajson(system="", prompt=prompt, schema=GRADE_SCHEMA, effort=GRADE_THINKING_LEVEL)
        grade_value = raw.get("grade") if isinstance(raw, dict) else raw
        return parse_grade(str(grade_value))
