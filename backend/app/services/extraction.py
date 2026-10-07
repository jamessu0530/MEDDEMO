"""把逐字稿整理成六個欄位（SDD 的 Field Extraction Service，規則見 docs/visit-fields.md）。

供應商由設定決定；沒設定就丟 NotConfigured，欄位留白讓業務手動填。
"""

import json
from collections.abc import Sequence
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
from app.services.promo_packs import Pack, packs_by_code

SCHEMA_FILE = Path(__file__).resolve().parents[1] / "schemas" / "visit_fields.schema.json"
FIELD_KEYS = ("competitor", "complaint", "intent", "commitment", "follow_up_date", "notes")
WEEKDAYS = "一二三四五六日"

PROMPT = """你是藥品通路業務的助理。下面是業務拜訪客戶後的口述逐字稿，請整理成六個欄位。

規則：
1. 口述裡沒提到的欄位填 null，不要推測，也不要用常識補。陣列欄位沒提到也填 null。
2. 每個有值的欄位，都要在 sources 裡附上它在逐字稿中的原文片段，必須逐字照抄，不可改寫。
3. 相對日期以拜訪日 {visit_date}（星期{weekday}）換算成 YYYY-MM-DD，例如「下週三」。
4. commitment 是這次談定、有期限的一件事。by 填 us（我方答應客戶）或 customer（客戶答應我方）。
5. follow_up_date 只在業務講了「什麼時候再去追」時才填；只講了承諾期限就留 null。
6. complaint 只收客戶對我方產品、配送、價格或服務的不滿；店況觀察（例如某個品項賣得慢）不算。
7. intent 的品項對照下方品項表填 sku；對不到或可能是好幾個品項時 sku 填 null，product_text 保留業務原本的講法。沒講數量 qty 填 null。
8. competitor 的 detail 填競品開的條件或做的事，沒講就填 null。
9. intent 講到促銷的口才填 promo_code：業務講了小口、中口、大口，或講了幾口、某一口的搭贈（例如「買 11 送 2」「直走」），而且對得到下方促銷表裡唯一的一口，promo_code 填那一口的編號、sku 填那一口的 sku、qty 填口數、unit 填「口」。講了口但沒講幾口算 1 口。沒講口就照第 7 條填數量，promo_code 填 null。講了口卻對不到唯一的一口（例如好幾個品項都有小口），sku 與 promo_code 都填 null，product_text 照原話。
10. notes 收兩種：bring 是業務說下次要帶給客戶的東西（DM、POP、海報、試用包、樣品、衛教單張、比價表…）；told 是業務跟客戶講了哪些促銷、實銷、搭贈、活動條件。text 用業務的講法、精簡成一句。date 只在業務講了哪天要帶、或下次哪天去時才填（照第 3 條換算），told 一律填 null。可以跟 commitment、intent 重複，例如「我答應下次帶比價表」兩邊都填。

品項表（sku｜名稱｜單位｜口語別名）：
{catalog}

這一期的促銷（編號｜sku｜名稱｜搭贈）：
{packs}

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
    def extract(
        self, transcript: str, visit_date: date, products: list[ProductHint], packs: Sequence[Pack] = ()
    ) -> Extraction: ...


@cache
def fields_schema() -> dict[str, Any]:
    return json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))


def output_schema() -> dict[str, Any]:
    """交給模型的輸出格式：六個欄位，加上每個有值欄位的逐字稿原文片段。"""
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


def build_prompt(transcript: str, visit_date: date, products: list[ProductHint], packs: Sequence[Pack] = ()) -> str:
    catalog = "\n".join(f"{p.sku}｜{p.name}｜{p.unit}｜{'、'.join(p.aliases)}" for p in products)
    pack_table = "\n".join(f"{p.code}｜{p.sku}｜{p.name}｜{p.deal}" for p in packs) or "（這一期沒有促銷）"
    return PROMPT.format(
        visit_date=visit_date.isoformat(),
        weekday=WEEKDAYS[visit_date.weekday()],
        catalog=catalog,
        packs=pack_table,
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


def drop_unknown_packs(intent: list[dict[str, Any]] | None, packs: Sequence[Pack]) -> list[dict[str, Any]] | None:
    """AI 抽出的口不是這一期的、或跟品項對不上：品項與口都清掉，讓確認頁標「缺少品項」請業務選。
    數量是口數，只清口的話會變成 1 盒。"""
    if not intent:
        return intent
    by_code = {p.code: p for p in packs}

    def check(item: dict[str, Any]) -> dict[str, Any]:
        code = item.get("promo_code")
        if code and (code not in by_code or by_code[code].sku != item.get("sku")):
            return {**item, "sku": None, "promo_code": None}
        return item

    return [check(item) for item in intent]


def intent_pack_problems(session: Session, intent: list[dict[str, Any]] | None) -> list[str]:
    """確認頁存檔時檢查：有口的項目，那一口要存在、而且是同一個品項。不檢查期別，確認頁只列進行中的口。"""
    items = intent or []
    found = packs_by_code(session, (i["promo_code"] for i in items if i.get("promo_code")))
    problems = []
    for number, item in enumerate(items, start=1):
        if not (code := item.get("promo_code")):
            continue
        if code not in found:
            problems.append(f"意向第 {number} 項的促銷 {code} 不存在")
        elif found[code].sku != item.get("sku"):
            problems.append(f"意向第 {number} 項的促銷不是這個品項")
    return problems


SYSTEM = "你是藥品通路業務的助理，負責把業務的拜訪口述整理成固定的六個欄位，只寫口述裡真的講到的內容。"


class LLMFieldExtractor:
    """用設定好的 AI 模型抽欄位：規則在 PROMPT，輸出格式由 output_schema() 限制。"""

    def __init__(self, llm: LLM):
        self.llm = llm

    def extract(
        self, transcript: str, visit_date: date, products: list[ProductHint], packs: Sequence[Pack] = ()
    ) -> Extraction:
        prompt = build_prompt(transcript, visit_date, products, packs)
        data = self.llm.json(system=SYSTEM, prompt=prompt, schema=output_schema())
        return Extraction(fields=data["fields"], sources={k: v for k, v in (data.get("sources") or {}).items() if v})


def get_extractor() -> FieldExtractor:
    return LLMFieldExtractor(get_llm())
