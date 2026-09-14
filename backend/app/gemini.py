"""Gemini 用戶端：embedding、語音辨識、語音問答用的，逾時與重試跟 app/llm.py 的 GeminiLLM 一致。"""

from google import genai
from google.genai import types

from app.config import NotConfigured, settings
from app.llm import REQUEST_TIMEOUT_MS, RETRY_ATTEMPTS


def gemini_client(api_key: str) -> genai.Client:
    """api_key 是這項功能自己的金鑰。沒填、而且 AI 模型也選 Gemini 時，沿用 AI 模型那把：同一家供應商一把金鑰就夠。"""
    config = settings()
    key = api_key or (config.llm_api_key if config.llm_provider == "gemini" else "")
    # 還是沒有就交給 SDK 自己找（GEMINI_API_KEY 或 GOOGLE_API_KEY 環境變數），跟 GeminiLLM 一樣；都找不到就是還沒設定
    try:
        return genai.Client(
            api_key=key or None,
            http_options=types.HttpOptions(
                timeout=REQUEST_TIMEOUT_MS, retry_options=types.HttpRetryOptions(attempts=RETRY_ATTEMPTS)
            ),
        )
    except ValueError as exc:
        raise NotConfigured("Gemini 金鑰還沒設定") from exc
