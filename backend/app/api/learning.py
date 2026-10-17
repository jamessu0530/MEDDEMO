"""選修課程的讀取與答案核對；AI 問答不受課程進度限制。"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.db import get_session
from app.services import learning
from app.services import product_learning

router = APIRouter(prefix="/api/first-week", tags=["first-week"])
SessionDep = Annotated[Session, Depends(get_session)]


class Lesson(BaseModel):
    id: str
    title: str
    description: str
    skill: str
    minutes: int


class Course(BaseModel):
    available: bool
    is_newcomer: bool
    completed: list[str]
    xp: int
    ai_unlocked: bool
    demo_skip_available: bool
    demo_skipped: bool
    lessons: list[Lesson]


class Submission(BaseModel):
    answer: dict[str, Any] = Field(max_length=8)


@router.get("/course", response_model=Course)
def get_course(session: SessionDep, user: CurrentUser):
    return learning.course(session, user)


@router.post("/course/{lesson_id}/complete", response_model=Course)
def complete_lesson(session: SessionDep, user: CurrentUser, lesson_id: str, body: Submission):
    try:
        return learning.complete(session, user, lesson_id, body.answer)
    except learning.LearningError as exc:
        raise HTTPException(exc.status, str(exc)) from None


@router.post("/course/demo-skip", response_model=Course)
def skip_course_for_demo(session: SessionDep, user: CurrentUser):
    try:
        return learning.skip_for_demo(session, user)
    except learning.LearningError as exc:
        raise HTTPException(exc.status, str(exc)) from None


class ProductSubmission(BaseModel):
    answers: dict[str, str] = Field(max_length=3)


@router.get("/product-courses")
def get_product_courses(session: SessionDep, user: CurrentUser):
    try:
        return product_learning.courses(session, user)
    except learning.LearningError as exc:
        raise HTTPException(exc.status, str(exc)) from None


@router.get("/product-courses/{kind}/{tier}")
def get_product_lesson(session: SessionDep, user: CurrentUser, kind: str, tier: int):
    try:
        return product_learning.lesson(session, user, kind, tier)
    except learning.LearningError as exc:
        raise HTTPException(exc.status, str(exc)) from None


@router.post("/product-courses/{kind}/{tier}/complete")
def complete_product_lesson(session: SessionDep, user: CurrentUser, kind: str, tier: int, body: ProductSubmission):
    try:
        return product_learning.complete(session, user, kind, tier, body.answers)
    except learning.LearningError as exc:
        raise HTTPException(exc.status, str(exc)) from None
