"""Gemini 的 embedding 與語音辨識：不連網路，攔下 SDK 準備送出的請求來檢查內容。"""

import base64

import pytest
from gemini_offline import offline_client, text_reply
from google.genai import types

from app.config import NotConfigured
from app.embeddings import GeminiEmbedder, get_embedder
from app.services import transcription
from app.services.transcription import GeminiTranscriber, gemini_audio_mime, get_transcriber


def vectors(count):
    return {"embeddings": [{"values": [float(i), 0.5]} for i in range(count)]}


def test_documents_are_embedded_in_batches_of_100_as_retrieval_documents(monkeypatch):
    client, sent = offline_client(monkeypatch, vectors(100), vectors(50))
    result = GeminiEmbedder(client, "gemini-embedding-001").embed_documents([f"段落 {i}" for i in range(150)])
    assert len(result) == 150
    assert [len(call["body"]["requests"]) for call in sent] == [100, 50]
    assert {request["taskType"] for call in sent for request in call["body"]["requests"]} == {"RETRIEVAL_DOCUMENT"}


def test_a_question_is_embedded_as_a_retrieval_query(monkeypatch):
    client, sent = offline_client(monkeypatch, vectors(1))
    assert GeminiEmbedder(client, "gemini-embedding-001").embed_query("近效期怎麼退貨") == [0.0, 0.5]
    assert sent[0]["path"] == "models/gemini-embedding-001:batchEmbedContents"
    assert sent[0]["body"]["requests"][0]["taskType"] == "RETRIEVAL_QUERY"


def test_choosing_gemini_without_any_key_counts_as_not_configured(env):
    env(EMBEDDING_PROVIDER="gemini", ASR_PROVIDER="gemini")
    with pytest.raises(NotConfigured):
        get_embedder()
    with pytest.raises(NotConfigured):
        get_transcriber()


def test_features_without_their_own_key_share_the_ai_model_key(env):
    env(LLM_PROVIDER="gemini", LLM_API_KEY="shared-key", EMBEDDING_PROVIDER="gemini", ASR_PROVIDER="gemini")
    assert get_embedder().client._api_client.api_key == "shared-key"
    assert get_transcriber().client._api_client.api_key == "shared-key"


@pytest.mark.parametrize(
    ("browser", "gemini"),
    [
        ("audio/webm;codecs=opus", "audio/webm"),  # Chrome、Android
        ("audio/mp4", "audio/m4a"),  # iOS Safari
        ("audio/ogg;codecs=opus", "audio/ogg"),
    ],
)
def test_browser_recording_types_become_names_gemini_accepts(browser, gemini):
    assert gemini_audio_mime(browser) == gemini


def test_the_recording_is_sent_together_with_the_hotwords(monkeypatch):
    client, sent = offline_client(monkeypatch, text_reply(" 今天去康泰忠孝店。\n"))
    transcript = GeminiTranscriber(client, "gemini-3.8-flash").transcribe(b"fake-audio", "audio/mp4", ["御松田", "魚油"])
    assert transcript.text == "今天去康泰忠孝店。"
    audio, prompt = sent[0]["body"]["contents"][0]["parts"]
    assert audio["inlineData"] == {"data": base64.b64encode(b"fake-audio").decode(), "mimeType": "audio/m4a"}
    assert "御松田、魚油" in prompt["text"]


def test_a_long_recording_is_uploaded_before_transcribing(monkeypatch):
    client, sent = offline_client(monkeypatch, text_reply("逐字稿"))
    uploaded = types.File(name="files/abc", uri="https://generativelanguage.googleapis.com/v1beta/files/abc", mime_type="audio/webm")
    monkeypatch.setattr(client.files, "upload", lambda file, config: uploaded)
    monkeypatch.setattr(transcription, "INLINE_AUDIO_LIMIT", 4)
    GeminiTranscriber(client, "gemini-3.8-flash").transcribe(b"fake-audio", "audio/webm", [])
    assert sent[0]["body"]["contents"][0]["parts"][0]["fileData"]["fileUri"] == uploaded.uri


def test_a_transcription_without_text_is_an_error(monkeypatch):
    client, _ = offline_client(monkeypatch, {"candidates": [{"content": {"parts": []}, "finishReason": "SAFETY"}]})
    with pytest.raises(RuntimeError, match="SAFETY"):
        GeminiTranscriber(client, "gemini-3.8-flash").transcribe(b"fake-audio", "audio/webm", [])
