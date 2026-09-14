"""RAG rerank：Cohere Rerank API，失敗或無 key 時以向量分數降級。"""

from __future__ import annotations

import logging
import time
from typing import Any, Protocol

import httpx

from app.services.crag.documents import Document

logger = logging.getLogger(__name__)

COHERE_RERANK_URL = "https://api.cohere.com/v2/rerank"

# 照搬 CARE config 的 COHERE_RERANK_MODEL
COHERE_RERANK_MODEL = "rerank-v4.0-pro"

# 照搬 CARE config 的 COHERE_RERANK_TIMEOUT_SECONDS
COHERE_RERANK_TIMEOUT_SECONDS = 5.0


def rerank_document_text(doc: Document) -> str:
    """組出送進 reranker 的文本。

    MEDDEMO：文件段落內容已以「文件標題｜小節」開頭（`documents.chunk_text`），
    metadata 無 original_title。函式會原樣回傳內容。
    """
    content = doc.page_content or ""
    title = str(doc.metadata.get("original_title") or "").strip()
    if not title:
        return content
    return f"主題：{title}\n內容：{content}"


class Reranker(Protocol):
    async def rerank(
        self, query: str, docs: list[Document], *, top_n: int
    ) -> list[Document]: ...


class VectorScoreReranker:
    """依既有向量 score 排序後取 top_n（無 Cohere / API 失敗時的降級）。"""

    async def rerank(
        self, query: str, docs: list[Document], *, top_n: int
    ) -> list[Document]:
        del query  # unused; interface parity
        if not docs or top_n <= 0:
            return []
        ranked = sorted(
            docs,
            key=lambda d: float(d.metadata.get("score") or 0.0),
            reverse=True,
        )
        out: list[Document] = []
        for i, doc in enumerate(ranked[:top_n], start=1):
            meta = {**doc.metadata, "rerank_rank": i}
            out.append(Document(page_content=doc.page_content, metadata=meta))
        return out


async def _default_http_post(
    url: str,
    *,
    headers: dict[str, str],
    json: dict[str, Any],
    timeout: float,
) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, headers=headers, json=json)
        resp.raise_for_status()
        return resp.json()


class CohereReranker:
    """呼叫 Cohere Rerank API；任何失敗則降級為 VectorScoreReranker。"""

    def __init__(
        self,
        *,
        api_key: str,
        model: str = COHERE_RERANK_MODEL,
        timeout_seconds: float = COHERE_RERANK_TIMEOUT_SECONDS,
        http_post=_default_http_post,
        fallback: Reranker | None = None,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._timeout = timeout_seconds
        self._http_post = http_post
        self._fallback = fallback or VectorScoreReranker()

    async def rerank(
        self, query: str, docs: list[Document], *, top_n: int
    ) -> list[Document]:
        if not docs or top_n <= 0:
            return []
        if not self._api_key:
            return await self._fallback.rerank(query, docs, top_n=top_n)

        documents = [rerank_document_text(d) for d in docs]
        payload = {
            "model": self._model,
            "query": query,
            "documents": documents,
            "top_n": min(top_n, len(documents)),
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        # 只圈住 HTTP 呼叫，讓 ms 就是 Cohere 的純延遲（外層 rag_rerank
        # 含降級）。outcome 預設 error、成功才改寫成 ok：逾時會被下面的
        # except 吞掉並靜靜降級，少了這個欄位，log 上只看得到「精排花了
        # 20 秒」，看不出那 20 秒是等到結果還是白等一場逾時。
        t_start = time.perf_counter()
        try:
            outcome = "error"
            data = await self._http_post(
                COHERE_RERANK_URL,
                headers=headers,
                json=payload,
                timeout=self._timeout,
            )
            outcome = "ok"
            t_end = time.perf_counter()
            ms = int((t_end - t_start) * 1000)
            logger.info(
                "cohere_rerank docs=%d ms=%d outcome=%s",
                len(documents),
                ms,
                outcome,
            )
            results = data.get("results") or []
            out: list[Document] = []
            for rank, item in enumerate(results, start=1):
                idx = int(item["index"])
                if idx < 0 or idx >= len(docs):
                    continue
                src = docs[idx]
                meta = {
                    **src.metadata,
                    "rerank_score": float(item.get("relevance_score") or 0.0),
                    "rerank_rank": rank,
                }
                out.append(Document(page_content=src.page_content, metadata=meta))
            if out:
                return out
            logger.warning("Cohere rerank returned empty results; falling back")
        except Exception:
            t_end = time.perf_counter()
            ms = int((t_end - t_start) * 1000)
            logger.info(
                "cohere_rerank docs=%d ms=%d outcome=%s",
                len(documents),
                ms,
                "error",
            )
            logger.exception("Cohere rerank failed; falling back to vector scores")
        return await self._fallback.rerank(query, docs, top_n=top_n)
