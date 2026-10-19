"""只補商品偏好與匿名查詢紀錄表；本機暫不做完整 schema 升級時使用。"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import make_engine  # noqa: E402
from app.models import ProductBrowseProfile, ProductQueryEvent  # noqa: E402

if __name__ == "__main__":
    engine = make_engine()
    try:
        with engine.begin() as connection:
            ProductBrowseProfile.__table__.create(connection, checkfirst=True)
            ProductQueryEvent.__table__.create(connection, checkfirst=True)
            print("已確認商品偏好與匿名查詢紀錄表存在；既有資料與 schema_version 保留。")
    finally:
        engine.dispose()
