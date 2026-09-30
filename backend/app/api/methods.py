"""方法卡 API（docs/superpowers/specs/2026-09-30-method-cards-design.md）：主管寫、全公司看，業務回饋。

規則都在 services/method_cards.py，這裡只負責收參數、把例外換成狀態碼、提交。
欄位的長度與標籤由服務層檢查，不寫在 Pydantic 上：錯誤訊息才是寫給主管看的中文，講得出是哪一欄。
"""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser, ManagerUser
from app.db import get_session
from app.services import method_cards

router = APIRouter(prefix="/api/methods", tags=["methods"])
SessionDep = Annotated[Session, Depends(get_session)]


class MethodCardOut(BaseModel):
    id: int
    title: str
    # 什麼時候用
    situation: str
    # 怎麼做、怎麼說
    approach: str
    # None 代表每種客戶都適用
    customer_type: str | None
    tags: list[str]
    author_name: str
    status: str
    # 有幫上、沒幫上各幾次。採用次數就是有幫上的次數
    adopted: int
    not_helped: int
    # 登入者在這個情境（請求帶的那家客戶，沒帶就是方法卡清單）按過什麼；沒按過是 None
    my_feedback: bool | None
    updated_at: dt.datetime


class CardInput(BaseModel):
    title: str
    situation: str
    approach: str
    customer_type: str | None = None
    tags: list[str]


class CardChanges(BaseModel):
    """只改有送的欄位。customer_type 送 null 是改成「都適用」，跟沒送不一樣，所以看的是有沒有送。"""

    title: str | None = None
    situation: str | None = None
    approach: str | None = None
    customer_type: str | None = None
    tags: list[str] | None = None
    status: str | None = None


class FeedbackInput(BaseModel):
    helped: bool
    # 在哪一家客戶的談判卡上按的；從方法卡清單按的不帶
    customer_id: str | None = None


def _invalid(exc: method_cards.Invalid) -> HTTPException:
    return HTTPException(422, str(exc))


@router.get("", response_model=list[MethodCardOut])
def list_cards(
    session: SessionDep,
    user: CurrentUser,
    tag: str | None = None,
    customer_type: str | None = None,
    q: str | None = None,
    customer_id: str | None = None,
):
    """上架的卡，採用次數多的在前。customer_id 只決定 my_feedback 看哪一筆，不影響列出哪些卡。"""
    try:
        return method_cards.list_published(session, user, tag=tag, customer_type=customer_type, q=q, customer_id=customer_id)
    except method_cards.Invalid as exc:
        raise _invalid(exc) from None


@router.get("/mine", response_model=list[MethodCardOut])
def list_my_cards(session: SessionDep, manager: ManagerUser):
    """主管端的分頁：自己寫的卡，含下架的；IT 看全部。"""
    return method_cards.list_mine(session, manager)


@router.post("", response_model=MethodCardOut, status_code=status.HTTP_201_CREATED)
def create_card(session: SessionDep, manager: ManagerUser, body: CardInput):
    """新增並直接上架。作者就是登入的主管（或 IT）。"""
    try:
        card = method_cards.create(session, manager, body.model_dump())
    except method_cards.Invalid as exc:
        raise _invalid(exc) from None
    session.commit()
    return method_cards.card_out(session, card, manager)


@router.patch("/{card_id}", response_model=MethodCardOut)
def update_card(session: SessionDep, manager: ManagerUser, card_id: int, body: CardChanges):
    """改內容、標籤、適用類型，或下架（status: retired）、重新上架（published）。作者本人或 IT。"""
    changes = body.model_dump(exclude_unset=True)
    # 只有 customer_type 的 null 有意義（都適用）；其他欄位送 null 當作沒送，不會把必填的欄位清掉
    changes = {key: value for key, value in changes.items() if value is not None or key == "customer_type"}
    try:
        card = method_cards.update(session, manager, card_id, changes)
    except method_cards.NotFound:
        raise HTTPException(404, "找不到這張方法卡") from None
    except method_cards.Forbidden:
        raise HTTPException(403, "只有寫這張卡的主管或 IT 能修改") from None
    except method_cards.Invalid as exc:
        raise _invalid(exc) from None
    session.commit()
    return method_cards.card_out(session, card, manager)


@router.post("/{card_id}/feedback", response_model=MethodCardOut)
def give_feedback(session: SessionDep, user: CurrentUser, card_id: int, body: FeedbackInput):
    """按「有幫上／沒幫上」，回傳更新後的這張卡（次數與 my_feedback 都是按完之後的）。再按一次是改答案。"""
    try:
        card = method_cards.give_feedback(session, user, card_id, body.helped, body.customer_id)
    except method_cards.NotFound as exc:
        raise HTTPException(404, str(exc)) from None
    session.commit()
    return method_cards.card_out(session, card, user, customer_id=body.customer_id)
