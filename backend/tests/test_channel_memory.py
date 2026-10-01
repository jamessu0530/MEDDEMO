"""頻道記憶（services/channel_memory.py、services/memory_board.py、api/memory.py）。

熊熊滾把對話整理成一條一條重點，可以帶圖往上傳；上層看板只看得到往上傳的寫法與附件，撤回就從所有上層消失。
AI 模型用照劇本回應的替身；資料庫、Redis、權限都是真的。會寫資料的測試跑在 tx 的交易裡，測完回滾。
"""

import datetime as dt

import pytest
from fastapi.testclient import TestClient
from rq.registry import ScheduledJobRegistry
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_attachments import photo, upload

from app.main import app
from app.models import AppUser, Attachment, Channel, ChannelMessage, MemoryItem
from app.services import attachments, channel_memory, channels, memory_board
from app.tasks import channels_queue, redis


@pytest.fixture
def client():
    return TestClient(app)


class DigestLLM:
    def __init__(self, result=None, error=None):
        self.result = result or {"add": [], "update": []}
        self.error = error
        self.calls = []

    def json(self, *, system, prompt, schema, effort="medium", media=()):
        self.calls.append({"system": system, "prompt": prompt, "media": [mime for _, mime in media]})
        if self.error:
            raise self.error
        return self.result


class Embedder:
    def embed_documents(self, documents):
        return [[0.1, 0.2] for _ in documents]


def channel_by_name(session: Session, name: str) -> channels.ChannelInfo:
    infos = channels.describe(session, list(session.scalars(select(Channel))))
    return next(i for i in infos if i.name == name)


def say(session: Session, info, user_id: str, body: str, files=()) -> ChannelMessage:
    user = session.get(AppUser, user_id)
    message = channels.post(session, user, info, body)
    for name, raw in files:
        attachments.add(session, user, attachments.prepare(raw, name), context=body, message_id=message.id)
    session.flush()
    return message


def files_of(session: Session, message: ChannelMessage) -> list[int]:
    return list(session.scalars(select(Attachment.id).where(Attachment.message_id == message.id).order_by(Attachment.id)))


def item(text="御松田在中山區推魚油買十送一", sources=(), files=(), share=False, shared_text=None, share_files=(), category="competitor", due=None):
    return {
        "category": category, "text": text, "due_date": due, "source_message_ids": list(sources), "share": share,
        "shared_text": shared_text, "attachment_ids": list(files), "share_attachment_ids": list(share_files),
    }


# ---- 排程 ----


def test_messages_within_two_minutes_share_one_digest(tx, client, auth):
    redis().flushdb()
    queue = channels_queue()
    team = next(c["id"] for c in client.get("/api/channels", headers=auth("U01")).json() if c["name"] == "陳建宏小組")
    for body in ("第一則", "第二則", "第三則"):
        assert client.post(f"/api/channels/{team}/messages", json={"body": body}, headers=auth("U01")).status_code == 201
    scheduled = ScheduledJobRegistry(queue=queue)
    jobs = [queue.fetch_job(job_id) for job_id in scheduled.get_job_ids()]
    digests = [job for job in jobs if job.func_name == "app.services.channel_memory.run"]
    assert [job.args for job in digests] == [(team,)]
    assert redis().ttl(channel_memory.marker_key(team)) > 0
    redis().flushdb()


# ---- 整理記憶 ----


def test_new_messages_and_their_photos_become_memory(tx):
    info = channel_by_name(tx, "台北市・中山區")
    first = say(tx, info, "U01", "中山區的店說御松田開買十送一", [("poster.jpg", photo(size=(200, 300)))])
    second = say(tx, info, "U02", "我這邊也看到了")
    [poster] = files_of(tx, first)
    llm = DigestLLM({"add": [item(sources=[first.id, second.id], files=[poster], share=True,
                                  shared_text="御松田在台北推魚油買十送一", share_files=[poster])], "update": []})
    assert channel_memory.digest(tx, info.id, llm, Embedder()) == 1
    [memory] = tx.scalars(select(MemoryItem).where(MemoryItem.channel_id == info.id)).all()
    assert (memory.text, memory.source_message_ids, memory.attachment_ids) == ("御松田在中山區推魚油買十送一", [first.id, second.id], [poster])
    assert (memory.shared, memory.shared_text, memory.shared_attachment_ids) == (True, "御松田在台北推魚油買十送一", [poster])
    assert memory.embedding is not None
    assert tx.get(Channel, info.id).memory_through_id == second.id
    # 熊熊滾看到了照片，也知道附件編號與說明
    [call] = llm.calls
    assert call["media"] == ["image/jpeg"]
    assert f"[#{first.id}]" in call["prompt"] and f"〔附件 #{poster}（原檔已附上）" in call["prompt"]
    assert "台北市・中山區" in call["system"] and "北區" in call["system"]
    # 再整理一次沒有新訊息就不呼叫模型
    assert channel_memory.digest(tx, info.id, llm, None) == 0
    assert len(llm.calls) == 1


@pytest.mark.parametrize(
    "bad",
    [
        pytest.param(lambda m, f: item(sources=[999_999]), id="來源不在這一批"),
        pytest.param(lambda m, f: item(sources=[m], files=[999_999]), id="附件不在這一批"),
        pytest.param(lambda m, f: item(sources=[m], files=[], share=True, share_files=[f]), id="往上傳的附件不在附件裡"),
        pytest.param(lambda m, f: item(sources=[m], files=[f], share=False, share_files=[f]), id="沒往上傳卻要帶圖"),
        pytest.param(lambda m, f: item(text="  ", sources=[m]), id="內容空白"),
    ],
)
def test_entries_that_break_the_rules_are_dropped_and_the_rest_written(tx, bad):
    info = channel_by_name(tx, "台北市・中山區")
    message = say(tx, info, "U01", "中山區的回報", [("a.jpg", photo(size=(50, 50)))])
    [file_id] = files_of(tx, message)
    good = item(text="好的那一條", sources=[message.id])
    llm = DigestLLM({"add": [bad(message.id, file_id), good], "update": []})
    channel_memory.digest(tx, info.id, llm, None)
    texts = [m.text for m in tx.scalars(select(MemoryItem).where(MemoryItem.channel_id == info.id))]
    assert texts == ["好的那一條"]


def test_the_national_channel_never_shares(tx):
    info = channel_by_name(tx, "全國")
    message = say(tx, info, "U01", "全國的回報")
    channel_memory.digest(tx, info.id, DigestLLM({"add": [item(sources=[message.id], share=True, shared_text="x")], "update": []}), None)
    memory = tx.scalar(select(MemoryItem).where(MemoryItem.channel_id == info.id))
    assert (memory.shared, memory.shared_text) == (False, None)


def existing(tx, info, **fields) -> MemoryItem:
    memory = MemoryItem(channel_id=info.id, category=fields.pop("category", "competitor"), text=fields.pop("text", "原本的內容"), **fields)
    tx.add(memory)
    tx.flush()
    return memory


def test_a_human_edited_item_can_only_be_marked_done(tx):
    info = channel_by_name(tx, "台北市・中山區")
    todo = existing(tx, info, category="todo", text="週五前回覆店長", updated_by="U01")
    other = existing(tx, info, text="人改過的競品", updated_by="U01")
    message = say(tx, info, "U01", "店長回覆好了")
    llm = DigestLLM({"add": [], "update": [
        {"id": todo.id, "status": "done", "text": "被熊熊滾改掉的內容"},
        {"id": other.id, "text": "被熊熊滾改掉的內容", "share": True, "shared_text": "x"},
    ]})
    channel_memory.digest(tx, info.id, llm, None)
    tx.refresh(todo)
    tx.refresh(other)
    assert (todo.status, todo.text) == ("done", "週五前回覆店長")
    assert (other.text, other.shared) == ("人改過的競品", False)
    assert tx.get(Channel, info.id).memory_through_id == message.id


def test_a_withdrawn_item_cannot_be_shared_again_and_other_channels_items_are_untouchable(tx):
    info = channel_by_name(tx, "台北市・中山區")
    withdrawn = existing(tx, info, shared=True, shared_text="x", withdrawn_at=dt.datetime.now(dt.UTC), withdrawn_by="U01")
    elsewhere = existing(tx, channel_by_name(tx, "台北市・大安區"), text="別的頻道")
    say(tx, info, "U01", "新的回報")
    llm = DigestLLM({"add": [], "update": [
        {"id": withdrawn.id, "share": True, "shared_text": "再傳一次"},
        {"id": elsewhere.id, "text": "改別人的"},
    ]})
    channel_memory.digest(tx, info.id, llm, None)
    tx.refresh(elsewhere)
    assert elsewhere.text == "別的頻道"
    assert tx.get(MemoryItem, withdrawn.id).shared_text == "x"


def test_an_update_can_attach_photos_from_the_items_own_sources(tx):
    info = channel_by_name(tx, "台北市・中山區")
    old = say(tx, info, "U01", "上週拍的", [("old.jpg", photo(size=(40, 40)))])
    [old_file] = files_of(tx, old)
    memory = existing(tx, info, source_message_ids=[old.id])
    tx.get(Channel, info.id).memory_through_id = old.id
    say(tx, info, "U02", "這件事還在")
    llm = DigestLLM({"add": [], "update": [{"id": memory.id, "attachment_ids": [old_file], "share": True,
                                             "shared_text": "競品", "share_attachment_ids": [old_file]}]})
    channel_memory.digest(tx, info.id, llm, None)
    tx.refresh(memory)
    assert (memory.attachment_ids, memory.shared_attachment_ids) == ([old_file], [old_file])


def test_a_failed_digest_leaves_the_messages_for_next_time(tx, monkeypatch):
    info = channel_by_name(tx, "台北市・中山區")
    say(tx, info, "U01", "會失敗的這一批")
    monkeypatch.setattr(channel_memory, "get_llm", lambda: DigestLLM(error=RuntimeError("模型忙線")))
    monkeypatch.setattr(channel_memory, "optional_embedder", lambda: None)
    monkeypatch.setattr(
        channel_memory, "session_factory", lambda: lambda: Session(bind=tx.connection(), join_transaction_mode="create_savepoint")
    )
    channel_memory.run(info.id)
    tx.expire_all()
    assert tx.get(Channel, info.id).memory_through_id is None


def test_big_batches_inline_files_up_to_the_limit_and_describe_the_rest(tx):
    info = channel_by_name(tx, "台北市・中山區")
    message = say(tx, info, "U01", "三張", [(f"{i}.jpg", photo(size=(300, 300), color=(i * 40, 0, 0))) for i in range(3)])
    rows = tx.scalars(select(Attachment).where(Attachment.message_id == message.id).order_by(Attachment.id)).all()
    limit = rows[0].size_bytes + rows[1].size_bytes
    media, included = channel_memory.inline_files(rows, limit=limit)
    assert (len(media), included) == (2, {rows[0].id, rows[1].id})


# ---- 看板 ----


def team_and_region(tx):
    return channel_by_name(tx, "陳建宏小組"), channel_by_name(tx, "北區"), channel_by_name(tx, "全國")


def test_upper_boards_show_only_what_was_shared_without_the_original(tx, client, auth):
    team, region, national = team_and_region(tx)
    message = say(tx, team, "U01", "忠孝店議價到 5%", [("quote.jpg", photo(size=(30, 30))), ("shelf.jpg", photo(size=(30, 30)))])
    quote, shelf = files_of(tx, message)
    shared = existing(tx, team, text="忠孝店議價到 5%，貨架被御松田占走", source_message_ids=[message.id],
                      attachment_ids=[quote, shelf], shared=True, shared_text="御松田占走北區連鎖店的貨架", shared_attachment_ids=[shelf])
    existing(tx, team, text="組內才看的", source_message_ids=[message.id])
    own = client.get(f"/api/channels/{team.id}/board", headers=auth("U01")).json()["own"]
    assert {i["text"] for i in own} >= {"忠孝店議價到 5%，貨架被御松田占走", "組內才看的"}
    for board_channel in (region, national):
        below = client.get(f"/api/channels/{board_channel.id}/board", headers=auth("U01")).json()["below"]
        group = next(g for g in below if g["channel_id"] == team.id)
        [only] = [i for i in group["items"] if i["id"] == shared.id]
        assert only["text"] == "御松田占走北區連鎖店的貨架"
        assert "source_message_ids" not in only
        assert [a["id"] for a in only["attachments"]] == [shelf]
        assert all(i["text"] != "組內才看的" for i in group["items"])


def test_shared_photos_open_for_other_regions_until_withdrawn(tx, client, auth, engine):
    team, region, national = team_and_region(tx)
    message = say(tx, team, "U01", "貨架", [("shelf.jpg", photo(size=(30, 30))), ("quote.jpg", photo(size=(30, 30)))])
    shelf, quote = files_of(tx, message)
    memory = existing(tx, team, source_message_ids=[message.id], attachment_ids=[shelf, quote], shared=True,
                      shared_text="競品占貨架", shared_attachment_ids=[shelf])
    south = tx.get(AppUser, "U05")

    def opens(attachment_id):
        return attachments.can_see(tx, south, tx.get(Attachment, attachment_id))

    assert opens(shelf) and not opens(quote)
    assert client.post(f"/api/memory/{memory.id}/withdraw", headers=auth("U02")).status_code == 204
    assert not opens(shelf)
    below = client.get(f"/api/channels/{national.id}/board", headers=auth("U05")).json()["below"]
    assert all(i["id"] != memory.id for g in below for i in g["items"])


def test_only_people_in_the_owning_channel_can_edit_delete_or_withdraw(tx, client, auth):
    team, region, _ = team_and_region(tx)
    message = say(tx, team, "U01", "貨架", [("shelf.jpg", photo(size=(30, 30))), ("dm.jpg", photo(size=(30, 30)))])
    shelf, dm = files_of(tx, message)
    memory = existing(tx, team, source_message_ids=[message.id], attachment_ids=[shelf, dm], shared=True,
                      shared_text="競品", shared_attachment_ids=[shelf, dm])
    # 南區的人看得到全國看板上的這條，但動不了
    assert client.patch(f"/api/memory/{memory.id}", json={"text": "亂改"}, headers=auth("U05")).status_code == 404
    assert client.post(f"/api/memory/{memory.id}/withdraw", headers=auth("U05")).status_code == 404
    # 組內的人可以改，記下是誰改的；往上傳的圖只能拿掉不能加
    assert client.patch(f"/api/memory/{memory.id}", json={"text": "改好的內容", "shared_attachment_ids": [shelf]}, headers=auth("U02")).status_code == 204
    tx.refresh(memory)
    assert (memory.text, memory.updated_by, memory.shared_attachment_ids) == ("改好的內容", "U02", [shelf])
    assert client.patch(f"/api/memory/{memory.id}", json={"shared_attachment_ids": [shelf, dm]}, headers=auth("U02")).status_code == 422
    own = client.get(f"/api/channels/{team.id}/board", headers=auth("U01")).json()["own"]
    assert next(i for i in own if i["id"] == memory.id)["edited_by"] == "王冠宇"
    assert client.delete(f"/api/memory/{memory.id}", headers=auth("U01")).status_code == 204
    assert client.patch(f"/api/memory/{memory.id}", json={"text": "x"}, headers=auth("U01")).status_code == 404


def test_todos_sort_first_by_due_date_and_done_ones_last(tx):
    _, region, _ = team_and_region(tx)
    today = dt.date.today()
    later = existing(tx, region, category="todo", text="晚的", due_date=today + dt.timedelta(days=5))
    sooner = existing(tx, region, category="todo", text="早的", due_date=today + dt.timedelta(days=1))
    done = existing(tx, region, category="todo", text="做完的", status="done")
    other = existing(tx, region, text="競品")
    order = [i.id for i in memory_board.board(tx, region).own if i.id in {later.id, sooner.id, done.id, other.id}]
    assert order == [sooner.id, later.id, other.id, done.id]


# ---- 跳回原訊息 ----


def test_around_returns_the_message_with_twenty_on_each_side(tx, client, auth):
    info = channel_by_name(tx, "台北市・中山區")
    ids = [say(tx, info, "U01", f"第 {i} 則").id for i in range(50)]
    rows = client.get(f"/api/channels/{info.id}/messages", params={"around": ids[25]}, headers=auth("U01")).json()
    assert [m["id"] for m in rows] == ids[5:46]
    assert client.get(f"/api/channels/{info.id}/messages", params={"around": 1}, headers=auth("U01")).status_code == 404
