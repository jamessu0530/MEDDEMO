"""清理指定的舊 OA 範例單；預設只檢查，套用前必須先保存完整備份。

python backend/scripts/clean_placeholder_forms.py --ids 5224 5225 5226
python backend/scripts/clean_placeholder_forms.py --ids 5224 5225 5226 --apply --backup /private/tmp/oa-placeholder-backup.json
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import Connection, delete, select  # noqa: E402
from app.db import make_engine  # noqa: E402
from app.models import OaActivity, OaApprovalStep, OaAttachment, OaComment, OaExpenseForm  # noqa: E402

CHILDREN = (OaActivity.__table__, OaComment.__table__, OaApprovalStep.__table__, OaAttachment.__table__)


def plan(connection: Connection, ids: list[int]) -> dict[str, list[dict]]:
    parent = OaExpenseForm.__table__
    rows = [dict(row) for row in connection.execute(select(parent).where(parent.c.id.in_(ids)).with_for_update()).mappings()]
    for row in rows:
        if row["kind"] != "legacy" or not row["payload"].get("simulation") or not row["purpose"].startswith(("示範：", "示範申請：")):
            raise ValueError(f"申請單 {row['id']} 不是原範例資料，停止清理。")
    found = [row["id"] for row in rows]
    backup = {parent.name: rows}
    for table in CHILDREN:
        backup[table.name] = [dict(row) for row in connection.execute(select(table).where(table.c.form_id.in_(found))).mappings()]
    if backup[OaAttachment.__tablename__]:
        raise ValueError("申請單有上傳附件，停止清理，請先確認要保留的檔案。")
    return backup


def remove(connection: Connection, backup: dict[str, list[dict]]) -> int:
    ids = [row["id"] for row in backup[OaExpenseForm.__tablename__]]
    for table in CHILDREN:
        connection.execute(delete(table).where(table.c.form_id.in_(ids)))
    connection.execute(delete(OaExpenseForm).where(OaExpenseForm.id.in_(ids)))
    return len(ids)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ids", nargs="+", type=int, required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup", type=Path)
    args = parser.parse_args()
    if args.apply and not args.backup:
        parser.error("套用前必須指定 --backup；備份路徑不能覆寫既有檔案。")
    with make_engine().begin() as connection:
        backup = plan(connection, args.ids)
        if args.apply:
            with args.backup.open("x", encoding="utf-8") as file:
                json.dump(backup, file, ensure_ascii=False, default=str, indent=2)
            count = remove(connection, backup)
        else:
            count = len(backup[OaExpenseForm.__tablename__])
        print(json.dumps({"applied": args.apply, "forms": count, "ids": [row["id"] for row in backup[OaExpenseForm.__tablename__]]}))


if __name__ == "__main__":
    main()
