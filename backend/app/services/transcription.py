"""語音轉文字（SDD 的 TranscriptionService）。

服務層不直接依賴特定供應商：供應商由設定決定，沒設定就丟 NotConfigured，
流程會停在「轉文字失敗」，讓業務重錄或手動輸入逐字稿。
"""

import io
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from google.genai import types
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import NotConfigured, settings
from app.gemini import gemini_client
from app.models import Product

HOTWORDS_FILE = Path(__file__).resolve().parents[1] / "resources" / "hotwords.txt"

# 跟抽欄位用同一個模型：聽寫加上照熱詞表寫品項名稱，Flash 就夠用
DEFAULT_GEMINI_ASR_MODEL = "gemini-3.8-flash"
# 音檔直接放在請求裡時，整個請求上限 20MB，音檔轉成 base64 會變成 4/3 倍；
# 超過 14MB 就改用 Files API 先上傳（ai.google.dev/gemini-api/docs/audio）
INLINE_AUDIO_LIMIT = 14 * 1024 * 1024
# Gemini 支援的音檔格式有 audio/m4a、沒有 audio/mp4；iOS 錄出來的 mp4 就是 m4a（同一種 MPEG-4 音訊）
MIME_ALIASES = {"audio/mp4": "audio/m4a", "audio/x-m4a": "audio/m4a"}

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


def load_hotwords(session: Session) -> list[str]:
    """熱詞 = 品項名稱與口語別名（資料庫）＋通路術語與競品（熱詞表檔案），去掉重複。"""
    words: list[str] = []
    for name, aliases in session.execute(select(Product.name, Product.aliases)):
        words += [name, *aliases]
    for line in HOTWORDS_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            words.append(line)
    return list(dict.fromkeys(words))


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


def get_transcriber() -> Transcriber:
    config = settings()
    if config.asr_provider == "gemini":
        return GeminiTranscriber(gemini_client(config.asr_api_key), config.asr_model or DEFAULT_GEMINI_ASR_MODEL)
    if not config.asr_provider:
        raise NotConfigured("語音辨識服務還沒設定")
    raise NotConfigured(f"還不支援這個語音辨識服務：{config.asr_provider}")
