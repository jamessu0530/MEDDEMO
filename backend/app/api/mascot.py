from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import realtime
from app.api.auth import CurrentUser
from app.db import get_session
from app.services import mascot_collection as service

router = APIRouter(prefix="/api/mascot", tags=["mascot"])
SessionDep = Annotated[Session, Depends(get_session)]


class EquipInput(BaseModel):
    color: str = Field(max_length=40)
    outfit: str = Field(max_length=40)
    use_as_avatar: bool


class EncounterInput(BaseModel):
    event_id: UUID


class AssistantAchievementInput(BaseModel):
    action: Literal["ghost", "new"]


@router.post("/achievements")
def unlock_achievement(session: SessionDep, user: CurrentUser, body: AssistantAchievementInput):
    result = service.unlock_assistant_achievement(session, user, body.action)
    session.commit()
    return result


@router.get("")
def get_collection(session: SessionDep, user: CurrentUser):
    row = service.sync_collection(session, user)
    result = service.snapshot(session, user, row)
    session.commit()
    return result


@router.put("/equip")
def equip(session: SessionDep, user: CurrentUser, body: EquipInput):
    try:
        row = service.equip(session, user, body.color, body.outfit, body.use_as_avatar)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    result = service.snapshot(session, user, row)
    session.commit()
    realtime.avatars_changed()
    return result


@router.post("/encounters")
def encounter(session: SessionDep, user: CurrentUser, body: EncounterInput):
    found, row = service.encounter(session, user, str(body.event_id))
    result = {"color_id": found.color_id, "newly_collected": found.newly_collected, "collection": service.snapshot(session, user, row)}
    session.commit()
    return result
