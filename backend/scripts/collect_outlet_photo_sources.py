"""Resume public outlet photo research without assigning unreviewed images to customers.

Prepare the full inventory without network access:
  uv run --project backend python backend/scripts/collect_outlet_photo_sources.py
Search up to 20 unfinished outlets (existing Firecrawl credits):
  uv run --project backend python backend/scripts/collect_outlet_photo_sources.py --search --limit 20
Import a Firecrawl /map response, then inspect matched official Watsons pages:
  ... --watsons-map /path/to/map.json --scrape-official --limit 50
Submit an official-page batch and save results until it finishes:
  ... --start-official-batch --limit 550 --max-credits 550
  ... --wait-official-batch BATCH_ID

An image search result is a candidate, never proof of the branch or an exterior.
This script records public source links; it never downloads/rehosts Google photos,
changes customer records, or purchases API credits. Each completed row is saved.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sys
import time
import unicodedata
from urllib.parse import unquote, urlencode, urlsplit
from zoneinfo import ZoneInfo
from threading import Event

import httpx
from dotenv import dotenv_values

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
sys.path.insert(0, str(BACKEND))
from app.services.public_outlets import source_id  # noqa: E402

SNAPSHOT = ROOT / "data/public-outlets/cenra-20261016.json"
OUTPUT = ROOT / "data/public-outlets/photo-sources.json"
RETRY_STATUSES = {"pending", "retry_needed", "source_pages_only", "no_candidates", "group_search_unresolved"}


def now():
    return datetime.now(ZoneInfo("Asia/Taipei")).isoformat(timespec="seconds")


def normalize(value):
    value = unicodedata.normalize("NFKC", value).replace("臺", "台").lower()
    return re.sub(r"[\s\W_]", "", value)


def watsons_branch(value):
    value = value.split("|")[0]
    for word in ("台灣", "臺灣", "屈臣氏", "門市"):
        value = value.replace(word, "")
    return normalize(value)


def first_premise(value):
    # Keep street, section, lane, alley and hyphenated house number. Ignore floors.
    # Do not turn 83-1號 into 83號, or confuse 中正路1號 and 中正路11號.
    value = unicodedata.normalize("NFKC", value).replace("臺", "台")
    value = re.sub(r"(\d+)號之(\d+)", r"\1之\2號", value)
    value = re.sub(r"^\d{3,6}[\s,，.]*(?=[\u4e00-\u9fff]{2,3}[縣市])", "", value)
    for chinese, arabic in {"一": "1", "二": "2", "三": "3", "四": "4", "五": "5", "六": "6", "七": "7", "八": "8", "九": "9", "十": "10"}.items():
        value = re.sub(chinese + r"(?=段)", arabic, value)
    # A shop spanning 103、105號 has primary premise 103號, not 103105號.
    match = re.search(r"^(.*?)(\d+(?:[-之]\d+)?)(?:[、,，.]\s*\d+(?:[-之]\d+)?)*號", value)
    return normalize((match[1] + match[2] + "號").replace("-", "之")) if match else ""


def phone(value):
    value = re.sub(r"\D", "", value)
    return "0" + value[3:] if value.startswith("886") else value


def official_identity_matches(row, name, address, telephone):
    city = normalize(row["city_normalized"])
    district = normalize(row["district"])
    if watsons_branch(row["name"]) != watsons_branch(name):
        return False
    if not city or not district or city + district not in normalize(address):
        return False
    expected, actual = first_premise(row["Address"]), first_premise(address)
    # A matching telephone cannot override a conflicting street/house number.
    if expected and actual:
        return expected == actual
    return bool(phone(row["tel"]) and phone(row["tel"]) == phone(telephone))


def public_url(value):
    try:
        url = urlsplit(value)
        return url.scheme == "https" and bool(url.hostname) and not url.username and not url.password
    except (TypeError, ValueError):
        return False


class OfficialPage(HTMLParser):
    """Read only the store name/address/telephone and the store gallery."""

    def __init__(self, html):
        super().__init__()
        self.name, self.address, self.telephone, self.images = "", "", "", []
        self.stack = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get("class", "").split()
        inherited = self.stack[-1][1] if self.stack else ""
        field = "name" if "store-name" in classes else "address" if "address-detail" in classes else inherited
        if tag not in {"img", "br", "hr", "input", "meta", "link", "source", "path", "use", "rect", "circle"}:
            self.stack.append((tag, field))
        if tag == "a" and attrs.get("href", "").startswith("tel:"):
            self.telephone = attrs["href"][4:]
        if tag == "img":
            src = attrs.get("src", "")
            # Watsons store galleries use anonymous media URLs; exclude logos,
            # product campaigns and store-service icons elsewhere on the page.
            if src.startswith("https://api.watsons.com.tw/medias/?context=") and src not in self.images:
                self.images.append(src)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break

    def handle_data(self, value):
        if self.stack and self.stack[-1][1] in {"name", "address"}:
            field = self.stack[-1][1]
            setattr(self, field, getattr(self, field) + value)


def prepare(snapshot, previous):
    old = {row["customer_id"]: row for row in previous.get("records", [])}
    records = []
    for row in snapshot["records"]:
        key = source_id(row)
        query = " ".join([row["name"], row["city_normalized"], row["district"], row["Address"]])
        record = {
            "customer_id": key, "source_id": row["id"], "name": row["name"],
            "city": row["city_normalized"], "district": row["district"],
            "address": row["Address"], "phone": row["tel"], "source_issues": row["issues"],
            "status": "pending", "search_query": query + " 店面 招牌",
            "maps_search_url": "https://www.google.com/maps/search/?" + urlencode({"api": 1, "query": query}),
            "image_search_url": "https://www.google.com/search?" + urlencode({"tbm": "isch", "q": query + " 外觀"}),
            "source_pages": [], "candidate_images": [], "verified_exterior_images": [],
        }
        if key in old:
            record.update({k: v for k, v in old[key].items() if k not in record or k in {
                "status", "source_pages", "candidate_images", "verified_exterior_images"}})
        records.append(record)
    return {"schema_version": 1, "source_snapshot": SNAPSHOT.name,
            "source_url": snapshot["summary"]["page_url"], "photo_target": "店面外觀／招牌",
            "records": records, "runs": previous.get("runs", []),
            "official_batches": previous.get("official_batches", []),
            "source_checks": previous.get("source_checks", [])}


def apply_manual_review(data, path):
    records = {r["customer_id"]: r for r in data["records"]}
    for review in json.loads(path.read_text())["reviews"]:
        record = records[review["customer_id"]]
        photo = next((p for p in record["candidate_images"] if p["image_url"] == review["image_url"] and p.get("identity_verified")), None)
        if photo is None:
            raise ValueError("Manual review must refer to an identity-matched photo already in the inventory")
        verified = {**photo, **review, "exterior_verified": True}
        existing = [p for p in record["verified_exterior_images"] if p["image_url"] != photo["image_url"]]
        record["verified_exterior_images"] = existing + [verified]
        record["status"] = "verified_exterior"


def save(data, output):
    data["updated_at"] = now()
    data["summary"] = {"total": len(data["records"]),
        "statuses": dict(Counter(r["status"] for r in data["records"])),
        "outlets_with_candidate_images": sum(bool(r["candidate_images"]) for r in data["records"]),
        "outlets_without_candidate_images": sum(not r["candidate_images"] for r in data["records"]),
        "outlets_awaiting_standard_search": sum(not r["candidate_images"] and not r.get("standard_search") for r in data["records"]),
        "outlets_with_identity_matched_images": sum(any(p.get("identity_verified") for p in r["candidate_images"]) for r in data["records"]),
        "outlets_with_verified_exteriors": sum(bool(r["verified_exterior_images"]) for r in data["records"])}
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(output)
    if output == OUTPUT:
        save_summary(data, output.with_name("photo-sources-summary.md"))


def save_summary(data, output):
    summary = data["summary"]
    lines = ["# 藥局外觀照片查找進度", "", f'更新：{data["updated_at"]}', "",
        f'- 全部通路：{summary["total"]:,} 間。',
        f'- 已找到照片候選：{summary["outlets_with_candidate_images"]:,} 間。候選可能含店內照或同名店，尚不可直接當成外觀照。',
        f'- 其中照片來源頁的店名與地址相符：{summary["outlets_with_identity_matched_images"]:,} 間；仍須檢視照片本身。',
        f'- 尚未找到照片候選：{summary["outlets_without_candidate_images"]:,} 間；其中還未完成一般搜尋：{summary["outlets_awaiting_standard_search"]:,} 間。',
        f'- 已人工核對外觀：{summary["outlets_with_verified_exteriors"]:,} 間。',
        '- 完整名單、每店搜尋入口、照片網址與複核證據：同目錄的 `photo-sources.json`。', ""]
    labels = {"pending": "待搜尋", "verified_exterior": "已人工核對外觀", "photo_review_needed": "有照片候選，待複核",
        "source_pages_only": "有來源頁，尚無已收集照片", "identity_review_needed": "店名／地址待核對",
        "no_candidates": "本次搜尋未找到候選", "retry_needed": "需重試"}
    labels["group_search_unresolved"] = "合併搜尋未找到個別結果，需單店補查"
    lines += ["| 進度 | 間數 |", "| --- | ---: |"]
    lines += [f'| {labels.get(status, status)} | {count:,} |' for status, count in summary["statuses"].items()]
    for job in data.get("official_batches", []):
        lines += ["", f'官方門市批次：`{job["id"]}`；狀態 `{job["status"]}`，服務已完成 {job.get("completed", 0)} / {job["total"]} 頁。']
    lines += ["", "## 已人工核對的外觀", ""]
    for record in data["records"]:
        if record["verified_exterior_images"]:
            page_url = record["verified_exterior_images"][0].get("page_url") or record.get("official_page_url", "")
            lines += [f'### {record["name"]}', "", record["address"], "",
                f'[照片來源頁]({page_url})', ""]
            for index, photo in enumerate(record["verified_exterior_images"], 1):
                lines += [f'{index}. {photo["evidence"]}。']
    lines += ["", "## 有照片候選的來源頁", "", "店名與地址仍須逐店複核。這張表沒有把候選自動配進客戶畫面。", "",
        "| 店家 | 名單地址 | 照片候選（點數字看首張） | 來源 |", "| --- | --- | ---: | --- |"]
    for record in data["records"]:
        if not record["candidate_images"]:
            continue
        pages = record["source_pages"]
        url = record.get("official_page_url") or (pages[0]["url"] if pages else "")
        url = url.replace("(", "%28").replace(")", "%29")
        source = f'[來源頁]({url})' if public_url(url) else "待補來源"
        first_image = record["candidate_images"][0]["image_url"].replace("(", "%28").replace(")", "%29")
        photo_link = f'[{len(record["candidate_images"])}]({first_image})' if public_url(first_image) else str(len(record["candidate_images"]))
        lines.append(f'| {record["name"].replace("|", "／")} | {record["address"].replace("|", "／")} | {photo_link} | {source} |')
    lines += ["", "找到公開照片不代表已取得重製或再發布授權；目前只整理照片與來源連結。Google Places 的照片沒有下載或永久快取。", ""]
    temporary = output.with_suffix(".tmp")
    temporary.write_text("\n".join(lines))
    temporary.replace(output)


def import_watsons_map(data, path):
    branches = defaultdict(dict)
    for page in json.loads(path.read_text()).get("links", []):
        match = re.search(r"/store/(wtctw_\d+_zh_TW)(?:/|$)", page.get("url", ""))
        if match and urlsplit(page["url"]).hostname == "www.watsons.com.tw":
            title = page.get("title") or unquote(urlsplit(page["url"]).path.rstrip("/").rsplit("/", 1)[-1])
            branches[watsons_branch(title)][match[1]] = page
    for record in data["records"]:
        if "屈臣氏" not in record["name"] or record["verified_exterior_images"]:
            continue
        candidates = list(branches[watsons_branch(record["name"])].values())
        # Map descriptions are discovery hints. The actual page must still be read.
        local = [p for p in candidates if normalize(record["city"] + record["district"]) in normalize(p.get("description", ""))]
        if len(local) == 1 or len(candidates) == 1:
            page = local[0] if len(local) == 1 else candidates[0]
            record["official_page_url"] = page["url"]
            if page["url"] not in [p["url"] for p in record["source_pages"]]:
                record["source_pages"].append({"url": page["url"], "title": page.get("title", ""), "kind": "official", "identity_verified": False})
            if record["status"] == "pending":
                record["status"] = "source_pages_only"


def process_official(record, source_row, payload):
    page = OfficialPage(payload.get("html", ""))
    if not official_identity_matches(source_row, page.name.strip(), page.address.strip(), page.telephone):
        record["status"] = "identity_review_needed"
        return
    url = record["official_page_url"]
    record["source_pages"] = [{"url": url, "title": page.name.strip(), "kind": "official",
        "identity_verified": True, "address_evidence": page.address.strip(), "phone_evidence": page.telephone}]
    record["candidate_images"] = [{"image_url": src, "page_url": url,
        "identity_verified": True, "exterior_verified": False,
        "reuse_status": "permission_not_checked"} for src in page.images]
    record["status"] = "photo_review_needed" if page.images else "source_pages_only"
    record["checked_at"] = now()


def process_search(record, payload):
    results = payload.get("data", {})
    def identifies_store(item):
        expected = normalize(record.get("name", "")).replace("門市", "店").replace("連鎖", "")
        title = normalize(item.get("title") or "").replace("門市", "店").replace("連鎖", "")
        path = normalize(unquote(urlsplit(item.get("url") or "").path)).replace("門市", "店").replace("連鎖", "")
        return not expected or expected in title or expected in path
    record["source_pages"] = [{"url": item["url"], "title": item.get("title", ""),
        "description": item.get("description", ""), "kind": "search_result", "identity_verified": False}
        for item in results.get("web", []) if public_url(item.get("url")) and identifies_store(item)]
    record["candidate_images"] = [{"image_url": item["imageUrl"], "page_url": item["url"],
        "title": item.get("title", ""), "identity_verified": False, "exterior_verified": False,
        "reuse_status": "permission_not_checked"}
        for item in results.get("images", []) if public_url(item.get("imageUrl")) and public_url(item.get("url")) and identifies_store(item)
        and not re.search(r"logo|placeholder|no.image|icon", urlsplit(item["imageUrl"]).path.rsplit("/", 1)[-1], re.I)
        and not (urlsplit(item["imageUrl"]).hostname or "").endswith(("googleusercontent.com", "gstatic.com"))]
    record["status"] = "photo_review_needed" if record["candidate_images"] else "source_pages_only" if record["source_pages"] else "no_candidates"
    record["checked_at"] = now()


def parallel_search(client, data, records, run, args, budget):
    stop = Event()
    targets = records[:min(args.limit, budget // 2)]
    run["processed_customer_ids"] = []
    def request(record):
        if stop.is_set():
            return record, None, "cancelled"
        try:
            response = client.post("search", json={"query": record["search_query"], "sources": ["web", "images"], "limit": 4})
            if response.status_code in {401, 402, 403, 429}:
                stop.set()
                return record, None, f"service_http_{response.status_code}"
            response.raise_for_status()
            payload = response.json()
            return record, payload if payload.get("success") else None, None
        except (httpx.HTTPError, ValueError):
            return record, None, "transient_error"
    print(f'Public search: {len(targets)} individual outlets; {args.workers} workers; {budget} existing credits maximum', flush=True)
    with ThreadPoolExecutor(args.workers) as pool:
        for record, payload, error in pool.map(request, targets):
            if error == "cancelled":
                continue
            run["requests"] += 1
            if payload is None:
                record["status"] = "retry_needed"
                if error and error.startswith("service_http_"):
                    run["stopped_reason"] = error
            else:
                process_search(record, payload)
                run["credits_used"] += payload.get("creditsUsed", 2)
                run["processed_customer_ids"].append(record["customer_id"])
            if run["requests"] % 25 == 0:
                save(data, args.output)
                print(json.dumps({"individual_outlets_searched": run["requests"], "credits_used": run["credits_used"],
                    "outlets_with_photo_candidates": data["summary"]["outlets_with_candidate_images"]}), flush=True)


def official_batch(client, data, source_rows, args):
    jobs = data.setdefault("official_batches", [])
    if args.start_official_batch:
        usage = client.get("team/credit-usage")
        usage.raise_for_status()
        remaining = usage.json()["data"]["remainingCredits"]
        budget = min(args.max_credits, max(0, remaining - args.reserve_credits))
        records = [r for r in data["records"] if r.get("official_page_url") and r["status"] in RETRY_STATUSES]
        urls = list(dict.fromkeys(r["official_page_url"] for r in records))[:min(args.limit, budget)]
        if not urls:
            print("No eligible official URLs within the credit budget")
            return
        response = client.post("batch/scrape", json={"urls": urls, "formats": ["html"], "maxConcurrency": 4})
        response.raise_for_status()
        result = response.json()
        if not result.get("success") or not result.get("id"):
            raise ValueError("Batch was not accepted")
        job = {"id": result["id"], "started_at": now(), "urls": urls, "status": "submitted", "total": len(urls)}
        jobs.append(job)
        save(data, args.output)
        print(json.dumps({k: v for k, v in job.items() if k != "urls"}, ensure_ascii=False))
        return
    job = next((j for j in jobs if j["id"] == args.resume_official_batch), None)
    if job is None:
        raise ValueError("Batch ID is not in this inventory")
    by_id = defaultdict(list)
    for record in data["records"]:
        match = re.search(r"/store/(wtctw_\d+_zh_TW)", record.get("official_page_url", ""))
        if match:
            by_id[match[1]].append(record)
    next_url = "batch/scrape/" + job["id"]
    seen_urls = set()
    while next_url:
        if next_url in seen_urls:
            break
        seen_urls.add(next_url)
        response = client.get(next_url)
        response.raise_for_status()
        result = response.json()
        for key in ("status", "completed", "total", "creditsUsed", "expiresAt"):
            if key in result:
                job[key] = result[key]
        for page in result.get("data", []):
            metadata = page.get("metadata", {})
            url = metadata.get("sourceURL") or metadata.get("url") or ""
            match = re.search(r"/store/(wtctw_\d+_zh_TW)", url)
            if match:
                for record in by_id[match[1]]:
                    if record["verified_exterior_images"]:
                        continue
                    process_official(record, source_rows[record["customer_id"]], page)
        job["last_checked_at"] = now()
        save(data, args.output)
        next_url = result.get("next")
        # While a batch is still running, Firecrawl can return an empty page
        # with the same next cursor. A resume invocation is one snapshot.
        if not result.get("data"):
            break
        if next_url and not next_url.startswith("https://api.firecrawl.dev/v2/batch/scrape/" + job["id"]):
            raise ValueError("Unexpected batch pagination URL")
    print(json.dumps({"summary": data["summary"], "batch": {k: v for k, v in job.items() if k != "urls"}}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--watsons-map", type=Path)
    parser.add_argument("--manual-review", type=Path)
    parser.add_argument("--search", action="store_true")
    parser.add_argument("--scrape-official", action="store_true")
    parser.add_argument("--start-official-batch", action="store_true")
    parser.add_argument("--resume-official-batch")
    parser.add_argument("--wait-official-batch")
    parser.add_argument("--workers", type=int, choices=(1, 2, 3, 4, 5), default=1)
    parser.add_argument("--only-unmapped-registry", action="store_true")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--max-credits", type=int, default=100)
    parser.add_argument("--reserve-credits", type=int, default=1000)
    args = parser.parse_args()
    if args.limit < 1 or args.max_credits < 1 or args.reserve_credits < 0:
        parser.error("limit/max-credits must be positive; reserve-credits must be nonnegative")
    modes = [args.search, args.scrape_official, args.start_official_batch, bool(args.resume_official_batch), bool(args.wait_official_batch)]
    if sum(modes) > 1:
        parser.error("Choose one network operation")
    previous = json.loads(args.output.read_text()) if args.output.exists() else {}
    snapshot = json.loads(SNAPSHOT.read_text())
    data = prepare(snapshot, previous)
    if args.watsons_map:
        import_watsons_map(data, args.watsons_map)
    if args.manual_review:
        apply_manual_review(data, args.manual_review)
    save(data, args.output)
    if not any(modes):
        print(json.dumps(data["summary"], ensure_ascii=False))
        return
    config = dotenv_values(BACKEND / ".env")
    key = os.environ.get("FIRECRAWL_API_KEY") or config.get("FIRECRAWL_API_KEY")
    if not key:
        parser.error("Set FIRECRAWL_API_KEY in backend/.env; do not put credentials in the inventory")
    rows = {source_id(row): row for row in snapshot["records"]}
    if args.wait_official_batch:
        args.resume_official_batch = args.wait_official_batch
    if args.start_official_batch or args.resume_official_batch:
        with httpx.Client(base_url="https://api.firecrawl.dev/v2/", headers={"Authorization": "Bearer " + key}, timeout=55) as client:
            try:
                started = time.monotonic()
                while True:
                    # Re-read on every snapshot so another run's saved review
                    # evidence is preserved. Do not run two writers together.
                    data = json.loads(args.output.read_text())
                    official_batch(client, data, rows, args)
                    if not args.wait_official_batch:
                        break
                    job = next(j for j in data["official_batches"] if j["id"] == args.wait_official_batch)
                    if job["status"] in {"completed", "failed", "cancelled"} or time.monotonic() - started >= 3600:
                        break
                    time.sleep(45)
            except KeyboardInterrupt:
                print("Stopped waiting; saved results and remote batch are preserved")
            except (httpx.HTTPError, ValueError, KeyError) as error:
                print("Batch request stopped:", type(error).__name__)
                raise SystemExit(1)
        return
    run = {"started_at": now(), "mode": "official" if args.scrape_official else "search", "requests": 0, "credits_used": 0}
    data["runs"].append(run)
    with httpx.Client(base_url="https://api.firecrawl.dev/v2/", headers={"Authorization": "Bearer " + key}, timeout=55) as client:
        try:
            usage = client.get("team/credit-usage")
            usage.raise_for_status()
            remaining = usage.json()["data"]["remainingCredits"]
            budget = min(args.max_credits, max(0, remaining - args.reserve_credits))
            run["credit_budget"] = budget
            if args.scrape_official:
                records = [r for r in data["records"] if r.get("official_page_url") and r["status"] in RETRY_STATUSES]
            else:
                records = [r for r in data["records"] if r["status"] in RETRY_STATUSES and not r.get("official_page_url")]
                if args.only_unmapped_registry:
                    records = [r for r in records if isinstance(r.get("registry_photo_lookup"), dict) and not r["registry_photo_lookup"]["candidate_ids"]]
                if args.workers > 1:
                    parallel_search(client, data, records, run, args, budget)
                    return
            for record in records[:args.limit]:
                # Search costs 2 credits for up to 10 results, scrape costs 1.
                # Conservatively reserve 2 for either request, then use actual usage.
                if run["credits_used"] + 2 > budget:
                    run["stopped_reason"] = "credit_budget_reached"
                    break
                body = {"url": record["official_page_url"], "formats": ["html"]} if args.scrape_official else {
                    "query": record["search_query"], "sources": ["web", "images"], "limit": 4}
                response = client.post("scrape" if args.scrape_official else "search", json=body)
                run["requests"] += 1
                if response.status_code in {401, 402, 403, 429}:
                    run["stopped_reason"] = f"service_http_{response.status_code}"
                    break
                response.raise_for_status()
                payload = response.json()
                if not payload.get("success"):
                    record["status"] = "retry_needed"
                elif args.scrape_official:
                    process_official(record, rows[record["customer_id"]], payload["data"])
                else:
                    process_search(record, payload)
                run["credits_used"] += payload.get("creditsUsed", 1 if args.scrape_official else 2)
                save(data, args.output)
                print(f'{run["requests"]}: {record["name"]}: {record["status"]}', flush=True)
                time.sleep(1.2)
        except KeyboardInterrupt:
            run["stopped_reason"] = "interrupted"
        except (httpx.HTTPError, ValueError, KeyError) as error:
            # Never print request headers, API keys or raw service error bodies.
            run["stopped_reason"] = type(error).__name__
        finally:
            run["finished_at"] = now()
            save(data, args.output)
    print(json.dumps({"summary": data["summary"], "run": run}, ensure_ascii=False))


if __name__ == "__main__":
    main()
