"""送給 Gemini 的結構化輸出 schema 與回應處理：沒有金鑰也能先確認送出去的內容合乎規定、每種回應都接得住。"""

from types import SimpleNamespace

import pytest
from google.genai import types

from app.llm import SUPPORTED_KEYS, GeminiLLM, LLMOutputError, api_schema, check_output
from app.services.data_agent import FINAL_SCHEMA, STEP_SCHEMA
from app.services.extraction import output_schema
from app.services.knowledge import ANSWER_SCHEMA, GRADE_SCHEMA, REWRITE_SCHEMA

ALL_SCHEMAS = [output_schema(), STEP_SCHEMA, FINAL_SCHEMA, GRADE_SCHEMA, REWRITE_SCHEMA, ANSWER_SCHEMA]

# 回應處理測試自己定義 schema，不依賴 knowledge 的 REWRITE_SCHEMA（Task 10 會刪掉它，這裡不該跟著壞）
QUERY_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["query", "reason"],
    "properties": {"query": {"type": "string"}, "reason": {"type": "string"}},
}


def schema_nodes(node):
    """走過 schema 裡的每一個子 schema：properties 底下的每一欄、items、anyOf 的每個分支。"""
    yield node
    for child in node.get("properties", {}).values():
        yield from schema_nodes(child)
    if isinstance(node.get("items"), dict):
        yield from schema_nodes(node["items"])
    for branch in node.get("anyOf", []):
        yield from schema_nodes(branch)


def types_of(node):
    kind = node.get("type")
    return kind if isinstance(kind, list) else [kind]


@pytest.mark.parametrize("schema", ALL_SCHEMAS)
def test_sent_schema_only_uses_keywords_gemini_supports(schema):
    for node in schema_nodes(api_schema(schema)):
        assert set(node) <= SUPPORTED_KEYS


@pytest.mark.parametrize("schema", ALL_SCHEMAS)
def test_every_object_in_the_sent_schema_forbids_extra_properties(schema):
    for node in schema_nodes(api_schema(schema)):
        if "object" in types_of(node):
            assert node.get("additionalProperties") is False


def test_nullable_fields_keep_their_structure():
    fields = api_schema(output_schema())["properties"]["fields"]["properties"]
    assert fields["competitor"]["type"] == ["array", "null"]
    assert fields["competitor"]["items"]["additionalProperties"] is False
    assert fields["follow_up_date"]["type"] == ["string", "null"]
    assert fields["follow_up_date"]["format"] == "date"
    assert "minLength" not in fields["complaint"]


def test_output_that_breaks_the_full_schema_is_rejected_locally():
    blank = dict.fromkeys(["competitor", "complaint", "intent", "commitment"])
    with pytest.raises(LLMOutputError):
        check_output(output_schema(), {"fields": blank | {"follow_up_date": "下週三"}, "sources": {}})


class FakeModels:
    def __init__(self, response: dict):
        self.response = types.GenerateContentResponse.model_validate(response)
        self.calls = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


def gemini_returning(response: dict) -> tuple[GeminiLLM, FakeModels]:
    llm = GeminiLLM(api_key="test", model="gemini-test")
    models = FakeModels(response)
    llm.client = SimpleNamespace(models=models)
    return llm, models


def reply(text: str, finish: str = "STOP") -> dict:
    return {"candidates": [{"content": {"role": "model", "parts": [{"text": text}]}, "finish_reason": finish}]}


def test_sends_schema_and_thinking_level_and_returns_the_json():
    llm, models = gemini_returning(reply('{"query": "近效期退貨", "reason": "改用正式名詞"}'))
    data = llm.json(system="系統", prompt="問題", schema=QUERY_SCHEMA, effort="low")
    assert data == {"query": "近效期退貨", "reason": "改用正式名詞"}
    call = models.calls[0]
    assert call["model"] == "gemini-test"
    assert call["config"].system_instruction == "系統"
    assert call["config"].response_json_schema == api_schema(QUERY_SCHEMA)
    assert call["config"].thinking_config.thinking_level == types.ThinkingLevel.LOW


@pytest.mark.parametrize(
    ("response", "message"),
    [
        (reply('{"query": "近', finish="MAX_TOKENS"), "截斷"),
        ({"candidates": [{"finish_reason": "SAFETY"}]}, "SAFETY"),
        ({"prompt_feedback": {"block_reason": "PROHIBITED_CONTENT"}}, "拒絕"),
        (reply('{"query": "近效期退貨"}'), "格式不符"),
    ],
)
def test_unusable_responses_raise_llm_output_error(response, message):
    llm, _ = gemini_returning(response)
    with pytest.raises(LLMOutputError, match=message):
        llm.json(system="系統", prompt="問題", schema=QUERY_SCHEMA)


class FakeAsyncModels(FakeModels):
    async def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


def gemini_async_returning(response: dict) -> tuple[GeminiLLM, FakeAsyncModels]:
    llm = GeminiLLM(api_key="test", model="gemini-test")
    models = FakeAsyncModels(response)
    llm.client = SimpleNamespace(models=FakeModels(response), aio=SimpleNamespace(models=models))
    return llm, models


async def test_ajson_sends_the_same_config_as_json():
    llm, models = gemini_async_returning(reply('{"query": "近效期退貨", "reason": "改用正式名詞"}'))
    data = await llm.ajson(system="系統", prompt="問題", schema=QUERY_SCHEMA, effort="low")
    assert data == {"query": "近效期退貨", "reason": "改用正式名詞"}
    config = models.calls[0]["config"]
    assert config.response_json_schema == api_schema(QUERY_SCHEMA)
    assert config.thinking_config.thinking_level == types.ThinkingLevel.LOW


async def test_atext_returns_plain_text_without_a_schema():
    llm, models = gemini_async_returning(reply("效期剩 90 天以上才能退 [1]。"))
    assert await llm.atext(system="系統", prompt="問題") == "效期剩 90 天以上才能退 [1]。"
    assert models.calls[0]["config"].response_json_schema is None


async def test_atext_returns_empty_when_the_model_is_blocked():
    llm, _ = gemini_async_returning({"prompt_feedback": {"block_reason": "PROHIBITED_CONTENT"}})
    assert await llm.atext(system="系統", prompt="問題") == ""


async def test_empty_system_is_not_sent_as_a_system_instruction():
    # grader／rewriter 目前整段提示都放在 prompt、system 傳空字串；沒實測過 Gemini API
    # 對空字串 system instruction 的反應，但有回 400 的風險，所以 `_config` 把空字串換成
    # None，這裡確認真的沒有送出去
    llm, models = gemini_async_returning(reply('{"query": "近效期退貨", "reason": "改用正式名詞"}'))
    await llm.ajson(system="", prompt="問題", schema=QUERY_SCHEMA, effort="low")
    assert models.calls[0]["config"].system_instruction is None
