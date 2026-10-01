"""即時事件（docs/superpowers/specs/2026-10-01-presence-design.md）：用 Redis 發布／訂閱轉給每一條 WebSocket。

API 與背景工作不在同一個程序，API 之後也可能開到兩個以上，所以不在記憶體裡直接轉，一律經過 Redis。
事件只說「發生了什麼」，不帶內容：連線收到後自己去算這個人該看到什麼（api/presence.py）。

- {"type": "message", "channel_id": 12}：這個頻道有新訊息，commit 之後才發，手機拿得到那一則
- {"type": "presence", "at": 1790000000.5}：有人的狀態變了，每條連線都要新的狀態。at 是 commit 之後取的 time.time()，
  同一個程序裡的連線靠它共用同一次查詢（api/presence.py 的 _StatusCache）
- {"type": "avatars"}：有人換了或移除大頭貼，手機重拿一次網址
- {"type": "channels"}：有人開了、改名或封存文字頻道，或 IT 改了組織（誰看得到哪些頻道可能變了）。
  手機重新載入頻道列表，WebSocket 重算這個人看得到的頻道
"""

import json
import logging
import time

from redis.exceptions import RedisError

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
    # 呼叫的地方都在 commit 之後，這時取的時間之後才開始的查詢一定看得到這次變動
    publish({"type": "presence", "at": time.time()})


def avatars_changed() -> None:
    publish({"type": "avatars"})


def channels_changed() -> None:
    publish({"type": "channels"})
