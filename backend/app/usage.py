"""用量上限（第六週）：會呼叫 Gemini 的入口都限次數，免得額度被用光。

兩層上限：
- 每個來源每小時：擋單一裝置或程式一直送。有登入就按帳號算，沒有才按 IP
  （決賽現場大家連同一個 Wi-Fi，按 IP 算等於全場共用一份額度）。
  取全系統每天的四分之一，一個來源至少要四個小時才用得完一天的量，其他人還有時間用。
- 全系統每天（台北時間午夜重算）：就算有人換很多 IP，一天最多也只花到這個量。

計數放在 Redis，用固定的時間窗。請求進來先加一，超過上限就減回去並回 429；
回應不是 2xx（例如欄位驗證失敗、Gemini 還沒設定）也減回去，只算真的有做事的請求。
Redis 連不上時放行，只記 log：問答與錄音整理本來就要靠 Redis 排背景工作，Redis 停了也花不到錢。
"""

import datetime as dt
import logging
import math
import re
from dataclasses import dataclass
from typing import Literal

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
    per_day: int


# 全系統每天的量，是決賽當天估計用量的約兩倍（推估：排練、簡報，加上約 10 位評審試用，
# 提問約 100 題、語音問答約 20 次、錄音約 30 段）。四項每天都被用滿，照 2026-09-14 的官方價格
# 推估 Gemini 最多約 US$35，大部分來自語音問答（一段最長 15 分鐘）；逐項算法寫在 README「用量上限」。
# 知識查詢另外用到 Cohere 精排（每題 1～2 次）與 Firecrawl 網搜（要上網的題目每題 1～3 次）：
# 200 題全部上網的最壞情況，一天約 400 次 Cohere、600 次 Firecrawl 搜尋，各自的額度看方案。
LIMITS: dict[str, Limit] = {
    "ask": Limit("提問", per_client_hour=50, per_day=200),
    "voice": Limit("語音問答", per_client_hour=10, per_day=40),
    "transcription": Limit("錄音時的即時文字", per_client_hour=15, per_day=60),
    "visit": Limit("錄音整理", per_client_hour=15, per_day=60),
}

# 會呼叫 Gemini 的入口。提問與錄音整理在背景工作裡呼叫，這裡擋的是把工作排進去的請求；
# 語音問答與即時文字由手機直連 Gemini，這裡擋的是發臨時金鑰
ROUTES: list[tuple[str, re.Pattern[str], str]] = [
    ("POST", re.compile(r"/api/asks"), "ask"),
    ("POST", re.compile(r"/api/voice/session"), "voice"),
    ("POST", re.compile(r"/api/transcription/session"), "transcription"),
    ("POST", re.compile(r"/api/visits/audio"), "visit"),
    ("POST", re.compile(r"/api/visits/[^/]+/(?:transcript|reprocess)"), "visit"),
]


@dataclass(frozen=True)
class Counter:
    key: str
    limit: int
    resets_at: dt.datetime
    scope: Literal["client", "system"]


def bucket_for(method: str, path: str) -> str | None:
    """這個請求會不會呼叫 Gemini；會的話算在哪一項。"""
    return next((bucket for m, pattern, bucket in ROUTES if m == method and pattern.fullmatch(path)), None)


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


def counters(bucket: str, client: str, now: dt.datetime) -> tuple[Counter, Counter]:
    limit = LIMITS[bucket]
    hour = now.astimezone(TAIPEI).replace(minute=0, second=0, microsecond=0)
    day = hour.replace(hour=0)
    return (
        Counter(f"usage:{bucket}:{client}:{hour:%Y%m%d%H}", limit.per_client_hour, hour + dt.timedelta(hours=1), "client"),
        Counter(f"usage:{bucket}:all:{day:%Y%m%d}", limit.per_day, day + dt.timedelta(days=1), "system"),
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


def _too_many(bucket: str, over: Counter, now: dt.datetime) -> JSONResponse:
    label = LIMITS[bucket].label
    wait = max(1, math.ceil((over.resets_at - now).total_seconds()))
    if over.scope == "client":
        detail = f"這個網路這一小時的{label}已經 {over.limit} 次，到了上限，請 {math.ceil(wait / 60)} 分鐘後再試。"
    else:
        detail = f"今天全系統的{label}已經 {over.limit} 次，到了上限，明天再試。"
    return JSONResponse({"detail": detail}, status_code=429, headers={"Retry-After": str(wait)})


async def limit_usage(request: Request, call_next):
    """HTTP middleware：會呼叫 Gemini 的請求先檢查用量上限。"""
    bucket = bucket_for(request.method, request.url.path)
    if bucket is None:
        return await call_next(request)
    now = dt.datetime.now(dt.UTC)
    items = counters(bucket, client_address(request), now)
    try:
        over = await run_in_threadpool(_take, *items)
    except RedisError:
        log.warning("用量計數連不上 Redis，這次放行", exc_info=True)
        return await call_next(request)
    if over:
        return _too_many(bucket, over, now)
    response = await call_next(request)
    if not 200 <= response.status_code < 300:
        try:
            await run_in_threadpool(_give_back, *items)
        except RedisError:
            log.warning("用量計數連不上 Redis，這次沒有減回去", exc_info=True)
    return response
