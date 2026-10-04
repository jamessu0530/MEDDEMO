"""問答自動分流：業務打的一句話該查數字、查規定還是查頻道，問 TypeSafe 的 Jev。

Jev 只回每個選項的機率與信心分數，不生成文字。照 CARE 的做法（CARE/app/services/guardrail/jev.py）：
直接打 HTTP API、版本釘住、題目用英文寫（官方文件說英文最準，提問本身是中文沒關係）。

2026-10-04 實測（backend/scripts/eval_ask_route.py，106 題，含另一個 agent 寫的盲測題）：明確的 90 題
直接判斷 86 題、判錯 0 題，另外 4 題信心不到門檻、改請業務選（給的兩個選項裡都有對的）；兩種都說得通的
16 題都判成其中一種或請業務選。中位數 0.25 秒、最慢 0.42 秒。信心分數每次跑會有一點浮動，門檻附近的題目
會在「直接查」與「請業務選」之間換，實測沒有因此判錯。
所以信心夠高才直接查，不夠就列出最可能的兩種請業務點；Jev 沒回答（沒金鑰、逾時、出錯）就三種都列。
不退回「當成查數字」：問規定或頻道的人會被送去寫 SQL，拿到的是錯的答案，多點一下比較好。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.config import settings

log = logging.getLogger(__name__)

JEV_URL = "https://api.typesafe.ai/v1/systemone"
# 釘版本而不用 jev-latest：門檻是在 1.13.0 上量的，alias 換版時答案可能不同（官方文件 Models → Aliases）
JEV_MODEL = "jev-1.13.0"
# 信心分數到這裡才直接查。10/3 用較籠統的選項說明試跑時，判錯的兩題信心是 0.20 與 0.65，都在這以下
CONFIDENT = 0.7
# 實測中位數約 0.3 秒、最慢 0.6 秒。業務按了送出就在等，Jev 卡住寧可請他自己選
TIMEOUT = httpx.Timeout(2.0, connect=1.0)
KINDS = ("data", "knowledge", "memory")

# 每個選項照它實際查得到的東西寫：語意層的 View（app/sql/semantic_layer.sql）、
# data/documents 的 20 份文件、頻道記憶的五類重點（services/channel_memory.py）。改字要重跑實測。
OPTIONS = {
    "data": (
        "Numbers from the company's own database: monthly sales and purchase amounts by customer, region, "
        "category or product, and why they rose or fell; rankings and counts; how often each customer orders and "
        "how long their payments are overdue; margins; this month's promotions and their items; and what the "
        "rep's own visit records say, such as competitors mentioned and the last visit date."
    ),
    "knowledge": (
        "The company's written rules and reference documents: returning near-expiry or damaged goods, complaint "
        "handling, discount and quote approval authority, listing fees and channel incentives, applying for a "
        "promotion campaign, payment terms and credit holds, opening a new customer, visit-record rules, samples, "
        "shelf display standards, how to report competitor intelligence, product facts for our fish oil, "
        "probiotics, glucosamine and calcium, generic-drug price comparison sheets, out-of-stock and restocking, "
        "invoices and reconciliation, travel and mileage claims. Also general or public knowledge from the web: "
        "medical and drug facts, laws and regulations, public prices, and anything unrelated to the company's own "
        "data or the team's conversations."
    ),
    "memory": (
        "What colleagues and managers have said in the team's chat channels, kept as short notes: complaints "
        "stores raised, competitor activity colleagues saw (promotions, quotes, display deals), decisions and "
        "announcements posted there, to-dos people took on and whether they are done, and tips colleagues shared. "
        "Questions about what the team has been saying, recent updates, or what is still pending."
    ),
}
QUESTIONS = {
    "source": {
        "type": "choice",
        "instructions": (
            "A pharmaceutical sales rep in Taiwan typed `question` (usually in Chinese) into the company "
            "assistant. Which source should answer it?"
        ),
        "criteria": OPTIONS,
    }
}
ATTACHMENT_NOTE = "The rep attached a photo or PDF, such as a product box, a package insert or a competitor's poster."

_client = httpx.Client(timeout=TIMEOUT)


@dataclass(frozen=True)
class Routed:
    """kind：有把握就是這一種。None 時請業務從 choices 裡選（機率高的在前）。
    confidence：Jev 的信心分數，沒回答是 None。"""

    kind: str | None
    choices: list[str] = field(default_factory=list)
    confidence: float | None = None


def state(question: str, has_file: bool) -> dict[str, Any]:
    return {"question": question, "attachment": ATTACHMENT_NOTE} if has_file else {"question": question}


def route(question: str, has_file: bool = False, client: httpx.Client | None = None) -> Routed:
    """問 Jev 這一題該查哪一種。不丟例外：Jev 怎麼了都改成請業務自己選。"""
    key = settings().typesafe_api_key
    if not key:
        return Routed(None, list(KINDS))
    try:
        response = (client or _client).post(
            JEV_URL,
            headers={"Authorization": f"Bearer {key}"},
            json={"state": state(question, has_file), "model": JEV_MODEL, "questions": QUESTIONS},
        )
        response.raise_for_status()
        answer = response.json()["answers"]["source"]
        choice = answer["choice"]
        confidence = float(answer["confidence"])
        probabilities = {kind: float(answer["probabilities"][kind]) for kind in KINDS}
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
        log.warning("自動分流：Jev 沒有回答（%s），請業務自己選", type(exc).__name__)
        return Routed(None, list(KINDS))
    if confidence >= CONFIDENT and choice in KINDS:
        return Routed(choice, [], confidence)
    ranked = sorted(KINDS, key=lambda kind: probabilities[kind], reverse=True)
    return Routed(None, ranked[:2], confidence)
