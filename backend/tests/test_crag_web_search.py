"""網搜回答單元測試（Firecrawl／LLM 以 DI 注入的替身取代，禁止 monkey patch）。

照搬 CARE `tests/unit/services/rag/test_web_search_service.py`（756 行、30 個
測試）。CARE 用 LangChain 假模型（`MagicMock` + `AIMessage`）的地方一律改成
`crag_fakes.TextLLM`；`FakeWebClient` 改用 `crag_fakes.FakeWebClient`（依
query 分流命中結果，簽名見 crag_fakes.py）。

計數對帳：CARE 30 個測試 = 10 個刪掉（見下）＋ 1 個併入必要測試、不留獨立
測試（`test_rewritten_queries_search_zh_and_en_legs`）＋ 19 個保留（改名／
調整斷言對象，含 1 個改名的 `test_en_leg_searches_only_cite_top_k_results`）。
本檔 24 個測試 = 上述 19 個保留 ＋ 2 個任務說明列的必要測試（brief 逐字給的
`test_chinese_leg_...`／`test_english_leg_...`，取代原本靠 `site:gov.tw`／
`en_search_domains` 驗證中英兩路的舊測試）＋ 3 個 MEDDEMO 新增（`web_source()`
與 `docs_found` 欄位 CARE 沒有對應功能；判死後出處編號不重新連號，行為與 CARE
不同）。

刪掉的測試與原因（白名單、site: 篩選、知識回報、i18n 整組移除，MEDDEMO
不做「網路答案收進知識庫」——那是下一個案子；共 10 個）：
- `test_answer_uses_whitelisted_web_docs`：斷言建立在 `forum.example` 被白
  名單擋掉、`site:gov.tw` 篩選；MEDDEMO 不限網站，場景不存在。行為由必要
  測試 `test_chinese_leg_searches_the_whole_web_without_a_site_filter` 與
  `test_sources_have_ascending_index_and_kind_web` 取代。
- `test_answer_does_not_duplicate_existing_site_filter`：測 site: 篩選不
  重複疊加；整個 site: 篩選機制已移除。
- `test_answer_localizes_web_source_label_and_prefix`：i18n／語言參數整段
  移除（MEDDEMO 固定繁體中文，`answer()` 沒有 language 參數）。
- `test_answer_success_calls_create_from_web_fallback`、
  `test_answer_web_empty_does_not_create_knowledge_report`、
  `test_answer_model_refuse_does_not_create_knowledge_report`、
  `test_answer_missing_line_user_id_skips_create_but_returns_answer`、
  `test_answer_create_failure_still_returns_answer`、
  `test_dead_url_never_reaches_knowledge_report`：都在測
  `on_web_fallback_success`／LINE user id／知識回報；`WebSearchService`
  建構子沒有這個參數，功能不存在。
- `test_web_answer_without_usable_url_clears_sources`：原測「沒有可用 url
  時清空來源」；MEDDEMO 的 `Document` 只有在 `normalize_url` 成功時才會被
  `_collect_web_docs` 建立出來（見該函式），來源清單結構上就不會出現無 url
  的項目，這條防線已由 `test_hit_with_divergent_url_is_skipped` 涵蓋。
- `rag_sources_holder` fixture：伴隨 `set_request_rag_sources` 一併移除，
  MEDDEMO 用回傳值 `WebAnswer.sources`（list[dict]）取代請求級全域狀態。

併入必要測試、不重複移植（斷言改寫成不比對 `site:` 字串／英文網域設定）：
- `test_rewritten_queries_search_zh_and_en_legs`：併入必要測試
  `test_chinese_leg_searches_the_whole_web_without_a_site_filter` 與
  `test_english_leg_runs_whenever_there_are_english_terms`。
- `test_en_leg_searches_only_cite_top_k_results`：改名
  `test_zh_leg_uses_full_search_limit_while_en_leg_uses_cite_top_k`，同時
  驗中文腿 limit=WEB_SEARCH_LIMIT。

保留（改名或調整斷言對象：CARE 回傳字串、這裡改回傳結構化 `WebAnswer`，
「字串包含 X」的斷言改成對 `result.answer`／`result.sources`／`result.fail_code`
欄位斷言，驗的行為不變）：
- `test_answer_prefers_search_description_without_scrape` →
  `test_scrape_is_skipped_when_snippet_is_long_enough`
- `test_answer_scrapes_when_description_too_short` →
  `test_scrapes_when_snippet_too_short`
- `test_answer_returns_no_answer_when_web_empty` →
  `test_answer_returns_web_empty_when_no_docs_found`
- `test_answer_degrades_when_web_client_raises` →
  `test_search_error_degrades_to_web_empty`
- `test_answer_returns_no_answer_when_web_client_missing` →
  `test_answer_returns_web_empty_when_web_client_is_none`
- `test_answer_logs_model_refuse_diagnostics` →
  `test_model_refuse_logs_diagnostics`
- `test_answer_returns_no_answer_when_model_cannot_answer` →
  `test_model_refuse_returns_fail_code_and_no_sources`
- `test_skips_hit_with_parser_divergent_url` →
  `test_hit_with_divergent_url_is_skipped`
- `test_document_url_is_normalized` → `test_source_url_is_normalized`
- `test_web_answer_exposes_structured_sources` →
  `test_sources_have_ascending_index_and_kind_web`（斷言改讀
  `result.sources`，不再讀 `get_request_rag_sources()`）
- `test_dead_url_is_dropped_from_web_sources` →
  `test_dead_source_is_dropped_from_sources`
- `test_sources_unchanged_when_link_checker_absent` →
  `test_source_shown_when_link_checker_absent`
- `test_legs_are_interleaved_so_en_results_are_not_crowded_out` →
  `test_legs_interleave_so_en_results_are_not_crowded_out`
- `test_generation_and_report_use_original_question` →
  `test_generation_uses_original_question_not_rewritten_query`（知識回報
  斷言拿掉，其餘不變）
- `test_en_leg_skipped_without_domains_or_terms` →
  `test_en_leg_skipped_when_no_en_terms`（不再有網域設定這個變因，只看
  `en_terms` 有沒有值）
- `test_retries_with_original_question_when_no_docs` →
  `test_retry_uses_original_question_when_no_docs_found`
- `test_no_retry_when_first_round_has_docs` →
  `test_no_retry_when_first_round_finds_docs`
- `test_empty_model_output_is_treated_as_refusal`：原樣保留

新增（MEDDEMO 專屬，CARE 沒有對應測試）：
- `test_web_source_fields`：直接測 `web_source()`——`doc_title` 沒標題時
  退回網址、`section`／`source_name` 是網域、`content` 截斷前 300 字。
- `test_docs_found_reflects_fetched_doc_count_on_success`：`WebAnswer.
  docs_found` 欄位（CARE 沒有這個欄位，是任務說明新增的）。
- `test_source_index_stays_the_number_the_answer_cites_when_an_earlier_source_is_dead`：
  判死的出處不列、其餘不重新連號（CARE 會重新連號，答案內文的 [n] 卻沒跟著改，
  見 `WebSearchService._build_sources`）。
"""

from __future__ import annotations

import pytest

from app.services.crag.fail_codes import FailCode
from app.services.crag.rewriter import RewrittenQuery
from app.services.crag.web_search import (
    CITE_TOP_K,
    WEB_ANSWER_PREFIX,
    WEB_SEARCH_LIMIT,
    WebAnswer,
    WebSearchService,
    web_source,
)
from tests.crag_fakes import FakeWebClient, TextLLM, hit


class FakeLinkChecker:
    """把指定網址判死，其餘判活。記錄被查過哪些網址（照搬 CARE 測試檔同名替身）。"""

    def __init__(self, dead=()):
        self._dead = set(dead)
        self.checked: list[str] = []

    async def alive(self, urls):
        urls = list(urls)
        self.checked.extend(urls)
        return {url: url not in self._dead for url in urls}


class RaisingWebClient(FakeWebClient):
    """search() 一律拋錯；只在本檔案內用來測降級路徑，不放進 crag_fakes.py
    （crag_fakes.FakeWebClient 的簽名要跟 task-8-brief.md 逐字一致）。"""

    async def search(self, query, *, limit=5, include_domains=None):
        self.search_calls.append({"query": query, "limit": limit, "include_domains": include_domains})
        raise RuntimeError("boom")


# --- 任務說明列出的必要測試（逐字照抄） ---


async def test_chinese_leg_searches_the_whole_web_without_a_site_filter():
    client = FakeWebClient(search_hits={"近效期 退貨": [hit("https://example.com/a", "近效期退貨說明" * 3)]})
    service = WebSearchService(TextLLM("可以退 [1]。"), client)
    result = await service.answer("效期快到可以退嗎", search_queries=RewrittenQuery("近效期退貨", "近效期 退貨", ""))
    assert client.search_calls[0]["query"] == "近效期 退貨"
    assert client.search_calls[0]["include_domains"] is None
    assert result.answer.startswith(WEB_ANSWER_PREFIX)
    assert result.sources[0]["url"] == "https://example.com/a"


async def test_english_leg_runs_whenever_there_are_english_terms():
    client = FakeWebClient(search_hits={
        "近效期 退貨": [],
        "near expiry returns": [hit("https://example.org/en", "Near-expiry returns policy " * 3)],
    })
    service = WebSearchService(TextLLM("可以退 [1]。"), client)
    result = await service.answer(
        "效期快到可以退嗎", search_queries=RewrittenQuery("近效期退貨", "近效期 退貨", "near expiry returns")
    )
    en_call = next(call for call in client.search_calls if call["query"] == "near expiry returns")
    assert en_call["include_domains"] is None and en_call["limit"] == CITE_TOP_K
    assert result.sources[0]["url"] == "https://example.org/en"


# --- 照搬 CARE 專屬測試，例句改成 MEDDEMO 業務情境 ---


@pytest.mark.asyncio
async def test_scrape_is_skipped_when_snippet_is_long_enough():
    client = FakeWebClient(
        search_hits={"近效期退貨規定": [hit("https://example.com/a", "近效期退貨的說明文字，長度足夠不必抓全文" * 2)]},
        pages={"https://example.com/a": "完整內文不會被用到"},
    )
    service = WebSearchService(TextLLM("近效期可以退貨。"), client)
    result = await service.answer("近效期退貨規定")
    assert result.answer.startswith(WEB_ANSWER_PREFIX)
    assert client.scrape_calls == []  # snippet 夠長就不 scrape


@pytest.mark.asyncio
async def test_scrapes_when_snippet_too_short():
    client = FakeWebClient(
        search_hits={"近效期退貨規定": [hit("https://example.com/a", "短")]},
        pages={"https://example.com/a": "近效期品項退貨須在效期剩餘六個月以前提出申請。"},
    )
    service = WebSearchService(TextLLM("近效期可以退貨。"), client)
    result = await service.answer("近效期退貨規定")
    assert client.scrape_calls == ["https://example.com/a"]
    assert result.sources[0]["url"] == "https://example.com/a"


@pytest.mark.asyncio
async def test_answer_returns_web_empty_when_no_docs_found():
    client = FakeWebClient()
    llm = TextLLM()
    service = WebSearchService(llm, client)
    result = await service.answer("完全查不到的問題")
    assert result == WebAnswer(answer=None, sources=[], fail_code=FailCode.WEB_EMPTY, docs_found=0)
    assert llm.prompts == []  # 沒有文件就不呼叫模型


@pytest.mark.asyncio
async def test_search_error_degrades_to_web_empty():
    client = RaisingWebClient()
    result = await WebSearchService(TextLLM(), client).answer("問題")
    assert result.fail_code is FailCode.WEB_EMPTY
    assert result.answer is None


@pytest.mark.asyncio
async def test_answer_returns_web_empty_when_web_client_is_none():
    llm = TextLLM()
    result = await WebSearchService(llm, None).answer("問題")
    assert result == WebAnswer(answer=None, sources=[], fail_code=FailCode.WEB_EMPTY, docs_found=0)
    assert llm.prompts == []


@pytest.mark.asyncio
async def test_model_refuse_logs_diagnostics(caplog):
    answer_content = "[NO_ANSWER] 查不到這項規定的說明。"
    client = FakeWebClient(search_hits={"折扣審核規定": [hit("https://example.com/a", "折扣審核相關說明文字，長度足夠不必抓全文")]})
    service = WebSearchService(TextLLM(answer_content), client)
    with caplog.at_level("INFO"):
        result = await service.answer("折扣審核規定")
    assert result.fail_code is FailCode.MODEL_REFUSE
    refuse_logs = [rec.getMessage() for rec in caplog.records if "code=MODEL_REFUSE" in rec.getMessage()]
    assert len(refuse_logs) == 1
    assert "matched_marker=[NO_ANSWER]" in refuse_logs[0]
    assert f"answer_preview={answer_content}" in refuse_logs[0]


@pytest.mark.asyncio
async def test_model_refuse_returns_fail_code_and_no_sources():
    client = FakeWebClient(search_hits={"折扣審核規定": [hit("https://example.com/a", "折扣審核相關說明文字，長度足夠不必抓全文")]})
    service = WebSearchService(TextLLM("[NO_ANSWER] 查不到這項規定的說明。"), client)
    result = await service.answer("折扣審核規定")
    assert result.answer is None
    assert result.sources == []
    assert result.fail_code is FailCode.MODEL_REFUSE
    assert result.docs_found == 1  # 找到文件了，只是模型拒答


@pytest.mark.asyncio
async def test_hit_with_divergent_url_is_skipped():
    """hit URL 為反斜線繞過字串時 normalize_url 回 None，不進 Document（本 change 核心迴歸）。"""
    client = FakeWebClient(
        search_hits={"問題": [hit("https://evil.com\\.gov.tw/x", "足夠長的敘述文字，確保就算沒被擋也不會走到 scrape 分支。")]}
    )
    llm = TextLLM()
    result = await WebSearchService(llm, client).answer("問題")
    assert result.fail_code is FailCode.WEB_EMPTY
    assert client.scrape_calls == []
    assert llm.prompts == []


@pytest.mark.asyncio
async def test_source_url_is_normalized():
    """合法但帶 utm／大寫的 hit，來源的 url 是正規化字串；scrape 也是打正規化後的字串。"""
    raw_url = "HTTPS://EXAMPLE.COM/a?utm_source=line&nodeid=1"
    normalized_url = "https://example.com/a?nodeid=1"
    client = FakeWebClient(
        search_hits={"問題": [hit(raw_url, "短")]},
        pages={normalized_url: "近效期品項退貨須在效期剩餘六個月以前提出申請。"},
    )
    result = await WebSearchService(TextLLM("可以退貨 [1]。"), client).answer("問題")
    assert result.sources[0]["url"] == normalized_url
    assert client.scrape_calls == [normalized_url]


@pytest.mark.asyncio
async def test_sources_have_ascending_index_and_kind_web():
    """成功答案要有結構化來源，index 由 1 起算、與答案裡引用的編號一致。"""
    client = FakeWebClient(
        search_hits={
            "近效期退貨": [
                hit("https://example.com/a", "近效期退貨規定說明文字，長度足夠不必抓全文", title="退貨規範"),
                hit("https://example.org/b", "折扣審核規定說明文字，長度足夠不必抓全文", title="折扣規範"),
            ]
        }
    )
    result = await WebSearchService(TextLLM("請依規定辦理 [1][2]。"), client).answer("近效期退貨")
    assert [s["index"] for s in result.sources] == [1, 2]
    assert [s["kind"] for s in result.sources] == ["web", "web"]
    assert [s["url"] for s in result.sources] == ["https://example.com/a", "https://example.org/b"]
    assert result.sources[0]["doc_title"] == "退貨規範"


@pytest.mark.asyncio
async def test_dead_source_is_dropped_from_sources():
    """判死的來源整筆不顯示：MEDDEMO 沒有「保留來源名」的退場路徑（來源名就是網域，拿掉連結後沒有價值）。"""
    dead = "https://dead.example.com/x"
    alive = "https://example.com/a"
    client = FakeWebClient(
        search_hits={
            "腳痛怎麼辦": [
                hit(dead, "腳痛的常見原因說明文字，長度足夠不必抓全文"),
                hit(alive, "足部保健的日常照護建議，長度足夠不必抓全文"),
            ]
        }
    )
    service = WebSearchService(TextLLM("請就醫評估 [1]。"), client, link_checker=FakeLinkChecker(dead=[dead]))
    result = await service.answer("腳痛怎麼辦")
    urls = [s["url"] for s in result.sources]
    assert dead not in urls
    assert alive in urls


@pytest.mark.asyncio
async def test_source_shown_when_link_checker_absent():
    """未注入 checker 時行為與導入這個功能之前完全相同：不檢查存活，照常顯示。"""
    url = "https://maybe-dead.example.com/x"
    client = FakeWebClient(search_hits={"腳痛怎麼辦": [hit(url, "腳痛的常見原因說明文字，長度足夠不必抓全文")]})
    result = await WebSearchService(TextLLM("請就醫評估 [1]。"), client).answer("腳痛怎麼辦")
    assert result.sources[0]["url"] == url


@pytest.mark.asyncio
async def test_legs_interleave_so_en_results_are_not_crowded_out():
    """罕見情境：中文那路全是不相關內容時，英文那路的正解仍要擠進前 CITE_TOP_K。"""
    zh_hits = [
        hit("https://zh1.example.com/a", "不相關的中文說明文字，長度足夠不必抓全文", title="不相關甲"),
        hit("https://zh2.example.com/b", "不相關的中文說明文字，長度足夠不必抓全文", title="不相關乙"),
        hit("https://zh3.example.com/c", "不相關的中文說明文字，長度足夠不必抓全文", title="不相關丙"),
    ]
    en_hits = [
        hit("https://en1.example.com/a", "正確的英文說明文字，長度足夠不必抓全文", title="正解甲"),
        hit("https://en2.example.com/b", "正確的英文說明文字，長度足夠不必抓全文", title="正解乙"),
    ]
    client = FakeWebClient(search_hits={"近效期退貨關鍵字": zh_hits, "near expiry return terms": en_hits})
    service = WebSearchService(
        TextLLM("依規定辦理 [1][2]。"),
        client,
    )
    rewritten = RewrittenQuery(
        kb_query="近效期退貨規定是什麼？", zh_terms="近效期退貨關鍵字", en_terms="near expiry return terms"
    )
    result = await service.answer("近效期的貨可以退嗎", search_queries=rewritten)
    urls = [s["url"] for s in result.sources]
    # 交錯合併：中→英→中，名額維持 CITE_TOP_K（3），不是兩路相加
    assert urls == ["https://zh1.example.com/a", "https://en1.example.com/a", "https://zh2.example.com/b"]
    assert "https://en2.example.com/b" not in urls


@pytest.mark.asyncio
async def test_generation_uses_original_question_not_rewritten_query():
    """改寫只決定拿什麼去搜；生成回答用的仍是使用者的原句。"""
    client = FakeWebClient(
        search_hits={"near expiry return terms": [hit("https://en1.example.com/a", "正確的英文說明文字，長度足夠不必抓全文")]}
    )
    llm = TextLLM("依規定辦理 [1]。")
    rewritten = RewrittenQuery(kb_query="近效期退貨規定是什麼？", zh_terms="", en_terms="near expiry return terms")
    await WebSearchService(llm, client).answer("近效期的貨可以退嗎", search_queries=rewritten)
    assert "近效期的貨可以退嗎" in llm.prompts[0]
    assert "近效期退貨規定是什麼？" not in llm.prompts[0]


@pytest.mark.asyncio
async def test_en_leg_skipped_when_no_en_terms():
    client = FakeWebClient(search_hits={"近效期退貨": [hit("https://example.com/a", "近效期退貨規定說明文字，長度足夠不必抓全文")]})
    await WebSearchService(TextLLM("依規定辦理 [1]。"), client).answer(
        "近效期的貨可以退嗎", search_queries=RewrittenQuery(kb_query="近效期退貨規定", zh_terms="近效期退貨")
    )
    assert len(client.search_calls) == 1  # 只有中文那一路；中文腿有結果，也不會觸發重搜
    assert client.search_calls[0]["query"] == "近效期退貨"


@pytest.mark.asyncio
async def test_retry_uses_original_question_when_no_docs_found():
    """Firecrawl 會隨機回 0 筆；兩路都沒有可用文件時，以原句再搜一次。"""
    client = FakeWebClient(
        search_hits={"折扣審核規定": [hit("https://example.com/a", "折扣審核相關說明文字，長度足夠不必抓全文")]}
    )
    result = await WebSearchService(TextLLM("依規定辦理 [1]。"), client).answer(
        "折扣審核規定", search_queries=RewrittenQuery(kb_query="折扣審核規定是什麼？", zh_terms="折扣審核關鍵字")
    )
    # 第一輪用改寫詞（折扣審核關鍵字，無 en_terms 所以只有中文一腿）沒有結果，才會重搜
    assert [call["query"] for call in client.search_calls] == ["折扣審核關鍵字", "折扣審核規定"]
    assert client.search_calls[-1]["query"] == "折扣審核規定"  # 重搜用原句，不是改寫詞
    assert result.sources[0]["url"] == "https://example.com/a"


@pytest.mark.asyncio
async def test_no_retry_when_first_round_finds_docs():
    client = FakeWebClient(search_hits={"近效期退貨": [hit("https://example.com/a", "近效期退貨規定說明文字，長度足夠不必抓全文")]})
    await WebSearchService(TextLLM("依規定辦理 [1]。"), client).answer("近效期退貨")
    assert client.search_calls == [{"query": "近效期退貨", "limit": WEB_SEARCH_LIMIT, "include_domains": None}]


@pytest.mark.asyncio
async def test_zh_leg_uses_full_search_limit_while_en_leg_uses_cite_top_k():
    client = FakeWebClient()
    rewritten = RewrittenQuery(kb_query="q", zh_terms="近效期 退貨", en_terms="near expiry returns")
    await WebSearchService(TextLLM(), client).answer("q", search_queries=rewritten)
    limits = [(call["include_domains"], call["limit"]) for call in client.search_calls[:2]]
    assert limits == [(None, WEB_SEARCH_LIMIT), (None, CITE_TOP_K)]


@pytest.mark.asyncio
async def test_empty_model_output_is_treated_as_refusal():
    """模型回空字串時（LLM.atext 被擋或沒有候選回應的約定）不能把空字串當答案送出。"""
    client = FakeWebClient(search_hits={"近效期退貨": [hit("https://example.com/a", "近效期退貨規定說明文字，長度足夠不必抓全文")]})
    result = await WebSearchService(TextLLM(""), client).answer("近效期退貨")
    assert result.fail_code is FailCode.MODEL_REFUSE
    assert result.answer is None


# --- MEDDEMO 新增：web_source()、docs_found 欄位、判死後的出處編號 ---


@pytest.mark.asyncio
async def test_source_index_stays_the_number_the_answer_cites_when_an_earlier_source_is_dead():
    """出處編號是交給模型時的位置：[1] 判死不列，其餘不重新連號，畫面上的 [2] 才會是內文的 [2]。"""
    dead = "https://dead.example.com/x"
    client = FakeWebClient(
        search_hits={
            "近效期退貨": [
                hit(dead, "已下架頁面的說明文字，長度足夠不必抓全文", title="已下架"),
                hit("https://example.com/a", "近效期退貨規定說明文字，長度足夠不必抓全文", title="退貨規範"),
                hit("https://example.org/b", "折扣審核規定說明文字，長度足夠不必抓全文", title="折扣規範"),
            ]
        }
    )
    service = WebSearchService(TextLLM("請依規定辦理 [2][3]。"), client, link_checker=FakeLinkChecker(dead=[dead]))
    result = await service.answer("近效期退貨")
    assert [(s["index"], s["url"]) for s in result.sources] == [
        (2, "https://example.com/a"),
        (3, "https://example.org/b"),
    ]
    assert result.answer.endswith("請依規定辦理 [2][3]。")  # 內文的編號不動


def test_web_source_fields():
    from app.services.crag.documents import Document

    with_title = Document(page_content="內容" * 200, metadata={"url": "https://example.com/a", "title": "退貨規範"})
    without_title = Document(page_content="短內容", metadata={"url": "https://example.org/b", "title": ""})

    src1 = web_source(with_title, 1)
    assert src1 == {
        "kind": "web",
        "index": 1,
        "doc_title": "退貨規範",
        "section": "example.com",
        "url": "https://example.com/a",
        "source_name": "example.com",
        "content": ("內容" * 200)[:300],
    }
    assert len(src1["content"]) == 300

    src2 = web_source(without_title, 2)
    assert src2["doc_title"] == "https://example.org/b"  # 沒標題就退回網址
    assert src2["section"] == "example.org"
    assert src2["content"] == "短內容"


@pytest.mark.asyncio
async def test_docs_found_reflects_fetched_doc_count_on_success():
    client = FakeWebClient(
        search_hits={
            "近效期退貨": [
                hit("https://example.com/a", "近效期退貨規定說明文字，長度足夠不必抓全文"),
                hit("https://example.org/b", "折扣審核規定說明文字，長度足夠不必抓全文"),
            ]
        }
    )
    result = await WebSearchService(TextLLM("依規定辦理 [1][2]。"), client).answer("近效期退貨")
    assert result.docs_found == 2
