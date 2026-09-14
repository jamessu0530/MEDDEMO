"""第四週：反覆查詢（數字題）與 CRAG（知識題）。

AI 模型用照劇本回應的替身；資料庫權限、SQL 執行、關鍵字檢索、Redis 佇列與背景工作都是真的。
"""

import datetime as dt
from collections import Counter

import pytest
from fastapi.testclient import TestClient
from rq import SimpleWorker
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import NotConfigured
from app.main import app
from app.services import asks as asks_service
from app.services.data_agent import answer_data
from app.services.knowledge import answer_knowledge
from app.services.retrieval import hybrid_search, keyword_tokens, reciprocal_rank_fusion
from app.services.sql_executor import QueryRejected, run_readonly
from app.tasks import redis, visit_queue

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

    KIND_BY_FIELD = {"sufficient": "grade", "query": "rewrite", "cited_chunk_ids": "answer", "action": "step", "blocked_reason": "final"}

    def __init__(self, **queues):
        self.queues = {kind: list(items) for kind, items in queues.items()}
        self.prompts = []
        self.calls = Counter()

    def json(self, *, system, prompt, schema, **_):
        kind = next(kind for field, kind in self.KIND_BY_FIELD.items() if field in schema["required"])
        self.prompts.append(prompt)
        self.calls[kind] += 1
        return self.queues[kind].pop(0)


class Trace(list):
    def __call__(self, round_number, step, **fields):
        self.append({"round": round_number, "step": step, **fields})


def query(sql, reason="查資料"):
    return {"action": "query", "reason": reason, "sql": sql, "answer": None}


def answer(text_, reason="資料足夠"):
    return {"action": "answer", "reason": reason, "sql": None, "answer": text_}


def grade(sufficient, chunk_ids=(), reason="評估"):
    return {"sufficient": sufficient, "relevant_chunk_ids": list(chunk_ids), "reason": reason}


def rewrite(query_text):
    return {"query": query_text, "reason": "改用文件裡的正式名詞"}


def reply(text_, chunk_ids):
    return {"answerable": True, "answer": text_, "cited_chunk_ids": list(chunk_ids)}


def test_chinese_is_split_into_overlapping_pairs():
    assert keyword_tokens("近效期退貨 SAP") == ["近效", "效期", "期退", "退貨", "sap"]


def test_rrf_rewards_chunks_ranked_high_by_both_channels():
    fused = reciprocal_rank_fusion([[1, 2, 3], [3, 1, 4]])
    assert [chunk_id for chunk_id, _ in fused][:2] == [1, 3]


def test_keyword_search_finds_the_right_section(engine, docs):
    with Session(engine) as session:
        hits = hybrid_search(session, "近效期的東西要多久前申請退貨", limit=3)
    assert hits[0].section == "近效期退貨的申請期限"


def test_sql_executor_only_reads_the_semantic_views(engine):
    assert run_readonly(engine, "SELECT count(*) AS n FROM v_customer_summary").rows == [[80]]
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
    target = docs["近效期退貨的申請期限"]
    llm = ScriptedLLM(grade=[grade(True, [target])], answer=[reply("效期剩六個月以前要提出申請。", [target])])
    with Session(engine) as session:
        result = answer_knowledge(session, llm, "近效期的東西要多久前申請退貨？", Trace())
    assert result.status == "answered"
    assert [s["section"] for s in result.sources] == ["近效期退貨的申請期限"]


def test_knowledge_rewrites_the_question_when_the_first_search_is_not_enough(engine, docs):
    target = docs["近效期退貨的申請期限"]
    llm = ScriptedLLM(
        grade=[grade(False, reason="沒提到期限"), grade(True, [target])],
        rewrite=[rewrite("近效期品項退貨 申請期限")],
        answer=[reply("效期剩六個月以前。", [target])],
    )
    trace = Trace()
    with Session(engine) as session:
        result = answer_knowledge(session, llm, "效期快到的東西怎麼處理？", trace)
    assert result.status == "answered"
    assert [t["step"] for t in trace] == ["search", "rewrite", "search", "answer"]


def test_knowledge_says_no_evidence_after_two_rewrites_instead_of_guessing(engine, docs):
    llm = ScriptedLLM(
        grade=[grade(False)] * 3,
        rewrite=[rewrite("年終獎金 計算方式"), rewrite("年終獎金 發放標準")],
    )
    trace = Trace()
    with Session(engine) as session:
        result = answer_knowledge(session, llm, "今年年終獎金怎麼算？", trace)
    assert result.status == "no_evidence"
    assert [t["step"] for t in trace].count("search") == 3
    assert llm.calls["answer"] == 0  # 沒有依據就不讓模型生成答案


def test_an_answer_citing_a_section_it_was_not_given_is_not_accepted(engine, docs):
    target = docs["近效期退貨的申請期限"]
    llm = ScriptedLLM(
        grade=[grade(True, [target]), grade(False), grade(False)],
        answer=[reply("隨時都可以退。", [999999])],
        rewrite=[rewrite("近效期退貨"), rewrite("近效期退貨 期限")],
    )
    with Session(engine) as session:
        assert answer_knowledge(session, llm, "近效期退貨期限？", Trace()).status == "no_evidence"


@pytest.fixture
def client(engine):
    yield TestClient(app)
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM ask_record"))
    redis().flushdb()


def run_jobs():
    SimpleWorker([visit_queue()], connection=redis()).work(burst=True)


def test_asking_through_the_api_runs_in_the_background_and_keeps_the_trace(client, docs, monkeypatch):
    target = docs["業務可直接給的折扣"]
    llm = ScriptedLLM(grade=[grade(True, [target])], answer=[reply("百分之五以內可以直接給。", [target])])
    monkeypatch.setattr(asks_service, "get_llm", lambda: llm)
    created = client.post("/api/asks", json={"kind": "knowledge", "question": "業務可以直接給客戶幾趴折扣？"})
    assert created.status_code == 202
    assert created.json()["status"] == "queued"

    run_jobs()
    ask = client.get(f"/api/asks/{created.json()['id']}").json()
    assert ask["status"] == "answered"
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
    llm = ScriptedLLM(grade=[grade(False)] * 3, rewrite=[rewrite("年終獎金"), rewrite("獎金 計算")])
    monkeypatch.setattr(asks_service, "get_llm", lambda: llm)
    ask_id = client.post("/api/asks", json={"kind": "knowledge", "question": "年終怎麼算？"}).json()["id"]
    run_jobs()
    assert client.get(f"/api/asks/{ask_id}").json()["status"] == "no_evidence"
    assert client.post(f"/api/asks/{ask_id}/escalate").status_code == 200

    first = client.post(f"/api/asks/{ask_id}/escalate").json()["escalation_id"]
    again = client.post(f"/api/asks/{ask_id}/escalate").json()["escalation_id"]
    assert first is not None and first == again
