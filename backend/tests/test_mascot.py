import datetime as dt
import json
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.main import app
from app.models import AppUser, Customer, Itinerary, MascotCollectible, MascotEncounter, MascotWardrobe, StopArrival
from app.services import auth as auth_service, mascot_collection as service


@pytest.fixture
def client():
    return TestClient(app)


def account(tx, user_id="XMASCOT1"):
    user = AppUser(id=user_id, name="收藏小熊", role="sales", region="北區", acts_as_user_id="U01")
    tx.add(user)
    tx.commit()
    return {"Authorization": f"Bearer {auth_service.create_token(user)}"}


def split(client, headers, event_id=None):
    return client.post("/api/mascot/encounters", headers=headers, json={"event_id": str(event_id or uuid4())})


def equip(client, headers, color="classic", outfit="none", avatar=True):
    return client.put("/api/mascot/equip", headers=headers, json={"color": color, "outfit": outfit, "use_as_avatar": avatar})


def test_frontend_catalog_matches_backend_catalog():
    # 前端 Docker 的 context 只有 frontend：各留一份 JSON，由測試守住一致性。
    front = Path(service.__file__).resolve().parents[3] / "frontend/src/data/mascot-catalog.json"
    assert json.loads(front.read_text()) == service.CATALOG


def test_collection_requires_login_and_starts_with_daily_outfits(tx, client):
    assert client.get("/api/mascot").status_code == 401
    headers = account(tx)
    state = client.get("/api/mascot", headers=headers).json()
    assert state["equipped"] == {"color": "classic", "outfit": "none"}
    assert [item["id"] for item in state["colors"] if item["owned"]] == ["classic"]
    assert [item["id"] for item in state["outfits"] if item["owned"]] == [
        "none", "scarf", "beret", "nurse", "syringe", "pill", "tie", "briefcase", "wrench",
    ]
    assert state["encounters"] == 0


def test_assistant_achievements_require_login_and_reject_unknown_actions(tx, client):
    assert client.post("/api/mascot/achievements", json={"action": "ghost"}).status_code == 401
    headers = account(tx)
    assert client.post("/api/mascot/achievements", headers=headers, json={"action": "unknown"}).status_code == 422
    assert all(not item["owned"] for item in client.get("/api/mascot", headers=headers).json()["achievements"])


@pytest.mark.parametrize("action", ["ghost", "new"])
def test_assistant_achievement_is_permanent_deduplicated_and_personal(tx, client, action):
    first, second = account(tx), account(tx, "XMASCOT2")
    response = client.post("/api/mascot/achievements", headers=first, json={"action": action})
    assert response.status_code == 200
    result = response.json()
    assert result["newly_unlocked"] is True
    assert result["achievement"]["id"] == action
    assert result["achievement"]["owned"] is True
    assert result["achievement"]["unlocked_at"]
    repeat = client.post("/api/mascot/achievements", headers=first, json={"action": action}).json()
    assert repeat["newly_unlocked"] is False
    assert repeat["achievement"] == result["achievement"]
    assert tx.scalar(select(func.count()).select_from(MascotCollectible).where(MascotCollectible.user_id == "XMASCOT1", MascotCollectible.item_id == f"achievement:{action}")) == 1
    saved = TestClient(app).get("/api/mascot", headers=first).json()["achievements"]
    assert next(item for item in saved if item["id"] == action)["owned"] is True
    assert all(not item["owned"] for item in client.get("/api/mascot", headers=second).json()["achievements"])
    assert tx.get(MascotCollectible, ("U01", f"achievement:{action}")) is None
    # 彩蛋不是異色抽選，也不佔用八次保底。
    assert client.get("/api/mascot", headers=first).json()["encounters"] == 0


def test_county_unlock_uses_real_arrival_and_survives_route_reset(tx, client):
    headers = account(tx)
    customer = tx.scalar(select(Customer).where(Customer.city == "台北市").limit(1))
    itinerary = Itinerary(user_id="U01", date=dt.date(2099, 1, 1), suggested=[], urgent=None)
    tx.add(itinerary); tx.flush()
    tx.add(StopArrival(itinerary_id=itinerary.id, customer_id=customer.id)); tx.commit()
    state = client.get("/api/mascot", headers=headers).json()
    assert next(item for item in state["outfits"] if item["id"] == "taipei")["owned"] is True
    tx.execute(delete(StopArrival).where(StopArrival.itinerary_id == itinerary.id)); tx.commit()
    assert equip(client, headers, outfit="taipei").status_code == 200


def test_tapping_a_route_stop_collects_its_county_immediately(tx, client):
    headers = account(tx)
    response = client.get("/api/itinerary/today", headers=headers)
    assert response.status_code == 200
    stop = response.json()["stops"][0]
    arrived = client.post(f"/api/itinerary/today/stops/{stop['customer_id']}/arrive", headers=headers)
    assert arrived.status_code == 200
    outfit = next(item for item in service.CATALOG["outfits"] if item["city"] == stop["city"])
    # 到站即入庫，不必先打開衣櫃才收藏。
    assert tx.get(MascotCollectible, ("XMASCOT1", f"outfit:{outfit['id']}")) is not None


def test_shiny_is_drawn_once_and_saved_only_to_login_account(tx, client, monkeypatch):
    first, second = account(tx), account(tx, "XMASCOT2")
    monkeypatch.setattr(service.secrets, "randbelow", lambda size: 0)
    monkeypatch.setattr(service.secrets, "choice", lambda choices: "mint")
    event_id = uuid4()
    found = split(client, first, event_id).json()
    assert found["color_id"] == "mint" and found["newly_collected"] is True
    assert split(client, first, event_id).json() == found
    assert split(client, first).json()["newly_collected"] is False
    assert client.get("/api/mascot", headers=second).json()["colors"][1]["owned"] is False
    assert tx.scalar(select(func.count()).select_from(MascotEncounter).where(MascotEncounter.user_id == "XMASCOT1")) == 2
    assert equip(client, second, color="mint").status_code == 422
    # 換裝與頭像只改真正登入的人；同樣代理 U01 的人不會一起換。
    assert equip(client, first, color="mint", outfit="scarf").status_code == 200
    assert tx.get(MascotWardrobe, "U01") is None
    assert client.get("/api/mascot", headers=second).json()["equipped"]["color"] == "classic"


def test_eighth_split_guarantees_shiny_after_seven_misses(tx, client, monkeypatch):
    headers = account(tx)
    monkeypatch.setattr(service.secrets, "randbelow", lambda size: 1)
    monkeypatch.setattr(service.secrets, "choice", lambda choices: "gold")
    for _ in range(7):
        assert split(client, headers).json()["color_id"] == "classic"
    result = split(client, headers).json()
    assert result["color_id"] == "gold"
    assert result["collection"]["guaranteed_in"] == 8
    assert equip(client, headers, color="gold", outfit="beret").status_code == 200


def test_locked_or_unknown_items_cannot_be_equipped(tx, client):
    headers = account(tx)
    assert equip(client, headers, color="mint").status_code == 422
    assert equip(client, headers, outfit="kaohsiung").status_code == 422
    assert equip(client, headers, outfit="not-a-costume").status_code == 422
    assert split(client, headers, "fake-event").status_code == 422
    assert client.get("/api/mascot", headers=headers).json()["use_as_avatar"] is False


def test_avatar_is_shared_to_other_clients_and_can_be_removed(tx, client, auth):
    headers = account(tx)
    assert equip(client, headers, outfit="beret").status_code == 200
    assert TestClient(app).get("/api/avatars", headers=auth("U02")).json()["mascot_avatars"]["XMASCOT1"] == {"color": "classic", "outfit": "beret"}
    assert client.delete("/api/avatars/me", headers=headers).status_code == 204
    assert "XMASCOT1" not in client.get("/api/avatars", headers=headers).json()["mascot_avatars"]
    assert client.get("/api/mascot", headers=headers).json()["equipped"]["outfit"] == "beret"


def test_collection_survives_seed_restore_and_account_deletion_cascades(tx, client, monkeypatch):
    import seed
    headers = account(tx)
    monkeypatch.setattr(service.secrets, "randbelow", lambda size: 0)
    monkeypatch.setattr(service.secrets, "choice", lambda choices: "peach")
    split(client, headers)
    row = tx.get(MascotCollectible, ("XMASCOT1", "color:peach"))
    saved = {"user_id": row.user_id, "item_id": row.item_id, "unlocked_at": row.unlocked_at}
    tx.delete(row); tx.commit()
    counts = seed.restore_settings(tx, seed.KeptAccounts([], [], {"mascot_collectible": [saved]}))
    assert counts["mascot_collectible"] == 1
    tx.commit()
    assert equip(client, headers, color="peach").status_code == 200
    tx.delete(tx.get(AppUser, "XMASCOT1")); tx.commit()
    assert tx.scalar(select(func.count()).select_from(MascotCollectible).where(MascotCollectible.user_id == "XMASCOT1")) == 0
    assert tx.scalar(select(func.count()).select_from(MascotEncounter).where(MascotEncounter.user_id == "XMASCOT1")) == 0
