"""登入相關 API（FR-12）。沒有註冊：帳號是公司給的，灌假資料時建好。"""

import datetime as dt
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import AppUser, UserIdentity
from app.services import auth, oauth

router = APIRouter(prefix="/api/auth", tags=["auth"])
SessionDep = Annotated[Session, Depends(get_session)]
# auto_error=False：沒帶 token 時自己回中文訊息，不要 FastAPI 預設的英文
_bearer = HTTPBearer(auto_error=False)


class LinkedIdentity(BaseModel):
    provider: str
    email: str | None
    linked_at: dt.datetime


class UserPublic(BaseModel):
    id: str
    name: str
    role: str
    region: str
    email: str
    linked: list[LinkedIdentity] = Field(default_factory=list)


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


def _public(session: Session, user: AppUser) -> UserPublic:
    identities = session.scalars(
        select(UserIdentity).where(UserIdentity.user_id == user.id).order_by(UserIdentity.provider)
    )
    return UserPublic(
        id=user.id, name=user.name, role=user.role, region=user.region, email=user.email,
        linked=[LinkedIdentity(provider=i.provider, email=i.email, linked_at=i.created_at) for i in identities],
    )


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
    return AuthResponse(token=token, user=_public(session, user))


@router.get("/me", response_model=UserPublic)
def me(session: SessionDep, user: CurrentUser):
    return _public(session, user)


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
    return AuthResponse(token=token, user=_public(session, user))


# ── 第三方登入（綁定制）────────────────────────────────────────────
#
# 帳號是公司給的，第三方登入不會自動開新帳號（flutterproject4 會，那是遊戲；這裡照抄的話，
# 全世界有 Google 帳號的人都能登入變成業務）。要先用 Email 登入、到帳號設定綁定，之後才能用它登入。

Provider = Literal["google", "github", "facebook"]


class OAuthCredential(BaseModel):
    """三家各自送來的憑證，只填自己那家用的欄位。"""

    credential: str | None = None  # Google：Identity Services 給的 ID token
    code: str | None = None  # GitHub：授權碼
    redirect_uri: str | None = None  # GitHub：換 token 時要跟授權時的一樣
    access_token: str | None = None  # Facebook：Facebook Login 給的 access token


def _verify(provider: Provider, body: OAuthCredential) -> oauth.ExternalIdentity:
    missing = HTTPException(status_code=422, detail=f"缺少 {oauth.PROVIDER_LABEL[provider]} 登入的憑證")
    try:
        if provider == "google":
            if not body.credential:
                raise missing
            return oauth.verify_google(body.credential)
        if provider == "github":
            if not (body.code and body.redirect_uri):
                raise missing
            return oauth.verify_github(body.code, body.redirect_uri)
        if not body.access_token:
            raise missing
        return oauth.verify_facebook(body.access_token)
    except oauth.NotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from None
    except oauth.OAuthError as exc:
        raise _unauthorized(str(exc)) from None


@router.get("/providers")
def providers() -> dict[str, dict[str, str] | None]:
    """登入頁要顯示哪些第三方按鈕。沒設定的是 null。"""
    return oauth.configured()


@router.post("/oauth/{provider}/login", response_model=AuthResponse)
def oauth_login(session: SessionDep, provider: Provider, body: OAuthCredential):
    identity = _verify(provider, body)
    bound = session.scalar(
        select(UserIdentity).where(UserIdentity.provider == provider, UserIdentity.subject == identity.subject)
    )
    if bound is None:
        label = oauth.PROVIDER_LABEL[provider]
        raise _unauthorized(f"這個 {label} 帳號還沒綁定，請先用 Email 登入，到「帳號設定」綁定")
    user = session.get(AppUser, bound.user_id)
    token = auth.start_session(session, user)
    session.commit()
    return AuthResponse(token=token, user=_public(session, user))


@router.post("/oauth/{provider}/link", response_model=UserPublic)
def oauth_link(session: SessionDep, user: CurrentUser, provider: Provider, body: OAuthCredential):
    identity = _verify(provider, body)
    label = oauth.PROVIDER_LABEL[provider]
    existing = session.scalar(
        select(UserIdentity).where(UserIdentity.provider == provider, UserIdentity.subject == identity.subject)
    )
    if existing is not None and existing.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"這個 {label} 帳號已經綁在別的帳號上了")
    mine = session.scalar(
        select(UserIdentity).where(UserIdentity.user_id == user.id, UserIdentity.provider == provider)
    )
    if mine is not None and mine.subject != identity.subject:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"你已經綁了另一個 {label} 帳號，要換請先解除綁定"
        )
    if mine is None:
        session.add(UserIdentity(user_id=user.id, provider=provider, subject=identity.subject, email=identity.email))
    else:
        mine.email = identity.email
    try:
        session.commit()
    except IntegrityError:  # 兩個人同時綁同一個第三方帳號
        session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"這個 {label} 帳號已經綁在別的帳號上了") from None
    return _public(session, user)


@router.delete("/oauth/{provider}", response_model=UserPublic)
def oauth_unlink(session: SessionDep, user: CurrentUser, provider: Provider):
    mine = session.scalar(
        select(UserIdentity).where(UserIdentity.user_id == user.id, UserIdentity.provider == provider)
    )
    if mine is not None:
        session.delete(mine)
        session.commit()
    return _public(session, user)

