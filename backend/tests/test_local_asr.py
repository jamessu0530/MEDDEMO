"""CARE 的語音辨識（local-asr）：送出錄音、簡體轉正體、用熱詞修同音字，以及跟 Gemini 互為備援。不連網路。"""

import httpx
import pytest

from app.services import transcription
from app.services.asr_cleanup import HomophoneFixer, to_taiwan
from app.services.transcription import FallbackTranscriber, GeminiTranscriber, LocalASRTranscriber, Transcript

# 9/14 在 care-vm 實測，同一段合成口述經 faster-whisper small 的原始輸出（節錄）
CARE_OUTPUT = "今天去康泰联所邀局中校店,跟店长聊了一下。玉松田有来谈,条件比我们好。他想先进于游20盒。"
HOTWORDS = ["康泰連鎖藥局 · 忠孝店", "康泰連鎖藥局", "忠孝店", "御松田", "魚油", "退貨", "檔期"]


def local(handler):
    return LocalASRTranscriber("http://asr.test:8200/", httpx.Client(transport=httpx.MockTransport(handler)))


def test_care_output_becomes_taiwan_traditional_with_our_terms():
    sent = {}

    def handler(request: httpx.Request):
        sent["url"], sent["body"] = str(request.url), request.content
        return httpx.Response(200, json={"text": CARE_OUTPUT, "duration": 19.0})

    transcript = local(handler).transcribe(b"audio-bytes", "audio/webm;codecs=opus", HOTWORDS)
    assert transcript.text == "今天去康泰連鎖藥局忠孝店，跟店長聊了一下。御松田有來談，條件比我們好。他想先進魚油20盒。"
    assert transcript.duration_seconds == 19.0
    assert sent["url"] == "http://asr.test:8200/transcribe"
    assert b'filename="audio.webm"' in sent["body"] and b"audio-bytes" in sent["body"]
    assert b'name="language"\r\n\r\nzh' in sent["body"]


def test_two_character_terms_are_only_replaced_when_the_tones_match_too():
    fixer = HomophoneFixer(["退貨", "魚油"])
    assert fixer.fix("他們想推貨") == "他們想推貨"  # 推 tuī、退 tuì，換了意思就反過來
    assert fixer.fix("先進於遊二十盒") == "先進魚油二十盒"


def test_accent_mergers_and_one_wrong_syllable_in_long_terms_are_fixed():
    # 9/15 十句實測裡剩下的錯字：前後鼻音、捲舌、長詞錯一個音節、多音字
    fixer = HomophoneFixer(["福安連鎖藥局 · 信義店", "正心藥局 · 楠梓", "近效期", "綜合維他命", "康普樂"])
    assert fixer.fix("興意店說敬孝其的貨太多") == "信義店說近效期的貨太多"
    assert fixer.fix("振興要舉男子的慢箋客人變多") == "正心藥局楠梓的慢箋客人變多"
    assert fixer.fix("順便報價縱合為他們") == "順便報價綜合維他命"
    assert fixer.fix("康普越的葉黃素") == "康普樂的葉黃素"


def test_punctuation_becomes_full_width_but_numbers_stay():
    assert to_taiwan("价格1.5倍,可以吗?") == "價格1.5倍，可以嗎？"


def test_care_errors_are_raised_so_the_backup_can_take_over():
    with pytest.raises(httpx.HTTPStatusError):
        local(lambda request: httpx.Response(503, json={"detail": "busy"})).transcribe(b"a", "audio/webm", [])
    with pytest.raises(RuntimeError):
        local(lambda request: httpx.Response(200, json={"text": " "})).transcribe(b"a", "audio/webm", [])


class Broken:
    def transcribe(self, audio, mime_type, hotwords):
        raise httpx.ConnectError("CARE 的語音辨識服務停了")


class Backup:
    def transcribe(self, audio, mime_type, hotwords):
        return Transcript("備援轉出來的逐字稿")


def test_when_the_main_source_fails_the_backup_transcribes():
    assert FallbackTranscriber(Broken(), Backup()).transcribe(b"a", "audio/webm", []).text == "備援轉出來的逐字稿"


def test_the_main_source_and_its_backup_follow_the_settings(env):
    env(ASR_PROVIDER="local", ASR_URL="http://asr.test:8200")
    # 找不到 Gemini 金鑰：只有 CARE 的服務，沒有備援
    assert isinstance(transcription.get_transcriber(), LocalASRTranscriber)

    env(LLM_PROVIDER="gemini", LLM_API_KEY="test-key")
    chosen = transcription.get_transcriber()
    assert isinstance(chosen.primary, LocalASRTranscriber) and isinstance(chosen.backup, GeminiTranscriber)

    env(ASR_PROVIDER="gemini")
    chosen = transcription.get_transcriber()
    assert isinstance(chosen.primary, GeminiTranscriber) and isinstance(chosen.backup, LocalASRTranscriber)
