"""問答 API：數字查詢（FR-7）與知識查詢（FR-8）共用同一套提問、進度與查詢軌跡。"""

import json
import logging
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from app.api.attachments import AttachmentItem, attachment_item
from app.api.auth import CurrentUser
from app.db import get_session
from app.models import AppUser, AskRecord, Attachment, Customer, QueryTrace
from app.services import ask_followup, ask_router, attachments, assistant_context, question_suggestions
from app.services.customer_inquiries import associated_customer_ids
from app.services.scope import SHARING_LEVEL, Scope
from app.services.product_appearance import is_appearance_question
from app.tasks import visit_queue

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/asks", tags=["asks"])
SessionDep = Annotated[Session, Depends(get_session)]


AskKind = Literal["data", "knowledge", "memory"]


class AskInput(BaseModel):
    kind: AskKind
    ghost: bool = False
    # 業務口語提問不會超過 500 字；再長多半是誤貼了一大段文字
    question: str = Field(min_length=1, max_length=500)
    page: assistant_context.PageContext | None = None
    context_used: bool = False


class Turn(BaseModel):
    """前端提供的最近問答，供整理提問及建議；實際查詢仍依登入者權限執行。"""

    question: str = Field(max_length=500)
    answer: str = Field(max_length=4000)
    page: assistant_context.PageContext | None = None
    has_file: bool = False


class RouteInput(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    # 有附檔案：分流時告訴 Jev（它只看文字，看不到檔案本身）
    has_file: bool = False
    # 前面幾輪（由舊到新）：這句要看前文才懂就先改寫（services/ask_followup.py）
    earlier: list[Turn] = Field(default_factory=list, max_length=10)
    # 業務自己點了查哪一種：只改寫、不分流
    kind: AskKind | None = None
    page: assistant_context.PageContext | None = None


class RouteOut(BaseModel):
    # 有把握就是這一種；null 時請業務從 choices 裡選
    kind: AskKind | None
    choices: list[AskKind]
    confidence: float | None
    # 要拿去查的那一句；rewritten 是 true 表示看了前文改寫過
    question: str
    rewritten: bool
    clarification: str | None = None
    context_used: bool = False
    continues_previous: bool = False
    # 頁面說明直接回覆；不建立 AskRecord、不送檢索。只有明確要求示範才帶 demo_path。
    intent: Literal["query", "page_help", "page_demo"] = "query"
    answer: str | None = None
    demo_path: str | None = None


class SuggestionsInput(BaseModel):
    page: assistant_context.PageContext
    earlier: list[Turn] = Field(default_factory=list, max_length=6)
    candidates: list[Annotated[str, Field(min_length=1, max_length=500)]] = Field(default_factory=list, max_length=8)


class SuggestionsOut(BaseModel):
    suggestions: list[str]


@dataclass(frozen=True)
class AskForm:
    body: AskInput
    # (檔名, 內容)；JSON 提問沒有檔案
    file: tuple[str | None, bytes] | None


def _invalid(exc: ValueError) -> RequestValidationError:
    errors = exc.errors() if isinstance(exc, ValidationError) else [{"msg": "格式不對", "loc": ("body",)}]
    return RequestValidationError(errors)


async def ask_form(request: Request) -> AskForm:
    """提問可以送 JSON，也可以送 multipart（kind、question 加 1 個檔案：拍產品盒、仿單、競品海報來問）。"""
    if not request.headers.get("content-type", "").startswith("multipart/form-data"):
        try:
            return AskForm(AskInput.model_validate(await request.json()), None)
        except ValueError as exc:
            raise _invalid(exc) from None
    form = await request.form(max_files=attachments.MAX_PER_ASK + 1, max_fields=7)
    uploads = [item for item in form.getlist("file") if isinstance(item, UploadFile)]
    if len(uploads) > attachments.MAX_PER_ASK:
        raise HTTPException(422, "一次提問只能附 1 個檔案")
    try:
        body = AskInput.model_validate({
            "kind": form.get("kind"), "question": form.get("question"), "ghost": form.get("ghost", False),
            "page": json.loads(form["page"]) if form.get("page") else None,
            "context_used": form.get("context_used", False),
        })
    except ValueError as exc:
        raise _invalid(exc) from None
    file = (uploads[0].filename, await uploads[0].read(attachments.MAX_FILE_BYTES + 1)) if uploads else None
    return AskForm(body, file)


class TraceItem(BaseModel):
    round: int
    step: str
    sql: str | None
    search_query: str | None
    row_count: int | None
    decision: str


class CustomerRef(BaseModel):
    id: str
    name: str


class AskDetail(BaseModel):
    id: str
    kind: str
    question: str
    status: str
    answer: str | None
    evidence: dict[str, Any] | None
    error_message: str | None
    trace: list[TraceItem]
    # 答案或查詢結果裡提到、而且是提問者自己看得到的客戶。畫面上「排入今天的路線」用
    customers: list[CustomerRef] = Field(default_factory=list)
    # 提問附的照片或 PDF
    attachment: AttachmentItem | None = None


# 答案裡最多抓幾家：原型的例子是「衰退集中 3 家連鎖」；一次排超過一天的量（5 家）也跑不完
MAX_MENTIONED_CUSTOMERS = 5


def _short_names(name: str) -> list[str]:
    """業務口語與模型的答案常把「康泰連鎖藥局 · 忠孝店」寫成「康泰忠孝店」，兩種都要認得。"""
    store, _, area = name.partition(" · ")
    brand = store.replace("連鎖藥局", "").replace("健康藥局", "").replace("藥局", "").replace("藥妝", "")
    return [name, f"{store}{area}", f"{brand}{area}"] if area else [name]


def mentioned_customers(session: Session, record: AskRecord, user: AppUser) -> list[CustomerRef]:
    """數字查詢的答案提到哪幾家客戶。只在提問者看得到的客戶裡找，照答案裡出現的順序。"""
    if record.kind != "data" or not record.answer:
        return []
    text = record.answer + json.dumps((record.evidence or {}).get("rows") or [], ensure_ascii=False)
    candidates = session.execute(
        select(Customer.id, Customer.name).where(Scope.for_user(user).customers_at(SHARING_LEVEL["customer_profile"]))
    ).all()
    found: list[tuple[int, CustomerRef]] = []
    for customer_id, name in candidates:
        positions = [text.find(alias) for alias in _short_names(name) + [customer_id]]
        positions = [pos for pos in positions if pos >= 0]
        if positions:
            found.append((min(positions), CustomerRef(id=customer_id, name=name)))
    return [ref for _, ref in sorted(found, key=lambda item: item[0])][:MAX_MENTIONED_CUSTOMERS]


def _detail(session: Session, record: AskRecord, user: AppUser) -> AskDetail:
    trace = session.scalars(select(QueryTrace).where(QueryTrace.ask_id == record.id).order_by(QueryTrace.id))
    attachment = session.scalar(select(Attachment).where(Attachment.ask_id == record.id))
    evidence = _signed_evidence(session, record, user)
    return AskDetail(
        id=record.id,
        kind=record.kind,
        question=record.question,
        status=record.status,
        answer=record.answer,
        evidence=evidence,
        error_message=record.error_message,
        trace=[
            TraceItem(round=t.round, step=t.step, sql=t.sql, search_query=t.search_query, row_count=t.row_count, decision=t.decision)
            for t in trace
        ],
        customers=mentioned_customers(session, record, user),
        attachment=attachment_item(attachment, user) if attachment else None,
    )


def _signed_evidence(session: Session, record: AskRecord, user: AppUser) -> dict[str, Any] | None:
    """頻道記憶的依據裡有附件：每次讀都重新查權限、發簽名網址。撤回往上傳或 IT 刪了訊息之後就不再列出來。"""
    evidence = record.evidence
    if record.kind != "memory" or not evidence or not evidence.get("attachments"):
        return evidence
    ids = [entry["attachment_id"] for entry in evidence["attachments"]]
    found = {a.id: a for a in session.scalars(select(Attachment).where(Attachment.id.in_(ids)))}
    signed = []
    for entry in evidence["attachments"]:
        attachment = found.get(entry["attachment_id"])
        if attachment is None or not attachments.can_see(session, user, attachment):
            continue
        url, thumb_url = attachments.urls(attachment, user)
        signed.append({**entry, "kind": attachment.kind, "filename": attachment.filename, "url": url, "thumb_url": thumb_url})
    return {**evidence, "attachments": signed}


def _load(session: Session, ask_id: str, user: AppUser) -> AskRecord:
    record = session.get(AskRecord, ask_id)
    # 別人的提問一律當作不存在，不透露這個編號有人用過
    if record is None or record.user_id != user.id:
        raise HTTPException(404, "找不到這個提問")
    return record


@router.post("/route", response_model=RouteOut, response_model_exclude_defaults=True)
def route_ask(body: RouteInput, user: CurrentUser):
    """送出前先整理這一題：要看前文才懂就改寫（services/ask_followup.py），選「自動」再判斷該查哪一種
    （services/ask_router.py）。不建提問、不算進提問的次數：前端拿回來的那一句再照原本的 POST /api/asks 送"""
    question = body.question.strip()
    if not question:
        raise HTTPException(422, "請輸入問題")
    if body.kind is None and not body.has_file and is_appearance_question(question):
        return RouteOut(kind="data", choices=[], confidence=1.0, question=question, rewritten=False)
    earlier = [turn.model_dump(exclude_none=True, exclude_defaults=True) for turn in body.earlier]
    if body.page is not None:
        prepared = assistant_context.prepare(question, body.page, earlier, body.has_file)
        return RouteOut(
            kind=prepared.kind, choices=[], confidence=prepared.confidence,
            question=prepared.question, rewritten=prepared.question != question,
            clarification=prepared.clarification, context_used=prepared.context_used,
            continues_previous=prepared.continues_previous,
            intent="page_demo" if prepared.demo_path else "page_help" if prepared.answer else "query",
            answer=prepared.answer, demo_path=prepared.demo_path,
        )
    with ThreadPoolExecutor(max_workers=1) as pool:
        # 大多數的問題不用改寫：判斷要不要改寫的同時，先照原話分流，不用改寫就直接用這個結果，不多等一次
        guess = pool.submit(ask_router.route, question, body.has_file) if body.kind is None and earlier else None
        asked = ask_followup.standalone(question, earlier)
        if body.kind is not None:
            return RouteOut(kind=body.kind, choices=[], confidence=None, question=asked, rewritten=asked != question)
        routed = guess.result() if guess and asked == question else ask_router.route(asked, body.has_file)
    return RouteOut(
        kind=routed.kind, choices=routed.choices, confidence=routed.confidence, question=asked, rewritten=asked != question
    )


@router.post("/suggestions", response_model=SuggestionsOut)
async def suggest_questions(body: SuggestionsInput, user: CurrentUser):
    earlier = [turn.model_dump(exclude_none=True, exclude_defaults=True) for turn in body.earlier]
    return SuggestionsOut(suggestions=await question_suggestions.suggest(body.page, earlier, body.candidates))


@router.post("", status_code=202, response_model=AskDetail)
def create_ask(session: SessionDep, form: Annotated[AskForm, Depends(ask_form)], user: CurrentUser):
    """提問。查詢要跑好幾輪、呼叫好幾次模型，所以放到背景做，畫面輪詢 GET 看進度（NFR-5）。
    附的檔案先檢查完才建提問；AI 看檔案、算向量在背景工作的第一步做。"""
    body = form.body
    try:
        prepared = attachments.prepare(form.file[1], form.file[0]) if form.file else None
    except attachments.Rejected as exc:
        raise HTTPException(exc.status, str(exc)) from None
    record = AskRecord(
        id=uuid.uuid4().hex, user_id=user.id, kind=body.kind, question=body.question.strip(), ghost=body.ghost, status="queued",
        customer_ids=[] if body.ghost else associated_customer_ids(session, user, body.question, body.page, body.context_used),
    )
    session.add(record)
    session.flush()
    if prepared:
        attachments.add(session, user, prepared, context=record.question, ask_id=record.id)
    session.commit()
    try:
        visit_queue().enqueue("app.services.asks.run_ask", record.id)
    except Exception as exc:
        log.exception("排入背景工作失敗 ask=%s", record.id)
        record.status = "failed"
        record.error_message = f"背景處理服務暫時連不上，請稍後重試（{exc}）"
        session.commit()
    return _detail(session, record, user)


@router.get("/{ask_id}", response_model=AskDetail)
def get_ask(session: SessionDep, ask_id: str, user: CurrentUser):
    return _detail(session, _load(session, ask_id, user), user)
