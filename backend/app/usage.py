"""註冊、頻道發言與換頭像的每小時防洗版限制。

所有外部 API 服務均不設每小時或每日用量額度，也不建立全系統每日計數器。
有登入就按帳號算，沒有才按 IP。計數放在 Redis，非 2xx 回應不計次；Redis 連不上時放行。
"""

import datetime as dt
import logging
import math
import re
from dataclasses import dataclass

from fastapi import Request
from fastapi.responses import JSONResponse
from redis.exceptions import RedisError
from starlette.concurrency import run_in_threadpool

from app.services import auth
from app.tasks import redis

log = logging.getLogger(__name__)
# 台灣沒有日光節約時間，用固定時差，不必依賴映像檔裡有沒有時區資料
TAIPEI = dt.timezone(dt.timedelta(hours=8), "Asia/Taipei")


@dataclass(frozen=True)
class Limit:
    label: str
    per_client_hour: int


# 註冊與社交操作只保留每個來源的短期防洗版限制，不作為外部 API 金鑰額度。
LIMITS: dict[str, Limit] = {
    "register": Limit("建立帳號", per_client_hour=20),
    "channel_post": Limit("頻道發言", per_client_hour=60),
    "avatar": Limit("換大頭貼", per_client_hour=20),
}

ROUTES: list[tuple[str, re.Pattern[str], str]] = [
    ("POST", re.compile(r"/api/auth/register"), "register"),
    ("POST", re.compile(r"/api/channels/\d+/messages"), "channel_post"),
    ("POST", re.compile(r"/api/avatars/me"), "avatar"),
]


@dataclass(frozen=True)
class Counter:
    bucket: str
    key: str
    limit: int
    resets_at: dt.datetime


def buckets_for(method: str, path: str) -> list[str]:
    """這個請求套用的每小時防洗版限制；外部 API 服務不計次。"""
    return [
        bucket
        for m, pattern, bucket in ROUTES
        if m == method and pattern.fullmatch(path)
    ]


def client_address(request: Request) -> str:
    """算在誰頭上。有登入就按帳號，沒有才按 IP。

    決賽現場大家連同一個 Wi-Fi，按 IP 算等於全場共用一份額度；按帳號算，每個人有自己的。
    這裡只從 token 取出是誰、不查資料庫：token 是不是還有效由各個 API 自己擋，
    這裡只需要一個穩定的識別。
    """
    header = request.headers.get("authorization") or ""
    scheme, _, token = header.partition(" ")
    if scheme.lower() == "bearer" and token:
        subject = auth.subject_from_token(token.strip())
        if subject:
            return f"user:{subject}"
    # 正式環境一律經過 Cloudflare（GCP 防火牆只放 Cloudflare 的 IP 進來），CF-Connecting-IP 是它填的真實來源；
    # 本機開發與測試沒有這個標頭，就用連線的位址
    return request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "unknown")


def counters(bucket: str, client: str, now: dt.datetime) -> tuple[Counter]:
    limit = LIMITS[bucket]
    hour = now.astimezone(TAIPEI).replace(minute=0, second=0, microsecond=0)
    return (
        Counter(bucket, f"usage:{bucket}:{client}:{hour:%Y%m%d%H}", limit.per_client_hour, hour + dt.timedelta(hours=1)),
    )


def _take(*items: Counter) -> Counter | None:
    """每個計數器加一；有一個超過上限，就全部減回去，回傳超過的那一個。"""
    pipe = redis().pipeline()
    for item in items:
        pipe.incr(item.key)
        # 時間窗結束後再留一小時才過期，時鐘有點誤差也不會提早清掉
        pipe.expireat(item.key, item.resets_at + dt.timedelta(hours=1))
    counts = pipe.execute()[::2]
    over = next((item for item, count in zip(items, counts, strict=True) if count > item.limit), None)
    if over:
        _give_back(*items)
    return over


def _give_back(*items: Counter) -> None:
    pipe = redis().pipeline()
    for item in items:
        pipe.decr(item.key)
    pipe.execute()


def _too_many(over: Counter, now: dt.datetime) -> JSONResponse:
    label = LIMITS[over.bucket].label
    wait = max(1, math.ceil((over.resets_at - now).total_seconds()))
    detail = f"這一小時的{label}已經 {over.limit} 次，到了上限，請 {math.ceil(wait / 60)} 分鐘後再試。"
    return JSONResponse({"detail": detail}, status_code=429, headers={"Retry-After": str(wait)})


async def limit_usage(request: Request, call_next):
    """HTTP middleware：僅註冊、頻道發言、換頭像套用每小時防洗版限制。"""
    buckets = buckets_for(request.method, request.url.path)
    if not buckets:
        return await call_next(request)
    now = dt.datetime.now(dt.UTC)
    client = client_address(request)
    items = [item for bucket in buckets for item in counters(bucket, client, now)]
    try:
        over = await run_in_threadpool(_take, *items)
    except RedisError:
        log.warning("用量計數連不上 Redis，這次放行", exc_info=True)
        return await call_next(request)
    if over:
        return _too_many(over, now)
    response = await call_next(request)
    if not 200 <= response.status_code < 300:
        try:
            await run_in_threadpool(_give_back, *items)
        except RedisError:
            log.warning("用量計數連不上 Redis，這次沒有減回去", exc_info=True)
    return response
