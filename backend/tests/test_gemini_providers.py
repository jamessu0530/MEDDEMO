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


def texts_of(request):
    return [part.get("text") for part in request["content"]["parts"]]


def test_documents_are_embedded_one_vector_each_in_batches_of_100(monkeypatch):
    client, sent = offline_client(monkeypatch, vectors(100), vectors(50))
    documents = [(f"近效期退貨｜第 {i} 條", f"段落 {i}") for i in range(150)]
    result = GeminiEmbedder(client, "gemini-embedding-2").embed_documents(documents)
    assert len(result) == 150
    assert sent[0]["path"] == "models/gemini-embedding-2:batchEmbedContents"
    # embedding-2 把同一個 Content 裡的東西合成一個向量：每段一定要各包一個 Content，不然 150 段只回一個向量
    assert [len(call["body"]["requests"]) for call in sent] == [100, 50]
    assert texts_of(sent[0]["body"]["requests"][3]) == ["title: 近效期退貨｜第 3 條 | text: 段落 3"]
    # embedding-2 沒有 task_type，任務寫在文字前面
    assert all("taskType" not in request for call in sent for request in call["body"]["requests"])


def test_a_document_without_a_title_says_so():
    from app.embeddings import document_text

    assert document_text(None, "內容") == "title: none | text: 內容"


def test_a_question_is_embedded_as_a_search_query(monkeypatch):
    client, sent = offline_client(monkeypatch, vectors(1))
    assert GeminiEmbedder(client, "gemini-embedding-2").embed_query("近效期怎麼退貨") == [0.0, 0.5]
    [request] = sent[0]["body"]["requests"]
    assert texts_of(request) == ["task: search result | query: 近效期怎麼退貨"]


def test_a_question_with_a_photo_becomes_one_vector_without_the_task_prefix(monkeypatch):
    client, sent = offline_client(monkeypatch, vectors(1))
    vector = GeminiEmbedder(client, "gemini-embedding-2").embed_query("這個盒子的藥怎麼賣", media=[(b"jpeg-bytes", "image/jpeg")])
    assert vector == [0.0, 0.5]
    [request] = sent[0]["body"]["requests"]
    image, question = request["content"]["parts"]
    assert image["inline_data"] == {"data": base64.b64encode(b"jpeg-bytes").decode(), "mime_type": "image/jpeg"}
    # 官方文件：多模態輸入的文字部分不要寫任務
    assert question["text"] == "這個盒子的藥怎麼賣"


def test_only_a_photo_is_fine_too(monkeypatch):
    client, sent = offline_client(monkeypatch, vectors(1))
    GeminiEmbedder(client, "gemini-embedding-2").embed_query("  ", media=[(b"png", "image/png")])
    [request] = sent[0]["body"]["requests"]
    assert [list(part) for part in request["content"]["parts"]] == [["inline_data"]]


def test_files_get_a_vector_each_with_at_most_six_images_or_one_pdf_per_request(monkeypatch):
    client, sent = offline_client(monkeypatch, vectors(6), vectors(1), vectors(2))
    # 第 7 個是 PDF：前面 6 張一批、PDF 自己一批，後面兩張圖再一批
    items = [(b"img", "image/jpeg")] * 6 + [(b"%PDF", "application/pdf")] + [(b"img", "image/png"), (b"img", "image/jpeg")]
    result = GeminiEmbedder(client, "gemini-embedding-2").embed_media(items)
    assert len(result) == 9
    assert [len(call["body"]["requests"]) for call in sent] == [6, 1, 2]
    assert sent[1]["body"]["requests"][0]["content"]["parts"][0]["inline_data"]["mime_type"] == "application/pdf"


def test_a_short_reply_is_an_error_not_a_silent_mismatch(monkeypatch):
    from app.embeddings import EmbeddingError

    client, _ = offline_client(monkeypatch, vectors(1))
    with pytest.raises(EmbeddingError):
        GeminiEmbedder(client, "gemini-embedding-2").embed_documents([(None, "一"), (None, "二")])


def test_the_default_model_is_embedding_2(env):
    env(EMBEDDING_PROVIDER="gemini", EMBEDDING_API_KEY="k")
    assert get_embedder().model == "gemini-embedding-2"


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
