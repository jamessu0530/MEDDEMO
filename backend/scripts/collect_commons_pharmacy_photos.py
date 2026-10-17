"""Read Commons file metadata in serial; match full store names and premises.

No image bytes are downloaded. Artist, capture date and published license are
kept with each candidate, and visual exterior verification stays separate.
"""
from __future__ import annotations

import argparse
from html.parser import HTMLParser
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.parse import urlsplit, urlunsplit

import httpx

import collect_outlet_photo_sources as collector
import collect_public_pharmacy_photos as directory

API = "https://commons.wikimedia.org/w/api.php"
CACHE = Path("/private/tmp/meddemo-commons-photo-metadata")
QUERIES = ("屈臣氏 Taiwan", "康是美", "藥局 Taiwan", "藥房 Taiwan", "杏一 Taiwan", "大樹藥局", "啄木鳥 藥局", "丁丁藥局", "博登 藥局")


class PlainText(HTMLParser):
    def __init__(self, value):
        super().__init__()
        self.text = []
        self.feed(str(value))

    def handle_data(self, value):
        self.text.append(value)


def plain(value):
    return " ".join(PlainText(value).text).strip()


def address_text(value):
    value = re.sub(r"(\d+)號之(\d+)", r"\1之\2號", value).replace("-", "之")
    value = re.sub(r"(\d+(?:之\d+)?)(?:[、,，.]\s*\d+(?:之\d+)?)+號", r"\1號", value)
    value = collector.normalize(value)
    for a, b in {"一": "1", "二": "2", "三": "3", "四": "4", "五": "5", "六": "6", "七": "7", "八": "8", "九": "9", "十": "10"}.items():
        value = re.sub(a + r"(?=段)", b, value)
    return value


def name_text(value):
    return address_text(value.removesuffix("門市").removesuffix("分店").removesuffix("店"))


def identity_matches(record, description):
    text = address_text(description)
    name = name_text(record["name"])
    address = directory.premise(directory.expected_address(record))
    return same_passage(name, address, text)


def same_passage(name, address, text):
    if not name or not address or name not in text or address not in text:
        return False
    # Name and exact premise must describe the same nearby passage.
    return abs(text.index(name) - text.index(address)) < 160


def metadata_page(page):
    info = (page.get("imageinfo") or [{}])[0]
    metadata = info.get("extmetadata", {})
    get = lambda key: plain(metadata.get(key, {}).get("value", ""))
    url = info.get("url", "")
    # These are canonical anonymous file URLs; omit API-added campaign tracking.
    parsed = urlsplit(url)
    if parsed.hostname in {"upload.wikimedia.org", "thumb.wikimedia.org"}:
        url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
    return {"page_id": page["pageid"], "title": page["title"], "image_url": url,
        "page_url": info.get("descriptionurl", ""), "description": get("ImageDescription"),
        "artist": get("Artist"), "capture_date": get("DateTimeOriginal"),
        "license_name": get("LicenseShortName"), "license_url": get("LicenseUrl"),
        "attribution_required": get("AttributionRequired"), "credit": get("Credit")}


def fetch():
    CACHE.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=45, headers={"User-Agent": "MEDDEMO-PhotoResearch/1.0 (private merchant photo research)"}) as client:
        for query in QUERIES:
            target = CACHE / (hashlib.sha256(query.encode()).hexdigest()[:16] + ".json")
            if target.exists():
                continue
            params = {"action": "query", "format": "json", "generator": "search", "gsrsearch": query,
                "gsrnamespace": 6, "gsrlimit": 100, "prop": "imageinfo", "iiprop": "url|extmetadata",
                "iiextmetadatafilter": "ImageDescription|DateTimeOriginal|Artist|LicenseShortName|LicenseUrl|AttributionRequired|Credit", "maxlag": 5}
            response = client.get(API, params=params)
            response.raise_for_status()
            payload = response.json()
            if "error" in payload:
                raise RuntimeError("Commons request stopped: " + payload["error"].get("code", "unknown"))
            result = {"query": query, "source_url": str(response.url), "checked_at": collector.now(),
                "continuation": payload.get("continue"),
                "photos": [metadata_page(p) for p in payload.get("query", {}).get("pages", {}).values()]}
            target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
            print(json.dumps({"query": query, "files": len(result["photos"]), "more_available": bool(result["continuation"])}), flush=True)
            time.sleep(0.7)


def apply():
    files = [json.loads(p.read_text()) for p in sorted(CACHE.glob("*.json"))]
    photos = {p["page_id"]: p for f in files for p in f["photos"]}
    prepared = [(p, address_text(p["description"])) for p in photos.values() if collector.public_url(p["image_url"])]
    data = json.loads(collector.OUTPUT.read_text())
    matched = set()
    for record in data["records"]:
        name = name_text(record["name"])
        address = directory.premise(directory.expected_address(record))
        for photo, description in prepared:
            if not same_passage(name, address, description):
                continue
            matched.add(record["customer_id"])
            if photo["image_url"] not in [p["image_url"] for p in record["candidate_images"]]:
                record["candidate_images"].append({**photo, "kind": "wikimedia_commons", "identity_verified": True,
                    "exterior_verified": False, "reuse_status": "published_license_recorded", "checked_at": collector.now()})
            if photo["page_url"] not in [p["url"] for p in record["source_pages"]]:
                record["source_pages"].append({"url": photo["page_url"], "title": photo["title"], "kind": "wikimedia_commons",
                    "identity_verified": True, "name_evidence": record["name"], "address_evidence": directory.premise(directory.expected_address(record))})
            if not record["verified_exterior_images"]:
                record["status"] = "photo_review_needed"
    data["runs"].append({"mode": "wikimedia_commons_metadata", "checked_at": collector.now(), "metadata_files": len(photos),
        "outlets_matched": len(matched), "queries": [f["query"] for f in files], "firecrawl_credits_used": 0})
    collector.save(data, collector.OUTPUT)
    print(json.dumps({"summary": data["summary"], "commons_outlets_matched": len(matched)}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.fetch:
        fetch()
    if args.apply:
        apply()
