"""Email 密碼登入（FR-12）。

密碼用 bcrypt 存雜湊，登入發一張 JWT。做法照著同一位作者在 flutterproject4 寫的那套：
token 裡除了帳號還帶 sessionVersion，每次登入把資料庫的版號加一，每個請求比對兩邊。
版號對不上就是這個帳號已經在別的裝置登入，舊 token 立刻失效，不必另外維護一張作廢清單。

公司給的八個帳號在灌假資料時建好，用 Email 登入；另外任何人都能用 Google／GitHub／Facebook 登入，
第一次登入自動開一個業務帳號（見 api/auth.py 的 oauth_login）。
"""

from __future__ import annotations

import datetime as dt
import secrets

import bcrypt
import jwt
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AppUser

ALGORITHM = "HS256"
# 密碼最短長度。NIST SP 800-63B 建議至少 8 碼，且不要強制混大小寫與符號
MIN_PASSWORD_LENGTH = 8

TOKEN_EXPIRED = "登入已過期，請重新登入"
SESSION_SUPERSEDED = "帳號已在其他裝置登入，請重新登入"
EMAIL_NOT_FOUND = "找不到這個 Email，請確認是不是公司給的帳號"
WRONG_PASSWORD = "密碼錯誤，請再試一次"
WRONG_CURRENT_PASSWORD = "目前的密碼不對"
NO_PASSWORD = "這個帳號是用第三方登入開的，沒有密碼可以改"

# 第三方登入自動開的帳號看誰的客戶與路線。新帳號自己名下沒有客戶，今日路線會是空的；
# 決賽評審用自己的 Google 登入，要能馬上試完整流程（9/16 James 決定）
EXTERNAL_ACCOUNT_ACTS_AS = "U01"

# 沒設定 JWT_SECRET 時，這支程式自己產生一把；重開之後大家要重新登入。
# 不給寫死的預設值：預設值一旦進了公開的 repo，等於誰都能自己簽一張通行證
_fallback_secret = secrets.token_urlsafe(48)


class AuthError(Exception):
    """登入或驗證失敗，訊息是要直接顯示給使用者看的中文。"""


def _secret() -> str:
    return settings().jwt_secret or _fallback_secret


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str | None) -> bool:
    # 第三方登入開的帳號沒有密碼；空白密碼就算資料庫裡剛好也是空白的雜湊，也不准通過
    if not hashed or not plain:
        return False
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except ValueError:  # 資料庫裡不是 bcrypt 格式（例如還沒設密碼）
        return False


def create_token(user: AppUser) -> str:
    expire = dt.datetime.now(dt.UTC) + dt.timedelta(hours=settings().jwt_expire_hours)
    payload = {"sub": user.id, "sv": user.session_version, "exp": expire}
    return jwt.encode(payload, _secret(), algorithm=ALGORITHM)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def login(session: Session, email: str, password: str) -> tuple[AppUser, str]:
    """驗密碼、把 session 版號加一（踢掉別的裝置）、回傳使用者與新 token。"""
    user = session.scalar(select(AppUser).where(AppUser.email == normalize_email(email)))
    if user is None:
        raise AuthError(EMAIL_NOT_FOUND)
    if not verify_password(password, user.password_hash):
        raise AuthError(WRONG_PASSWORD)
    return user, start_session(session, user)


def start_session(session: Session, user: AppUser) -> str:
    """版號加一（別的裝置上的登入隨之失效），發一張新 token。Email 與第三方登入共用。"""
    user.session_version += 1
    user.updated_at = func.now()
    session.flush()
    session.refresh(user)
    return create_token(user)


def user_from_token(session: Session, token: str) -> AppUser:
    try:
        claims = jwt.decode(token, _secret(), algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise AuthError(TOKEN_EXPIRED) from None
    except jwt.PyJWTError:
        raise AuthError(TOKEN_EXPIRED) from None
    user = session.get(AppUser, claims.get("sub"))
    if user is None:
        raise AuthError(TOKEN_EXPIRED)
    if int(claims.get("sv", -1)) != user.session_version:
        raise AuthError(SESSION_SUPERSEDED)
    return user


def subject_from_token(token: str) -> str | None:
    """只從 token 取出是誰，不查資料庫。用量上限用得到：它只需要一個穩定的來源識別，
    真正的權限檢查在各個 API 的 current_user 裡做。"""
    try:
        claims = jwt.decode(token, _secret(), algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
    subject = claims.get("sub")
    return subject if isinstance(subject, str) else None


def logout(session: Session, user: AppUser) -> None:
    """版號加一，手上那張 token 就失效了。"""
    user.session_version += 1
    user.updated_at = func.now()


def change_password(session: Session, user: AppUser, current: str, new: str) -> str:
    """改完回傳新的 token：版號加一會讓自己手上這張也失效，要換一張。"""
    if not user.password_hash:
        raise AuthError(NO_PASSWORD)
    if not verify_password(current, user.password_hash):
        raise AuthError(WRONG_CURRENT_PASSWORD)
    user.password_hash = hash_password(new)
    user.session_version += 1
    user.updated_at = func.now()
    session.flush()
    session.refresh(user)
    return create_token(user)
