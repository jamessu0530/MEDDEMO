"""API 入口。"""

from typing import Annotated

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api import asks, customers, mock_systems, products, transcription, visits, voice
from app.db import get_session

app = FastAPI(title="中化裕民業務 AI 助理")
app.include_router(asks.router)
app.include_router(customers.router)
app.include_router(products.router)
app.include_router(visits.router)
app.include_router(mock_systems.router)
app.include_router(voice.router)
app.include_router(transcription.router)


@app.get("/health")
def health(session: Annotated[Session, Depends(get_session)]) -> dict[str, str]:
    """部署流程與監控用：資料庫連得上才回 ok。"""
    session.execute(text("SELECT 1"))
    return {"status": "ok"}
