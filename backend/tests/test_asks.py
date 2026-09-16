"""第四週：反覆查詢（數字題）與 CRAG（知識題）。

AI 模型用照劇本回應的替身；資料庫權限、SQL 執行、關鍵字檢索、Redis 佇列與背景工作都是真的。
"""

import asyncio
import datetime as dt
import time
from collections import Counter

import pytest
from fastapi.testclient import TestClient
from rq import SimpleWorker
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import NotConfigured
from app.main import app
from app.services import asks as asks_service
from app.services import knowledge
from app.services.crag.answer_service import RagOutcome
from app.services.crag.fail_codes import FailCode
from app.services.crag.web_search import WebSearchService
from app.services.data_agent import answer_data
from app.services.knowledge import answer_knowledge
from app.services.retrieval import keyword_tokens
from app.services.sql_executor import QueryRejected, run_readonly
from app.tasks import redis, visit_queue
from crag_fakes import FakeWebClient, hit

TODAY = dt.date(2026, 10, 28)

NORTH_SUPPLEMENT_SQL = """
SELECT customer_name, sum(amount) AS amount FROM v_monthly_sales
WHERE region = '北區' AND category = '保健品' AND month >= date_trunc('month', app_today()) - interval '2 months'
GROUP BY customer_name ORDER BY amount DESC LIMIT 5
"""
FISH_OIL_SQL = """
SELECT product_name, sum(amount) AS amount FROM v_monthly_sales
WHERE customer_name = '康泰連鎖藥局 · 忠孝店' AND category = '保健品'
GROUP BY product_name ORDER BY amount DESC
"""


class ScriptedLLM:
    """依回應格式分開排隊，各自照順序回傳預先寫好的回應。

    不照呼叫順序排：檢索一段都沒找到時不會呼叫「評估」，呼叫順序會跟著資料變。
    """

    KIND_BY_FIELD = {"grade": "grade", "kb_query": "rewrite", "action": "step", "blocked_reason": "final"}

    def __init__(self, **queues):
        self.queues = {kind: list(items) for kind, items in queues.items()}
        self.prompts = []
        self.calls = Counter()

    def json(self, *, system, prompt, schema, **_):
        kind = next(kind for field, kind in self.KIND_BY_FIELD.items() if field in schema["required"])
        self.prompts.append(prompt)
        self.calls[kind] += 1
        return self.queues[kind].pop(0)

    async def ajson(self, *, system, prompt, schema, **_):
        return self.json(system=system, prompt=prompt, schema=schema)

    async def atext(self, *, system, prompt, **_):
        self.prompts.append(prompt)
        self.calls["answer"] += 1
        return self.queues["answer"].pop(0)


class Trace(list):
    def __call__(self, round_number, step, **fields):
        self.append({"round": round_number, "step": step, **fields})


def query(sql, reason="查資料"):
    return {"action": "query", "reason": reason, "sql": sql, "answer": None}


def answer(text_, reason="資料足夠"):
    return {"action": "answer", "reason": reason, "sql": None, "answer": text_}


def grade(value):
    return {"grade": value}


def rewrite(kb_query, zh="", en="", medical=False, internal=False):
    return {"kb_query": kb_query, "zh_terms": zh, "en_terms": en, "medical": medical, "internal": internal}


def use_web(monkeypatch, web_client):
    """讓 build_service 組出來的服務改用假的網搜（測試環境沒有 Firecrawl 金鑰，預設不上網）。"""
    real_build = knowledge.build_service

    def with_fake_web(engine_, llm_, on_step, embed_query):
        service = real_build(engine_, llm_, on_step, embed_query)
        service.web_search = WebSearchService(llm_, web_client, link_checker=None)
        return service

    monkeypatch.setattr(knowledge, "build_service", with_fake_web)


def test_chinese_is_split_into_overlapping_pairs():
    assert keyword_tokens("近效期退貨 SAP") == ["近效", "效期", "期退", "退貨", "sap"]


def test_sql_executor_only_reads_the_semantic_views(engine):
    assert run_readonly(engine, "SELECT count(*) AS n FROM v_customer_summary").rows == [[250]]
    with pytest.raises(QueryRejected):
        run_readonly(engine, "DELETE FROM visit")
    with pytest.raises(QueryRejected):
        run_readonly(engine, "SELECT 1; DROP TABLE visit")
    with pytest.raises(Exception, match="permission denied"):
        run_readonly(engine, "SELECT * FROM sales_transaction")


def test_data_question_converges_over_multiple_rounds(engine):
    llm = ScriptedLLM(step=[
        query(NORTH_SUPPLEMENT_SQL, "先看北區保健品集中在哪幾家"),
        query(FISH_OIL_SQL, "再看忠孝店的品項結構"),
        answer("衰退集中在康泰忠孝店等三家連鎖，魚油縮最多。"),
    ])
    trace = Trace()
    result = answer_data(engine, llm, "北區這一季保健品為什麼掉？", TODAY, trace)
    assert result.status == "answered"
    assert [t["step"] for t in trace] == ["sql", "sql", "answer"]
    assert all(t["row_count"] for t in trace if t["step"] == "sql")
    first_round = run_readonly(engine, NORTH_SUPPLEMENT_SQL).rows
    assert first_round[0][0] in llm.prompts[1]  # 第二輪看得到第一輪的結果
    assert result.evidence["columns"] == ["product_name", "amount"]


def test_a_forbidden_query_is_reported_back_so_the_agent_can_recover(engine):
    llm = ScriptedLLM(step=[query("SELECT * FROM sales_transaction"), query(FISH_OIL_SQL), answer("魚油是最大宗。")])
    trace = Trace()
    result = answer_data(engine, llm, "忠孝店哪個品項最多？", TODAY, trace)
    assert "permission denied" in trace[0]["decision"]
    assert trace[1]["row_count"] > 0
    assert result.status == "answered"


def test_data_question_stops_after_three_rounds_and_says_why(engine):
    llm = ScriptedLLM(
        step=[query(f"SELECT {n} AS n FROM v_customer_summary LIMIT 1") for n in (1, 2, 3)],
        final=[{"answerable": False, "answer": "只查到客戶數", "blocked_reason": "資料裡沒有競品的出貨價"}],
    )
    trace = Trace()
    result = answer_data(engine, llm, "御松田給康泰的出貨價是多少？", TODAY, trace)
    assert result.status == "not_converged"
    assert result.evidence["blocked_reason"] == "資料裡沒有競品的出貨價"
    assert [t["step"] for t in trace] == ["sql", "sql", "sql", "stop"]


def test_knowledge_answer_cites_the_section_it_used(engine, docs):
    llm = ScriptedLLM(grade=[grade("correct")], rewrite=[rewrite("近效期退貨 申請期限")], answer=["效期剩六個月以前要提出申請 [1]。"])
    trace = Trace()
    with Session(engine) as session:
        result = answer_knowledge(session, llm, "近效期的東西要多久前申請退貨？", trace)
    assert (result.status, result.route) == ("answered", "kb")
    assert result.sources[0]["section"] == "近效期退貨的申請期限"
    assert [t["step"] for t in trace] == ["search", "answer"]


def test_ambiguous_grade_rewrites_and_searches_again(engine, docs):
    llm = ScriptedLLM(
        grade=[grade("ambiguous"), grade("correct")],
        rewrite=[rewrite("近效期品項退貨 申請期限")],
        answer=["第一輪的投機答案", "效期剩六個月以前 [1]。"],
    )
    trace = Trace()
    with Session(engine) as session:
        result = answer_knowledge(session, llm, "效期快到的東西怎麼處理？", trace)
    assert result.answer == "效期剩六個月以前 [1]。"
    assert [t["step"] for t in trace] == ["search", "rewrite", "search", "answer"]


# 問句刻意跟「業務可直接給的折扣」那段共用「業務」「可以」「直接」「客戶」等詞，
# 讓關鍵字腿撈到候選段落（純問年終獎金的句子跟展示文件毫無字面交集，實測會在
# _answer() 的空候選捷徑直接轉 _web_or_no_hits，評估根本不會被呼叫，測不到
# CRAG 判「無關」這條路）。
IRRELEVANT_QUESTION = "業務可以直接給客戶年終獎金嗎？"


def test_irrelevant_grade_without_web_is_no_evidence(engine, docs):
    llm = ScriptedLLM(grade=[grade("incorrect")], rewrite=[rewrite("年終獎金")], answer=["不該被用到的投機答案"])
    with Session(engine) as session:
        result = answer_knowledge(session, llm, IRRELEVANT_QUESTION, Trace())
    assert llm.calls["grade"] == 1  # 真的檢索到段落、評估真的被呼叫（不是空候選捷徑）
    assert result.status == "no_evidence"
    assert result.route is None
    # 沒上網（沒設 Firecrawl 金鑰）：不能說「網路上也找不到」
    assert result.answer == "內部文件裡找不到可以回答這個問題的依據。"


def test_irrelevant_grade_and_empty_web_search_is_no_evidence_mentioning_the_web(engine, docs, monkeypatch):
    web_client = FakeWebClient()  # 沒有設定任何 search_hits：不管查什麼都回空，模擬網搜也找不到
    use_web(monkeypatch, web_client)
    llm = ScriptedLLM(grade=[grade("incorrect")], rewrite=[rewrite("年終獎金")], answer=["不該被用到的投機答案"])
    with Session(engine) as session:
        result = answer_knowledge(session, llm, IRRELEVANT_QUESTION, Trace())
    assert llm.calls["grade"] == 1
    assert (result.status, result.route) == ("no_evidence", "web")
    # 有上網查過、但網路也沒找到：才能說「網路上也找不到」
    assert result.answer == "內部文件和網路上都找不到可以回答這個問題的依據。"


def test_irrelevant_grade_goes_to_the_web_when_firecrawl_is_set(engine, docs, monkeypatch):
    web_client = FakeWebClient(search_hits={"年終獎金 計算": [hit("https://example.com/bonus", "年終獎金常見的計算方式說明" * 2)]})
    use_web(monkeypatch, web_client)
    llm = ScriptedLLM(
        grade=[grade("incorrect")],
        rewrite=[rewrite("年終獎金", zh="年終獎金 計算")],
        answer=["投機生成的知識庫答案（不會被採用）", "一般是一到兩個月 [1]。"],
    )
    trace = Trace()
    with Session(engine) as session:
        result = answer_knowledge(session, llm, IRRELEVANT_QUESTION, trace)
    assert llm.calls["grade"] == 1
    assert (result.status, result.route) == ("answered", "web")
    # 第一個 answer 被投機生成用掉（知識庫判無關後作廢），實際回傳的是第二個
    assert result.answer == "以下參考網路公開資料\n\n一般是一到兩個月 [1]。"
    assert result.sources[0]["url"] == "https://example.com/bonus"
    assert "web" in [t["step"] for t in trace]


def test_an_answer_citing_a_section_it_was_not_given_is_not_accepted(engine, docs):
    """FR-8.3：答案一個對得上的出處都沒有，就證明不了內容來自內部文件，回查無依據（James 2026-09-15 決定）。"""
    llm = ScriptedLLM(grade=[grade("correct")], rewrite=[rewrite("近效期退貨 申請期限")], answer=["隨時都可以退 [9]。"])
    with Session(engine) as session:
        result = answer_knowledge(session, llm, "近效期的東西要多久前申請退貨？", Trace())
    assert (result.status, result.route) == ("no_evidence", "kb")
    assert result.answer == "內部文件裡找不到可以回答這個問題的依據。"


def test_a_medication_question_is_not_answered_from_the_web(engine, docs, monkeypatch):
    """用藥、劑量、療效這類醫療問題不上網（James 2026-09-15 決定，跟語音問答一致）：網路上就算有資料也不搜。"""
    web_client = FakeWebClient(search_hits={"魚油 副作用": [hit("https://example.com/fish-oil", "魚油吃太多可能造成腸胃不適" * 2)]})
    use_web(monkeypatch, web_client)
    llm = ScriptedLLM(
        grade=[grade("incorrect")],
        rewrite=[rewrite("魚油 副作用", zh="魚油 副作用", medical=True)],
        answer=["不該被用到的投機答案"],
    )
    with Session(engine) as session:
        result = answer_knowledge(session, llm, "魚油吃太多會有什麼副作用？", Trace())
    assert result.status == "no_evidence"
    assert result.answer == "內部文件裡找不到這個問題的依據。用藥、劑量、療效這類醫療問題不會上網查，請詢問醫師或藥師。"
    assert result.reason == "medical"
    assert web_client.search_calls == []


def test_a_medication_question_without_firecrawl_gets_the_plain_no_evidence_text(engine, docs):
    """沒設 Firecrawl 本來就不上網：用藥題跟其他查不到的題目一樣，回一般的查無依據文案。"""
    llm = ScriptedLLM(
        grade=[grade("incorrect")],
        rewrite=[rewrite("魚油 副作用", zh="魚油 副作用", medical=True)],
        answer=["不該被用到的投機答案"],
    )
    with Session(engine) as session:
        result = answer_knowledge(session, llm, "魚油吃太多會有什麼副作用？", Trace())
    assert (result.status, result.route) == ("no_evidence", None)
    assert result.answer == "內部文件裡找不到可以回答這個問題的依據。"


def test_a_company_internal_question_is_not_answered_from_the_web(engine, docs, monkeypatch):
    """只有公司內部才有答案的問題不上網（James 2026-09-15 決定）：網路資料代表不了公司，可以轉主管。"""
    web_client = FakeWebClient(search_hits={"年終獎金 計算": [hit("https://example.com/bonus", "年終獎金常見的計算方式說明" * 2)]})
    use_web(monkeypatch, web_client)
    llm = ScriptedLLM(
        grade=[grade("incorrect")],
        rewrite=[rewrite("年終獎金", zh="年終獎金 計算", internal=True)],
        answer=["不該被用到的投機答案"],
    )
    with Session(engine) as session:
        result = answer_knowledge(session, llm, IRRELEVANT_QUESTION, Trace())
    assert (result.status, result.reason) == ("no_evidence", "internal")
    assert result.answer == "內部文件裡找不到這個問題的依據。這是只有公司內部才有答案的問題（例如公司的規定、報價、人事、交易條件），網路上的資料代表不了公司，所以不上網查，可以轉給主管確認。"
    assert web_client.search_calls == []


@pytest.fixture
def client(engine, sign_in):
    yield sign_in(TestClient(app), "U01")
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM ask_record"))
    redis().flushdb()


def run_jobs():
    SimpleWorker([visit_queue()], connection=redis()).work(burst=True)


def test_asking_through_the_api_runs_in_the_background_and_keeps_the_trace(client, docs, monkeypatch):
    llm = ScriptedLLM(grade=[grade("correct")], rewrite=[rewrite("折扣審核 上限")], answer=["百分之五以內可以直接給 [1]。"])
    monkeypatch.setattr(asks_service, "get_llm", lambda: llm)
    created = client.post("/api/asks", json={"kind": "knowledge", "question": "業務可以直接給客戶幾趴折扣？"})
    assert created.status_code == 202
    assert created.json()["status"] == "queued"

    run_jobs()
    ask = client.get(f"/api/asks/{created.json()['id']}").json()
    assert ask["status"] == "answered"
    assert ask["evidence"]["route"] == "kb"
    assert ask["evidence"]["sources"][0]["doc_title"] == "報價權限與折扣審核"
    assert [t["step"] for t in ask["trace"]] == ["search", "answer"]


def test_without_an_ai_model_the_question_fails_with_a_clear_reason(client, monkeypatch):
    def not_configured():
        raise NotConfigured("AI 模型還沒設定")

    monkeypatch.setattr(asks_service, "get_llm", not_configured)
    ask_id = client.post("/api/asks", json={"kind": "data", "question": "北區業績？"}).json()["id"]
    run_jobs()
    ask = client.get(f"/api/asks/{ask_id}").json()
    assert ask["status"] == "failed"
    assert "AI 模型還沒設定" in ask["error_message"]


def test_a_question_without_evidence_can_be_escalated_once(client, docs, monkeypatch):
    llm = ScriptedLLM(grade=[grade("incorrect")], rewrite=[rewrite("年終獎金")], answer=["不該被用到的投機答案"])
    monkeypatch.setattr(asks_service, "get_llm", lambda: llm)
    ask_id = client.post("/api/asks", json={"kind": "knowledge", "question": "年終怎麼算？"}).json()["id"]
    run_jobs()
    assert client.get(f"/api/asks/{ask_id}").json()["status"] == "no_evidence"
    assert client.post(f"/api/asks/{ask_id}/escalate").status_code == 200

    first = client.post(f"/api/asks/{ask_id}/escalate").json()["escalation_id"]
    again = client.post(f"/api/asks/{ask_id}/escalate").json()["escalation_id"]
    assert first is not None and first == again


def test_a_medication_question_is_not_offered_to_the_manager(client, docs, monkeypatch):
    """用藥題請業務問醫師或藥師（James 2026-09-15）：evidence 帶 reason，轉主管回 409。"""
    use_web(monkeypatch, FakeWebClient())
    llm = ScriptedLLM(grade=[grade("incorrect")], rewrite=[rewrite("魚油 副作用", medical=True)], answer=["不該被用到的投機答案"])
    monkeypatch.setattr(asks_service, "get_llm", lambda: llm)
    ask_id = client.post("/api/asks", json={"kind": "knowledge", "question": "魚油吃太多會有什麼副作用？"}).json()["id"]
    run_jobs()
    ask = client.get(f"/api/asks/{ask_id}").json()
    assert (ask["status"], ask["evidence"]["reason"]) == ("no_evidence", "medical")
    assert client.post(f"/api/asks/{ask_id}/escalate").status_code == 409


def test_a_company_internal_question_can_still_go_to_the_manager(client, docs, monkeypatch):
    use_web(monkeypatch, FakeWebClient())
    llm = ScriptedLLM(grade=[grade("incorrect")], rewrite=[rewrite("年終獎金", internal=True)], answer=["不該被用到的投機答案"])
    monkeypatch.setattr(asks_service, "get_llm", lambda: llm)
    ask_id = client.post("/api/asks", json={"kind": "knowledge", "question": "年終怎麼算？"}).json()["id"]
    run_jobs()
    assert client.get(f"/api/asks/{ask_id}").json()["evidence"]["reason"] == "internal"
    assert client.post(f"/api/asks/{ask_id}/escalate").status_code == 200


def test_a_medication_question_the_documents_refuse_still_gets_the_medical_reason(engine, docs, monkeypatch):
    """9/15 評測 X05：知識庫路徑自己拒答的用藥題，也要回用藥文案（畫面不給轉主管）。

    問句借用檢索得到段落的近效期題，才走得到知識庫路徑；是不是用藥題由劇本裡的改寫結果決定。"""
    use_web(monkeypatch, FakeWebClient())
    llm = ScriptedLLM(grade=[grade("correct")], rewrite=[rewrite("近效期 退貨", medical=True)], answer=["[NO_ANSWER] 文件沒有提到。"])
    with Session(engine) as session:
        result = answer_knowledge(session, llm, "近效期的東西要多久前申請退貨？", Trace())
    assert (result.status, result.route, result.reason) == ("no_evidence", "kb", "medical")
    assert result.answer == "內部文件裡找不到這個問題的依據。用藥、劑量、療效這類醫療問題不會上網查，請詢問醫師或藥師。"


class FailedService:
    """answer() 直接給指定的失敗結果：這裡驗的是 knowledge → 背景工作 → API 怎麼呈現失敗，
    CRAG 自己什麼時候判逾時／網搜出錯由 test_crag_answer_service.py 負責。"""

    def __init__(self, route, fail_code):
        self.route, self.fail_code = route, fail_code

    async def answer(self, question):
        return RagOutcome(status="failed", route=self.route, answer=None, sources=[], fail_code=self.fail_code)


@pytest.mark.parametrize(
    ("route", "fail_code", "message"),
    [
        (None, FailCode.TIMEOUT, "查詢超過 45 秒還沒完成，請稍後再問一次。"),
        ("web", FailCode.WEB_ERROR, "網路搜尋出錯，請稍後再問一次。"),
    ],
)
def test_a_failed_knowledge_question_tells_the_user_why(client, monkeypatch, route, fail_code, message):
    monkeypatch.setattr(asks_service, "get_llm", lambda: ScriptedLLM())
    monkeypatch.setattr(knowledge, "build_service", lambda *_: FailedService(route, fail_code))
    ask_id = client.post("/api/asks", json={"kind": "knowledge", "question": "年終怎麼算？"}).json()["id"]
    run_jobs()
    ask = client.get(f"/api/asks/{ask_id}").json()
    assert ask["status"] == "failed"
    assert ask["error_message"] == message


# --- 事件迴圈：answer_knowledge 用行程共用的 asyncio.Runner，不用 asyncio.run ---


class LoopRecordingLLM(ScriptedLLM):
    """記下每次模型呼叫時正在跑的事件迴圈。"""

    def __init__(self, **queues):
        super().__init__(**queues)
        self.loops = []

    async def ajson(self, **kwargs):
        self.loops.append(asyncio.get_running_loop())
        return await super().ajson(**kwargs)

    async def atext(self, **kwargs):
        self.loops.append(asyncio.get_running_loop())
        return await super().atext(**kwargs)


def test_a_slow_embedding_does_not_hold_up_the_answer_after_its_leg_times_out(engine, docs, monkeypatch):
    """查詢 embedding 是 asyncio.to_thread 裡的同步呼叫，腿逾時後執行緒照跑。
    管線跑完就要回來，不能陪那條執行緒等到結束（asyncio.run 收尾會等）。"""

    def slow_embed(query):
        time.sleep(2)
        return [0.1, 0.2, 0.3]  # 測試庫的段落都沒有 embedding，這條腿醒來後查到的也是空的

    real_build = knowledge.build_service

    def with_short_leg_timeout(engine_, llm_, on_step, embed_query):
        service = real_build(engine_, llm_, on_step, embed_query)
        service.retriever.leg_timeout_seconds = 0.2
        return service

    monkeypatch.setattr(knowledge, "build_service", with_short_leg_timeout)
    llm = ScriptedLLM(grade=[grade("correct")], rewrite=[rewrite("折扣審核 上限")], answer=["百分之五以內可以直接給 [1]。"])
    started = time.monotonic()
    with Session(engine) as session:
        result = answer_knowledge(session, llm, "業務可以直接給客戶幾趴折扣？", Trace(), slow_embed)
    elapsed = time.monotonic() - started
    assert (result.status, result.route) == ("answered", "kb")  # 向量腿逾時，只剩關鍵字腿照常回答
    assert elapsed < 1.0


def test_consecutive_knowledge_answers_run_on_the_same_event_loop(engine, docs):
    """google-genai 的非同步連線在建立用戶端時就產生、之後重用；eval_ask 整批題目共用一個
    get_llm()，第二題若換了事件迴圈就會撞到上一個已關閉的迴圈（Event loop is closed）。"""
    llm = LoopRecordingLLM(
        grade=[grade("correct"), grade("correct")],
        rewrite=[rewrite("折扣審核 上限"), rewrite("近效期退貨 申請期限")],
        answer=["百分之五以內可以直接給 [1]。", "效期剩六個月以前要提出申請 [1]。"],
    )
    with Session(engine) as session:
        first = answer_knowledge(session, llm, "業務可以直接給客戶幾趴折扣？", Trace())
        calls_in_first = len(llm.loops)
        second = answer_knowledge(session, llm, "近效期的東西要多久前申請退貨？", Trace())
    assert first.status == second.status == "answered"
    assert 0 < calls_in_first < len(llm.loops)  # 兩題都真的呼叫了模型
    assert all(loop is llm.loops[0] for loop in llm.loops)
