"""今天的行程：資料表、建立、讀取、三顆鈕、加站。"""

import datetime as dt

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Itinerary, ItineraryStop


def new_itinerary(tx, user_id="U01"):
    itinerary = Itinerary(user_id=user_id, date=dt.date(2026, 10, 1), suggested=[])
    tx.add(itinerary)
    tx.flush()
    return itinerary


def test_one_itinerary_per_rep_per_day(tx):
    new_itinerary(tx)
    with pytest.raises(IntegrityError), tx.begin_nested():
        new_itinerary(tx)


def test_a_customer_appears_once_on_an_itinerary(tx):
    itinerary = new_itinerary(tx)
    tx.add(ItineraryStop(itinerary_id=itinerary.id, position=0, customer_id="C001", source="model", signal="ar", reason="x"))
    tx.flush()
    with pytest.raises(IntegrityError), tx.begin_nested():
        tx.add(ItineraryStop(itinerary_id=itinerary.id, position=1, customer_id="C001", source="rep", signal="ar", reason="x"))
        tx.flush()


def test_a_window_needs_both_kind_and_time(tx):
    itinerary = new_itinerary(tx)
    with pytest.raises(IntegrityError), tx.begin_nested():
        tx.add(ItineraryStop(
            itinerary_id=itinerary.id, position=0, customer_id="C001", source="model", signal="ar", reason="x",
            window_kind="before",
        ))
        tx.flush()
