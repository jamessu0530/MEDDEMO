"""把逐字稿整理成五個欄位（SDD 的 Field Extraction Service，規則見 docs/visit-fields.md）。

供應商由設定決定；沒設定就丟 NotConfigured，欄位留白讓業務手動填。
"""

import json
from dataclasses import dataclass, field
from datetime import date
from functools import cache
from pathlib import Path
from typing import Any, Protocol

from jsonschema import Draft202012Validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.llm import LLM, get_llm
from app.models import Product

SCHEMA_FILE = Path(__file__).resolve().parents[1] / "schemas" / "visit_fields.schema.json"
FIELD_KEYS = ("competitor", "complaint", "intent", "commitment", "follow_up_date")
WEEKDAYS = "一二三四五六日"

PROMPT = """你是藥品通路業務的助理。下面是業務拜訪客戶後的口述逐字稿，請整理成五個欄位。

規則：
1. 口述裡沒提到的欄位填 null，不要推測，也不要用常識補。陣列欄位沒提到也填 null。
2. 每個有值的欄位，都要在 sources 裡附上它在逐字稿中的原文片段，必須逐字照抄，不可改寫。
3. 相對日期以拜訪日 {visit_date}（星期{weekday}）換算成 YYYY-MM-DD，例如「下週三」。
4. commitment 是這次談定、有期限的一件事。by 填 us（我方答應客戶）或 customer（客戶答應我方）。
5. follow_up_date 只在業務講了「什麼時候再去追」時才填；只講了承諾期限就留 null。
6. complaint 只收客戶對我方產品、配送、價格或服務的不滿；店況觀察（例如某個品項賣得慢）不算。
7. intent 的品項對照下方品項表填 sku；對不到或可能是好幾個品項時 sku 填 null，product_text 保留業務原本的講法。沒講數量 qty 填 null。
8. competitor 的 detail 填競品開的條件或做的事，沒講就填 null。

品項表（sku｜名稱｜單位｜口語別名）：
{catalog}

逐字稿：
{transcript}
"""


@dataclass
class ProductHint:
    sku: str
    name: str
    unit: str
    aliases: list[str]


@dataclass
class Extraction:
    fields: dict[str, Any]
    sources: dict[str, str] = field(default_factory=dict)


class FieldExtractor(Protocol):
    def extract(self, transcript: str, visit_date: date, products: list[ProductHint]) -> Extraction: ...


@cache
def fields_schema() -> dict[str, Any]:
    return json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))


def output_schema() -> dict[str, Any]:
    """交給模型的輸出格式：五個欄位，加上每個有值欄位的逐字稿原文片段。"""
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["fields", "sources"],
        "properties": {
            "fields": fields_schema(),
            # 每個欄位都要列出來，沒有原文的填 null（結構化輸出要求物件的欄位全部明列）
            "sources": {
                "type": "object",
                "additionalProperties": False,
                "required": list(FIELD_KEYS),
                "properties": {key: {"type": ["string", "null"]} for key in FIELD_KEYS},
            },
        },
    }


def build_prompt(transcript: str, visit_date: date, products: list[ProductHint]) -> str:
    catalog = "\n".join(f"{p.sku}｜{p.name}｜{p.unit}｜{'、'.join(p.aliases)}" for p in products)
    return PROMPT.format(
        visit_date=visit_date.isoformat(),
        weekday=WEEKDAYS[visit_date.weekday()],
        catalog=catalog,
        transcript=transcript,
    )


def product_hints(session: Session) -> list[ProductHint]:
    rows = session.execute(select(Product.sku, Product.name, Product.unit, Product.aliases).order_by(Product.sku))
    return [ProductHint(*row) for row in rows]


def empty_fields() -> dict[str, Any]:
    return dict.fromkeys(FIELD_KEYS)


def validate_fields(fields: Any) -> list[str]:
    validator = Draft202012Validator(fields_schema(), format_checker=Draft202012Validator.FORMAT_CHECKER)
    return [f"{'/'.join(map(str, error.path)) or '欄位'}：{error.message}" for error in validator.iter_errors(fields)]


def unsourced_fields(fields: dict[str, Any], sources: dict[str, str], transcript: str) -> list[str]:
    """有值卻對不到逐字稿原文的欄位。確認頁會標出來，請業務自己核對。"""
    return [
        key for key in FIELD_KEYS
        if fields.get(key) is not None and (not sources.get(key) or sources[key] not in transcript)
    ]


def missing_sap_details(fields: dict[str, Any]) -> list[str]:
    """SAP 報價草稿每一行都要有品項與數量，缺的要先在確認頁補齊。"""
    return [
        f"意向第 {number} 項缺少{'品項' if not item.get('sku') else '數量'}"
        for number, item in enumerate(fields.get("intent") or [], start=1)
        if not item.get("sku") or not item.get("qty")
    ]


SYSTEM = "你是藥品通路業務的助理，負責把業務的拜訪口述整理成固定的五個欄位，只寫口述裡真的講到的內容。"


class LLMFieldExtractor:
    """用設定好的 AI 模型抽欄位：規則在 PROMPT，輸出格式由 output_schema() 限制。"""

    def __init__(self, llm: LLM):
        self.llm = llm

    def extract(self, transcript: str, visit_date: date, products: list[ProductHint]) -> Extraction:
        data = self.llm.json(system=SYSTEM, prompt=build_prompt(transcript, visit_date, products), schema=output_schema())
        return Extraction(fields=data["fields"], sources={k: v for k, v in (data.get("sources") or {}).items() if v})


def get_extractor() -> FieldExtractor:
    return LLMFieldExtractor(get_llm())
