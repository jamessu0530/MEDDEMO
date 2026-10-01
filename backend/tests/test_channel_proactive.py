"""熊熊滾的主動發言與風險通報（app/jobs/channels.py、services/risk.py），以及回答時看得到附圖與看板（services/channel_ai.py）。

時間一律用真實的台灣日期：示範對話、訊息、熊熊滾讀出來的到期日都是真實時間。
"""

import datetime as dt

from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from test_attachments import photo
from test_channel_memory import channel_by_name, existing, say

from app.jobs import channels as channel_jobs
from app.models import Attachment, ChannelMessage, ManagerNotice, MemoryItem, Visit
from app.services import attachments, channel_ai, risk
from app.services.knowledge import KnowledgeAnswer
from app.timeutil import TAIPEI


class SummaryLLM:
    def __init__(self, summary="忠孝店補貨延遲，御松田在搶陳列位。", fail_on=None):
        self.summary, self.fail_on, self.prompts = summary, fail_on, []

    def json(self, *, system, prompt, schema, **_):
        self.prompts.append((system, prompt))
        if self.fail_on and self.fail_on in system:
            raise RuntimeError("模型忙線")
        return {"summary": self.summary}


def ai_messages(session: Session, channel_id: int) -> list[ChannelMessage]:
    return list(session.scalars(
        select(ChannelMessage).where(ChannelMessage.channel_id == channel_id, ChannelMessage.kind == "ai").order_by(ChannelMessage.id)
    ))


# ---- 風險通報進小組頻道 ----


def test_a_risk_notice_also_lands_in_the_reps_team_channel(tx):
    visit = tx.scalar(select(Visit).where(Visit.user_id == "U01", Visit.status == "synced").order_by(Visit.id))
    tx.execute(delete(ManagerNotice).where(ManagerNotice.visit_id == visit.id))
    visit.fields_final = {**(visit.fields_final or {}), "complaint": "測試：外盒破損"}
    notice = risk.notify_manager(tx, visit)
    team = channel_by_name(tx, "陳建宏小組")
    message = tx.scalar(select(ChannelMessage).where(ChannelMessage.visit_id == visit.id))
    assert (message.channel_id, message.kind, message.author_id) == (team.id, "notice", None)
    assert message.body.startswith("林昱辰拜訪") and "客訴：測試：外盒破損" in message.body
    assert f"風險分 {notice.score}" in message.body


def test_no_team_channel_means_no_channel_notice(tx):
    visit = tx.scalar(select(Visit).where(Visit.user_id == "U01", Visit.status == "synced").order_by(Visit.id.desc()))
    tx.execute(delete(ManagerNotice).where(ManagerNotice.visit_id == visit.id))
    visit.fields_final = {**(visit.fields_final or {}), "complaint": "測試：沒有小組頻道"}
    team = channel_by_name(tx, "陳建宏小組")
    tx.execute(delete(ChannelMessage).where(ChannelMessage.channel_id == team.id))
    tx.execute(delete(MemoryItem).where(MemoryItem.channel_id == team.id))
    from app.models import Channel

    tx.execute(delete(Channel).where(Channel.id == team.id))
    assert risk.notify_manager(tx, visit) is not None
    assert tx.scalar(select(ChannelMessage).where(ChannelMessage.visit_id == visit.id)) is None


# ---- 週摘要 ----


def test_the_weekly_summary_goes_to_channels_that_talked_this_week(tx):
    quiet = channel_by_name(tx, "台北市・南港區")
    busy = channel_by_name(tx, "台北市・中山區")
    say(tx, busy, "U01", "中山區這週御松田在推魚油", [("dm.jpg", photo(size=(30, 30)))])
    tx.execute(
        Attachment.__table__.update().where(Attachment.message_id.in_(select(ChannelMessage.id).where(ChannelMessage.channel_id == busy.id))).values(caption="御松田魚油 DM")
    )
    llm = SummaryLLM()
    posted = channel_jobs.weekly(tx, llm)
    assert busy.id in posted and len(posted) >= 2  # 示範對話的頻道也都在七天內
    [summary] = ai_messages(tx, busy.id)
    assert summary.body == "上週重點整理：\n忠孝店補貨延遲，御松田在搶陳列位。"
    assert summary.reply_to_id is None
    assert ai_messages(tx, quiet.id) == []
    system, prompt = next(p for p in llm.prompts if "台北市・中山區" in p[0])
    assert "中山區這週御松田在推魚油〔附件：御松田魚油 DM〕" in prompt


def test_one_channel_failing_does_not_stop_the_others(tx):
    say(tx, channel_by_name(tx, "台北市・中山區"), "U01", "中山區")
    posted = channel_jobs.weekly(tx, SummaryLLM(fail_on="台北市・中山區"))
    assert ai_messages(tx, channel_by_name(tx, "台北市・中山區").id) == []
    assert channel_by_name(tx, "台北市・中山區").id not in posted and posted


def test_messages_older_than_a_week_do_not_count(tx):
    later = dt.datetime.now(dt.UTC) + dt.timedelta(days=30)
    assert channel_jobs.weekly(tx, SummaryLLM(), now=later) == []


# ---- 逾期提醒 ----


def test_overdue_todos_are_listed_once_every_three_days(tx):
    info = channel_by_name(tx, "台北市・中山區")
    today = dt.datetime.now(TAIPEI).date()
    overdue = existing(tx, info, category="todo", text="回覆杏林診所的比價表", due_date=today - dt.timedelta(days=2))
    existing(tx, info, category="todo", text="明天才到期的拜訪", due_date=today + dt.timedelta(days=1))
    existing(tx, info, category="todo", text="早就完成的比價", due_date=today - dt.timedelta(days=5), status="done")
    now = dt.datetime.now(dt.UTC)
    assert info.id in channel_jobs.reminders(tx, now)
    [reminder] = ai_messages(tx, info.id)
    assert "回覆杏林診所的比價表" in reminder.body
    assert "明天才到期的拜訪" not in reminder.body and "早就完成的比價" not in reminder.body
    assert overdue.reminded_at == now
    # 三天內不重發；過了三天再提醒一次
    channel_jobs.reminders(tx, now + dt.timedelta(days=1))
    assert len(ai_messages(tx, info.id)) == 1
    channel_jobs.reminders(tx, now + dt.timedelta(days=3, minutes=1))
    assert len(ai_messages(tx, info.id)) == 2


# ---- @熊熊滾 看得到附圖與看板 ----


class SeeingRouteLLM:
    def __init__(self, decision):
        self.decision, self.calls = decision, []

    def json(self, *, system, prompt, schema, media=(), **_):
        self.calls.append({"prompt": prompt, "media": [mime for _, mime in media]})
        return self.decision


def test_the_mascot_looks_at_the_photo_it_was_asked_about_and_reads_the_board(tx, monkeypatch):
    info = channel_by_name(tx, "陳建宏小組")
    earlier = say(tx, info, "U02", "這是上週的貨架", [("shelf.jpg", photo(size=(30, 30)))])
    tx.execute(Attachment.__table__.update().where(Attachment.message_id == earlier.id).values(caption="忠孝店貨架"))
    asked = say(tx, info, "U01", "@熊熊滾 這張仿單上的品項可以退貨嗎", [("leaflet.jpg", photo(size=(30, 30)))])
    tx.execute(Attachment.__table__.update().where(Attachment.message_id == asked.id).values(caption="魚油 30 入的仿單"))
    llm = SeeingRouteLLM({"route": "documents", "question": "魚油 30 入可以退貨嗎", "answer": ""})
    seen = {}

    def fake_knowledge(session, llm_, question, on_step, embed_query=None, *, media=(), note=None):
        seen.update(question=question, media=[mime for _, mime in media], note=note)
        return KnowledgeAnswer("answered", "近效期 90 天前可以退 [1]", [{"index": 1, "doc_title": "退貨", "section": "近效期"}])

    monkeypatch.setattr(channel_ai, "get_llm", lambda: llm)
    monkeypatch.setattr(channel_ai, "answer_knowledge", fake_knowledge)
    monkeypatch.setattr(channel_ai, "optional_embedder", lambda: None)
    reply = channel_ai.answer(tx, asked.id)
    # 判斷題目時就看到了提問附的圖；之前的圖只有說明
    [call] = llm.calls
    assert call["media"] == ["image/jpeg"]
    assert "〔附件：忠孝店貨架〕" in call["prompt"]
    # 示範資料的看板也給了
    assert "看板上的重點：" in call["prompt"] and "北區補貨從下週一起改成一週兩次" in call["prompt"]
    # 查文件時一樣附圖，說明接在問題後面
    assert seen == {"question": "魚油 30 入可以退貨嗎", "media": ["image/jpeg"], "note": "魚油 30 入的仿單"}
    assert reply.body.startswith("近效期 90 天前可以退 [1]")
    assert attachments  # 模組有用到（避免 import 被清掉）
