from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models import AppUser, Channel, Place
from app.services.channel_geography import ensure_places, geography, location_key
from app.services.channels import ensure_channels, get_channel
from app.services.public_outlets import import_snapshot


def test_official_snapshot_has_unique_districts_and_all_islands():
    cities = geography()["cities"]
    codes = [district["code"] for city in cities for district in city["districts"]]
    assert len(cities) == 22 and len(codes) == len(set(codes)) == 368
    counts = {city["name"]: len(city["districts"]) for city in cities}
    assert {name: counts[name] for name in ("新竹市", "新竹縣", "臺南市", "高雄市", "連江縣")} == {
        "新竹市": 3, "新竹縣": 13, "臺南市": 37, "高雄市": 38, "連江縣": 4,
    }


def test_shared_locations_are_repeatable_and_keep_private_teams_private(tx, auth):
    before = tx.scalar(select(func.count()).select_from(Channel))
    assert ensure_places(tx) == 0
    ensure_channels(tx)
    assert tx.scalar(select(func.count()).select_from(Channel)) == before
    shared = tx.scalar(select(Channel.id).join(Place).where(Place.name == "連江縣南竿鄉"))
    national = tx.scalar(select(Channel.id).where(Channel.kind == "national"))
    for user_id in ("U01", "U03", "U04", "M01", "A01"):
        info = get_channel(tx, tx.get(AppUser, user_id), shared)
        assert info.parent_id == national and info.region_id is None and info.audience == "全公司都看得到"
    with TestClient(app) as client:
        assert client.get(f"/api/channels/{shared}", headers=auth("U04")).status_code == 200
        assert client.get(f"/api/channels/{shared}").status_code == 401
        team = tx.scalar(select(Channel.id).where(Channel.manager_id == "M01"))
        assert client.get(f"/api/channels/{team}", headers=auth("U04")).status_code == 404


def test_public_outlet_import_uses_shared_channels_and_threads_link_back(tx, auth):
    import_snapshot(tx)
    from app.models import Customer
    customer = tx.scalar(select(Customer).where(Customer.name == "合康藥局", Customer.city == "基隆市", Customer.area == "七堵區"))
    place = tx.get(Place, customer.place_id)
    assert location_key(place.name) == "基隆市七堵區"
    channel_id = tx.scalar(select(Channel.id).where(Channel.place_id == place.id))
    with TestClient(app) as client:
        for user in ("U01", "U03", "U04"):
            assert client.get(f"/api/channels/{channel_id}", headers=auth(user)).status_code == 200
        thread = client.post(f"/api/customers/{customer.id}/thread", headers=auth("U03"))
        assert thread.status_code == 200 and thread.json()["parent_id"] == channel_id
