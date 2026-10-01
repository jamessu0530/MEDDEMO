"""頻道訊息與提問的附件：檢查與整理上傳的檔案、誰看得到、簽名網址
（docs/superpowers/specs/2026-10-01-attachments-design.md）。

前端會先把照片縮小再傳，但這裡不信任前端，每個檔案都重新整理一次：圖片轉正、清掉 EXIF（照片常在客戶店裡拍，
GPS 位置不能留著）、縮到長邊 2048、存成 embedding-2 收得了的 JPEG 或 PNG；PDF 只檢查打得開、沒加密、頁數不超過上限。
"""

from __future__ import annotations

import datetime as dt
import io
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from pathlib import PurePath
from urllib.parse import quote

import jwt
from PIL import Image, ImageOps, UnidentifiedImageError
from pypdf import PdfReader
from pypdf.errors import PyPdfError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AppUser, AskRecord, Attachment, Channel, ChannelMessage, Escalation, MemoryItem
from app.services import auth, channels
from app.services.escalations import Asker, visible_to
from app.services.retrieval import SIMPLE, to_tsvector_input

# 單檔上限。整個請求另外由 Nginx 的 client_max_body_size 20m 擋
MAX_FILE_BYTES = 15 * 1024 * 1024
MAX_PER_MESSAGE = 4
MAX_PER_ASK = 1
# 長邊超過就縮。手機照片 4000px 以上，看與給 AI 都用不到那麼大
MAX_EDGE = 2048
THUMB_EDGE = 480
JPEG_QUALITY = 85
THUMB_QUALITY = 80
# 業務傳的多半是幾頁的 DM、仿單、報價單；上百頁的型錄算向量要切很多段，也不是頻道裡該傳的東西
MAX_PDF_PAGES = 60
# 簽名網址的有效時間：到期時間取整點，同一個小時內簽出來的網址都一樣，瀏覽器的快取才用得上。
# 所以實際有效一到兩小時；畫面每次列訊息都重新拿，夠看完一個頻道
URL_TTL = dt.timedelta(hours=1)
# 登入用的 token 沒有 aud，附件的簽名有：PyJWT 驗登入 token 時看到 aud 會拒絕，兩種 token 不能互相冒用
AUDIENCE = "attachment"
IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}
_SAFE_ASCII = re.compile(r"[^A-Za-z0-9._-]+")
FILENAME_LIMIT = 120


class Rejected(Exception):
    """上傳的檔案不收。status 是要回的 HTTP 狀態碼，訊息直接顯示給使用者。"""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class Prepared:
    """整理好、可以寫進資料庫的檔案。"""

    kind: str
    filename: str
    mime_type: str
    content: bytes
    thumbnail: bytes | None = None
    width: int | None = None
    height: int | None = None
    page_count: int | None = None


def clean_filename(raw: str | None, fallback: str) -> str:
    """只留檔名本身（不要路徑），拿掉控制字元，太長就截短但保留副檔名。"""
    name = PurePath((raw or "").replace("\\", "/")).name
    name = "".join(ch for ch in name if unicodedata.category(ch)[0] != "C").strip()
    if not name:
        return fallback
    stem, dot, suffix = name.rpartition(".")
    if not dot:
        return name[:FILENAME_LIMIT]
    return f"{stem[: FILENAME_LIMIT - len(suffix) - 1]}.{suffix}"


def _with_suffix(filename: str, suffix: str) -> str:
    stem = filename.rpartition(".")[0] or filename
    return f"{stem}.{suffix}"


def _has_alpha(image: Image.Image) -> bool:
    """真的有透明的地方才算：很多 PNG 帶著 alpha 通道，其實整張都不透明，存成 JPEG 小很多。"""
    if image.mode in ("RGBA", "LA"):
        return image.getchannel("A").getextrema()[0] < 255
    if image.mode == "P" and "transparency" in image.info:
        return _has_alpha(image.convert("RGBA"))
    return False


def _flatten(image: Image.Image) -> Image.Image:
    """透明的地方墊白色，縮圖一律是 JPEG。"""
    if image.mode in ("RGBA", "LA", "P"):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, "white")
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background
    return image.convert("RGB")


def _encode(image: Image.Image, fmt: str, quality: int, icc: bytes | None) -> bytes:
    buffer = io.BytesIO()
    # 不傳 exif：Pillow 只有明確給 exif 參數才會寫 EXIF，原圖的拍攝地點、機型都不會留下來。
    # 色彩描述檔（ICC）不是個資，留著顏色才不會跑掉（iPhone 拍的是 Display P3）
    options = {"icc_profile": icc} if icc else {}
    if fmt == "JPEG":
        image.save(buffer, "JPEG", quality=quality, optimize=True, **options)
    else:
        image.save(buffer, "PNG", optimize=True, **options)
    return buffer.getvalue()


def prepare_image(raw: bytes, filename: str) -> Prepared:
    try:
        image = Image.open(io.BytesIO(raw))
        fmt = image.format
        image.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, SyntaxError, ValueError):
        raise Rejected(415, "看不懂這個檔案，請改用 JPEG 或 PNG 照片，或 PDF") from None
    if fmt not in IMAGE_FORMATS:
        raise Rejected(415, "請改用 JPEG 或 PNG 照片")
    icc = image.info.get("icc_profile")
    image = ImageOps.exif_transpose(image)
    image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
    if _has_alpha(image):
        content = _encode(image.convert("RGBA"), "PNG", JPEG_QUALITY, icc)
        mime, suffix = "image/png", "png"
    else:
        content = _encode(image.convert("RGB"), "JPEG", JPEG_QUALITY, icc)
        mime, suffix = "image/jpeg", "jpg"
    thumb = _flatten(image)
    thumb.thumbnail((THUMB_EDGE, THUMB_EDGE), Image.Resampling.LANCZOS)
    return Prepared(
        kind="image", filename=_with_suffix(filename, suffix), mime_type=mime, content=content,
        thumbnail=_encode(thumb, "JPEG", THUMB_QUALITY, icc), width=image.width, height=image.height,
    )


def prepare_pdf(raw: bytes, filename: str) -> Prepared:
    try:
        reader = PdfReader(io.BytesIO(raw))
        if reader.is_encrypted:
            raise Rejected(415, "這份 PDF 有密碼，請先移除密碼再上傳")
        pages = len(reader.pages)
    except Rejected:
        raise
    except (PyPdfError, OSError, ValueError, KeyError, TypeError):
        raise Rejected(415, "這份 PDF 打不開，請確認檔案沒有損壞") from None
    if pages == 0:
        raise Rejected(415, "這份 PDF 沒有任何頁面")
    if pages > MAX_PDF_PAGES:
        raise Rejected(415, f"PDF 最多 {MAX_PDF_PAGES} 頁，這份有 {pages} 頁")
    return Prepared(
        kind="pdf", filename=_with_suffix(filename, "pdf"), mime_type="application/pdf", content=raw, page_count=pages,
    )


def prepare(raw: bytes, filename: str | None) -> Prepared:
    """檢查並整理一個上傳的檔案。看檔案內容判斷種類，不信副檔名與瀏覽器給的類型。"""
    if len(raw) > MAX_FILE_BYTES:
        raise Rejected(413, f"單一檔案最大 {MAX_FILE_BYTES // 1024 // 1024}MB，請縮小後再傳")
    if not raw:
        raise Rejected(422, "檔案是空的")
    if raw.startswith(b"%PDF-"):
        return prepare_pdf(raw, clean_filename(filename, "文件.pdf"))
    return prepare_image(raw, clean_filename(filename, "照片.jpg"))


def search_text(attachment: Attachment, context: str) -> str:
    return " ".join(part for part in (attachment.filename, attachment.caption or "", context) if part)


def add(
    session: Session,
    uploader: AppUser,
    prepared: Prepared,
    *,
    context: str,
    message_id: int | None = None,
    ask_id: str | None = None,
    caption: str | None = None,
    status: str = "pending",
) -> Attachment:
    """寫入一個附件。context 是所屬訊息的文字（提問的附件用問題），關鍵字檢索搜得到。
    caption 與 status 只有灌示範資料時會給（說明是手寫的）；一般上傳由背景工作補說明。"""
    attachment = Attachment(
        message_id=message_id, ask_id=ask_id, uploader_id=uploader.id, kind=prepared.kind,
        filename=prepared.filename, mime_type=prepared.mime_type, size_bytes=len(prepared.content),
        content=prepared.content, thumbnail=prepared.thumbnail, width=prepared.width, height=prepared.height,
        page_count=prepared.page_count, caption=caption, status=status,
    )
    attachment.search_tokens = func.to_tsvector(SIMPLE, to_tsvector_input(search_text(attachment, context)))
    session.add(attachment)
    return attachment


def for_messages(session: Session, message_ids: list[int]) -> dict[int, list[Attachment]]:
    """每則訊息的附件，照上傳的順序。不讀檔案內容。"""
    if not message_ids:
        return {}
    grouped: dict[int, list[Attachment]] = defaultdict(list)
    rows = session.scalars(select(Attachment).where(Attachment.message_id.in_(message_ids)).order_by(Attachment.id))
    for attachment in rows:
        grouped[attachment.message_id].append(attachment)
    return grouped


def sign(attachment_id: int, user: AppUser, now: dt.datetime | None = None) -> str:
    hour = (now or dt.datetime.now(dt.UTC)).replace(minute=0, second=0, microsecond=0)
    expire = hour + 2 * URL_TTL
    payload = {"att": attachment_id, "sub": user.id, "aud": AUDIENCE, "exp": expire}
    return jwt.encode(payload, auth._secret(), algorithm=auth.ALGORITHM)


def signer(token: str, attachment_id: int) -> str | None:
    """簽名有效、而且是簽給這個附件的，回傳簽給誰；否則 None。"""
    try:
        claims = jwt.decode(token, auth._secret(), algorithms=[auth.ALGORITHM], audience=AUDIENCE)
    except jwt.PyJWTError:
        return None
    subject = claims.get("sub")
    if claims.get("att") != attachment_id or not isinstance(subject, str):
        return None
    return subject


def urls(attachment: Attachment, user: AppUser) -> tuple[str, str | None]:
    """(原檔網址, 縮圖網址)。PDF 沒有縮圖。"""
    sig = sign(attachment.id, user)
    base = f"/api/attachments/{attachment.id}"
    return f"{base}?sig={sig}", (f"{base}/thumb?sig={sig}" if attachment.kind == "image" else None)


def _ask_visible(session: Session, user: AppUser, ask_id: str) -> bool:
    record = session.get(AskRecord, ask_id)
    if record is None:
        return False
    if record.user_id == user.id:
        return True
    # 轉給主管的提問：看得到那筆轉介的主管（與 IT）也看得到附件，回覆時才知道業務問的是哪一張
    return session.scalar(
        select(Escalation.id)
        .join(AskRecord, AskRecord.id == Escalation.ask_id)
        .join(Asker, Asker.id == AskRecord.user_id)
        .where(Escalation.ask_id == ask_id, visible_to(user))
    ) is not None


def shared_upward(session: Session, attachment_id: int) -> bool:
    """附件跟著某條重點往上傳、沒撤回、沒刪除：全公司都看得到（等於全國看板的範圍）。"""
    return session.scalar(
        select(MemoryItem.id)
        .where(
            MemoryItem.shared.is_(True),
            MemoryItem.withdrawn_at.is_(None),
            MemoryItem.deleted_at.is_(None),
            MemoryItem.shared_attachment_ids.any(attachment_id),
        )
        .limit(1)
    ) is not None


def can_see(session: Session, user: AppUser, attachment: Attachment) -> bool:
    """附件看不看得到：看得到它所在的頻道、跟著重點往上傳了，或是自己的提問、轉給自己回覆的提問。"""
    if attachment.message_id is not None:
        if shared_upward(session, attachment.id):
            return True
        message = session.get(ChannelMessage, attachment.message_id)
        channel = session.get(Channel, message.channel_id) if message else None
        if channel is None:
            return False
        return channels.can_see(user, channels.describe(session, [channel])[0])
    return attachment.ask_id is not None and _ask_visible(session, user, attachment.ask_id)


def content_disposition(filename: str) -> str:
    """中文檔名照 RFC 5987 寫在 filename*；舊瀏覽器看的 filename 只放 ASCII。"""
    ascii_name = _SAFE_ASCII.sub("_", filename).strip("_") or "file"
    return f"inline; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"
