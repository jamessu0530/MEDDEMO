"""持續位置分享已停用，舊版網頁也不能重新開啟。"""

from fastapi import APIRouter, HTTPException
from app.api.auth import CurrentUser

router = APIRouter(prefix="/api/location", tags=["location"])


@router.get("/me")
@router.post("/pause")
@router.post("/resume")
def retired_location_sharing(user: CurrentUser):
    raise HTTPException(410, "持續位置分享已停用，主管僅能查看客戶提問。")
