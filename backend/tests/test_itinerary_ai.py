"""跟熊熊滾說要怎麼排：提示、操作的驗證與套用、對照卡、提案的存取與套用。Gemini 一律用假的。"""

import datetime as dt

from sqlalchemy import select

from app.models import ItineraryProposal
from app.services import itinerary as service
from app.services import itinerary_ai


def proposal(tx, itinerary, days_ago=0):
    row = ItineraryProposal(
        itinerary_id=itinerary.id, base_version=itinerary.version, question="測試", operations=[],
        result={"kind": "answer"},
        created_at=dt.datetime.now(dt.UTC) - dt.timedelta(days=days_ago),
    )
    tx.add(row)
    tx.flush()
    return row


def test_old_proposals_are_purged_after_seven_days(tx):
    itinerary = service.get_or_create(tx, "U01")
    fresh, old = proposal(tx, itinerary), proposal(tx, itinerary, days_ago=8)
    assert itinerary_ai.purge_proposals(tx) == 1
    left = set(tx.scalars(select(ItineraryProposal.id)))
    assert fresh.id in left and old.id not in left
