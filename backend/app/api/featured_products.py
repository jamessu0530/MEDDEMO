"""經理指定節慶主推品項；主管只設定自己的團隊，IT 可協助各團隊。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.auth import ManagerUser
from app.db import get_session
from app.services import featured_products as service

router = APIRouter(prefix="/featured-products", tags=["featured-products"])
SessionDep = Annotated[Session, Depends(get_session)]


@router.get("")
def get_featured_products(session: SessionDep, viewer: ManagerUser, manager_id: str | None = None, festival_id: str | None = None):
    try:
        return service.settings(session, viewer, manager_id, festival_id)
    except service.FeaturedError as exc:
        raise HTTPException(exc.status, str(exc)) from None


@router.put("")
def save_featured_products(body: service.Selection, session: SessionDep, viewer: ManagerUser):
    try:
        result = service.save(session, viewer, body)
        session.commit()
        return result
    except service.FeaturedError as exc:
        raise HTTPException(exc.status, str(exc)) from None
