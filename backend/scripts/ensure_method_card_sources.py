"""在既有資料庫補上方法卡來源表，保留所有方法卡與頻道資料，可重複執行。"""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import make_engine  # noqa: E402
from app.models import MethodCardSource  # noqa: E402


def main() -> None:
    engine = make_engine()
    try:
        with engine.begin() as connection:
            MethodCardSource.__table__.create(connection, checkfirst=True)
    finally:
        engine.dispose()
    print("方法卡來源表已就緒，既有資料保留。")


if __name__ == "__main__":
    main()
