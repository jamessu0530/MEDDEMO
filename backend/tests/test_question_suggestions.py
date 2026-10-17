import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app.api.auth import current_user
from app.main import app
from app.services import question_suggestions
from app.services.assistant_context import PageContext

PAGE = PageContext(path="/customers/C02", title="仁和 · 客戶檔案", facts=["客戶：仁和", "商品分類：保健品"])
EARLIER = [
    {"question": "康泰這季進貨如何？", "answer": "康泰的進貨變化如下。", "page": {"path": "/customers/C01", "title": "康泰", "facts": ["客戶：康泰"]}},
    {"question": "期間改成一個月，只看保健品", "answer": "已按最近一個月、保健品整理。"},
]


class FakeLLM:
    def __init__(self, result=None, *, delay=0):
        self.result = result if result is not None else {"suggestions": ["仁和最近一個月的保健品進貨如何？"]}
        self.delay = delay
        self.calls = []

    async def ajson(self, **kwargs):
        self.calls.append(kwargs)
        if self.delay:
            await asyncio.sleep(self.delay)
        if isinstance(self.result, BaseException):
            raise self.result
        return self.result


async def test_suggestions_see_current_selection_filters_and_multiple_prior_pages():
    llm = FakeLLM()
    assert await question_suggestions.suggest(PAGE, EARLIER, ["這家多久沒進貨？"], llm=llm) == ["仁和最近一個月的保健品進貨如何？"]
    state = json.loads(llm.calls[0]["prompt"])
    assert state["page"] == PAGE.model_dump()
    assert state["earlier"] == EARLIER
    assert state["earlier"][0]["page"]["path"] != state["page"]["path"]
    assert state["candidates"] == ["這家多久沒進貨？"]


async def test_only_last_six_turns_and_bounded_answers_are_sent():
    llm = FakeLLM()
    earlier = [{"question": f"第{n}題", "answer": "答" * 2000} for n in range(9)]
    await question_suggestions.suggest(PAGE, earlier, [f"範例{n}" for n in range(12)], llm=llm)
    state = json.loads(llm.calls[0]["prompt"])
    assert [turn["question"] for turn in state["earlier"]] == [f"第{n}題" for n in range(3, 9)]
    assert all(len(turn["answer"]) == 1000 for turn in state["earlier"])
    assert len(state["candidates"]) == 8


async def test_repeated_asked_blank_and_overlong_suggestions_are_removed():
    llm = FakeLLM({"suggestions": [EARLIER[0]["question"], " 新問題？ ", "新問題", "", "長" * 121, None, "另一題？", "第三題？", "第四題？"]})
    assert await question_suggestions.suggest(PAGE, EARLIER, [], llm=llm) == ["新問題？", "另一題？", "第三題？"]


@pytest.mark.parametrize("result", [RuntimeError("offline"), {"suggestions": "bad"}, {"invalid": []}])
async def test_invalid_model_responses_allow_frontend_fallback(result):
    assert await question_suggestions.suggest(PAGE, EARLIER, [], llm=FakeLLM(result)) == []


async def test_unconfigured_model_does_not_block_questions(monkeypatch):
    def unavailable():
        raise RuntimeError("unconfigured")
    monkeypatch.setattr(question_suggestions, "get_llm", unavailable)
    assert await question_suggestions.suggest(PAGE, EARLIER, []) == []


async def test_slow_suggestions_are_cancelled(monkeypatch):
    monkeypatch.setattr(question_suggestions, "TIMEOUT_SECONDS", 0.01)
    assert await question_suggestions.suggest(PAGE, EARLIER, [], llm=FakeLLM(delay=1)) == []


def test_api_accepts_page_and_history_without_creating_an_ask(monkeypatch):
    seen = []
    async def suggest(page, earlier, candidates):
        seen.append((page, earlier, candidates))
        return ["仁和最近一個月的保健品進貨如何？"]
    monkeypatch.setattr(question_suggestions, "suggest", suggest)
    monkeypatch.setitem(app.dependency_overrides, current_user, lambda: object())
    response = TestClient(app).post("/api/asks/suggestions", json={"page": PAGE.model_dump(), "earlier": EARLIER, "candidates": ["這家多久沒進貨？"]})
    assert response.status_code == 200
    assert response.json() == {"suggestions": ["仁和最近一個月的保健品進貨如何？"]}
    assert seen == [(PAGE, EARLIER, ["這家多久沒進貨？"])]


def test_api_requires_login():
    assert TestClient(app).post("/api/asks/suggestions", json={"page": PAGE.model_dump()}).status_code == 401


def test_api_bounds_history_and_page_data(monkeypatch):
    monkeypatch.setitem(app.dependency_overrides, current_user, lambda: object())
    client = TestClient(app)
    assert client.post("/api/asks/suggestions", json={"page": PAGE.model_dump(), "earlier": EARLIER * 4}).status_code == 422
    assert client.post("/api/asks/suggestions", json={"page": {**PAGE.model_dump(), "facts": ["字" * 501]}}).status_code == 422
