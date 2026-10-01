"""頻道裡 @熊熊滾 時的回答（docs/superpowers/specs/2026-10-01-channel-mascot-answers-design.md）。

先讓模型判斷題目：要查公司文件的，參考對話改寫成一句單獨看得懂的問題，交給跟問答頁同一條 CRAG
（knowledge.answer_knowledge）；只看對話就答得出來的，這一次就直接回答。
只給這個頻道的對話與客戶基本資料，不查銷售數字、不讀拜訪紀錄：頻道裡的回答所有成員都看得到，
現有的權限是依個人算的，拿頻道的範圍去查，會讓只給小組看的東西傳到整區。
"""

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, undefer

from app.db import session_factory
from app.embeddings import optional_embedder
from app.llm import LLMOutputError, Media, get_llm
from app.models import AppUser, Attachment, Channel, ChannelMessage, Customer, Place
from app.services import attachments as attachment_files
from app.services import channels, memory_board
from app.services.channel_memory import CATEGORY_LABEL, inline_files
from app.services.channels import ChannelInfo
from app.services.knowledge import answer_knowledge
from app.timeutil import TAIPEI

log = logging.getLogger(__name__)

SORRY = "我暫時答不出來，請稍後再 @ 我一次。"
# 給模型看最近幾則（含提問那一則）
CONTEXT_MESSAGES = 50
# 給模型看看板上最近變動的幾條重點（自己的與下層往上傳的）
BOARD_ITEMS = 150
KIND_LABEL = {
    "national": "全國頻道", "region": "整區頻道", "team": "小組頻道", "place": "地點頻道", "customer": "客戶討論串",
}
CUSTOMER_TYPE_LABEL = {"chain": "連鎖藥局", "independent": "獨立藥局", "clinic": "診所"}

SYSTEM = """你是「熊熊滾」，醫藥通路業務團隊頻道裡的 AI 助理。有人在頻道裡 @ 你，請判斷怎麼回答。

route 二選一：
- documents：跟公司規定、產品、作業流程有關，要查公司內部文件才答得出來的題目，例如退貨、報價與折扣權限、
  陳列、檔期活動、付款與帳齡、新客戶建檔、樣品、出差、用藥知識。這類題目一律走 documents，不能憑對話內容或常識自己回答。
  question 填一句不看對話也看得懂的問題（把「這個」「剛剛說的」換成實際指的東西），不要放同事的名字；answer 填空字串。
- chat：只看下面的對話與客戶資料就答得出來的題目（例如整理剛剛大家說了什麼、這家客戶誰負責），或是打招呼、閒聊。
  answer 直接寫回答：繁體中文、口語、簡短；對話與客戶資料裡沒有的事就說不知道，不要猜。question 填空字串。

你看不到銷售數字與拜訪紀錄；有人問這些，走 chat，請他到問答頁查。
@ 你的那一則附了照片或 PDF 的話，原檔放在最前面，一起看；其他訊息的附件只有說明。
看板上的重點是你之前從對話整理出來的，可以拿來回答「最近有什麼客訴」「還有哪些待辦」這類問題。"""

ROUTE_SCHEMA = {
    "type": "object",
    "properties": {
        "route": {"type": "string", "enum": ["documents", "chat"]},
        "question": {"type": "string"},
        "answer": {"type": "string"},
    },
    "required": ["route", "question", "answer"],
    "additionalProperties": False,
}


def run(message_id: int) -> None:
    """RQ 背景工作的進入點（channels 佇列）：開自己的連線，回答完 commit。"""
    with session_factory()() as session:
        answer(session, message_id)
        session.commit()


def answer(session: Session, message_id: int) -> ChannelMessage | None:
    """回答 message_id 那一則 @，回傳熊熊滾發的訊息；訊息不見了或頻道已經封存就不回，回傳 None。
    出錯一律道歉，提問的人可以再 @ 一次。呼叫端負責 commit。"""
    asked = session.get(ChannelMessage, message_id)
    if asked is None:
        return None
    info = channels.describe(session, [session.get(Channel, asked.channel_id)])[0]
    if info.archived:
        return None
    try:
        body = _reply(session, info, asked)
    except Exception:
        log.exception("熊熊滾回答失敗 message=%s", message_id)
        body = SORRY
    return channels.post_mascot(session, info.id, body, message_id)


def _asked_files(session: Session, asked: ChannelMessage) -> tuple[list[Media], str | None]:
    """@ 的那一則附的檔案：原檔給模型看（到 18MB 為止），說明接在問題後面給文件檢索用。"""
    files = list(session.scalars(
        select(Attachment).where(Attachment.message_id == asked.id).options(undefer(Attachment.content)).order_by(Attachment.id)
    ))
    media, _ = inline_files(files)
    notes = "；".join(f.caption for f in files if f.caption)
    return media, notes or None


def _reply(session: Session, info: ChannelInfo, asked: ChannelMessage) -> str:
    llm = get_llm()
    media, note = _asked_files(session, asked)
    decision = llm.json(
        system=SYSTEM, prompt=_prompt(session, info, asked), schema=ROUTE_SCHEMA, effort="low", media=media
    )
    if decision["route"] == "chat":
        if not decision["answer"].strip():
            raise LLMOutputError("判斷只看對話就答得出來，卻沒有寫回答")
        return decision["answer"].strip()
    question = decision["question"].strip()
    if not question:
        raise LLMOutputError("判斷要查文件，卻沒有寫問題")
    embedder = optional_embedder()
    # 附了照片（例如拍仿單問怎麼退貨）：跟問答頁一樣，向量用「問題 + 檔案」、說明接在問題後面、產生答案時看原檔
    embed_query = (lambda query: embedder.embed_query(query, media)) if embedder else None
    result = answer_knowledge(session, llm, question, _skip_step, embed_query, media=media, note=note)
    if result.status == "answered":
        return with_sources(result.answer, result.sources)
    if result.status == "no_evidence":
        return result.answer
    return result.error_message or SORRY


def _skip_step(*_args, **_kwargs) -> None:
    """CRAG 每一步的紀錄（問答頁寫進 query_trace）。頻道沒有地方放，也沒有畫面要看，不記。"""


def with_sources(answer_text: str, sources: list[dict[str, Any]]) -> str:
    """答案後面空一行接出處，一個來源一行，編號跟答案裡的 [n] 對得上：
    內部文件寫「文件標題｜小節」，網頁寫「標題 網址」。"""
    if not sources:
        return answer_text
    lines = [
        f"[{s['index']}] {s['doc_title']} {s['url']}" if s.get("url") else f"[{s['index']}] {s['doc_title']}｜{s['section']}"
        for s in sources
    ]
    return f"{answer_text}\n\n出處：\n" + "\n".join(lines)


def _prompt(session: Session, info: ChannelInfo, asked: ChannelMessage) -> str:
    # 只取到提問那一則：之後才進來的訊息不給，免得答非所問
    rows = session.execute(
        select(ChannelMessage, AppUser.name)
        .outerjoin(AppUser, AppUser.id == ChannelMessage.author_id)
        .where(ChannelMessage.channel_id == info.id, ChannelMessage.id <= asked.id)
        .order_by(ChannelMessage.id.desc())
        .limit(CONTEXT_MESSAGES)
    ).all()[::-1]
    parts = [f"頻道：{info.name}（{KIND_LABEL[info.kind]}）"]
    if info.customer_id:
        parts.append(_customer(session, info.customer_id))
    parts += _board(session, info)
    files = attachment_files.for_messages(session, [message.id for message, _ in rows])
    parts.append("最近的對話（由舊到新，最後一則是 @ 你的那一則）：")
    parts += [_line(message, author_name, files.get(message.id, [])) for message, author_name in rows]
    return "\n".join(parts)


def _board(session: Session, info: ChannelInfo) -> list[str]:
    """這個頻道的看板：自己的重點，加上下層往上傳的（只有往上傳的寫法）。最近變動的 150 條。"""
    board = memory_board.board(session, info)
    entries = [(item.updated_at, f"（{_label(item)}）{item.text}") for item in board.own]
    entries += [
        (item.updated_at, f"（{group.channel_name}往上傳、{_label(item)}）{item.shared_text or item.text}")
        for group in board.below
        for item in group.items
    ]
    if not entries:
        return []
    entries.sort(key=lambda entry: entry[0], reverse=True)
    return ["看板上的重點：", *(text for _, text in entries[:BOARD_ITEMS])]


def _label(item) -> str:
    label = CATEGORY_LABEL[item.category]
    if item.category == "todo":
        label += "、已完成" if item.status == "done" else (f"、{item.due_date.isoformat()} 到期" if item.due_date else "")
    return label


def _line(message: ChannelMessage, author_name: str | None, files: list[Attachment] = ()) -> str:
    who = {"ai": "熊熊滾", "notice": "風險通報"}.get(message.kind, author_name)
    notes = "".join(f"〔附件：{f.caption or f.filename}〕" for f in files)
    return f"{message.created_at.astimezone(TAIPEI):%m/%d %H:%M} {who}：{message.body}{notes}"


def _customer(session: Session, customer_id: str) -> str:
    """客戶基本資料，都是 customer_basic（全公司看得到）的欄位。合約到期日不是，不給。"""
    customer, place, owner = session.execute(
        select(Customer, Place.name, AppUser.name)
        .join(Place, Place.id == Customer.place_id)
        .join(AppUser, AppUser.id == Customer.owner_user_id)
        .where(Customer.id == customer_id)
    ).one()
    chain = f"；連鎖體系 {customer.chain_group}" if customer.chain_group else ""
    return (
        f"這個討論串的客戶：{customer.name}；類型 {CUSTOMER_TYPE_LABEL[customer.type]}{chain}；"
        f"縣市 {customer.city}；地點 {place}；等級 {customer.grade}；負責人 {owner}"
    )
