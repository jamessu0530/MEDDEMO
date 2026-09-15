"""語音轉文字（SDD 的 TranscriptionService）。

服務層不直接依賴特定供應商：來源由設定決定，沒設定就丟 NotConfigured，
流程會停在「轉文字失敗」，讓業務重錄或手動輸入逐字稿。
來源有兩個：Gemini，以及 CARE 在同一個 K3s 叢集裡的語音辨識服務（local-asr）。
ASR_PROVIDER 選主要來源；另一個也有設定就當備援，主要來源連不上或出錯時改用它。
"""

import io
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import httpx
from google.genai import types
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import NotConfigured, Settings, settings
from app.gemini import gemini_client
from app.models import Customer, Product
from app.services.asr_cleanup import HomophoneFixer, to_taiwan

log = logging.getLogger(__name__)
HOTWORDS_FILE = Path(__file__).resolve().parents[1] / "resources" / "hotwords.txt"

# 跟抽欄位用同一個模型：聽寫加上照熱詞表寫品項名稱，Flash 就夠用
DEFAULT_GEMINI_ASR_MODEL = "gemini-3.8-flash"
# 音檔直接放在請求裡時，整個請求上限 20MB，音檔轉成 base64 會變成 4/3 倍；
# 超過 14MB 就改用 Files API 先上傳（ai.google.dev/gemini-api/docs/audio）
INLINE_AUDIO_LIMIT = 14 * 1024 * 1024
# Gemini 支援的音檔格式有 audio/m4a、沒有 audio/mp4；iOS 錄出來的 mp4 就是 m4a（同一種 MPEG-4 音訊）
MIME_ALIASES = {"audio/mp4": "audio/m4a", "audio/x-m4a": "audio/m4a"}

# CARE 的語音辨識服務（local-asr，faster-whisper small）只收檔案和語言，沒有熱詞參數
LOCAL_ASR_LANGUAGE = "zh"
# 9/15 在 care-vm 實測：66 秒的錄音等 21 秒（約錄音長度的三分之一），6～9 秒的短句每句也要 5～8 秒（每次約 5 秒
# 固定開銷）。90 秒夠處理 4 分鐘以上的錄音（口述通常一分鐘上下），也把 RQ 預設 180 秒的工作時限留下一半，
# 給 Gemini 備援和整理欄位
LOCAL_ASR_TIMEOUT_SECONDS = 90
# 服務照副檔名存暫存檔，給對副檔名，解碼時才認得出格式
AUDIO_SUFFIXES = {
    "audio/webm": ".webm",
    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mpeg": ".mp3",
}

TRANSCRIBE_PROMPT = """這是藥品通路業務拜訪客戶之後的口述錄音，請逐字轉成繁體中文逐字稿。
- 照實際講的內容寫，不要摘要、不要改寫、不要補字；聽不清楚的地方寫（聽不清楚）。
- 下面是業務常講的品項、競品與通路術語。聽到發音相近的詞，請用這裡的寫法：
{hotwords}
只輸出逐字稿本身，不要加標題或說明。"""


@dataclass
class Transcript:
    text: str
    duration_seconds: float | None = None


class Transcriber(Protocol):
    def transcribe(self, audio: bytes, mime_type: str, hotwords: list[str]) -> Transcript: ...


def hotword_terms() -> list[str]:
    """熱詞表檔案裡的通路術語與競品名稱。"""
    lines = (line.strip() for line in HOTWORDS_FILE.read_text(encoding="utf-8").splitlines())
    return [line for line in lines if line and not line.startswith("#")]


def load_hotwords(session: Session) -> list[str]:
    """熱詞 = 品項名稱與口語別名（資料庫）＋通路術語與競品（熱詞表檔案），去掉重複。"""
    words: list[str] = []
    for name, aliases in session.execute(select(Product.name, Product.aliases)):
        words += [name, *aliases]
    return list(dict.fromkeys(words + hotword_terms()))


def visit_hotwords(session: Session, customer_id: str) -> list[str]:
    """一次拜訪用的熱詞：這家客戶的名稱（整個與分段，例如「康泰連鎖藥局」「忠孝店」）排最前面，再接共用熱詞。"""
    customer = session.get(Customer, customer_id)
    names = [customer.name, *customer.name.split(" · ")] if customer else []
    return list(dict.fromkeys(names + load_hotwords(session)))


def gemini_audio_mime(mime_type: str) -> str:
    """瀏覽器給的 audio/webm;codecs=opus 這類寫法，轉成 Gemini 格式清單上的名稱。"""
    base = mime_type.split(";")[0].strip().lower()
    return MIME_ALIASES.get(base, base)


class GeminiTranscriber:
    def __init__(self, client: Any, model: str):
        self.client = client
        self.model = model

    def transcribe(self, audio: bytes, mime_type: str, hotwords: list[str]) -> Transcript:
        mime = gemini_audio_mime(mime_type)
        if len(audio) > INLINE_AUDIO_LIMIT:
            media = self.client.files.upload(file=io.BytesIO(audio), config=types.UploadFileConfig(mime_type=mime))
        else:
            media = types.Part.from_bytes(data=audio, mime_type=mime)
        response = self.client.models.generate_content(
            model=self.model,
            contents=[media, TRANSCRIBE_PROMPT.format(hotwords="、".join(hotwords))],
            config=types.GenerateContentConfig(
                # 聽寫不需要推理，用這個模型最低的思考等級縮短等待
                thinking_config=types.ThinkingConfig(thinking_level="low"),
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            ),
        )
        text = (response.text or "").strip()
        if not text:
            finish = response.candidates[0].finish_reason if response.candidates else None
            raise RuntimeError(f"語音辨識沒有產生文字（{finish.value if finish else '沒有候選回應'}）")
        return Transcript(text)


class LocalASRTranscriber:
    """CARE 的語音辨識服務。輸出是簡體、專有名詞常錯成同音字，轉完先交給 asr_cleanup 整理。"""

    def __init__(self, url: str, http: httpx.Client | None = None):
        self.url = url.rstrip("/")
        self.http = http or httpx.Client(timeout=LOCAL_ASR_TIMEOUT_SECONDS)

    def transcribe(self, audio: bytes, mime_type: str, hotwords: list[str]) -> Transcript:
        base = mime_type.split(";")[0].strip().lower()
        response = self.http.post(
            f"{self.url}/transcribe",
            files={"file": (f"audio{AUDIO_SUFFIXES.get(base, '')}", audio, base or "application/octet-stream")},
            data={"language": LOCAL_ASR_LANGUAGE},
        )
        response.raise_for_status()
        body = response.json()
        text = HomophoneFixer(hotwords).fix(to_taiwan(body.get("text") or "")).strip()
        if not text:
            raise RuntimeError("語音辨識沒有產生文字")
        return Transcript(text, body.get("duration"))


class FallbackTranscriber:
    """主要來源連不上、逾時或回錯誤，就改用備援；其中一邊停了，錄音照樣轉得出來。"""

    def __init__(self, primary: Transcriber, backup: Transcriber):
        self.primary = primary
        self.backup = backup

    def transcribe(self, audio: bytes, mime_type: str, hotwords: list[str]) -> Transcript:
        try:
            return self.primary.transcribe(audio, mime_type, hotwords)
        except Exception:
            log.warning("語音辨識的主要來源失敗，改用備援", exc_info=True)
            return self.backup.transcribe(audio, mime_type, hotwords)


def _gemini(config: Settings) -> Transcriber:
    return GeminiTranscriber(gemini_client(config.asr_api_key), config.asr_model or DEFAULT_GEMINI_ASR_MODEL)


def _local(config: Settings) -> Transcriber:
    if not config.asr_url:
        raise NotConfigured("CARE 語音辨識服務的網址（ASR_URL）還沒設定")
    return LocalASRTranscriber(config.asr_url)


SOURCES = {"gemini": _gemini, "local": _local}


def get_transcriber() -> Transcriber:
    config = settings()
    if not config.asr_provider:
        raise NotConfigured("語音辨識服務還沒設定")
    if config.asr_provider not in SOURCES:
        raise NotConfigured(f"還不支援這個語音辨識服務：{config.asr_provider}")
    primary = SOURCES[config.asr_provider](config)
    backup_name = next(name for name in SOURCES if name != config.asr_provider)
    try:
        backup = SOURCES[backup_name](config)
    except NotConfigured:
        return primary
    return FallbackTranscriber(primary, backup)
