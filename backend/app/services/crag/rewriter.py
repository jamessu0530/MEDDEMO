"""查詢改寫：一次呼叫產出知識庫重查與網搜兩路要用的查詢。

照搬 CARE `app/services/rag/query_rewriter.py`；模型呼叫改成
`app.llm.LLM.ajson`（拿掉 LangChain 與建構子的 `invoke_rewrite` 注入參數，
MEDDEMO 的假造測試改用 `JsonLLM` 替身直接接 `LLM` 介面）。

MEDDEMO 另外加了 `medical`、`internal` 兩個欄位（James 2026-09-15 決定）：同一次呼叫順便判斷
是不是用藥、劑量、療效這類醫療問題，以及是不是只有公司內部才有答案的問題；是的話知識庫答不
出來時不上網（見 `answer_service.RagAnswerService._web_or_no_hits`）。搭在改寫這次呼叫上，不多打一次
模型；要上網時本來就要等改寫結果，推估使用者不會多等（prompt 多兩條規則、輸出多兩個欄位，
對改寫時間的影響還沒量過）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Protocol

from app.llm import LLM
from app.services.crag.documents import Document

# 改寫呼叫用的 thinking 等級。gemini-3.8-flash 關不掉 thinking：官方文件只
# 列 low／medium／high（預設 medium），`thinking_level="minimal"` 會回 400；
# `thinking_budget` 已不在 Gemini 3 的文件裡，實測行為也不一致。low 是有文件
# 保證的最低檔。
#
# CARE 2026-09-12 在醫療題上量的（結構化輸出、同一組 prompt），MEDDEMO 還沒
# 量：預設 2.1-4.6 秒，low 1.2-3.3 秒（共 9 次），6 題的改寫內容兩者幾乎相同。
# 支援 minimal 的 3.6-flash／3.5-flash-lite 更快（0.9-1.7 秒），但中文病名不
# 標準（「持續性性興奮亢進症」「持續性性喚起症候群」），而 gov.tw 搜尋吃的就是
# 標準病名，所以不換模型。
REWRITE_THINKING_LEVEL = "low"

REWRITE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "kb_query": {"type": "string"},
        "zh_terms": {"type": "string"},
        "en_terms": {"type": "string"},
        "medical": {"type": "boolean"},
        "internal": {"type": "boolean"},
    },
    "required": ["kb_query", "zh_terms", "en_terms", "medical", "internal"],
}

_MAX_ZH_TERMS = 3
_TERM_SEPARATORS = re.compile(r"[,，、;；\s]+")
_ASCII_TOKEN = re.compile(r"^[A-Za-z0-9.\-]+$")


@dataclass(frozen=True)
class RewrittenQuery:
    """一次改寫的五種用途。

    - kb_query：CRAG 判 ambiguous 時重查知識庫的問句
    - zh_terms：網搜中文那一路的關鍵字；空字串＝沿用原句
    - en_terms：網搜英文那一路的關鍵字；空字串＝不搜英文
    - medical：是不是用藥、劑量、療效這類醫療問題（MEDDEMO 加的）；是的話不上網
    - internal：是不是只有公司內部才有答案的問題（MEDDEMO 加的）；是的話不上網
    """

    kb_query: str
    zh_terms: str = ""
    en_terms: str = ""
    medical: bool = False
    internal: bool = False


class QueryRewriter(Protocol):
    async def rewrite(self, query: str, docs: list[Document]) -> RewrittenQuery: ...


def normalize_zh_terms(raw: str) -> str:
    """最多三個關鍵字、以空白分隔，並拿掉純英數的字詞。

    拿掉英數字詞不能只靠 prompt 規則：實測「持續性性興奮症候群 PGAD」在
    gov.tw 回 0 筆、拿掉 PGAD 後回 5 筆；縮寫在中文站也容易撞到無關字串
    （「PGAD」命中疾管署 PDF 裡的質體名 pGAD-HAX-1）。縮寫留給英文那一路。
    """
    tokens = [
        token
        for token in _TERM_SEPARATORS.split(raw or "")
        if token and not _ASCII_TOKEN.match(token)
    ]
    return " ".join(tokens[:_MAX_ZH_TERMS])


def normalize_en_terms(raw: str) -> str:
    """把各種分隔符統一成空白。

    不像中文那樣切詞計數：英文醫學名詞常是多字詞（knee osteoarthritis），
    以空白切開再截斷會把一個名詞切成兩半。
    """
    return " ".join(token for token in _TERM_SEPARATORS.split(raw or "") if token)


class LLMQueryRewriter:
    def __init__(self, llm: LLM, *, max_chars_per_doc: int = 200) -> None:
        self._llm = llm
        self._max_chars = max_chars_per_doc

    async def rewrite(self, query: str, docs: list[Document]) -> RewrittenQuery:
        snippets: list[str] = []
        for doc in docs[:3]:
            text = (doc.page_content or "").strip().replace("\n", " ")
            snippets.append(text[: self._max_chars])
        # 規則 1、2 是 CARE 量出來的失誤：沒有規則 1 時「長輩喘、腳腫」被改寫成
        # 「心臟衰竭」（替使用者下診斷），沒有規則 2 時查證型問題的主體
        # （某種偏方）被丟掉、只剩病名。舉例刻意不用評測題裡的題目。CARE 是在
        # 醫療題上量出這兩條規則的必要性，MEDDEMO 還沒量；規則文字已換成業務
        # 情境（不自行推論客戶沒講的事實、保留查證說法的主體），但量測依據仍
        # 是 CARE 的醫療案例。
        # medical 的範圍照語音問答的規則 4（app.services.voice：用藥、劑量、療效這類醫療
        # 問題）；後半句是要避免把業務問題誤判成醫療問題——藥品通路的業務問題幾乎都會提到藥品。
        # internal 的由來：9/15 付費實測 X02「今年的年終獎金怎麼算」上網後引了公務員年終規定，
        # 網路資料代表不了公司；後半句列出公開資訊，是要避免把該上網的題目誤擋掉。
        prompt = (
            "把業務的問題改寫成搜尋用的查詢，不要回答問題。\n"
            "規則：\n"
            "1. 只能使用業務訊息裡出現的品項、客戶、規定或說法；"
            "禁止自行推論或補上業務沒講的事實。\n"
            "2. 業務在查某個說法時，關鍵字必須保留說法的主體。\n"
            "3. 縮寫必須展開成全名（例如 COPD → 慢性阻塞性肺病／"
            "chronic obstructive pulmonary disease）；zh_terms 不可包含英文縮寫。\n"
            "kb_query：一句更具體、利於檢索的繁體中文問句，盡量用公司規定文件裡的"
            "正式名詞（例如「近效期」「退貨」「折扣審核」「帳齡」）。\n"
            "zh_terms：最多三個一般常用的繁體中文關鍵字，以空白分隔。\n"
            "en_terms：對應的英文一般關鍵字，最多三個，以空白分隔。\n"
            "medical：問題在問用藥、劑量、療效、副作用、藥物交互作用或禁忌這類醫療問題時填 true；"
            "問價格、出貨、退貨、公司規定或市場這類業務問題時，即使提到藥品或保健品也填 false。\n"
            "internal：問題問的是只有本公司內部才有答案的事時填 true，例如公司自己的規定與制度、"
            "人事薪資與獎金、報價、價格與調價計畫、客戶或競品跟我們的交易條件；天氣、匯率、新聞、"
            "法規、一般知識這類公開資訊填 false。\n\n"
            f"原始問題：{query}\n\n"
            "知識庫目前檢索到的片段（僅供理解問題，可能不相關）：\n"
            + ("\n".join(snippets) if snippets else "(無)")
        )
        raw = await self._llm.ajson(system="", prompt=prompt, schema=REWRITE_SCHEMA, effort=REWRITE_THINKING_LEVEL)
        if not isinstance(raw, dict):
            raw = {}
        return RewrittenQuery(
            kb_query=str(raw.get("kb_query") or "").strip() or query,
            zh_terms=normalize_zh_terms(str(raw.get("zh_terms") or "")),
            en_terms=normalize_en_terms(str(raw.get("en_terms") or "")),
            # 只認真正的布林 true（字串 "false" 經 bool() 會變成 True）。正式環境的 GeminiLLM 會先照
            # schema 驗證（app.llm），medical／internal 缺欄位或不是布林值時整次改寫失敗、網路路徑退回
            # 原句照常上網；這裡防的是不驗證的 LLM 實作（例如測試替身）。取捨：兩個欄位都必填，格式不對
            # 會連 kb_query／zh_terms／en_terms 一起失去。
            medical=raw.get("medical") is True,
            internal=raw.get("internal") is True,
        )
