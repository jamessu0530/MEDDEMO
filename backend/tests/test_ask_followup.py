"""打字問答的追問：要看前文才懂就改寫成完整問句，其他一律原話照送。Jev 與 Gemini 都用假的。"""

import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from app.llm import LLMOutputError
from app.main import app
from app.services import ask_followup, ask_router

EARLIER = [{"question": "北區保健品最近三個月為什麼下滑？", "answer": "主要是康泰連鎖藥局的忠孝店、板橋店進貨變少。"}]


def jev(probability: float, seen: list | None = None) -> httpx.Client:
    def handle(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(json.loads(request.content))
        return httpx.Response(200, json={"answers": {"followup": {"noul": probability}}})

    return httpx.Client(transport=httpx.MockTransport(handle))


class FakeLLM:
    """照寫好的回應回答，記下收到的提示；reply 是例外就丟出去"""

    def __init__(self, reply, delay: float = 0):
        self.reply, self.delay, self.prompts = reply, delay, []

    def json(self, *, system, prompt, schema, effort="medium", media=()):
        self.prompts.append(prompt)
        time.sleep(self.delay)
        if isinstance(self.reply, Exception):
            raise self.reply
        return {"question": self.reply}


@pytest.fixture(autouse=True)
def key(env):
    env(TYPESAFE_API_KEY="test-key")


def test_a_follow_up_is_rewritten_with_what_came_before():
    seen: list = []
    llm = FakeLLM("康泰連鎖藥局最近三個月保健品為什麼下滑？")
    asked = ask_followup.standalone("那康泰呢？", EARLIER, llm=llm, client=jev(0.93, seen))
    assert asked == "康泰連鎖藥局最近三個月保健品為什麼下滑？"
    assert seen[0]["state"] == {"earlier": EARLIER, "question": "那康泰呢？"}
    assert "1. 問：北區保健品最近三個月為什麼下滑？" in llm.prompts[0] and "業務這次說：那康泰呢？" in llm.prompts[0]


def test_a_question_that_stands_alone_is_sent_as_is():
    llm = FakeLLM("不該被用到")
    # 門檻比 0.5 嚴：寧可漏改，也不要把獨立的問題改窄
    assert ask_followup.standalone("帳齡拖最久的是哪一家？", EARLIER, llm=llm, client=jev(0.55)) == "帳齡拖最久的是哪一家？"
    assert llm.prompts == []


def test_the_first_question_never_calls_jev():
    seen: list = []
    assert ask_followup.standalone("北區為什麼掉？", [], llm=FakeLLM("x"), client=jev(0.99, seen)) == "北區為什麼掉？"
    assert seen == []


def test_only_the_last_three_turns_go_along_and_answers_are_cut():
    seen: list = []
    earlier = [{"question": f"第{n}題", "answer": "答" * 1000} for n in range(5)]
    ask_followup.standalone("那呢？", earlier, llm=FakeLLM("完整的問題"), client=jev(0.9, seen))
    sent = seen[0]["state"]["earlier"]
    assert [turn["question"] for turn in sent] == ["第2題", "第3題", "第4題"]
    assert all(len(turn["answer"]) == ask_followup.ANSWER_CHARS for turn in sent)


@pytest.mark.parametrize(
    "llm",
    [FakeLLM(LLMOutputError("格式不對")), FakeLLM(""), FakeLLM("太長" * 300), FakeLLM(RuntimeError("Gemini 掛了"))],
)
def test_a_failed_rewrite_sends_the_words_as_typed(llm):
    assert ask_followup.standalone("那康泰呢？", EARLIER, llm=llm, client=jev(0.9)) == "那康泰呢？"


def test_a_slow_rewrite_is_given_up(monkeypatch):
    monkeypatch.setattr(ask_followup, "REWRITE_TIMEOUT_SECONDS", 0.05)
    assert ask_followup.standalone("那康泰呢？", EARLIER, llm=FakeLLM("改寫好了", delay=0.3), client=jev(0.9)) == "那康泰呢？"


def test_when_jev_does_not_answer_nothing_is_rewritten(env):
    def handle(request):
        return httpx.Response(503)

    llm = FakeLLM("不該被用到")
    down = httpx.Client(transport=httpx.MockTransport(handle))
    assert ask_followup.standalone("那康泰呢？", EARLIER, llm=llm, client=down) == "那康泰呢？"
    env(TYPESAFE_API_KEY="")
    assert ask_followup.standalone("那康泰呢？", EARLIER, llm=llm, client=jev(0.99)) == "那康泰呢？"
    assert llm.prompts == []


@pytest.fixture
def api(auth, monkeypatch):
    """route 與 standalone 換成假的，記下 route 被問了哪幾句"""
    routed: list[str] = []

    def route(question, has_file=False):
        routed.append(question)
        return ask_router.Routed(kind="data", choices=[], confidence=0.9)

    monkeypatch.setattr(ask_router, "route", route)
    monkeypatch.setattr(
        ask_followup, "standalone", lambda question, earlier: "康泰最近三個月保健品為什麼下滑？" if question == "那康泰呢？" else question
    )
    client = TestClient(app)
    return lambda body: client.post("/api/asks/route", json=body, headers=auth()).json(), routed


def test_the_route_api_routes_the_rewritten_question(api):
    post, routed = api
    body = post({"question": "那康泰呢？", "earlier": EARLIER})
    assert body == {"kind": "data", "choices": [], "confidence": 0.9, "question": "康泰最近三個月保健品為什麼下滑？", "rewritten": True}
    # 先照原話猜了一次，改寫之後再照改寫的判斷一次
    assert routed == ["那康泰呢？", "康泰最近三個月保健品為什麼下滑？"]


def test_the_route_api_reuses_the_first_guess_when_nothing_changes(api):
    post, routed = api
    body = post({"question": "近效期的貨要多久前申請退貨？", "earlier": EARLIER})
    assert body["question"] == "近效期的貨要多久前申請退貨？" and body["rewritten"] is False
    assert routed == ["近效期的貨要多久前申請退貨？"]


def test_a_chosen_kind_is_only_rewritten(api):
    post, routed = api
    body = post({"question": "那康泰呢？", "earlier": EARLIER, "kind": "memory"})
    assert body == {"kind": "memory", "choices": [], "confidence": None, "question": "康泰最近三個月保健品為什麼下滑？", "rewritten": True}
    assert routed == []
