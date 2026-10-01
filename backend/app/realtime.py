"""即時事件（docs/superpowers/specs/2026-10-01-presence-design.md）：用 Redis 發布／訂閱轉給每一條 WebSocket。

API 與背景工作不在同一個程序，API 之後也可能開到兩個以上，所以不在記憶體裡直接轉，一律經過 Redis。
事件只說「發生了什麼」，不帶內容：連線收到後自己去算這個人該看到什麼（api/presence.py）。

- {"type": "message", "channel_id": 12}：這個頻道有新訊息，commit 之後才發，手機拿得到那一則
- {"type": "presence"}：有人的狀態變了，每條連線重算一次
- {"type": "avatars"}：有人換了或移除大頭貼，手機重拿一次網址
- {"type": "location", "user_id": "U01"}：這位業務的位置或分享狀態變了，只送給看得到他的主管與 IT
- {"type": "itinerary", "user_id": "U01"}：這位業務今天的行程變了（改了順序、跑完一站…），同上
"""

import json
import logging

from redis.exceptions import RedisError
from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app.models import Itinerary, Visit
from app.tasks import redis

log = logging.getLogger(__name__)


def events_channel() -> str:
    # 發布／訂閱不分 Redis 的庫號，名稱帶上庫號：兩份測試各用一個庫時，才不會收到對方的事件
    db = redis().connection_pool.connection_kwargs.get("db", 0)
    return f"meddemo:events:{db}"


def publish(event: dict) -> None:
    """發不出去只記 log，不讓發言、選狀態跟著失敗：手機連線時每 30 秒還是會輪詢一次。"""
    try:
        redis().publish(events_channel(), json.dumps(event))
    except RedisError:
        log.warning("即時事件沒有發出去：%s", event, exc_info=True)


def message_posted(channel_id: int) -> None:
    publish({"type": "message", "channel_id": channel_id})


def presence_changed() -> None:
    publish({"type": "presence"})


def avatars_changed() -> None:
    publish({"type": "avatars"})


def location_changed(user_id: str) -> None:
    publish({"type": "location", "user_id": user_id})


def itinerary_changed(user_id: str) -> None:
    publish({"type": "itinerary", "user_id": user_id})


# 行程變了就通知主管頁（{"type": "itinerary"}）。行程的每一種改動都會改 Itinerary（加版本），所以看這張表就夠，
# 加上確認拜訪（跑完一站）；不必每一支 API 各自記得發。事件在 commit 之後才發：沒 commit 的改動別人讀不到，
# 先通知只會讓主管頁拿到舊的那份。整批 DELETE（IT 重置示範業務的行程）看不到，由那支 API 自己發
_PENDING = "realtime:itinerary_changed"


@event.listens_for(Session, "after_flush")
def _collect_itinerary_changes(session: Session, flush_context) -> None:
    reps = session.info.setdefault(_PENDING, set())
    for obj in (*session.new, *session.dirty, *session.deleted):
        if isinstance(obj, Itinerary) and (obj in session.new or obj in session.deleted or session.is_modified(obj)):
            reps.add(obj.user_id)
        elif (
            isinstance(obj, Visit) and obj.confirmed_at is not None
            and inspect(obj).attrs.confirmed_at.history.has_changes()
        ):
            reps.add(obj.user_id)


@event.listens_for(Session, "after_commit")
def _announce_itinerary_changes(session: Session) -> None:
    for user_id in session.info.pop(_PENDING, set()):
        itinerary_changed(user_id)


@event.listens_for(Session, "after_rollback")
def _forget_itinerary_changes(session: Session) -> None:
    session.info.pop(_PENDING, None)
