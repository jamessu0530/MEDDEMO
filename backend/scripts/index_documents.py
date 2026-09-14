"""重建內部文件的索引（關鍵字＋向量），不動其他資料。

    uv run --project backend python backend/scripts/index_documents.py

改了 data/documents 的文件，或設定、更換了 embedding 之後跑一次。
有設定 embedding 就會真的呼叫外部服務：一次最多送 100 段，目前 102 段要 2 次。
"""

import sys
from pathlib import Path

# macOS 上 .venv 會被標成隱藏，Python 就略過可編輯安裝的 .pth、找不到 app；直接把 backend 加進搜尋路徑
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select  # noqa: E402

from app.db import session_factory  # noqa: E402
from app.embeddings import optional_embedder  # noqa: E402
from app.models import DocumentChunk  # noqa: E402
from app.services.documents import index_documents  # noqa: E402


def main() -> None:
    embedder = optional_embedder()
    with session_factory()() as session:
        count = index_documents(session, embed=embedder.embed_documents if embedder else None)
        session.commit()
        with_vectors = session.scalar(
            select(func.count()).select_from(DocumentChunk).where(DocumentChunk.embedding.is_not(None))
        )
    note = "" if embedder else "（沒有設定 embedding，只建關鍵字索引）"
    print(f"文件段落 {count} 段，有向量的 {with_vectors} 段{note}")


if __name__ == "__main__":
    main()
