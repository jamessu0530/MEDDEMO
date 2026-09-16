"""錄音時的即時轉錄（FR-4.2）：後端只發臨時金鑰。不連網路，攔下 SDK 準備送給 Gemini 的請求來檢查。"""

import re

import pytest
from fastapi.testclient import TestClient
from gemini_offline import offline_client

from app.main import app
from app.services import live_transcription, voice


@pytest.fixture
def client(engine, sign_in):
    return sign_in(TestClient(app), "U01")


def field(obj, camel):
    """google-genai 2.23 發臨時金鑰時，巢狀的轉錄設定用 snake_case（language_codes），外層是 camelCase；
    Google 的 JSON API 兩種寫法都收（proto3 JSON 對照規則），這裡兩種都認，SDK 改寫法也不會誤判。"""
    snake = re.sub(r"[A-Z]", lambda m: "_" + m.group(0).lower(), camel)
    return obj.get(camel, obj.get(snake))


def test_live_transcription_needs_a_gemini_key(client):
    response = client.post("/api/transcription/session", json={"customer_id": "C001"})
    assert response.status_code == 503
    assert "Gemini 金鑰還沒設定" in response.json()["detail"]


def test_the_token_locks_a_transcription_only_session_with_our_vocabulary(client, monkeypatch):
    offline, sent = offline_client(monkeypatch, {"name": "auth_tokens/t1"})
    monkeypatch.setattr(voice, "gemini_client", lambda key: offline)
    session = client.post("/api/transcription/session", json={"customer_id": "C001"}).json()
    assert session["token"] == "auth_tokens/t1"
    assert session["model"] == live_transcription.DEFAULT_MODEL

    body = sent[0]["body"]
    assert body["uses"] == 1 and "fieldMask" not in body
    setup = body["bidiGenerateContentSetup"]
    assert setup["model"] == f"models/{live_transcription.DEFAULT_MODEL}"
    assert setup["generationConfig"]["responseModalities"] == ["TEXT"]
    transcription = setup["inputAudioTranscription"]
    assert field(transcription, "languageCodes") == ["zh-TW", "en-US"]
    assert transcription["mode"] == "SMART"
    words = field(transcription, "customVocabulary")
    # 這家客戶的名稱排最前面，競品與通路術語接著，總數不超過官方建議的 100 個
    assert words[:3] == ["康泰連鎖藥局 · 忠孝店", "康泰連鎖藥局", "忠孝店"]
    assert "御松田" in words and "上架費" in words and len(words) <= 100
