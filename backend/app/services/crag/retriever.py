"""檢索：關鍵字與向量兩條腿並行跑 Postgres，再用 rank_fusion 融合成單一排名。

對應 CARE `app/services/rag/retriever.py`，介面（`ainvoke(query) -> list[Document]`）
與融合邏輯（`HybridRetriever`）逐字照搬；差異只在資料來源——CARE 是 MongoDB Atlas
的 `$vectorSearch`／`$search`，MEDDEMO 是 Postgres 的 pgvector 與 `tsvector`（沿用
`app.services.retrieval` 既有的 `keyword_tokens`／`SIMPLE`），因此兩條腿的實作
（`KeywordRetriever`／`VectorRetriever`）是新寫的，`HybridRetriever` 本身不是。
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable

from sqlalchemy import func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.models import DocumentChunk
from app.services.crag.documents import Document
from app.services.crag.rank_fusion import (
    DEFAULT_RRF_K,
    FUSION_MODE_CONVEX,
    FUSION_MODE_RRF,
    FUSION_MODES,
    convex_combination_fusion,
    reciprocal_rank_fusion,
)
from app.services.retrieval import SIMPLE, keyword_tokens

logger = logging.getLogger(__name__)

# 候選段數、凸組合向量權重：照搬 CARE（config.py：RAG_RETRIEVE_CANDIDATES=40、RAG_FUSION_ALPHA=0.6）
RETRIEVE_CANDIDATES = 40
FUSION_ALPHA = 0.6

# Hybrid 檢索每條腿（向量／文字）的逾時（秒）。照搬 CARE（retriever.py）：
#
# 實測過 rag_retrieve 卡 94 秒才回 0 筆（疑似 embedding 被限流；google-genai 在
# 沒給 retry_options 時只打一次、不重試，所以不是重試累積出來的，原因未查明）。
# 沒有這道逾時，一個卡住的請求就讓整條檢索陪它等。逾時的那條腿當作失敗，走
# `_safe_invoke` 既有的 fail-open：用另一條腿的結果繼續，不是整題失敗。
#
# 5 秒的來由（2026-09-14 本機實測）：golden 55 題的 rag_retrieve（兩腿並行）
# 最慢 0.54 秒（n=59）；query embedding 另外連打 110 次最慢 0.41 秒，管線裡
# 59 次最慢 0.46 秒。5 秒約是正常最慢的 9 倍，只切病態長尾。刻意放寬：誤切的
# 代價是少一條腿——非中文的問題 BM25 幾乎比對不到，丟掉向量腿就等於沒有結果。
DEFAULT_LEG_TIMEOUT_SECONDS = 5.0

VECTOR_SOURCE_NAME = "vector"
TEXT_SOURCE_NAME = "text"


def chunk_document(chunk: DocumentChunk, score: float) -> Document:
    """把資料庫的 `DocumentChunk` 轉成檢索腿共用的 `Document`。"""
    return Document(
        page_content=chunk.chunk_content,
        metadata={
            "id": str(chunk.id),
            "chunk_id": chunk.id,
            "source_name": chunk.source_name,
            "doc_title": chunk.doc_title,
            "section": chunk.section,
            "score": score,
        },
    )


class KeywordRetriever:
    """關鍵字腿：中文兩字一組的全文檢索，分數是 ts_rank_cd（沒有上界，凸組合會先 min-max 正規化）。"""

    def __init__(self, engine: Engine, *, k: int = RETRIEVE_CANDIDATES):
        self.engine, self.k = engine, k

    def invoke(self, query: str) -> list[Document]:
        tokens = keyword_tokens(query)
        if not tokens:
            return []
        tsquery = func.to_tsquery(SIMPLE, " | ".join(f"'{t}'" for t in tokens))
        rank = func.ts_rank_cd(DocumentChunk.search_tokens, tsquery).label("score")
        stmt = (
            select(DocumentChunk, rank)
            .where(DocumentChunk.search_tokens.op("@@")(tsquery))
            .order_by(rank.desc(), DocumentChunk.id)
            .limit(self.k)
        )
        # 每次開自己的 Session：兩條腿在不同執行緒並行，Session 不能跨執行緒共用
        with Session(self.engine) as session:
            return [chunk_document(chunk, float(score)) for chunk, score in session.execute(stmt)]

    async def ainvoke(self, query: str) -> list[Document]:
        return await asyncio.to_thread(self.invoke, query)


class VectorRetriever:
    """向量腿：pgvector cosine 距離，分數是 1 - cosine_distance（0~1，語意與 CARE 的 vectorSearchScore 對齊）。"""

    def __init__(self, engine: Engine, embed_query: Callable[[str], list[float]] | None, *, k: int = RETRIEVE_CANDIDATES):
        self.engine, self.embed_query, self.k = engine, embed_query, k

    def invoke(self, query: str) -> list[Document]:
        if self.embed_query is None:
            return []
        vector = self.embed_query(query)
        distance = DocumentChunk.embedding.cosine_distance(vector)
        stmt = (
            select(DocumentChunk, distance.label("distance"))
            .where(DocumentChunk.embedding.is_not(None))
            .order_by(distance, DocumentChunk.id)
            .limit(self.k)
        )
        with Session(self.engine) as session:
            return [chunk_document(chunk, 1.0 - float(distance)) for chunk, distance in session.execute(stmt)]

    async def ainvoke(self, query: str) -> list[Document]:
        return await asyncio.to_thread(self.invoke, query)


class HybridRetriever:
    """並行跑向量與文字檢索，再融合成單一排名。

    任一邊失敗或逾時（`leg_timeout_seconds`）只記錄並降級為另一邊的結果
    （fail-open）。這讓本類別在
    Atlas Search index 還沒建好時也能安全上線 —— 那時 `$search` 會報錯，
    行為自動退化為原本的純向量檢索。

    融合方式由 `fusion_mode` 決定。CARE 預設維持 `rrf`（不打斷既有線上行為）；
    MEDDEMO 沒有這個包袱，預設值改成 `fusion_mode=FUSION_MODE_CONVEX`、
    `alpha=FUSION_ALPHA`、`limit=RETRIEVE_CANDIDATES`——照搬 CARE config：
    RAG_FUSION_MODE=convex、RAG_FUSION_ALPHA=0.6、RAG_RETRIEVE_CANDIDATES=40。
    要換回 RRF（或重新掃 alpha）前先看 `rank_fusion` 模組 docstring 的取捨說明。

    兩種融合的分數尺度完全不同（RRF 約 1/60 量級、凸組合是 0~1），所以
    **任何以融合分數為基準的絕對門檻都會隨模式改變行為**。目前沒有這種
    門檻：`RAG_DEGRADED_MIN_SCORE` 已改為只認 Cohere 的 relevance_score
    （見 `answer_service._filter_by_degraded_score` 的量測），切換融合模式
    因此只影響排序，不影響醫療答案的把關。新增這類門檻前請先確認這件事。
    """

    def __init__(
        self,
        *,
        vector_retriever,
        text_retriever,
        rrf_k: int = DEFAULT_RRF_K,
        limit: int | None = RETRIEVE_CANDIDATES,
        fusion_mode: str = FUSION_MODE_CONVEX,
        alpha: float = FUSION_ALPHA,
        leg_timeout_seconds: float = DEFAULT_LEG_TIMEOUT_SECONDS,
    ) -> None:
        if fusion_mode not in FUSION_MODES:
            raise ValueError(f"unknown fusion_mode {fusion_mode!r}; expected one of {FUSION_MODES}")
        if not 0.0 <= alpha <= 1.0:
            raise ValueError(f"alpha must be within [0, 1], got {alpha}")
        self.vector_retriever = vector_retriever
        self.text_retriever = text_retriever
        self.rrf_k = rrf_k
        self.limit = limit
        self.fusion_mode = fusion_mode
        # alpha 是「向量腿的權重」，文字腿拿 1-alpha。取這個方向是因為向量
        # 是本專案原本唯一的那條腿，alpha=1.0 等於回到純向量，語意上是可讀的
        # 端點；反過來定義則要靠記憶。
        self.alpha = alpha
        self.leg_timeout_seconds = leg_timeout_seconds

    async def ainvoke(self, query: str) -> list[Document]:
        vector_docs, text_docs = await asyncio.gather(
            self._safe_invoke(self.vector_retriever, VECTOR_SOURCE_NAME, query),
            self._safe_invoke(self.text_retriever, TEXT_SOURCE_NAME, query),
        )

        ranked_lists = [
            (VECTOR_SOURCE_NAME, vector_docs),
            (TEXT_SOURCE_NAME, text_docs),
        ]
        if self.fusion_mode == FUSION_MODE_CONVEX:
            fused = convex_combination_fusion(
                ranked_lists,
                weights={
                    VECTOR_SOURCE_NAME: self.alpha,
                    TEXT_SOURCE_NAME: 1.0 - self.alpha,
                },
                limit=self.limit,
            )
        else:
            fused = reciprocal_rank_fusion(
                ranked_lists,
                k=self.rrf_k,
                limit=self.limit,
            )
        # 融合模式進日誌：線上要比對兩種模式的行為時，光看分數分不出來
        # （凸組合的 0.5 與 RRF 的 1/61 都只是數字），必須有這個欄位才能
        # 把一筆回覆歸到某一種融合。
        logger.info(
            "hybrid_retrieve vector=%d text=%d fused=%d fusion=%s",
            len(vector_docs),
            len(text_docs),
            len(fused),
            self.fusion_mode,
        )
        return fused

    async def _safe_invoke(self, retriever, name: str, query: str) -> list[Document]:
        limit = self.leg_timeout_seconds if self.leg_timeout_seconds > 0 else None
        deadline = asyncio.timeout(limit)
        try:
            async with deadline:
                return await retriever.ainvoke(query)
        except Exception:
            # 逾時與其他失敗分開記：逾時是「慢」（embedding 限流、Atlas 卡住），
            # 例外是「壞」（索引不存在、金鑰錯誤），兩者查的地方不同。
            if deadline.expired():
                logger.warning(
                    "hybrid_retrieve_timeout source=%s timeout_s=%s; degrading",
                    name,
                    self.leg_timeout_seconds,
                )
            else:
                logger.exception("hybrid_retrieve_failed source=%s; degrading", name)
            return []
