"""方法卡：主管寫、全公司看，業務按「有幫上／沒幫上」（docs/superpowers/specs/2026-09-30-method-cards-design.md）。

- 看：上架的卡登入就看得到，不分區（SHARING_LEVEL["method_card"] 是 ROOT）。下架的只出現在主管端（mine）。
- 寫：主管與 IT 新增；修改、下架、重新上架是作者本人或 IT。
- 回饋：同一個帳號在同一家客戶對同一張卡只有一筆，再按一次是改答案。記在實際登入的帳號上，
  自建帳號不記到他代理的那位業務名下。
- 內容是人寫的，這裡不呼叫任何模型。

卡片只有幾十張，次數整批算好在 Python 裡排序，不寫成一條大 SQL。
談判卡與新人第一週頁用 related 照標籤帶出相關的卡，回饋走同一支 API。
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import CUSTOMER_TYPES, METHOD_CARD_STATUSES, METHOD_TAGS, AppUser, Customer, MethodCard, MethodCardFeedback
from app.services.scope import SHARING_LEVEL, Scope

# 標題在清單上只有一行；情況是清單上的兩三行；做法是點開才看的全文，上限跟主管回覆提問一樣
TITLE_LENGTH = (2, 40)
SITUATION_MAX = 200
APPROACH_MAX = 2000
# 可以改的欄位。作者、建立時間不給改
EDITABLE = ("title", "situation", "approach", "customer_type", "tags", "status")


class NotFound(Exception):
    """卡片或客戶不存在，或這張卡登入者看不到（下架的卡對業務就是不存在）。API 回 404。"""


class Forbidden(Exception):
    """不是作者本人也不是 IT。API 回 403。"""


class Invalid(ValueError):
    """欄位不合規定，訊息寫出是哪一欄。API 回 422。"""


def check_tag(tag: str) -> str:
    if tag not in METHOD_TAGS:
        raise Invalid(f"標籤「{tag}」不在可用的標籤裡")
    return tag


def check_customer_type(customer_type: str) -> str:
    if customer_type not in CUSTOMER_TYPES:
        raise Invalid(f"適用類型「{customer_type}」不認得，只能是連鎖、獨立藥局、診所，或都適用")
    return customer_type


def _text(label: str, value: Any, shortest: int, longest: int) -> str:
    text = value.strip() if isinstance(value, str) else ""
    if len(text) < shortest:
        raise Invalid(f"{label}至少要 {shortest} 個字" if shortest > 1 else f"{label}不能是空的")
    if len(text) > longest:
        raise Invalid(f"{label}最多 {longest} 個字，現在是 {len(text)} 個字")
    return text


def _clean(values: dict[str, Any]) -> dict[str, Any]:
    """檢查並整理要寫入的欄位，只處理有給的那幾個。"""
    cleaned = dict(values)
    if "title" in values:
        cleaned["title"] = _text("標題", values["title"], *TITLE_LENGTH)
    if "situation" in values:
        cleaned["situation"] = _text("情況", values["situation"], 1, SITUATION_MAX)
    if "approach" in values:
        cleaned["approach"] = _text("做法", values["approach"], 1, APPROACH_MAX)
    if values.get("customer_type") is not None:
        check_customer_type(values["customer_type"])
    if "tags" in values:
        # 重複的只留第一個，順序照寫的人選的
        tags = list(dict.fromkeys(values["tags"] or []))
        if not tags:
            raise Invalid("標籤至少要選一個")
        cleaned["tags"] = [check_tag(tag) for tag in tags]
    if "status" in values and values["status"] not in METHOD_CARD_STATUSES:
        raise Invalid("狀態只能是上架或下架")
    return cleaned


def _visible(user: AppUser) -> Any:
    """加在 where 上：登入者看不看得到這張卡。方法卡共享到全公司，所以只要登入者在組織裡（自建帳號
    換算成他代理的那位）就成立；解不出路徑的帳號什麼都看不到，跟其他資料一樣。"""
    return Scope.for_user(user).includes(SHARING_LEVEL["method_card"], MethodCard.author_id)


def _out(session: Session, cards: list[MethodCard], user: AppUser, customer_id: str | None) -> list[dict[str, Any]]:
    """整批算次數、作者名字與「我按過什麼」，順序跟傳進來的一樣。"""
    ids = [card.id for card in cards]
    if not ids:
        return []
    counts = {
        card_id: (adopted, not_helped)
        for card_id, adopted, not_helped in session.execute(
            select(
                MethodCardFeedback.card_id,
                func.count().filter(MethodCardFeedback.helped),
                func.count().filter(~MethodCardFeedback.helped),
            )
            .where(MethodCardFeedback.card_id.in_(ids))
            .group_by(MethodCardFeedback.card_id)
        )
    }
    # 「我」是實際登入的帳號；情境是請求帶的那家客戶，沒帶就是在方法卡清單上按的那一筆（customer_id 是 NULL）
    mine = dict(session.execute(
        select(MethodCardFeedback.card_id, MethodCardFeedback.helped).where(
            MethodCardFeedback.card_id.in_(ids),
            MethodCardFeedback.user_id == user.id,
            MethodCardFeedback.customer_id.is_not_distinct_from(customer_id),
        )
    ).all())
    authors = dict(session.execute(
        select(AppUser.id, AppUser.name).where(AppUser.id.in_({card.author_id for card in cards}))
    ).all())
    return [
        {
            "id": card.id, "title": card.title, "situation": card.situation, "approach": card.approach,
            "customer_type": card.customer_type, "tags": list(card.tags),
            "author_name": authors[card.author_id], "status": card.status,
            "adopted": counts.get(card.id, (0, 0))[0], "not_helped": counts.get(card.id, (0, 0))[1],
            "my_feedback": mine.get(card.id), "updated_at": card.updated_at,
        }
        for card in cards
    ]


def card_out(session: Session, card: MethodCard, user: AppUser, customer_id: str | None = None) -> dict[str, Any]:
    """一張卡給畫面的樣子。adopted／not_helped 是有幫上／沒幫上的筆數；my_feedback 是登入者在這個情境
    （customer_id 那家客戶，沒給就是方法卡清單）按過什麼，沒按過是 None。"""
    return _out(session, [card], user, customer_id)[0]


def list_published(
    session: Session,
    user: AppUser,
    *,
    tag: str | None = None,
    customer_type: str | None = None,
    q: str | None = None,
    customer_id: str | None = None,
) -> list[dict[str, Any]]:
    """上架的卡，採用次數多的在前，同數看最近修改。

    tag 比對標籤；customer_type 列出適用那一種的，加上每種都適用的；q 在標題、情況、做法裡找。"""
    stmt = select(MethodCard).where(MethodCard.status == "published", _visible(user))
    if tag:
        stmt = stmt.where(MethodCard.tags.any(check_tag(tag)))
    if customer_type:
        stmt = stmt.where(or_(MethodCard.customer_type.is_(None), MethodCard.customer_type == check_customer_type(customer_type)))
    if q and q.strip():
        # autoescape：使用者打的 % 與 _ 是字面上的字，不是萬用字元
        keyword = q.strip()
        stmt = stmt.where(or_(*(
            column.icontains(keyword, autoescape=True)
            for column in (MethodCard.title, MethodCard.situation, MethodCard.approach)
        )))
    cards = _out(session, list(session.scalars(stmt)), user, customer_id)
    return sorted(cards, key=lambda card: (card["adopted"], card["updated_at"], card["id"]), reverse=True)


def related(
    session: Session, user: AppUser, *, tags: set[str], customer_type: str | None, customer_id: str | None, limit: int
) -> list[dict[str, Any]]:
    """談判卡與新人頁帶出來的卡：上架的卡裡標籤跟 tags 有交集、適用這種客戶的，照清單的次序取前 limit 張。

    customer_type 是 None 就不篩類型（新人頁）。customer_id 是在哪一家客戶的談判卡上看，my_feedback 看那一家的。
    tags 裡不是方法卡標籤的（談判卡的 chain 訊號）對不到任何卡，不算錯。"""
    if not tags:
        return []
    # 直接拿清單來挑：次數、排序、看不看得到都只有那一份規則
    cards = list_published(session, user, customer_type=customer_type, customer_id=customer_id)
    return [card for card in cards if tags.intersection(card["tags"])][:limit]


def list_mine(session: Session, user: AppUser) -> list[dict[str, Any]]:
    """主管端：自己寫的卡，含下架的；IT 看全部。最近改過的在前——剛寫好的卡還沒有人採用，
    照採用次數排會沉到最底下，主管找不到自己剛寫的那一張。"""
    stmt = select(MethodCard).order_by(MethodCard.updated_at.desc(), MethodCard.id.desc())
    if user.role != "it":
        stmt = stmt.where(MethodCard.author_id == user.id)
    return _out(session, list(session.scalars(stmt)), user, None)


def create(session: Session, author: AppUser, values: dict[str, Any]) -> MethodCard:
    """新增一張卡，直接上架。誰能新增由 API 擋（主管與 IT）。"""
    cleaned = _clean(values)
    # 時間用真實時間自己帶，不用資料庫的 now()：那是交易開始的時間，同一個交易裡寫的兩張卡會分不出先後
    now = dt.datetime.now(dt.UTC)
    card = MethodCard(**cleaned, author_id=author.id, status="published", created_at=now, updated_at=now)
    session.add(card)
    session.flush()
    return card


def update(session: Session, user: AppUser, card_id: int, changes: dict[str, Any]) -> MethodCard:
    """改內容、標籤、適用類型，或下架、重新上架。只有作者本人或 IT。沒有欄位真的變了就什麼都不寫。

    作者本人指的是還在當主管的作者：被降成業務之後進不了主管端（API 先擋掉），卡片照舊上架，之後只有 IT 改得了。
    這裡不用「當事人在不在自己底下」那個式子：那樣降調後的新主管也改得到別人寫的卡。"""
    card = session.get(MethodCard, card_id, with_for_update=True)
    if card is None:
        raise NotFound
    if user.role != "it" and card.author_id != user.id:
        raise Forbidden
    cleaned = _clean({key: value for key, value in changes.items() if key in EDITABLE})
    # 只算值真的變了的欄位（整理過再比：頭尾空白、重複的標籤不算）。表單打開沒改就按儲存不該更新時間：
    # 採用次數相同的卡照最近修改排，時間一跳，清單上的先後就跟著變
    changed = {key: value for key, value in cleaned.items() if getattr(card, key) != value}
    if not changed:
        return card
    for key, value in changed.items():
        setattr(card, key, value)
    card.updated_at = dt.datetime.now(dt.UTC)
    session.flush()
    return card


def give_feedback(
    session: Session, user: AppUser, card_id: int, helped: bool, customer_id: str | None = None
) -> MethodCard:
    """按「有幫上／沒幫上」。同一個帳號在同一家客戶對同一張卡再按一次是改答案，不會多一筆。

    客戶只檢查存不存在：客戶清單全公司共享，這裡只是記「在哪一家用的」，不會帶出那家的任何資料。"""
    card = session.scalar(
        select(MethodCard).where(MethodCard.id == card_id, MethodCard.status == "published", _visible(user))
    )
    if card is None:
        raise NotFound("找不到這張方法卡")
    if customer_id is not None and session.get(Customer, customer_id) is None:
        raise NotFound("找不到這家客戶")
    stmt = insert(MethodCardFeedback).values(card_id=card.id, user_id=user.id, customer_id=customer_id, helped=helped)
    # 唯一限制是 NULLS NOT DISTINCT：沒有客戶的那一筆也會撞到自己，一樣走更新
    session.execute(stmt.on_conflict_do_update(
        index_elements=[MethodCardFeedback.card_id, MethodCardFeedback.user_id, MethodCardFeedback.customer_id],
        set_={"helped": stmt.excluded.helped},
    ))
    return card
