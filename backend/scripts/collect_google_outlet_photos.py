"""Resume Google Places lookup for public outlets with no photo candidates.

GOOGLE_MAPS_SERVER_KEY=... backend/.venv/bin/python backend/scripts/collect_google_outlet_photos.py --limit 2170

Only Place IDs and lookup outcomes are retained. Photo names, URLs and image
bytes are never saved. The application must request photos live with attribution.
Authentication, disabled-service and quota errors stop the batch immediately.
"""
from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import json
import os
from pathlib import Path
import re
import time
from threading import Event

import httpx

from collect_outlet_photo_sources import first_premise, normalize, now, phone

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "data/public-outlets/photo-sources.json"
OUTPUT = ROOT / "data/public-outlets/google-storefronts.json"


class GoogleUnavailable(Exception):
    def __init__(self, status, reason):
        self.status, self.reason = status, reason
        super().__init__(f"Google HTTP {status}: {reason}")


def google_json(response):
    if response.is_success:
        return response.json()
    error = response.json().get("error", {})
    reason = next((detail.get("reason") for detail in error.get("details", []) if detail.get("reason")), error.get("status", "REQUEST_FAILED"))
    # Error messages can contain credentials; only retain Google's error codes.
    raise GoogleUnavailable(response.status_code, reason)


def branch(value):
    value = re.sub(r"watsons|cosmed", "", value, flags=re.I)
    return normalize(value).replace("連鎖", "").replace("門市", "店").removesuffix("店")


def compatible_name(expected, actual):
    if not branch(expected) or not branch(actual):
        return False
    if branch(expected) == branch(actual):
        return True
    # A proprietor or branch annotation may appear only on one source. The
    # relaxed form is accepted only with an exact premise AND matching phone.
    parenthesis = r"[（(][^）)]*[）)]"
    if re.search(parenthesis, expected) and re.search(parenthesis, actual):
        return False
    simplified = branch(re.sub(parenthesis, "", expected))
    return bool(simplified) and simplified == branch(re.sub(parenthesis, "", actual))


def canonical_premise(value):
    value = first_premise(value).removeprefix("台灣")
    return re.sub(r"^\d{3,6}", "", value).removeprefix("台灣")


def premise_without_village(value, city, district):
    value = normalize(value)
    prefix = normalize(city + district)
    value = re.sub(r"^\d{3,6}", "", value).removeprefix("台灣").removeprefix(prefix)
    return re.sub(r"^[\u4e00-\u9fff]{1,5}[里村](?:\d+鄰)?", "", value)


def identity_matches(row, place):
    actual_name = place.get("displayName", {}).get("text", "")
    if not compatible_name(row["name"], actual_name):
        return False
    address = place.get("formattedAddress", "")
    prefix = normalize(row["city"] + row["district"])
    if not prefix or prefix not in normalize(address):
        return False
    expected, actual = canonical_premise(row["address"]), canonical_premise(address)
    if not expected or not actual:
        return False
    if expected == actual and branch(row["name"]) == branch(actual_name):
        return True
    # A village can be omitted only when both street/house number and phone agree.
    return (
        premise_without_village(expected, row["city"], row["district"]) == premise_without_village(actual, row["city"], row["district"])
        and bool(phone(row.get("phone", "")))
        and phone(row["phone"]) == phone(place.get("nationalPhoneNumber", ""))
    )


def lookup(client, key, row):
    headers = {"X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.photos"}
    data = google_json(client.post("https://places.googleapis.com/v1/places:searchText", headers=headers,
        json={"textQuery": f'{row["address"]} {row["name"]}', "languageCode": "zh-TW", "regionCode": "TW", "pageSize": 5}))
    places = data.get("places", [])
    for place in places:
        if identity_matches(row, place):
            continue
        # Fetch a phone only for an otherwise identical name and premise with
        # an omitted village. Never use a phone to override another house number.
        if (compatible_name(row["name"], place.get("displayName", {}).get("text", ""))
            and normalize(row["city"] + row["district"]) in normalize(place.get("formattedAddress", ""))
            and first_premise(row["address"]) and first_premise(place.get("formattedAddress", ""))
            and premise_without_village(first_premise(row["address"]), row["city"], row["district"]) == premise_without_village(first_premise(place["formattedAddress"]), row["city"], row["district"])
            and phone(row.get("phone", "")) and re.fullmatch(r"[A-Za-z0-9_-]+", place.get("id", ""))):
            details = google_json(client.get(f'https://places.googleapis.com/v1/places/{place["id"]}', headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": "nationalPhoneNumber"}))
            place["nationalPhoneNumber"] = details.get("nationalPhoneNumber", "")
    matched = [place for place in places if identity_matches(row, place)]
    result = {"customer_id": row["customer_id"], "checked_at": now(),
        "source": {field: row[field] for field in ("name", "city", "district", "address")}}
    if len(matched) == 1:
        result.update(place_id=matched[0]["id"], status="photos_available" if matched[0].get("photos") else "no_photos", exterior_verified=False)
    else:
        result.update(status="identity_review_needed" if places else "not_found", candidate_place_ids=[place["id"] for place in places if place.get("id")])
    return result


def save(path, data):
    data["updated_at"] = now()
    data["summary"] = dict(Counter(row["status"] for row in data["records"].values()))
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def collect(key, source=SOURCE, output=OUTPUT, limit=2170, delay=0.1, client=None, workers=4, retry_review=False):
    rows = json.loads(source.read_text())["records"]
    data = json.loads(output.read_text()) if output.exists() else {"schema_version": 1, "source_snapshot": source.name, "records": {}, "runs": []}
    targets = [row for row in rows if not row.get("candidate_images") and (row["customer_id"] not in data["records"] or (retry_review and data["records"][row["customer_id"]]["status"] == "identity_review_needed"))]
    run = {"started_at": now(), "pending_at_start": len(targets), "processed": 0, "status": "running", "retry_review": retry_review}
    data["runs"].append(run)
    own_client = client is None
    client = client or httpx.Client(timeout=25)
    stop = Event()

    def request(row):
        if stop.is_set():
            return None
        try:
            result = lookup(client, key, row)
        except (GoogleUnavailable, httpx.HTTPError):
            stop.set()
            raise
        if delay:
            time.sleep(delay)
        return result

    def retain(record):
        if record is None:
            return
        data["records"][record["customer_id"]] = record
        run["processed"] += 1
        save(output, data)
        if run["processed"] % 25 == 0:
            print(json.dumps({"processed": run["processed"], "summary": data["summary"]}, ensure_ascii=False), flush=True)

    try:
        selected = iter(targets[:limit])
        # Probe first: invalid/disabled keys must not generate a request per shop.
        first = next(selected, None)
        if first is not None:
            retain(request(first))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            pending = {pool.submit(request, row) for row in [next(selected, None) for _ in range(workers)] if row is not None}
            while pending:
                finished, pending = wait(pending, return_when=FIRST_COMPLETED)
                for task in finished:
                    retain(task.result())
                    row = next(selected, None)
                    if row is not None and not stop.is_set():
                        pending.add(pool.submit(request, row))
        run["status"] = "complete" if len(targets) <= limit else "paused_at_limit"
    except GoogleUnavailable as exc:
        run.update(status="blocked", http_status=exc.status, reason=exc.reason)
        print(str(exc), flush=True)
    except httpx.HTTPError:
        run.update(status="interrupted", reason="NETWORK_ERROR")
    finally:
        stop.set()
        if run["status"] == "running":
            run["status"] = "interrupted"
        run["finished_at"] = now()
        save(output, data)
        if own_client:
            client.close()
    print(json.dumps(run, ensure_ascii=False), flush=True)
    return data


def publish_place_ids(data, output=ROOT / "frontend/src/lib/storefront-place-ids.ts"):
    ids = {key: row["place_id"] for key, row in data["records"].items() if row.get("place_id")}
    output.write_text('// Generated by collect_google_outlet_photos.py; only Google Place IDs are retained.\n'
        + 'export const storefrontPlaceIds: Record<string, string> = '
        + json.dumps(ids, ensure_ascii=False, indent=2, sort_keys=True) + '\n')


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=2170)
    parser.add_argument("--workers", type=int, default=4, choices=range(1, 9))
    parser.add_argument("--publish", action="store_true", help="Update the frontend Place ID index after collection")
    parser.add_argument("--retry-review", action="store_true", help="Recheck previously ambiguous shop identities")
    args = parser.parse_args()
    if args.limit < 1:
        parser.error("--limit must be positive")
    key = os.environ.get("GOOGLE_MAPS_SERVER_KEY", "")
    if not key:
        parser.error("Set GOOGLE_MAPS_SERVER_KEY; the key is never written to the result file")
    result = collect(key, limit=args.limit, workers=args.workers, retry_review=args.retry_review)
    if args.publish:
        publish_place_ids(result)
    raise SystemExit(1 if result["runs"][-1]["status"] in {"blocked", "interrupted"} else 0)
