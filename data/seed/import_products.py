"""把 Salesforce「產品」清單整頁複製下來的文字，轉成假資料用的真實型錄（data/seed/products.tsv）。

    uv run --project backend python data/seed/import_products.py 商品清單 [商品清單2 ...]

複製下來的每一筆是一段，段跟段之間空一行：產品名稱、料號、產品系列、基礎計量單位，後面接產品中文名稱、
未限制使用量、配銷鍊檢查與狀態（有的沒有中文名稱或狀態）。這裡只取前四欄，庫存不進資料庫。
Salesforce 的清單最多顯示 2000 筆：超過就照產品名稱正反各排一次、分兩份複製，這裡照料號合併。

products.tsv 裡已經有的料號照舊不動，只加新的料號：類別、價錢推錯了直接改那一欄，重跑不會被蓋掉。
原始檔不進 git（.gitignore）。
"""

import argparse
import csv
import hashlib
import re
import sys
from dataclasses import dataclass
from pathlib import Path

# macOS 上 .venv 會被標成隱藏，Python 就略過可編輯安裝的 .pth、找不到 app；直接把 backend 加進搜尋路徑
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

import catalog  # noqa: E402
import generate  # noqa: E402

# 只收賣給客戶的商品。管量不管價（陳列架、立牌）、促銷品（贈品、試用包）、提供服務不收
SELLABLE_SERIES = {"代理品", "成品", "外購品須加工"}
# 清單上出現過的產品系列；不在這裡的段是欄位標題
SERIES_NAMES = SELLABLE_SERIES | {"管量不管價", "促銷品 - 商品", "促銷品 - 成品", "提供服務"}
# 系列是商品、但其實不是賣給客戶的東西
NOT_PRODUCTS = ("預算專用", "檢驗費", "PLACEBO")
# 品名後面接的庫存狀態，資料庫不存
STATUS_SUFFIX = re.compile(r"\.(停產\(有庫存\)|準停產|出清品\(可出不可退\))$")
UNITS = {"每個": "個", "組、件": "組", "Tube軟管": "支"}
TRUNCATED = "超過 2000 筆"

# 類別照品名推，由上往下第一個對到的算（英文不分大小寫）。
# 日用品排最前面：寵物益生菌、除菌酒精濕巾這類，品名裡也有保健品、醫材的字
CATEGORY_RULES = [
    ("日用品", (
        "寵物", "毛毛好室", "洗髮", "潤髮", "護髮", "髮膜", "沐浴", "身體", "牙膏", "牙刷", "牙粉", "潔牙", "牙線", "牙間",
        "漱口", "口氣", "NONIO", "衛生棉", "衛生紙", "面紙", "紙巾", "擦手紙", "濕巾", "洗手", "潔手", "藥皂", "尿", "失禁",
        "護墊", "棉條", "復健褲", "安心褲", "BOTANIST", "洗衣", "清潔", "菲那絲", "洗面", "乳液", "日用", "夜用", "量多", "超薄",
    )),
    ("醫材", (
        "口罩", "血壓", "壓脈帶", "溫槍", "溫度計", "護具", "護膝", "膝蓋", "護腰", "護腕", "護踝", "護肘", "護頸", "套筒",
        "減壓護套", "爆汗帶", "試紙", "血糖", "低週波", "低周波", "體脂", "心電", "超音波", "霧化", "吸器", "濾網", "LINKBOX",
        "繃帶", "紗布", "不織布墊", "棉棒", "棉球", "棉片", "清淨棉", "酒精", "優碘", "護理", "醫療", "醫護箱", "敷料",
        "鏡檢", "熱敷", "ANTI-A", "OMRON", "歐姆龍",
    )),
    ("一般用藥", (
        "眼藥", "獅美露", "睛漾", "OINT", "CREAM", "乳膏", "凝膠", "軟膏", "藥膏", "施美", "噴劑", "LISIM", "胃", "喉", "樺達",
        "貼布",
    )),
]
# 藥：中化自己做的（系列是成品、料號 A、B、C 開頭；D 開頭的成品是乾洗手、藥膏這類，照上面的字推），
# 以及代理的處方藥（品名寫錠劑、膠囊、針劑的英文劑型）
DRUG_CATEGORY = "慢性處方"
DRUG_FORM = re.compile(r"\b(TABS?|TABLETS?|CAPSULES?|INJ|F\.?C\.?T)\b|BERODUAL|AMIYU")
SUPPLEMENT_WORDS = (
    "中化360", "中化健康360", "益生菌", "乳酸菌", "纖菌素", "葉黃素", "魚油", "鈣", "膠原", "B群", "C片", "維他命", "維生素",
    "蜂膠", "袋鼠精", "瑪卡", "沖泡", "欣樂樂愛思", "膠囊", "顆", "粉", "錠",
)
FALLBACK_CATEGORY = "日用品"

# 展示用的虛構出貨價（元）：品名對到的價位帶優先，否則照類別。同一個料號每次算出來都一樣
PRICE_BANDS = [
    (("血壓計",), 1800, 3600),
    (("溫槍",), 900, 1800),
    (("低週波",), 1500, 3000),
    (("護具", "護膝", "護腰", "護踝", "護腕", "套筒"), 350, 900),
    (("口罩",), 80, 250),
]
CATEGORY_PRICE = {
    "保健品": (400, 1500), "慢性處方": (150, 800), "一般用藥": (90, 450), "醫材": (150, 900), "日用品": (60, 400),
}


@dataclass(frozen=True)
class Record:
    name: str
    sku: str
    series: str
    unit: str


def parse(text: str) -> tuple[list[Record], bool]:
    """（每一筆的前四欄, 是不是被 2000 筆的上限切掉了）。欄位標題那幾段沒有料號，跳過。"""
    records = []
    for block in re.split(r"\n\s*\n", text.replace("\r\n", "\n")):
        fields = [line.strip() for line in block.split("\n") if line.strip()]
        if len(fields) >= 6 and fields[2] in SERIES_NAMES:
            records.append(Record(*fields[:4]))
    return records, TRUNCATED in text



def clean_name(name: str) -> str:
    name = "".join(ch for ch in name if ch.isprintable())
    return STATUS_SUFFIX.sub("", name).strip()


def category_of(record: Record) -> str | None:
    """None：系列不是賣給客戶的商品，或是預算、檢驗費這類不是商品的東西。"""
    name = record.name.upper()
    if record.series not in SELLABLE_SERIES or any(word in name for word in NOT_PRODUCTS):
        return None
    for category, words in CATEGORY_RULES:
        if any(word.upper() in name for word in words):
            return category
    if (record.series == "成品" and record.sku[:1] in "ABC") or DRUG_FORM.search(name):
        return DRUG_CATEGORY
    if any(word.upper() in name for word in SUPPLEMENT_WORDS):
        return "保健品"
    return FALLBACK_CATEGORY


def price_of(sku: str, category: str, name: str) -> int:
    low, high = next(((lo, hi) for words, lo, hi in PRICE_BANDS if any(w in name for w in words)), CATEGORY_PRICE[category])
    steps = (high - low) // 10 + 1
    return low + int.from_bytes(hashlib.sha256(sku.encode()).digest()[:4], "big") % steps * 10


def build(records: list[Record], existing: list[dict], taken_skus: set[str], taken_names: set[str]) -> list[dict]:
    """existing 照舊在前，接著新的料號。同名不同料號的，品名後面加料號；已經用掉的名稱也一樣。"""
    seen = taken_skus | {row["料號"] for row in existing}
    fresh: dict[str, tuple[Record, str]] = {}
    for record in records:
        category = category_of(record)
        if category and record.sku not in seen and record.sku not in fresh:
            fresh[record.sku] = (record, category)
    names = [clean_name(record.name) for record, _ in fresh.values()]
    used = taken_names | {row["品名"] for row in existing}
    rows = list(existing)
    for (record, category), name in zip(fresh.values(), names):
        if names.count(name) > 1 or name in used:
            name = f"{name}（{record.sku}）"
        rows.append({
            "料號": record.sku, "品名": name, "類別": category, "單位": UNITS.get(record.unit, record.unit),
            "出貨價": str(price_of(record.sku, category, name)),
        })
    return sorted(rows, key=lambda row: row["料號"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("files", nargs="+", type=Path, help="從 Salesforce 產品清單複製下來的文字檔")
    args = parser.parse_args()

    records = []
    for path in args.files:
        found, truncated = parse(path.read_text(encoding="utf-8", errors="replace"))
        records += found
        print(f"{path}：{len(found)} 筆" + ("（被 Salesforce 切在 2000 筆，倒序再複製一份補齊）" if truncated else ""))

    existing = generate.read_real_products() if generate.REAL_PRODUCTS_FILE.exists() else []
    taken_skus = {p[0] for p in catalog.PRODUCTS} | {p[0] for p in catalog.PROMO_PRODUCTS}
    taken_names = {p[1] for p in catalog.PRODUCTS} | {p[1] for p in catalog.PROMO_PRODUCTS}
    rows = build(records, existing, taken_skus, taken_names)
    with generate.REAL_PRODUCTS_FILE.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=generate.REAL_PRODUCT_COLUMNS, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"products.tsv：原本 {len(existing)} 筆，新增 {len(rows) - len(existing)} 筆，共 {len(rows)} 筆")


if __name__ == "__main__":
    main()
