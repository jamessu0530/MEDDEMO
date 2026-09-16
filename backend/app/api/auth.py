"""登入相關 API（FR-12）。沒有註冊：帳號是公司給的，灌假資料時建好。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import AppUser
from app.services import auth

router = APIRouter(prefix="/api/auth", tags=["auth"])
SessionDep = Annotated[Session, Depends(get_session)]
# auto_error=False：沒帶 token 時自己回中文訊息，不要 FastAPI 預設的英文
_bearer = HTTPBearer(auto_error=False)


class UserPublic(BaseModel):
    id: str
    name: str
    role: str
    region: str
    email: str


class LoginRequest(BaseModel):
    # 不用 EmailStr：那會多一個 email-validator 相依，而這裡只是拿去比對資料庫裡的帳號
    email: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=auth.MIN_PASSWORD_LENGTH)


class AuthResponse(BaseModel):
    token: str
    user: UserPublic


def _unauthorized(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=message)


def current_user(
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> AppUser:
    """每個要認人的 API 都掛這個。"""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized("請先登入")
    try:
        return auth.user_from_token(session, credentials.credentials)
    except auth.AuthError as exc:
        raise _unauthorized(str(exc)) from None


CurrentUser = Annotated[AppUser, Depends(current_user)]


def manager_only(user: CurrentUser) -> AppUser:
    if user.role != "manager":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="這個頁面只有主管看得到")
    return user


ManagerUser = Annotated[AppUser, Depends(manager_only)]


@router.post("/login", response_model=AuthResponse)
def login(session: SessionDep, body: LoginRequest):
    try:
        user, token = auth.login(session, body.email, body.password)
    except auth.AuthError as exc:
        raise _unauthorized(str(exc)) from None
    session.commit()
    return AuthResponse(token=token, user=UserPublic.model_validate(user, from_attributes=True))


@router.get("/me", response_model=UserPublic)
def me(user: CurrentUser):
    return UserPublic.model_validate(user, from_attributes=True)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(session: SessionDep, user: CurrentUser):
    auth.logout(session, user)
    session.commit()


@router.post("/change-password", response_model=AuthResponse)
def change_password(session: SessionDep, user: CurrentUser, body: ChangePasswordRequest):
    try:
        token = auth.change_password(session, user, body.current_password, body.new_password)
    except auth.AuthError as exc:
        raise _unauthorized(str(exc)) from None
    session.commit()
    return AuthResponse(token=token, user=UserPublic.model_validate(user, from_attributes=True))
