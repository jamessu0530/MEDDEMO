"""主管頁的 Google 地圖要的設定（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈地圖〉）。

瀏覽器用的金鑰不寫進前端的建置：換金鑰不必重建映像檔，沒設金鑰的環境（開發、測試）地圖區塊就換成
「地圖暫時載入不了」，下面的清單照常。只有主管頁畫地圖，所以只給主管與 IT。
"""

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.auth import ManagerUser
from app.config import settings

router = APIRouter(prefix="/api/maps", tags=["maps"])

# Google 給測試用的 Map ID：沒在 Cloud Console 建自己的 Map ID 時用它，進階標記照樣畫得出來
DEMO_MAP_ID = "DEMO_MAP_ID"


class MapsConfig(BaseModel):
    browser_key: str
    map_id: str


@router.get("/config", response_model=MapsConfig | None)
def get_config(_: ManagerUser) -> MapsConfig | None:
    """沒設瀏覽器金鑰回 null，畫面就不載入 Google 地圖。"""
    config = settings()
    if not config.google_maps_browser_key:
        return None
    return MapsConfig(browser_key=config.google_maps_browser_key, map_id=config.google_maps_map_id or DEMO_MAP_ID)
