"""錄音時即時顯示文字（FR-4.2）：手機一邊錄音，一邊把聲音送給 Gemini 的即時轉錄模型。

這只是讓業務邊講邊看到文字；拜訪紀錄用的逐字稿，還是錄完整段上傳後由語音辨識產生。
後端只發臨時金鑰，做法跟語音問答一樣：手機直連 Gemini，聲音不經過我們的伺服器。
"""

import datetime as dt
from dataclasses import dataclass
from typing import Any

from google.genai import types
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Customer, Product
from app.services.transcription import hotword_terms
from app.services.voice import API_VERSION, mint_token

# Gemini 專門做即時轉錄的 Live 模型（ai.google.dev/gemini-api/docs/live-api/live-transcribe）
DEFAULT_MODEL = "gemini-3.5-transcribe-live"
# 專有名詞上限 1,000 個，但官方說 100 個以內效果最好（同上）
MAX_VOCABULARY = 100
# 台灣華語為主，品項常夾英文學名（Amlodipine 這類）；指定語言也讓逐字稿出繁體字
LANGUAGE_CODES = ["zh-TW", "en-US"]


@dataclass
class TranscriptionSession:
    token: str
    model: str
    api_version: str
    expires_at: dt.datetime
    config: dict[str, Any]


def vocabulary(session: Session, customer_id: str | None) -> list[str]:
    """專有名詞照重要性排：這家客戶的名稱、競品與通路術語、品項名稱、口語別名，取前 100 個。"""
    words: list[str] = []
    customer = session.get(Customer, customer_id) if customer_id else None
    if customer:
        words += [customer.name, *(part.strip() for part in customer.name.split("·"))]
    words += hotword_terms()
    products = session.execute(select(Product.name, Product.aliases).order_by(Product.sku)).all()
    words += [name for name, _ in products]
    words += [alias for _, aliases in products for alias in aliases]
    return list(dict.fromkeys(word for word in words if word))[:MAX_VOCABULARY]


def live_config(words: list[str]) -> types.LiveConnectConfig:
    return types.LiveConnectConfig(
        response_modalities=[types.Modality.TEXT],
        input_audio_transcription=types.AudioTranscriptionConfig(
            language_codes=LANGUAGE_CODES,
            custom_vocabulary=words,
            # 去掉「嗯」「那個」和重複的字，邊講邊看比較好讀；正式逐字稿另外由語音辨識逐字產生
            mode=types.AudioTranscriptionConfigMode.SMART,
        ),
    )


def create_session(words: list[str]) -> TranscriptionSession:
    live = live_config(words)
    token, expires_at = mint_token(settings().asr_api_key, DEFAULT_MODEL, live)
    return TranscriptionSession(
        token=token,
        model=DEFAULT_MODEL,
        api_version=API_VERSION,
        expires_at=expires_at,
        config=live.model_dump(mode="json", by_alias=True, exclude_none=True),
    )
