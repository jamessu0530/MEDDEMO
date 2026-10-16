"""訂單清單、草稿、產品選擇與送出。"""

from typing import Annotated, Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from app.api.auth import CurrentUser
from app.db import get_session
from app.services import order_workspace as service

router = APIRouter(prefix="/api/orders", tags=["orders"])
SessionDep = Annotated[Session, Depends(get_session)]


def action(call):
    try:
        return call()
    except service.OrderError as error:
        raise HTTPException(error.status, str(error)) from None


@router.get("")
def list_orders(session: SessionDep, user: CurrentUser, q: str = Query(default="", max_length=100),
    status: Literal["all", "draft", "effective"] = "all", page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100), sort: Literal["updated_desc", "amount_desc", "shipping_desc"] = "updated_desc"):
    return action(lambda: service.list_orders(session, user, q.strip(), status, page, page_size, sort))


@router.get("/customers")
def order_customers(session: SessionDep, user: CurrentUser):
    return service.customers(session, user)


@router.get("/products")
def order_products(session: SessionDep, user: CurrentUser, customer_id: str, q: str = Query(default="", max_length=100), page: int = Query(default=1, ge=1)):
    return action(lambda: service.catalog(session, user, customer_id, q.strip(), page))


@router.post("", status_code=201)
def create_order(session: SessionDep, user: CurrentUser, body: service.OrderInput):
    return action(lambda: service.create(session, user, body))


@router.get("/{order_id}")
def get_order(session: SessionDep, user: CurrentUser, order_id: str):
    return action(lambda: service.detail(session, user, order_id))


@router.put("/{order_id}")
def save_order(session: SessionDep, user: CurrentUser, order_id: str, body: service.SaveInput):
    return action(lambda: service.save(session, user, order_id, body))


class SubmitInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=1, strict=True)


@router.post("/{order_id}/submit")
def submit_order(session: SessionDep, user: CurrentUser, order_id: str, body: SubmitInput):
    return action(lambda: service.submit(session, user, order_id, body.revision))
