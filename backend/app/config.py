"""環境設定。本機開發讀 backend/.env（不進 git）；正式環境由 K8s Secret 注入環境變數，環境變數優先。"""

from functools import cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
DEFAULT_DEMO_PASSWORD = "meddemo1234"


class NotConfigured(RuntimeError):
    """外部服務（語音辨識、AI 模型、語音問答）還沒設定。"""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    database_url: str = "postgresql+psycopg://meddemo:meddemo@127.0.0.1:5433/meddemo"
    # 簽 JWT 用的密鑰。留空就每次啟動隨機產生一把（重開之後大家要重新登入），
    # 絕不放預設值：寫死的預設值等於沒有密鑰，誰都能自己簽一張通行證
    jwt_secret: str = ""
    # 登入之後多久要重新登入。決賽當天只用幾個小時，一天綽綽有餘
    jwt_expire_hours: int = 24
    # 灌假資料時給每個帳號設的密碼。正式環境由 GitHub Secret 帶進來
    demo_password: str = DEFAULT_DEMO_PASSWORD
    # 第三方登入。沒填的那家，登入頁與帳號設定就不出現它的按鈕。
    # client id / app id 其實會出現在網頁上、不算祕密，跟 secret 放一起是為了設定時一次在同一個地方填完
    google_client_id: str = ""
    github_client_id: str = ""
    github_client_secret: str = ""
    facebook_app_id: str = ""
    facebook_app_secret: str = ""
    redis_url: str = "redis://127.0.0.1:6379/0"

    # 語音辨識與抽欄位的供應商。留空代表還沒設定：錄音會停在「轉文字失敗」讓業務手動輸入逐字稿，
    # 抽欄位則留白讓業務手動填，整條流程照樣走得完
    asr_provider: str = ""
    asr_api_key: str = ""
    asr_model: str = ""
    # CARE 在同一個 K3s 叢集裡的語音辨識服務（local-asr）。ASR_PROVIDER=local 時是主要來源；
    # ASR_PROVIDER=gemini 時設了這個就當備援，Gemini 失敗時改用它
    asr_url: str = ""
    llm_provider: str = ""
    llm_api_key: str = ""
    llm_model: str = ""
    # 語意檢索用的 embedding。留空代表還沒設定，知識檢索只走關鍵字
    embedding_provider: str = ""
    embedding_api_key: str = ""
    embedding_model: str = ""
    # 語音問答（Gemini Live API，只有 Gemini 有）。找不到金鑰就當作還沒設定；模型留空用預設
    voice_api_key: str = ""
    voice_model: str = ""

    # 知識查詢的網路搜尋與精排（照搬 CARE 的 CRAG）。沒填 Firecrawl 就不上網，知識庫答不出來直接查無依據；
    # 沒填 Cohere 就改用檢索的融合分數排序
    firecrawl_api_key: str = ""
    cohere_api_key: str = ""
    # 問答自動判斷查數字、規定還是頻道（TypeSafe Jev，跟 CARE 共用同一把）。沒填就每一題都請業務自己選
    typesafe_api_key: str = ""

    # Google Routes API：行程的道路車程與主管頁的沿路路線。留空就用直線估算，畫面註明「估計」。
    # 只在後端用；在 Google Cloud 限制只開 Routes API（docs/superpowers/plans/2026-10-01-itinerary-stage4.md）
    google_maps_server_key: str = ""
    # 主管頁的地圖（Maps JavaScript API）。會出現在網頁上，安全靠 Google Cloud 的限制：只開 Maps JavaScript API、
    # 只認我們的網域。不寫進前端的建置，由 GET /api/maps/config 給，換金鑰不必重建映像檔
    google_maps_browser_key: str = ""
    # 地圖上的頭像與編號圓點用進階標記，要一個 Map ID；留空就用 Google 給測試用的 DEMO_MAP_ID
    google_maps_map_id: str = ""

    # 業務分享位置的上班時間（台北的真實時間，不是展示日）：「星期 起訖時間」，星期 1＝一…7＝日，可以寫範圍或用逗號分開；
    # 結束那一分鐘不算（18:30 起就是下班），也可以寫 24:00。測試用設定改成整天都算或都不算
    location_share_hours: str = "1-5 08:30-18:30"

    @field_validator("demo_password")
    @classmethod
    def _blank_password_means_default(cls, value: str) -> str:
        """GitHub Secret 沒設時，部署流程傳進來的是空字串而不是「沒有這個變數」，會蓋掉預設值。
        9/16 就這樣把線上八個帳號的密碼灌成空白，密碼欄留空就登入得進去。"""
        return value if value.strip() else DEFAULT_DEMO_PASSWORD

    @field_validator("location_share_hours")
    @classmethod
    def _valid_location_share_hours(cls, value: str) -> str:
        """打錯格式要在啟動時就炸開，不要等到第一個業務送心跳才發現，害全部人的位置分享都壞掉。
        這裡才 import：app.services.locations 在模組最上面 import 了 app.config.settings，
        搬到檔案最上面會變成循環引用。"""
        from app.services import locations

        locations.parse_hours(value)
        return value


@cache
def settings() -> Settings:
    return Settings()
