"""API 入口。"""

import logging
from typing import Annotated

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import usage
from app.api import asks, auth, customers, escalations, manager, mock_systems, products, route, transcription, visits, voice
from app.config import settings
from app.db import get_session

app = FastAPI(title="中化裕民業務 AI 助理")
if not settings().jwt_secret:
    # 寧可每次重啟就要重新登入，也不要放一把寫死的預設密鑰在公開的 repo 裡
    logging.getLogger(__name__).warning("沒有設定 JWT_SECRET，這次啟動隨機產生一把：重啟之後所有人要重新登入")
# 會呼叫 Gemini 的入口都有用量上限（第六週）：有登入就按帳號算，沒登入的入口按 IP 算
app.middleware("http")(usage.limit_usage)
app.include_router(auth.router)
app.include_router(asks.router)
app.include_router(customers.router)
app.include_router(products.router)
app.include_router(visits.router)
app.include_router(mock_systems.router)
app.include_router(voice.router)
app.include_router(transcription.router)
app.include_router(escalations.router)
app.include_router(route.router)
app.include_router(manager.router)


@app.get("/health")
def health(session: Annotated[Session, Depends(get_session)]) -> dict[str, str]:
    """部署流程與監控用：資料庫連得上才回 ok。"""
    session.execute(text("SELECT 1"))
    return {"status": "ok"}
