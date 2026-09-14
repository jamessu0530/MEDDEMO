"""把文字轉成向量（語意檢索用）。供應商由設定決定；沒設定就丟 NotConfigured，檢索只走關鍵字。"""

from typing import Any, Protocol

from google.genai import types

from app.config import NotConfigured, settings
from app.gemini import gemini_client

# 穩定版的純文字 embedding 模型，CARE 用的也是它。用預設的 3072 維：文件只有一百多段，不必為了省空間縮維度
DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-001"
# batchEmbedContents 一次最多 100 段，超過會回 400「at most 100 requests can be in one batch」
BATCH_SIZE = 100


class Embedder(Protocol):
    # 文件段落與提問分開算：Gemini 建議段落用 RETRIEVAL_DOCUMENT、提問用 RETRIEVAL_QUERY（embeddings 文件的任務類型）
    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


class GeminiEmbedder:
    def __init__(self, client: Any, model: str):
        self.client = client
        self.model = model

    def _embed(self, texts: list[str], task_type: str) -> list[list[float]]:
        result = self.client.models.embed_content(
            model=self.model, contents=texts, config=types.EmbedContentConfig(task_type=task_type)
        )
        return [embedding.values for embedding in result.embeddings]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for start in range(0, len(texts), BATCH_SIZE):
            vectors += self._embed(texts[start : start + BATCH_SIZE], "RETRIEVAL_DOCUMENT")
        return vectors

    def embed_query(self, text: str) -> list[float]:
        return self._embed([text], "RETRIEVAL_QUERY")[0]


def get_embedder() -> Embedder:
    config = settings()
    if config.embedding_provider == "gemini":
        return GeminiEmbedder(gemini_client(config.embedding_api_key), config.embedding_model or DEFAULT_GEMINI_EMBEDDING_MODEL)
    if not config.embedding_provider:
        raise NotConfigured("embedding 服務還沒設定")
    raise NotConfigured(f"還不支援這個 embedding 服務：{config.embedding_provider}")


def optional_embedder() -> Embedder | None:
    try:
        return get_embedder()
    except NotConfigured:
        return None
