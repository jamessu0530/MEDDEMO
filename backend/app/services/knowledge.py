"""知識查詢（FR-8）：照搬 CARE 的 CRAG（app/services/crag）。這裡是同步入口，RQ 背景工作與評測程式都從這裡進來。"""

import asyncio
import contextvars
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.config import settings
from app.llm import LLM
from app.services.crag.answer_service import DEFAULT_RAG_ANSWER_TIMEOUT_SECONDS, OnStep, RagAnswerService
from app.services.crag.answer_service import NO_EVIDENCE as KB_NO_EVIDENCE
from app.services.crag.fail_codes import FailCode
from app.services.crag.firecrawl import FirecrawlClient
from app.services.crag.grader import LLMRetrievalGrader
from app.services.crag.link_check import LinkChecker
from app.services.crag.reranker import CohereReranker, VectorScoreReranker
from app.services.crag.retriever import HybridRetriever, KeywordRetriever, VectorRetriever
from app.services.crag.rewriter import LLMQueryRewriter
from app.services.crag.web_search import WebSearchService

# 只有真的上網查過、網路也答不出來時才用這句；沒上網（KB_EMPTY）、知識庫路徑本身判定拒答
# （MODEL_REFUSE 且 route="kb"）或答案沒有對得上的出處（NO_CITATION）一律用 KB_NO_EVIDENCE，
# 不能暗示查過網路（見 _went_to_web 與 answer_knowledge 的判斷）。知識庫路徑拒答時若改寫判成用藥題／
# 公司內部題，代碼已改成 MEDICAL／INTERNAL（answer_service._kb_no_evidence），改走下面的 NO_WEB。
NO_EVIDENCE = "內部文件和網路上都找不到可以回答這個問題的依據。"
# 刻意不上網的兩種題目：知識庫答不出來也不上網，不能說「網路上也找不到」，文案各自講明原因。
# 用藥題的說法跟語音問答的規則 4 一致（app.services.voice：請業務詢問醫師或藥師），畫面不給轉主管；
# 公司內部題（公司的規定、報價、人事、交易條件）只有主管答得了，照常可以轉主管。
MEDICAL_NO_EVIDENCE = "內部文件裡找不到這個問題的依據。用藥、劑量、療效這類醫療問題不會上網查，請詢問醫師或藥師。"
INTERNAL_NO_EVIDENCE = "內部文件裡找不到這個問題的依據。這是只有公司內部才有答案的問題（例如公司的規定、報價、人事、交易條件），網路上的資料代表不了公司，所以不上網查，可以轉給主管確認。"
# fail_code → (evidence 的 reason, 文案)。reason 存進 ask_record.evidence，畫面與轉主管 API 依此判斷
NO_WEB = {
    FailCode.MEDICAL: ("medical", MEDICAL_NO_EVIDENCE),
    FailCode.INTERNAL: ("internal", INTERNAL_NO_EVIDENCE),
}
# 秒數跟 build_service 組出來的總逾時是同一個常數（build_service 沒改 RagAnswerService
# 的預設值），不另外寫一次數字，改總逾時時這句跟著變。
FAILED_MESSAGES = {
    "TIMEOUT": f"查詢超過 {DEFAULT_RAG_ANSWER_TIMEOUT_SECONDS:g} 秒還沒完成，請稍後再問一次。",
    "WEB_ERROR": "網路搜尋出錯，請稍後再問一次。",
}

# 模組層級共用，快取的是網址死活，沒有個人資料。但正式環境的 `rq worker` 每題 fork
# 一個子行程、做完就結束，父行程從不處理題目，所以快取實際上只活一題（同一題裡重複的
# 網址不重打）；同一個行程連續處理多題時（SimpleWorker、eval_ask）才會跨題延續。
_link_checker = LinkChecker()

# 知識查詢的非同步流程都在同一個事件迴圈上跑：行程共用、第一次用到才建立、刻意不關。
# 不用 asyncio.run，理由有兩個：
# 1. asyncio.run 收尾會等 default executor 裡所有執行緒結束（Python 3.12 上限 300 秒，
#    asyncio.constants.THREAD_JOIN_TIMEOUT）。檢索腿是 asyncio.to_thread 裡的同步呼叫，
#    腿逾時只是不再等那個 await，執行緒照跑——查詢 embedding 用的是 Gemini 同步用戶端，
#    單次 60 秒、最多 3 次。實測（修正前跑 test_asks 的慢 embedding 測試，當時腿逾時 0.05 秒）：
#    答案早已產生，asyncio.run 仍陪那條睡 2 秒的執行緒等到 2.01 秒才回來。Runner.run
#    在主協程完成後就回來，不等殘留的執行緒。
# 2. google-genai 的非同步連線在建構 genai.Client 時就建立、之後一直重用
#    （site-packages/google/genai/_api_client.py 建構用戶端時產生 AsyncHttpxClient）。
#    asyncio.run 每次開新的事件迴圈，審查時本機重現：同一個 GeminiLLM 連續回答兩題，
#    第二題出現 RuntimeError: Event loop is closed。eval_ask 與付費實測腳本都是整批
#    題目共用一個 get_llm()；同一個 Runner 就是同一個迴圈。
#
# 殘留的執行緒不會卡住行程：正式環境的 `rq worker` 每題 fork 一個子行程，做完以
# os._exit 結束（rq/worker/base.py 的 main_work_horse），不等執行緒。SimpleWorker、
# eval_ask、測試是同一個行程連續呼叫，殘留執行緒在背景跑完即可，直譯器結束時才會等它們。
# 被取消的投機生成／改寫若在主協程完成時還沒收完，會在下一次 run 開頭收完。
#
# 前提：只能從沒有事件迴圈在跑的執行緒呼叫（迴圈裡呼叫 Runner.run 會直接拋錯），而且
# 同一時間只有一個執行緒在用。目前的呼叫端 asks.run_ask（RQ 背景工作）、
# scripts/eval_ask.py、test_asks 的同步測試都符合；要從 async 程式或多執行緒呼叫前先改這裡。
_runner: asyncio.Runner | None = None


def _event_loop_runner() -> asyncio.Runner:
    global _runner
    if _runner is None:
        # 給 loop_factory，Runner 就不會把這個迴圈設成執行緒的「目前迴圈」，
        # 不干擾同一個行程裡自己開迴圈的程式（例如 pytest-asyncio）。
        _runner = asyncio.Runner(loop_factory=asyncio.new_event_loop)
    return _runner


@dataclass
class KnowledgeAnswer:
    status: str  # answered / no_evidence / failed
    answer: str | None
    sources: list[dict[str, Any]] = field(default_factory=list)
    route: str | None = None  # kb / web
    error_message: str | None = None
    reason: str | None = None  # 刻意不上網的原因：medical／internal（見 NO_WEB）


def build_service(engine: Engine, llm: LLM, on_step: OnStep, embed_query: Callable[[str], list[float]] | None) -> RagAnswerService:
    config = settings()
    retriever = HybridRetriever(vector_retriever=VectorRetriever(engine, embed_query), text_retriever=KeywordRetriever(engine))
    reranker = CohereReranker(api_key=config.cohere_api_key) if config.cohere_api_key else VectorScoreReranker()
    web = WebSearchService(llm, FirecrawlClient(config.firecrawl_api_key), _link_checker) if config.firecrawl_api_key else None
    return RagAnswerService(
        llm, retriever, reranker,
        grader=LLMRetrievalGrader(llm), rewriter=LLMQueryRewriter(llm),
        web_search=web, link_checker=_link_checker, on_step=on_step,
    )


def _went_to_web(outcome) -> bool:
    """判斷這次 no_evidence 是不是真的查過網路。

    `RagAnswerService` 內部（`answer_service.NO_EVIDENCE`）不分這兩種情況、
    一律用「內部文件裡找不到」，MEDDEMO 這層才需要分辨：`FailCode.KB_EMPTY`
    （`route=None`）代表根本沒上網（沒有 Firecrawl 金鑰）；`FailCode.WEB_EMPTY`
    一定是網搜過但沒結果；`FailCode.MODEL_REFUSE` 兩條路都可能觸發（知識庫
    路徑或網路路徑各自的模型拒答），只有 `route == "web"` 那個才是網路那邊
    拒答。
    """
    if outcome.fail_code == FailCode.WEB_EMPTY:
        return True
    return outcome.fail_code == FailCode.MODEL_REFUSE and outcome.route == "web"


def answer_knowledge(session: Session, llm: LLM, question: str, on_step: OnStep, embed_query=None) -> KnowledgeAnswer:
    service = build_service(session.get_bind(), llm, on_step, embed_query)
    # 每次一份新的 contextvars，跟 asyncio.run 一樣；不給的話 Runner 讓連續的 run 共用同一份
    outcome = _event_loop_runner().run(service.answer(question), context=contextvars.copy_context())
    if outcome.status == "failed":
        return KnowledgeAnswer("failed", None, [], outcome.route, FAILED_MESSAGES.get(str(outcome.fail_code), "查詢失敗"))
    if outcome.status == "no_evidence":
        if outcome.fail_code in NO_WEB:
            reason, message = NO_WEB[outcome.fail_code]
            return KnowledgeAnswer("no_evidence", message, [], outcome.route, reason=reason)
        message = NO_EVIDENCE if _went_to_web(outcome) else KB_NO_EVIDENCE
        return KnowledgeAnswer("no_evidence", message, [], outcome.route)
    return KnowledgeAnswer("answered", outcome.answer, outcome.sources, outcome.route)
