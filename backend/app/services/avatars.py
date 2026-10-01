"""大頭貼（docs/superpowers/specs/2026-10-01-avatars-text-size-design.md）。

前端會先裁成正方形、縮小再傳，但這裡不信任前端，每張都重新整理一次：轉正、清掉 EXIF（拍攝地點、機型）、
從中間裁成正方形、縮成 256×256 的 JPEG。看圖片的方式沿用附件（services/attachments.py）。

<img> 帶不了登入的 token，所以大頭貼用「知道網址才拿得到」的做法：網址帶一個用登入密鑰簽的 sig，
沒有期限、不分看的人；只有要登入的 GET /api/avatars 會發。換照片或移除時版本跟著換，舊網址就失效了。
"""

from __future__ import annotations

import hashlib
import hmac
import io
import secrets

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, select
from sqlalchemy.orm import Session, undefer

from app.models import AppUser, UserAvatar
from app.services import auth
from app.services.attachments import IMAGE_FORMATS, MAX_FILE_BYTES, Rejected, _encode, _flatten

SIZE = 256
JPEG_QUALITY = 85


def prepare(raw: bytes) -> bytes:
    """檢查並整理上傳的照片，回傳 256×256 的 JPEG。不收的丟 Rejected，訊息直接顯示給使用者。"""
    if len(raw) > MAX_FILE_BYTES:
        raise Rejected(413, f"照片最大 {MAX_FILE_BYTES // 1024 // 1024}MB，請縮小後再傳")
    if not raw:
        raise Rejected(422, "檔案是空的")
    try:
        image = Image.open(io.BytesIO(raw))
        fmt = image.format
        image.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, SyntaxError, ValueError):
        raise Rejected(415, "看不懂這個檔案，請改用 JPEG 或 PNG 照片") from None
    if fmt not in IMAGE_FORMATS:
        raise Rejected(415, "請改用 JPEG 或 PNG 照片")
    icc = image.info.get("icc_profile")
    # 轉正之後再裁，裁的才是畫面上看到的中間；透明的地方墊白
    square = ImageOps.fit(_flatten(ImageOps.exif_transpose(image)), (SIZE, SIZE), Image.Resampling.LANCZOS)
    return _encode(square, "JPEG", JPEG_QUALITY, icc)


def _sig(user_id: str, version: str) -> str:
    key = auth._secret().encode()
    return hmac.new(key, f"avatar:{user_id}:{version}".encode(), hashlib.sha256).hexdigest()[:32]


def url(user_id: str, version: str) -> str:
    return f"/api/avatars/{user_id}/{version}.jpg?sig={_sig(user_id, version)}"


def urls(session: Session) -> dict[str, str]:
    """有大頭貼、在職的帳號與網址。所有人都在全國頻道，看得到彼此的名字與狀態，大頭貼也一樣不分誰看。"""
    rows = session.execute(
        select(UserAvatar.user_id, UserAvatar.version)
        .join(AppUser, AppUser.id == UserAvatar.user_id)
        .where(AppUser.deactivated_at.is_(None))
    )
    return {user_id: url(user_id, version) for user_id, version in rows}


def save(session: Session, user: AppUser, content: bytes) -> str:
    """換成這張，回傳新網址。版本每次都換新的隨機值，舊網址跟著失效。"""
    avatar = session.get(UserAvatar, user.id)
    if avatar is None:
        avatar = UserAvatar(user_id=user.id)
        session.add(avatar)
    avatar.content = content
    avatar.version = secrets.token_hex(4)
    avatar.updated_at = func.now()
    session.flush()
    return url(user.id, avatar.version)


def remove(session: Session, user_id: str) -> bool:
    """移除大頭貼，回到名字縮寫。本來就沒有回 False。"""
    avatar = session.get(UserAvatar, user_id)
    if avatar is None:
        return False
    session.delete(avatar)
    return True


def image(session: Session, user_id: str, version: str, sig: str) -> bytes | None:
    """網址對得上（簽名、版本都是現在這張，帳號沒停用）才回圖片。"""
    # 比的是位元組：網址上的 sig 可能是任何字，compare_digest 遇到非 ASCII 的字串會丟例外
    if not hmac.compare_digest(sig.encode(), _sig(user_id, version).encode()):
        return None
    row = session.execute(
        select(UserAvatar)
        .join(AppUser, AppUser.id == UserAvatar.user_id)
        .where(UserAvatar.user_id == user_id, UserAvatar.version == version, AppUser.deactivated_at.is_(None))
        .options(undefer(UserAvatar.content))
    ).scalar_one_or_none()
    return row.content if row else None
