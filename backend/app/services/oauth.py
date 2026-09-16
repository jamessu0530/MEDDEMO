"""第三方登入的驗證：Google、GitHub、Facebook。

每一家都只回答一件事：這張憑證是不是真的、是誰（subject）。要不要讓他登入由 api/auth.py 判斷。

參考 flutterproject4 的做法，但有兩處刻意不照抄：
- 那邊的 Facebook 有「不驗簽章」的後備流程，這裡不做。
- 那邊的 Facebook 一般流程只打 /me，沒有確認 access token 是發給我們這個 App 的：
  別的 App 拿到的使用者 token 也能冒用。這裡改打 debug_token，核對 app_id。
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from app.config import settings

GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_API = "https://api.github.com"
FACEBOOK_GRAPH = "https://graph.facebook.com/v21.0"
# 三家的 API 平常一兩秒內回；給到 12 秒是跟 flutterproject4 一樣，網路慢的時候不至於誤判失敗
TIMEOUT_SECONDS = 12

PROVIDER_LABEL = {"google": "Google", "github": "GitHub", "facebook": "Facebook"}


class OAuthError(Exception):
    """驗證失敗。訊息是給使用者看的中文。"""


class NotConfigured(OAuthError):
    pass


@dataclass
class ExternalIdentity:
    provider: str
    subject: str
    email: str | None
    # 自動開帳號時當作名字；沒給就用信箱前綴或「Google 使用者」
    name: str | None = None


def configured() -> dict[str, dict[str, str] | None]:
    """前端要顯示哪些按鈕、要用哪個 client id。只回公開的 id，不回 secret。"""
    s = settings()
    return {
        "google": {"client_id": s.google_client_id} if s.google_client_id else None,
        "github": {"client_id": s.github_client_id} if s.github_client_id and s.github_client_secret else None,
        "facebook": {"app_id": s.facebook_app_id} if s.facebook_app_id and s.facebook_app_secret else None,
    }


def verify_google(credential: str) -> ExternalIdentity:
    """Google Identity Services 給的 ID token：驗簽章、發給誰（aud）、有沒有過期、發行者。"""
    client_id = settings().google_client_id
    if not client_id:
        raise NotConfigured("伺服器沒有設定 Google 登入")
    try:
        info = google_id_token.verify_oauth2_token(credential, google_requests.Request(), client_id)
    except ValueError:
        raise OAuthError("Google 登入驗證失敗，請再試一次") from None
    subject = str(info.get("sub") or "")
    if not subject:
        raise OAuthError("Google 帳號資料不完整")
    # 沒驗證過的 Email 不顯示，免得設定頁上出現別人的信箱
    email = info.get("email") if info.get("email_verified") else None
    return ExternalIdentity("google", subject, email, (info.get("name") or "").strip() or None)


def verify_github(code: str, redirect_uri: str) -> ExternalIdentity:
    """GitHub 授權碼流程：用 secret 換 access token，再拿使用者編號。"""
    s = settings()
    if not (s.github_client_id and s.github_client_secret):
        raise NotConfigured("伺服器沒有設定 GitHub 登入")
    try:
        token_resp = httpx.post(
            GITHUB_TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": s.github_client_id,
                "client_secret": s.github_client_secret,
                "code": code.strip(),
                "redirect_uri": redirect_uri,
            },
            timeout=TIMEOUT_SECONDS,
        )
        token = (token_resp.json().get("access_token") or "") if token_resp.status_code == 200 else ""
        if not token:
            raise OAuthError("GitHub 授權碼無效或已過期，請重新登入")
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
        user_resp = httpx.get(f"{GITHUB_API}/user", headers=headers, timeout=TIMEOUT_SECONDS)
        if user_resp.status_code != 200:
            raise OAuthError("GitHub 登入驗證失敗")
        user = user_resp.json()
        email = None
        emails_resp = httpx.get(f"{GITHUB_API}/user/emails", headers=headers, timeout=TIMEOUT_SECONDS)
        if emails_resp.status_code == 200:
            email = next(
                (e["email"] for e in emails_resp.json() if e.get("primary") and e.get("verified")),
                None,
            )
    except httpx.HTTPError:
        raise OAuthError("連不上 GitHub，請稍後再試") from None
    subject = str(user.get("id") or "")
    if not subject:
        raise OAuthError("GitHub 帳號資料不完整")
    return ExternalIdentity("github", subject, email, (user.get("name") or user.get("login") or "").strip() or None)


def verify_facebook(access_token: str) -> ExternalIdentity:
    """Facebook Login 給的 access token：用 debug_token 確認有效、而且是發給我們這個 App 的。"""
    s = settings()
    if not (s.facebook_app_id and s.facebook_app_secret):
        raise NotConfigured("伺服器沒有設定 Facebook 登入")
    token = access_token.strip()
    try:
        debug = httpx.get(
            f"{FACEBOOK_GRAPH}/debug_token",
            params={"input_token": token, "access_token": f"{s.facebook_app_id}|{s.facebook_app_secret}"},
            timeout=TIMEOUT_SECONDS,
        )
        data = (debug.json().get("data") or {}) if debug.status_code == 200 else {}
        if not data.get("is_valid") or str(data.get("app_id")) != s.facebook_app_id:
            raise OAuthError("Facebook 登入驗證失敗，請再試一次")
        subject = str(data.get("user_id") or "")
        me = httpx.get(
            f"{FACEBOOK_GRAPH}/me", params={"fields": "id,name,email", "access_token": token}, timeout=TIMEOUT_SECONDS
        )
        profile = me.json() if me.status_code == 200 else {}
        email, name = profile.get("email"), (profile.get("name") or "").strip() or None
    except httpx.HTTPError:
        raise OAuthError("連不上 Facebook，請稍後再試") from None
    if not subject:
        raise OAuthError("Facebook 帳號資料不完整")
    return ExternalIdentity("facebook", subject, email, name)
