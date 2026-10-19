"""本機只補打卡與個人目標資料表；不修改既有資料與全站版本。"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import make_engine  # noqa: E402
from app.models import AttendanceEvent, WorkGoal  # noqa: E402

if __name__ == "__main__":
    engine = make_engine()
    try:
        with engine.begin() as connection:
            for model in (AttendanceEvent, WorkGoal):
                model.__table__.create(connection, checkfirst=True)
        print("已確認打卡與個人目標資料表存在；既有資料與 schema_version 保留。")
    finally:
        engine.dispose()
