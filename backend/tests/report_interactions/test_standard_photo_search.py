"""A normal search must not attach nearby shops or mark images as verified."""
import importlib.util
from pathlib import Path
import sys

script = Path(__file__).resolve().parents[2] / "scripts/import_standard_photo_search.py"
sys.path.insert(0, str(script.parent))
spec = importlib.util.spec_from_file_location("standard_photo_search", script)
standard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(standard)


def test_nearby_branch_is_not_attached_and_search_photos_stay_unverified():
    record = {"customer_id": "one", "name": "康是美基隆港門市", "status": "pending", "source_pages": [], "candidate_images": [], "verified_exterior_images": []}
    batch = {"checked_at": "2026-10-17T00:00:00+08:00", "targets": [record], "queries": ["康是美基隆港門市 基隆"], "results": [
        {"title": "康是美廟口門市", "url": "https://example.com/other", "image_url": "https://example.com/other.jpg"},
        {"title": "康是美－基隆港店", "url": "https://example.com/exact", "image_url": "https://example.com/store.jpg"},
        {"title": "康是美－基隆港店", "url": "https://example.com/exact", "image_url": "https://example.com/logo.jpg"}]}
    standard.attach(record, batch)
    standard.attach(record, batch)
    assert len(record["candidate_images"]) == len(record["source_pages"]) == 1
    assert record["candidate_images"][0]["identity_verified"] is False
    assert record["candidate_images"][0]["exterior_verified"] is False
    assert not record["verified_exterior_images"]
    assert record["status"] == "photo_review_needed"


def test_no_matching_result_does_not_claim_the_store_has_no_photo():
    record = {"customer_id": "one", "name": "仁生藥局", "status": "pending", "source_pages": [], "candidate_images": [], "verified_exterior_images": []}
    batch = {"checked_at": "2026-10-17T00:00:00+08:00", "targets": [record], "queries": ["仁生藥局 基隆"], "results": []}
    standard.attach(record, batch)
    assert record["status"] == "no_candidates"
    assert record["standard_search"]["status"] == "no_exact_title_result"
