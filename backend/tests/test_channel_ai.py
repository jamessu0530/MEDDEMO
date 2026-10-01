"""頻道裡 @熊熊滾（services/channel_ai.py）。

AI 模型用照劇本回應的替身；CRAG 換成記下問題、回寫好結果的替身（CRAG 本身在 test_asks、test_crag_* 測過）。
直接呼叫 answer 的測試都跑在 tx fixture 的交易裡，測完回滾。
"""

import datetime as dt

import pytest
from fastapi.testclient import TestClient
from redis.exceptions import ConnectionError as RedisConnectionError
from rq import SimpleWorker
from sqlalchemy import delete, func, select

from app import usage
from app.api import channels as channels_api
from app.config import NotConfigured
from app.main import app
from app.models import AppUser, ChannelMessage, ChannelRead, Customer
from app.services import channel_ai, channels, knowledge
from app.services.knowledge import KnowledgeAnswer
from app.tasks import channels_queue, redis


class RouteLLM:
    """只會被呼叫一次「判斷題目」：回寫好的結果，記下送了什麼。"""

    def __init__(self, decision=None, error=None):
        self.decision, self.error, self.prompts = decision, error, []

    def json(self, *, system, prompt, schema, **_):
        self.prompts.append(prompt)
        if self.error:
            raise self.error
        return self.decision


@pytest.fixture
def mascot(monkeypatch):
    """換掉模型與 CRAG。use(decision, error=, knowledge=) 設定這次的劇本，回傳 (模型替身, 交給 CRAG 的問題清單)。
    knowledge 給例外就讓 CRAG 丟出來。"""

    def use(decision=None, *, error=None, knowledge=None):
        llm, asked = RouteLLM(decision, error), []

        def fake_knowledge(session, llm_, question, on_step, embed_query=None, **_):
            asked.append(question)
            if isinstance(knowledge, Exception):
                raise knowledge
            return knowledge

        monkeypatch.setattr(channel_ai, "get_llm", lambda: llm)
        monkeypatch.setattr(channel_ai, "answer_knowledge", fake_knowledge)
        return llm, asked

    return use


def chat(answer):
    return {"route": "chat", "question": "", "answer": answer}


def documents(question):
    return {"route": "documents", "question": question, "answer": ""}


def visible(session, name, user_id="U01"):
    user = session.get(AppUser, user_id)
    return next(i for i in channels.visible_channels(session, user) if i.name == name)


def ask(session, info, body, user_id="U01"):
    return channels.post(session, session.get(AppUser, user_id), info, body)


def test_a_chat_question_is_answered_from_the_conversation(tx, mascot):
    _, asked_crag = mascot(chat("剛剛大家在說忠孝店補貨延遲。"))
    team = visible(tx, "陳建宏小組")
    question = ask(tx, team, "@熊熊滾 剛剛在說什麼")
    reply = channel_ai.answer(tx, question.id)
    assert (reply.kind, reply.body, reply.reply_to_id, reply.channel_id) == (
        "ai", "剛剛大家在說忠孝店補貨延遲。", question.id, team.id
    )
    assert asked_crag == []


def test_a_question_about_company_rules_goes_through_the_same_crag_as_the_ask_page(tx, mascot):
    sources = [
        {"kind": "kb", "index": 1, "doc_title": "近效期品項退貨作業規範", "section": "近效期退貨的運費",
         "source_name": "01-近效期退貨.md", "content": "…"},
        {"kind": "web", "index": 2, "doc_title": "食藥署公告", "section": "fda.gov.tw",
         "url": "https://www.fda.gov.tw/x", "source_name": "fda.gov.tw", "content": "…"},
    ]
    _, asked_crag = mascot(
        documents("近效期品項退貨的運費由誰負擔？"),
        knowledge=KnowledgeAnswer("answered", "運費由公司負擔 [1]，另見 [2]。", sources, "kb"),
    )
    reply = channel_ai.answer(tx, ask(tx, visible(tx, "陳建宏小組"), "@熊熊 剛剛說的那個退貨運費誰付？").id)
    assert asked_crag == ["近效期品項退貨的運費由誰負擔？"]
    assert reply.body == (
        "運費由公司負擔 [1]，另見 [2]。\n\n出處：\n"
        "[1] 近效期品項退貨作業規範｜近效期退貨的運費\n"
        "[2] 食藥署公告 https://www.fda.gov.tw/x"
    )


@pytest.mark.parametrize("result, body", [
    (KnowledgeAnswer("no_evidence", knowledge.MEDICAL_NO_EVIDENCE, [], "kb", reason="medical"), knowledge.MEDICAL_NO_EVIDENCE),
    (KnowledgeAnswer("no_evidence", knowledge.NO_EVIDENCE, [], "web"), knowledge.NO_EVIDENCE),
    (KnowledgeAnswer("failed", None, [], None, "網路搜尋出錯，請稍後再問一次。"), "網路搜尋出錯，請稍後再問一次。"),
])
def test_crag_without_an_answer_says_why_in_its_own_words(tx, mascot, result, body):
    mascot(documents("魚油一天吃幾顆？"), knowledge=result)
    assert channel_ai.answer(tx, ask(tx, visible(tx, "陳建宏小組"), "@AI 魚油一天吃幾顆").id).body == body


def test_the_model_sees_only_this_channel_up_to_the_question(tx, mascot):
    llm, _ = mascot(chat("好"))
    team = visible(tx, "陳建宏小組")
    ask(tx, visible(tx, "全國"), "全國頻道的事")
    question = ask(tx, team, "@熊熊滾 整理一下")
    ask(tx, team, "提問之後才講的")
    channel_ai.answer(tx, question.id)
    prompt = llm.prompts[0]
    assert "頻道：陳建宏小組（小組頻道）" in prompt
    assert "忠孝店店長又在問補貨" in prompt  # 灌資料放的小組對話
    assert prompt.rstrip().endswith("林昱辰：@熊熊滾 整理一下")
    assert "全國頻道的事" not in prompt and "提問之後才講的" not in prompt


def test_a_customer_thread_adds_the_basic_customer_profile_only(tx, mascot):
    llm, _ = mascot(chat("林昱辰負責。"))
    thread = channels.customer_thread(tx, tx.get(AppUser, "U01"), "C001")
    channel_ai.answer(tx, ask(tx, thread, "@熊熊滾 這家誰負責").id)
    prompt = llm.prompts[0]
    customer = tx.get(Customer, "C001")
    assert (
        f"這個討論串的客戶：{customer.name}；類型 連鎖藥局；連鎖體系 {customer.chain_group}；"
        f"縣市 台北市；地點 台北市・大安區；等級 {customer.grade}；負責人 林昱辰"
    ) in prompt
    # 合約到期日不是 customer_basic 的欄位
    assert customer.contract_end_date is None or customer.contract_end_date.isoformat() not in prompt


def test_every_failure_ends_in_an_apology(tx, mascot, monkeypatch):
    team = visible(tx, "陳建宏小組")
    for case in (
        {"error": RuntimeError("模型忙線")},
        {"decision": chat("  ")},
        {"decision": documents("")},
        {"decision": documents("退貨運費誰付？"), "knowledge": RuntimeError("檢索壞了")},
    ):
        mascot(**case)
        assert channel_ai.answer(tx, ask(tx, team, "@熊熊滾 在嗎").id).body == channel_ai.SORRY, case

    def not_configured():
        raise NotConfigured("AI 模型還沒設定")

    monkeypatch.setattr(channel_ai, "get_llm", not_configured)
    assert channel_ai.answer(tx, ask(tx, team, "@熊熊滾 在嗎").id).body == channel_ai.SORRY


def test_no_reply_once_the_team_channel_is_archived(tx, mascot):
    mascot(chat("在喔"))
    question = ask(tx, visible(tx, "陳建宏小組"), "@熊熊滾 在嗎")
    # 排隊期間主管被停用，小組頻道封存
    tx.get(AppUser, "M01").deactivated_at = dt.datetime.now(dt.UTC)
    tx.flush()
    assert channel_ai.answer(tx, question.id) is None
    assert tx.scalar(select(func.count()).select_from(ChannelMessage).where(ChannelMessage.reply_to_id == question.id)) == 0


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def queue():
    """channels 佇列，前後清空。用量計數也清掉：@熊熊滾 會扣「提問」，不受其他測試送過的請求影響。"""
    redis().flushdb()
    yield channels_queue()
    redis().flushdb()


def channel_id(client, auth, name, user_id="U01"):
    return next(c["id"] for c in client.get("/api/channels", headers=auth(user_id)).json() if c["name"] == name)


def post(client, headers, channel, body):
    return client.post(f"/api/channels/{channel}/messages", json={"body": body}, headers=headers)


def history(client, headers, channel, **params):
    return client.get(f"/api/channels/{channel}/messages", params=params, headers=headers).json()


def test_only_a_message_that_calls_the_mascot_queues_an_answer(tx, client, auth, queue):
    team = channel_id(client, auth, "陳建宏小組")
    plain = post(client, auth("U01"), team, "沒有叫熊熊滾").json()
    called = post(client, auth("U01"), team, "@熊熊滾 在嗎").json()
    assert (plain["mentions_ai"], called["mentions_ai"]) == (False, True)
    assert [(job.func_name, job.args) for job in queue.jobs] == [("app.services.channel_ai.run", (called["id"],))]


def test_calling_the_mascot_counts_as_an_ask(tx, client, auth, queue, monkeypatch):
    monkeypatch.setitem(usage.LIMITS, "ask", usage.Limit("提問", per_client_hour=1, per_day=100))
    team = channel_id(client, auth, "陳建宏小組")
    assert post(client, auth("U01"), team, "@熊熊滾 第一次").status_code == 201
    # 沒叫熊熊滾不算提問
    assert post(client, auth("U01"), team, "一般的回報").status_code == 201
    blocked = post(client, auth("U01"), team, "@熊熊滾 第二次")
    assert blocked.status_code == 429
    assert "提問" in blocked.json()["detail"]
    # 被擋的那則沒留下，也沒排工作
    assert "@熊熊滾 第二次" not in [m["body"] for m in history(client, auth("U01"), team)]
    assert len(queue.jobs) == 1
    # 被擋的那次沒有多扣：上限放寬到 2，下一次就過得了
    monkeypatch.setitem(usage.LIMITS, "ask", usage.Limit("提問", per_client_hour=2, per_day=100))
    assert post(client, auth("U01"), team, "@熊熊滾 第三次").status_code == 201


def test_when_the_queue_is_down_the_mascot_apologises_at_once(tx, client, auth, queue, monkeypatch):
    def down():
        raise RedisConnectionError("連不上")

    monkeypatch.setattr(channels_api, "channels_queue", down)
    team = channel_id(client, auth, "陳建宏小組")
    called = post(client, auth("U01"), team, "@熊熊滾 在嗎")
    assert called.status_code == 201
    latest = history(client, auth("U02"), team)[-2:]
    assert [(m["kind"], m["body"], m["reply_to_id"]) for m in latest] == [
        ("user", "@熊熊滾 在嗎", None), ("ai", channel_ai.SORRY, called.json()["id"])
    ]


def test_the_worker_posts_the_answer_where_everyone_polling_sees_it(engine, client, auth, queue, mascot):
    """走真的佇列與背景工作，資料真的 commit，測完刪掉。
    用台北市・信義區：地點頻道不算進紅點，也沒有灌資料的對話。"""
    mascot(chat("在喔，有什麼要問的？"))
    place = channel_id(client, auth, "台北市・信義區")
    try:
        called = post(client, auth("U01"), place, "@熊熊滾 在嗎").json()
        SimpleWorker([queue], connection=redis()).work(burst=True)
        replies = history(client, auth("U02"), place, after=called["id"])
        assert [(m["kind"], m["body"], m["reply_to_id"]) for m in replies] == [("ai", "在喔，有什麼要問的？", called["id"])]
    finally:
        with engine.begin() as conn:
            conn.execute(delete(ChannelMessage).where(ChannelMessage.channel_id == place))
            conn.execute(delete(ChannelRead).where(ChannelRead.channel_id == place))
