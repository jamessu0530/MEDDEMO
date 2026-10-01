"""附件的檔案本身與縮圖（docs/superpowers/specs/2026-10-01-attachments-design.md）。

畫面上的 <img> 帶不了 Bearer token，所以列訊息、提問時 API 先發一組簽過名、一小時有效的網址。
這裡先驗簽名知道是誰，再查一次權限：IT 刪了訊息、撤回往上傳都要立刻生效，不能等簽名過期。
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session, undefer

from app.db import get_session
from app.models import AppUser, Attachment
from app.services import attachments

router = APIRouter(prefix="/api/attachments", tags=["attachments"])
SessionDep = Annotated[Session, Depends(get_session)]
# 權限每次都查，快取短一點：撤回之後，已經載入的畫面最多五分鐘內也拿不到新的
CACHE = "private, max-age=300"


def _load(session: Session, attachment_id: int, sig: str, column: str) -> Attachment:
    subject = attachments.signer(sig, attachment_id)
    user = session.get(AppUser, subject) if subject else None
    attachment = session.get(Attachment, attachment_id, options=[undefer(getattr(Attachment, column))])
    # 簽名不對、帳號停用、看不到、檔案不在了，一律 404，不透露這個編號存在
    if user is None or user.deactivated_at is not None or attachment is None:
        raise HTTPException(404, "找不到這個附件")
    if not attachments.can_see(session, user, attachment):
        raise HTTPException(404, "找不到這個附件")
    return attachment


@router.get("/{attachment_id}")
def get_file(session: SessionDep, attachment_id: int, sig: str = ""):
    attachment = _load(session, attachment_id, sig, "content")
    return Response(
        attachment.content,
        media_type=attachment.mime_type,
        headers={"Cache-Control": CACHE, "Content-Disposition": attachments.content_disposition(attachment.filename)},
    )


@router.get("/{attachment_id}/thumb")
def get_thumbnail(session: SessionDep, attachment_id: int, sig: str = ""):
    attachment = _load(session, attachment_id, sig, "thumbnail")
    if attachment.thumbnail is None:
        raise HTTPException(404, "這個附件沒有縮圖")
    return Response(attachment.thumbnail, media_type="image/jpeg", headers={"Cache-Control": CACHE})
