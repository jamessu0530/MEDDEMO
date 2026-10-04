"""打字問答的追問：「北區保健品為什麼掉？」之後問「那康泰呢？」，先補成不用看前文也懂的完整問句再查。

查數字、查規定、查頻道三條路都只看一句話（services/asks.py 的 run_ask），所以不改它們，在送出之前改寫：
1. 有前面的對話，才問 Jev 這句是不是要看前文才懂（Noul，約 0.3 秒）。不是就原話照送，不多等。
2. 是的話請 Gemini 改寫（中位數約 2 秒），只補前文明確出現過的客戶、地區、品項、期間。
任何一步出錯或太慢都原話照送：頂多跟沒有追問時一樣，不會擋住提問。畫面上看得到改寫成什麼，也可以照原話重查。

2026-10-04 實測（backend/scripts/eval_ask_followup.py，24 題）：Jev 判斷全對，改寫 15 句都補齊該補的詞，
改寫中位數 2.2 秒、最慢 6.7 秒。獨立的問題萬一被送去改寫，9 題有 2 題會被 Gemini 加上前文的客戶、把範圍悄悄縮小
（「我可以直接給客戶幾趴折扣？」變成只問忠孝店），所以門檻放在 0.6、比 0.5 嚴：寧可漏改，也不要誤改。
同一題的分數每次跑會浮動：獨立的題目兩次跑最高 0.49 與 0.54，要看前文的最低 0.67 與 0.70。
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor

import httpx

from app.config import settings
from app.llm import LLM, get_llm
from app.services.ask_router import ask_jev

log = logging.getLogger(__name__)

# Jev 說「要看前文」的機率到這裡才改寫。寧可漏改（跟沒有追問時一樣）也不要誤改（悄悄查錯範圍）
REWRITE_AT = 0.6
# 前面最多帶幾輪、每輪的答案取多少字：改寫只需要知道剛剛在講誰、講什麼
MAX_TURNS = 3
ANSWER_CHARS = 300
# 業務按了送出就在等。實測最慢 6.7 秒，超過這個就原話照送
REWRITE_TIMEOUT_SECONDS = 8.0

QUESTIONS = {
    "followup": {
        "type": "noul",
        "instructions": (
            "A sales rep is chatting with a company assistant. `earlier` holds the previous questions and answers, "
            "oldest first; `question` is the rep's newest message (usually in Chinese). Does `question` need `earlier` "
            "to be understood?"
        ),
        "criteria": {
            "true": (
                "It points back to something that is only named in `earlier`: words such as 那, 這, 那個, 這家, 那幾家, "
                "他們, 剛剛, 上面, 同樣, 也; a missing customer, region, product or period that `earlier` supplies; "
                "'what about X' (X呢); a comparison with a previous answer; or asking to go on or explain more."
            ),
            "false": (
                "It names everything it asks about and makes full sense on its own, even when it is on the same topic "
                "as `earlier` or changes the topic."
            ),
        },
    }
}

SYSTEM = """你幫醫藥業務的 AI 助理整理問題。業務接著前面的對話問了一句話，請把它改寫成不用看前面對話也看得懂的完整問句：
把「那」「這家」「他們」「同樣的」這類指的東西，以及省略掉的客戶、地區、品項、期間，換成前面對話裡的具體名稱。
只補前面對話裡明確出現過的東西；不要自己加條件、不要回答問題、不要改變業務要問的事。用繁體中文，保持業務原本的口吻。
這句話如果本身就完整（換了話題，或已經講清楚要問誰、問什麼），就一字不改原樣回傳，不要把前面對話的客戶、地區或品項加進去。"""
SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["question"],
    "properties": {"question": {"type": "string", "description": "改寫後的完整問句"}},
}
MAX_QUESTION_CHARS = 500

_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="ask-followup")


def recent(earlier: list[dict[str, str]]) -> list[dict[str, str]]:
    """最近幾輪，答案截短。前端給的是這段對話裡已經答完的提問"""
    return [{"question": t["question"], "answer": t["answer"][:ANSWER_CHARS]} for t in earlier[-MAX_TURNS:]]


def needs_context(question: str, earlier: list[dict[str, str]], client: httpx.Client | None = None) -> bool:
    """這句要看前面的對話才懂嗎。Jev 沒設定或沒回答就當作不用：原話照送"""
    key = settings().typesafe_api_key
    if not key or not earlier:
        return False
    try:
        answer = ask_jev(key, {"earlier": earlier, "question": question}, QUESTIONS, client)["followup"]
        return float(answer["noul"]) >= REWRITE_AT
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
        log.warning("追問：Jev 沒有回答（%s），原話照送", type(exc).__name__)
        return False


def prompt(question: str, earlier: list[dict[str, str]]) -> str:
    lines = ["前面的對話（由舊到新）："]
    for n, turn in enumerate(earlier, 1):
        lines += [f"{n}. 問：{turn['question']}", f"   答：{turn['answer']}"]
    return "\n".join([*lines, "", f"業務這次說：{question}"])


def rewrite(question: str, earlier: list[dict[str, str]], llm: LLM) -> str:
    """請 Gemini 補成完整問句。回來的不能用（空的、太長）就原話照送"""
    text = str(llm.json(system=SYSTEM, prompt=prompt(question, earlier), schema=SCHEMA, effort="low")["question"]).strip()
    return text if 0 < len(text) <= MAX_QUESTION_CHARS else question


def standalone(
    question: str, earlier: list[dict[str, str]], llm: LLM | None = None, client: httpx.Client | None = None
) -> str:
    """回要拿去查的那一句：要看前文才懂就改寫，不然原話。不丟例外"""
    earlier = recent(earlier)
    if not needs_context(question, earlier, client):
        return question
    try:
        model = llm or get_llm()
        return _pool.submit(rewrite, question, earlier, model).result(timeout=REWRITE_TIMEOUT_SECONDS)
    except Exception as exc:  # noqa: BLE001 — 沒設定、逾時、Gemini 出錯、格式不對都一樣：原話照送，不擋提問
        log.warning("追問：改寫失敗（%s），原話照送", type(exc).__name__)
        return question
