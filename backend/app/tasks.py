"""背景工作：Redis 連線、RQ 佇列，以及處理進度。

進度是暫時狀態（轉文字中、整理欄位中），只在處理期間有意義，所以放 Redis 並設存活時間，不進資料庫。
"""

from functools import cache

from redis import Redis
from rq import Queue

from app.config import settings

# 進度只給畫面在處理期間顯示用；留一小時足以涵蓋排隊加處理，之後自動清掉
PROGRESS_TTL_SECONDS = 3600


@cache
def redis() -> Redis:
    return Redis.from_url(settings().redis_url)


def visit_queue() -> Queue:
    return Queue("visits", connection=redis())


def set_progress(visit_id: str, stage: str) -> None:
    redis().set(f"visit:{visit_id}:stage", stage, ex=PROGRESS_TTL_SECONDS)


def get_progress(visit_id: str) -> str | None:
    stage = redis().get(f"visit:{visit_id}:stage")
    return stage.decode() if stage else None
