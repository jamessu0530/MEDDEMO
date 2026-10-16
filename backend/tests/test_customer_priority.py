"""可調策略的資料範圍、權重、發布版本與實際路線；不使用外部模型。"""

import datetime as dt
import math

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import delete, func, select

from app.main import app
from app.models import AppSetting, AppUser, Customer, Itinerary, ItineraryStop, SalesTransaction
from app.services import customer_priority as priority, itinerary, today_route

TODAY = dt.date(2026, 10, 28)
PATH = "/api/manager/customer-priority"


def strategy(metric="revenue", direction="higher", **changes):
    return priority.Strategy(id="sales", name="營收優先", metrics=[priority.MetricRule(metric=metric, weight=100, direction=direction)], **changes)


def point(ident, revenue, growth=None):
    return {"customer_id": ident, "customer_name": ident, "values": {"revenue": revenue, "growth": growth}}


def test_weights_directions_and_priority_are_separate_from_score():
    rows = [point("a", 100), point("b", 300), point("c", 200)]
    higher = priority.rank(strategy(), rows, TODAY)
    assert [(r["customer_id"], r["score"]) for r in higher] == [("b", 100), ("c", 50), ("a", 0)]
    lower = priority.rank(strategy(direction="lower"), rows, TODAY)
    assert [r["customer_id"] for r in lower] == ["a", "c", "b"]
    pinned = strategy(priority_customers=[priority.PriorityCustomer(customer_id="a", reason="新通路合作", until=TODAY)])
    result = priority.rank(pinned, rows, TODAY)
    assert result[0]["customer_id"] == "a" and result[0]["score"] == 0
    assert result[0]["priority_reason"] == "新通路合作"
    assert priority.rank(pinned, rows, TODAY + dt.timedelta(days=1))[0]["customer_id"] == "b"


def test_missing_constant_and_negative_values_produce_finite_transparent_scores():
    s = priority.Strategy(id="test", name="測試", metrics=[
        priority.MetricRule(metric="growth", weight=2), priority.MetricRule(metric="revenue", weight=1),
    ])
    result = priority.rank(s, [point("a", -100), point("b", -100, -20), point("c", -100, 20)], TODAY)
    missing = next(r for r in result if r["customer_id"] == "a")
    assert missing["score"] == 50
    assert missing["parts"][0]["value"] is None and missing["parts"][0]["normalized"] == 50
    assert all(math.isfinite(r["score"]) and 0 <= r["score"] <= 100 for r in result)
    assert priority.rank(s, [], TODAY) == []


@pytest.mark.parametrize("rules", [[], [{"metric": "revenue", "weight": 0}], [{"metric": "revenue", "weight": float("nan")}],
                                  [{"metric": "revenue", "weight": 1}, {"metric": "revenue", "weight": 2}]])
def test_invalid_weights_are_rejected(rules):
    with pytest.raises(ValidationError):
        priority.Strategy(id="test", name="測試", metrics=rules)


@pytest.fixture
def client(tx):
    return TestClient(app)


def publish(client, auth, s=None, revision=0, active=True):
    s = s or strategy()
    return client.put(PATH, headers=auth("M01"), json={
        "manager_id": "M01", "revision": revision,
        "policy": {"strategies": [s.model_dump(mode="json")], "active_id": s.id if active else None},
    })


def test_permissions_preview_has_no_writes_and_cross_team_pins_fail(client, auth, tx):
    assert client.get(PATH).status_code == 401
    assert client.get(PATH, headers=auth("U01")).status_code == 403
    assert client.get(PATH + "?manager_id=M02", headers=auth("M01")).status_code == 404
    state = client.get(PATH, headers=auth("M01")).json()
    assert state["revision"] == 0 and state["active_id"] is None
    before = tx.scalar(select(func.count()).select_from(Itinerary))
    response = client.post(PATH + "/preview", headers=auth("M01"), json={"manager_id": "M01", "strategy": strategy().model_dump(mode="json")})
    assert response.status_code == 200, response.text
    assert {r["owner_id"] for r in response.json()["rows"]} == {"U01", "U02"}
    assert tx.scalar(select(func.count()).select_from(Itinerary)) == before
    assert tx.get(AppSetting, priority.PREFIX + "M01") is None
    outside = tx.scalar(select(Customer.id).where(Customer.owner_user_id == "U03"))
    bad = strategy(priority_customers=[priority.PriorityCustomer(customer_id=outside, reason="跨組")])
    assert publish(client, auth, bad).status_code == 404
    assert client.post(PATH + "/preview", headers=auth("M01"), json={"manager_id": "M02", "strategy": strategy().model_dump(mode="json")}).status_code == 404
    assert client.get(PATH + "?manager_id=M02", headers=auth("A01")).status_code == 200


def test_save_reload_conflict_and_published_strategy_changes_real_picks(client, auth, tx):
    s = strategy(daily_limit=3)
    response = publish(client, auth, s)
    assert response.status_code == 200, response.text
    assert response.json()["revision"] == 1
    assert publish(client, auth, s).status_code == 409
    assert client.get(PATH, headers=auth("M01")).json()["active_id"] == "sales"
    manager = tx.get(AppUser, "M01")
    ranked = priority.rank(s, priority.inputs(tx, manager, s.days, TODAY), TODAY)
    expected = [r["customer_id"] for r in ranked if r["owner_id"] == "U01"][:3]
    picked = today_route.pick(tx, "U01", today_route.load_feedback(tx, "U01", TODAY))
    assert [r["candidate"].customer_id for r in picked.picked] == expected
    assert all(r["signal"] == "priority" for r in picked.picked)
    snoozed = today_route.pick(tx, "U01", today_route.Feedback(snoozed={expected[0]: TODAY + dt.timedelta(days=3)}))
    assert expected[0] not in [r["candidate"].customer_id for r in snoozed.picked]


def test_draft_policy_does_not_replace_existing_selection(client, auth, tx):
    before = [r["candidate"].customer_id for r in today_route.pick(tx, "U01").picked]
    assert publish(client, auth, active=False).status_code == 200
    assert [r["candidate"].customer_id for r in today_route.pick(tx, "U01").picked] == before


def test_input_windows_order_dedup_and_no_future_data(tx):
    manager = tx.get(AppUser, "M01")
    customer = tx.scalar(select(Customer).where(Customer.owner_user_id == "U01").order_by(Customer.id))
    original = tx.scalar(select(SalesTransaction).where(SalesTransaction.customer_id == customer.id))
    tx.execute(delete(SalesTransaction).where(SalesTransaction.customer_id == customer.id))
    for order, day, amount, sku in [
        ("PRIOR", TODAY - dt.timedelta(days=90), 100, original.sku),
        ("CURRENT", TODAY - dt.timedelta(days=89), 200, original.sku),
        ("FUTURE", TODAY + dt.timedelta(days=1), 99999, original.sku),
    ]:
        tx.add(SalesTransaction(order_no=order, customer_id=customer.id, date=day, sku=sku, qty=1, amount=amount, cost=50, listing_fee=5, channel_reward=5))
    tx.flush()
    row = next(r for r in priority.inputs(tx, manager, 90, TODAY) if r["customer_id"] == customer.id)
    assert row["values"]["revenue"] == 200
    assert row["values"]["growth"] == 100
    assert row["values"]["net_margin"] == 140
    assert row["values"]["frequency"] == 1
    assert row["values"]["recency"] == 89


def test_apply_is_explicit_versioned_and_preserves_started_or_manual_routes(client, auth, tx):
    tx.execute(delete(Itinerary).where(Itinerary.user_id == "U01", Itinerary.date == TODAY))
    old = itinerary.get_or_create(tx, "U01")
    old_id, old_version = old.id, old.version
    old_ids = list(tx.scalars(select(ItineraryStop.customer_id).where(ItineraryStop.itinerary_id == old_id)))
    response = publish(client, auth, strategy(daily_limit=2))
    assert response.status_code == 200
    assert list(tx.scalars(select(ItineraryStop.customer_id).where(ItineraryStop.itinerary_id == old_id))) == old_ids
    payload = {"manager_id": "M01", "rep_id": "U01", "revision": 1, "version": old_version}
    applied = client.post(PATH + "/apply-today", headers=auth("M01"), json=payload)
    assert applied.status_code == 200, applied.text
    assert applied.json()["version"] == old_version + 1
    assert tx.scalar(select(func.count()).select_from(ItineraryStop).where(ItineraryStop.itinerary_id == old_id)) == 2
    assert client.post(PATH + "/apply-today", headers=auth("M01"), json=payload).status_code == 409
    payload["version"] = applied.json()["version"]
    assert client.post(PATH + "/apply-today", headers=auth("M01"), json={**payload, "rep_id": "U03"}).status_code == 404
    assert client.post(PATH + "/apply-today", headers=auth("M01"), json={**payload, "revision": 0}).status_code == 409
    # 主管再次調整可以重排；業務手動改過的版本則保留。
    again = client.post(PATH + "/apply-today", headers=auth("M01"), json=payload)
    assert again.status_code == 200, again.text
    current = tx.get(Itinerary, old_id, populate_existing=True)
    current.version += 1
    tx.flush()
    manual = client.post(PATH + "/apply-today", headers=auth("M01"), json={**payload, "version": current.version})
    assert manual.status_code == 409 and "手動" in manual.json()["detail"]


def test_arrival_is_preserved_on_apply(client, auth, tx):
    from app.models import StopArrival
    tx.execute(delete(Itinerary).where(Itinerary.user_id == "U01", Itinerary.date == TODAY))
    route = itinerary.get_or_create(tx, "U01")
    cid = tx.scalar(select(ItineraryStop.customer_id).where(ItineraryStop.itinerary_id == route.id))
    tx.add(StopArrival(itinerary_id=route.id, customer_id=cid))
    tx.flush()
    assert publish(client, auth).status_code == 200
    response = client.post(PATH + "/apply-today", headers=auth("M01"), json={"manager_id": "M01", "rep_id": "U01", "revision": 1, "version": route.version})
    assert response.status_code == 409 and "到站" in response.json()["detail"]
    assert tx.get(StopArrival, (route.id, cid)) is not None


def test_empty_generated_route_can_be_applied_again(client, auth, tx):
    from app.models import RouteSnooze
    tx.execute(delete(Itinerary).where(Itinerary.user_id == "U01", Itinerary.date == TODAY))
    route = itinerary.get_or_create(tx, "U01")
    for cid in tx.scalars(select(Customer.id).where(Customer.owner_user_id == "U01")):
        tx.merge(RouteSnooze(user_id="U01", customer_id=cid, until=TODAY + dt.timedelta(days=3)))
    tx.flush()
    assert publish(client, auth).status_code == 200
    payload = {"manager_id": "M01", "rep_id": "U01", "revision": 1, "version": route.version}
    response = client.post(PATH + "/apply-today", headers=auth("M01"), json=payload)
    assert response.status_code == 200, response.text
    assert tx.scalar(select(func.count()).select_from(ItineraryStop).where(ItineraryStop.itinerary_id == route.id)) == 0
    payload["version"] = response.json()["version"]
    assert client.post(PATH + "/apply-today", headers=auth("M01"), json=payload).status_code == 200
