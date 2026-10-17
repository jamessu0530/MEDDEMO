import copy
import hashlib

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import func, select

from app.main import app
from app.models import Product, ProductPhoto, SalesTransaction, UserReportConfig
from app.services.product_photos import import_reviewed_photos, read_reviewed_photos


def test_reviewed_import_is_idempotent_and_preserves_catalog_and_business_data(interaction_session):
    session = interaction_session
    records = read_reviewed_photos()
    for row in records:
        session.add(Product(sku=row['sku'], name=row['catalog_name'], category=row['category'],
                            spec='', unit='盒', unit_price=123.45, unit_cost=40))
    session.add(UserReportConfig(user_id='S1', config={'keep': '使用者設定'}))
    session.flush()
    before = list(session.execute(select(Product.sku, Product.name, Product.unit_price, Product.unit_cost).order_by(Product.sku)))
    result = import_reviewed_photos(session.connection(), records)
    assert result['inserted'] == len(records) and result['updated'] == result['unchanged'] == 0
    again = import_reviewed_photos(session.connection(), records)
    assert again['unchanged'] == len(records) and again['inserted'] == again['updated'] == 0
    assert session.scalar(select(func.count()).select_from(ProductPhoto)) == len(records)
    assert list(session.execute(select(Product.sku, Product.name, Product.unit_price, Product.unit_cost).order_by(Product.sku))) == before
    assert session.scalar(select(func.count()).select_from(SalesTransaction)) == 6
    assert session.get(UserReportConfig, 'S1').config == {'keep': '使用者設定'}
    for row in records:
        stored = session.get(ProductPhoto, row['sku'])
        assert stored.content == row['content']
        assert hashlib.sha256(stored.content).hexdigest() == stored.sha256


def record_for_p1():
    return {**read_reviewed_photos()[0], 'sku': 'P1', 'catalog_name': 'P1', 'category': '測試'}


def test_mismatched_catalog_row_rejects_entire_import(interaction_session):
    session = interaction_session
    correct = record_for_p1()
    wrong = {**correct, 'sku': 'P2', 'catalog_name': '另一個藥品'}
    with pytest.raises(ValueError, match='停止匯入'):
        import_reviewed_photos(session.connection(), [correct, wrong])
    assert session.scalar(select(func.count()).select_from(ProductPhoto)) == 0


@pytest.mark.parametrize("kind", ["series", "illustrative"])
def test_database_photo_is_served_with_provenance_and_old_version_is_rejected(interaction_session, kind):
    session = interaction_session
    record = record_for_p1()
    record['kind'] = kind
    if kind == 'illustrative':
        record['note'] = 'Demo參考照：測試不同規格照片'
    import_reviewed_photos(session.connection(), [record])
    client = TestClient(app)
    rows = {row['sku']: row for row in client.get('/api/products').json()}
    assert rows['P2']['photo'] is None
    photo = rows['P1']['photo']
    assert photo['sourceUrl'] == record['page_url']
    assert photo['kind'] == record['kind'] and photo['note'] == record['note']
    response = client.get(photo['src'])
    assert response.status_code == 200 and response.content == record['content']
    assert response.headers['content-type'] == 'image/webp'
    assert 'immutable' in response.headers['cache-control']
    assert response.headers['etag'] == f'"{record["sha256"]}"'
    assert client.get('/api/products/P1/photo/' + '0' * 64 + '.webp').status_code == 404
    assert client.get(photo['src'].replace('/P1/', '/P2/')).status_code == 404
    # 若同料號日後改作另一商品，不沿用舊照片。
    session.get(Product, 'P1').name = '另一個商品'
    session.flush()
    assert {row['sku']: row for row in client.get('/api/products').json()}['P1']['photo'] is None
    assert client.get(photo['src']).status_code == 404


def test_catalog_manifest_must_agree_with_review(tmp_path):
    import json
    from app.services.product_photos import DEFAULT_INVENTORY, MANIFEST

    manifest = copy.deepcopy(json.loads(MANIFEST.read_text()))
    inventory = json.loads(DEFAULT_INVENTORY.read_text())
    sku = inventory[0]['reviewedProducts'][0]['sku']
    manifest['products'][sku]['kind'] = 'exact'
    changed = tmp_path / 'manifest.json'
    changed.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match='核對標記與型錄不符'):
        read_reviewed_photos(manifest_path=changed)


@pytest.mark.parametrize("change", [{"demo": False}, {"note": "未說明規格差異"}])
def test_illustrative_review_requires_explicit_demo_marker_and_difference(tmp_path, change):
    import json
    from app.services.product_photos import DEFAULT_INVENTORY, MANIFEST

    inventory = json.loads(DEFAULT_INVENTORY.read_text())
    source = next(row for row in inventory if row["reviewedProducts"][0]["kind"] == "illustrative")
    review = source["reviewedProducts"][0]
    review.update(change)
    manifest = json.loads(MANIFEST.read_text())
    manifest["products"][review["sku"]]["note"] = review["note"]
    changed_inventory = tmp_path / "inventory.json"
    changed_manifest = tmp_path / "manifest.json"
    changed_inventory.write_text(json.dumps([source]))
    changed_manifest.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="示意照片缺少Demo標記"):
        read_reviewed_photos(changed_inventory, manifest_path=changed_manifest)


def test_old_photo_kind_constraint_is_expanded_without_changing_existing_rows(interaction_session):
    from sqlalchemy import inspect, text
    from app.services.product_photos import ensure_photo_table
    session = interaction_session
    record = record_for_p1()
    import_reviewed_photos(session.connection(), [record])
    session.execute(text("ALTER TABLE product_photo DROP CONSTRAINT ck_product_photo_kind"))
    session.execute(text("ALTER TABLE product_photo ADD CONSTRAINT ck_product_photo_kind CHECK (kind IN ('exact', 'series'))"))
    ensure_photo_table(session.connection())
    checks = inspect(session.connection()).get_check_constraints("product_photo")
    assert "illustrative" in next(row["sqltext"] for row in checks if row["name"] == "ck_product_photo_kind")
    assert session.get(ProductPhoto, "P1").sha256 == record["sha256"]
