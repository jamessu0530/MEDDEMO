"""部署後同步通路、照片與搜尋索引；相同內容且資料完整時略過。"""

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy.orm import Session  # noqa: E402
from app.db import make_engine  # noqa: E402
from app.services.deployment_sync import sync  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="強制重匯入及重建索引")
    args = parser.parse_args()
    engine = make_engine()
    try:
        with Session(engine) as session:
            print(json.dumps(sync(session, force=args.force), ensure_ascii=False))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
