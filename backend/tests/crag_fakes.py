"""CRAG 測試共用替身（跟 ec 的 tests/gemini_offline.py 一樣是測試共用模組）。

Task 8（test_crag_web_search.py）與 Task 10（知識查詢入口的測試）都會 import
這裡的 `hit`、`FakeWebClient`、`TextLLM`——名稱、簽名照 task-8-brief.md 逐字搬，
不要另外加參數或改行為，避免兩個任務對同一個替身的假設不一致。
"""

from __future__ import annotations

from app.services.crag.web_client import ScrapedPage, WebSearchHit


def hit(url, description="", title="標題"):
    return WebSearchHit(title=title, url=url, description=description)


class FakeWebClient:
    def __init__(self, search_hits=None, pages=None):
        self.search_hits, self.pages = search_hits or {}, pages or {}
        self.search_calls, self.scrape_calls = [], []

    async def search(self, query, *, limit=5, include_domains=None):
        self.search_calls.append({"query": query, "limit": limit, "include_domains": include_domains})
        return list(self.search_hits.get(query, []))

    async def scrape(self, url):
        self.scrape_calls.append(url)
        return self.pages.get(url, "")

    async def scrape_page(self, url):
        return ScrapedPage(text=await self.scrape(url), final_url=url)


class TextLLM:
    def __init__(self, *replies):
        self.replies, self.prompts = list(replies), []

    async def atext(self, *, system, prompt, effort="medium"):
        self.prompts.append(prompt)
        return self.replies.pop(0)
