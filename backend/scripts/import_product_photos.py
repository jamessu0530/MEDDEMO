"""把已核對的型錄WebP原檔、來源與料號對應寫入目前設定的資料庫。"""

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import make_engine  # noqa: E402
from app.services.product_photos import DEFAULT_INVENTORY, import_reviewed_photos, read_reviewed_photos  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, default=DEFAULT_INVENTORY)
    parser.add_argument("--check-only", action="store_true", help="只檢查本機照片及核對清單，不寫資料庫")
    args = parser.parse_args()
    records = read_reviewed_photos(args.inventory)
    if args.check_only:
        print(json.dumps({"reviewed": len(records), "bytes": sum(len(row['content']) for row in records),
                          "skus": sorted(row['sku'] for row in records)}, ensure_ascii=False))
        return
    engine = make_engine()
    try:
        with engine.begin() as connection:
            result = import_reviewed_photos(connection, records)
        print(json.dumps(result, ensure_ascii=False))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
