"""錄音時的即時轉錄 API：發一把 Gemini 即時轉錄用的臨時金鑰（FR-4.2）。"""

import dataclasses
import datetime as dt
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from google.genai import errors
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import NotConfigured
from app.db import get_session
from app.services import live_transcription

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/transcription", tags=["transcription"])
SessionDep = Annotated[Session, Depends(get_session)]


class TranscriptionSessionIn(BaseModel):
    customer_id: str | None = None


class TranscriptionSessionOut(BaseModel):
    token: str
    model: str
    api_version: str
    expires_at: dt.datetime
    config: dict[str, Any]


@router.post("/session", response_model=TranscriptionSessionOut)
def start_session(session: SessionDep, body: TranscriptionSessionIn):
    """開始錄音時呼叫。拿不到金鑰時錄音照常進行，只是畫面上沒有即時文字。"""
    try:
        live = live_transcription.create_session(live_transcription.vocabulary(session, body.customer_id))
    except NotConfigured as exc:
        raise HTTPException(503, f"即時轉錄還不能用：{exc}") from exc
    except errors.APIError as exc:
        log.warning("申請 Gemini 即時轉錄的臨時金鑰失敗：%s", exc)
        raise HTTPException(502, f"Gemini 回應錯誤（{exc.code}），請稍後再試") from exc
    return TranscriptionSessionOut(**dataclasses.asdict(live))
