"""語音問答 API：發一段 Gemini Live 對話用的臨時金鑰。"""

import dataclasses
import datetime as dt
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from google.genai import errors
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.config import NotConfigured, settings
from app.db import get_session
from app.services import voice

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/voice", tags=["voice"])
SessionDep = Annotated[Session, Depends(get_session)]


class VoiceSessionOut(BaseModel):
    token: str
    model: str
    api_version: str
    expires_at: dt.datetime
    config: dict[str, Any]
    tool_kinds: dict[str, str]


@router.post("/session", response_model=VoiceSessionOut)
def start_session(session: SessionDep, user: CurrentUser):
    """開一段語音問答。每次發一把新的臨時金鑰，只能開一段對話；正式的金鑰不會離開伺服器。

    要登入：臨時金鑰會花錢；語音裡查資料走問答 API，也要知道是誰才能照權限過濾。
    """
    # 模型要查資料時走的是問答的反覆查詢與 CRAG；AI 模型沒設定，連上了也什麼都答不了
    if not settings().llm_provider:
        raise HTTPException(503, "語音問答還不能用：AI 模型還沒設定")
    try:
        live = voice.create_session(voice.vocabulary(session))
    except NotConfigured as exc:
        raise HTTPException(503, f"語音問答還不能用：{exc}") from exc
    except errors.APIError as exc:
        log.warning("申請 Gemini 臨時金鑰失敗：%s", exc)
        raise HTTPException(502, f"Gemini 回應錯誤（{exc.code}），請稍後再試") from exc
    return VoiceSessionOut(**dataclasses.asdict(live))
