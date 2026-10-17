"""Import public photo URLs directly; Google photo content never enters storage."""

import json
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import func, or_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.engine import Connection

from app.models import OutletStorefront

DATA = Path(__file__).resolve().parents[3] / "data/public-outlets"
PHOTO_SOURCE = DATA / "photo-sources.json"
GOOGLE_SOURCE = DATA / "google-storefronts.json"
GOOGLE_HOSTS = ("google.com", "googleapis.com", "googleusercontent.com", "gstatic.com", "ggpht.com")


def public_photo_url(value):
    if not isinstance(value, str):
        return False
    try:
        url = urlsplit(value)
        host = (url.hostname or "").lower()
        return (url.scheme == "https" and bool(host) and not url.username and not url.password
            and not any(host == suffix or host.endswith("." + suffix) for suffix in GOOGLE_HOSTS))
    except ValueError:
        return False


def public_source_url(value):
    if not isinstance(value, str):
        return None
    try:
        url = urlsplit(value)
        return value if url.scheme == "https" and url.hostname and not url.username and not url.password else None
    except ValueError:
        return None


def catalog_rows(source, google):
    """Every candidate is imported without an approval queue; prefer exact identity matches."""
    google_records = google.get("records", {})
    rows = []
    for record in source["records"]:
        images = sorted(record.get("candidate_images", []), key=lambda image: (
            not image.get("identity_verified", False),
            image.get("reuse_status") != "published_license_recorded",
        ))
        photos, seen = [], set()
        for image in images:
            url = image.get("image_url")
            page = public_source_url(image.get("page_url"))
            if not public_photo_url(url) or not page or url in seen:
                continue
            seen.add(url)
            photos.append({"image_url": url, "source_url": page,
                "credit": image.get("artist") or image.get("title") or record["name"],
                "license_name": image.get("license_name"), "license_url": public_source_url(image.get("license_url")),
                "identity_matched": bool(image.get("identity_verified")),
            })
        lookup = google_records.get(record["customer_id"], {})
        rows.append({"outlet_id": record["customer_id"], "photos": photos,
            "google_place_id": lookup.get("place_id"),
            "google_candidate_ids": list(dict.fromkeys(lookup.get("candidate_place_ids", []))),
        })
    if len({row["outlet_id"] for row in rows}) != len(rows):
        raise ValueError("照片目錄有重複的店家編號，取消匯入")
    return rows


def import_catalog(connection: Connection, source_path=PHOTO_SOURCE, google_path=GOOGLE_SOURCE):
    rows = catalog_rows(json.loads(source_path.read_text()), json.loads(google_path.read_text()) if google_path.exists() else {})
    connection.exec_driver_sql("SELECT pg_advisory_xact_lock(hashtext('meddemo-storefront-import'))")
    changed = 0
    for at in range(0, len(rows), 200):
        stmt = insert(OutletStorefront).values(rows[at:at + 200])
        result = connection.execute(stmt.on_conflict_do_update(index_elements=[OutletStorefront.outlet_id],
            set_={"photos": stmt.excluded.photos, "google_place_id": stmt.excluded.google_place_id,
                "google_candidate_ids": stmt.excluded.google_candidate_ids, "updated_at": func.now()},
            where=or_(OutletStorefront.photos.is_distinct_from(stmt.excluded.photos),
                OutletStorefront.google_place_id.is_distinct_from(stmt.excluded.google_place_id),
                OutletStorefront.google_candidate_ids.is_distinct_from(stmt.excluded.google_candidate_ids)))
            .returning(OutletStorefront.outlet_id))
        changed += len(result.all())
    return {"outlets": len(rows), "with_photos": sum(bool(row["photos"]) for row in rows),
        "photo_urls": sum(len(row["photos"]) for row in rows),
        "google_place_ids": sum(bool(row["google_place_id"]) for row in rows),
        "google_candidate_ids": sum(len(row["google_candidate_ids"]) for row in rows), "changed": changed}
