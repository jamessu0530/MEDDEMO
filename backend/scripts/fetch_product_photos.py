"""Download public product photos and build the catalog's SKU-to-photo manifest.

    uv run --project backend python backend/scripts/fetch_product_photos.py

The official stores have fewer photographs than the catalog has pack sizes,
colors, and legacy items. Related pictures are explicitly marked illustrative;
only a matching device model is marked exact. No database writes are needed.
"""

from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
from datetime import date
import gzip
import hashlib
from html import unescape
from html.parser import HTMLParser
from io import BytesIO
import json
from pathlib import Path
import re
import sys
import unicodedata
from urllib.parse import urljoin
import xml.etree.ElementTree as ET

import httpx
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "data/seed"))
import catalog  # noqa: E402

CACHE = Path("/tmp/meddemo-product-photo-cache")
ASSETS = ROOT / "frontend/public/product-photos"
MANIFEST = ROOT / "frontend/src/data/product-photos.json"
SOURCE_INDEX = ROOT / "data/seed/product-photo-sources.json"
MALL = "https://mall.cenrahealthcare.com"
CCPP = "https://www.ccpp.com.tw/_tw/01_product/"
OMRON = "https://omronhealthcare.com.tw"
CLIENT = httpx.Client(
    timeout=25,
    follow_redirects=True,
    limits=httpx.Limits(max_connections=6),
    headers={"User-Agent": "MEDDEMO product photo importer/1.0"},
)


def fetch(url: str) -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / hashlib.sha256(url.encode()).hexdigest()
    if cached.exists():
        return cached.read_bytes()
    response = CLIENT.get(url)
    response.raise_for_status()
    cached.write_bytes(response.content)
    return response.content


def page(url: str) -> str:
    return fetch(url).decode("utf-8", errors="replace")


def plain(value: str) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", value))).strip()


class ProductPage(HTMLParser):
    def __init__(self, content: str, url: str):
        super().__init__(convert_charrefs=True)
        self.url = url
        self.meta: dict[str, str] = {}
        self.links: list[str] = []
        self.cards: list[dict] = []
        self.current: dict | None = None
        self.feed(content)

    def handle_starttag(self, tag: str, attrs: list):
        attrs = dict(attrs)
        if tag == "meta" and attrs.get("property"):
            self.meta[attrs["property"]] = attrs.get("content", "")
        if tag == "a" and attrs.get("href"):
            url = urljoin(self.url, attrs["href"])
            self.links.append(url)
            self.current = {"pageUrl": url, "title": "", "imageUrl": ""}
        if self.current and tag == "img" and attrs.get("src"):
            if not self.current["imageUrl"]:
                self.current["imageUrl"] = urljoin(self.url, attrs["src"])
                self.current["title"] = attrs.get("alt", "")
        if self.current and attrs.get("style"):
            match = re.search(r"background-image:\s*url\(['\"]?([^)'\"]+)", attrs["style"])
            if match:
                self.current["imageUrl"] = urljoin(self.url, match[1])

    def handle_data(self, data: str):
        if self.current:
            self.current["title"] += " " + data.strip()

    def handle_endtag(self, tag: str):
        if tag == "a" and self.current:
            self.current["title"] = plain(self.current["title"])
            self.cards.append(self.current)
            self.current = None


def batch(items: list, function) -> list:
    results = []
    with ThreadPoolExecutor(max_workers=4) as executor:
        jobs = {executor.submit(function, item): item for item in items}
        for count, job in enumerate(as_completed(jobs), start=1):
            try:
                value = job.result()
                if value:
                    results.append(value)
            except Exception as exc:
                print(f"Skipped {jobs[job]}: {exc}", flush=True)
            if count % 40 == 0:
                print(f"Read {count}/{len(items)} pages", flush=True)
    return results


def mall_product(url: str) -> dict | None:
    doc = ProductPage(page(url), url)
    title, image = doc.meta.get("og:title", ""), doc.meta.get("og:image", "")
    if not title or not image or "SalePage" not in image:
        return None
    return {
        "title": re.sub(r"\s*NT\$[\d,]+.*$", "", title),
        "pageUrl": url,
        "imageUrl": image.replace("http://", "https://"),
    }


def ccpp_product(url: str) -> dict | None:
    content = page(url)
    title = re.search(r'class="ListTitle"[^>]*>(.*?)</td>', content, re.S)
    image = re.search(r'<img[^>]+src="([^"]*upfiles/[^"]+)"[^>]+width="330"', content)
    if not title or not image:
        return None
    start = image.end()
    end = content.find('class="Line02"', start)
    return {
        "title": plain(title[1]),
        "keywords": plain(content[start:end])[:800],
        "pageUrl": url,
        "imageUrl": urljoin(url, image[1]),
    }


def collect_sources() -> list[dict]:
    sitemap = gzip.decompress(fetch(MALL + "/Sitemap/sitemap_ShopSalePage.xml.gz"))
    urls = [node.text for node in ET.fromstring(sitemap).iter() if node.tag.endswith("loc")]
    print(f"Reading {len(urls)} official store products", flush=True)
    sources = batch(urls, mall_product)

    # Discover medicine pages through the official category links.
    lists, details = set(), set()
    entry_pages = [CCPP + f"00_overview.aspx?MID1={main}" for main in (4, 5, 6)]
    entry_pages.append(CCPP + "02_detail.aspx?AID=426")
    for doc in batch(entry_pages, lambda url: ProductPage(page(url), url)):
        lists.update(link for link in doc.links if "01_list.aspx" in link)
        details.update(link for link in doc.links if "02_detail.aspx" in link)
    for doc in batch(sorted(lists), lambda url: ProductPage(page(url), url)):
        details.update(link for link in doc.links if "02_detail.aspx" in link)
    print(f"Reading {len(details)} official medicine products", flush=True)
    sources.extend(batch(sorted(details), ccpp_product))

    # Device cards already identify both the photo and the exact model.
    omron_pages = [OMRON + f"/product/classify/{category}" for category in (1, 2, 3, 4, 6, 7, 8, 9, 10, 11)]
    omron_pages.extend(OMRON + f"/product/classify/1?page={number}" for number in (2, 3, 4))
    for doc in batch(omron_pages, lambda url: ProductPage(page(url), url)):
        sources.extend(card for card in doc.cards if "/product/detail/" in card["pageUrl"] and card["imageUrl"])

    # BRACOO's Shopify cards lazy-load images; read each product's public OG tag.
    braces = set()
    for number in range(1, 5):
        url = f"https://www.bracoo.tw/collections/all?page={number}"
        doc = ProductPage(page(url), url)
        braces.update(link for link in doc.links if "/products/" in link)
    for doc in batch(sorted(braces), lambda url: ProductPage(page(url), url)):
        if doc.meta.get("og:image") and doc.meta.get("og:title"):
            sources.append({"title": plain(doc.meta["og:title"]), "pageUrl": doc.url, "imageUrl": urljoin(doc.url, doc.meta["og:image"])})

    # The nutrition store provides useful single-pack pictures as well.
    for number in (1, 2, 3):
        url = "https://www.360care.com.tw/shop" + (f"/page/{number}" if number > 1 else "")
        try:
            doc = ProductPage(page(url), url)
            sources.extend(card for card in doc.cards if "/shop/" in card["pageUrl"] and "/uploads/" in card["imageUrl"])
        except httpx.HTTPError as exc:
            print(f"Skipped nutrition page: {exc}", flush=True)

    unique = {source["imageUrl"]: source for source in sources}
    return sorted(unique.values(), key=lambda source: (source["pageUrl"], source["title"]))


# Match the object in the picture before considering a brand or pack size.
TYPE_RULES = [
    ("pet-supplement", r"(?:寵物|毛毛好室).*(?:益生菌|保健|關節)|雙效益生菌"),
    ("pet-food", r"凍乾|寵物.*(?:零食|食品)"),
    ("pet-cleaner", r"寵物.*(?:噴霧|除臭|清潔)|毛毛好室.*(?:抗菌|噴霧)"),
    ("pet-shampoo", r"寵物.*(?:洗毛|沐浴|洗澡)"),
    ("mask", r"口罩"),
    ("sanitary-pad", r"衛生棉|elis|愛麗思|輕失禁|吸水棉|清爽棉墊|清爽墊|防漏尿|Natura|極淨.*墊|新素肌|超熟睡|裸感|零觸感|護墊|舒爽棉"),
    ("diaper", r"尿褲|尿片|紙尿|愛適多|Attento|褲型|復健褲|運動褲|黏貼型|舒適褲|元氣褲|側背雙防漏|防漏便|Goo.?N|大王CG|大王.*(?:日用|夜用)|兒童.*拉拉褲"),
    ("wet-wipe", r"濕巾|濕紙巾|濕式衛生紙"),
    ("kitchen-paper", r"廚房紙巾|擦手紙|廚房紙抹布"),
    ("toilet-paper", r"衛生紙|捲筒|家庭用紙"),
    ("tissue", r"面紙|保濕紙|柔拭巾|奢侈保濕|環保紙巾"),
    ("denture", r"假牙|固齒|潔牙錠|Polident"),
    ("toothbrush", r"牙刷|牙間刷|刷頭|細潔無隱角|獅王.*(?:小頭|炭纖)|獅王.*刷|舌苔清潔"),
    ("toothpaste", r"牙膏|牙粉|護牙周到|潔牙粉"),
    ("mouthwash", r"漱口|洗口|口氣.*噴劑"),
    ("floss", r"牙線"),
    ("hair-treatment", r"護髮|髮膜|髮油|髮乳|頭皮.*(?:精華|調理)|Hair.*(?:Oil|Mask)|髮.*噴霧"),
    ("conditioner", r"潤髮|潤絲"),
    ("shampoo", r"洗髮|SHAMPOO|菲那絲健髮"),
    ("hand-wash", r"洗手|潔手|乾洗手|料理手"),
    ("soap", r"香皂|抗菌皂|藥皂"),
    ("body-wash", r"沐浴|潔膚|Body.*wash|潔淨露|洗沐"),
    ("laundry", r"洗衣|衣物|柔軟精|奈米樂|奈米洗|衣領袖口"),
    ("cleaner", r"清潔劑|洗潔精|除菌|漂白|廚房.*清潔|浴廁|浴槽|洗碗|潔淨噴霧"),
    ("sunscreen", r"防曬|隔離"),
    ("skin-cleanser", r"洗面|潔顏|卸妝"),
    ("skin-mask", r"面膜"),
    ("skin-care", r"精華|化妝水|乳霜|乳液|安瓶|凝霜|美容|潤膚|KOZI|蔻姿|保養|唇膏|凝乳"),
    ("medical-parts", r"壓脈帶|接頭|濾網|導管|貼片|轉接|變壓器|電池|耳套|管組|桌椅"),
    ("blood-pressure", r"血壓|HEM-|HCR-|HBP-|JPN\d"),
    ("thermometer", r"溫槍|體溫|MC-|溫度計"),
    ("electrotherapy", r"低[周週]波|HV-|磁力贴|磁力貼"),
    ("nebulizer", r"噴霧治療|霧化|吸器|吸入|NE-[CU]"),
    ("scale", r"體脂|體重|HBF-|體組成|體重計"),
    ("knee-brace", r"膝|KS\d|KE\d"),
    ("ankle-brace", r"腳踝|護踝|FS\d"),
    ("waist-brace", r"腰|BP\d|爆汗帶|SE23"),
    ("wrist-brace", r"腕|手掌|手指|護指|WS\d"),
    ("elbow-brace", r"肘|ES\d"),
    ("brace", r"護具|套筒|支撐|護頸|肩部"),
    ("blood-glucose", r"血糖|試紙|採血|glucose"),
    ("cotton-swab", r"棉棒|cotton.*applicator|cotton.*swab"),
    ("medical-dressing", r"紗布|棉球|繃帶|透氣膠|OK繃|醫療膠|gauze"),
    ("disinfectant", r"碘|酒精|消毒"),
    ("eye-drops", r"眼藥|淚液|獅美露|Whiteye|Smile|40EX|Premium|Pure"),
    ("pain-patch", r"貼布|酸痛貼|痠痛貼"),
    ("lozenge", r"喉片|喉糖|樺達"),
    ("antifungal", r"LISIM|黴癒|灰指甲"),
    ("ointment", r"OINT|藥膏|乳膏|凝膠|威鎮"),
    ("syrup", r"糖漿|止咳液|SYRUP"),
    ("injection", r"INJ|VIAL|AMP\b|凍晶|注射|INF\."),
    ("fish-oil", r"魚油|Omega"),
    ("probiotic", r"益生菌|乳酸菌|纖菌"),
    ("calcium", r"鈣|骨營|骨營|固營"),
    ("lutein", r"葉黃素"),
    ("collagen", r"膠原"),
    ("vitamin", r"維[他生]素|維他命|[BCＤD]群|倍多喜|B群|C片|D3|維生素|綜合維他"),
    ("supplement", r"膠原|葡萄籽|蔓越莓|Q10|葡萄糖胺|魚精|薑|欣樂|保健|鋅|鐵劑"),
    ("pill", r"TAB|FCT|F\.C\.T|mg|毫克|錠|CAPSULE|膠囊|C\.B\.|Zan|Slivien"),
    ("bag", r"提袋|袋子|收納袋"),
    ("food", r"食品|餅乾|糖果|蜂蜜|飲料|蛋白|燕麥|豆奶"),
]
BRAND_RULES = [
    ("botanist", r"BOTANIST|BO洗|BO潤|BO護"),
    ("csd", r"中衛|CSD"),
    ("daio", r"大王|elleair|elis|愛麗思|愛適多|Attento|娜舒雅|Goo.?N|GOO.N"),
    ("green", r"綠的"),
    ("smiling", r"百齡"),
    ("lion", r"獅王|獅美露|細潔|NONIO|趣淨|奈米樂"),
    ("paws", r"毛毛好室"),
    ("kozi", r"KOZI"),
    ("finesse", r"菲那絲"),
    ("omron", r"歐姆龍|OMRON|HEM-|HCR-|HBP-|HV-|NE-[CU]|HBF-|MC-|JPN\d"),
    ("bracoo", r"BRACOO|奔酷|\b(?:BP|BB|BS|KS|KP|KB|KE|FS|FP|WS|WB|TP|TB|EP|SE)\d{2}\b"),
    ("cyh", r"中化|360|骨營|固循|倍多|固營"),
]


def profile(name: str, category: str = "") -> tuple[str, str]:
    brand = next((key for key, regex in BRAND_RULES if re.search(regex, name, re.I)), "")
    kind = next((key for key, regex in TYPE_RULES if re.search(regex, name, re.I)), "")
    if category == "慢性處方":
        kind = "injection" if re.search(r"INJ|VIAL|AMP\b|INF\.", name, re.I) else "pill"
    elif category == "保健品" and kind == "pill":
        kind = "supplement"
    if not kind:
        kind = {"慢性處方": "pill", "一般用藥": "pill", "保健品": "supplement", "醫材": "medical-parts"}.get(category, "daily")
    return brand, kind


def normalized(name: str) -> str:
    name = unicodedata.normalize("NFKC", name).lower().replace("中化健康360", "中化360")
    name = name.replace("維生素", "維他命").replace("維他命", "vitamin")
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]", "", name)


def grams(name: str) -> set[str]:
    name = normalized(name)
    return {name[i:i + 2] for i in range(len(name) - 1)}


def products() -> list[dict]:
    rows = [{"sku": p[0], "name": p[1], "category": p[2]} for p in catalog.PRODUCTS + catalog.PROMO_PRODUCTS]
    with (ROOT / "data/seed/products.tsv").open() as file:
        rows.extend({"sku": p["料號"], "name": p["品名"], "category": p["類別"]} for p in csv.DictReader(file, delimiter="\t"))
    assert len({row["sku"] for row in rows}) == len(rows)
    return rows


def pick(product: dict, sources: list[dict]) -> tuple[dict, str]:
    brand, kind = profile(product["name"], product["category"])
    wanted = grams(product["name"])
    models = set(re.findall(r"\b(?:HEM|HCR|HBP|HV|MC|NE|HBF)-[A-Z0-9]+\b", product["name"].upper()))
    same_kind = [source for source in sources if source["kind"] == kind]
    # Stock photographs are representative when the official catalog no longer
    # contains that object. Never claim an exact match based on fuzzy similarity.
    pool = same_kind or [source for source in sources if source["kind"] in {
        "慢性處方": {"pill", "injection"},
        "一般用藥": {"pill", "ointment"},
        "保健品": {"supplement", "vitamin"},
        "醫材": {"medical-parts", "brace"},
        "日用品": {"body-wash", "cleaner", "skin-care"},
    }.get(product["category"], {"body-wash"})]
    # Unclassified daily goods should never pick medicine photos merely because
    # a dosage or item number shares a few characters with a drug's name.
    if kind == "daily":
        pool = [source for source in pool if not source["pageUrl"].startswith(CCPP)]
    assert pool, f"No representative images for {product}"

    def score(source: dict) -> float:
        shared = len(wanted & source["grams"])
        overlap = shared / max(1, len(wanted))
        subtype = 0
        if kind == "vitamin":
            for regex in (r"b群|vitaminb", r"d3|vitamind", r"vitaminc"):
                if re.search(regex, normalized(product["name"])):
                    subtype = 6 if re.search(regex, normalized(source["title"])) else -6
                    break
        return overlap * 10 + shared * .08 + subtype + (3 if brand and source["brand"] == brand else 0) - (.5 if "組" in source["title"] else 0)

    chosen = max(pool, key=score)
    source_models = set(re.findall(r"\b(?:HEM|HCR|HBP|HV|MC|NE|HBF)-[A-Z0-9]+\b", chosen["title"].upper()))
    exact = bool(models and models == source_models and chosen["pageUrl"].startswith(OMRON))
    return chosen, "exact" if exact else "illustrative"


def download(source: dict) -> dict:
    asset_id = hashlib.sha256(source["imageUrl"].encode()).hexdigest()[:16]
    target = ASSETS / (asset_id + ".webp")
    if not target.exists():
        with Image.open(BytesIO(fetch(source["imageUrl"]))) as original:
            picture = ImageOps.exif_transpose(original).convert("RGBA")
            if min(picture.size) < 45:
                raise ValueError("Photo is smaller than a product thumbnail")
            picture.thumbnail((480, 480), Image.Resampling.LANCZOS)
            background = Image.new("RGB", picture.size, "white")
            background.paste(picture, mask=picture.getchannel("A"))
            background.save(target, "WEBP", quality=84, method=6)
    return {
        "id": asset_id,
        "file": "/product-photos/" + target.name,
        "title": source["title"],
        "pageUrl": source["pageUrl"],
        "imageUrl": source["imageUrl"],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Read official product indexes again")
    args = parser.parse_args()
    ASSETS.mkdir(parents=True, exist_ok=True)
    existing = json.loads(SOURCE_INDEX.read_text()) if SOURCE_INDEX.exists() else []
    if args.refresh or not existing:
        # Keep historical/browsed sources when a brand's HTTP endpoint is down.
        sources = list({source["imageUrl"]: source for source in existing + collect_sources()}.values())
        SOURCE_INDEX.write_text(json.dumps(sources, ensure_ascii=False, indent=2) + "\n")
    else:
        sources = existing
    for source in sources:
        source["brand"], source["kind"] = profile(source["title"])
        source["kind"] = source.get("kindOverride", source["kind"])
        if source["pageUrl"].startswith(CCPP) and source["kind"] == "daily":
            if not re.search(r"清淨機|襪|壓力|BRISE", source["title"]):
                source["kind"] = "injection" if re.search(r"INJ|VIAL|注射", source.get("keywords", ""), re.I) else "pill"
        source["grams"] = grams(source["title"] + " " + source.get("keywords", ""))

    rows = products()
    choices = {product["sku"]: pick(product, sources) for product in rows}
    selected = {chosen["imageUrl"]: chosen for chosen, _ in choices.values()}
    print(f"Downloading {len(selected)} pictures for {len(rows)} SKUs", flush=True)
    assets = batch(list(selected.values()), download)
    available = {asset["imageUrl"]: asset for asset in assets}
    usable = [source for source in sources if source["imageUrl"] in available]
    # Re-match failures against downloaded photos so every current SKU has a
    # working local file, even if a source website removes its original image.
    by_sku = {}
    for product in rows:
        chosen, kind = choices[product["sku"]]
        if chosen["imageUrl"] not in available:
            chosen, kind = pick(product, usable)
        by_sku[product["sku"]] = {"source": available[chosen["imageUrl"]]["id"], "kind": kind}
    manifest = {
        "retrievedOn": date(2026, 10, 11).isoformat(),
        "sources": {asset.pop("id"): asset for asset in sorted(assets, key=lambda asset: asset["id"])},
        "products": dict(sorted(by_sku.items())),
    }
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"products": len(by_sku), "photos": len(assets), "matching": Counter(row["kind"] for row in by_sku.values()), "bytes": sum(file.stat().st_size for file in ASSETS.glob("*.webp"))}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    raise SystemExit("Use match_verified_product_photos.py then import_verified_product_photos.py; category-based photo substitution is disabled.")
