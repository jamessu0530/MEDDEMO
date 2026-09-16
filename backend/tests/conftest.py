"""測試共用：另建 meddemo_test 資料庫並灌假資料，Redis 用第 15 號庫，都不動開發環境。"""

import os

import pytest
import seed
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.config import settings
from app.db import database_url, session_factory
from app.services.documents import index_documents
from app.tasks import redis

# 兩份展示用文件內容，供 docs fixture 建索引；test_asks.py 與 test_crag_retriever.py 都要用
RETURN_DOC = """# 近效期品項退貨作業規範

文件類型：作業規範｜版本：2026-07｜展示用虛構內容，非公司實際規定

## 近效期退貨的申請期限
近效期品項退貨須在效期剩餘六個月以前提出申請，逾期不受理。

## 近效期退貨的運費
近效期品項退貨的運費由公司負擔，業務需在 CRM 登記退貨單號。
"""

DISCOUNT_DOC = """# 報價權限與折扣審核

文件類型：業務守則｜版本：2026-07｜展示用虛構內容，非公司實際規定

## 業務可直接給的折扣
業務可直接給予百分之五以內的折扣，超過百分之五需要區處主管核准。
"""

# 同一台電腦上有兩份測試同時跑時，各自指定不同的庫名（與 TEST_REDIS_URL），才不會互相清掉對方的資料
TEST_DB = os.environ.get("TEST_DB_NAME", "meddemo_test")
BASE_URL = make_url(database_url())
TEST_URL = BASE_URL.set(database=TEST_DB).render_as_string(hide_password=False)
ADMIN_URL = BASE_URL.set(database="postgres").render_as_string(hide_password=False)

# API、背景工作與測試本身都連到測試用的資料庫與 Redis。
# 供應商設定強制清空：就算 backend/.env 放了金鑰，跑測試也不會真的呼叫外部服務、花到錢。
os.environ["DATABASE_URL"] = TEST_URL
os.environ["REDIS_URL"] = os.environ.get("TEST_REDIS_URL", "redis://127.0.0.1:6379/15")
os.environ["ASR_PROVIDER"] = ""
os.environ["LLM_PROVIDER"] = ""
os.environ["EMBEDDING_PROVIDER"] = ""
# 金鑰也清掉：測試裡用 env fixture 改選 Gemini 時，才不會拿到 backend/.env 的真金鑰。
# 語音問答沒有供應商開關，找得到金鑰就會啟用；Gemini SDK 還會自己去找 GEMINI_API_KEY、GOOGLE_API_KEY
for key in (
    "ASR_API_KEY",
    "LLM_API_KEY",
    "EMBEDDING_API_KEY",
    "VOICE_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "VOICE_MODEL",
    "FIRECRAWL_API_KEY",
    "COHERE_API_KEY",
):
    os.environ[key] = ""
settings.cache_clear()
session_factory.cache_clear()
redis.cache_clear()


@pytest.fixture(scope="session")
def engine():
    admin = create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.exec_driver_sql(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
        conn.exec_driver_sql(f"CREATE DATABASE {TEST_DB}")
    admin.dispose()
    seed.seed(TEST_URL, seed.DEFAULT_AS_OF)
    redis().flushdb()
    engine = create_engine(TEST_URL)
    yield engine
    engine.dispose()


@pytest.fixture
def env(monkeypatch):
    """在這個測試裡改環境變數（例如選 Gemini 當供應商），測完恢復原樣。"""

    def use(**values):
        for key, value in values.items():
            monkeypatch.setenv(key, value)
        settings.cache_clear()

    yield use
    settings.cache_clear()


@pytest.fixture
def db(engine):
    # 每個測試開一條新連線，前一個測試的 SQL 錯誤不會連帶弄壞後面的測試
    with engine.connect() as conn:
        yield conn


@pytest.fixture
def docs(engine, tmp_path):
    (tmp_path / "01-近效期退貨.md").write_text(RETURN_DOC, encoding="utf-8")
    (tmp_path / "02-報價權限.md").write_text(DISCOUNT_DOC, encoding="utf-8")
    with Session(engine) as session:
        index_documents(session, directory=tmp_path)
        session.commit()
        return dict(session.execute(text("SELECT section, id FROM document_chunk")).all())


@pytest.fixture
def auth(engine):
    """拿某個帳號的 Authorization 標頭。假資料給每個帳號的密碼都是 DEMO_PASSWORD 的預設值。"""
    from fastapi.testclient import TestClient

    from app.main import app

    def headers(user_id: str = "U01") -> dict[str, str]:
        with TestClient(app) as client:
            response = client.post(
                "/api/auth/login",
                json={"email": f"{user_id.lower()}@meddemo.tw", "password": settings().demo_password},
            )
        assert response.status_code == 200, response.text
        return {"Authorization": f"Bearer {response.json()['token']}"}

    return headers
