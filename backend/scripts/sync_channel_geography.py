"""補齊全台地點頻道，不重灌資料、不搬移既有客戶與訊息。"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy.orm import Session  # noqa: E402

from app import realtime  # noqa: E402
from app.db import make_engine  # noqa: E402
from app.services.channel_geography import ensure_places  # noqa: E402
from app.services.channels import ensure_channels  # noqa: E402


if __name__ == "__main__":
    engine = make_engine()
    try:
        with Session(engine) as session, session.begin():
            created = ensure_places(session)
            ensure_channels(session)
        realtime.channels_changed()
        print(json.dumps({"created_places": created, "cities": 22, "districts": 368}))
    finally:
        engine.dispose()
