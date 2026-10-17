import json
import os
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models import Customer, PublicOutlet
from app.services import outlet_search
from app.services.public_outlets import SOURCE_FILE, import_snapshot, source_id


def test_public_snapshot_import_is_repeatable_and_preserves_existing_customer_data(tx):
    before = [(c.id, c.name, c.owner_user_id, c.payment_term, c.grade) for c in tx.scalars(select(Customer).order_by(Customer.id))]
    first = import_snapshot(tx)
    second = import_snapshot(tx)
    assert first == {"source_records": 4918, "public_outlets": 4642, "created": 4642, "review_records": 83}
    assert second["created"] == 0
    assert tx.scalar(select(func.count()).select_from(Customer)) == len(before) + 4642
    assert [(c.id, c.name, c.owner_user_id, c.payment_term, c.grade) for c in tx.scalars(select(Customer).where(Customer.type != "outlet").order_by(Customer.id))] == before
    assert tx.scalar(select(func.count()).select_from(Customer).where(Customer.type == "outlet", Customer.owner_user_id.is_(None), Customer.grade.is_(None), Customer.payment_term.is_(None))) == 4642
    data = json.loads(SOURCE_FILE.read_text())
    original = data["records"][0]
    source = tx.get(PublicOutlet, source_id(original))
    assert source.phone == original["tel"] == "0224555173"
    assert source.raw_record == original
    assert source.retrieved_on.isoformat() == "2026-10-16"


def test_public_customers_are_searchable_and_visible_to_any_signed_in_user(tx, auth, monkeypatch):
    import_snapshot(tx)
    monkeypatch.setattr(outlet_search, "search_ids", lambda q: None)
    with TestClient(app) as client:
        for user in ("U01", "U03", "M01"):
            # 已登入才可查；誰的區域／名下不限制共用客戶。
            response = client.get("/api/customers?q=七堵區開元路", headers=auth(user))
            assert response.status_code == 200
            found = next(row for row in response.json() if row["name"] == "合康藥局")
            assert found["phone"] == "0224555173"
            assert found["owner_id"] is None and found["grade"] is None
            assert client.get(f'/api/customers/{found["id"]}', headers=auth(user)).status_code == 200
            profile = client.get(f'/api/customers/{found["id"]}/profile', headers=auth(user))
            assert profile.status_code == 200, profile.text
            assert "尚無進貨紀錄" in profile.json()["highlights"][0]
        assert client.get("/api/customers?q=合康").status_code == 401


@pytest.mark.parametrize("url", ["https://example.com:9200", "http://127.0.0.1:9200", "http://elasticsearch.evil.test:9200", "http://user:pass@elasticsearch:9200", "http://elasticsearch:9200/other"])
def test_search_destination_cannot_send_customer_data_outside_our_service(url, env):
    env(ELASTICSEARCH_URL=url)
    with pytest.raises(ValueError, match="本機或 MEDDEMO"):
        outlet_search._client()


def test_search_normalizes_traditional_simplified_and_fullwidth_characters():
    assert outlet_search.normalize(" 臺北 華興藥局Ａ ") == outlet_search.normalize("台北华兴药局a")


@pytest.mark.search_integration
@pytest.mark.skipif(os.environ.get("RUN_SEARCH_INTEGRATION") != "1", reason="需明確啟用本機／CI Elasticsearch 實測")
def test_real_elasticsearch_fuzzy_chinese_phone_and_failed_rebuild_preserves_alias(tx, env, monkeypatch):
    env(ELASTICSEARCH_URL="http://127.0.0.1:19201", ELASTICSEARCH_INDEX=f"meddemo-test-{uuid.uuid4().hex}")
    import_snapshot(tx)
    row = next(x for x in json.loads(SOURCE_FILE.read_text())["records"] if x["name"] == "合康藥局" and x["tel"] == "0224555173")
    key = source_id(row)
    alias = outlet_search._index()
    try:
        count = outlet_search.rebuild(tx)
        assert count == tx.scalar(select(func.count()).select_from(Customer))
        assert outlet_search.index_is_healthy(count)
        assert not outlet_search.index_is_healthy(count + 1)
        assert key in outlet_search.search_ids("合康藥句")
        assert key in outlet_search.search_ids("合康药局")
        assert key in outlet_search.search_ids("0224555173")
        assert key in outlet_search.search_ids("七堵區開元路")
        assert set(outlet_search.search_ids("臺北")) == set(outlet_search.search_ids("台北"))
        with outlet_search._client() as client:
            previous = set(client.get(f"/_alias/{alias}").json())
        with monkeypatch.context() as broken:
            broken.setattr(outlet_search, "normalize", lambda text: {})
            with pytest.raises(RuntimeError, match="保留舊索引"):
                outlet_search.rebuild(tx)
        with outlet_search._client() as client:
            assert set(client.get(f"/_alias/{alias}").json()) == previous
        assert key in outlet_search.search_ids("合康藥局")
    finally:
        with outlet_search._client() as client:
            current = client.get(f"/_alias/{alias}")
            if current.status_code == 200:
                for index in current.json():
                    client.delete(f"/{index}").raise_for_status()


def test_public_customer_order_requires_a_real_payment_choice_and_is_shared(tx, auth, monkeypatch):
    from app.models import AppUser, SapQuotationDraft, Receivable
    from app.services import order_workspace
    import_snapshot(tx)
    customer = tx.scalars(select(Customer).where(Customer.type == "outlet")).first()
    assert customer.owner_user_id is None and customer.payment_term is None
    monkeypatch.setattr(order_workspace.writeback, "is_mock_down", lambda target: False)
    payload = {"customer_id": customer.id, "ship_to_id": customer.id, "shipping_date": "2026-10-28",
        "shipping_address": "測試收貨地址", "recipient": "測試", "items": [{"sku": "F764521", "qty": 1, "unit_price": 990}]}
    with TestClient(app) as client:
        assert client.post("/api/orders", json=payload, headers=auth("U03")).status_code == 422
        created = client.post("/api/orders", json={**payload, "payment_term": "RM06"}, headers=auth("U03"))
        assert created.status_code == 201, created.text
        order = created.json()
        assert order["owner_id"] is None and order["payment_term"] == "RM06"
        sent = client.post(f"/api/orders/{order['id']}/submit", json={"revision": 1}, headers=auth("U01"))
        assert sent.status_code == 200, sent.text
        assert sent.json()["status"] == "effective"
    tx.refresh(customer)
    assert customer.payment_term is None and customer.owner_user_id is None


def test_legacy_quote_checkout_without_payment_does_not_change_quote(tx, auth, monkeypatch):
    from app.models import SapQuotationDraft
    from app.services import writeback
    import_snapshot(tx)
    customer = tx.scalars(select(Customer).where(Customer.type == "outlet")).first()
    monkeypatch.setattr(writeback, "is_mock_down", lambda target: False)
    with TestClient(app) as client:
        response = client.post(f"/api/customers/{customer.id}/quotes", json={"items": [{"sku": "HS-FO30", "qty": 1}]}, headers=auth("U01"))
        assert response.status_code == 201, response.text
        quote_no = response.json()["quote_no"]
        response = client.post(f"/api/customers/{customer.id}/quotes/{quote_no}/order", headers=auth("U03"))
        assert response.status_code == 422 and "付款條件" in response.json()["detail"]
    assert tx.scalar(select(SapQuotationDraft.status).where(SapQuotationDraft.quote_no == quote_no).limit(1)) == "draft"
