"""網搜回答：知識庫答不出來時，用 Firecrawl 搜尋公開網路資料再生成答案。

移植自 CARE `app/services/rag/web_search_service.py`（2026-09-14）。差異（James
2026-09-14 已確認的設計，見 context.md Global Constraints）：

- **不限網站**：拿掉 CARE 的 `site:gov.tw` 篩選與 `is_allowed_url` 白名單比對，
  中文那一路查整個公開網路；英文那一路也不限網域（CARE 用 `en_search_domains`
  建構子參數限定 nih.gov／medlineplus.gov，這裡拿掉這個參數，`include_domains`
  一律傳 `None`），改成只要改寫結果有 `en_terms` 就跑。
- 模型呼叫改用 `app.llm.LLM.atext`（拿掉 LangChain 與 Gemini `chat_model`）。
- 回傳結構化的 `WebAnswer`（`answer`／`sources`／`fail_code`／`docs_found`），
  不再把來源清單接在答案文字後面——MEDDEMO 畫面另外列出處。
- 拿掉「網路答案收進知識庫」（`_maybe_create_knowledge_report`、
  `_extract_source_urls`、`on_web_fallback_success`、LINE user id）：那是
  下一個案子才做的功能，這一版建構子沒有這個參數。
- 拿掉 i18n（`t()`、`set_request_language`）：MEDDEMO 固定繁體中文。
- 拿掉 `stage_timer`（那是 CARE request-scoped 的分段計時基礎設施，MEDDEMO
  沒有對應的機制），改成單純的 `logger.info` 記錄命中筆數／scrape 次數／
  文件數，供之後量測延遲用。
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from app.llm import LLM
from app.services.crag.cannot_answer import (
    CANNOT_ANSWER_MARKERS,
    NO_ANSWER_SENTINEL,
    answer_preview,
    matched_cannot_answer_marker,
)
from app.services.crag.documents import Document
from app.services.crag.fail_codes import FailCode
from app.services.crag.link_check import LinkChecker, dead_urls
from app.services.crag.prompts import ANSWER_SYSTEM, WEB_ANSWER_PREFIX, build_web_prompt, wrap_context
from app.services.crag.rewriter import RewrittenQuery
from app.services.crag.urls import normalize_url
from app.services.crag.web_client import WebSearchClient, WebSearchHit

logger = logging.getLogger(__name__)

CITE_TOP_K = 3  # 照搬 CARE（web_search_service.py）：來源清單最多列幾筆，交錯合併的名額也用這個數字
# WEB_ANSWER_PREFIX 定義在 prompts.py（成功答案的開頭字樣）；上面 import 時已帶進本模組命名空間，
# 這裡不重新定義，避免兩處常數漂移。
WEB_SEARCH_LIMIT = 8  # 照搬 CARE（web_search_service.py）：中文那一路的搜尋筆數上限
WEB_PAGE_CHAR_LIMIT = 8000  # 照搬 CARE（web_search_service.py）：單頁擷取內容的字數上限
# search snippet 達此長度就不打 scrape（避免逾時拖垮整輪）。照搬 CARE（web_search_service.py）
WEB_SNIPPET_MIN_CHARS = 20


@dataclass
class WebAnswer:
    answer: str | None
    sources: list[dict[str, Any]]
    fail_code: FailCode | None
    docs_found: int


def _domain(url: str) -> str:
    """網址的 host，供顯示用。剖析不出來就退回原始字串（理論上不會發生——
    進到這裡的 url 都已經是 `normalize_url` 正規化過的合法網址）。"""
    return urlsplit(url).hostname or url


def web_source(doc: Document, index: int) -> dict[str, Any]:
    """把一份網搜文件轉成畫面顯示用的來源欄位。

    `doc_title｜section` 是給語音問答顯示的組合（沿用 `app.services.documents`
    既有的 `f"{doc_title}｜{section}"` 慣例）；網搜沒有「機構名」這種欄位，
    `section`／`source_name` 都用網域頂替——沒有標題的頁面也至少有網域可看。
    """
    url = str(doc.metadata.get("url") or "")
    title = str(doc.metadata.get("title") or "").strip()
    domain = _domain(url)
    return {
        "kind": "web",
        "index": index,
        "doc_title": title or url,
        "section": domain,
        "url": url,
        "source_name": domain,
        "content": doc.page_content[:300],
    }


def _interleave(doc_lists: Sequence[list[Document]], *, limit: int) -> list[Document]:
    """各路輪流取一份、網址去重，取滿 *limit* 為止。

    交錯而不串接：串接的話中文那一路會吃滿全部名額，而罕見情況正是中文那路
    搜到不相關內容、英文那路才有正解的情況。名額維持 CITE_TOP_K 而不是兩路
    相加：來源清單只列前 CITE_TOP_K 份，多給生成的文件會被引用成清單上沒有
    的編號。（照搬 CARE web_search_service.py，逐字保留原始理由）
    """
    merged: list[Document] = []
    seen: set[str] = set()
    depth = max((len(docs) for docs in doc_lists), default=0)
    for rank in range(depth):
        for docs in doc_lists:
            if rank >= len(docs):
                continue
            doc = docs[rank]
            url = str(doc.metadata.get("url") or "")
            if url in seen:
                continue
            seen.add(url)
            merged.append(doc)
            if len(merged) >= limit:
                return merged
    return merged


class WebSearchService:
    def __init__(
        self,
        llm: LLM,
        web_client: WebSearchClient | None,
        link_checker: LinkChecker | None = None,
    ) -> None:
        self._llm = llm
        self.web_client = web_client
        # None＝不檢查來源網址存活，行為與導入前完全相同（見 link_check.py）
        self.link_checker = link_checker

    async def answer(
        self, query: str, *, search_queries: RewrittenQuery | None = None
    ) -> WebAnswer:
        """*search_queries* 只決定「拿什麼去搜」；生成一律用原句 *query*。"""
        web_docs = await self._fetch_web_docs(query, search_queries)
        if not web_docs:
            logger.info("crag_web_fail code=%s", FailCode.WEB_EMPTY)
            return WebAnswer(answer=None, sources=[], fail_code=FailCode.WEB_EMPTY, docs_found=0)

        web_answer = await self._generate_answer(query, web_docs)
        if self._is_cannot_answer(web_answer):
            marker = matched_cannot_answer_marker(web_answer, CANNOT_ANSWER_MARKERS)
            preview = answer_preview(web_answer)
            logger.info(
                "crag_web_fail code=%s matched_marker=%s answer_preview=%s",
                FailCode.MODEL_REFUSE,
                marker,
                preview,
            )
            return WebAnswer(
                answer=None, sources=[], fail_code=FailCode.MODEL_REFUSE, docs_found=len(web_docs)
            )

        dead = await self._dead_source_urls(web_docs)
        sources = self._build_sources(web_docs, dead)
        annotated = f"{WEB_ANSWER_PREFIX}\n\n{web_answer}"
        logger.info("crag_web_answer docs=%d sources=%d", len(web_docs), len(sources))
        return WebAnswer(answer=annotated, sources=sources, fail_code=None, docs_found=len(web_docs))

    async def _dead_source_urls(self, docs: list[Document]) -> frozenset[str]:
        """判定哪些來源網址現在打不開。關閉或失敗時回空集合。

        網搜路徑的網址剛被 search／scrape 碰過，判死的比例本來就該遠低於
        知識庫路徑；留著這道檢查主要是不要把死連結顯示給使用者。
        """
        if self.link_checker is None:
            return frozenset()
        urls = [u for u in (self._doc_url(doc) for doc in docs) if u]
        if not urls:
            return frozenset()
        dead = await dead_urls(self.link_checker, urls)
        if dead:
            logger.info("crag_web_link_dead count=%d urls=%s", len(dead), sorted(dead))
        return dead

    @staticmethod
    def _doc_url(doc: Document) -> str:
        return str(doc.metadata.get("url") or "").strip()

    async def _generate_answer(self, question: str, docs: list[Document]) -> str:
        context = "\n".join(
            f"{idx}. {doc.page_content}" for idx, doc in enumerate(docs, start=1)
        )
        answer_text = await self._llm.atext(
            system=ANSWER_SYSTEM,
            prompt=build_web_prompt(question, wrap_context(context)),
            effort="medium",
        )
        # 空字串＝答不出來（LLM.atext 被擋或沒有候選回應時的約定），理由同
        # app.services.knowledge 的既有規則：不能把預設文案當答案送出。
        return answer_text or NO_ANSWER_SENTINEL

    async def _fetch_web_docs(
        self, query: str, search_queries: RewrittenQuery | None = None
    ) -> list[Document]:
        """中英兩路並行搜尋、交錯合併；兩路都沒有可用文件時以原句重搜一次。

        中文那一路：有改寫時用 zh_terms，沒有時沿用原句。英文那一路只在
        `search_queries.en_terms` 有值時才搜——不限網站後，跑不跑英文腿只
        看改寫有沒有給出英文關鍵字，不再看設定裡的網域清單。

        重搜是因為 Firecrawl 會隨機回 0 筆（照搬 CARE 的量測與理由：
        2026-09-12 同一查詢連打兩次，10 組裡有 2 組一次 0 筆、一次 5 筆）。
        重搜用原句，因為改寫過的關鍵字不一定比原句好搜；沒有改寫時就是同一
        句再搜一次。只在完全沒有可用文件時才重搜，所以多花的時間只落在原本
        就會失敗的題目上。
        """
        if self.web_client is None:
            return []
        zh_query = (search_queries.zh_terms if search_queries else "") or query
        en_query = search_queries.en_terms if search_queries is not None else ""

        legs = [self._search_leg("zh", zh_query)]
        if en_query:
            # 英文那一路只取 CITE_TOP_K 筆：交錯合併後它最多用到 2 份，多搜
            # 的只是多等，而兩路並行時整段是被較慢的那一路拖住。
            legs.append(self._search_leg("en", en_query, include_domains=None, limit=CITE_TOP_K))
        docs = _interleave(await asyncio.gather(*legs), limit=CITE_TOP_K)
        if docs:
            return docs
        return await self._search_leg("zh_retry", query)

    async def _search_leg(
        self,
        leg: str,
        query: str,
        *,
        include_domains: Sequence[str] | None = None,
        limit: int = WEB_SEARCH_LIMIT,
    ) -> list[Document]:
        assert self.web_client is not None
        try:
            hits = await self.web_client.search(query, limit=limit, include_domains=include_domains)
        except Exception:
            logger.info("crag_web_search leg=%s hits=error", leg)
            return []
        logger.info("crag_web_search leg=%s hits=%d", leg, len(hits))
        return await self._collect_web_docs(leg, hits)

    async def _collect_web_docs(self, leg: str, hits: list[WebSearchHit]) -> list[Document]:
        scrapes = 0
        docs: list[Document] = []
        seen: set[str] = set()
        for hit in hits:
            raw_url = (hit.url or "").strip()
            if not raw_url:
                continue
            # 先正規化再比對／去重／顯示：hit URL 可能帶 utm、大小寫不一，也
            # 可能是會造成解析歧異的字串（normalize_url 回 None）。
            url = normalize_url(raw_url)
            if url is None or url in seen:
                continue
            # 優先用 search snippet，避免 scrape 連逾時拖死整輪
            text = (hit.description or "").strip()
            if len(text) < WEB_SNIPPET_MIN_CHARS:
                scrapes += 1
                try:
                    scraped = (await self.web_client.scrape(url) or "").strip()
                except Exception:
                    scraped = ""
                if scraped:
                    text = scraped
            if not text:
                continue
            seen.add(url)
            docs.append(
                Document(
                    page_content=text[:WEB_PAGE_CHAR_LIMIT],
                    metadata={"title": (hit.title or "").strip(), "url": url},
                )
            )
            if len(docs) >= CITE_TOP_K:
                break
        logger.info(
            "crag_web_scrape leg=%s hits=%d scrapes=%d docs=%d", leg, len(hits), scrapes, len(docs)
        )
        return docs

    @staticmethod
    def _is_cannot_answer(text: str) -> bool:
        return matched_cannot_answer_marker(text, CANNOT_ANSWER_MARKERS) != "<none>"

    @staticmethod
    def _build_sources(docs: list[Document], dead: frozenset[str]) -> list[dict[str, Any]]:
        """把文件轉成結構化來源清單，沿用 CARE 的去重、判死跳過、最多 CITE_TOP_K 筆。

        判死的整筆不顯示，不像知識庫路徑那樣退回「只顯示來源名」：網搜來源
        的顯示名稱就是網域，拿掉連結後對使用者驗證沒有價值。
        """
        sources: list[dict[str, Any]] = []
        seen: set[str] = set()
        for doc in docs:
            if len(sources) >= CITE_TOP_K:
                break
            url = str(doc.metadata.get("url") or "").strip()
            if not url or url in seen or url in dead:
                continue
            seen.add(url)
            sources.append(web_source(doc, len(sources) + 1))
        return sources
