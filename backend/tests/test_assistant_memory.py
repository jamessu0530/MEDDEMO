"""長期記憶跨登入保存、帳號隔離、舊查詢恢復與節點逐筆合併。"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import AppUser, AskRecord, AssistantMemoryEntry, AssistantMemoryNode
from app.services.auth import create_token


@pytest.fixture
def client():
    return TestClient(app)


def save(client, headers, **body):
    response = client.patch("/api/assistant-memory", headers=headers, json=body)
    assert response.status_code == 204, response.text


def read(client, headers):
    response = client.get("/api/assistant-memory", headers=headers)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    return response.json()


def test_memory_requires_login(client):
    assert client.get("/api/assistant-memory").status_code == 401
    assert client.patch("/api/assistant-memory", json={}).status_code == 401


def test_logout_and_another_client_keep_the_same_accounts_memory(tx, client, auth):
    headers = auth("U02")
    save(client, headers, entries=[dict(id=91, kind="user", text="我的長期問題")],
         nodes=[dict(id="question:92", label="退貨流程", note="下週確認", deleted=True)])
    assert client.post("/api/auth/logout", headers=headers).status_code == 204
    # 登出版號在本測試的 savepoint；從同一交易讀最新身分來模擬下一次登入。
    tx.expire_all()
    signed_in_again = {"Authorization": f"Bearer {create_token(tx.get(AppUser, 'U02'))}"}
    with TestClient(app) as another:
        restored = read(another, signed_in_again)
    assert restored["entries"][0]["text"] == "我的長期問題"
    assert restored["nodes"] == [dict(id="question:92", label="退貨流程", note="下週確認", deleted=True)]
    assert read(client, auth("U03")) == {"entries": [], "nodes": []}


def test_old_queries_are_recovered_and_linking_does_not_duplicate_them(tx, client, auth):
    tx.add(AskRecord(id="legacy-memory", user_id="U02", kind="knowledge", question="之前問過的規定",
                     status="answered", answer="之前的回答", evidence=None))
    tx.flush()
    first = read(client, auth("U02"))["entries"]
    assert len(first) == 1 and first[0]["ask"]["answer"] == "之前的回答"
    assert first[0]["createdAt"].endswith("+00:00")
    assert read(client, auth("U02"))["entries"][0]["id"] == first[0]["id"]
    save(client, auth("U02"), entries=[dict(id=101, kind="tool", question="之前問過的規定", ask_id="legacy-memory", askKind="knowledge")])
    restored = read(client, auth("U02"))["entries"]
    assert len(restored) == 1 and restored[0]["id"] == 101
    assert restored[0]["ask"]["answer"] == "之前的回答"


def test_other_accounts_asks_cannot_be_attached_or_read(tx, client, auth):
    tx.add(AskRecord(id="private-memory", user_id="U02", kind="knowledge", question="私人的問題",
                     status="answered", answer="私人的答案"))
    tx.flush()
    response = client.patch("/api/assistant-memory", headers=auth("U03"), json={
        "entries": [dict(id=77, kind="tool", question="嘗試讀取", ask_id="private-memory")],
        "nodes": [dict(id="conversation", note="不應寫入")],
    })
    assert response.status_code == 404
    assert read(client, auth("U03")) == {"entries": [], "nodes": []}


def test_different_devices_merge_entries_and_restore_hidden_nodes(tx, client, auth):
    headers = auth("U02")
    save(client, headers, entries=[dict(id=1, kind="user", text="第一支手機")], nodes=[dict(id="a", label="名稱", note="筆記", deleted=True)])
    save(client, headers, entries=[dict(id=2, kind="model", text="第二支手機")], nodes=[dict(id="b", label="另一節點", deleted=True)])
    save(client, headers, nodes=[dict(id="a", label="名稱", note="筆記", deleted=False)])
    restored = read(client, headers)
    assert [entry["text"] for entry in restored["entries"]] == ["第一支手機", "第二支手機"]
    nodes = {node["id"]: node for node in restored["nodes"]}
    assert nodes["a"]["note"] == "筆記" and nodes["a"]["deleted"] is False
    assert nodes["b"]["deleted"] is True
    save(client, headers, nodes=[dict(id="a", deleted=True)])
    assert next(node for node in read(client, headers)["nodes"] if node["id"] == "a")["note"] == "筆記"
    # 包含原文的來源節點識別碼可能很長，索引採雜湊，不受 PostgreSQL B-tree 索引長度限制。
    long_id = "來源" * 4000
    save(client, headers, nodes=[dict(id=long_id, label="長來源", note="仍能保存")])
    assert any(node["id"] == long_id for node in read(client, headers)["nodes"])


def test_history_is_not_deleted_when_it_exceeds_one_map_page(tx, client, auth):
    save(client, auth("U02"), entries=[dict(id=index, kind="user", text=f"第 {index} 題") for index in range(30)])
    assert len(read(client, auth("U02"))["entries"]) == 30


def test_threads_keep_page_and_timestamp_when_restored(tx, client, auth):
    page = dict(path="/customers/C01?view=notes", title="客戶檔案", facts=["客戶：康泰"])
    save(client, auth("U02"), entries=[dict(id=810, kind="user", text="上次的問題",
         threadId="thread-one", createdAt="2026-10-17T10:00:00Z", page=page)])
    entry = read(client, auth("U02"))["entries"][0]
    assert entry["threadId"] == "thread-one"
    assert entry["createdAt"].startswith("2026-10-17T10:00:00")
    assert entry["page"] == page


def test_ghost_is_excluded_from_legacy_recovery_and_memory_writes(tx, client, auth):
    tx.add(AskRecord(id="ghost-query", user_id="U02", kind="knowledge", question="暫時的提問",
                     ghost=True, status="answered", answer="暫時的回答"))
    tx.flush()
    save(client, auth("U02"), entries=[dict(id=820, kind="user", text="暫時的逐字稿", ghost=True)])
    assert read(client, auth("U02")) == {"entries": [], "nodes": []}
    response = client.patch("/api/assistant-memory", headers=auth("U02"), json={
        "entries": [dict(id=821, kind="tool", question="嘗試保存", ask_id="ghost-query")],
    })
    assert response.status_code == 404
    assert read(client, auth("U02")) == {"entries": [], "nodes": []}


@pytest.mark.parametrize("multipart", [False, True])
def test_ghost_query_creation_marks_json_and_multipart_requests(tx, client, auth, monkeypatch, multipart):
    from unittest.mock import Mock
    monkeypatch.setattr("app.api.asks.visit_queue", lambda: Mock())
    payload = dict(kind="knowledge", question="暫時詢問", ghost=True)
    if multipart:
        response = client.post("/api/asks", headers=auth("U02"), data={**payload, "ghost": "true"},
                               files={"ignored": (None, "multipart")})
    else:
        response = client.post("/api/asks", headers=auth("U02"), json=payload)
    assert response.status_code == 202, response.text
    tx.expire_all()
    assert tx.get(AskRecord, response.json()["id"]).ghost is True
    assert read(client, auth("U02")) == {"entries": [], "nodes": []}


def test_deleting_account_removes_only_its_memory(tx, client):
    registered = client.post("/api/auth/register", json={"name": "記憶測試", "email": "memory@delete.test", "password": "password123"})
    assert registered.status_code == 201
    account = registered.json()
    headers = {"Authorization": f"Bearer {account['token']}"}
    save(client, headers, entries=[dict(id=1, kind="user", text="自己的問題")], nodes=[dict(id="conversation", note="自己的筆記")])
    assert client.delete("/api/auth/me", headers=headers).status_code == 204
    tx.expire_all()
    assert tx.scalar(select(AssistantMemoryEntry).where(AssistantMemoryEntry.user_id == account["user"]["id"])) is None
    assert tx.scalar(select(AssistantMemoryNode).where(AssistantMemoryNode.user_id == account["user"]["id"])) is None
