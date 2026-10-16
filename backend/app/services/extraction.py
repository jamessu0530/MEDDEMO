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

from app.llm import LLM, Media, get_llm
from app.models import Product
from app.services.promo_packs import Pack, packs_by_code
from app.services.speech_names import NameMatcher, recent_product_skus

SCHEMA_FILE = Path(__file__).resolve().parents[1] / "schemas" / "visit_fields.schema.json"
FIELD_KEYS = ("competitor", "complaint", "intent", "commitment", "follow_up_date", "notes")
# sources 還多一格 repeat_last：講「跟上次一樣」的原話
SOURCE_KEYS = (*FIELD_KEYS, "repeat_last")
WEEKDAYS = "一二三四五六日"

PROMPT = """你是藥品通路業務的助理。下面是業務拜訪客戶後的口述逐字稿，請整理成六個欄位，另外判斷這次是不是照上次的單下（repeat_last）。

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
11. repeat_last 是照上次的單：業務講了「跟上次一樣」「照上次」「老樣子」這類話，表示這次照上次那張單再下一次，all 填 true；說這次不要的品項（例如「威鎮這次先不要」）對照品項表把 sku 填進 except_skus。都沒講就整個 repeat_last 填 null，sources 的 repeat_last 照第 2 條附原文。
12. 業務講跟上次比的加減（例如「再加一口小口 Premium」「魚油比上次少 5 盒」「人工淚液照上次」），填進 repeat_last.relative：品項與口照第 7、9 條對，delta 是加減的數量（口是口數，少就是負數，照上次填 0）；這些不要再填進 intent。講了確定的總數（例如「魚油這次 40 盒」）才照第 7 條填 intent。只講加減、沒講跟上次一樣時 all 填 false。講了品名與口數、沒講哪一口（例如「Premium 再加一口」）時，sku 照品項表填、promo_code 填 null，由後端對到上次訂的那一口；這種加減不適用第 9 條「對不到唯一的一口」。
13. 逐字稿可能是台語漢字或華台語混講。只有語意明確時，欄位中的敘述才用台灣繁體中文華語整理；品名、數量、單位、金額、劑量、日期與承諾不能改。台語「拜五」是星期五，「兩口」的單位仍是口，「毋愛」是否定，不可漏掉。sources 仍逐字引用台語原文，不要把翻譯當作原文。疑似辨識錯字不能靠諧音或常識猜成品名、單位或日期；例如「拜鼓」無法確定是星期幾，不可改成「星期五」，due 與 date 必須填 null，敘述保留不清楚的原話。不確定的品名保留原話、sku 填 null；不確定的數量或單位填 null。
14. 逐字稿也可能是英語、日語、印尼語、越南語、泰語或多語混講。欄位敘述翻譯成台灣繁體中文華語，但 sources 必須逐字照抄原語言，不可引用翻譯；intent.product_text 保留原本的品名講法。翻譯不可增加原文沒有的數量、單位、金額、劑量、日期或承諾，也不可漏掉否定。只有原文語意明確、對得上唯一品項時才填 sku；不確定的數量、單位與日期填 null。
15. 品項表包含常用品項與從完整型錄找到的相關候選；候選不代表業務已提到，更不代表已確定規格。同名的不同劑量、容量、尺寸不能互換；未明確指定且對到多個 SKU 時填 null。

品項表（sku｜名稱｜單位｜口語別名）：
{catalog}

這一期的促銷（編號｜sku｜名稱｜搭贈）：
{packs}

逐字稿：
{transcript}
"""

NAME_AUDIO_PROMPT = """
另附這次拜訪的原始錄音，僅用來核對逐字稿中已提及的藥品、競品與商家名稱，包含台語與華台語混講。
下列只是名稱候選，不是已確認的辨識結果：
{terms}
必須聽到明確的名稱、且對得上唯一品項，才可用正式名稱或 sku；近音候選不能直接當答案。
不可因為附了錄音而新增逐字稿沒有的事件，或改動數量、單位、金額、劑量、日期、承諾與否定。
intent.product_text 與 sources 仍必須保留逐字稿原話，不能把核對後的名稱冒充原文。不確定就保留原話、sku 填 null。
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
    # 照上次的單（REPEAT_SCHEMA）；沒講是 None。展開在 services/repeat_order.py
    repeat_last: dict[str, Any] | None = None


class FieldExtractor(Protocol):
    def extract(
        self, transcript: str, visit_date: date, products: list[ProductHint], packs: Sequence[Pack] = (),
        *, name_audio: Media | None = None, name_terms: Sequence[str] = (),
    ) -> Extraction: ...


@cache
def fields_schema() -> dict[str, Any]:
    return json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))


REPEAT_SCHEMA: dict[str, Any] = {
    "description": "照上次的單：講了跟上次一樣、這次不要哪些、跟上次比的加減；都沒講是 null",
    "type": ["object", "null"],
    "additionalProperties": False,
    "required": ["all", "except_skus", "relative"],
    "properties": {
        "all": {"type": "boolean", "description": "講了跟上次一樣、照上次、老樣子：照整張再下一次"},
        "except_skus": {"type": "array", "items": {"type": "string"}, "description": "這次不要的品項"},
        "relative": {
            "type": "array",
            "description": "跟上次比的加減",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["product_text", "sku", "promo_code", "delta"],
                "properties": {
                    "product_text": {"type": "string", "minLength": 1, "description": "口述原本的講法"},
                    "sku": {"type": ["string", "null"], "description": "對不到唯一品項時為 null"},
                    "promo_code": {"type": ["string", "null"], "description": "講到促銷的口才填"},
                    "delta": {"type": "integer", "description": "跟上次比加減多少；口是口數，照上次是 0"},
                },
            },
        },
    },
}


def output_schema() -> dict[str, Any]:
    """交給模型的輸出格式：六個欄位、每個有值欄位的逐字稿原文片段，加上照上次的單（repeat_last）。"""
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["fields", "sources", "repeat_last"],
        "properties": {
            "fields": fields_schema(),
            # 每個欄位都要列出來，沒有原文的填 null（結構化輸出要求物件的欄位全部明列）
            "sources": {
                "type": "object",
                "additionalProperties": False,
                "required": list(SOURCE_KEYS),
                "properties": {key: {"type": ["string", "null"]} for key in SOURCE_KEYS},
            },
            "repeat_last": REPEAT_SCHEMA,
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


MAX_EXTRA_PRODUCTS = 32


def product_hints(session: Session, transcript: str = "", customer_id: str | None = None) -> list[ProductHint]:
    """常用品項、這家最近進過的品項，加上完整型錄的相關候選。"""
    recent = set(session.scalars(recent_product_skus(customer_id))) if customer_id else set()
    query = select(Product.sku, Product.name, Product.unit, Product.aliases, Product.common).order_by(Product.sku)
    if not transcript.strip():
        query = query.where(Product.common | Product.sku.in_(recent))
    common, matched = [], []
    matcher = NameMatcher(transcript)
    for sku, name, unit, aliases, is_common in session.execute(query):
        hint = ProductHint(sku, name, unit, aliases)
        if is_common or sku in recent:
            common.append(hint)
        elif match := matcher.match([sku, name, *aliases], partial=True):
            matched.append((match.score, hint))
    # 依吻合程度挑相關候選；共同口語名的規格群若超過上限，整群略過，避免只留下某個規格而誤選。
    matched.sort(key=lambda item: (-item[0], item[1].sku))
    extra = matched[:MAX_EXTRA_PRODUCTS]
    if len(matched) > MAX_EXTRA_PRODUCTS:
        cutoff = matched[MAX_EXTRA_PRODUCTS][0]
        extra = [item for item in extra if item[0] > cutoff]
    return common + [hint for _, hint in extra]


def drop_unknown_products(intent: list[dict[str, Any]] | None, products: list[ProductHint]) -> list[dict[str, Any]] | None:
    """模型猜出候選清單外的料號時留給使用者選，不把不存在的料號送去回寫。"""
    allowed = {p.sku for p in products}
    return [({**item, "sku": None, "promo_code": None} if item.get("sku") and item["sku"] not in allowed else item)
        for item in intent] if intent else intent


def empty_fields() -> dict[str, Any]:
    return dict.fromkeys(FIELD_KEYS)


def validate_fields(fields: Any) -> list[str]:
    validator = Draft202012Validator(fields_schema(), format_checker=Draft202012Validator.FORMAT_CHECKER)
    return [f"{'/'.join(map(str, error.path)) or '欄位'}：{error.message}" for error in validator.iter_errors(fields)]


def validate_repeat(value: Any) -> list[str]:
    """AI 回的「照上次的單」要符合 REPEAT_SCHEMA（缺 delta 這類）才拿去展開，免得悄悄展成錯的單。"""
    validator = Draft202012Validator(REPEAT_SCHEMA)
    return [f"{'/'.join(map(str, error.path)) or '照上次'}：{error.message}" for error in validator.iter_errors(value)]


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
        self, transcript: str, visit_date: date, products: list[ProductHint], packs: Sequence[Pack] = (),
        *, name_audio: Media | None = None, name_terms: Sequence[str] = (),
    ) -> Extraction:
        prompt = build_prompt(transcript, visit_date, products, packs)
        if name_audio:
            prompt += NAME_AUDIO_PROMPT.format(terms="、".join(dict.fromkeys(name_terms)))
        kwargs = {"media": [name_audio]} if name_audio else {}
        data = self.llm.json(system=SYSTEM, prompt=prompt, schema=output_schema(), **kwargs)
        return Extraction(
            fields=data["fields"],
            sources={k: v for k, v in (data.get("sources") or {}).items() if v},
            repeat_last=data.get("repeat_last"),
        )


def get_extractor() -> FieldExtractor:
    return LLMFieldExtractor(get_llm())
