"""組織管理 API（只有 IT）。規則都在 services/org_admin.py，這裡只負責收參數、提交或回滾。

每個寫入操作都回傳更新後的整張組織圖：一個操作可能連帶動到好幾個人（主管調區，底下的人
轄區跟著變），前端直接換掉整份資料，不必自己推算哪些人跟著變了。
"""

import datetime as dt
from collections.abc import Callable
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import realtime
from app.api.auth import ItUser
from app.db import get_session
from app.services import org_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])
SessionDep = Annotated[Session, Depends(get_session)]
AssignableRole = Literal["sales", "manager"]


class Unit(BaseModel):
    id: str
    name: str
    kind: str
    parent_id: str | None


class Member(BaseModel):
    id: str
    name: str
    role: str
    region: str
    email: str | None
    manager_id: str | None
    unit_id: str | None
    active: bool
    customer_count: int


class LogEntry(BaseModel):
    id: int
    actor_name: str
    detail: str
    created_at: dt.datetime


class OrgChart(BaseModel):
    units: list[Unit]
    users: list[Member]
    log: list[LogEntry]


class NewUser(BaseModel):
    name: str
    email: str
    # 長度由 services/org_admin.py 檢查，錯誤訊息才是中文
    password: str
    role: AssignableRole
    manager_id: str | None = None
    unit_id: str | None = None


class ManagerChange(BaseModel):
    manager_id: str


class UnitChange(BaseModel):
    unit_id: str


class RoleChange(BaseModel):
    role: AssignableRole
    manager_id: str | None = None
    unit_id: str | None = None
    successor_id: str | None = None


class Deactivation(BaseModel):
    successor_id: str | None = None


class OwnerChange(BaseModel):
    owner_id: str


def _apply(session: Session, change: Callable[[], object]) -> OrgChart:
    try:
        change()
        session.commit()
    except org_admin.NotFound as exc:
        session.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from None
    except org_admin.OrgError as exc:
        session.rollback()
        raise HTTPException(422, str(exc)) from None
    except IntegrityError:  # 兩個人同時開了同一個 Email 的帳號
        session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "有人同時改了同一筆資料，請重新整理後再試一次") from None
    # commit 之後才通知：組織一改，誰看得到哪些頻道可能就變了（調區、換主管、降職封存小組頻道、客戶換人）。
    # 手機重新載入頻道列表，WebSocket 也重算看得到的頻道，不再通知已經看不到的頻道（api/presence.py）
    realtime.channels_changed()
    return OrgChart(**org_admin.chart(session))


@router.get("/org", response_model=OrgChart)
def get_org(session: SessionDep, _: ItUser):
    return OrgChart(**org_admin.chart(session))


@router.post("/users", response_model=OrgChart, status_code=status.HTTP_201_CREATED)
def create_user(session: SessionDep, actor: ItUser, body: NewUser):
    return _apply(session, lambda: org_admin.create_user(session, actor, **body.model_dump()))


@router.put("/users/{user_id}/manager", response_model=OrgChart)
def change_manager(session: SessionDep, actor: ItUser, user_id: str, body: ManagerChange):
    return _apply(session, lambda: org_admin.change_manager(session, actor, user_id, body.manager_id))


@router.put("/users/{user_id}/unit", response_model=OrgChart)
def move_manager(session: SessionDep, actor: ItUser, user_id: str, body: UnitChange):
    return _apply(session, lambda: org_admin.move_manager(session, actor, user_id, body.unit_id))


@router.put("/users/{user_id}/role", response_model=OrgChart)
def change_role(session: SessionDep, actor: ItUser, user_id: str, body: RoleChange):
    return _apply(session, lambda: org_admin.change_role(session, actor, user_id, **body.model_dump()))


@router.post("/users/{user_id}/deactivate", response_model=OrgChart)
def deactivate(session: SessionDep, actor: ItUser, user_id: str, body: Deactivation):
    return _apply(session, lambda: org_admin.deactivate(session, actor, user_id, body.successor_id))


@router.post("/users/{user_id}/reactivate", response_model=OrgChart)
def reactivate(session: SessionDep, actor: ItUser, user_id: str):
    return _apply(session, lambda: org_admin.reactivate(session, actor, user_id))


@router.put("/customers/{customer_id}/owner", response_model=OrgChart)
def reassign_customer(session: SessionDep, actor: ItUser, customer_id: str, body: OwnerChange):
    return _apply(session, lambda: org_admin.reassign_customer(session, actor, customer_id, body.owner_id))
