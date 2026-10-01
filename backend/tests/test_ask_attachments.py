"""問答附檔案：拍產品盒問銷量、拍仿單或競品海報問規定（docs/superpowers/specs/2026-10-01-attachments-design.md）。

提問先請 AI 看懂檔案（說明 + 向量），數字題每一輪都附原檔，知識題用「問題 + 檔案」的向量檢索、說明接在問題後面，
產生答案時才給原檔。AI 模型與 embedding 用替身，資料庫、佇列與背景工作是真的。
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from test_asks import FISH_OIL_SQL, ScriptedLLM, answer, grade, query, rewrite, run_jobs
from test_attachments import pdf, photo

from app.main import app
from app.models import Attachment, Escalation
from app.services import asks as asks_service
from app.tasks import redis

CAPTION = "中化裕民魚油 30 入（HS-FO30）的外盒，左下角壓壞。"


class SeeingLLM(ScriptedLLM):
    """ScriptedLLM 加上：寫說明的呼叫、記下每次呼叫附了哪些檔案。"""

    KIND_BY_FIELD = {**ScriptedLLM.KIND_BY_FIELD, "caption": "caption"}

    def __init__(self, **queues):
        super().__init__(caption=[{"caption": CAPTION}], **queues)
        self.media = []

    def json(self, *, system, prompt, schema, media=(), **_):
        self.media.append(("json", [mime for _, mime in media]))
        return super().json(system=system, prompt=prompt, schema=schema)

    async def ajson(self, *, system, prompt, schema, media=(), **_):
        return self.json(system=system, prompt=prompt, schema=schema, media=media)

    async def atext(self, *, system, prompt, media=(), **_):
        self.media.append(("text", [mime for _, mime in media]))
        return await super().atext(system=system, prompt=prompt)


class RecordingEmbedder:
    def __init__(self):
        self.queries = []

    def embed_query(self, text_, media=()):
        self.queries.append((text_, [mime for _, mime in media]))
        return [0.1, 0.2, 0.3]

    def embed_media(self, items):
        return [[0.1, 0.2, 0.3] for _ in items]


@pytest.fixture
def client(engine, sign_in):
    yield sign_in(TestClient(app), "U01")
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM ask_record"))
    redis().flushdb()


def ask_with_file(client, kind, question, filename="box.jpg", content=None):
    return client.post(
        "/api/asks",
        data={"kind": kind, "question": question},
        files={"file": (filename, content if content is not None else photo(size=(400, 300)), "image/jpeg")},
    )


def test_a_question_can_carry_one_photo_that_only_the_asker_sees(client, engine, auth):
    created = ask_with_file(client, "data", "這個上個月賣多少")
    assert created.status_code == 202
    item = created.json()["attachment"]
    assert (item["kind"], item["filename"], item["width"]) == ("image", "box.jpg", 400)
    assert client.get(item["url"]).status_code == 200
    # 同組的同事拿自己的簽名也打不開
    other = TestClient(app).get(f"/api/attachments/{item['id']}", params={"sig": "x"})
    assert other.status_code == 404
    detail = client.get(f"/api/asks/{created.json()['id']}").json()
    assert detail["attachment"]["id"] == item["id"]


def test_bad_or_extra_files_create_no_question(client, engine):
    with engine.connect() as conn:
        before = conn.scalar(text("SELECT count(*) FROM ask_record"))
    assert ask_with_file(client, "data", "這是什麼", content=b"garbage").status_code == 415
    two = client.post(
        "/api/asks",
        data={"kind": "data", "question": "兩個"},
        files=[("file", ("a.jpg", photo(size=(10, 10)), "image/jpeg")), ("file", ("b.jpg", photo(size=(10, 10)), "image/jpeg"))],
    )
    assert two.status_code == 422
    assert client.post("/api/asks", data={"kind": "nope", "question": "x"}).status_code == 422
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM ask_record")) == before


def test_a_data_question_reads_the_photo_in_every_round(client, monkeypatch):
    llm = SeeingLLM(step=[query(FISH_OIL_SQL, "從外盒讀出是魚油 30 入"), answer("魚油 30 入上個月約 12 萬元")])
    embedder = RecordingEmbedder()
    monkeypatch.setattr(asks_service, "get_llm", lambda: llm)
    monkeypatch.setattr(asks_service, "optional_embedder", lambda: embedder)
    ask_id = ask_with_file(client, "data", "這個上個月賣多少").json()["id"]
    run_jobs()
    ask = client.get(f"/api/asks/{ask_id}").json()
    assert ask["status"] == "answered"
    # 先寫說明（看原檔），之後兩輪查詢都附原檔
    assert llm.media == [("json", ["image/jpeg"])] * 3
    assert all(CAPTION in prompt for prompt in llm.prompts[1:])
    assert [t["step"] for t in ask["trace"]] == ["attachment", "sql", "answer"]
    assert ask["trace"][0]["decision"] == CAPTION


def test_a_knowledge_question_searches_with_the_photo_and_answers_looking_at_it(client, docs, monkeypatch):
    llm = SeeingLLM(grade=[grade("correct")], rewrite=[rewrite("折扣審核 上限")], answer=["百分之五以內可以直接給 [1]。"])
    embedder = RecordingEmbedder()
    monkeypatch.setattr(asks_service, "get_llm", lambda: llm)
    monkeypatch.setattr(asks_service, "optional_embedder", lambda: embedder)
    ask_id = ask_with_file(client, "knowledge", "店長拿這張問可不可以再多給折扣").json()["id"]
    run_jobs()
    ask = client.get(f"/api/asks/{ask_id}").json()
    assert ask["status"] == "answered"
    # 向量檢索：問題（接上說明）和照片合成一個向量
    question, media = embedder.queries[0]
    assert question.startswith("店長拿這張問可不可以再多給折扣") and CAPTION in question
    assert media == ["image/jpeg"]
    # 評分、改寫只讀文字；產生答案時才附原檔
    assert ("text", ["image/jpeg"]) in llm.media
    assert all(kind == "text" or mimes == [] for kind, mimes in llm.media[1:])
    assert ask["trace"][0]["step"] == "attachment"


def test_when_the_photo_cannot_be_described_the_question_is_still_answered(client, monkeypatch):
    class BlindLLM(SeeingLLM):
        def json(self, *, system, prompt, schema, media=(), **_):
            if "caption" in schema["required"]:
                raise RuntimeError("模型忙線")
            return super().json(system=system, prompt=prompt, schema=schema, media=media)

    llm = BlindLLM(step=[answer("看不出品名，請告訴我是哪個品項")])
    monkeypatch.setattr(asks_service, "get_llm", lambda: llm)
    monkeypatch.setattr(asks_service, "optional_embedder", lambda: None)
    ask_id = ask_with_file(client, "data", "這個賣多少").json()["id"]
    run_jobs()
    ask = client.get(f"/api/asks/{ask_id}").json()
    assert ask["status"] == "answered"
    assert "沒能先看懂" in ask["trace"][0]["decision"]
    # 還是把原檔交給回答的那一輪
    assert ("json", ["image/jpeg"]) in llm.media


def test_a_pdf_works_the_same_way(client, monkeypatch):
    llm = SeeingLLM(step=[answer("這份 DM 的品項上個月沒有進貨")])
    monkeypatch.setattr(asks_service, "get_llm", lambda: llm)
    monkeypatch.setattr(asks_service, "optional_embedder", lambda: RecordingEmbedder())
    created = client.post(
        "/api/asks", data={"kind": "data", "question": "DM 上的品項賣得怎樣"}, files={"file": ("dm.pdf", pdf(), "application/pdf")}
    )
    run_jobs()
    assert client.get(f"/api/asks/{created.json()['id']}").json()["status"] == "answered"
    assert llm.media[-1] == ("json", ["application/pdf"])


def test_the_manager_answering_an_escalation_sees_the_photo(client, engine, auth, monkeypatch):
    llm = SeeingLLM(grade=[grade("incorrect")], rewrite=[rewrite("年終獎金")], answer=["不該用到"])
    monkeypatch.setattr(asks_service, "get_llm", lambda: llm)
    monkeypatch.setattr(asks_service, "optional_embedder", lambda: None)
    ask_id = ask_with_file(client, "knowledge", "這張海報上的條件我們跟得上嗎").json()["id"]
    run_jobs()
    assert client.post(f"/api/asks/{ask_id}/escalate").status_code == 200
    items = TestClient(app).get("/api/escalations", headers=auth("M01")).json()
    item = next(e for e in items if e["ask_id"] == ask_id)
    assert item["attachment"]["kind"] == "image"
    assert TestClient(app).get(item["attachment"]["url"]).status_code == 200
    with engine.connect() as conn:
        assert conn.scalar(select(Escalation.id).where(Escalation.ask_id == ask_id)) is not None
        assert conn.scalar(select(Attachment.status).where(Attachment.ask_id == ask_id)) == "ready"
