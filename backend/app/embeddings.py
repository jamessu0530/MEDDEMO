"""把文字、照片、PDF 轉成向量（語意檢索用）。供應商由設定決定；沒設定就丟 NotConfigured，檢索只走關鍵字。

用 gemini-embedding-2：文字、圖片、PDF 在同一個向量空間，拿照片找得到文件、拿文字找得到照片
（docs/superpowers/specs/2026-10-01-attachments-design.md）。它跟 gemini-embedding-001 的向量不相容，換模型要重算。
"""

from collections.abc import Sequence
from typing import Any, Protocol

from google.genai import types

from app.config import NotConfigured, settings
from app.gemini import gemini_client
from app.llm import Media

# 多模態的 embedding 模型。用預設的 3072 維：文件只有一百多段、附件幾百個，不必為了省空間縮維度
DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-2"
# batchEmbedContents 一次最多 100 段，超過會回 400「at most 100 requests can be in one batch」
BATCH_SIZE = 100
# embedding-2 一次請求最多 6 張圖；PDF 一次一份（一份最多 6 頁，長的由呼叫端先切段）
IMAGES_PER_REQUEST = 6
PDF = "application/pdf"


class EmbeddingError(RuntimeError):
    """回來的向量數跟送出去的對不上。不能默默錯位：錯位的向量會讓檢索找到別的段落。"""


class Embedder(Protocol):
    # 文件與提問的寫法不同（embedding-2 把任務寫在文字前面，見 document_text、query_text）
    def embed_documents(self, documents: Sequence[tuple[str | None, str]]) -> list[list[float]]: ...

    def embed_query(self, text: str, media: Sequence[Media] = ()) -> list[float]: ...

    def embed_media(self, items: Sequence[Media]) -> list[list[float]]: ...


def document_text(title: str | None, text: str) -> str:
    return f"title: {title or 'none'} | text: {text}"


def query_text(text: str) -> str:
    return f"task: search result | query: {text}"


def _content(*parts: types.Part) -> types.Content:
    return types.Content(parts=list(parts))


def _file(item: Media) -> types.Part:
    data, mime_type = item
    return types.Part.from_bytes(data=data, mime_type=mime_type)


class GeminiEmbedder:
    def __init__(self, client: Any, model: str):
        self.client = client
        self.model = model

    def _embed(self, contents: list[types.Content]) -> list[list[float]]:
        # 每個 Content 一個向量。embedding-2 會把同一個 Content 裡的東西合成一個向量，
        # SDK 收到一串字串時也會併成同一個 Content，所以一律自己包好再送
        result = self.client.models.embed_content(model=self.model, contents=contents)
        vectors = [embedding.values for embedding in result.embeddings or []]
        if len(vectors) != len(contents):
            raise EmbeddingError(f"送出 {len(contents)} 個、拿回 {len(vectors)} 個向量")
        return vectors

    def embed_documents(self, documents: Sequence[tuple[str | None, str]]) -> list[list[float]]:
        contents = [_content(types.Part.from_text(text=document_text(title, text))) for title, text in documents]
        vectors: list[list[float]] = []
        for start in range(0, len(contents), BATCH_SIZE):
            vectors += self._embed(contents[start : start + BATCH_SIZE])
        return vectors

    def embed_query(self, text: str, media: Sequence[Media] = ()) -> list[float]:
        """提問一個向量。附了照片就把照片和問題放進同一個 Content 合成一個向量（「這個盒子的藥怎麼賣」要一起算）；
        官方文件說多模態輸入的文字部分不要寫任務，所以這時不加前綴。"""
        if not media:
            return self._embed([_content(types.Part.from_text(text=query_text(text)))])[0]
        parts = [_file(item) for item in media]
        if text.strip():
            parts.append(types.Part.from_text(text=text))
        return self._embed([_content(*parts)])[0]

    def embed_media(self, items: Sequence[Media]) -> list[list[float]]:
        """一個檔案一個向量，順序跟傳進來的一樣。圖片一次最多 6 張，PDF 一次一份。"""
        vectors: list[list[float]] = []
        images: list[types.Content] = []

        def flush() -> None:
            nonlocal vectors
            if images:
                vectors += self._embed(images)
                images.clear()

        for item in items:
            if item[1] == PDF:
                flush()
                vectors += self._embed([_content(_file(item))])
                continue
            images.append(_content(_file(item)))
            if len(images) == IMAGES_PER_REQUEST:
                flush()
        flush()
        return vectors


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
