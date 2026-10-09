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
# 組織樹：org_path 是灌資料時算出來寫進去的衍生欄位，演算法改了資料就得重算
ORG = Path(__file__).parent / "services" / "org.py"
# 向量的算法：換模型或改了文件與提問的寫法，段落向量就要重算
EMBEDDINGS = Path(__file__).parent / "embeddings.py"
# 應收帳款的到期日與金額照付款條件算，灌資料時也用它
PAYMENT_TERMS = Path(__file__).parent / "services" / "payment_terms.py"
# 假資料的產生程式；映像檔裡放在 /srv/data/seed，跟 /srv/backend 同一層（見 backend/Dockerfile）
SEED_DIR = Path(__file__).resolve().parents[2] / "data" / "seed"


def database_url() -> str:
    url = settings().database_url
    # 沒指定驅動時 SQLAlchemy 預設找 psycopg2，本專案裝的是 psycopg 3
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return url


# API 的同步端點與相依（get_session、current_user）在 anyio 的 threadpool 裡跑（預設 40 條執行緒），
# 一個請求在兩次換執行緒之間會一直拿著它的資料庫連線。連線池比執行緒少，很多人同時發言時，
# 拿著連線的請求等執行緒、佔著執行緒的請求等連線，整個 API 卡到連線池逾時（壓力測試找到的，
# docs/superpowers/specs/2026-10-01-channel-rail-design.md）。
# 連線池加大只是把互卡的門檻拉高，沒有消除：要所有連線都被等執行緒的請求拿著、40 條執行緒又都在等連線，
# 大約要同時有 100 個（連線 60 加執行緒 40）進行中的同步請求才會發生，以前大約 55 個就會。
# 真的發生時一樣要等到連線池逾時（30 秒）回 500。
# Postgres 預設 max_connections 是 100：API 最多 60 條，背景工作與 CronJob 平常各用一兩條
POOL_SIZE = 20
MAX_OVERFLOW = 40


def make_engine(url: str | None = None) -> Engine:
    # pool_pre_ping：資料庫重啟後，連線池裡失效的舊連線會先被換掉，API 不會因此回 500
    return create_engine(url or database_url(), pool_pre_ping=True, pool_size=POOL_SIZE, max_overflow=MAX_OVERFLOW)


@cache
def session_factory() -> sessionmaker[Session]:
    return sessionmaker(make_engine())


def get_session() -> Iterator[Session]:
    """FastAPI 相依注入用：每個請求一個 session，請求結束就關閉。"""
    with session_factory()() as session:
        yield session


def schema_version() -> str:
    """資料表、語意層、組織樹與假資料產生程式的指紋。部署時跟資料庫裡記下的比對，不一樣就代表要重建。

    假資料的產生程式也算進來：測試與評測題庫的答案都照它的產出寫，程式改了 VM 上的資料就要跟著換。
    services/org.py 同理：org_path 不是使用者填的欄位，是灌資料時算出來的，改了推導方式舊資料
    就是錯的，指紋要跟著動，不然部署不會重灌、每個人身上都留著過期的路徑。
    embeddings.py 也是：換模型或改了文件與提問的寫法，向量空間就變了，舊的段落向量跟新的提問比不起來，要重算。
    products.tsv 是真實型錄，品項表的一部分照它灌，改了一樣要重灌。
    services/payment_terms.py 也是：應收帳款的到期日與金額照它算。
    部署流程在 runner 上用 sha256sum 算同一個值（這幾個檔案依序接起來取前 12 碼），
    檔案清單與順序兩邊要一模一樣（.github/workflows/ci-cd.yml，test_seed.py 會比對）。
    """
    digest = hashlib.sha256()
    for path in (
        MODELS, SEMANTIC_LAYER, ORG, EMBEDDINGS, SEED_DIR / "generate.py", SEED_DIR / "catalog.py", SEED_DIR / "products.tsv",
        PAYMENT_TERMS,
    ):
        digest.update(path.read_bytes())
    return digest.hexdigest()[:12]


def reset_schema(engine: Engine) -> None:
    """清掉整個 public schema 後重建：資料表來自 models，函式與 View 來自 semantic_layer.sql。"""
    with engine.begin() as conn:
        conn.exec_driver_sql("DROP SCHEMA public CASCADE")
        conn.exec_driver_sql("CREATE SCHEMA public")
        conn.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS vector")
        # ltree：組織樹的路徑與祖先比對（services/scope.py）。Postgres 13 起是 trusted extension，
        # 資料庫擁有者不需要 superuser 就能建立
        conn.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS ltree")
        Base.metadata.create_all(conn)
        # no_parameters：整份檔案原樣交給資料庫，裡面的 % 不會被當成參數符號
        conn.exec_driver_sql(
            SEMANTIC_LAYER.read_text(encoding="utf-8"),
            execution_options={"no_parameters": True},
        )
