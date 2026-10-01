"""大頭貼 API（docs/superpowers/specs/2026-10-01-avatars-text-size-design.md）。

圖片本身（GET /api/avatars/{user_id}/{version}.jpg）不用登入：<img> 帶不了 token，靠網址上的簽名。
其他都要登入。有人換了或移除大頭貼就發即時事件，手機重拿一次網址（app/realtime.py）。
"""

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import realtime
from app.api.auth import CurrentUser, ItUser
from app.db import get_session
from app.services import avatars
from app.services.attachments import MAX_FILE_BYTES, Rejected

router = APIRouter(prefix="/api/avatars", tags=["avatars"])
SessionDep = Annotated[Session, Depends(get_session)]
# 網址的版本換了內容就不同，同一個網址的內容永遠不變，可以一直快取
CACHE = "private, max-age=31536000, immutable"


class Avatars(BaseModel):
    # 有大頭貼的人，帳號 → 網址；不在裡面的用名字縮寫
    avatars: dict[str, str]


class AvatarUrl(BaseModel):
    url: str


@router.get("", response_model=Avatars)
def list_avatars(session: SessionDep, user: CurrentUser):
    return Avatars(avatars=avatars.urls(session))


@router.post("/me", response_model=AvatarUrl)
def upload(session: SessionDep, user: CurrentUser, file: Annotated[UploadFile, File()]):
    """換成這張照片（multipart，欄位 file）。"""
    # 多讀一個位元組：讀到超過上限就知道太大，不必把整個檔案讀完
    raw = file.file.read(MAX_FILE_BYTES + 1)
    try:
        content = avatars.prepare(raw)
    except Rejected as exc:
        raise HTTPException(exc.status, str(exc)) from None
    new_url = avatars.save(session, user, content)
    session.commit()
    realtime.avatars_changed()
    return AvatarUrl(url=new_url)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def remove_mine(session: SessionDep, user: CurrentUser):
    if avatars.remove(session, user.id):
        session.commit()
        realtime.avatars_changed()


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_someone(session: SessionDep, user: ItUser, user_id: str):
    """IT 移除別人的大頭貼（擋濫用）：自建帳號誰都能開，上傳的照片全公司看得到。"""
    if not avatars.remove(session, user_id):
        raise HTTPException(404, "這個帳號沒有大頭貼")
    session.commit()
    realtime.avatars_changed()


@router.get("/{user_id}/{version}.jpg")
def get_image(session: SessionDep, user_id: str, version: str, sig: str = ""):
    content = avatars.image(session, user_id, version, sig)
    # 簽名不對、版本舊了、帳號停用，一律 404，不透露這個帳號有沒有大頭貼
    if content is None:
        raise HTTPException(404, "找不到這張大頭貼")
    return Response(content, media_type="image/jpeg", headers={"Cache-Control": CACHE})
