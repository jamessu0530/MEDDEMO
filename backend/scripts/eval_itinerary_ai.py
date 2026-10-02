"""跟熊熊滾說要怎麼排的實測：20 句話，比對 Gemini 翻出來的操作（data/eval/itinerary_ai_questions.json）。

    uv run --project backend python backend/scripts/eval_itinerary_ai.py [--only R05]

會真的呼叫 Gemini（每句一次 Flash，約 US$0.006），要先在 backend/.env 設好 LLM_PROVIDER 與 LLM_API_KEY；
資料庫要是用這個分支灌過假資料的（data/seed/seed.py）。每一句都在交易裡先重置示範業務今天的行程與習慣、
問完就回滾，不會留下任何改動。結果寫進 data/eval/itinerary_ai_results.json。
"""

import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path
from typing import Any

# macOS 上 .venv 會被標成隱藏，Python 就略過可編輯安裝的 .pth、找不到 app；直接把 backend 加進搜尋路徑
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.config import NotConfigured, settings  # noqa: E402
from app.db import session_factory  # noqa: E402
from app.llm import DEFAULT_GEMINI_MODEL, get_llm  # noqa: E402
from app.models import Customer  # noqa: E402
from app.services import itinerary, itinerary_ai, route_habits  # noqa: E402
from app.services.auth import EXTERNAL_ACCOUNT_ACTS_AS  # noqa: E402

EVAL_DIR = Path(__file__).resolve().parents[2] / "data" / "eval"
REP = EXTERNAL_ACCOUNT_ACTS_AS


def resolve(value: Any, ids: dict[str, Any]) -> Any:
    """預期的操作裡，店名與習慣的那一句話換成 id；其他照舊。"""
    if isinstance(value, str):
        return ids.get(value, value)
    if isinstance(value, dict):
        return {key: resolve(item, ids) for key, item in value.items()}
    if isinstance(value, list):
        return [resolve(item, ids) for item in value]
    return value


def matches(expected: dict[str, Any], got: dict[str, Any]) -> bool:
    """有寫的欄位都要一樣；巢狀的（習慣）一樣只比對有寫的。"""
    for key, value in expected.items():
        if isinstance(value, dict):
            if not isinstance(got.get(key), dict) or not matches(value, got[key]):
                return False
        elif got.get(key) != value:
            return False
    return True


def score(item: dict[str, Any], operations: list[dict[str, Any]], ids: dict[str, Any]) -> list[str]:
    """沒達到的條件；空的代表對。"""
    misses = [
        f"少了 {json.dumps(expected, ensure_ascii=False)}"
        for expected in resolve(item.get("expect", []), ids)
        if not any(matches(expected, op) for op in operations)
    ]
    misses += [f"不該有 {op['op']}" for op in operations if op["op"] in item.get("forbid", [])]
    if item.get("only") and any(op["op"] not in item["only"] for op in operations):
        misses.append("多了 " + "、".join(op["op"] for op in operations if op["op"] not in item["only"]))
    return misses


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="只跑這一題（例如 R05）")
    only = parser.parse_args().only
    try:
        llm = get_llm()
    except NotConfigured as exc:
        print(f"沒辦法實測：{exc}。請先在 backend/.env 設定 LLM_PROVIDER 與 LLM_API_KEY。")
        return 1
    items = json.loads((EVAL_DIR / "itinerary_ai_questions.json").read_text(encoding="utf-8"))["items"]
    items = [item for item in items if only in (None, item["id"])]
    results, waits = [], []
    for item in items:
        with session_factory()() as session:
            # 每一句都從同一個起點問：示範業務今天的行程照模型的建議重建、習慣回到一開始那三條；問完回滾
            itinerary.reset_today(session, REP)
            today = itinerary.get_or_create(session, REP)
            ids: dict[str, Any] = {
                c.name: c.id for c in session.scalars(select(Customer).where(Customer.owner_user_id == REP))
            }
            ids |= {h.text: h.id for h in route_habits.mine(session, REP)}
            start = time.monotonic()
            try:
                operations, misses = itinerary_ai.interpret(session, today, item["question"], None, llm), []
            except Exception as exc:  # noqa: BLE001 — 實測要把每一題的結果都記下來，一題出錯不擋其他題
                operations, misses = [], [f"出錯：{exc}"]
            waits.append(time.monotonic() - start)
            misses = misses or score(item, operations, ids)
            session.rollback()
        print(f"{item['id']}  {waits[-1]:4.1f}s  {'對' if not misses else '錯：' + '；'.join(misses)}")
        results.append({
            "id": item["id"], "question": item["question"], "ok": not misses, "misses": misses,
            "operations": operations, "seconds": round(waits[-1], 1),
        })
    passed = sum(result["ok"] for result in results)
    print(f"\n通過 {passed}/{len(results)}")
    if waits:
        ordered = sorted(waits)
        print(f"使用者等待：中位數 {ordered[len(ordered) // 2]:.1f} 秒，最久 {ordered[-1]:.1f} 秒")
    out = {
        "run_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "model": settings().llm_model or DEFAULT_GEMINI_MODEL,
        "passed": passed,
        "total": len(results),
        "items": results,
    }
    (EVAL_DIR / "itinerary_ai_results.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
