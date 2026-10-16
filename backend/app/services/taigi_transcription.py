"""Taigi AI Labs 台語拜訪錄音：完整辨識後才交給現有欄位抽取。

API 的 best 是台語漢字，保留為逐字稿讓使用者核對；不套用華語的拼音同音字
修正，也不先翻譯原文。廠商這個端點只送音檔，不假設支援熱詞參數；名稱強化
在 visit_processing / extraction 以原音、完整型錄候選與商家候選核對，sources 仍引用台語原話。
"""

import logging
import time
from contextlib import nullcontext

import httpx

from app.services import speech_audio
from app.services.transcription import Transcript

log = logging.getLogger(__name__)
STT_PATH = "/taigiSTT/stt_best_billing"
REQUEST_TIMEOUT_SECONDS = 15
# 留時間給後續抽欄位；RQ 的工作預設上限是 180 秒。
TOTAL_BUDGET_SECONDS = 90
RETRY_STATUSES = {500, 502, 503, 504}
# CARE 實測每分鐘約十次；切段與重試至少間隔六秒，避免單份長錄音連續突發。
# 其他服務共用金鑰仍可能撞到 429，此時保留錄音交給使用者稍後重試。
MIN_REQUEST_INTERVAL_SECONDS = 6


class TaigiTranscriber:
    def __init__(self, api_key: str, base_url: str, http: httpx.Client | None = None):
        self.api_key = api_key.strip()
        self.base_url = base_url.rstrip("/")
        self.http = http
        self._next_request_at = 0.0

    def transcribe(self, audio: bytes, mime_type: str, hotwords: list[str]) -> Transcript:
        deadline = time.monotonic() + TOTAL_BUDGET_SECONDS
        try:
            pcm = speech_audio.decode_recording(audio)
        except ValueError:
            raise
        except Exception as exc:
            raise RuntimeError("錄音檔無法讀取，請重新錄音") from exc

        parts = []
        with nullcontext(self.http) if self.http is not None else httpx.Client() as http:
            for chunk in speech_audio.split_on_pauses(pcm):
                # 一段失敗就停止整份，避免把不完整的內容當成完整紀錄。
                text = self._transcribe_chunk(http, speech_audio.as_wav(chunk), deadline)
                if text:
                    parts.append(text)
        if not parts:
            raise RuntimeError("沒有辨識到台語內容，請重新錄音或手動輸入")
        return Transcript("".join(parts), len(pcm) / speech_audio.BYTES_PER_SAMPLE / speech_audio.SAMPLE_RATE)

    def _transcribe_chunk(self, http: httpx.Client, wav: bytes, deadline: float) -> str:
        for attempt in range(2):
            now = time.monotonic()
            remaining = deadline - now
            wait = max(0.0, self._next_request_at - now)
            if remaining <= wait:
                raise RuntimeError("台語辨識等待過久，請稍後重試或縮短錄音")
            if wait:
                time.sleep(wait)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RuntimeError("台語辨識等待過久，請稍後重試或縮短錄音")
            self._next_request_at = time.monotonic() + MIN_REQUEST_INTERVAL_SECONDS
            try:
                response = http.post(
                    self.base_url + STT_PATH,
                    headers={"x-api-key": self.api_key},
                    files={"voiceFile": ("audio.wav", wav, "audio/wav")},
                    timeout=httpx.Timeout(min(REQUEST_TIMEOUT_SECONDS, remaining), connect=min(5, remaining)),
                )
            except httpx.HTTPError as exc:
                raise RuntimeError("台語辨識服務暫時連不上，請稍後重試或手動輸入") from exc
            if response.status_code in RETRY_STATUSES and attempt == 0:
                log.warning("台語辨識 HTTP %s，重試一次", response.status_code)
                continue
            # 429 不立刻重試：CARE 實測限流是分鐘級窗口，短暫退避還是會撞到。
            if response.status_code == 429:
                raise RuntimeError("台語辨識目前忙碌，請稍後重試或手動輸入")
            if response.status_code != 200:
                log.warning("台語辨識 HTTP %s", response.status_code)
                raise RuntimeError("台語辨識服務暫時無法使用，請稍後重試或手動輸入")
            try:
                payload = response.json()
            except ValueError as exc:
                raise RuntimeError("台語辨識結果無法讀取，請稍後重試") from exc
            if not isinstance(payload, dict) or "best" not in payload:
                raise RuntimeError("台語辨識結果格式不符，請稍後重試")
            best = payload["best"]
            if best is not None and not isinstance(best, str):
                raise RuntimeError("台語辨識結果格式不符，請稍後重試")
            return (best or "").strip()
        raise RuntimeError("台語辨識服務暫時無法使用，請稍後重試")
