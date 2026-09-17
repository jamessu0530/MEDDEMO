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

    @field_validator("demo_password")
    @classmethod
    def _blank_password_means_default(cls, value: str) -> str:
        """GitHub Secret 沒設時，部署流程傳進來的是空字串而不是「沒有這個變數」，會蓋掉預設值。
        9/16 就這樣把線上八個帳號的密碼灌成空白，密碼欄留空就登入得進去。"""
        return value if value.strip() else DEFAULT_DEMO_PASSWORD


@cache
def settings() -> Settings:
    return Settings()
