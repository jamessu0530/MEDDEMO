import json
import os
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import AppUser, Product
from app.services import auth, outlet_search, product_search


def headers(session):
    return {"Authorization": f"Bearer {auth.create_token(session.get(AppUser, 'S1'))}"}


@pytest.fixture
def catalog(interaction_session, monkeypatch):
    session = interaction_session
    first, second = session.get(Product, "P1"), session.get(Product, "P2")
    first.name, first.category, first.spec, first.aliases = "台灣維他命錠", "一般用藥", "500mg", ["海藻鈣", "補鈣錠"]
    second.name, second.category, second.spec = "消炎藥膏", "慢性處方", "20g"
    session.add(Product(sku="fake-hidden", name="海藻鈣隱藏品", category="一般用藥", spec="500mg",
        unit="盒", unit_price=100, unit_cost=40))
    session.flush()
    monkeypatch.setattr(product_search, "_paused_until", 0.0)
    return session


def test_database_fallback_normalizes_terms_and_preserves_literal_characters(catalog, monkeypatch):
    monkeypatch.setattr(product_search, "search_skus", lambda query: None)
    for query in ("海藻钙", "補鈣錠 ５００ＭＧ", "臺灣", "ｐ１", "一般用药 500mg"):
        assert product_search.matching_skus(catalog, query) == ["P1"]
    for query in ("海藻鈣 20g", "%", "_", "不存在"):
        assert product_search.matching_skus(catalog, query) == []


def test_index_hits_are_ranked_filtered_and_merged_with_current_products(catalog, monkeypatch):
    monkeypatch.setattr(product_search, "search_skus", lambda query: ["fake-hidden", "deleted", "P2"])
    assert product_search.matching_skus(catalog, "海藻鈣") == ["P1", "P2"]
    assert product_search.matching_skus(catalog, "海藻鈣", "一般用藥") == ["P1"]
    assert product_search.matching_skus(catalog, "500mg") == ["P2", "P1"]


def test_search_api_requires_login_validates_query_and_returns_current_skus(catalog, monkeypatch):
    monkeypatch.setattr(product_search, "search_skus", lambda query: ["P2", "fake-hidden"])
    client = TestClient(app)
    assert client.get("/api/products/search", params={"q": "藥膏"}).status_code == 401
    for query in ("", "  ", "x" * 201):
        assert client.get("/api/products/search", params={"q": query}, headers=headers(catalog)).status_code == 422
    response = client.get("/api/products/search", params={"q": "海藻鈣", "category": "一般用藥"}, headers=headers(catalog))
    assert response.status_code == 200
    assert response.json() == {"skus": ["P1"]}


def test_order_picker_uses_search_relevance_across_pages(catalog, monkeypatch):
    rows = [Product(sku=f"R{i:03}", name=f"台灣藥品{i}", category="一般用藥", spec="盒", unit="盒",
        unit_price=100, unit_cost=40) for i in range(55)]
    catalog.add_all(rows)
    catalog.flush()
    ranked = [row.sku for row in reversed(rows)]
    monkeypatch.setattr(product_search, "search_skus", lambda query: ["deleted", "fake-hidden", *ranked])
    client = TestClient(app)
    found = []
    for page in (1, 2, 3):
        response = client.get("/api/orders/products", params={"customer_id": "C1", "q": "台灣藥平", "page": page},
            headers=headers(catalog))
        assert response.status_code == 200, response.text
        assert response.json()["total"] == 55
        found.extend(row["sku"] for row in response.json()["items"])
    assert found == ranked


def test_search_requests_require_all_terms_and_support_alias_fuzziness(monkeypatch, env):
    env(ELASTICSEARCH_URL="http://127.0.0.1:19201")
    monkeypatch.setattr(product_search, "_paused_until", 0.0)
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, json={"hits": {"hits": [{"_id": "P1"}]}})

    monkeypatch.setattr(outlet_search, "_client", lambda: httpx.Client(
        base_url="http://elasticsearch:9200", transport=httpx.MockTransport(respond)))
    assert product_search.search_skus("海藻钙 ５００ＭＧ") == ["P1"]
    body = json.loads(requests[0].content)
    assert requests[0].url.path == "/meddemo-products/_search"
    assert body["_source"] is False
    assert len(body["query"]["bool"]["must"]) == 2
    assert "海藻鈣" in requests[0].content.decode()
    assert "aliases" in requests[0].content.decode()
    assert "fuzziness" in requests[0].content.decode()


@pytest.mark.parametrize("failure", ["timeout", "missing", "malformed"])
def test_service_failures_fall_back_and_pause_repeated_requests(monkeypatch, env, failure):
    env(ELASTICSEARCH_URL="http://127.0.0.1:19201")
    monkeypatch.setattr(product_search, "_paused_until", 0.0)
    requests = []

    def respond(request):
        requests.append(request)
        if failure == "timeout":
            raise httpx.ReadTimeout("unavailable")
        return httpx.Response(404) if failure == "missing" else httpx.Response(200, json={})

    monkeypatch.setattr(outlet_search, "_client", lambda: httpx.Client(
        base_url="http://elasticsearch:9200", transport=httpx.MockTransport(respond)))
    assert product_search.search_skus("海藻鈣") is None
    assert product_search.search_skus("藥膏") is None
    assert len(requests) == 1


def test_product_index_cannot_overwrite_customer_index(env):
    env(ELASTICSEARCH_PRODUCT_INDEX="meddemo-customers")
    with pytest.raises(ValueError, match="與客戶索引相同"):
        product_search._index()


@pytest.mark.search_integration
@pytest.mark.skipif(os.environ.get("RUN_SEARCH_INTEGRATION") != "1", reason="需明確啟用 Elasticsearch 實測")
def test_real_product_search_normalization_typos_and_atomic_rebuild(catalog, monkeypatch, env):
    env(ELASTICSEARCH_URL="http://127.0.0.1:19201", ELASTICSEARCH_PRODUCT_INDEX=f"meddemo-product-test-{uuid.uuid4().hex}")
    alias = product_search._index()
    try:
        assert product_search.rebuild(catalog) == 2
        assert product_search.index_is_healthy(2)
        assert not product_search.index_is_healthy(3)
        for query in ("海藻钙", "補鈣定", "維他名", "ｐ１", "臺灣", "維他命", "一般用药 ５００ｍｇ"):
            assert "P1" in product_search.search_skus(query), query
        assert product_search.search_skus("海藻鈣 20g") == []
        assert "fake-hidden" not in product_search.search_skus("海藻鈣")
        with outlet_search._client() as client:
            previous = set(client.get(f"/_alias/{alias}").json())
            document = client.get(f"/{alias}/_doc/P1").json()["_source"]
            assert set(document) == {"sku", "name", "aliases", "search_text"}
        with monkeypatch.context() as broken:
            broken.setattr(outlet_search, "normalize", lambda value: {})
            with pytest.raises(RuntimeError, match="保留舊索引"):
                product_search.rebuild(catalog)
        with outlet_search._client() as client:
            assert set(client.get(f"/_alias/{alias}").json()) == previous
        assert "P1" in product_search.search_skus("海藻鈣")
        # 新商品尚未同步，仍可由主檔文字比對查到。
        catalog.add(Product(sku="R-new", name="新補鈣錠", category="一般用藥", spec="250mg", unit="盒", unit_price=100, unit_cost=40))
        catalog.flush()
        assert "R-new" in product_search.matching_skus(catalog, "新補鈣錠")
    finally:
        with outlet_search._client() as client:
            current = client.get(f"/_alias/{alias}")
            if current.status_code == 200:
                for index in current.json():
                    client.delete(f"/{index}").raise_for_status()
