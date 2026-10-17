"""API 入口。"""

import logging
from typing import Annotated

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import usage
from app.api import admin, asks, attachments, auth, avatars, channel_search, channels, customers, documents, escalations, first_week, itinerary, manager, memory, methods, mock_systems, oa, preferences, presence, products, promotions, transcription, vehicles, visits, voice
from app.api import maps  # 行程第 4 階段：主管頁的地圖金鑰
from app.api import location  # 行程第 6 階段：即時位置
from app.api import route_habits as route_habits_api
from app.api import notes  # 拜訪備忘與日曆
from app.api import planner  # 一般行程、共享與外部日曆
from app.api import me  # 個人頁
from app.api import reports  # 可自訂的行動報表
from app.api import learning
from app.api import mascot
from app.api import orders as orders_api
from app.config import settings
from app.db import get_session
from app.observability import install_metrics

app = FastAPI(title="中化裕民業務 AI 助理")
if not settings().jwt_secret:
    # 寧可每次重啟就要重新登入，也不要放一把寫死的預設密鑰在公開的 repo 裡
    logging.getLogger(__name__).warning("沒有設定 JWT_SECRET，這次啟動隨機產生一把：重啟之後所有人要重新登入")
# 僅註冊、頻道發言、換頭像保留每小時防洗版限制；外部 API 服務不設用量額度。
app.middleware("http")(usage.limit_usage)
# Wrap the rate limiter as well, so rejected requests are included in metrics.
install_metrics(app)
app.include_router(auth.router)
app.include_router(asks.router)
app.include_router(customers.router)
app.include_router(products.router)
app.include_router(promotions.router)
app.include_router(visits.router)
app.include_router(mock_systems.router)
app.include_router(voice.router)
app.include_router(transcription.router)
app.include_router(escalations.router)
app.include_router(itinerary.router)
app.include_router(route_habits_api.router)
app.include_router(manager.router)
app.include_router(oa.router)
app.include_router(admin.router)
app.include_router(channel_search.router)
app.include_router(channels.router)
app.include_router(attachments.router)
app.include_router(memory.router)
app.include_router(first_week.router)
app.include_router(learning.router)
app.include_router(documents.router)
app.include_router(methods.router)
app.include_router(presence.router)
app.include_router(avatars.router)
app.include_router(maps.router)
app.include_router(location.router)
app.include_router(notes.router)
app.include_router(planner.router)
app.include_router(vehicles.router)
app.include_router(me.router)
app.include_router(mascot.router)
app.include_router(preferences.router)
app.include_router(reports.router)
app.include_router(orders_api.router)


@app.get("/health")
def health(session: Annotated[Session, Depends(get_session)]) -> dict[str, str]:
    """部署流程與監控用：資料庫連得上才回 ok。"""
    session.execute(text("SELECT 1"))
    return {"status": "ok"}
