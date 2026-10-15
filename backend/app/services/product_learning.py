"""品類練習：從現有型錄出題，伺服器核對答案後才保存過關紀錄。"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import AppUser, LearningCompletion, Product
from app.services.achievement_catalog import LESSON_STEPS, PRODUCT_CATEGORIES, lesson_id, medal_details
from app.services.learning import LearningError
from app.timeutil import TAIPEI


def _check(kind: str, tier: int | None = None):
    if kind not in PRODUCT_CATEGORIES or (tier is not None and tier not in (1, 2, 3)):
        raise LearningError("找不到這個品類練習", 404)


def _completion_rows(session: Session, user_id: str) -> dict[str, LearningCompletion]:
    ids = [lesson_id(kind, tier) for kind in PRODUCT_CATEGORIES for tier in (1, 2, 3)]
    return {r.lesson_id: r for r in session.scalars(
        select(LearningCompletion).where(LearningCompletion.user_id == user_id, LearningCompletion.lesson_id.in_(ids))
    )}


def _prefix(rows: dict, kind: str) -> int:
    count = 0
    for tier in (1, 2, 3):
        if lesson_id(kind, tier) not in rows:
            break
        count += 1
    return count


def medals(session: Session, user_id: str):
    # Late import avoids a cycle: achievements.build also calls this module.
    from app.services.achievements import Medal
    rows = _completion_rows(session, user_id)
    result = []
    for kind in PRODUCT_CATEGORIES:
        have = _prefix(rows, kind)
        for tier in (1, 2, 3):
            when = rows[lesson_id(kind, tier)].completed_at if have >= tier else None
            result.append(Medal(kind, tier, tier, have, when.astimezone(TAIPEI).date() if when else None, when))
    return result


def courses(session: Session, user: AppUser) -> list[dict[str, Any]]:
    if user.role != "sales":
        raise LearningError("品類練習是給業務使用的", 403)
    rows = _completion_rows(session, user.id)
    return [{
        "kind": kind, "category": label, "completed": _prefix(rows, kind), "total": 3,
        "lessons": [{
            "tier": tier, "title": LESSON_STEPS[tier - 1],
            "completed": tier <= _prefix(rows, kind), "locked": tier > _prefix(rows, kind) + 1,
            **medal_details(kind, tier, tier),
        } for tier in (1, 2, 3)],
    } for kind, label in PRODUCT_CATEGORIES.items()]


def _reference(session: Session, kind: str) -> list[Product]:
    # Prefer the common items learners also encounter in the normal product picker.
    products = list(session.scalars(select(Product).where(Product.category == PRODUCT_CATEGORIES[kind])
        .order_by(Product.common.desc(), Product.sku).limit(3)))
    if not products:
        raise LearningError("這個品類的型錄暫時沒有品項，請稍後再試", 409)
    return products


def _choices(values: list[tuple[str, str]]) -> list[dict[str, str]]:
    seen = set()
    result = []
    for value, label in values:
        if value not in seen:
            seen.add(value)
            result.append({"value": value, "label": label})
    return result


def _exercise(session: Session, kind: str, tier: int):
    products = _reference(session, kind)
    target = products[0]
    category = PRODUCT_CATEGORIES[kind]
    ref = [{"sku": p.sku, "name": p.name, "category": p.category, "spec": p.spec, "unit": p.unit} for p in products]
    if tier == 1:
        questions = [{
            "id": "category", "prompt": f"型錄中的「{target.name}」屬於哪個品類？",
            "choices": _choices([(c, c) for c in PRODUCT_CATEGORIES.values()]),
        }, {
            "id": "identity", "prompt": "核對品項時，哪個欄位能唯一辨識商品？",
            "choices": _choices([("name", "只看簡稱"), ("sku", "料號（SKU）"), ("color", "包裝顏色")]),
        }]
        answers = {"category": category, "identity": "sku"}
        hint = "先對照型錄的類別，再用料號辨識品項；簡稱相近不代表同一個商品。"
    elif tier == 2:
        spec = target.spec.strip()
        questions = [{
            "id": "spec", "prompt": f"依型錄，料號 {target.sku} 的規格是什麼？",
            "choices": _choices([(f"spec:{p.spec.strip()}", p.spec.strip() or "型錄未提供規格") for p in products]
                + [("spec:guess", "依品名自行推測"), ("spec:other", "套用其他料號的規格")]),
        }, {
            "id": "unit", "prompt": f"同一個料號的基礎計量單位是什麼？",
            "choices": _choices([(u, u) for u in ("盒", "瓶", "台", "支", "組", "包", target.unit)]),
        }]
        answers = {"spec": f"spec:{spec}", "unit": target.unit}
        hint = "規格與單位都以同一料號的型錄欄位為準；欄位沒提供，就不要自行補上。"
    else:
        questions = [{
            "id": "sku", "prompt": f"客戶指定「{target.name}」，應核對哪個料號？",
            "choices": _choices([(p.sku, f"{p.sku} · {p.name}") for p in products]
                + [("substitute", "直接換成同品類的其他商品")]),
        }, {
            "id": "quantity", "prompt": f"客戶要 3 {target.unit}，訂單數量應記錄多少？",
            "choices": _choices([("1", f"1 {target.unit}"), ("3", f"3 {target.unit}"), ("package", "把包裝內的數量當成訂單數量")]),
        }, {
            "id": "verify", "prompt": f"客戶詢問型錄未載明的{'器材規格或相容性' if kind == 'devices' else '包裝或商品資訊'}，下一步應該怎麼做？",
            "choices": _choices([("guess", "依相似商品猜測"), ("verify", "查最新原廠資料，無依據時轉主管確認"), ("promise", "先承諾可以，事後再查")]),
        }]
        answers = {"sku": target.sku, "quantity": "3", "verify": "verify"}
        hint = "同時核對料號、規格、基礎單位與數量；型錄沒有寫的資訊，先找依據再答覆。"
    return ref, questions, answers, hint


def lesson(session: Session, user: AppUser, kind: str, tier: int) -> dict[str, Any]:
    _check(kind, tier)
    if user.role != "sales":
        raise LearningError("品類練習是給業務使用的", 403)
    have = _prefix(_completion_rows(session, user.id), kind)
    locked = tier > have + 1
    ref, questions, _, hint = _exercise(session, kind, tier)
    return {
        "kind": kind, "category": PRODUCT_CATEGORIES[kind], "tier": tier,
        "lesson_title": LESSON_STEPS[tier - 1], "completed": have >= tier, "locked": locked,
        "have": have, **medal_details(kind, tier, tier),
        "reference": ref if not locked else [], "questions": questions if not locked else [], "hint": hint,
    }


def complete(session: Session, user: AppUser, kind: str, tier: int, answers: dict[str, str]):
    from app.services.achievements import newly_unlocked
    _check(kind, tier)
    if user.role != "sales":
        raise LearningError("品類練習是給業務使用的", 403)
    session.execute(select(AppUser.id).where(AppUser.id == user.id).with_for_update()).scalar_one()
    have = _prefix(_completion_rows(session, user.id), kind)
    if tier > have + 1:
        raise LearningError("先完成這個品類的前一關，再來練習這一關", 409)
    _, _, expected, _ = _exercise(session, kind, tier)
    if answers != expected:
        raise LearningError("還有答案需要核對。請對照上方型錄，把這一關全部答對再送出。")
    before = medals(session, user.id)
    session.execute(insert(LearningCompletion).values(user_id=user.id, lesson_id=lesson_id(kind, tier)).on_conflict_do_nothing())
    after = medals(session, user.id)
    # Calculate this submission's unlocks while still holding the user's row lock.
    # Another concurrent submission must not make both responses report one medal.
    unlocked = newly_unlocked(before, after)
    session.commit()
    return {"lesson": lesson(session, user, kind, tier), "unlocked": unlocked}
