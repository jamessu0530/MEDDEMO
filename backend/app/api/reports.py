"""個人行動報表、資料預覽，以及 AI 版面提案。"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from google.genai import errors
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.config import NotConfigured
from app.db import get_session
from app.llm import LLMOutputError
from app.services import reports as service
from app.services.reports import Adjustment, ReportConfig, ReportData, ReportOwner

router = APIRouter(prefix="/api/reports", tags=["reports"])
SessionDep = Annotated[Session, Depends(get_session)]
log = logging.getLogger(__name__)


class ReportSettings(BaseModel):
    config: ReportConfig
    templates: dict[str, ReportConfig]
    owners: list[ReportOwner]
    ai_available: bool


class AdjustInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    question: str = Field(min_length=1, max_length=600)
    config: ReportConfig


@router.get("", response_model=ReportSettings)
def get_reports(session: SessionDep, user: CurrentUser):
    return ReportSettings(config=service.get_config(session, user), templates=service.templates(), owners=service.owners(session, user), ai_available=service.ai_available())


@router.put("/config", response_model=ReportConfig)
def save_report_config(session: SessionDep, user: CurrentUser, body: ReportConfig):
    try:
        return service.save_config(session, user, body)
    except service.OwnerNotAllowed as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from None


@router.post("/data", response_model=ReportData)
def report_data(session: SessionDep, user: CurrentUser, body: ReportConfig):
    try:
        return service.data(session, user, body)
    except service.OwnerNotAllowed as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from None


@router.post("/adjust", response_model=Adjustment)
def adjust_report(session: SessionDep, user: CurrentUser, body: AdjustInput):
    try:
        return service.adjust(session, user, body.question, body.config)
    except service.OwnerNotAllowed as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from None
    except NotConfigured:
        raise HTTPException(status_code=503, detail="熊熊滾的 AI 報表調整尚未設定，你可以先手動調整報表。") from None
    except (LLMOutputError, ValueError, errors.APIError):
        log.exception("AI 報表調整失敗")
        raise HTTPException(status_code=502, detail="熊熊滾這次無法完成報表調整，請換個說法或先手動調整。") from None
