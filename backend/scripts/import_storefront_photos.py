"""Persist collected photo URLs and Place IDs, without calling an external API."""

import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import make_engine  # noqa: E402
from app.models import OutletStorefront  # noqa: E402
from app.services.storefront_photos import import_catalog  # noqa: E402


if __name__ == "__main__":
    engine = make_engine()
    try:
        with engine.begin() as connection:
            OutletStorefront.__table__.create(connection, checkfirst=True)
            print(json.dumps(import_catalog(connection), ensure_ascii=False))
    finally:
        engine.dispose()
