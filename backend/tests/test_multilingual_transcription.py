"""CARE 的五種外語：SDK 與備援送出正確語言，逐字稿保留原文。"""

import httpx
import pytest
from gemini_offline import offline_client

from app.config import NotConfigured
from app.services import transcription
from app.services.speech_languages import LANGUAGE_NAMES
from app.services.transcription import GeminiTranscriber, LocalASRTranscriber

SAMPLES = [
    ("en", "The pharmacy wants twenty boxes of fish oil, not ten."),
    ("ja", "薬局は魚油を二十箱注文したい。十箱ではない。"),
    ("id", "Apotek ingin dua puluh kotak minyak ikan, bukan sepuluh."),
    ("vi", "Nhà thuốc muốn đặt hai mươi hộp dầu cá, không phải mười hộp."),
    ("th", "ร้านขายยาต้องการน้ำมันปลายี่สิบกล่อง ไม่ใช่สิบกล่อง"),
]


@pytest.mark.parametrize(("language", "spoken"), SAMPLES)
def test_gemini_hears_the_selected_language_without_translating_the_transcript(monkeypatch, language, spoken):
    reply = {"candidates": [{"content": {"parts": [{"text": spoken}]}, "finishReason": "STOP"}]}
    client, sent = offline_client(monkeypatch, reply)
    result = GeminiTranscriber(client, "gemini-3.8-flash", language).transcribe(b"fake-audio", "audio/mp4", ["魚油"])
    assert result.text == spoken
    audio, prompt = sent[0]["body"]["contents"][0]["parts"]
    assert audio["inlineData"]["mimeType"] == "audio/m4a"
    assert LANGUAGE_NAMES[language] in prompt["text"]
    assert "不要翻譯成中文" in prompt["text"]
    assert "魚油" not in prompt["text"], "外語聽寫不應帶入整批中文商品熱詞"


@pytest.mark.parametrize(("language", "spoken"), SAMPLES)
def test_local_backup_sends_the_same_language_and_keeps_original_spelling(language, spoken, monkeypatch):
    sent = []

    def handler(request):
        sent.append(request.content)
        return httpx.Response(200, json={"text": spoken, "duration": 12.0})

    monkeypatch.setattr(transcription, "HomophoneFixer", lambda words: pytest.fail("外語不可套用中文諧音修正"))
    local = LocalASRTranscriber("https://asr.test", httpx.Client(transport=httpx.MockTransport(handler)), language=language)
    result = local.transcribe(b"fake-audio", "audio/webm", ["魚油"])
    assert result.text == spoken and result.duration_seconds == 12.0
    assert f'name="language"\r\n\r\n{language}'.encode() in sent[0]


@pytest.mark.parametrize(("language", "spoken"), SAMPLES)
def test_language_survives_failure_of_the_primary_recognizer(env, monkeypatch, language, spoken):
    env(ASR_PROVIDER="gemini", ASR_API_KEY="test-key", ASR_URL="https://asr.test")
    chosen = transcription.get_transcriber(language)
    sent = []

    def unavailable(*args):
        raise httpx.ConnectError("Gemini unavailable")

    def handler(request):
        sent.append(request.content)
        return httpx.Response(200, json={"text": spoken})

    monkeypatch.setattr(chosen.primary, "transcribe", unavailable)
    chosen.backup.http = httpx.Client(transport=httpx.MockTransport(handler))
    assert chosen.transcribe(b"fake-audio", "audio/webm", ["魚油"]).text == spoken
    assert f'name="language"\r\n\r\n{language}'.encode() in sent[0]


def test_taiwanese_and_unknown_languages_cannot_be_forced_through_the_mandarin_provider():
    for language in ("nan-TW", "not-a-language"):
        with pytest.raises(NotConfigured, match="錄音語言"):
            transcription.get_transcriber(language)
