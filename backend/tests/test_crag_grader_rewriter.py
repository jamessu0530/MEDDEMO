"""Grader／rewriter 單元測試（結構化輸出以 JsonLLM 假 LLM 替身注入，禁止 monkey patch）。

照搬 CARE `tests/unit/services/rag/test_retrieval_grader.py`、
`tests/unit/services/rag/test_query_rewriter.py`。CARE 的例句是醫療情境
（高血壓、PGAD、頭暈…），這裡換成 MEDDEMO 的業務情境（近效期、退貨、
折扣審核、帳齡）；驗的行為不變。

刪掉／修改的測試與原因：
- `test_gemini_grader_maps_ambiguous`：跟任務說明列出的必要測試
  `test_grader_returns_one_of_three_grades_with_low_thinking` 判的都是
  ambiguous，重複，不搬。
- `test_gemini_grader_returns_enum_and_truncates_docs`：截斷字數與
  effort="low" 已被上面那個必要測試涵蓋；DI 原本用建構子的 `invoke_grade`
  參數，MEDDEMO 的 `LLMRetrievalGrader` 已改用 `llm.ajson`（沒有這個注入
  點）。查詢文字有沒有進 prompt 的斷言保留，改寫成
  `test_grader_prompt_includes_the_query`。
- `test_rewriter_returns_all_three_queries`、
  `test_rewriter_falls_back_to_original_when_empty`、
  `test_rewriter_prompt_includes_question_and_snippets`：保留，改用
  MEDDEMO 業務例句。
- `test_zh_terms_drop_ascii_acronyms`、
  `test_zh_terms_normalize_separators_and_cap_at_three`、
  `test_en_terms_keep_multiword_terms`：保留（純函式，跟業務情境無關），
  改用 MEDDEMO 業務例句。
"""

from __future__ import annotations

import pytest

from app.services.crag.documents import Document
from app.services.crag.grader import Grade, LLMRetrievalGrader, parse_grade
from app.services.crag.rewriter import (
    LLMQueryRewriter,
    RewrittenQuery,
    normalize_en_terms,
    normalize_zh_terms,
)


class JsonLLM:
    def __init__(self, reply):
        self.reply, self.calls = reply, []

    async def ajson(self, *, system, prompt, schema, effort="medium"):
        self.calls.append({"system": system, "prompt": prompt, "schema": schema, "effort": effort})
        return self.reply


# --- 任務說明列出的必要測試（逐字照抄） ---


async def test_grader_returns_one_of_three_grades_with_low_thinking():
    llm = JsonLLM({"grade": "ambiguous"})
    grade = await LLMRetrievalGrader(llm).grade("問題", [Document("甲" * 500)])
    assert grade is Grade.AMBIGUOUS
    assert llm.calls[0]["effort"] == "low"
    assert "甲" * 400 in llm.calls[0]["prompt"] and "甲" * 401 not in llm.calls[0]["prompt"]


async def test_unknown_grade_is_an_error():
    with pytest.raises(ValueError):
        await LLMRetrievalGrader(JsonLLM({"grade": "maybe"})).grade("問題", [])


async def test_rewrite_falls_back_to_the_question_and_cleans_terms():
    llm = JsonLLM({"kb_query": "", "zh_terms": "近效期、退貨, SAP 期限 多餘", "en_terms": "near expiry,returns"})
    rewritten = await LLMQueryRewriter(llm).rewrite("效期快到的貨可以退嗎", [])
    assert rewritten.kb_query == "效期快到的貨可以退嗎"
    assert rewritten.zh_terms == "近效期 退貨 期限"
    assert rewritten.en_terms == "near expiry returns"


# --- 照搬 CARE 專屬測試，例句改成 MEDDEMO 業務情境 ---


def test_parse_grade_accepts_canonical_values():
    assert parse_grade("correct") is Grade.CORRECT
    assert parse_grade("AMBIGUOUS") is Grade.AMBIGUOUS
    assert parse_grade("incorrect") is Grade.INCORRECT


def test_parse_grade_rejects_unknown():
    with pytest.raises(ValueError):
        parse_grade("maybe")


async def test_grader_prompt_includes_the_query():
    """CARE `test_gemini_grader_returns_enum_and_truncates_docs` 剩下的斷言：
    查詢文字必須進 prompt（截斷與 effort 已由必要測試涵蓋）。"""
    llm = JsonLLM({"grade": "correct"})
    await LLMRetrievalGrader(llm).grade("近效期商品可以退貨嗎", [Document("退貨規定")])
    assert "近效期商品可以退貨嗎" in llm.calls[0]["prompt"]


@pytest.mark.asyncio
async def test_rewriter_returns_all_three_queries():
    llm = JsonLLM(
        {
            "kb_query": "  近效期商品的退貨規定是什麼？  ",
            "zh_terms": "近效期 退貨",
            "en_terms": "near expiry return",
        }
    )
    out = await LLMQueryRewriter(llm).rewrite("快過期的東西可以退嗎", [Document("部分相關")])
    assert out == RewrittenQuery(
        kb_query="近效期商品的退貨規定是什麼？",
        zh_terms="近效期 退貨",
        en_terms="near expiry return",
    )
    assert len(llm.calls) == 1


@pytest.mark.asyncio
async def test_rewriter_falls_back_to_original_when_all_fields_empty():
    llm = JsonLLM({"kb_query": "   ", "zh_terms": "", "en_terms": ""})
    out = await LLMQueryRewriter(llm).rewrite("原始問題", [])
    assert out == RewrittenQuery(kb_query="原始問題")


@pytest.mark.asyncio
async def test_rewriter_prompt_includes_question_and_snippets():
    llm = JsonLLM({"kb_query": "q", "zh_terms": "", "en_terms": ""})
    await LLMQueryRewriter(llm).rewrite(
        "客戶問效期快到的貨能不能退",
        [Document("近效期商品的退貨規定")],
    )
    prompt = llm.calls[0]["prompt"]
    assert "客戶問效期快到的貨能不能退" in prompt
    assert "近效期商品的退貨規定" in prompt


# --- MEDDEMO 加的 medical、internal 欄位（James 2026-09-15 決定：用藥題、公司內部題不上網） ---


@pytest.mark.asyncio
async def test_rewriter_passes_through_the_medical_flag():
    llm = JsonLLM({"kb_query": "魚油 副作用", "zh_terms": "魚油 副作用", "en_terms": "fish oil side effects", "medical": True})
    out = await LLMQueryRewriter(llm).rewrite("魚油吃太多會有什麼副作用？", [])
    assert out.medical is True
    assert "medical" in llm.calls[0]["schema"]["required"]


@pytest.mark.asyncio
@pytest.mark.parametrize("value", [False, "true", None])
async def test_rewriter_treats_anything_but_boolean_true_as_not_medical(value):
    llm = JsonLLM({"kb_query": "q", "zh_terms": "", "en_terms": "", "medical": value})
    assert (await LLMQueryRewriter(llm).rewrite("折扣上限是多少？", [])).medical is False


@pytest.mark.asyncio
async def test_rewriter_passes_through_the_internal_flag():
    llm = JsonLLM({"kb_query": "年終獎金 計算", "zh_terms": "年終獎金", "en_terms": "year-end bonus", "medical": False, "internal": True})
    out = await LLMQueryRewriter(llm).rewrite("今年的年終獎金怎麼算？", [])
    assert (out.internal, out.medical) == (True, False)
    assert "internal" in llm.calls[0]["schema"]["required"]


@pytest.mark.asyncio
@pytest.mark.parametrize("value", [False, "true", None])
async def test_rewriter_treats_anything_but_boolean_true_as_not_internal(value):
    llm = JsonLLM({"kb_query": "q", "zh_terms": "", "en_terms": "", "medical": False, "internal": value})
    assert (await LLMQueryRewriter(llm).rewrite("今年的年終獎金怎麼算？", [])).internal is False


def test_zh_terms_drop_ascii_acronyms():
    """縮寫留給英文那一路：中文關鍵字裡的純英數字詞會被拿掉（理由見 rewriter.normalize_zh_terms）。"""
    assert normalize_zh_terms("退貨規定 SAP") == "退貨規定"


def test_zh_terms_normalize_separators_and_cap_at_three():
    assert normalize_zh_terms("近效期,折扣審核、帳齡，退貨") == "近效期 折扣審核 帳齡"


def test_en_terms_normalize_separators():
    assert normalize_en_terms("near expiry,return policy, discount") == "near expiry return policy discount"
