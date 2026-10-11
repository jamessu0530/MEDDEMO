"""沿用 CARE 的華語／台語逐字稿比較，使用者不必先選錄音語言。

兩路 AI 同時辨識；逐字稿很接近時採華語，差異大時採台語。
台語用字只調整比較門檻，不能單憑「食藥」等字把華語判成台語。
"""

import difflib
import logging
import re
from concurrent.futures import ThreadPoolExecutor

from app.services import speech_audio
from app.services.transcription import Transcript, Transcriber

log = logging.getLogger(__name__)
PUNCTUATION = re.compile(r"[\s，。？！、,.?!;:；：~～「」『』（）()]+")
TAIGI_CHARS = frozenset("毋袂佮蹛媠囥佗")
TAIGI_WORDS = (
    "啥物", "啥人", "按呢", "按怎", "哪會", "敢有", "囡仔", "歹勢", "有影",
    "逐工", "逐家", "規工", "這馬", "今仔日", "中晝", "下晡", "半暝", "正爿",
    "倒爿", "厝內", "真濟", "足濟", "袂記", "看覓", "食飯", "食藥", "食飽", "腹肚",
)


def looks_like_taiwanese(text: str) -> bool:
    return any(ch in TAIGI_CHARS for ch in text) or any(word in text for word in TAIGI_WORDS)


def choose_transcript(mandarin: Transcript | None, taiwanese: Transcript | None) -> Transcript | None:
    """CARE 的比較門檻；兩份都不可靠時交給使用者重試或手動輸入。"""
    if mandarin and taiwanese:
        limit = 0.65 if looks_like_taiwanese(taiwanese.text) else 0.50
        similarity = difflib.SequenceMatcher(
            None, PUNCTUATION.sub("", mandarin.text), PUNCTUATION.sub("", taiwanese.text),
            autojunk=False,
        ).ratio()
        return taiwanese if similarity < limit else mandarin
    if taiwanese and looks_like_taiwanese(taiwanese.text):
        return taiwanese
    return mandarin


class AutoTranscriber:
    def __init__(self, mandarin: Transcriber | None, taiwanese: Transcriber | None):
        self.mandarin = mandarin
        self.taiwanese = taiwanese

    def transcribe(self, audio: bytes, mime_type: str, hotwords: list[str]) -> Transcript:
        # 自動模式也可能使用 Taigi，因此全部錄音遵守相同的三分鐘上限。
        try:
            pcm = speech_audio.decode_recording(audio)
        except ValueError as exc:
            raise ValueError(str(exc).replace("台語錄音", "錄音")) from exc
        except Exception as exc:
            raise RuntimeError("錄音檔無法讀取，請重新錄音") from exc
        wav = speech_audio.as_wav(pcm)
        results: dict[str, Transcript | None] = {"mandarin": None, "taiwanese": None}
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = {
                name: pool.submit(provider.transcribe, wav, "audio/wav", hotwords)
                for name, provider in (("mandarin", self.mandarin), ("taiwanese", self.taiwanese))
                if provider is not None
            }
            for name, future in futures.items():
                try:
                    result = future.result()
                    if result.text.strip():
                        results[name] = result
                except Exception:
                    log.warning("自動語音辨識 %s 來源失敗", name, exc_info=True)
        selected = choose_transcript(results["mandarin"], results["taiwanese"])
        if selected is None:
            raise RuntimeError("無法確認錄音內容，請稍後重試或手動輸入逐字稿")
        note = selected.review_note
        if not results["mandarin"] or not results["taiwanese"]:
            unavailable = "華語" if not results["mandarin"] else "台語"
            warning = f"{unavailable}辨識暫時無法使用，這次未完成雙語比對；請核對逐字稿，必要時重試或手動修正。"
            note = f"{note}；{warning}" if note else warning
        return Transcript(selected.text, len(pcm) / speech_audio.BYTES_PER_SAMPLE / speech_audio.SAMPLE_RATE, note)
