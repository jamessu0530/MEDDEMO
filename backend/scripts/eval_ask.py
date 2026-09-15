"""第四週出場條件：數字題（反覆查詢）、知識題（CRAG）、庫外題（必須拒答）一起評。

    uv run --project backend python backend/scripts/eval_ask.py [--only data|knowledge|oos]

會真的呼叫 AI 模型，費用照用量計。每題也記下使用者要等幾秒。
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path

# macOS 上 .venv 會被標成隱藏，Python 就略過可編輯安裝的 .pth、找不到 app；直接把 backend 加進搜尋路徑
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402

from app.config import NotConfigured, settings
from app.db import session_factory
from app.embeddings import optional_embedder
from app.llm import get_llm
from app.services.data_agent import answer_data
from app.services.knowledge import answer_knowledge

EVAL_DIR = Path(__file__).resolve().parents[2] / "data" / "eval"
NUMBER = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*(萬)?")
NOT_TEXT = re.compile(r"[^0-9A-Za-z一-鿿]")


class Trace(list):
    def __call__(self, round_number, step, **fields):
        self.append({"round": round_number, "step": step, **fields})


def numbers_in(answer: str) -> list[float]:
    found = []
    for digits, wan in NUMBER.findall(answer):
        value = float(digits.replace(",", ""))
        found.append(value * 10000 if wan else value)
    return found


def score_data(item: dict, answer: str) -> list[str]:
    """回傳沒達到的條件；空的代表答對。"""
    misses = []
    flat = NOT_TEXT.sub("", answer)
    names = [n for n in item.get("names", []) if NOT_TEXT.sub("", n) in flat]
    if len(names) < item.get("min_names", 0):
        misses.append(f"名稱只對到 {len(names)} 個")
    misses += [f"缺「{k}」" for k in item.get("keywords", []) if k not in answer]
    found = numbers_in(answer)
    misses += [f"缺數字 {n}" for n in item.get("numbers", []) if not any(abs(v - n) <= abs(n) * 0.01 for v in found)]
    return misses


def route_of(result) -> str:
    """答案走的路：kb／web 是有回答，refuse 是查無依據，其他照狀態（例如 failed）。"""
    if result.status == "answered":
        return result.route
    return "refuse" if result.status == "no_evidence" else result.status


def score_oos(item: dict, result) -> bool:
    """庫外題算不算對。

    - 走對路線（上網或拒答）；有標 reason（medical／internal）的，還要是因為那個原因才不上網：
      拒答的原因很多種，只看有沒有拒答，證明不了用藥題、公司內部題的判斷有沒有觸發。
    - 有標 kb_ok 的：內部文件其實有相關規定（X05 的學名藥文件規定業務一律請客戶洽詢醫師或藥師），
      引用那份文件、答案帶到指定字句的回答也算對（James 2026-09-15 決定）。系統每次判斷內部文件
      夠不夠用的結果不一樣，同一題會在「拒答」和「引用規定回答」之間變動，兩種都沒給醫療建議。
    """
    got = route_of(result)
    if got == item["expect"] and item.get("reason") in (None, result.reason):
        return True
    kb_ok = item.get("kb_ok")
    if kb_ok and got == "kb":
        cited = {s["source_name"] for s in result.sources}
        return kb_ok["source"] in cited and all(k in (result.answer or "") for k in kb_ok["must_include"])
    return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=["data", "knowledge", "oos"])
    only = parser.parse_args().only
    try:
        llm = get_llm()
    except NotConfigured as exc:
        print(f"沒辦法評測：{exc}。請先在 backend/.env 設定 LLM_PROVIDER 與 LLM_API_KEY。")
        return 1
    embedder = optional_embedder()
    embed_query = embedder.embed_query if embedder else None
    print(f"語意檢索：{'有' if embedder else '沒有設定 embedding，只走關鍵字'}")
    print(f"網路搜尋：{'有' if settings().firecrawl_api_key else '沒有 Firecrawl 金鑰，不上網'}")
    print(f"精排：{'Cohere' if settings().cohere_api_key else '融合分數'}\n")

    data_items = json.loads((EVAL_DIR / "data_questions.json").read_text(encoding="utf-8"))["items"]
    knowledge_file = EVAL_DIR / "knowledge_questions.json"
    knowledge = json.loads(knowledge_file.read_text(encoding="utf-8")) if knowledge_file.exists() else {}
    waits: list[float] = []
    summary = []

    with session_factory()() as session:
        engine = session.get_bind()
        today = session.scalar(text("SELECT app_today()"))

        if only in (None, "data"):
            passed = multi_converged = 0
            for item in data_items:
                trace, start = Trace(), time.monotonic()
                result = answer_data(engine, llm, item["question"], today, trace)
                waits.append(time.monotonic() - start)
                rounds = sum(1 for t in trace if t["step"] == "sql")
                misses = score_data(item, result.answer) if result.status == "answered" else [f"狀態 {result.status}"]
                passed += not misses
                multi_converged += bool(item.get("multi_round") and not misses and rounds >= 2)
                print(f"{item['id']}  {waits[-1]:5.1f}s  {rounds} 輪  {'對' if not misses else '錯：' + '；'.join(misses)}")
            summary.append(f"數字題 {passed}/{len(data_items)}，其中需要多輪而且自行收斂的 {multi_converged} 題（出場條件：至少 3 題）")

        if only in (None, "knowledge"):
            passed = 0
            items = knowledge.get("answerable", [])
            for item in items:
                start = time.monotonic()
                result = answer_knowledge(session, llm, item["question"], Trace(), embed_query)
                waits.append(time.monotonic() - start)
                cited = {s["source_name"] for s in result.sources}
                misses = [] if result.status == "answered" else [f"狀態 {result.status}"]
                misses += [] if item["source"] in cited else [f"沒引用 {item['source']}"]
                misses += [f"缺「{k}」" for k in item["must_include"] if k not in (result.answer or "")]
                misses += [] if result.route == "kb" else [f"走了 {result.route}"]
                passed += not misses
                print(f"{item['id']}  {waits[-1]:5.1f}s  {'對' if not misses else '錯：' + '；'.join(misses)}")
            summary.append(f"知識題 {passed}/{len(items)} 答對並引用正確出處")

        if only in (None, "oos"):
            correct = 0
            items = knowledge.get("out_of_scope", [])
            for item in items:
                start = time.monotonic()
                result = answer_knowledge(session, llm, item["question"], Trace(), embed_query)
                waits.append(time.monotonic() - start)
                got = route_of(result)
                ok = score_oos(item, result)
                correct += ok
                shown = f"{got}（{result.reason}）" if result.reason else got
                expected = f"{item['expect']}（{item['reason']}）" if item.get("reason") else item["expect"]
                if item.get("kb_ok"):
                    expected += f"或引用 {item['kb_ok']['source']} 回答"
                print(f"{item['id']}  {waits[-1]:5.1f}s  預期 {expected}，實際 {shown}  {'對' if ok else '錯：' + (result.answer or result.error_message or '')[:40]}")
            summary.append(f"庫外題 {correct}/{len(items)} 走對路線（上網或拒答；有標原因的，原因也要對）")

    print("\n" + "\n".join(summary))
    if waits:
        ordered = sorted(waits)
        print(f"使用者等待：中位數 {ordered[len(ordered) // 2]:.1f} 秒，最久 {ordered[-1]:.1f} 秒")
    return 0


if __name__ == "__main__":
    sys.exit(main())
