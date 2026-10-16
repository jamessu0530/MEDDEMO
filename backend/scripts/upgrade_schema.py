"""已知版本的附加式升級；保留既有交易、帳號、報表與使用者設定。"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select, text, update  # noqa: E402
from sqlalchemy.engine import Connection  # noqa: E402

from app.db import make_engine, schema_version  # noqa: E402
from app.models import AppSetting, LearningCompletion, MascotCollectible, MascotEncounter, MascotWardrobe, SalesOrder, ReportDataset, ProductBrowseProfile  # noqa: E402

# 保留前一輪的升級起點，同時支援目前已部署版本新增訂單工作區。
# 未知版本不得自動重灌：新增升級路徑，或由維運明確選擇 workflow 的 reseed。
FROM_VERSION = "da9e482ae109"
PREVIOUS_VERSION = "20ea4eee38ef"
ORDERS_VERSION = "e5f5f7ae1005"
REPORTS_VERSION = "a04a685630e5"
TO_VERSION = "6214a6a90ab3"


def upgrade(connection: Connection, target: str | None = None) -> str:
    expected = target or schema_version()
    connection.execute(text("SELECT pg_advisory_xact_lock(hashtext('meddemo-schema-upgrade'))"))
    current = connection.scalar(select(AppSetting.value).where(AppSetting.key == "schema_version").with_for_update())
    if current == expected:
        return "資料表已是目前版本，無須更新。"
    if current not in {FROM_VERSION, PREVIOUS_VERSION, ORDERS_VERSION, REPORTS_VERSION} or expected != TO_VERSION:
        raise RuntimeError(f"沒有保留資料的升級路徑：{current or '未記錄版本'} → {expected}；停止部署，不重灌。")
    for model in (LearningCompletion, MascotWardrobe, MascotCollectible, MascotEncounter, SalesOrder, ReportDataset, ProductBrowseProfile):
        model.__table__.create(connection, checkfirst=True)
    connection.execute(update(AppSetting).where(AppSetting.key == "schema_version").values(value=expected))
    return f"已補齊商品偏好、匯入資料、訂單、課程與收藏表：{current} → {expected}；既有資料保留。"


if __name__ == "__main__":
    engine = make_engine()
    try:
        with engine.begin() as connection:
            print(upgrade(connection))
    finally:
        engine.dispose()
