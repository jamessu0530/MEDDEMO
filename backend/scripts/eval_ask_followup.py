"""打字問答追問的實測：Jev 判斷要不要看前文、Gemini 改寫（app/services/ask_followup.py）。

    uv run --project backend python backend/scripts/eval_ask_followup.py

會真的呼叫 TypeSafe 與 Gemini（Jev 每題一次，要看前文的再一次 Flash，整批約 US$0.01），
要先在 backend/.env 設好 TYPESAFE_API_KEY、LLM_PROVIDER 與 LLM_API_KEY。不用資料庫。
題目在 data/eval/ask_followup_questions.json：前面的對話、這一句、是不是要看前文、改寫後一定要有的詞。
另外把獨立的題目也硬送去改寫一次，看 Jev 萬一誤判時，Gemini 會不會把前文的東西加進去（應該原樣回傳）。
"""

import json
import statistics
import sys
import time
from pathlib import Path

# macOS 上 .venv 會被標成隱藏，Python 就略過可編輯安裝的 .pth、找不到 app；直接把 backend 加進搜尋路徑
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.llm import get_llm  # noqa: E402
from app.services import ask_followup  # noqa: E402
from app.services.ask_router import ask_jev  # noqa: E402

QUESTIONS = Path(__file__).resolve().parents[2] / "data" / "eval" / "ask_followup_questions.json"


def probability(question: str, earlier: list[dict[str, str]]) -> float:
    answers = ask_jev(settings().typesafe_api_key, {"earlier": earlier, "question": question}, ask_followup.QUESTIONS)
    return float(answers["followup"]["noul"])


def timed(fn, *args):
    started = time.perf_counter()
    return fn(*args), (time.perf_counter() - started) * 1000


def main() -> None:
    if not settings().typesafe_api_key:
        raise SystemExit("backend/.env 沒有 TYPESAFE_API_KEY")
    llm = get_llm()
    conversations = json.loads(QUESTIONS.read_text(encoding="utf-8"))["conversations"]
    probability("暖身", [{"question": "暖身", "answer": "暖身"}])  # 第一次連線含 TLS 握手，不算進延遲
    judged, jev_ms, rewrite_ms, missing, widened = [], [], [], [], []
    for conversation in conversations:
        earlier = ask_followup.recent(conversation["earlier"])
        for case in conversation["cases"]:
            p, ms = timed(probability, case["question"], earlier)
            jev_ms.append(ms)
            said = p >= ask_followup.REWRITE_AT
            judged.append(said == case["followup"])
            text, ms = timed(ask_followup.rewrite, case["question"], earlier, llm)
            line = f"{conversation['id']} {'對' if said == case['followup'] else '錯'} p={p:.2f} {'接話' if case['followup'] else '獨立'}  {case['question']}"
            if case["followup"]:
                rewrite_ms.append(ms)
                lost = [word for word in case["must"] if word not in text]
                if lost:
                    missing.append(case["question"])
                line += f"\n      → {text}{'  少了 ' + '、'.join(lost) if lost else ''}"
            elif text != case["question"]:
                widened.append(case["question"])
                line += f"\n      硬送去改寫會變成：{text}"
            print(line)
    followups = sum(case["followup"] for conversation in conversations for case in conversation["cases"])
    print(f"\nJev 判斷要不要看前文（門檻 {ask_followup.REWRITE_AT}）：{sum(judged)}/{len(judged)}；"
          f"中位數 {statistics.median(jev_ms):.0f}ms、最慢 {max(jev_ms):.0f}ms")
    print(f"改寫補齊該補的詞：{followups - len(missing)}/{followups}；中位數 {statistics.median(rewrite_ms):.0f}ms、最慢 {max(rewrite_ms):.0f}ms")
    print(f"獨立的題目硬送去改寫，被加了東西：{len(widened)}/{len(judged) - followups} {widened}")


if __name__ == "__main__":
    main()
