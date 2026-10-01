"""問答的「頻道記憶」與頻道的搜尋頁（services/memory_search.py、memory_answer.py、api/channel_search.py）。

搜得到的範圍跟看板一樣：自己看得到的頻道，加上全公司往上傳的（只給往上傳的寫法）。示範資料：北區的海報、貨架照
帶圖往上傳，南區（蔡宗翰小組）的康普樂報價單只傳文字。
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from test_asks import run_jobs
from test_attachments import photo

from app.main import app
from app.models import AppUser, Attachment, AttachmentVector, MemoryItem
from app.services import asks as asks_service
from app.services import memory_search
from app.tasks import redis


@pytest.fixture
def client():
    return TestClient(app)


def files(session, name):
    return session.scalar(select(Attachment).where(Attachment.filename == name))


def search(client, headers, q=None, image=None, channel_id=None):
    data = {k: v for k, v in {"q": q, "channel_id": channel_id}.items() if v is not None}
    upload = {"image": ("query.jpg", image, "image/jpeg")} if image is not None else None
    return client.post("/api/channels/search", data=data, files=upload, headers=headers)


# ---- 搜尋頁 ----


def test_text_finds_photos_by_their_caption_within_what_you_can_see(tx, client, auth):
    # 北區的業務：自己區的海報找得到、點得回原訊息
    hits = search(client, auth("U01"), q="買十送一 海報").json()
    poster = next(h for h in hits if h["attachment"]["filename"] == "yushotian-poster.jpg")
    assert (poster["reachable"], poster["shared_text"], poster["channel_name"]) == (True, None, "台北市・大安區")
    assert poster["attachment"]["thumb_url"]
    # 南區的報價單沒往上傳，北區找不到
    assert all(h["attachment"]["filename"] != "kangpule-quote.jpg" for h in search(client, auth("U01"), q="康普樂 報價單").json())


def test_photos_shared_upward_are_found_by_other_regions_but_only_open_as_photos(tx, client, auth):
    hits = search(client, auth("U05"), q="御松田 買十送一").json()
    poster = next(h for h in hits if h["attachment"]["filename"] == "yushotian-poster.jpg")
    assert poster["reachable"] is False
    assert poster["shared_text"].startswith("御松田在台北大安區推魚油買十送一")
    assert client.get(poster["attachment"]["url"]).status_code == 200
    # 南區自己的報價單當然找得到
    assert any(h["attachment"]["filename"] == "kangpule-quote.jpg" for h in search(client, auth("U05"), q="康普樂 報價單").json())


def test_message_text_is_searchable_too(tx, client, auth):
    hits = search(client, auth("U01"), q="店長又在問補貨").json()
    assert hits[0]["attachment"]["filename"] == "zhongxiao-shelf.jpg"


def test_channel_filter_and_bad_requests(tx, client, auth):
    channels = client.get("/api/channels", headers=auth("U01")).json()
    daan = next(c["id"] for c in channels if c["name"] == "台北市・大安區")
    team = next(c["id"] for c in channels if c["name"] == "陳建宏小組")
    assert [h["attachment"]["filename"] for h in search(client, auth("U01"), q="海報 貨架", channel_id=team).json()] == ["zhongxiao-shelf.jpg"]
    assert all(h["channel_id"] == daan for h in search(client, auth("U01"), q="海報 貨架", channel_id=daan).json())
    south = next(c["id"] for c in client.get("/api/channels", headers=auth("U05")).json() if c["name"] == "蔡宗翰小組")
    assert search(client, auth("U01"), q="報價", channel_id=south).status_code == 404
    assert search(client, auth("U01")).status_code == 422
    # 沒有 embedding 時只附照片找不了
    assert search(client, auth("U01"), image=photo(size=(40, 40))).status_code == 503
    assert search(client, auth("U01"), image=b"garbage").status_code == 415


class NearEmbedder:
    """提問的向量故意做成跟某張圖一樣，看排序是不是照向量。"""

    def __init__(self, vector):
        self.vector, self.queries = vector, []

    def embed_query(self, text_, media=()):
        self.queries.append((text_, [mime for _, mime in media]))
        return self.vector


def test_a_photo_finds_the_most_similar_photos(tx, client, auth, monkeypatch):
    poster, shelf = files(tx, "yushotian-poster.jpg"), files(tx, "zhongxiao-shelf.jpg")
    tx.add_all([
        AttachmentVector(attachment_id=poster.id, embedding=[1.0, 0.0, 0.0]),
        AttachmentVector(attachment_id=shelf.id, embedding=[0.0, 1.0, 0.0]),
    ])
    tx.flush()
    embedder = NearEmbedder([0.1, 0.9, 0.0])
    monkeypatch.setattr("app.api.channel_search.optional_embedder", lambda: embedder)
    hits = search(client, auth("U01"), image=photo(size=(40, 40))).json()
    assert [h["attachment"]["filename"] for h in hits[:2]] == ["zhongxiao-shelf.jpg", "yushotian-poster.jpg"]
    assert embedder.queries == [("", ["image/jpeg"])]


def test_fusion_weights_vectors_over_keywords():
    assert memory_search.fuse({1: 0.9, 2: 0.1}, {2: 5.0, 3: 1.0}) == [1, 2, 3]
    assert memory_search.fuse({}, {2: 1.0, 3: 5.0}) == [3, 2]
    assert memory_search.fuse({4: 0.5}, {}) == [4]


# ---- 問答：頻道記憶 ----


class MemoryLLM:
    def __init__(self, answerable=True, answer="御松田在北區推魚油買十送一 [1]。"):
        self.answerable, self.answer, self.prompts = answerable, answer, []

    def json(self, *, system, prompt, schema, media=(), **_):
        self.prompts.append(prompt)
        return {"answerable": self.answerable, "answer": self.answer}


@pytest.fixture
def asking(engine, sign_in, monkeypatch):
    llm = MemoryLLM()
    monkeypatch.setattr(asks_service, "get_llm", lambda: llm)
    monkeypatch.setattr(asks_service, "optional_embedder", lambda: None)
    yield sign_in(TestClient(app), "U05"), llm
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM ask_record"))
    redis().flushdb()


def ask_memory(client, question):
    ask_id = client.post("/api/asks", json={"kind": "memory", "question": question}).json()["id"]
    run_jobs()
    return client.get(f"/api/asks/{ask_id}").json()


def test_memory_answers_use_only_what_the_asker_can_see(asking):
    client, llm = asking
    ask = ask_memory(client, "最近競品有什麼動作？")
    assert ask["status"] == "answered"
    prompt = llm.prompts[0]
    # 南區的人：自己小組的重點用原文，北區往上傳的用往上傳的寫法，北區沒往上傳的看不到
    assert "台南兩家診所反映康普樂的血糖試紙報得比較低（50 片每盒 $520" in prompt
    assert "御松田在台北大安區推魚油買十送一" in prompt
    assert "王冠宇這週跟會計核對三重店開錯的發票" not in prompt
    assert "大安區好幾家店反映御松田的業務在跑" not in prompt
    items = ask["evidence"]["items"]
    assert items and all({"index", "channel_name", "date", "text"} <= set(i) for i in items)
    assert [t["step"] for t in ask["trace"]] == ["search", "answer"]
    assert "從" in ask["trace"][0]["decision"] and "條記憶" in ask["trace"][0]["decision"]


def test_memory_evidence_photos_are_signed_per_reader_and_vanish_once_withdrawn(asking, engine):
    client, _ = asking
    ask = ask_memory(client, "御松田 買十送一 海報")
    [poster] = [a for a in ask["evidence"]["attachments"] if a["filename"] == "yushotian-poster.jpg"]
    assert poster["channel_id"] is None  # 南區看不到大安區頻道，點不回原訊息
    # 也只給往上傳的寫法，不給參考過原訊息寫出來的說明
    assert poster["caption"].startswith("御松田在台北大安區推魚油買十送一")
    assert client.get(poster["url"]).status_code == 200
    with engine.begin() as conn:
        conn.execute(text("UPDATE memory_item SET withdrawn_at = now() WHERE :id = ANY(shared_attachment_ids)"), {"id": poster["attachment_id"]})
    try:
        again = client.get(f"/api/asks/{ask['id']}").json()
        assert all(a["attachment_id"] != poster["attachment_id"] for a in again["evidence"]["attachments"])
    finally:
        with engine.begin() as conn:
            conn.execute(text("UPDATE memory_item SET withdrawn_at = NULL WHERE :id = ANY(shared_attachment_ids)"), {"id": poster["attachment_id"]})


def test_memory_questions_are_not_escalated(asking):
    client, llm = asking
    llm.answerable, llm.answer = False, "找不到年終獎金的重點。"
    ask = ask_memory(client, "年終獎金怎麼算？")
    assert (ask["status"], ask["answer"]) == ("no_evidence", "找不到年終獎金的重點。")
    assert client.post(f"/api/asks/{ask['id']}/escalate").status_code == 409


def test_with_vectors_the_closest_items_come_first(tx):
    user = tx.get(AppUser, "U01")
    scope = memory_search.scope_for(tx, user)
    items = list(tx.scalars(select(MemoryItem).where(MemoryItem.channel_id.in_(list(scope.channels))).order_by(MemoryItem.id)))
    for index, item in enumerate(items):
        item.embedding = [1.0, float(index), 0.0]
    target = items[-1]
    target.embedding = [0.0, 0.0, 1.0]
    tx.flush()
    hits, total = memory_search.search_memory(tx, scope, [0.0, 0.0, 1.0], limit=3)
    assert hits[0].item.id == target.id
    assert total >= len(items)
