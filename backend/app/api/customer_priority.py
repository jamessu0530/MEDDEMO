"""主管的客戶優先策略；預覽不寫資料，啟用只影響之後建立的建議。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from google.genai import errors
from sqlalchemy.orm import Session

from app.api.auth import ManagerUser
from app.config import NotConfigured
from app.db import get_session
from app.llm import LLMOutputError
from app.services import customer_priority as service
from app.services import customer_priority_advisor as advisor

router = APIRouter(prefix="/customer-priority", tags=["customer-priority"])
SessionDep = Annotated[Session, Depends(get_session)]


class SaveRequest(BaseModel):
    manager_id: str
    revision: int = Field(ge=0)
    policy: service.Policy


class PreviewRequest(BaseModel):
    manager_id: str
    strategy: service.Strategy


class ApplyRequest(BaseModel):
    manager_id: str
    rep_id: str
    revision: int = Field(ge=0)
    version: int = Field(ge=0)


class AdviceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    manager_id: str
    strategy: advisor.DraftStrategy
    question: str = Field(min_length=1, max_length=600)
    history: list[advisor.Message] = Field(default_factory=list, max_length=8)
    preset: advisor.PresetId | None = None


@router.post("/advice")
def advise_priority(body: AdviceRequest, session: SessionDep, viewer: ManagerUser):
    try:
        manager = service.target_manager(session, viewer, body.manager_id)
        return advisor.advise(session, manager, body.strategy, body.question, body.history, body.preset)
    except service.PriorityError as exc:
        raise HTTPException(exc.status, str(exc)) from None
    except NotConfigured:
        raise HTTPException(503, "熊熊滾的 AI 尚未設定，可以先選一個經營情境取得調整起點。") from None
    except (LLMOutputError, ValueError, errors.APIError):
        raise HTTPException(502, "這次無法整理出可用的建議，請換個說法，或先選一個經營情境。") from None


@router.get("")
def get_priority(session: SessionDep, viewer: ManagerUser, manager_id: str | None = None):
    try:
        return service.settings(session, viewer, manager_id)
    except service.PriorityError as exc:
        raise HTTPException(exc.status, str(exc)) from None


@router.post("/preview")
def preview_priority(body: PreviewRequest, session: SessionDep, viewer: ManagerUser):
    try:
        manager = service.target_manager(session, viewer, body.manager_id)
        return service.preview(session, manager, body.strategy)
    except service.PriorityError as exc:
        raise HTTPException(exc.status, str(exc)) from None


@router.put("")
def save_priority(body: SaveRequest, session: SessionDep, viewer: ManagerUser):
    try:
        manager = service.target_manager(session, viewer, body.manager_id)
        service.save(session, manager, viewer, body.revision, body.policy)
        session.commit()
        return service.settings(session, viewer, manager.id)
    except service.PriorityError as exc:
        raise HTTPException(exc.status, str(exc)) from None


@router.post("/apply-today")
def apply_priority(body: ApplyRequest, session: SessionDep, viewer: ManagerUser):
    try:
        manager = service.target_manager(session, viewer, body.manager_id)
        itinerary = service.apply_today(session, manager, body.rep_id, body.revision, body.version)
        result = {"rep_id": itinerary.user_id, "version": itinerary.version}
        session.commit()
        return result
    except service.PriorityError as exc:
        raise HTTPException(exc.status, str(exc)) from None
