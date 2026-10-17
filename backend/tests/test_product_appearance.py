"""型錄外觀搜尋：真實 SKU 對應、圖片去重、向量空間與問答分流。"""

import gzip
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import products as products_api
from app.main import app
from app.models import AskRecord, Product
from app.services import asks, product_appearance as appearance


def test_cosine_rank_and_dimension_mismatch():
    data = {"dimension": 2, "sources": {
        "yellow": {"vector": [1.0, 0.0]}, "blue": {"vector": [0.0, 1.0]},
        "not_in_catalog": {"vector": [1.0, 0.0]},
    }}
    assert appearance.rank_photos(data, [5, 0], {"yellow", "blue"}) == [("yellow", 1.0), ("blue", 0.0)]
    with pytest.raises(appearance.AppearanceUnavailable):
        appearance.rank_photos(data, [1, 0, 0], {"yellow"})
    for vector in ([0, 0], [float("nan"), 1], [float("inf"), 0]):
        with pytest.raises(ValueError):
            appearance.unit_vector(vector)


@pytest.mark.parametrize("question", ["那個黃黃的藥", "找藍白色盒子的藥品", "圓圓的藥叫什麼名字", "找紅色包裝的商品"])
def test_appearance_questions(question):
    assert appearance.is_appearance_question(question)


@pytest.mark.parametrize("question", [
    "黃色藥怎麼吃？", "黃色藥的副作用", "黃色的藥可以吃嗎", "黃色藥有什麼療效",
    "黃色包裝商品的銷售額", "同事說的黃色藥是什麼", "頻道裡黃色藥的照片", "這個藥的劑量", "商品有幾項？",
])
def test_other_questions_keep_their_original_path(question):
    assert not appearance.is_appearance_question(question)


def test_index_checks_model_and_manifest(tmp_path, monkeypatch):
    manifest = tmp_path / "manifest.json"
    manifest.write_text('{"products":{},"sources":{}}')
    index = tmp_path / "index.json.gz"
    data = {"version": appearance.INDEX_VERSION, "complete": True, "model": "model-a",
            "manifest_sha256": appearance.manifest_digest(manifest), "sources": {"a": {"vector": [1, 0]}}}
    with gzip.open(index, "wt") as stream:
        json.dump(data, stream)
    monkeypatch.setattr(appearance, "embedding_model", lambda: "model-a")
    assert appearance.load_index(index, manifest)[0]["dimension"] == 2
    monkeypatch.setattr(appearance, "embedding_model", lambda: "model-b")
    with pytest.raises(appearance.AppearanceUnavailable, match="需要更新"):
        appearance.load_index(index, manifest)
    monkeypatch.setattr(appearance, "embedding_model", lambda: "model-a")
    manifest.write_text('{"products":{},"sources":{},"changed":true}')
    with pytest.raises(appearance.AppearanceUnavailable, match="需要更新"):
        appearance.load_index(index, manifest)
    with pytest.raises(appearance.AppearanceUnavailable):
        appearance.load_index(tmp_path / "missing.gz", manifest)


class FakeEmbedder:
    def embed_query(self, query):
        assert query.strip()
        return [1, 0]


def fake_index(monkeypatch, products):
    manifest = {"products": products, "sources": {"photo": {"file": "/product-photos/photo.webp", "title": "來源照片", "pageUrl": "https://example.com/product"}}}
    data = {"dimension": 2, "sources": {"photo": {"vector": [1.0, 0.0]}}}
    monkeypatch.setattr(appearance, "load_index", lambda: (data, manifest))


def test_groups_shared_photos_and_uses_current_catalog_names(tx, monkeypatch):
    rows = list(tx.scalars(select(Product).where(Product.category.in_(appearance.DRUG_CATEGORIES), appearance.visible_catalog_products()).limit(2)))
    fake_index(monkeypatch, {product.sku: {"source": "photo", "kind": "series"} for product in rows})
    hits = appearance.search_photos(tx, FakeEmbedder(), "黃黃的藥")
    assert len(hits) == 1
    assert {p["name"] for p in hits[0]["products"]} == {p.name for p in rows}
    assert {p["sku"] for p in hits[0]["products"]} == {p.sku for p in rows}
    assert all(p["kind"] == "series" for p in hits[0]["products"])
    assert rows[0].name in appearance.appearance_answer(hits)


def test_excludes_other_categories_demo_and_illustrative_photos(tx, monkeypatch):
    drug = tx.scalar(select(Product).where(Product.category.in_(appearance.DRUG_CATEGORIES), appearance.visible_catalog_products()).limit(1))
    other = tx.scalar(select(Product).where(Product.category == "日用品", appearance.visible_catalog_products()).limit(1))
    fake_index(monkeypatch, {
        drug.sku: {"source": "photo", "kind": "illustrative"},
        other.sku: {"source": "photo", "kind": "exact"},
        "RX-AML5": {"source": "photo", "kind": "series"},
        "UNKNOWN": {"source": "photo", "kind": "exact"},
    })
    assert appearance.search_photos(tx, FakeEmbedder(), "黃黃的藥") == []
    assert [p["sku"] for p in appearance.search_photos(tx, FakeEmbedder(), "黃色商品", drugs_only=False)[0]["products"]] == [other.sku]


def test_api_requires_login_rejects_blank_and_reports_unavailable(tx, auth, monkeypatch):
    client = TestClient(app)
    assert client.post("/api/products/appearance-search", json={"query": "黃黃的藥"}).status_code == 401
    assert client.post("/api/products/appearance-search", headers=auth(), json={"query": " "}).status_code == 422
    monkeypatch.setattr(appearance, "search_photos", lambda *args, **kwargs: (_ for _ in ()).throw(appearance.AppearanceUnavailable("商品照片索引需要更新，請稍後再試")))
    response = client.post("/api/products/appearance-search", headers=auth(), json={"query": "黃黃的藥"})
    assert response.status_code == 503
    assert "索引需要更新" in response.json()["detail"]


def test_api_returns_grouped_catalog_matches(tx, auth, monkeypatch):
    drug = tx.scalar(select(Product).where(Product.category.in_(appearance.DRUG_CATEGORIES), appearance.visible_catalog_products()).limit(1))
    fake_index(monkeypatch, {drug.sku: {"source": "photo", "kind": "series"}})
    monkeypatch.setattr(products_api, "optional_embedder", FakeEmbedder)
    response = TestClient(app).post("/api/products/appearance-search", headers=auth(), json={"query": "黃黃的藥"})
    assert response.status_code == 200
    assert response.json()["matches"][0]["products"][0]["sku"] == drug.sku


def test_assistant_routes_appearance_before_page_or_llm(tx, auth, monkeypatch):
    from app.services import assistant_context
    monkeypatch.setattr(assistant_context, "prepare", lambda *args: pytest.fail("外觀查找不應改送頁面說明"))
    response = TestClient(app).post("/api/asks/route", headers=auth(), json={"question": "那個黃黃的藥", "page": {"path": "/products", "title": "商品型錄", "facts": []}})
    assert response.status_code == 200
    assert response.json()["kind"] == "data"


def test_background_appearance_answer_does_not_need_generation_model(engine, monkeypatch):
    with Session(engine) as session:
        record = AskRecord(id="appearance-search-test", user_id="U01", kind="data", question="那個黃黃的藥", status="queued")
        session.add(record)
        session.commit()
    try:
        monkeypatch.setattr(asks, "get_llm", lambda: pytest.fail("品名應由型錄取得，不使用生成模型"))
        monkeypatch.setattr(appearance, "search_photos", lambda *args, **kwargs: [])
        asks.run_ask("appearance-search-test")
        with Session(engine) as session:
            record = session.get(AskRecord, "appearance-search-test")
            assert record.status == "answered"
            assert record.evidence == {"product_photos": []}
            assert record.finished_at
            session.delete(record)
            session.commit()
    finally:
        with Session(engine) as session:
            record = session.get(AskRecord, "appearance-search-test")
            if record:
                session.delete(record)
                session.commit()
