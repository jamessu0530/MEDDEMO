"""登入相關 API（FR-12）。

三種帳號：公司給的八個（灌假資料時建好，用 Email 密碼登入）、自己用 Email 建立的，
以及用 Google／GitHub／Facebook 第一次登入時自動開的。後兩種都是業務，看示範業務的客戶。
註冊與錯誤訊息的寫法照 flutterproject4（同一位作者的專案）。
"""

import datetime as dt
import re
import secrets
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import func, select
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


class ActingAs(BaseModel):
    id: str
    name: str


class UserPublic(BaseModel):
    id: str
    name: str
    role: str
    region: str
    email: str | None
    # 第三方登入開的帳號沒有密碼：畫面上不給改密碼
    has_password: bool
    linked: list[LinkedIdentity] = Field(default_factory=list)
    # 第三方登入開的帳號自己沒有客戶，看的是這位示範業務的資料；畫面上要講清楚
    acting_as: ActingAs | None = None
    # 自己開的帳號才能改名字；公司的八個帳號名字是公司資料，畫面上不給改
    can_rename: bool = False


class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str = Field(min_length=auth.MIN_PASSWORD_LENGTH)


class ProfileUpdate(BaseModel):
    name: str


class LoginRequest(BaseModel):
    # 不用 EmailStr：那會多一個 email-validator 相依，而這裡只是拿去比對資料庫裡的帳號
    email: str
    password: str = Field(min_length=1)


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
    acting = session.get(AppUser, user.acts_as_user_id) if user.acts_as_user_id else None
    return UserPublic(
        id=user.id, name=user.name, role=user.role, region=user.region, email=user.email,
        has_password=bool(user.password_hash),
        linked=[LinkedIdentity(provider=i.provider, email=i.email, linked_at=i.created_at) for i in identities],
        acting_as=ActingAs(id=acting.id, name=acting.name) if acting else None,
        can_rename=_is_self_service(user),
    )


def _is_self_service(user: AppUser) -> bool:
    """自己建立或第三方登入開的帳號（看示範業務的資料）。公司帳號沒有 acts_as_user_id。"""
    return user.acts_as_user_id is not None


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


# 只檢查長得像 Email：真的收不收得到信要寄確認信才知道，這次沒有寄信服務
EMAIL_SHAPE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@router.post("/register", status_code=status.HTTP_201_CREATED, response_model=AuthResponse)
def register(session: SessionDep, body: RegisterRequest):
    """用 Email 建立帳號，建好直接登入。"""
    email = auth.normalize_email(body.email)
    if not EMAIL_SHAPE.match(email):
        raise HTTPException(status_code=422, detail="Email 格式不對")
    try:
        name = auth.validate_name(body.name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    if session.scalar(select(AppUser.id).where(AppUser.email == email)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="這個 Email 已經註冊過，請直接登入")
    # 同一個信箱之前用第三方登入開過帳號：提醒他用那個方式登入，不要再開一個
    external = session.scalar(select(UserIdentity.provider).where(UserIdentity.email == email))
    if external:
        label = oauth.PROVIDER_LABEL[external]
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"這個 Email 是用 {label} 登入開的帳號，請用 {label} 登入"
        )
    user = _new_sales_account(session, name, email=email, password_hash=auth.hash_password(body.password))
    token = auth.start_session(session, user)
    try:
        session.commit()
    except IntegrityError:  # 兩個人同時用同一個 Email 註冊
        session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="這個 Email 已經註冊過，請直接登入") from None
    return AuthResponse(token=token, user=_public(session, user))


@router.post("/login", response_model=AuthResponse)
def login(session: SessionDep, body: LoginRequest):
    try:
        user, token = auth.login(session, body.email, body.password)
    except auth.AuthError as exc:
        if str(exc) == auth.EMAIL_NOT_FOUND:
            # 這個信箱是用第三方登入開的帳號：講清楚要用哪個方式登入，不要只說找不到
            external = session.scalar(
                select(UserIdentity.provider).where(UserIdentity.email == auth.normalize_email(body.email))
            )
            if external:
                label = oauth.PROVIDER_LABEL[external]
                raise _unauthorized(f"這個 Email 是用 {label} 登入開的帳號，請用 {label} 登入") from None
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


@router.patch("/me/profile", response_model=UserPublic)
def update_profile(session: SessionDep, user: CurrentUser, body: ProfileUpdate):
    """改名字（照 flutterproject4 的 PATCH /me/profile）。"""
    if not _is_self_service(user):
        # 自己開的帳號看的都是林昱辰的客戶，公司帳號改了名字，所有人畫面上的示範業務都會跟著變
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="公司帳號的名字由公司設定，不能自己改")
    try:
        user.name = auth.validate_name(body.name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    user.updated_at = func.now()
    session.commit()
    session.refresh(user)
    return _public(session, user)


@router.post("/change-password", response_model=AuthResponse)
def change_password(session: SessionDep, user: CurrentUser, body: ChangePasswordRequest):
    try:
        token = auth.change_password(session, user, body.current_password, body.new_password)
    except auth.AuthError as exc:
        # 不能回 401：人是登入著的，只是密碼打錯。前端看到 401 會當作登入過期把人登出
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None
    session.commit()
    return AuthResponse(token=token, user=_public(session, user))


# ── 第三方登入 ────────────────────────────────────────────────────
#
# 任何人都能用 Google／GitHub／Facebook 登入：第一次登入自動開一個業務帳號（9/16 James 決定，
# 決賽評審用自己的帳號就能試）。自動開的帳號一律是業務，不會是主管；自己沒有客戶，
# 看的是示範業務（auth.EXTERNAL_ACCOUNT_ACTS_AS）的路線與客戶。
# 公司給的 Email 帳號也能到帳號設定綁第三方，之後用它登入就回到那個帳號。

Provider = Literal["google", "github", "facebook"]


class OAuthCredential(BaseModel):
    """三家各自送來的憑證，只填自己那家用的欄位。"""

    credential: str | None = None  # Google：Identity Services 給的 ID token
    code: str | None = None  # GitHub：授權碼
    redirect_uri: str | None = None  # GitHub：換 token 時要跟授權時的一樣
    access_token: str | None = None  # Facebook：Facebook Login 給的 access token


def _verify(provider: Provider, body: OAuthCredential, rejected_status: int = 401) -> oauth.ExternalIdentity:
    """rejected_status：登入時憑證不對是 401；已經登入、在綁定時憑證不對要回 400，
    不然前端會把 401 當成登入過期，把人登出。"""
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
        raise HTTPException(status_code=rejected_status, detail=str(exc)) from None


@router.get("/providers")
def providers() -> dict[str, dict[str, str] | None]:
    """登入頁要顯示哪些第三方按鈕。沒設定的是 null。"""
    return oauth.configured()


def _new_sales_account(session: Session, name: str, email: str | None, password_hash: str | None) -> AppUser:
    """自己建立的帳號與第三方登入自動開的帳號：一律是業務，不會是主管；自己名下沒有客戶，看示範業務的。"""
    demo = session.get(AppUser, auth.EXTERNAL_ACCOUNT_ACTS_AS)
    user = AppUser(
        # 工號格式跟公司帳號（U01、M01）分開，一眼看得出是自己開的
        id=f"X{secrets.token_hex(4).upper()}",
        name=name.strip()[:40],
        role="sales",
        region=demo.region if demo else "",
        email=email,
        password_hash=password_hash,
        acts_as_user_id=demo.id if demo else None,
    )
    session.add(user)
    session.flush()
    return user


def _create_external_account(session: Session, identity: oauth.ExternalIdentity) -> AppUser:
    """第一次用第三方登入：開一個業務帳號並綁上這個第三方身分。"""
    label = oauth.PROVIDER_LABEL[identity.provider]
    name = identity.name or (identity.email.split("@")[0] if identity.email else f"{label} 使用者")
    try:
        name = auth.validate_name(name)
    except ValueError:
        # 第三方給的名字太短、太長或有不當用字：先用預設名字，使用者之後可以在帳號設定改
        name = f"{label} 使用者"
    # 信箱記在 user_identity，不放 app_user.email：同一個人用 Google 和 GitHub 各開一次，信箱一樣會撞到唯一限制
    user = _new_sales_account(session, name, email=None, password_hash=None)
    session.add(UserIdentity(user_id=user.id, provider=identity.provider, subject=identity.subject, email=identity.email))
    session.flush()
    return user


@router.post("/oauth/{provider}/login", response_model=AuthResponse)
def oauth_login(session: SessionDep, provider: Provider, body: OAuthCredential):
    identity = _verify(provider, body)
    bound = session.scalar(
        select(UserIdentity).where(UserIdentity.provider == provider, UserIdentity.subject == identity.subject)
    )
    if bound is None:
        user = _create_external_account(session, identity)
    else:
        user = session.get(AppUser, bound.user_id)
    token = auth.start_session(session, user)
    session.commit()
    return AuthResponse(token=token, user=_public(session, user))


@router.post("/oauth/{provider}/link", response_model=UserPublic)
def oauth_link(session: SessionDep, user: CurrentUser, provider: Provider, body: OAuthCredential):
    identity = _verify(provider, body, rejected_status=status.HTTP_400_BAD_REQUEST)
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
        others = session.scalar(
            select(func.count()).select_from(UserIdentity).where(
                UserIdentity.user_id == user.id, UserIdentity.provider != provider
            )
        )
        # 沒有密碼、也沒有別的第三方可以登入：解除了就永遠進不來
        if not user.password_hash and not others:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="這是這個帳號唯一的登入方式，解除綁定之後就登入不了"
            )
        session.delete(mine)
        session.commit()
    return _public(session, user)

