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
    assert set(item) == {"id", "rep", "customers", "question", "kind", "status", "created_at"}
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
