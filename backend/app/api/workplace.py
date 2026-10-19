"""個人主頁的公司打卡與工作目標；團隊只看打卡狀態，不追蹤位置。"""

import datetime as dt
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import or_, select, text
from sqlalchemy.orm import Session

from app.api.auth import CurrentAccount, CurrentUser, ItUser
from app.db import get_session
from app.models import AppUser, AttendanceEvent, WorkGoal
from app.services.auth import role_data_user
from app.timeutil import TAIPEI

router = APIRouter(prefix="/api/workplace", tags=["workplace"])
SessionDep = Annotated[Session, Depends(get_session)]


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


class PunchBody(BaseModel):
    direction: Literal["in", "out"]
    request_id: uuid.UUID


class GoalBody(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=120)
    note: str = Field(default="", max_length=1000)
    due_date: dt.date | None = None
    progress: int = Field(default=0, ge=0, le=100, strict=True)


class ImportEvent(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    external_id: str = Field(min_length=1, max_length=160)
    user_id: str = Field(min_length=1, max_length=80)
    direction: Literal["in", "out"]
    occurred_at: AwareDatetime

    @field_validator("occurred_at")
    @classmethod
    def not_future(cls, value: dt.datetime) -> dt.datetime:
        if value > utc_now():
            raise ValueError("打卡時間不能在未來")
        return value


class ImportBody(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    source: str = Field(min_length=1, max_length=80)
    events: list[ImportEvent] = Field(min_length=1, max_length=1000)

    @field_validator("source")
    @classmethod
    def external_source(cls, value: str) -> str:
        if value == "personal":
            raise ValueError("外部來源不能使用 personal")
        return value


def event_data(event: AttendanceEvent) -> dict:
    return {"id": event.id, "direction": event.direction, "occurred_at": event.occurred_at.isoformat(), "source": event.source}


def goal_data(goal: WorkGoal) -> dict:
    return {"id": goal.id, "title": goal.title, "note": goal.note, "due_date": goal.due_date.isoformat() if goal.due_date else None, "progress": goal.progress}


def day_events(session: Session, user_ids: list[str], now: dt.datetime) -> list[AttendanceEvent]:
    start = dt.datetime.combine(now.astimezone(TAIPEI).date(), dt.time.min, TAIPEI)
    return list(session.scalars(select(AttendanceEvent).where(
        AttendanceEvent.user_id.in_(user_ids), AttendanceEvent.occurred_at >= start, AttendanceEvent.occurred_at <= now,
    ).order_by(AttendanceEvent.occurred_at.desc(), AttendanceEvent.direction.desc(), AttendanceEvent.id.desc())))


@router.get("")
def overview(session: SessionDep, user: CurrentUser, account: CurrentAccount, response: Response):
    response.headers["Cache-Control"] = "no-store"
    now = utc_now()
    scope = role_data_user(user)
    query = select(AppUser).where(AppUser.deactivated_at.is_(None))
    if user.role == "it":
        query = query.where(or_(AppUser.org_path.is_not(None), AppUser.id == account.id))
    elif user.role == "manager":
        query = query.where(or_(AppUser.manager_id == scope.id, AppUser.id == account.id))
    else:
        query = query.where(AppUser.id == account.id)
    people = list(session.scalars(query.order_by(AppUser.name, AppUser.id)))
    events = day_events(session, [person.id for person in people], now)
    latest: dict[str, AttendanceEvent] = {}
    for event in events:
        latest.setdefault(event.user_id, event)
    members = [{
        "id": person.id, "name": person.name, "region": person.region,
        "status": ("in_company" if latest[person.id].direction == "in" else "left_company") if person.id in latest else "no_record",
        "latest_event": event_data(latest[person.id]) if person.id in latest else None,
    } for person in people]
    goals = session.scalars(select(WorkGoal).where(WorkGoal.user_id == account.id).order_by(WorkGoal.created_at.desc(), WorkGoal.id))
    return {
        "date": now.astimezone(TAIPEI).date().isoformat(), "as_of": now.isoformat(), "user_id": account.id,
        "members": members, "events": [event_data(event) for event in events if event.user_id == account.id],
        "goals": [goal_data(goal) for goal in goals],
    }


@router.post("/punch")
def punch(session: SessionDep, account: CurrentAccount, body: PunchBody):
    session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"attendance:{account.id}"})
    external_id = f"{account.id}:{body.request_id}"
    existing = session.scalar(select(AttendanceEvent).where(AttendanceEvent.source == "personal", AttendanceEvent.external_id == external_id))
    if existing:
        if existing.direction != body.direction:
            raise HTTPException(409, "這個打卡編號已用於另一筆紀錄，請重新整理")
        return event_data(existing)
    now = utc_now()
    today = day_events(session, [account.id], now)
    if today and today[0].direction == body.direction:
        return event_data(today[0])
    event = AttendanceEvent(id=str(uuid.uuid4()), user_id=account.id, direction=body.direction, occurred_at=now, source="personal", external_id=external_id, recorded_by=account.id)
    session.add(event)
    session.commit()
    return event_data(event)


@router.post("/events")
def import_events(session: SessionDep, user: ItUser, body: ImportBody):
    """既有系統接入；IT 帶登入 token，外部事件編號重送不重複寫入。"""
    session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"attendance-source:{body.source}"})
    ids = {event.user_id for event in body.events}
    known = set(session.scalars(select(AppUser.id).where(AppUser.id.in_(ids))))
    if ids - known:
        raise HTTPException(422, f"找不到工號：{'、'.join(sorted(ids - known))}")
    inserted = skipped = 0
    for item in body.events:
        existing = session.scalar(select(AttendanceEvent).where(AttendanceEvent.source == body.source, AttendanceEvent.external_id == item.external_id))
        if existing:
            if (existing.user_id, existing.direction, existing.occurred_at) != (item.user_id, item.direction, item.occurred_at):
                raise HTTPException(409, f"打卡編號 {item.external_id} 與已存紀錄不同，整批未匯入")
            skipped += 1
            continue
        session.add(AttendanceEvent(id=str(uuid.uuid4()), source=body.source, recorded_by=user.id, **item.model_dump()))
        session.flush()
        inserted += 1
    session.commit()
    return {"inserted": inserted, "skipped": skipped}


@router.post("/goals", status_code=201)
def create_goal(session: SessionDep, account: CurrentAccount, body: GoalBody):
    goal = WorkGoal(id=str(uuid.uuid4()), user_id=account.id, **body.model_dump())
    session.add(goal)
    session.commit()
    return goal_data(goal)


def own_goal(session: Session, user_id: str, goal_id: str) -> WorkGoal:
    goal = session.scalar(select(WorkGoal).where(WorkGoal.id == goal_id, WorkGoal.user_id == user_id))
    if goal is None:
        raise HTTPException(404, "找不到這個目標")
    return goal


@router.put("/goals/{goal_id}")
def update_goal(session: SessionDep, account: CurrentAccount, goal_id: str, body: GoalBody):
    goal = own_goal(session, account.id, goal_id)
    for key, value in body.model_dump().items():
        setattr(goal, key, value)
    session.commit()
    return goal_data(goal)


@router.delete("/goals/{goal_id}", status_code=204)
def delete_goal(session: SessionDep, account: CurrentAccount, goal_id: str):
    session.delete(own_goal(session, account.id, goal_id))
    session.commit()
    return Response(status_code=204)
