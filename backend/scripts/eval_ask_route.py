"""問答自動分流的實測：每一題問一次 Jev（app/services/ask_router.py），看它判斷的種類與信心分數。

    uv run --project backend python backend/scripts/eval_ask_route.py

會真的呼叫 TypeSafe（每題約 300 個輸入 token，整批不到 US$0.001），要先在 backend/.env 設好 TYPESAFE_API_KEY。
不用資料庫。題目：查數字、查規定沿用 data/eval 的題庫，查頻道、兩種都說得通的與盲測題在 data/eval/ask_route_questions.json。
算對：明確的題目要判斷成那一種；兩種都說得通的，判斷成其中一種或請業務自己選都算對。
結果寫進 data/eval/ask_route_results.json。
"""

import json
import statistics
import sys
import time
from pathlib import Path

# macOS 上 .venv 會被標成隱藏，Python 就略過可編輯安裝的 .pth、找不到 app；直接把 backend 加進搜尋路徑
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.services import ask_router  # noqa: E402

EVAL_DIR = Path(__file__).resolve().parents[2] / "data" / "eval"
LABEL = {"data": "查數字", "knowledge": "查規定", "memory": "查頻道", None: "請業務選"}


def load() -> list[dict]:
    def read(name: str) -> dict:
        return json.loads((EVAL_DIR / name).read_text(encoding="utf-8"))

    cases = [{"id": i["id"], "question": i["question"], "ok": ["data"], "group": "查數字"} for i in read("data_questions.json")["items"]]
    knowledge = read("knowledge_questions.json")
    for group, name in (("answerable", "查規定"), ("out_of_scope", "查規定（文件外）")):
        cases += [{"id": i["id"], "question": i["question"], "ok": ["knowledge"], "group": name} for i in knowledge[group]]
    mine = read("ask_route_questions.json")
    cases += [{**i, "ok": ["memory"], "group": "查頻道"} for i in mine["memory"]]
    cases += [{**i, "group": "兩種都說得通"} for i in mine["ambiguous"]]
    blind = mine["blind"]
    for kind in ("data", "knowledge", "memory"):
        cases += [
            {"id": f"B{kind[0].upper()}{n:02}", "question": q, "ok": [kind], "group": f"盲測{LABEL[kind]}"}
            for n, q in enumerate(blind[kind], 1)
        ]
    cases += [{"id": f"BA{n:02}", **i, "group": "兩種都說得通"} for n, i in enumerate(blind["ambiguous"], 1)]
    return cases


def judge(case: dict, routed: ask_router.Routed) -> str:
    """對、錯，或請業務選。請業務選時，給的選項裡要有對的那一種，不然業務怎麼點都錯；
    明確的題目被請業務選不算錯，但也不算直接判斷對"""
    if routed.kind is None:
        if not set(routed.choices) & set(case["ok"]):
            return "錯"
        return "對" if case["group"] == "兩種都說得通" else "問"
    return "對" if routed.kind in case["ok"] else "錯"


def main() -> None:
    if not settings().typesafe_api_key:
        raise SystemExit("backend/.env 沒有 TYPESAFE_API_KEY")
    cases = load()
    ask_router.route("暖身")  # 第一次連線含 TLS 握手，不算進延遲
    for case in cases:
        started = time.perf_counter()
        routed = ask_router.route(case["question"])
        case["ms"] = (time.perf_counter() - started) * 1000
        case["kind"], case["choices"], case["confidence"] = routed.kind, routed.choices, routed.confidence
        case["result"] = judge(case, routed)
        if routed.confidence is None:
            raise SystemExit(f"{case['id']}：Jev 沒有回答，看上面的 log")
        shown = LABEL[routed.kind] if routed.kind else "／".join(LABEL[k] for k in routed.choices)
        print(f"{case['id']:4} {case['group']:10} {case['result']} {shown:12} 信心 {routed.confidence:.2f} {case['ms']:4.0f}ms  {case['question']}")
    (EVAL_DIR / "ask_route_results.json").write_text(json.dumps(cases, ensure_ascii=False, indent=1), encoding="utf-8")

    clear = [c for c in cases if c["group"] != "兩種都說得通"]
    print()
    for group in dict.fromkeys(c["group"] for c in cases):
        sub = [c for c in cases if c["group"] == group]
        counts = {mark: sum(c["result"] == mark for c in sub) for mark in ("對", "問", "錯")}
        print(f"{group:10} {len(sub):2} 題：直接判斷對 {counts['對']}、請業務選 {counts['問']}、判斷錯 {counts['錯']}")
    wrong = [c["id"] for c in clear if c["result"] == "錯"]
    asked = [c["id"] for c in clear if c["result"] == "問"]
    print(f"明確的 {len(clear)} 題：直接判斷 {len(clear) - len(asked)} 題、其中錯 {len(wrong)} 題 {wrong}；請業務選 {len(asked)} 題 {asked}")
    ms = [c["ms"] for c in cases]
    print(f"延遲：中位數 {statistics.median(ms):.0f}ms、最慢 {max(ms):.0f}ms（門檻：信心 {ask_router.CONFIDENT}）")


if __name__ == "__main__":
    main()
