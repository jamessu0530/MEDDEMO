"""測試語料本身要對得上評分規則：標準答案餵回去要全對、格式要合法、品項要存在。

量出來的正確率會拿去當出場條件的數字，語料或評分寫錯，數字就不能信。
"""

import importlib.util
import json
from pathlib import Path

import catalog
import pytest

from app.services.extraction import FIELD_KEYS, validate_fields

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("eval_voice", ROOT / "backend" / "scripts" / "eval_voice.py")
eval_voice = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(eval_voice)

ITEMS = json.loads((ROOT / "data" / "eval" / "voice_corpus.json").read_text(encoding="utf-8"))["items"]
SKUS = {row[0] for row in catalog.PRODUCTS}


def as_fields(expected):
    """把標準答案轉成系統輸出的格式，等於一份「全部答對」的抽取結果。"""
    commitment = expected["commitment"]
    return {
        "competitor": [{"name": name, "detail": None} for name in expected["competitor"]] if expected["competitor"] else None,
        "complaint": expected["complaint"],
        "intent": [{"product_text": sku, "sku": sku, "qty": qty, "unit": None} for sku, qty in expected["intent"]]
        if expected["intent"]
        else None,
        "commitment": {"by": commitment["by"], "text": commitment["keyword"], "due": commitment["due"]} if commitment else None,
        "follow_up_date": expected["follow_up_date"],
    }


@pytest.mark.parametrize("item", ITEMS, ids=lambda item: item["id"])
def test_the_gold_answer_scores_full_marks_and_is_valid(item):
    fields = as_fields(item["expected"])
    assert validate_fields(fields) == []
    assert all(eval_voice.is_correct(key, item["expected"][key], fields[key]) for key in FIELD_KEYS)
    assert all(sku in SKUS for sku, _ in item["expected"]["intent"] or [])


def test_filling_a_field_that_was_not_mentioned_counts_as_wrong():
    routine = next(item for item in ITEMS if item["id"] == "04")
    assert not eval_voice.is_correct("complaint", routine["expected"]["complaint"], "店長說一切正常")


def test_character_error_rate_ignores_punctuation():
    assert eval_voice.char_error_rate("魚油二十盒。", "魚油二十盒") == 0
    assert eval_voice.char_error_rate("魚油二十盒", "魚由二十盒") == 0.2
