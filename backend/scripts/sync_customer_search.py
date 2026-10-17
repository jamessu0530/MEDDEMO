"""匯入已核對來源的公開名單並建立內網搜尋索引；部署後與定期同步共用。"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from app.db import make_engine  # noqa: E402
from app.models import Customer, PublicOutlet  # noqa: E402
from app.services.public_outlets import import_snapshot  # noqa: E402
from app.services.outlet_search import rebuild, search_ids  # noqa: E402
from app.services.storefront_photos import import_catalog  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--index-only", action="store_true")
    parser.add_argument("--import-only", action="store_true")
    args = parser.parse_args()
    engine = make_engine()
    try:
        with Session(engine) as session:
            result = {} if args.index_only else import_snapshot(session)
            if not args.index_only:
                result["storefront_photos"] = import_catalog(session.connection())
            session.commit()
            if not args.import_only:
                result["indexed_customers"] = rebuild(session)
                sample = session.scalar(select(Customer.id).join(PublicOutlet, PublicOutlet.customer_id == Customer.id)
                    .where(Customer.name == "合康藥局", PublicOutlet.phone == "0224555173"))
                if sample and (sample not in (search_ids("合康藥句") or []) or sample not in (search_ids("0224555173") or [])):
                    raise RuntimeError("中文錯字或電話搜尋實測未通過")
                result["fuzzy_search_verified"] = bool(sample)
            print(json.dumps(result, ensure_ascii=False))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
