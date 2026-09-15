"""CRAG 主流程：檢索 → 精排 → 評估 → （必要時）改寫重查 → 生成答案，答不出來就轉網搜。

移植自 CARE `app/services/rag/answer_service.py`（2026-09-14）。投機生成、投機改寫、
`_abandon_task`、`asyncio.timeout` 總逾時、改寫預算、評估失敗時的 Cohere 分數降級
過濾、文章去重、`_append_sources` 的引用重新編號全部照搬含註解；只改下列幾處
（James 2026-09-14 確認的設計，見 task-9-brief.md）：

- `answer()` 回傳結構化的 `RagOutcome`（status／route／answer／sources／
  fail_code），不是字串——MEDDEMO 沒有 LINE 卡片，答案與出處要分開存進
  `ask_record`。
- 建構子拿掉 `crag_enabled`、`web_fallback_enabled`：MEDDEMO 的 `grader`／
  `rewriter` 必填，CRAG 永遠開啟；`web_search` 存不存在（`is None`）就是能不能
  上網的唯一依據，**每次要上網才檢查**，不在建構時算成布林值存起來——Task 10
  的測試會在建好之後直接換掉 `self.web_search`。
- 查詢過程改用 MEDDEMO 既有的 `on_step(round_number, step, *, sql=None,
  search_query=None, row_count=None, decision="")` 寫進資料庫
  （`app.services.asks.run_ask` 的 `on_step` closure 會落地成 `QueryTrace`），取代 CARE 的 `stage_timer`／
  `timing` dict；`logger.info` 補記同樣的資訊供之後量測延遲。round_number 追蹤
  用一個跟著呼叫鏈傳下去的 `ctx` dict（`{"round": 1}`），寫法比照 CARE 用
  `timing` dict 撐過 `asyncio.timeout` 取消的模式——`_timed_out` 讀的是同一個
  物件，逾時當下 `_answer` 被取消也讀得到最後寫入的 round number。
- 模型呼叫走 `app.llm.LLM.atext`，不是 LangChain `chat_model.ainvoke`；不會有
  `AIMessage` 或 list-of-parts 回應，CARE 那段 `content_to_text` 攤平邏輯不需要。
- `_build_context` 的標頭改用 `doc_title｜section`（MEDDEMO 沒有 CARE 的
  `original_title` 欄位，沿用 `app.services.documents` 既有的
  `f"{doc_title}｜{section}"` 慣例）。
- 文章去重與 `_append_sources` 判定「同一來源」都沒有 url 可用（MEDDEMO 的
  段落沒有網址），照 CARE `_source_key` 的規則退回 source_name＋doc_title。
- 沒有 `app.core.rag_sources`（CARE 的 request-scoped 來源暫存，供呈現層讀取）：
  `RagOutcome.sources` 直接就是結構化來源清單，呼叫端自己存進 `evidence`。
- `_append_sources` 改回傳 `(body, sources)`；`sources` 是 `kb_source` 清單。
  判死網址的邏輯保留在網路路徑（`WebSearchService` 內部已處理，見 Task 8）：
  知識庫段落的 metadata 沒有 "url" 鍵，就算照搬 CARE 的 `_dead_source_urls`／
  `_cited_urls` 掛在 kb 路徑上也永遠找不到 url、恆回空集合，所以這裡不保留
  那段機制——不是拿掉功能，是那個功能在 MEDDEMO 的資料模型下本來就沒有作用
  對象。`link_checker` 建構子參數保留以符合介面（與 CARE 一致），本類別在知識庫
  路徑不使用（段落沒有網址）；網路路徑的連結檢查由 `WebSearchService` 自己的
  `link_checker` 負責。
- 沒有 i18n（`t("agent.sources_heading")`）：不附文字來源清單標題，`sources`
  直接以結構化資料回傳，「資料來源」這行由前端渲染。

James 2026-09-15 再決定兩處跟 CARE 不同：

- 知識庫答案沒有任何對得上的出處時回 no_evidence（`FailCode.NO_CITATION`，FR-8.3），
  CARE 照樣回答、只是不附來源；引用編號也認全形［1］【1】與串列寫法 [1, 2]（見 `_CITATION_RE`、`_answer_from`）。
- 用藥、劑量、療效這類醫療問題（改寫結果 `medical=True`）知識庫答不出來時不上網，回
  no_evidence（`FailCode.MEDICAL`），跟語音問答的規則 4 一致（見 `_web_or_no_hits`）。
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.llm import LLM
from app.services.crag.cannot_answer import (
    CANNOT_ANSWER_MARKERS,
    NO_ANSWER_SENTINEL,
    answer_preview,
    matched_cannot_answer_marker,
)
from app.services.crag.documents import Document
from app.services.crag.fail_codes import FailCode
from app.services.crag.grader import Grade, RetrievalGrader
from app.services.crag.link_check import LinkChecker
from app.services.crag.prompts import ANSWER_SYSTEM, build_rag_prompt, wrap_context
from app.services.crag.reranker import Reranker
from app.services.crag.retriever import HybridRetriever
from app.services.crag.rewriter import QueryRewriter, RewrittenQuery
from app.services.crag.web_search import WebSearchService

logger = logging.getLogger(__name__)

# 精排後送進生成的段落數上限。照搬 CARE（answer_service.py：RERANK_TOP_N）
RERANK_TOP_N = 5
# 來源清單最多列幾筆。照搬 CARE（answer_service.py：CITE_TOP_K）
CITE_TOP_K = 3
# 精排後之文章層級去重：同一篇文章最多留幾個 chunk（見 dedup_ranked_docs）。
# 照搬 CARE（answer_service.py：RERANK_MAX_CHUNKS_PER_ARTICLE）
RERANK_MAX_CHUNKS_PER_ARTICLE = 2

# CRAG grader 失敗時的數值門檻：只認 Cohere 的 rerank_score，≥ 此門檻才放行生成。
# 照搬 CARE 實際部署值——CARE `answer_service.py` 模組常數寫的是 0.0（模組層級
# 的保底預設，維持「未設定 config 時不設限」的舊行為），真正吃的是
# `app/core/config.py` 的 `RAG_DEGRADED_MIN_SCORE`，預設 0.3（`.env.example`
# 同值）。MEDDEMO 沒有另一層 settings 覆寫這個數字，直接把部署值當常數。
# 門檻怎麼定、為什麼只認 rerank_score 不退回融合分數，見
# `RagAnswerService._filter_by_degraded_score` 的 docstring（照搬 CARE 的量測）。
DEFAULT_DEGRADED_MIN_SCORE = 0.3

# CRAG 判 ambiguous 時，啟動改寫第二輪的時間預算（秒）。0.0＝不設限，
# 維持導入前的行為。
#
# 第二輪是整條管線最貴的一段。下列數字是在 gemini-2.5-flash（thinking 預設
# 開啟）上實測的：rewrite 5.3s ＋ 第二輪檢索精排 1.6s ＋ grade 11.8s ≈ 19s，
# 後面還要再付一次 generate（3.8-10.2s）。同一題走不走第二輪是 43.6s 與 ~25s
# 的差別。
#
# ⚠ 預設模型已換成 gemini-3.8-flash，上面這組數字尚未在新模型上重測。實測新
# 模型的純文字回應快了約一倍，所以這個預算值很可能過於寬鬆——要調之前先重測，
# 不要照著舊數字推算。
#
# 為什麼是「用掉多少」而不是「還剩多少」：預算檢查點在第一輪 grade 之後，
# 那時已經知道這一輪的 grader 有多慢——grader 慢通常代表第二次也會慢，
# 用已花時間當預測比固定總時限準。
#
# 12 秒的來由：第一輪檢索＋精排＋grade 實測 5.0 / 9.1 / 13.9 秒，取在最慢
# 那題之下，讓它跳過第二輪、其餘兩題不受影響。**這是依三題樣本抓的起點，
# 不是調校過的值**；要調整請先用 evals/rag/golden.jsonl 量判定品質的變化。
#
# 超時的降級是「拿第一輪結果生成」而不是轉網搜：網搜要再打 Firecrawl
# 搜尋、可能逐頁 scrape、再生成一次，比第二輪更慢——為了省時間而走上更慢
# 的路是本末倒置。這與既有 rewrite 失敗時 `return ranked` 的降級一致。
#
# 以上全部照搬 CARE（answer_service.py）原文，含警告與理由；MEDDEMO 用的
# 也是 gemini-3.8-flash，尚未有自己的量測數字，⚠ 那句同樣適用，還沒有人
# 在 MEDDEMO 上重測過。`evals/rag/golden.jsonl` 是 CARE 的評測集路徑，
# MEDDEMO 還沒有對應物，要調整這個值前得先建立 MEDDEMO 自己的評測資料。
DEFAULT_CRAG_REWRITE_BUDGET_SECONDS = 12.0

# 整條管線的總逾時（秒）。0＝不設限。照搬 CARE（answer_service.py）：
#
# 為什麼需要：各段各自有逾時（Cohere、Firecrawl、連結檢查），但加起來沒有上限；
# Gemini 的呼叫則根本沒有逾時（langchain-google-genai 4.2.2 預設 timeout=None、
# 重試 6 次）。實測過 rag_retrieve 卡 94 秒才回 0 筆，使用者等 107 秒換一句
# 「查無資料」。檢索那段另有每條腿的逾時（retriever.DEFAULT_LEG_TIMEOUT_SECONDS），
# 這裡是最後一道：不管卡在哪一段，到點就停。
#
# 45 秒的來由（CARE 原文的下界依據；上界依據是 LINE loading 動畫最長 60 秒
# ──那是 CARE 專屬的 LINE 介面限制，MEDDEMO 是網頁沒有這個上限，故不搬）：
# golden 55 題完整管線（2026-09-14，本機 gemini-3.8-flash，各 1 次）最慢
# 18.7 秒（網搜路徑），p90 14.9 秒。45 秒是最慢那題的 2.4 倍，正常題目不會
# 被切掉。
#
# MEDDEMO 還沒量過等價的數字（自己的知識庫、自己的問題分佈），James 9/14
# 決定這個值先照搬 CARE 的 45 秒；要調整前先用 MEDDEMO 自己的資料重測。
DEFAULT_RAG_ANSWER_TIMEOUT_SECONDS = 45.0

# 答不到依據時的文案：RagOutcome 在 no_evidence 時一律帶這句（不分有沒有上網）。
# app.services.knowledge 另有兩句：「內部文件和網路上都找不到…」只在真的上網查過才改用
# （見 knowledge._went_to_web），用藥題（FailCode.MEDICAL）改用 knowledge.MEDICAL_NO_EVIDENCE；
# 幾句刻意不同，不要合併成同一個常數。
NO_EVIDENCE = "內部文件裡找不到可以回答這個問題的依據。"

# 引用編號：半形 [1]，也認全形［1］、【1】和一組括號列好幾個編號的串列寫法 [1, 2]、［1、3］。
# MEDDEMO 的知識庫答案一個對得上的出處都沒有就當查無依據（見 _answer_from），格式不認的話，
# 有依據的答案會被整段丟掉；_append_sources 會統一改寫成一個編號一組的半形 [n]。
# 依據：全形是 James 2026-09-15 要求一併接受，目前還沒量到實例；串列寫法在 9/15 付費實測的
# 網路答案裡出現過（X09 寫成 [1, 3]）。
# 邊界：\d 也認全形與其他文字系統的數字（１、٣），左右括號不必成對（[4】）；答案若拿【1】【2】
# 當條列編號，會被當成引用——知識庫文件沒有這種寫法（9/15 grep data/documents 0 筆），
# 模型沒有原文可抄，接受這個取捨。
_CITATION_RE = re.compile(r"[\[［【]\s*(\d+(?:\s*[,，、]\s*\d+)*)\s*[\]］】]")
_CITATION_SEP = re.compile(r"\s*[,，、]\s*")

# 三種評估結果對應的查詢過程文案，一律用「評估：X」這個固定格式，方便日後
# 掃 QueryTrace 統計。AMBIGUOUS 在「改寫預算已耗盡」時會被更詳細的文案覆蓋。
_GRADE_DECISION = {
    Grade.CORRECT: "評估：夠",
    Grade.AMBIGUOUS: "評估：不確定",
    Grade.INCORRECT: "評估：無關",
}

# on_step 的簽名同 MEDDEMO 既有的 app.services.asks.run_ask 版本（不是新介面，這裡只是
# 給 RagAnswerService 用同一個型別別名）
OnStep = Callable[..., None]


@dataclass
class RagOutcome:
    """CRAG 一次查詢的結果。取代 CARE 版本回傳的字串答案，欄位供 Task 10 決定
    MEDDEMO 的 `ask_record.status`、畫面顯示與 `evidence`。"""

    status: str  # "answered" / "no_evidence" / "failed"
    route: str | None  # "kb" / "web" / None（KB_EMPTY、TIMEOUT 沒有明確路徑；MEDICAL 刻意不上網）
    answer: str | None
    sources: list[dict[str, Any]]
    fail_code: FailCode | None


def kb_source(doc: Document, index: int) -> dict[str, Any]:
    """把一份知識庫文件轉成結構化來源欄位，供 `RagOutcome.sources` 使用。"""
    return {
        "kind": "kb",
        "index": index,
        "chunk_id": doc.metadata.get("chunk_id"),
        "source_name": doc.metadata.get("source_name"),
        "doc_title": doc.metadata.get("doc_title"),
        "section": doc.metadata.get("section"),
        "content": doc.page_content,
    }


def _citation_numbers(match: re.Match[str]) -> list[int]:
    """一組引用括號裡的編號，依寫的順序（可能重複）。"""
    return [int(part) for part in _CITATION_SEP.split(match.group(1))]


def cited_indices(answer_text: str) -> list[int]:
    """回傳答案中出現過的引用編號，依首次出現順序、去重。照搬 CARE（answer_service.py）；
    MEDDEMO 另外把串列寫法 [1, 2] 拆開（見 _CITATION_RE）。"""
    seen: set[int] = set()
    order: list[int] = []
    for match in _CITATION_RE.finditer(answer_text or ""):
        for idx in _citation_numbers(match):
            if idx not in seen:
                seen.add(idx)
                order.append(idx)
    return order


class RagAnswerService:
    def __init__(
        self,
        llm: LLM,
        retriever: HybridRetriever,
        reranker: Reranker,
        *,
        grader: RetrievalGrader,
        rewriter: QueryRewriter,
        web_search: WebSearchService | None,
        link_checker: LinkChecker | None,
        on_step: OnStep,
        rerank_top_n: int = RERANK_TOP_N,
        max_chunks_per_article: int = RERANK_MAX_CHUNKS_PER_ARTICLE,
        degraded_min_score: float = DEFAULT_DEGRADED_MIN_SCORE,
        crag_rewrite_budget_seconds: float = DEFAULT_CRAG_REWRITE_BUDGET_SECONDS,
        speculative_generate: bool = True,
        total_timeout_seconds: float = DEFAULT_RAG_ANSWER_TIMEOUT_SECONDS,
    ) -> None:
        self._llm = llm
        self.retriever = retriever
        self.reranker = reranker
        self.rerank_top_n = rerank_top_n
        self.max_chunks_per_article = max_chunks_per_article
        # CRAG 永遠開啟：grader／rewriter 必填，MEDDEMO 沒有 CARE 的
        # crag_enabled 旗標（不加預設關閉的開關，見 context.md Global Constraints）
        self.grader = grader
        self.rewriter = rewriter
        # 存在即可上網；每次要上網才檢查 is None，不在這裡算成布林值存起來——
        # Task 10 的測試會在建好之後直接換掉 self.web_search。
        self.web_search = web_search
        self.link_checker = link_checker
        self.on_step = on_step
        self.degraded_min_score = degraded_min_score
        self.crag_rewrite_budget_seconds = crag_rewrite_budget_seconds
        self.speculative_generate = bool(speculative_generate)
        self.total_timeout_seconds = total_timeout_seconds

    async def answer(self, question: str) -> RagOutcome:
        # ctx 跟著整條呼叫鏈傳下去，記錄目前走到第幾輪查詢——比照 CARE 用
        # `timing` dict 撐過 `asyncio.timeout` 取消的寫法：`_answer` 被取消時
        # 這個 dict 裡已經寫入的內容還在，`_timed_out` 讀得到最後一輪的編號。
        ctx: dict[str, Any] = {"round": 1}
        limit = self.total_timeout_seconds if self.total_timeout_seconds > 0 else None
        deadline = asyncio.timeout(limit)
        try:
            async with deadline:
                return await self._answer(question, ctx)
        except TimeoutError:
            # 只接自己這個總逾時。管線裡別處拋出的 TimeoutError 是另一種故障，
            # 照舊往上拋——記成「逾時」會把查錯方向帶歪。
            if not deadline.expired():
                raise
            return self._timed_out(ctx)

    def _timed_out(self, ctx: dict[str, Any]) -> RagOutcome:
        """總逾時到點：記錄、回 TIMEOUT。進行中的投機生成與改寫已由 `_answer`
        的 finally 取消（逾時是以取消送進去的），這裡不必再收。"""
        round_number = ctx["round"]
        logger.warning(
            "crag_fail code=%s timeout_s=%s round=%s",
            FailCode.TIMEOUT,
            self.total_timeout_seconds,
            round_number,
        )
        self.on_step(
            round_number,
            "stop",
            decision=f"查詢超過 {self.total_timeout_seconds:g} 秒，已逾時停止",
        )
        return RagOutcome(status="failed", route=None, answer=None, sources=[], fail_code=FailCode.TIMEOUT)

    async def _answer(self, question: str, ctx: dict[str, Any]) -> RagOutcome:
        # 預算從這裡起算，涵蓋第一輪檢索、精排與 grade——預算要防的是整體
        # 延遲，只計 _apply_crag 內部會漏掉前面已經花掉的時間。
        started = time.perf_counter()
        candidates = await self._retrieve_and_rerank(question)
        if not candidates:
            self.on_step(1, "search", search_query=question, row_count=0, decision="沒有檢索到任何段落")
            return await self._web_or_no_hits(question, ctx)

        speculative = self._start_speculative_generate(question, candidates)
        rewrite = self._start_speculative_rewrite(question, candidates)
        try:
            return await self._answer_from(question, candidates, speculative, rewrite, started, ctx)
        finally:
            # 冪等：正常路徑上任務已被 await，這裡不做事；提早 return 或例外
            # 逃出時才真正收掉，不留 orphan task。
            _abandon_task(speculative)
            _abandon_task(rewrite)

    async def _answer_from(
        self,
        question: str,
        candidates: list[Document],
        speculative: "asyncio.Task[str] | None",
        rewrite: "asyncio.Task[RewrittenQuery] | None",
        started: float,
        ctx: dict[str, Any],
    ) -> RagOutcome:
        try:
            approved = await self._apply_crag(question, candidates, started=started, rewrite=rewrite, ctx=ctx)
        except Exception:
            logger.exception("CRAG failed; degrading to generate without grade crag_grade=degraded")
            # CRAG 是這條路徑唯一的相關性把關，它失效時不能就這樣放行。精排
            # 分數是這裡唯一還可信的訊號。過不了門檻就走與「知識庫無資料」
            # 相同的路徑——寧可少答，不要拿不相關的內容生成答案。
            approved = self._filter_by_degraded_score(candidates)
            if not approved:
                logger.info("rag_fail code=%s crag_grade=degraded_below_floor", FailCode.KB_EMPTY)
                self.on_step(
                    ctx["round"],
                    "search",
                    search_query=question,
                    row_count=len(candidates),
                    decision="評估發生錯誤，候選段落的精排分數皆低於降級門檻",
                )
                # 一定要把並行改寫任務交下去（同下面 else 裡 `approved is None`
                # 那個分支）：沒傳的話 `_web_or_no_hits` 會在 `_search_queries_for_web`
                # 裡用空 docs 當場重新呼叫一次 rewriter，而 `_answer` 用
                # `_start_speculative_rewrite` 起跑的那個並行任務只會在 `_answer`
                # 的 finally 被丟棄——多花一次改寫的時間、且新那次改寫看到的段落
                # 是 [] 不是這裡的 candidates。CARE answer_service.py 對等的降級
                # 路徑也是把 rewrite 傳下去。
                return await self._web_or_no_hits(question, ctx, rewrite=rewrite)
            self.on_step(
                ctx["round"],
                "search",
                search_query=question,
                row_count=len(candidates),
                decision=f"評估發生錯誤，改用精排分數門檻：{len(approved)}／{len(candidates)} 段通過",
            )
        else:
            if approved is None:
                return await self._web_or_no_hits(question, ctx, rewrite=rewrite)

        round_number = ctx["round"]
        kb_answer = await self._resolve_generate(speculative, question, candidates, approved)
        if self._is_cannot_answer(kb_answer):
            marker = matched_cannot_answer_marker(kb_answer, CANNOT_ANSWER_MARKERS)
            preview = answer_preview(kb_answer)
            logger.info(
                "rag_fail code=%s matched_marker=%s answer_preview=%s",
                FailCode.MODEL_REFUSE,
                marker,
                preview,
            )
            self.on_step(round_number, "stop", decision="模型判斷內部文件不足以回答問題核心，已標記拒答")
            return RagOutcome(
                status="no_evidence", route="kb", answer=NO_EVIDENCE, sources=[], fail_code=FailCode.MODEL_REFUSE
            )

        body, sources = self._append_sources(kb_answer, approved)
        if not sources:
            # 跟 CARE 不同（James 2026-09-15 決定，FR-8.3）：答案沒有任何對得上的出處，就證明不了
            # 內容來自內部文件，當作查無依據；CARE 照樣回答、只是不附來源。不轉上網：走到這裡的
            # 段落都已通過評估（或評估出錯時的精排分數門檻），缺的是答案沒照規則標出處，不是資料。
            # 整段答案都記下來（answer_preview 只留前 200 字）：上線後要靠這行分辨「模型沒標出處」
            # 還是「標了但格式沒認出來」，引用常在句尾，截斷就看不到。
            logger.info("rag_fail code=%s answer=%s", FailCode.NO_CITATION, " ".join(kb_answer.split()))
            self.on_step(round_number, "stop", decision="答案沒有標出對得上的文件出處，視為查無依據")
            return RagOutcome(
                status="no_evidence", route="kb", answer=NO_EVIDENCE, sources=[], fail_code=FailCode.NO_CITATION
            )
        self.on_step(round_number, "answer", decision=f"根據 {len(sources)} 段文件回答")
        return RagOutcome(status="answered", route="kb", answer=body, sources=sources, fail_code=None)

    def _filter_by_degraded_score(self, docs: list[Document]) -> list[Document]:
        """只保留 Cohere `rerank_score` 達到門檻的文件。門檻為 0 時原樣回傳。

        **只認 `rerank_score`，不退回 `score`。** 沒有這個欄位就代表 Cohere
        也失效了（`VectorScoreReranker` 不寫這個鍵），此時整批視為不合格，
        走與「知識庫無資料」相同的路徑。

        為什麼不退回 `score`——這是 CARE 量出來的，不是設計偏好（golden set
        22 題、110 篇降級路徑候選）：融合分數（凸組合 α=0.6）相關文件均值
        0.632、不相關 0.650，**不相關的比相關的還高**（min-max 逐題正規化，
        每題該腿第一名恆為 1.0，「整批候選都不相關」那一題最好的那筆照樣滿
        分，而這張網要擋的正是整批不相關的情況）；原始 cosine 相關 0.8941、
        不相關 0.8872，差 0.0069，分佈完全重疊。這兩個尺度上都不存在有意義
        的門檻值。`rerank_score` 不同：Cohere 的 relevance_score 是絕對校準
        的分數，0.3 在它上面才有語意，也讓門檻與融合模式解耦（RRF 與凸組合
        退回 `score` 時尺度天差地遠，切換融合模式會順帶改到答案的把關）。
        """
        if self.degraded_min_score <= 0:
            return docs
        kept: list[Document] = []
        for doc in docs:
            raw = doc.metadata.get("rerank_score")
            if isinstance(raw, (int, float)) and float(raw) >= self.degraded_min_score:
                kept.append(doc)
        return kept

    async def _web_or_no_hits(
        self,
        question: str,
        ctx: dict[str, Any],
        rewrite: "asyncio.Task[RewrittenQuery] | None" = None,
    ) -> RagOutcome:
        round_number = ctx["round"]
        if self.web_search is None:
            logger.info("crag_fail code=%s", FailCode.KB_EMPTY)
            self.on_step(round_number, "stop", decision="知識庫查無足夠依據，且未設定網路搜尋")
            return RagOutcome(status="no_evidence", route=None, answer=NO_EVIDENCE, sources=[], fail_code=FailCode.KB_EMPTY)

        search_queries = await self._search_queries_for_web(question, rewrite)
        if search_queries is not None and search_queries.medical:
            # MEDDEMO 加的（James 2026-09-15 決定）：用藥、劑量、療效這類醫療問題不拿網路資料回答，
            # 跟語音問答的規則 4 一致（app.services.voice）。判斷搭在改寫那次呼叫（rewriter 的
            # medical 欄位），不多打模型；改寫失敗（None）就照常上網，跟改寫失敗時退回原句搜尋一致。
            logger.info("crag_fail code=%s", FailCode.MEDICAL)
            self.on_step(round_number, "stop", decision="用藥、劑量、療效這類醫療問題不上網查")
            return RagOutcome(status="no_evidence", route=None, answer=NO_EVIDENCE, sources=[], fail_code=FailCode.MEDICAL)
        search_query_used = (search_queries.zh_terms if search_queries else "") or question

        try:
            web_answer = await self.web_search.answer(question, search_queries=search_queries)
        except Exception:
            logger.exception("web fallback failed")
            self.on_step(
                round_number, "web", search_query=search_query_used, row_count=None, decision="網路搜尋發生錯誤"
            )
            self.on_step(round_number, "stop", decision="網路搜尋發生錯誤，暫時無法回答")
            return RagOutcome(status="failed", route="web", answer=None, sources=[], fail_code=FailCode.WEB_ERROR)

        if web_answer.fail_code is not None:
            decision = (
                "網路搜尋查無可用內容"
                if web_answer.fail_code == FailCode.WEB_EMPTY
                else "模型判斷網路資料不足以回答問題核心，已標記拒答"
            )
            self.on_step(
                round_number, "web", search_query=search_query_used, row_count=web_answer.docs_found, decision=decision
            )
            self.on_step(round_number, "stop", decision=f"查無依據：{decision}")
            return RagOutcome(
                status="no_evidence", route="web", answer=NO_EVIDENCE, sources=[], fail_code=web_answer.fail_code
            )

        self.on_step(
            round_number,
            "web",
            search_query=search_query_used,
            row_count=web_answer.docs_found,
            decision=f"找到 {len(web_answer.sources)} 個可用網頁",
        )
        self.on_step(round_number, "answer", decision=f"根據 {len(web_answer.sources)} 個網頁回答")
        return RagOutcome(
            status="answered", route="web", answer=web_answer.answer, sources=web_answer.sources, fail_code=None
        )

    def _start_speculative_rewrite(
        self, question: str, docs: list[Document]
    ) -> "asyncio.Task[RewrittenQuery] | None":
        """在 CRAG 分級開始前就把查詢改寫排進事件迴圈。

        照搬 CARE（answer_service.py）原文：改寫結果只有兩條路用得到：分級判
        ambiguous（kb_query 重查知識庫）與判 incorrect（zh_terms／en_terms
        網搜）。兩者都要等分級結束才知道，而改寫不依賴分級結果，所以與分級
        並行。2026-09-12 實測改寫（thinking low）1.2-3.3 秒、分級 1.6-3.7
        秒：多數情況改寫先跑完，網搜路徑不必多等；ambiguous 路徑則省下原本
        排在分級之後的整段改寫。

        代價是分級判 correct 時這次改寫白跑（投機生成那段註解記錄過 84% 的
        題目判 correct），付的是 token 不是延遲，單次請求的 Gemini 併發也再多 1。

        以上數字是 CARE 在醫療題上量的，MEDDEMO 還沒有自己的量測，先照搬
        結論（改寫與分級併發帶來的節省）。
        """
        return asyncio.create_task(self.rewriter.rewrite(question, docs))

    async def _await_rewrite(
        self,
        rewrite: "asyncio.Task[RewrittenQuery] | None",
        question: str,
        docs: list[Document],
    ) -> RewrittenQuery:
        """取用並行中的改寫；沒有並行任務時（例如檢索為空）當場改寫。"""
        if rewrite is None:
            return await self.rewriter.rewrite(question, docs)
        return await rewrite

    async def _search_queries_for_web(
        self,
        question: str,
        rewrite: "asyncio.Task[RewrittenQuery] | None",
    ) -> RewrittenQuery | None:
        """網搜要用的改寫查詢。改寫失敗回 None，網搜退回用原句，不中斷回答。"""
        try:
            return await self._await_rewrite(rewrite, question, [])
        except Exception:
            logger.exception("query rewrite failed; web search falls back to the original question")
            return None

    async def _retrieve_and_rerank(self, query: str) -> list[Document]:
        docs = await self.retriever.ainvoke(query)
        if not docs:
            return []
        # 拿完整排序（不是只拿 top_n）：文章層級去重必須看過全部候選才能
        # 判斷「這篇文章還有沒有更高分的 chunk 沒被算進去」，只截斷後的
        # top_n 會讓去重看不到被擠掉的候選，等於沒去重。
        ranked = await self.reranker.rerank(query, docs, top_n=len(docs))
        deduped = dedup_ranked_docs(ranked, max_per_article=self.max_chunks_per_article)
        return deduped[: self.rerank_top_n]

    async def _apply_crag(
        self,
        question: str,
        ranked: list[Document],
        *,
        started: float,
        rewrite: "asyncio.Task[RewrittenQuery] | None",
        ctx: dict[str, Any],
    ) -> list[Document] | None:
        """回傳可用於生成的 docs；None 表示知識庫不足，交給呼叫端轉網搜。

        *started* 是本次 answer 的 `time.perf_counter()` 起點，供改寫第二輪的
        時間預算判斷。*rewrite* 是與分級並行的改寫任務。
        """
        grade = await self.grader.grade(question, ranked)
        logger.info("crag_grade=%s", grade.value)

        if grade is Grade.CORRECT:
            self.on_step(1, "search", search_query=question, row_count=len(ranked), decision=_GRADE_DECISION[grade])
            return ranked

        if grade is Grade.INCORRECT:
            self.on_step(1, "search", search_query=question, row_count=len(ranked), decision=_GRADE_DECISION[grade])
            return None

        # ambiguous：有關但資訊不足，值得改寫查詢再試一輪——除非預算已經用完。
        elapsed = time.perf_counter() - started
        if self._rewrite_budget_exhausted(elapsed):
            # 拿第一輪的 ranked 生成。grader 說的是「有關但資訊不足」，不是
            # 「無關」，而 prompt 的拒答規則與 _is_cannot_answer 仍在後面把關。
            logger.info(
                "crag_grade=ambiguous_budget_exhausted elapsed_s=%.1f budget_s=%.1f",
                elapsed,
                self.crag_rewrite_budget_seconds,
            )
            self.on_step(
                1,
                "search",
                search_query=question,
                row_count=len(ranked),
                decision=(
                    f"評估不確定，已花 {elapsed:.1f} 秒超過 {self.crag_rewrite_budget_seconds:g} 秒預算，直接用第一輪"
                ),
            )
            return ranked

        self.on_step(1, "search", search_query=question, row_count=len(ranked), decision=_GRADE_DECISION[grade])

        try:
            rewritten = await self._await_rewrite(rewrite, question, ranked)
        except Exception:
            logger.exception("CRAG rewrite failed; degrading to generate crag_grade=rewrite_degraded")
            return ranked

        self.on_step(
            1,
            "rewrite",
            search_query=rewritten.kb_query,
            decision=f"中文搜尋詞：{rewritten.zh_terms}；英文：{rewritten.en_terms}",
        )

        ctx["round"] = 2
        second = await self._retrieve_and_rerank(rewritten.kb_query)
        if not second:
            logger.info("crag_grade=ambiguous_exhausted empty_retry")
            self.on_step(2, "search", search_query=rewritten.kb_query, row_count=0, decision="沒有檢索到任何段落")
            return None

        grade2 = await self.grader.grade(rewritten.kb_query, second)
        logger.info("crag_grade=%s after_rewrite", grade2.value)
        self.on_step(
            2, "search", search_query=rewritten.kb_query, row_count=len(second), decision=_GRADE_DECISION[grade2]
        )
        if grade2 is Grade.CORRECT:
            return second
        return None

    def _rewrite_budget_exhausted(self, elapsed_seconds: float) -> bool:
        """已花時間是否用完改寫預算。預算 <= 0 視為不設限（沿用本檔其他門檻的慣例）。"""
        budget = self.crag_rewrite_budget_seconds
        return budget > 0 and elapsed_seconds >= budget

    @staticmethod
    def _build_context(docs: list[Document]) -> str:
        """組出帶編號與出處標頭的 context。標頭用 doc_title｜section，不放
        任何可能被模型拿去引用的網址（MEDDEMO 的段落本來就沒有網址）。"""
        blocks: list[str] = []
        for idx, doc in enumerate(docs, start=1):
            doc_title = str(doc.metadata.get("doc_title") or "").strip()
            section = str(doc.metadata.get("section") or "").strip()
            label = "｜".join(part for part in (doc_title, section) if part)
            header = f"[{idx}]" + (f" {label}" if label else "")
            blocks.append(f"{header}\n{doc.page_content}")
        return "\n\n".join(blocks)

    def _start_speculative_generate(self, question: str, docs: list[Document]) -> "asyncio.Task[str] | None":
        """在 CRAG 分級開始前就把生成排進事件迴圈。

        照搬 CARE（answer_service.py）原文：分級與生成互不依賴——生成只吃
        ranked，分級不改動它——所以兩者可以並行。實測分級 2.6-7.0s、生成
        3.9-9.5s，而 84% 的題目分級結果是 correct、送去生成的 docs 原封不動，
        這時等於整段分級時間白賺。

        代價是另外 16%（incorrect／ambiguous）會多一次白跑的生成，付的是
        token 不是延遲，並讓單次請求的 Gemini 併發從 1 升到 2。要關掉傳
        `speculative_generate=False`。

        以上數字是 CARE 在醫療題上量的，MEDDEMO 還沒有自己的量測，先照搬
        結論（分級與生成併發帶來的節省）。
        """
        if not self.speculative_generate:
            return None
        return asyncio.create_task(self._generate_answer(question, docs))

    async def _resolve_generate(
        self,
        speculative: "asyncio.Task[str] | None",
        question: str,
        candidates: list[Document],
        approved: list[Document],
    ) -> str:
        """取用投機結果，或丟棄後以放行的 docs 重新生成。照搬 CARE（answer_service.py）：
        判斷用 identity（`approved is candidates`）而非內容比對——CRAG 判 correct
        時原封不動回傳同一個 list，走改寫第二輪或降級過濾時回的是另一個 list。
        判錯的方向是安全的：identity 為假但內容其實相同時只是白重生一次；
        **不可能**發生「拿未經放行的 docs 生成的答案回給使用者」。
        """
        if speculative is None:
            return await self._generate_answer(question, approved)
        if approved is candidates:
            logger.info("speculative_generate=hit")
            return await speculative
        logger.info("speculative_generate=miss")
        _abandon_task(speculative)
        return await self._generate_answer(question, approved)

    async def _generate_answer(self, question: str, docs: list[Document]) -> str:
        context = wrap_context(self._build_context(docs))
        answer_text = await self._llm.atext(system=ANSWER_SYSTEM, prompt=build_rag_prompt(question, context), effort="medium")
        # 空字串＝答不出來（LLM.atext 被擋或沒有候選回應時的約定，見 app.llm）。
        # 照搬 CARE：不能把預設文案當答案送出，直接給拒答標記讓 _is_cannot_answer 接手。
        return answer_text or NO_ANSWER_SENTINEL

    @staticmethod
    def _is_cannot_answer(text: str) -> bool:
        return matched_cannot_answer_marker(text, CANNOT_ANSWER_MARKERS) != "<none>"

    @staticmethod
    def _source_key(doc: Document) -> str:
        """判定「同一篇文章」的鍵。MEDDEMO 的段落沒有網址（照搬 CARE `_source_key`
        無 url 時的分支）：用 source_name＋doc_title 當文章身分，`dedup_ranked_docs`
        與 `_append_sources` 的去重都靠這個鍵保持一致。"""
        source = str(doc.metadata.get("source_name") or "").strip()
        title = str(doc.metadata.get("doc_title") or "").strip()
        return f"meta:{source}|{title}"

    @staticmethod
    def _append_sources(answer_text: str, docs: list[Document]) -> tuple[str, list[dict[str, Any]]]:
        """重新編號答案中的引用，組出結構化來源清單。

        照搬 CARE `_append_sources` 的重新編號、去重、CITE_TOP_K 上限邏輯；
        差異只在輸出——CARE 組純文字清單接在答案後面，這裡回傳 `(body, sources)`，
        來源清單由前端另外渲染。同一篇文章（`_source_key` 相同）只佔一個編號，
        多次引用共用同一個新編號；超過 CITE_TOP_K 的引用會被移除標記但不佔編號。
        """
        cited = cited_indices(answer_text)
        if not cited:
            logger.info("citation_missing docs=%d", len(docs))
            return answer_text, []

        key_to_new: dict[str, int] = {}
        renumber: dict[int, int] = {}
        sources: list[dict[str, Any]] = []

        for old_idx in cited:
            if old_idx < 1 or old_idx > len(docs):
                continue
            doc = docs[old_idx - 1]
            key = RagAnswerService._source_key(doc)
            existing = key_to_new.get(key)
            if existing is not None:
                renumber[old_idx] = existing
                continue
            if len(sources) >= CITE_TOP_K:
                continue
            new_idx = len(sources) + 1
            key_to_new[key] = new_idx
            renumber[old_idx] = new_idx
            sources.append(kb_source(doc, new_idx))

        def _replace(match: re.Match[str]) -> str:
            # 串列寫法拆開逐一換成新編號：對不到的丟掉，同一篇文章併成的同一個編號只寫一次
            mapped: list[int] = []
            for old in _citation_numbers(match):
                new = renumber.get(old)
                if new is not None and new not in mapped:
                    mapped.append(new)
            return "".join(f"[{n}]" for n in mapped)

        # 先改寫內文再回傳：即使一筆來源都解析不出來，那些指向不存在來源的
        # 標記仍必須從答案中移除。
        body = _CITATION_RE.sub(_replace, answer_text)
        if not sources:
            logger.info("citation_unresolved cited=%s docs=%d", cited, len(docs))
        return body, sources


def _abandon_task(task: "asyncio.Task[Any] | None") -> None:
    """收掉不再需要的投機任務。冪等，可安全重複呼叫。照搬 CARE（answer_service.py）：

    已完成且帶例外時要主動取出例外，否則 asyncio 會噴
    "Task exception was never retrieved"——那條路上的失敗本來就要丟棄，
    不該變成 log 噪音。
    """
    if task is None or task.cancelled():
        return
    if not task.done():
        task.cancel()
        return
    task.exception()


def dedup_ranked_docs(docs: list[Document], *, max_per_article: int) -> list[Document]:
    """精排後之文章層級去重：同一篇文章最多留 max_per_article 個 chunk。

    照搬 CARE（answer_service.py）：*docs* 必須已依相關性排序（分數高在前），
    本函式只依序掃描並過濾超出上限的 chunk，**不重新排序**，因此保留的 chunk
    之間相對順序與輸入一致。文章身分判定沿用 `RagAnswerService._source_key`
    （MEDDEMO：source_name＋doc_title），不重新發明身分邏輯，確保與
    `_append_sources` 判斷「同一來源」的邏輯一致。

    `max_per_article < 1` 視為 1（至少保留每篇文章的最高分 chunk），不拋例外。
    """
    cap = max_per_article if max_per_article >= 1 else 1
    counts: dict[str, int] = {}
    out: list[Document] = []
    for doc in docs:
        key = RagAnswerService._source_key(doc)
        count = counts.get(key, 0)
        if count >= cap:
            continue
        counts[key] = count + 1
        out.append(doc)
    return out
