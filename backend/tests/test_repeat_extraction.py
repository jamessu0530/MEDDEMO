"""AI 聽出「跟上次一樣」：輸出格式與提示（services/extraction.py）。展開在 test_repeat_order.py。"""

from datetime import date

from app.llm import api_schema
from app.services import extraction

FIELDS = dict.fromkeys(extraction.FIELD_KEYS)


class FakeLLM:
    def __init__(self, data):
        self.data = data

    def json(self, *, system, prompt, schema, effort="medium", media=()):
        self.prompt, self.schema = prompt, schema
        return self.data


def test_the_output_has_repeat_last_next_to_the_fields():
    schema = extraction.output_schema()
    assert schema["required"] == ["fields", "sources", "repeat_last"]
    repeat = schema["properties"]["repeat_last"]
    assert repeat["type"] == ["object", "null"]
    assert repeat["required"] == ["all", "except_skus", "relative"]
    assert repeat["properties"]["relative"]["items"]["required"] == ["product_text", "sku", "promo_code", "delta"]
    assert "repeat_last" in schema["properties"]["sources"]["required"]
    # Gemini 只收得到支援的關鍵字；送出前清掉的不影響結構
    assert api_schema(schema)["properties"]["repeat_last"]["required"] == ["all", "except_skus", "relative"]


def test_the_prompt_explains_same_as_last_time_and_relative_changes():
    prompt = extraction.build_prompt("逐字稿", date(2026, 10, 28), [], [])
    assert "repeat_last" in prompt and "跟上次一樣" in prompt and "except_skus" in prompt and "relative" in prompt
    assert "delta" in prompt and "照上次填 0" in prompt
    assert "沒講哪一口" in prompt and "promo_code 填 null" in prompt


def test_the_extractor_passes_repeat_last_through():
    repeat = {"all": True, "except_skus": ["D120013"], "relative": []}
    llm = FakeLLM({"fields": FIELDS, "sources": {"repeat_last": "跟上次一樣就好", "intent": None}, "repeat_last": repeat})
    found = extraction.LLMFieldExtractor(llm).extract("跟上次一樣就好", date(2026, 10, 28), [])
    assert found.repeat_last == repeat and found.sources == {"repeat_last": "跟上次一樣就好"}
    assert extraction.LLMFieldExtractor(FakeLLM({"fields": FIELDS, "sources": {}, "repeat_last": None})).extract(
        "魚油二十盒", date(2026, 10, 28), []
    ).repeat_last is None
