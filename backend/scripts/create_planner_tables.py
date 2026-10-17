"""只補一般日曆資料表，不重建既有資料、不修改既有版本標記。"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402
from app.db import make_engine  # noqa: E402
from app.models import PLANNER_TABLES  # noqa: E402

if __name__ == "__main__":
    engine = make_engine()
    try:
        with engine.begin() as connection:
            connection.execute(text("SELECT pg_advisory_xact_lock(hashtext('meddemo-planner-create'))"))
            for model in PLANNER_TABLES:
                model.__table__.create(connection, checkfirst=True)
        print("一般日曆資料表已備妥，既有資料保留。")
    finally:
        engine.dispose()
