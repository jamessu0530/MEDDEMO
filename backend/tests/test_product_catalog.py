"""完整型錄的增量匯入、商品頁與 AI 的共同資料來源。"""

import datetime as dt

import generate
import pytest
from sqlalchemy import text
from sync_products import sync_product_catalog

from app.services.data_agent import answer_data
from app.services.scope import Scope
from app.services.sql_executor import describe_views, run_readonly


@pytest.fixture
def catalog_conn(engine):
    with engine.connect() as conn:
        transaction = conn.begin()
        try:
            yield conn
        finally:
            transaction.rollback()


def test_sync_adds_missing_products_and_keeps_existing_data(catalog_conn):
    conn = catalog_conn
    tables = ("app_user", "customer", "sales_transaction", "visit", "sap_quotation_draft")
    counts = {table: conn.scalar(text(f"SELECT count(*) FROM {table}")) for table in tables}
    conn.execute(text("DELETE FROM product WHERE sku = 'F762505'"))
    conn.execute(text("UPDATE product SET unit_price = 123.45 WHERE sku = 'HS-FO30'"))
    before = conn.scalar(text("SELECT count(*) FROM product"))

    result = sync_product_catalog(conn)

    assert result == {"before": before, "catalog": len(generate.read_real_products()), "inserted": 1, "total": before + 1}
    assert conn.scalar(text("SELECT product_name FROM v_product WHERE sku = 'F762505'")) == "中化360海藻鈣錠 60錠"
    assert float(conn.scalar(text("SELECT unit_price FROM product WHERE sku = 'HS-FO30'"))) == 123.45
    assert {table: conn.scalar(text(f"SELECT count(*) FROM {table}")) for table in tables} == counts
    assert sync_product_catalog(conn)["inserted"] == 0


def test_sync_upgrades_a_catalog_without_common_or_its_view(catalog_conn):
    conn = catalog_conn
    conn.exec_driver_sql("ALTER TABLE product DROP COLUMN common CASCADE")
    assert conn.scalar(text("SELECT to_regclass('v_product')")) is None
    sync_product_catalog(conn)
    assert conn.scalar(text("SELECT common FROM v_product WHERE sku = 'HS-FO30'")) is True
    assert conn.scalar(text("SELECT common FROM v_product WHERE sku = 'C490191'")) is True
    assert conn.scalar(text("SELECT common FROM v_product WHERE sku = 'F762505'")) is False
    conn.exec_driver_sql("SET LOCAL ROLE semantic_reader")
    assert conn.scalar(text("SELECT count(*) FROM v_product")) == 60 + len(generate.read_real_products())


def test_ai_catalog_includes_products_without_sales_for_every_region(engine):
    assert run_readonly(engine, "SELECT count(*) FROM v_monthly_sales WHERE sku = 'F762505'").rows == [[0]]
    for path in ("TW.N.M01.U01", "TW.C.M02.U03", "TW.S.M03.U04"):
        scope = Scope(path=path)
        assert run_readonly(engine, "SELECT count(*) FROM v_product", scope).rows == [[60 + len(generate.read_real_products())]]
        assert run_readonly(engine, "SELECT sku, product_name, unit FROM v_product WHERE sku = 'F762505'", scope).rows == [
            ["F762505", "中化360海藻鈣錠 60錠", "瓶"],
        ]
    schema = describe_views(engine)
    assert "v_product：完整商品型錄" in schema
    assert "常用品項" in schema and "日用品" in schema


def test_ai_answers_with_the_actual_catalog_query(engine):
    class CatalogLLM:
        calls = 0

        def json(self, *, system, prompt, **kwargs):
            assert "v_product" in system and "沒有銷售" in system
            self.calls += 1
            if self.calls == 1:
                return {"action": "query", "reason": "查完整型錄", "sql": "SELECT sku, product_name, unit FROM v_product WHERE sku = 'F762505'", "answer": None}
            assert "中化360海藻鈣錠 60錠" in prompt
            return {"action": "answer", "reason": "已查到商品", "sql": None, "answer": "有中化360海藻鈣錠 60錠，料號 F762505，單位為瓶。"}

    result = answer_data(engine, CatalogLLM(), "F762505 是什麼商品？", dt.date(2026, 10, 28), lambda *args, **kwargs: None, Scope(path="TW.N.M01.U01"))
    assert result.status == "answered"
    assert result.evidence["rows"] == [["F762505", "中化360海藻鈣錠 60錠", "瓶"]]
