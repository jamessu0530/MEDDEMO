"""Match public pharmacy covers using NHI identifiers, names and full premises.

The NHI registry only supplies discovery identifiers. A photo is accepted into
the candidate queue only after the directory page's own name/address match.
No search result, nearby business, Google photo or related-store image is used.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
from threading import Event
import unicodedata
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

from defusedxml import ElementTree
import httpx

import collect_outlet_photo_sources as collector

NHI_URL = "https://info.nhi.gov.tw/api/iode0000s01/Dataset?rId=A21030000I-D21005-001"
CACHE = Path("/private/tmp/meddemo-ppi-photo-cache")


def premise(address):
    address = collector.first_premise(address)
    for chinese, arabic in {"一": "1", "二": "2", "三": "3", "四": "4", "五": "5", "六": "6", "七": "7", "八": "8", "九": "9", "十": "10"}.items():
        address = re.sub(chinese + r"(?=段)", arabic, address)
    return address.replace("-", "之")


def expected_address(record):
    address = re.sub(r"\s+", "", unicodedata.normalize("NFKC", record["address"]).replace("臺", "台"))
    city, district = collector.normalize(record["city"]), collector.normalize(record["district"])
    if city not in address:
        address = city + (district if not address.startswith(district) else "") + address
    elif address.startswith(city) and not address.startswith(city + district):
        address = city + district + address[len(city):]
    return address


def identity_matches(record, place):
    if collector.normalize(record["name"]) != collector.normalize(place.get("name", "")):
        return False
    address = place.get("address", {}).get("streetAddress", "")
    city_area = collector.normalize(record["city"] + record["district"])
    expected, actual = premise(expected_address(record)), premise(address)
    if not (city_area and city_area in collector.normalize(address) and expected and actual):
        return False
    if expected == actual:
        return True
    # Village names are optional address components. Require the same telephone
    # as additional evidence before accepting the omission of a village name.
    def without_village(value):
        if value.startswith(city_area):
            value = city_area + re.sub(r"^[\u4e00-\u9fff]{2,5}[里村](?=[\u4e00-\u9fff]{2,}(?:路|街))", "", value[len(city_area):], count=1)
        return value
    return bool(collector.phone(record.get("phone", "")) and
        collector.phone(record.get("phone", "")) == collector.phone(place.get("telephone", "")) and
        without_village(expected) == without_village(actual))


class StructuredPlaces(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.inside, self.text, self.places = False, "", []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        if tag == "script" and dict(attrs).get("type") == "application/ld+json":
            self.inside, self.text = True, ""

    def handle_data(self, value):
        if self.inside:
            self.text += value

    def handle_endtag(self, tag):
        if tag != "script" or not self.inside:
            return
        self.inside = False
        try:
            data = json.loads(self.text)
        except (ValueError, TypeError):
            return
        for item in data.get("@graph", [data]) if isinstance(data, dict) else []:
            if isinstance(item, dict) and item.get("@type") == "Place" and isinstance(item.get("address"), dict):
                self.places.append(item)


def load_registry(path):
    raw = path.read_bytes()
    records = [{"id": r["醫事機構代碼"], "name": r["醫事機構名稱"], "phone": r["電話"], "address": r["地址"]}
        for r in csv.DictReader(raw.decode("utf-8-sig").splitlines())]
    return {"source_url": NHI_URL, "dataset_page": "https://data.gov.tw/dataset/39284",
        "retrieved_at": collector.now(), "sha256": hashlib.sha256(raw).hexdigest(), "records": records}


def discovery(record, by_name, by_phone):
    matches = by_name[collector.normalize(record["name"])]
    telephone = collector.phone(record["phone"])
    local = [p for p in matches if collector.normalize(record["city"] + record["district"]) in collector.normalize(p["address"])]
    if telephone:
        local += [p for p in by_phone[telephone] if collector.normalize(p["name"]) == collector.normalize(record["name"])]
    return list({p["id"]: p for p in local}.values())


def search_directory_urls(record, known_urls):
    """Use only public search links and sitemap-listed medical identifiers."""
    found = set()
    for page in record.get("source_pages", []):
        if page.get("kind") != "standard_web_search":
            continue
        parsed = urlsplit(page["url"])
        match = None
        if parsed.hostname == "ppi.tw":
            match = re.fullmatch(r"/pharmacy/([0-9A-Z]{10})/?", parsed.path)
        elif parsed.hostname == "ma.olc.tw":
            match = re.fullmatch(r"/institution/([0-9A-Z]{10})/?", parsed.path)
        if match:
            url = "https://ppi.tw/pharmacy/" + match[1]
            if url in known_urls:
                found.add(url)
    return found


def sitemap_urls(client):
    target = CACHE / "sitemap-urls.json"
    if target.exists():
        return set(json.loads(target.read_text()))
    response = client.get("https://ppi.tw/sitemap.xml")
    response.raise_for_status()
    root = ElementTree.fromstring(response.content)
    maps = [e.text for e in root.iter() if e.tag.endswith("}loc")]
    urls = set()
    for url in maps:
        if not url.startswith("https://ppi.tw/sitemap.xml?"):
            continue
        response = client.get(url)
        response.raise_for_status()
        page = ElementTree.fromstring(response.content)
        urls.update(e.text for e in page.iter() if e.tag.endswith("}loc") and re.fullmatch(r"https://ppi.tw/pharmacy/[0-9A-Z]{10}", e.text or ""))
        time.sleep(0.15)
    target.write_text(json.dumps(sorted(urls)))
    return urls


def fetch_place(client, url, stop=None):
    if stop is not None and stop.is_set():
        return {"url": url, "error": "cancelled"}
    target = CACHE / (url.rsplit("/", 1)[-1] + ".json")
    if target.exists():
        return json.loads(target.read_text())
    try:
        response = client.get(url)
        if response.status_code in {403, 429}:
            if stop is not None:
                stop.set()
            return {"error": f"http_{response.status_code}", "url": url}
        response.raise_for_status()
        # Only JSON-LD describing this exact page, never images in the related
        # pharmacy cards or a generic og:image/logo.
        places = [p for p in StructuredPlaces(response.text).places if p.get("url") == url]
        result = {"url": url, "places": places, "retrieved_at": collector.now()}
        target.write_text(json.dumps(result, ensure_ascii=False))
        time.sleep(0.4)
        return result
    except httpx.HTTPError:
        return {"error": "fetch_failed", "url": url}


def attach(record, result):
    checks = record.setdefault("directory_checks", [])
    checks[:] = [c for c in checks if c["url"] != result["url"]]
    if result.get("error"):
        checks.append({"url": result["url"], "status": result["error"]})
        return
    matches = [p for p in result.get("places", []) if identity_matches(record, p)]
    if len(matches) != 1:
        checks.append({"url": result["url"], "status": "identity_review_needed",
            "observed": [{"name": p.get("name"), "address": p.get("address", {}).get("streetAddress")} for p in result.get("places", [])]})
        return
    place = matches[0]
    image_object = place.get("image")
    image = image_object.get("url", "") if isinstance(image_object, dict) else ""
    checks.append({"url": result["url"], "status": "identity_matched", "name_evidence": place["name"],
        "address_evidence": place["address"]["streetAddress"], "phone_evidence": place.get("telephone", "")})
    if not re.match(r"^https://ppi\.tw/sites/default/files/cover/", image) or re.search(r"(?:default|placeholder|logo|no.image)", urlsplit(image).path.rsplit("/", 1)[-1], re.I):
        return
    if image not in [p["image_url"] for p in record["candidate_images"]]:
        record["candidate_images"].append({"image_url": image, "page_url": result["url"],
            "identity_verified": True, "exterior_verified": False, "kind": "public_directory_cover",
            "reuse_status": "permission_not_checked", "checked_at": collector.now()})
    if result["url"] not in [p["url"] for p in record["source_pages"]]:
        record["source_pages"].append({"url": result["url"], "title": place["name"], "kind": "public_directory",
            "identity_verified": True, "address_evidence": place["address"]["streetAddress"]})
    if not record["verified_exterior_images"]:
        record["status"] = "photo_review_needed"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry-csv", type=Path)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--workers", type=int, choices=(1, 2, 3, 4), default=3)
    parser.add_argument("--recheck-cached", action="store_true")
    parser.add_argument("--include-search-sources", action="store_true")
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    registry_file = collector.ROOT / "data/public-outlets/pharmacy-registry-20261017.json"
    if args.registry_csv:
        registry = load_registry(args.registry_csv)
        registry_file.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n")
    else:
        registry = json.loads(registry_file.read_text())
    by_name, by_phone = defaultdict(list), defaultdict(list)
    for row in registry["records"]:
        by_name[collector.normalize(row["name"])].append(row)
        by_phone[collector.phone(row["phone"])].append(row)
    data = json.loads(collector.OUTPUT.read_text())
    with httpx.Client(timeout=25, follow_redirects=True, headers={"User-Agent": "MEDDEMO-PhotoResearch/1.0"},
                      limits=httpx.Limits(max_connections=args.workers, max_keepalive_connections=args.workers)) as client:
        robots_response = client.get("https://ppi.tw/robots.txt")
        robots_response.raise_for_status()
        robots = RobotFileParser()
        robots.parse(robots_response.text.splitlines())
        urls = sitemap_urls(client)
        queue = defaultdict(list)
        for record in data["records"]:
            candidates = discovery(record, by_name, by_phone)
            record["registry_photo_lookup"] = {"source_url": NHI_URL, "candidate_ids": [c["id"] for c in candidates], "checked_at": collector.now()}
            checked = set() if args.recheck_cached else {c["url"] for c in record.get("directory_checks", []) if c["status"] in {"identity_matched", "identity_review_needed"}}
            for candidate in candidates:
                url = "https://ppi.tw/pharmacy/" + candidate["id"]
                if url in urls and url not in checked and robots.can_fetch("MEDDEMO-PhotoResearch", url):
                    queue[url].append(record)
            if args.include_search_sources:
                for url in search_directory_urls(record, urls):
                    if url not in checked and record not in queue[url] and robots.can_fetch("MEDDEMO-PhotoResearch", url):
                        queue[url].append(record)
        targets = list(queue)[:args.limit]
        run = {"mode": "public_directory", "started_at": collector.now(), "pages_planned": len(targets), "pages_checked": 0}
        data["runs"].append(run)
        collector.save(data, collector.OUTPUT)
        print(f'Found {len(queue)} directory pages from NHI identifiers; processing {len(targets)}', flush=True)
        stop = Event()
        try:
            with ThreadPoolExecutor(args.workers) as pool:
                for result in pool.map(lambda url: fetch_place(client, url, stop), targets):
                    for record in queue[result["url"]]:
                        attach(record, result)
                    run["pages_checked"] += 1
                    if run["pages_checked"] % 50 == 0:
                        collector.save(data, collector.OUTPUT)
                        print(json.dumps({"pages_checked": run["pages_checked"], "with_photos": data["summary"]["outlets_with_candidate_images"]}), flush=True)
                    if result.get("error") in {"http_403", "http_429"}:
                        run["stopped_reason"] = result["error"]
                        break
        except KeyboardInterrupt:
            run["stopped_reason"] = "interrupted"
        finally:
            run["finished_at"] = collector.now()
            collector.save(data, collector.OUTPUT)
    print(json.dumps({"summary": data["summary"], "run": run}, ensure_ascii=False))


if __name__ == "__main__":
    main()
