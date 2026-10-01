"""跟熊熊滾說要怎麼排（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈跟熊熊滾說要怎麼排：後端〉）。

AI 只負責聽懂話：Gemini 把一句話翻成固定格式的操作，順序一律由排序程式算（route_planner），
AI 不可能排出違反規則的順序。算出來的是提案，業務看過按「套用」才寫進行程。
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.models import ItineraryProposal

# 提案只留最近 7 天：套用要看當天的行程，舊的只剩下查問題時有用
PROPOSAL_RETENTION = dt.timedelta(days=7)


def purge_proposals(session: Session, now: dt.datetime | None = None) -> int:
    """刪掉超過保存期限的提案，回傳刪了幾筆（jobs/retention.py 每天跑一次）。"""
    cutoff = (now or dt.datetime.now(dt.UTC)) - PROPOSAL_RETENTION
    return session.execute(delete(ItineraryProposal).where(ItineraryProposal.created_at < cutoff)).rowcount
