"""拜訪錄音自動辨識華語／台語；舊版錄音語言保留供離線重送與歷史紀錄使用。"""

from typing import Literal

SpeechLanguage = Literal["zh-TW", "en", "ja", "id", "vi", "th"]
RecordingLanguage = Literal["auto", "zh-TW", "nan-TW", "en", "ja", "id", "vi", "th"]

LANGUAGE_NAMES = {
    "zh-TW": "繁體中文（台灣華語）",
    "en": "English",
    "ja": "日本語",
    "id": "Bahasa Indonesia",
    "vi": "Tiếng Việt",
    "th": "ภาษาไทย",
}
LIVE_LANGUAGE_CODES = {"en": "en-US", "ja": "ja-JP", "id": "id-ID", "vi": "vi-VN", "th": "th-TH"}
