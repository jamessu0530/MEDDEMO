"""Task planning and validated draft creation for the shared text/voice assistant."""

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from google.genai import errors
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.auth import CurrentAccount, CurrentUser
from app.api.asks import Turn
from app.config import NotConfigured
from app.db import get_session
from app.llm import LLMOutputError
from app.services import assistant_tasks as planner, assistant_task_actions as actions
from app.services import order_workspace, report_library, reports, route_order_tasks
from app.services.assistant_context import PageContext

router = APIRouter(prefix="/api/assistant-tasks", tags=["assistant-tasks"])
SessionDep = Annotated[Session, Depends(get_session)]
log = logging.getLogger(__name__)


class TaskContext(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(min_length=1, max_length=100)
    capability: str = Field(max_length=80)
    title: str = Field(max_length=120)
    instruction: str = Field(max_length=8000)
    status: Literal["pending", "active", "paused", "waiting", "completed", "cancelled", "error"]
    message: str = Field(default="", max_length=8000)


class PlanInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    question: str = Field(min_length=1, max_length=8000)
    tasks: list[TaskContext] = Field(default_factory=list)
    active_id: str | None = Field(default=None, max_length=100)
    page: PageContext | None = None
    earlier: list[Turn] = Field(default_factory=list, max_length=6)


class ExecuteInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    task_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    capability: Literal["report.create", "order.create", "order.route_repeat"]
    instruction: str = Field(min_length=1, max_length=8000)


def action(call):
    try:
        return call()
    except NotConfigured:
        raise HTTPException(503, "AI 任務功能尚未設定，你仍可使用頁面上的報表與開單功能。") from None
    except (order_workspace.OrderError, report_library.LibraryError) as exc:
        raise HTTPException(exc.status, str(exc)) from None
    except reports.OwnerNotAllowed as exc:
        raise HTTPException(403, str(exc)) from None
    except (LLMOutputError, ValueError, errors.APIError):
        log.exception("助理任務未能完成")
        raise HTTPException(502, "這次無法完成任務處理，進度已保留，請再試一次。") from None


@router.post("/plan")
def plan_tasks(body: PlanInput, user: CurrentUser):
    return action(lambda: planner.plan(body.question, tasks=[task.model_dump() for task in body.tasks],
                                     active_id=body.active_id, page=body.page.model_dump() if body.page else None,
                                     earlier=[turn.model_dump(exclude_none=True, exclude_defaults=True) for turn in body.earlier]))


@router.post("/execute")
def execute_task(body: ExecuteInput, session: SessionDep, account: CurrentAccount, user: CurrentUser):
    return action(lambda: actions.execute(session, account, user, body.task_id, body.capability, body.instruction))


class RouteControlInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["step", "pause", "resume", "skip", "retry", "cancel"]
    customer_id: str | None = Field(default=None, max_length=64)


@router.post("/{task_id}/route-orders")
def control_route_orders(task_id: str, body: RouteControlInput, session: SessionDep, account: CurrentAccount, user: CurrentUser):
    return action(lambda: route_order_tasks.control(session, account, user, task_id, body.action, body.customer_id))
