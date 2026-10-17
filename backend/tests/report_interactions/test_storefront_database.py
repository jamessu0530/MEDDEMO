import json

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models import AppUser, Customer, OutletStorefront
from app.services import auth
from app.services.storefront_photos import catalog_rows, import_catalog


def source():
    return {"records": [{"customer_id": "C1", "name": "未人工審核店家", "candidate_images": [
        {"image_url": "https://photos.example.com/shop.jpg", "page_url": "https://example.com/shop", "identity_verified": False, "exterior_verified": False},
        {"image_url": "https://photos.example.com/shop.jpg", "page_url": "https://example.com/shop"},
        {"image_url": "https://lh3.googleusercontent.com/photo", "page_url": "https://maps.google.com"},
        {"image_url": "javascript:alert(1)", "page_url": "https://example.com/shop"},
    ]}, {"customer_id": "not-imported-yet", "name": "另間店", "candidate_images": []}]}


def test_import_has_no_manual_gate_and_does_not_persist_google_photo_urls():
    rows = catalog_rows(source(), {"records": {"C1": {"place_id": "known-place"}, "not-imported-yet": {"candidate_place_ids": ["candidate-1", "candidate-1"]}}})
    assert len(rows[0]["photos"]) == 1
    assert rows[0]["photos"][0]["identity_matched"] is False
    assert rows[0]["google_place_id"] == "known-place"
    assert rows[1]["photos"] == [] and rows[1]["google_candidate_ids"] == ["candidate-1"]


def test_database_import_is_idempotent_and_does_not_create_or_edit_customers(interaction_session, tmp_path):
    path = tmp_path / "photos.json"; path.write_text(json.dumps(source()))
    before = interaction_session.scalar(select(func.count()).select_from(Customer))
    first = import_catalog(interaction_session.connection(), path, tmp_path / "absent.json")
    second = import_catalog(interaction_session.connection(), path, tmp_path / "absent.json")
    assert first["outlets"] == 2 and first["with_photos"] == 1 and first["changed"] == 2
    assert second["changed"] == 0
    assert interaction_session.scalar(select(func.count()).select_from(Customer)) == before
    assert interaction_session.get(OutletStorefront, "not-imported-yet") is not None


def test_customer_api_returns_stored_unreviewed_photo_without_any_google_request(interaction_session, tmp_path, monkeypatch):
    import httpx
    path = tmp_path / "photos.json"; path.write_text(json.dumps(source()))
    import_catalog(interaction_session.connection(), path, tmp_path / "absent.json")
    original = httpx.Client.send
    def guarded_send(client, request, *args, **kwargs):
        assert request.url.host == "testserver", "customer photo endpoint made an external request"
        return original(client, request, *args, **kwargs)
    monkeypatch.setattr(httpx.Client, "send", guarded_send)
    token = auth.create_token(interaction_session.get(AppUser, "S1"))
    response = TestClient(app).get("/api/customers/C1", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    photo = response.json()["storefront_photo"]
    assert photo["image_url"] == "https://photos.example.com/shop.jpg"
    assert photo["source_url"] == "https://example.com/shop"


def test_empty_and_existing_customer_photos_are_nullable(interaction_session):
    token = auth.create_token(interaction_session.get(AppUser, "S1"))
    response = TestClient(app).get("/api/customers/C2", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200 and response.json()["storefront_photo"] is None
