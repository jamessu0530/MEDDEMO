import datetime as dt
import hashlib
import json
from collections import Counter

import httpx
import pytest
from sqlalchemy import delete

from app.models import Customer, OutletStorefront, ProductPhoto, PublicOutlet
from app.services import deployment_sync as deploy
from app.services import outlet_search


@pytest.fixture
def sync_data(interaction_session, monkeypatch, tmp_path):
    session = interaction_session
    calls = Counter()
    source = tmp_path / "outlets.json"
    source.write_text(json.dumps({"summary": {"source_sha256": "source-sha"}, "records": [{}]}))
    storefronts = tmp_path / "storefronts.json"
    storefronts.write_text(json.dumps({"records": [{"customer_id": "C1"}]}))
    inventory, manifest = tmp_path / "inventory.json", tmp_path / "manifest.json"
    inventory.write_text("[]")
    manifest.write_text("{}")
    monkeypatch.setattr(deploy.public_outlets, "SOURCE_FILE", source)
    monkeypatch.setattr(deploy.public_outlets, "source_id", lambda row: "C1")
    monkeypatch.setattr(deploy.storefront_photos, "PHOTO_SOURCE", storefronts)
    monkeypatch.setattr(deploy.storefront_photos, "GOOGLE_SOURCE", tmp_path / "optional.json")
    monkeypatch.setattr(deploy.product_photos, "DEFAULT_INVENTORY", inventory)
    monkeypatch.setattr(deploy.product_photos, "MANIFEST", manifest)
    record = {"sku": "P1", "catalog_name": "P1", "category": "測試", "source_id": "photo",
        "title": "來源", "page_url": "https://example.test/page", "image_url": "https://example.test/photo",
        "kind": "exact", "note": "已核對", "retrieved_on": dt.date(2026, 10, 17),
        "sha256": hashlib.sha256(b"photo").hexdigest(), "content": b"photo"}
    monkeypatch.setattr(deploy.product_photos, "read_reviewed_photos", lambda: [record])
    session.get(Customer, "C1").name = "合康藥局"

    def import_outlets(session):
        calls["outlets"] += 1
        if session.get(PublicOutlet, "C1") is None:
            session.add(PublicOutlet(customer_id="C1", phone="0224555173", address="測試地址", category="藥局",
                review_notes=[], raw_record={}, source_url="https://example.test", data_url="https://example.test/data",
                retrieved_on=dt.date(2026, 10, 17), snapshot_sha256="source-sha"))
        session.flush()
        return {"created": 1}

    def import_storefronts(connection):
        if session.get(OutletStorefront, "C1") is None:
            session.add(OutletStorefront(outlet_id="C1", photos=[]))
        session.flush()
        return {"outlets": 1}

    import_photos = deploy.product_photos.import_reviewed_photos

    def photos(connection, records):
        calls["photos"] += 1
        return import_photos(connection, records)

    def rebuild(session):
        calls["search"] += 1
        return 4

    monkeypatch.setattr(deploy.public_outlets, "import_snapshot", import_outlets)
    monkeypatch.setattr(deploy.storefront_photos, "import_catalog", import_storefronts)
    monkeypatch.setattr(deploy.product_photos, "import_reviewed_photos", photos)
    monkeypatch.setattr(outlet_search, "rebuild", rebuild)
    monkeypatch.setattr(outlet_search, "search_ids", lambda query: ["C1"])
    monkeypatch.setattr(outlet_search, "index_is_healthy", lambda count: True)
    session.commit()
    return session, calls, source


def test_unchanged_deployment_skips_all_writes(sync_data):
    session, calls, _ = sync_data
    deploy.sync(session)
    result = deploy.sync(session)
    assert calls == {"outlets": 1, "photos": 1, "search": 1}
    assert all(row["status"] == "unchanged" for row in result.values())
    assert session.get(ProductPhoto, "P1").content == b"photo"


@pytest.mark.parametrize("missing", ["outlets", "photos", "search"])
def test_missing_data_or_index_is_repaired_despite_matching_version(sync_data, monkeypatch, missing):
    session, calls, _ = sync_data
    deploy.sync(session)
    if missing == "search":
        monkeypatch.setattr(outlet_search, "index_is_healthy", lambda count: False)
    else:
        session.execute(delete(PublicOutlet if missing == "outlets" else ProductPhoto))
        session.commit()
    deploy.sync(session)
    assert calls[missing] == 2
    assert calls["search"] == (1 if missing == "photos" else 2)


def test_source_change_and_force_refresh_are_not_skipped(sync_data):
    session, calls, source = sync_data
    deploy.sync(session)
    updated = json.loads(source.read_text())
    updated["summary"]["source_sha256"] = "new-snapshot-with-retained-existing-records"
    source.write_text(json.dumps(updated))
    deploy.sync(session)
    assert calls == {"outlets": 2, "photos": 1, "search": 2}
    assert deploy.sync(session)["outlets"]["status"] == "unchanged"
    deploy.sync(session, force=True)
    assert calls == {"outlets": 3, "photos": 2, "search": 3}


def test_changed_photo_bytes_update_only_photos(sync_data, monkeypatch):
    session, calls, _ = sync_data
    deploy.sync(session)
    record = {**deploy.product_photos.read_reviewed_photos()[0], "content": b"new-photo",
        "sha256": hashlib.sha256(b"new-photo").hexdigest()}
    monkeypatch.setattr(deploy.product_photos, "read_reviewed_photos", lambda: [record])
    deploy.sync(session)
    assert calls == {"outlets": 1, "photos": 2, "search": 1}
    assert session.get(ProductPhoto, "P1").content == b"new-photo"


@pytest.mark.parametrize("phase", ["outlets", "photos"])
def test_failed_import_rolls_back_its_data_and_version(sync_data, monkeypatch, phase):
    session, calls, _ = sync_data
    module, name = ((deploy.public_outlets, "import_snapshot") if phase == "outlets"
        else (deploy.product_photos, "import_reviewed_photos"))
    original = getattr(module, name)

    def fail(*args):
        original(*args)
        raise ValueError("interrupted import")

    monkeypatch.setattr(module, name, fail)
    with pytest.raises(ValueError, match="interrupted"):
        deploy.sync(session)
    session.rollback()
    assert deploy.stored_version(session, phase) is None
    assert session.get(PublicOutlet if phase == "outlets" else ProductPhoto, "C1" if phase == "outlets" else "P1") is None
    monkeypatch.setattr(module, name, original)
    deploy.sync(session)
    assert calls[phase] == 2 and calls["search"] == 1


def test_failed_search_verification_does_not_record_success_and_is_retried(sync_data, monkeypatch):
    session, calls, _ = sync_data
    monkeypatch.setattr(outlet_search, "search_ids", lambda query: [])
    with pytest.raises(RuntimeError, match="搜尋實測未通過"):
        deploy.sync(session)
    session.rollback()
    assert deploy.stored_version(session, "search") is None
    assert deploy.stored_version(session, "outlets") is not None
    monkeypatch.setattr(outlet_search, "search_ids", lambda query: ["C1"])
    deploy.sync(session)
    assert calls == {"outlets": 1, "photos": 1, "search": 2}


@pytest.mark.parametrize("status,count,timed_out,expected", [
    ("green", 4, False, True), ("yellow", 4, False, True), ("red", 4, False, False),
    ("green", 3, False, False), ("green", 4, True, False),
])
def test_index_health_requires_usable_shards_and_matching_count(monkeypatch, status, count, timed_out, expected):
    def respond(request):
        return httpx.Response(200, json={"status": status, "timed_out": timed_out}
            if request.url.path.startswith("/_cluster/health/") else {"count": count})
    monkeypatch.setattr(outlet_search, "_client", lambda: httpx.Client(
        base_url="http://elasticsearch:9200", transport=httpx.MockTransport(respond)))
    assert outlet_search.index_is_healthy(4) is expected


@pytest.mark.parametrize("failure", ["missing", "timeout", "malformed"])
def test_missing_or_unreachable_index_is_not_treated_as_healthy(monkeypatch, failure):
    def respond(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("unavailable")
        return httpx.Response(404) if failure == "missing" else httpx.Response(200, json=[])
    monkeypatch.setattr(outlet_search, "_client", lambda: httpx.Client(
        base_url="http://elasticsearch:9200", transport=httpx.MockTransport(respond)))
    assert outlet_search.index_is_healthy(4) is False


def test_version_tracks_photo_bytes_and_missing_optional_files(tmp_path):
    photo, optional = tmp_path / "photo.webp", tmp_path / "optional.json"
    photo.write_bytes(b"first")
    first = deploy.fingerprint([photo, optional])
    photo.write_bytes(b"other")
    assert deploy.fingerprint([photo, optional]) != first
    first = deploy.fingerprint([photo, optional])
    optional.write_text("{}")
    assert deploy.fingerprint([photo, optional]) != first
