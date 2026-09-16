"""語音問答：後端只發臨時金鑰。不連網路，攔下 SDK 準備送給 Gemini 的請求，檢查鎖進金鑰的設定。"""

import datetime as dt
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from gemini_offline import offline_client
from google.genai import errors

from app.main import app
from app.services import voice

TOKEN = {"name": "auth_tokens/abc123", "uses": 1}


@pytest.fixture
def client(engine, sign_in):
    # 發金鑰時要從資料庫讀客戶與品項名稱，所以要先有灌好假資料的測試庫
    return sign_in(TestClient(app), "U01")


@pytest.fixture
def gemini(monkeypatch):
    """換上不連網路的用戶端，回傳它送出的請求清單。"""
    offline, sent = offline_client(monkeypatch, TOKEN)
    monkeypatch.setattr(voice, "gemini_client", lambda key: offline)
    return sent


def test_voice_needs_the_ai_model_that_answers_the_questions(client):
    response = client.post("/api/voice/session")
    assert response.status_code == 503
    assert "AI 模型還沒設定" in response.json()["detail"]


def test_voice_needs_a_gemini_key(client, env):
    env(LLM_PROVIDER="gemini")
    response = client.post("/api/voice/session")
    assert response.status_code == 503
    assert "Gemini 金鑰還沒設定" in response.json()["detail"]


def test_a_session_gets_a_single_use_token_with_the_whole_setup_locked(client, env, gemini):
    env(LLM_PROVIDER="gemini")
    session = client.post("/api/voice/session").json()
    assert session["token"] == "auth_tokens/abc123"
    assert session["model"] == voice.DEFAULT_VOICE_MODEL
    assert session["api_version"] == "v1beta"
    assert session["tool_kinds"] == {"query_data": "data", "search_knowledge": "knowledge"}

    request = gemini[0]
    assert request["path"] == "auth_tokens"
    body = request["body"]
    assert body["uses"] == 1
    assert "fieldMask" not in body  # 沒列要鎖的欄位＝整份設定鎖死，手機端改不了
    opens_within = dt.datetime.fromisoformat(body["newSessionExpireTime"])
    assert dt.datetime.fromisoformat(body["expireTime"]) - opens_within == dt.timedelta(minutes=29)

    setup = body["bidiGenerateContentSetup"]
    assert setup["model"] == f"models/{voice.DEFAULT_VOICE_MODEL}"
    instruction = setup["systemInstruction"]["parts"][0]["text"]
    assert "只能來自兩個工具" in instruction
    # 客戶名稱與熱詞放進系統指示，模型才會把「康太中孝店」理解成「康泰連鎖藥局 · 忠孝店」
    assert "康泰連鎖藥局 · 忠孝店" in instruction and "御松田" in instruction and "近效期" in instruction
    declarations = setup["tools"][0]["functionDeclarations"]
    assert [d["name"] for d in declarations] == ["query_data", "search_knowledge"]
    assert all("behavior" not in d for d in declarations)  # 同步呼叫：模型一定等查詢結果回來才回答
    assert "inputAudioTranscription" in setup and "outputAudioTranscription" in setup
    # 手機連線時帶的設定，跟鎖進金鑰的是同一份
    assert [d["name"] for d in session["config"]["tools"][0]["functionDeclarations"]] == ["query_data", "search_knowledge"]


def test_the_live_model_can_be_switched_in_the_settings(client, env, gemini):
    env(LLM_PROVIDER="gemini", VOICE_MODEL="gemini-3.1-flash-live-preview")
    session = client.post("/api/voice/session").json()
    assert session["model"] == "gemini-3.1-flash-live-preview"
    assert gemini[0]["body"]["bidiGenerateContentSetup"]["model"] == "models/gemini-3.1-flash-live-preview"


def test_a_rejected_key_is_reported_instead_of_crashing(client, env, monkeypatch):
    env(LLM_PROVIDER="gemini")

    class Tokens:
        def create(self, config):
            raise errors.ClientError(403, {"error": {"code": 403, "message": "API key not valid", "status": "PERMISSION_DENIED"}})

    class Rejecting:
        auth_tokens = Tokens()

    monkeypatch.setattr(voice, "gemini_client", lambda key: Rejecting())
    response = client.post("/api/voice/session")
    assert response.status_code == 502
    assert "403" in response.json()["detail"]


def test_the_client_stays_open_until_the_token_request_is_sent(client, env, monkeypatch):
    # genai.Client 被回收時會關掉連線。寫成 gemini_client(key).auth_tokens.create(...) 的話，
    # 用戶端在送出請求前就被回收，真的連 Gemini 會報「client has been closed」；上面的假用戶端都測不出來
    env(LLM_PROVIDER="gemini")
    closed = []

    class Tokens:
        def create(self, config):
            assert not closed, "送出請求前用戶端就被關掉了"
            return SimpleNamespace(name="auth_tokens/abc123")

    class ClosesWhenCollected:
        auth_tokens = Tokens()

        def __del__(self):
            closed.append(True)

    monkeypatch.setattr(voice, "gemini_client", lambda key: ClosesWhenCollected())
    assert client.post("/api/voice/session").status_code == 200
