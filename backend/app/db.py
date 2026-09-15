"""資料庫連線與建表。"""

import hashlib
from collections.abc import Iterator
from functools import cache
from pathlib import Path

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.models import Base

MODELS = Path(__file__).parent / "models.py"
SEMANTIC_LAYER = Path(__file__).parent / "sql" / "semantic_layer.sql"
# 假資料的產生程式；映像檔裡放在 /srv/data/seed，跟 /srv/backend 同一層（見 backend/Dockerfile）
SEED_DIR = Path(__file__).resolve().parents[2] / "data" / "seed"


def database_url() -> str:
    url = settings().database_url
    # 沒指定驅動時 SQLAlchemy 預設找 psycopg2，本專案裝的是 psycopg 3
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return url


def make_engine(url: str | None = None) -> Engine:
    # pool_pre_ping：資料庫重啟後，連線池裡失效的舊連線會先被換掉，API 不會因此回 500
    return create_engine(url or database_url(), pool_pre_ping=True)


@cache
def session_factory() -> sessionmaker[Session]:
    return sessionmaker(make_engine())


def get_session() -> Iterator[Session]:
    """FastAPI 相依注入用：每個請求一個 session，請求結束就關閉。"""
    with session_factory()() as session:
        yield session


def schema_version() -> str:
    """資料表、語意層與假資料產生程式的指紋。部署時跟資料庫裡記下的比對，不一樣就代表要重建。

    假資料的產生程式也算進來：測試與評測題庫的答案都照它的產出寫，程式改了 VM 上的資料就要跟著換。
    部署流程在 runner 上用 sha256sum 算同一個值（四個檔案依序接起來取前 12 碼），改算法要一起改。
    """
    digest = hashlib.sha256()
    for path in (MODELS, SEMANTIC_LAYER, SEED_DIR / "generate.py", SEED_DIR / "catalog.py"):
        digest.update(path.read_bytes())
    return digest.hexdigest()[:12]


def reset_schema(engine: Engine) -> None:
    """清掉整個 public schema 後重建：資料表來自 models，函式與 View 來自 semantic_layer.sql。"""
    with engine.begin() as conn:
        conn.exec_driver_sql("DROP SCHEMA public CASCADE")
        conn.exec_driver_sql("CREATE SCHEMA public")
        conn.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS vector")
        Base.metadata.create_all(conn)
        # no_parameters：整份檔案原樣交給資料庫，裡面的 % 不會被當成參數符號
        conn.exec_driver_sql(
            SEMANTIC_LAYER.read_text(encoding="utf-8"),
            execution_options={"no_parameters": True},
        )
