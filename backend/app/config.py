"""環境設定。本機開發讀 backend/.env（不進 git）；正式環境由 K8s Secret 注入環境變數，環境變數優先。"""

from functools import cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class NotConfigured(RuntimeError):
    """外部服務（語音辨識、AI 模型、語音問答）還沒設定。"""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    database_url: str = "postgresql+psycopg://meddemo:meddemo@127.0.0.1:5433/meddemo"
    redis_url: str = "redis://127.0.0.1:6379/0"

    # 語音辨識與抽欄位的供應商。留空代表還沒設定：錄音會停在「轉文字失敗」讓業務手動輸入逐字稿，
    # 抽欄位則留白讓業務手動填，整條流程照樣走得完
    asr_provider: str = ""
    asr_api_key: str = ""
    asr_model: str = ""
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


@cache
def settings() -> Settings:
    return Settings()
