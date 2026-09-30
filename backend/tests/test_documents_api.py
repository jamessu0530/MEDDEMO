"""讀一份內部文件（backend/app/api/documents.py）：新人第一週頁的必讀文件點開的就是它。"""

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client(engine):
    return TestClient(app)


def test_a_document_reads_as_its_title_and_sections_in_order(client, docs, auth):
    response = client.get("/api/documents/01-近效期退貨.md", headers=auth("U01"))
    assert response.status_code == 200
    # 內文是文件的原文：索引裡每段前面多帶的「標題｜小節」那一行不重複出現
    assert response.json() == {
        "source_name": "01-近效期退貨.md",
        "title": "近效期品項退貨作業規範",
        "sections": [
            {"section": "近效期退貨的申請期限", "content": "近效期品項退貨須在效期剩餘六個月以前提出申請，逾期不受理。"},
            {"section": "近效期退貨的運費", "content": "近效期品項退貨的運費由公司負擔，業務需在 CRM 登記退貨單號。"},
        ],
    }


def test_anyone_signed_in_can_read_a_document(client, docs, auth):
    # 這些文件本來就是全公司問答查得到的內容，不分角色
    for user_id in ("U05", "M01", "A01"):
        body = client.get("/api/documents/02-報價權限.md", headers=auth(user_id)).json()
        assert (body["title"], len(body["sections"])) == ("報價權限與折扣審核", 1)


def test_an_unknown_document_is_not_found(client, docs, auth):
    response = client.get("/api/documents/99-不存在.md", headers=auth("U01"))
    assert (response.status_code, response.json()["detail"]) == (404, "找不到這份文件")


def test_reading_a_document_requires_signing_in(client, docs):
    assert client.get("/api/documents/01-近效期退貨.md").status_code == 401
