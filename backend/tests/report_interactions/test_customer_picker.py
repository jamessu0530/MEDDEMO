import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import AppUser, OutletStorefront
from app.services import auth, outlet_search


def headers(session):
    return {"Authorization": f"Bearer {auth.create_token(session.get(AppUser, 'S1'))}"}


def add_photo(session, customer_id):
    session.add(OutletStorefront(outlet_id=customer_id, photos=[{
        "image_url": "https://photos.example.com/shop.jpg",
        "source_url": "https://example.com/shop",
    }]))
    session.flush()


def test_picker_pages_prioritize_photos_without_losing_customers(interaction_session):
    add_photo(interaction_session, "C3")
    add_photo(interaction_session, "C4")
    client = TestClient(app)
    first = client.get("/api/customers/picker?limit=2", headers=headers(interaction_session))
    assert first.status_code == 200
    assert [c["id"] for c in first.json()["customers"]] == ["C3", "C4"]
    assert first.json()["next_offset"] == 2
    assert all(c["storefront_photo"] for c in first.json()["customers"])
    second = client.get("/api/customers/picker?limit=2&offset=2", headers=headers(interaction_session))
    assert [c["id"] for c in second.json()["customers"]] == ["C1", "C2"]
    assert second.json()["next_offset"] is None
    assert client.get("/api/customers/picker?offset=4", headers=headers(interaction_session)).json() == {
        "customers": [], "next_offset": None,
    }
    # Existing full-list consumers still receive every customer in their original order.
    full = client.get("/api/customers", headers=headers(interaction_session))
    assert [c["id"] for c in full.json()] == ["C1", "C2", "C3", "C4"]


def test_picker_search_retains_relevance_across_pages(interaction_session, monkeypatch):
    add_photo(interaction_session, "C3")
    monkeypatch.setattr(outlet_search, "customer_matches", lambda session, q: ["C2", "C3", "deleted", "C1"])
    client = TestClient(app)
    first = client.get("/api/customers/picker?q=藥局&limit=2", headers=headers(interaction_session)).json()
    assert [c["id"] for c in first["customers"]] == ["C2", "C3"]
    assert first["next_offset"] == 2
    second = client.get("/api/customers/picker?q=藥局&limit=2&offset=2", headers=headers(interaction_session)).json()
    assert [c["id"] for c in second["customers"]] == ["C1"]
    assert second["next_offset"] is None


@pytest.mark.parametrize("params", ["limit=0", "limit=101", "offset=-1", "q=" + "a" * 101])
def test_picker_rejects_unbounded_requests(interaction_session, params):
    assert TestClient(app).get("/api/customers/picker?" + params, headers=headers(interaction_session)).status_code == 422


def test_picker_requires_login(interaction_session):
    assert TestClient(app).get("/api/customers/picker").status_code == 401
