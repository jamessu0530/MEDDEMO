"""只補熊熊滾收藏的三張表，保留既有資料：uv run --project backend python backend/scripts/create_mascot_tables.py。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.db import make_engine  # noqa: E402
from app.models import MascotCollectible, MascotEncounter, MascotWardrobe  # noqa: E402

if __name__ == "__main__":
    engine = make_engine()
    for model in (MascotWardrobe, MascotCollectible, MascotEncounter):
        model.__table__.create(engine, checkfirst=True)
    engine.dispose()
    print("熊熊滾收藏與換裝資料表已就緒。")
