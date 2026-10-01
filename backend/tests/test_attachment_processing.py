"""附件的背景處理（services/attachment_processing.py）：AI 寫說明、算 embedding-2 向量、重算關鍵字。"""

import io

import pytest
from pypdf import PdfReader, PdfWriter
from rq import Queue
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session
from test_attachments import channel_id, client, photo, upload  # noqa: F401  (client 是 fixture)

from app.models import AppUser, Attachment, AttachmentVector, Channel, ChannelMessage
from app.services import attachment_processing, attachments
from app.tasks import channels_queue


def pdf(pages: int) -> bytes:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


class FakeLLM:
    def __init__(self, caption="御松田深海魚油的促銷海報：買十送一，限時檔期 10/1–10/31。"):
        self.caption = caption
        self.calls = []

    def json(self, *, system, prompt, schema, effort="medium", media=()):
        self.calls.append({"system": system, "prompt": prompt, "media": list(media)})
        return {"caption": self.caption}


class FakeEmbedder:
    def __init__(self):
        self.calls = []

    def embed_media(self, items):
        self.calls.append(list(items))
        return [[float(i), 1.0, 0.0] for i in range(len(items))]


def attach(session: Session, kind="image", body="大安這邊好幾家店都在講御松田", pages=2) -> Attachment:
    channel = session.scalar(select(Channel).where(Channel.kind == "place").limit(1))
    message = ChannelMessage(channel_id=channel.id, author_id="U01", kind="user", body=body)
    session.add(message)
    session.flush()
    raw = photo(size=(300, 200)) if kind == "image" else pdf(pages)
    prepared = attachments.prepare(raw, "poster.jpg" if kind == "image" else "dm.pdf")
    attachment = attachments.add(session, session.get(AppUser, "U01"), prepared, context=body, message_id=message.id)
    session.flush()
    return attachment


def vectors(session: Session, attachment: Attachment) -> list[tuple]:
    return session.execute(
        select(AttachmentVector.page_from, AttachmentVector.page_to)
        .where(AttachmentVector.attachment_id == attachment.id)
        .order_by(AttachmentVector.id)
    ).all()


def test_long_pdfs_are_cut_into_six_page_pieces():
    pieces = attachment_processing.pdf_segments(pdf(14))
    assert [(start, end) for _, start, end in pieces] == [(1, 6), (7, 12), (13, 14)]
    assert [len(PdfReader(io.BytesIO(data)).pages) for data, _, _ in pieces] == [6, 6, 2]
    short = pdf(3)
    assert attachment_processing.pdf_segments(short) == [(short, 1, 3)]


def test_a_photo_gets_a_caption_a_vector_and_searchable_words(tx):
    attachment = attach(tx)
    llm, embedder = FakeLLM(), FakeEmbedder()
    attachment_processing.describe_and_embed(tx, attachment, llm=llm, embedder=embedder)
    assert attachment.status == "ready"
    assert attachment.caption.startswith("御松田深海魚油")
    # 模型真的看到了照片，也知道同事發這張時說了什麼
    [call] = llm.calls
    assert call["media"] == [(attachment.content, "image/jpeg")]
    assert "大安這邊好幾家店都在講御松田" in call["prompt"]
    assert "不描述長相" in call["system"]
    assert vectors(tx, attachment) == [(None, None)]
    # 說明裡的字搜得到（訊息原文沒有「買十送一」）
    hit = tx.scalar(
        select(Attachment.id).where(Attachment.id == attachment.id, Attachment.search_tokens.op("@@")(func.to_tsquery("simple", "買十 & 送一")))
    )
    assert hit == attachment.id


def test_a_long_pdf_gets_one_vector_per_six_pages(tx):
    attachment = attach(tx, kind="pdf", pages=8)
    embedder = FakeEmbedder()
    attachment_processing.describe_and_embed(tx, attachment, llm=FakeLLM("衛教單張"), embedder=embedder)
    assert vectors(tx, attachment) == [(1, 6), (7, 8)]
    assert [mime for mime_items in embedder.calls for _, mime in mime_items] == ["application/pdf", "application/pdf"]


def test_running_twice_replaces_the_vectors(tx):
    attachment = attach(tx)
    for _ in range(2):
        attachment_processing.describe_and_embed(tx, attachment, llm=FakeLLM(), embedder=FakeEmbedder())
    assert len(vectors(tx, attachment)) == 1


def test_without_ai_configured_the_file_is_still_ready(tx):
    attachment = attach(tx)
    attachment_processing.describe_and_embed(tx, attachment, llm=None, embedder=None)
    assert (attachment.status, attachment.caption, vectors(tx, attachment)) == ("ready", None, [])


def test_seeded_files_keep_their_handwritten_caption(tx):
    attachment = attach(tx)
    attachment.caption = "手寫的說明"
    attachment_processing.describe_and_embed(tx, attachment, llm=FakeLLM(), embedder=FakeEmbedder(), caption=False)
    assert attachment.caption == "手寫的說明"
    assert len(vectors(tx, attachment)) == 1


class Job:
    def __init__(self, retries_left):
        self.retries_left = retries_left


@pytest.fixture
def same_transaction(tx, monkeypatch):
    """背景工作自己開 session：讓它開在測試的交易裡，測完一起回滾。"""
    monkeypatch.setattr(
        attachment_processing, "session_factory",
        lambda: lambda: Session(bind=tx.connection(), join_transaction_mode="create_savepoint"),
    )
    return tx


def test_the_job_retries_and_marks_failed_on_the_last_attempt(same_transaction, monkeypatch):
    tx = same_transaction
    attachment = attach(tx)

    def broken(*args, **kwargs):
        raise RuntimeError("Gemini 忙線")

    monkeypatch.setattr(attachment_processing, "describe_and_embed", broken)
    monkeypatch.setattr(attachment_processing, "get_current_job", lambda: Job(retries_left=1))
    with pytest.raises(RuntimeError):
        attachment_processing.process_attachment(attachment.id)
    assert tx.scalar(text("SELECT status FROM attachment WHERE id = :id"), {"id": attachment.id}) == "pending"
    monkeypatch.setattr(attachment_processing, "get_current_job", lambda: Job(retries_left=0))
    attachment_processing.process_attachment(attachment.id)
    assert tx.scalar(text("SELECT status FROM attachment WHERE id = :id"), {"id": attachment.id}) == "failed"


def test_the_job_does_the_work_with_whatever_is_configured(same_transaction, monkeypatch):
    tx = same_transaction
    attachment = attach(tx)
    monkeypatch.setattr(attachment_processing, "optional_llm", lambda: FakeLLM())
    monkeypatch.setattr(attachment_processing, "optional_embedder", lambda: FakeEmbedder())
    attachment_processing.process_attachment(attachment.id)
    tx.expire_all()
    stored = tx.get(Attachment, attachment.id)
    assert (stored.status, stored.caption[:3]) == ("ready", "御松田")
    # 訊息先被刪掉的話不做事
    attachment_processing.process_attachment(999_999_999)


def test_posting_files_queues_one_job_each_on_the_channels_queue(tx, client, auth):  # noqa: F811
    queue = channels_queue()
    queue.empty()
    team = channel_id(client, auth, "陳建宏小組")
    posted = upload(client, auth("U01"), team, "兩張", [("a.jpg", photo(size=(20, 20))), ("b.jpg", photo(size=(20, 20)))]).json()
    jobs = queue.get_jobs()
    assert [job.func_name for job in jobs] == ["app.services.attachment_processing.process_attachment"] * 2
    assert [job.args for job in jobs] == [(a["id"],) for a in posted["attachments"]]
    assert jobs[0].retries_left == 2
    queue.empty()
    assert isinstance(queue, Queue) and queue.name == "channels"
