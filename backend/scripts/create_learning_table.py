"""保留既有資料，只補新人課程的進度表。uv run --project backend python backend/scripts/create_learning_table.py"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import make_engine  # noqa: E402
from app.models import LearningCompletion  # noqa: E402

if __name__ == "__main__":
    engine = make_engine()
    LearningCompletion.__table__.create(engine, checkfirst=True)
    engine.dispose()
    print("新人課程進度表已就緒，既有資料保留。")
