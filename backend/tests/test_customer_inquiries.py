import datetime as dt
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models import AppUser, AskRecord, Customer, Itinerary
from app.services.assistant_context import PageContext
from app.services.customer_inquiries import associated_customer_ids


@pytest.fixture
def client(tx, monkeypatch):
    monkeypatch.setattr("app.api.asks.visit_queue", lambda: Mock())
    return TestClient(app)


@pytest.fixture
def customers(tx):
    return list(tx.scalars(select(Customer).where(Customer.owner_user_id == "U01").order_by(Customer.id).limit(2)))


def record(tx, key, customer, **changes):
    values = dict(id=key, user_id="U01", kind="knowledge", question="這家可以怎麼處理退貨？",
                  status="answered", customer_ids=[customer.id], ghost=False,
                  created_at=dt.datetime.now(dt.UTC).replace(tzinfo=None))
    tx.add(AskRecord(**(values | changes)))
    tx.flush()


def test_only_customer_questions_in_the_managers_team_are_shared(tx, client, auth, customers):
    customer = customers[0]
    record(tx, "team-inquiry", customer, answer="私人的完整答案", evidence={"sql": "不公開的查詢"})
    record(tx, "outside-inquiry", customer, user_id="U03")
    record(tx, "ghost-inquiry", customer, ghost=True)
    record(tx, "private-inquiry", customer, customer_ids=[])
    record(tx, "legacy-inquiry", customer, customer_ids=None)
    record(tx, "old-inquiry", customer, created_at=dt.datetime.now(dt.UTC).replace(tzinfo=None) - dt.timedelta(days=31))
    before = tx.scalar(select(func.count()).select_from(Itinerary))
    response = client.get("/api/manager/inquiries", headers=auth("M01"))
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    data = response.json()
    assert data["scope"] == "北區" and data["total"] == 1
    assert {rep["id"] for rep in data["reps"]} == {"U01", "U02"}
    item = data["items"][0]
    assert item["id"] == "team-inquiry"
    assert item["customers"] == [{"id": customer.id, "name": customer.name}]
    assert item["rep"]["id"] == "U01" and item["created_at"].endswith("+00:00")
    assert set(item) == {"id", "rep", "customers", "question", "kind", "status", "created_at", "location"}
    assert "私人的完整答案" not in response.text and "不公開的查詢" not in response.text
    assert tx.scalar(select(func.count()).select_from(Itinerary)) == before
    assert client.get("/api/asks/team-inquiry", headers=auth("M01")).status_code == 404
    company = client.get("/api/manager/inquiries", headers=auth("A01")).json()
    assert company["scope"] == "全公司" and company["total"] == 2


def test_filters_search_and_pagination(tx, client, auth, customers):
    for index in range(3):
        record(tx, f"filter-{index}", customers[index % 2], status="no_evidence" if index == 1 else "answered",
               created_at=dt.datetime.now(dt.UTC).replace(tzinfo=None) - dt.timedelta(days=index))
    def read(**query):
        response = client.get("/api/manager/inquiries", params=query, headers=auth("M01"))
        assert response.status_code == 200, response.text
        return response.json()
    first, second = read(limit=1), read(limit=1, offset=1)
    assert first["total"] == 3 and first["items"][0]["id"] == "filter-0"
    assert second["items"][0]["id"] == "filter-1"
    assert read(needs_help=True)["total"] == 1
    assert read(rep="U02")["total"] == 0
    assert read(q=customers[1].name)["total"] == 1
    assert read(q="退貨")["total"] == 3
    assert read(q="林昱辰")["total"] == 3
    assert read(q="不存在的關鍵字")["total"] == 0
    assert read(days=1)["total"] == 1


def test_access_boundaries(client, auth):
    assert client.get("/api/manager/inquiries").status_code == 401
    assert client.get("/api/manager/inquiries", headers=auth("U01")).status_code == 403
    for rep in ("U03", "M01", "unknown"):
        assert client.get("/api/manager/inquiries", params={"rep": rep}, headers=auth("M01")).status_code == 404
    for query in ({"days": 0}, {"days": 91}, {"offset": -1}, {"limit": 101}):
        assert client.get("/api/manager/inquiries", params=query, headers=auth("M01")).status_code == 422


def test_customer_matching_respects_explicit_names_and_context(tx, customers):
    user = tx.get(AppUser, "U01")
    first, second = customers
    page = PageContext(path=f"/customers/{first.id}", title="客戶檔案")
    match = lambda question, **kwargs: associated_customer_ids(tx, user, question, **kwargs)
    assert match(f"{first.name} 的退貨怎麼處理？") == [first.id]
    assert match(f"{first.id} 和 {second.id} 有什麼差異？") == sorted([first.id, second.id])
    assert match(f"{second.id} 的折扣多少？", page=page) == [second.id]
    assert match("這間最近進貨如何？", page=page) == [first.id]
    assert match("能提供的折扣多少？", page=page, context_used=True) == [first.id]
    assert match("全公司的退貨規定是什麼？", page=page) == []
    assert match("今天我心情不好", page=page) == []
    assert match("這間如何？", page=PageContext(path="/customers/unknown", title="客戶檔案")) == []
    assert match("這間如何？", page=PageContext(path="//external.test/customers/" + first.id, title="客戶檔案")) == []
    assert match(first.id + "999 的價格？") == []


@pytest.mark.parametrize("multipart", [False, True])
def test_typed_voice_and_attachment_queries_keep_customer_context(client, tx, auth, customers, multipart):
    customer = customers[0]
    payload = dict(kind="knowledge", question="這間可以退貨嗎？",
                   page={"path": f"/customers/{customer.id}", "title": "客戶檔案", "facts": []}, context_used=True)
    if multipart:
        import json
        response = client.post("/api/asks", headers=auth("U01"),
                               data={**payload, "page": json.dumps(payload["page"]), "context_used": "true"},
                               files={"ignored": (None, "multipart")})
    else:
        response = client.post("/api/asks", headers=auth("U01"), json=payload)
    assert response.status_code == 202, response.text
    tx.expire_all()
    assert tx.get(AskRecord, response.json()["id"]).customer_ids == [customer.id]
    ghost = client.post("/api/asks", headers=auth("U01"), json={**payload, "ghost": True})
    assert ghost.status_code == 202, ghost.text
    tx.expire_all()
    assert tx.get(AskRecord, ghost.json()["id"]).customer_ids == []


def fresh_fix(**changes):
    return dict(lat=25.034, lng=121.5645, accuracy_m=15,
                captured_at=dt.datetime.now(dt.UTC).isoformat()) | changes


@pytest.mark.parametrize("multipart", [False, True])
def test_a_question_keeps_one_fixed_location_and_appears_on_the_map(client, tx, auth, multipart):
    import json
    fix = fresh_fix()
    payload = dict(kind="data", question="公司有哪些藥品？", inquiry_location=fix)
    if multipart:
        response = client.post("/api/asks", headers=auth("U01"),
                               data={**payload, "inquiry_location": json.dumps(fix)},
                               files={"ignored": (None, "multipart")})
    else:
        response = client.post("/api/asks", headers=auth("U01"), json=payload)
    assert response.status_code == 202, response.text
    key = response.json()["id"]
    tx.expire_all()
    saved = dict(tx.get(AskRecord, key).inquiry_location)
    assert (saved["lat"], saved["lng"]) == (fix["lat"], fix["lng"])
    response = client.post("/api/presence/ping", headers=auth("U01"),
                           json={"active": True, "location": {"lat": 23, "lng": 120}})
    assert response.status_code == 200
    tx.expire_all()
    assert tx.get(AskRecord, key).inquiry_location == saved
    data = client.get("/api/manager/inquiries", headers=auth("M01")).json()
    assert data["mapped_total"] == 1 and data["unlocated_count"] == 0
    assert data["map_items"][0]["id"] == key
    assert data["map_items"][0]["location"] == saved
    assert not {"route", "live", "current_location", "polyline"} & data.keys()
    assert client.get("/api/manager/inquiries", headers=auth("M02")).json()["map_items"] == []


def test_map_points_follow_filters_and_are_not_limited_to_the_list_page(tx, client, auth, customers):
    fix = fresh_fix() | {"place_name": "提問時的店家附近"}
    record(tx, "located-a", customers[0], inquiry_location=fix)
    record(tx, "located-b", customers[1], inquiry_location=fix, status="failed")
    record(tx, "unlocated", customers[0])
    record(tx, "outside-map", customers[0], inquiry_location=fix, user_id="U03")
    record(tx, "ghost-map", customers[0], inquiry_location=fix, ghost=True)
    data = client.get("/api/manager/inquiries?limit=1&offset=1", headers=auth("M01")).json()
    assert len(data["items"]) == 1 and {item["id"] for item in data["map_items"]} == {"located-a", "located-b"}
    assert data["total"] == 3 and data["mapped_total"] == 2 and data["unlocated_count"] == 1
    help = client.get("/api/manager/inquiries?needs_help=true", headers=auth("M01")).json()
    assert [item["id"] for item in help["map_items"]] == ["located-b"]
    assert client.get("/api/manager/inquiries?rep=U02", headers=auth("M01")).json()["map_items"] == []
    assert client.get("/api/manager/inquiries?q=提問時的店家", headers=auth("M01")).json()["mapped_total"] == 2


def test_question_customer_is_not_mistaken_for_physical_location(tx, client, auth, customers):
    here, other = customers
    fix = fresh_fix(lat=here.lat, lng=here.lng)
    response = client.post("/api/asks", headers=auth("U01"),
                           json=dict(kind="data", question=f"{other.id} 的進貨如何？", inquiry_location=fix))
    assert response.status_code == 202, response.text
    tx.expire_all()
    row = tx.get(AskRecord, response.json()["id"])
    assert row.customer_ids == [other.id]
    assert row.inquiry_location["place_name"] == f"{here.name}附近"
    assert (row.inquiry_location["lat"], row.inquiry_location["lng"]) == (here.lat, here.lng)


@pytest.mark.parametrize("changes", [
    {"captured_at": (dt.datetime.now(dt.UTC) - dt.timedelta(minutes=10)).isoformat()},
    {"captured_at": (dt.datetime.now(dt.UTC) + dt.timedelta(minutes=5)).isoformat()},
])
def test_old_or_future_fixes_are_not_saved_but_the_question_still_works(client, tx, auth, changes):
    response = client.post("/api/asks", headers=auth("U01"),
                           json=dict(kind="data", question="有哪些商品？", inquiry_location=fresh_fix(**changes)))
    assert response.status_code == 202
    tx.expire_all()
    assert tx.get(AskRecord, response.json()["id"]).inquiry_location is None


def test_ghost_questions_never_keep_or_share_locations(client, tx, auth, customers):
    response = client.post("/api/asks", headers=auth("U01"),
                           json=dict(kind="knowledge", question=customers[0].name, ghost=True, inquiry_location=fresh_fix()))
    assert response.status_code == 202
    tx.expire_all()
    row = tx.get(AskRecord, response.json()["id"])
    assert row.inquiry_location is None and row.customer_ids == []
    assert client.get("/api/manager/inquiries", headers=auth("M01")).json()["map_items"] == []


@pytest.mark.parametrize("changes", [{"lat": 91}, {"lng": -181}, {"accuracy_m": -1}, {"lat": "NaN"}, {"captured_at": "2026-10-20T08:00:00"}])
def test_invalid_fixes_are_rejected(client, auth, changes):
    assert client.post("/api/asks", headers=auth("U01"),
                       json=dict(kind="data", question="有哪些商品？", inquiry_location=fresh_fix(**changes))).status_code == 422


@pytest.mark.parametrize("role", ["M01", "A01"])
def test_non_sales_accounts_cannot_record_question_locations(client, tx, auth, role):
    response = client.post("/api/asks", headers=auth(role),
                           json=dict(kind="knowledge", question="退貨規定？", inquiry_location=fresh_fix()))
    assert response.status_code == 202, response.text
    tx.expire_all()
    assert tx.get(AskRecord, response.json()["id"]).inquiry_location is None


def test_coarse_question_fix_does_not_claim_a_nearby_store(client, tx, auth, customers):
    customer = customers[0]
    fix = fresh_fix(lat=customer.lat, lng=customer.lng, accuracy_m=1500)
    response = client.post("/api/asks", headers=auth("U01"),
                           json=dict(kind="data", question="有哪些商品？", inquiry_location=fix))
    assert response.status_code == 202
    tx.expire_all()
    location = tx.get(AskRecord, response.json()["id"]).inquiry_location
    assert location["place_name"] is None and location["accuracy_m"] == 1500


def test_map_limit_reports_full_count_without_affecting_the_question_list(tx, client, auth, customers, monkeypatch):
    monkeypatch.setattr("app.api.manager.MAP_LIMIT", 1)
    for key in ("pin-1", "pin-2"):
        record(tx, key, customers[0], inquiry_location=fresh_fix())
    data = client.get("/api/manager/inquiries", headers=auth("M01")).json()
    assert len(data["map_items"]) == 1 and data["mapped_total"] == 2
    assert len(data["items"]) == 2 and data["unlocated_count"] == 0
