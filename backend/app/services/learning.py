"""固定情境的操作課程：核對答案後才記過關，不呼叫 AI 或修改客戶資料。"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AppUser, LearningCompletion
from app.services.first_week import newcomer
from app.tasks import redis

LESSONS = (
    {"id": "customer-v1", "title": "進門前，先認識客戶", "description": "打開客戶檔案，找出今天最該處理的事。", "skill": "客戶檔案", "minutes": 2},
    {"id": "product-v1", "title": "看懂一口促銷", "description": "操作品項與促銷，分清楚付費量和搭贈量。", "skill": "產品與促銷", "minutes": 2},
    {"id": "route-v1", "title": "排好今天的兩站", "description": "調整拜訪順序，守住客戶約好的時間。", "skill": "今日路線", "minutes": 2},
    {"id": "visit-v1", "title": "AI 草稿，由你確認", "description": "對照示範逐字稿，刪掉客戶沒說的下單意向。", "skill": "拜訪確認", "minutes": 3},
    {"id": "ask-v1", "title": "問 AI，也要看依據", "description": "打開答案出處；查無依據時轉給主管。", "skill": "AI 問答", "minutes": 2},
)
LESSON_IDS = tuple(lesson["id"] for lesson in LESSONS)
XP_PER_LESSON = 20
DEMO_SKIP_PREFIX = "learning:demo-skip:"


class LearningError(ValueError):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


def completed_ids(session: Session, user: AppUser) -> list[str]:
    saved = set(session.scalars(select(LearningCompletion.lesson_id).where(LearningCompletion.user_id == user.id)))
    return [lesson_id for lesson_id in LESSON_IDS if lesson_id in saved]


def course(session: Session, user: AppUser) -> dict[str, Any]:
    if user.role != "sales":
        return {
            "available": False, "is_newcomer": False, "completed": [], "xp": 0, "ai_unlocked": True,
            "demo_skip_available": False, "demo_skipped": False, "lessons": [],
        }
    done = completed_ids(session, user)
    is_new = newcomer(session, user)["is_newcomer"]
    skipped = is_new and len(done) < len(LESSONS) and demo_skipped(user)
    return {
        "available": True, "is_newcomer": is_new, "completed": done, "xp": len(done) * XP_PER_LESSON,
        "ai_unlocked": not is_new or len(done) == len(LESSONS) or skipped,
        "demo_skip_available": settings().demo_skip_learning, "demo_skipped": skipped, "lessons": list(LESSONS),
    }


def ai_unlocked(session: Session, user: AppUser) -> bool:
    # 在職超過 30 天的業務、主管與 IT 沿用原本權限。
    return (
        not newcomer(session, user)["is_newcomer"]
        or len(completed_ids(session, user)) == len(LESSONS)
        or demo_skipped(user)
    )


def demo_skip_key(user: AppUser) -> str:
    # 只認這次登入；重新登入的 session_version 不同，不會沿用略過狀態。
    return f"{DEMO_SKIP_PREFIX}{user.id}:{user.session_version}"


def demo_skipped(user: AppUser) -> bool:
    return settings().demo_skip_learning and bool(redis().exists(demo_skip_key(user)))


def skip_for_demo(session: Session, user: AppUser) -> dict[str, Any]:
    if not settings().demo_skip_learning:
        raise LearningError("目前未開放 Demo 跳過課程，請完成新人課程。", 403)
    if user.role != "sales":
        raise LearningError("新人課程是給業務練習的", 403)
    # 暫存 AI 通行狀態，不建立過關紀錄、不發 XP；到期或關閉展示設定即失效。
    redis().set(demo_skip_key(user), "1", ex=settings().jwt_expire_hours * 3600)
    return course(session, user)


def validate_answer(lesson_id: str, answer: dict[str, Any]) -> None:
    if lesson_id not in LESSON_IDS:
        raise LearningError("找不到這個關卡", 404)
    if lesson_id == "customer-v1":
        if answer.get("opened") is not True or answer.get("priority") != "promise":
            raise LearningError("先打開客戶檔案：今天已到期的承諾，要優先處理。")
    elif lesson_id == "product-v1":
        if answer.get("view") != "promotions" or answer.get("sku") != "DEMO-A" or answer.get("quantity") != "12":
            raise LearningError("到促銷頁選示範品項 A：一口付費 10 盒、搭贈 2 盒，總共收到 12 盒。")
    elif lesson_id == "route-v1":
        if answer.get("order") != ["clinic", "pharmacy"]:
            raise LearningError("晨光診所約 09:00、安心藥局約 11:00，先把晨光診所移到第一站。")
    elif lesson_id == "visit-v1":
        if answer.get("reviewed") is not True or answer.get("competitor") != "御松田" or answer.get("intent") != "":
            raise LearningError("核對逐字稿：競品是御松田；客戶沒有說要下單，請清空下單意向。")
    elif answer.get("asked") is not True or answer.get("source_opened") is not True or answer.get("action") != "escalate":
        raise LearningError("先打開答案的出處，再把查無依據的問題轉給主管，別把猜測當成答案。")


def complete(session: Session, user: AppUser, lesson_id: str, answer: dict[str, Any]) -> dict[str, Any]:
    if user.role != "sales":
        raise LearningError("新人課程是給業務練習的", 403)
    if lesson_id not in LESSON_IDS:
        raise LearningError("找不到這個關卡", 404)
    # 同一帳號的提交依序處理，重送不重複給 XP，也不能跳過前面的課。
    session.execute(select(AppUser.id).where(AppUser.id == user.id).with_for_update()).scalar_one()
    done = completed_ids(session, user)
    previous = LESSON_IDS[:LESSON_IDS.index(lesson_id)]
    if any(item not in done for item in previous):
        raise LearningError("先完成前一關，再來練習這一關", 409)
    validate_answer(lesson_id, answer)
    session.execute(insert(LearningCompletion).values(user_id=user.id, lesson_id=lesson_id).on_conflict_do_nothing())
    session.commit()
    return course(session, user)
