"""Import ordinary web/image search evidence without spending crawler credits.

Only titles containing the complete outlet name are attached. Search hits stay
unverified: a matching title does not prove the photo shows the same branch.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

import collect_outlet_photo_sources as collector


def store_name(value):
    value = collector.normalize(value)
    return value.removesuffix("門市").removesuffix("分店").removesuffix("店")


def title_matches(record, result):
    expected = store_name(record["name"])
    return len(expected) >= 3 and expected in store_name(result.get("title", ""))


def acceptable_image(value):
    if not collector.public_url(value):
        return False
    parsed = urlsplit(value)
    if (parsed.hostname or "").endswith(("googleusercontent.com", "gstatic.com", "google.com")):
        return False
    return not re.search(r"(?:logo|placeholder|no[-_]?image|default|icon|avatar)", parsed.path.rsplit("/", 1)[-1], re.I)


def attach(record, batch):
    results = batch.get("results", [])
    matching = [r for r in results if title_matches(record, r) and collector.public_url(r.get("url", ""))]
    record["standard_search"] = {"provider": "standard_web_search", "checked_at": batch["checked_at"],
        "query": batch["queries"][next(i for i, r in enumerate(batch["targets"]) if r["customer_id"] == record["customer_id"])],
        "query_batch_size": len(batch["targets"]), "returned_results": len(results),
        "matching_title_results": len(matching), "identity_verified": False,
        "status": "sources_found" if matching else "no_exact_title_result"}
    pages = {p["url"] for p in record["source_pages"]}
    images = {p["image_url"] for p in record["candidate_images"]}
    for result in matching:
        url = result["url"]
        if url not in pages:
            record["source_pages"].append({"url": url, "title": result["title"],
                "kind": "standard_web_search", "identity_verified": False,
                "checked_at": batch["checked_at"]})
            pages.add(url)
        image = result.get("image_url", "")
        if image not in images and acceptable_image(image):
            record["candidate_images"].append({"image_url": image, "page_url": url,
                "kind": "standard_image_search", "identity_verified": False,
                "exterior_verified": False, "checked_at": batch["checked_at"],
                "reuse_status": "permission_not_checked"})
            images.add(image)
    if record["verified_exterior_images"]:
        record["status"] = "verified_exterior"
    elif record["candidate_images"]:
        record["status"] = "photo_review_needed"
    elif record["status"] != "identity_review_needed":
        record["status"] = "source_pages_only" if record["source_pages"] else "no_candidates"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    data = json.loads(collector.OUTPUT.read_text())
    records = {r["customer_id"]: r for r in data["records"]}
    checked, errors = set(), 0
    batches = sorted(args.directory.glob("*batch-*.json"))
    for path in batches:
        batch = json.loads(path.read_text())
        if batch.get("error"):
            errors += 1
            continue
        for target in batch["targets"]:
            record = records[target["customer_id"]]
            if record["name"] != target["name"] or record["address"] != target["address"]:
                raise ValueError("Search target differs from current outlet snapshot")
            attach(record, batch)
            checked.add(record["customer_id"])
    data["runs"] = [r for r in data["runs"] if r.get("mode") != "standard_web_search_20261017"]
    run = {"mode": "standard_web_search_20261017", "updated_at": collector.now(),
        "outlets_searched": len(checked), "batch_calls": len(batches), "batch_errors": errors,
        "firecrawl_credits_used": 0,
        "results": dict(Counter(records[key]["standard_search"]["status"] for key in checked))}
    data["runs"].append(run)
    collector.save(data, collector.OUTPUT)
    print(json.dumps({"summary": data["summary"], "run": run}, ensure_ascii=False))


if __name__ == "__main__":
    main()
