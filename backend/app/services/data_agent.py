"""數字查詢（SDD 的 Query Agent，FR-7）。

問題 → SQL → 看結果夠不夠回答 → 不夠就自己決定下一條查詢，最多查三輪（FR-7.1）。
查到上限還答不出來，回報已經查到的部分與卡住的原因（FR-7.2）；每一輪都記下來可以展開（FR-7.3）。
"""

import datetime as dt
import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import Engine
from sqlalchemy.exc import DBAPIError

from app.llm import LLM
from app.services.sql_executor import QueryRejected, QueryResult, describe_views, run_readonly

MAX_ROUNDS = 3  # SDD 流程設計：round < 上限 3
# 9/16 實測：high 與 medium 的正確率都是 10/10，但 high 遇到要下鑽的題目會想很久
# （D01 用 high 要等 63 秒、medium 16 秒），所以用 medium
EFFORT = "medium"

SYSTEM = """你是藥品通路公司的業務數據分析助理。只能用 SQL 查下面四個 View 回答業務的問題，不能用常識或猜測補數字。

每一次你會看到問題與先前每一輪的查詢和結果，決定下一步：
- 資料還不夠回答：action 填 query，sql 寫下一條查詢，reason 說明為什麼要查這個。
- 已經足以回答：action 填 answer，answer 用繁體中文回答，寫出關鍵數字與它們來自哪一輪查詢；reason 說明判斷依據。

查詢的策略（三輪很快就用完，每一輪都要比前一輪更接近答案）：
- 問「為什麼」變差、變好、下滑、成長時，業務要的是「哪幾家客戶、哪些品項造成的」，不是整體趨勢。
  第一輪就直接查到客戶 × 品項的層級，照變化金額排序，找出貢獻最大的那幾筆，再視情況補查它們的細節。
  只回答「整體都在跌」沒有用，業務沒辦法拿著它去跑客戶。
- 問「哪幾家」「有哪些」時，把所有符合條件的都列出來（結果上限 50 列），不要只挑前三名。
  條件的門檻自己訂沒關係，但要在答案裡寫清楚用了什麼門檻。
- 不要用不同的切法重查同一件事。上一輪已經看得到的資訊，不必再查一次。
- 只剩最後一輪時，以答得出來為優先：與其再查一個補充角度，不如就現有結果回答。

SQL 規則：只能是一條 SELECT（可以用 WITH），只能用下面四個 View。「今天」一律用 app_today()，
例如近 90 天是 date > app_today() - 90。金額單位是新台幣元。盡量彙總，結果不要超過 50 列。
結果表會直接顯示給業務看，欄位請取簡短的繁體中文別名，例如 AS 客戶、AS 近三個月進貨。

可以用的 View：
{views}"""

STEP_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["action", "reason", "sql", "answer"],
    "properties": {
        "action": {"type": "string", "enum": ["query", "answer"]},
        "reason": {"type": "string"},
        "sql": {"type": ["string", "null"]},
        "answer": {"type": ["string", "null"]},
    },
}

FINAL_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["answerable", "answer", "blocked_reason"],
    "properties": {
        "answerable": {"type": "boolean"},
        "answer": {"type": "string"},
        "blocked_reason": {"type": ["string", "null"]},
    },
}

FINAL_INSTRUCTION = (
    "已經查了 {rounds} 輪，達到上限，不能再查。根據目前的結果："
    "足以回答就回答（answerable 填 true）；不足以回答就把已經查到的部分寫在 answer，"
    "blocked_reason 說明卡在哪裡、還缺什麼資料（answerable 填 false）。"
)


@dataclass
class Round:
    sql: str
    reason: str
    result: QueryResult | None = None
    error: str | None = None


@dataclass
class DataAnswer:
    status: str  # answered / not_converged
    answer: str
    evidence: dict[str, Any]


OnStep = Callable[..., None]


def _render(question: str, today: dt.date, rounds: list[Round]) -> str:
    parts = [f"今天是 {today.isoformat()}。", f"問題：{question}"]
    for number, rnd in enumerate(rounds, start=1):
        parts.append(f"\n第 {number} 輪查詢（原因：{rnd.reason}）\n{rnd.sql}")
        if rnd.error:
            parts.append(f"執行失敗：{rnd.error}")
        elif rnd.result is not None:
            suffix = "（只列前 50 列）" if rnd.result.truncated else ""
            parts.append(f"結果 {len(rnd.result.rows)} 列{suffix}：")
            parts.append(json.dumps(rnd.result.columns, ensure_ascii=False))
            parts += [json.dumps(row, ensure_ascii=False) for row in rnd.result.rows]
    return "\n".join(parts)


def _evidence(rounds: list[Round]) -> dict[str, Any]:
    """最後一次成功的查詢結果，畫面上當作答案的依據顯示。"""
    for rnd in reversed(rounds):
        if rnd.result is not None:
            return {"sql": rnd.sql, "columns": rnd.result.columns, "rows": rnd.result.rows}
    return {}


def answer_data(engine: Engine, llm: LLM, question: str, today: dt.date, on_step: OnStep) -> DataAnswer:
    system = SYSTEM.format(views=describe_views(engine))
    rounds: list[Round] = []
    for number in range(1, MAX_ROUNDS + 1):
        step = llm.json(system=system, prompt=_render(question, today, rounds), schema=STEP_SCHEMA, effort=EFFORT)
        if step["action"] == "answer" and step.get("answer"):
            on_step(number, "answer", decision=step["reason"])
            return DataAnswer("answered", step["answer"], _evidence(rounds))

        rnd = Round(sql=step.get("sql") or "", reason=step["reason"])
        try:
            rnd.result = run_readonly(engine, rnd.sql)
        except QueryRejected as exc:
            rnd.error = str(exc)
        except DBAPIError as exc:
            rnd.error = f"資料庫回報錯誤：{str(exc.orig).strip()[:300]}"
        rounds.append(rnd)
        on_step(
            number,
            "sql",
            sql=rnd.sql,
            row_count=len(rnd.result.rows) if rnd.result else None,
            decision=rnd.reason if not rnd.error else f"{rnd.reason}（{rnd.error}）",
        )

    prompt = _render(question, today, rounds) + "\n\n" + FINAL_INSTRUCTION.format(rounds=MAX_ROUNDS)
    final = llm.json(system=system, prompt=prompt, schema=FINAL_SCHEMA, effort=EFFORT)
    evidence = _evidence(rounds)
    if final["answerable"]:
        on_step(MAX_ROUNDS, "answer", decision="查滿三輪後整理出答案")
        return DataAnswer("answered", final["answer"], evidence)
    blocked = final.get("blocked_reason") or "查到上限仍無法回答"
    on_step(MAX_ROUNDS, "stop", decision=f"查到上限仍無法回答：{blocked}")
    return DataAnswer("not_converged", final["answer"], evidence | {"blocked_reason": blocked})
