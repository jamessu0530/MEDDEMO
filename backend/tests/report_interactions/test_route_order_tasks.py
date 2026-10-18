import datetime as dt
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models import AppUser, AssistantTaskExecution, Customer, Itinerary, ItineraryStop, Product, Promotion, PromotionItem, SalesOrder, SalesTransaction
from app.services import assistant_task_actions as actions, auth, order_workspace as orders, route_order_tasks as route_tasks

TODAY = dt.date(2031, 4, 17)


@pytest.fixture
def route_db(interaction_session):
    session = interaction_session
    for model in (AssistantTaskExecution, SalesOrder, Itinerary, ItineraryStop, Promotion, PromotionItem):
        model.__table__.create(session.connection(), checkfirst=True)
    route = Itinerary(user_id="S1", date=TODAY, suggested=[], urgent=None)
    other = Itinerary(user_id="S2", date=TODAY, suggested=[], urgent=None)
    session.add_all([route, other])
    session.flush()
    for position, customer in enumerate(("C2", "C1", "C4")):
        session.add(ItineraryStop(itinerary_id=route.id, position=position, customer_id=customer, source="rep", signal="", reason=""))
    session.add(ItineraryStop(itinerary_id=other.id, position=0, customer_id="C3", source="rep", signal="", reason=""))
    session.flush()
    return session


def start(session, key="route", user_id="S1"):
    user = session.get(AppUser, user_id)
    return actions.execute(session, user, user, key, "order.route_repeat", "今日路線照上次開單")


def control(session, action, customer=None, key="route", user_id="S1"):
    user = session.get(AppUser, user_id)
    return route_tasks.control(session, user, user, key, action, customer)


def count_orders(session):
    return session.scalar(select(func.count()).select_from(SalesOrder))


def test_reads_only_effective_reps_route_in_its_order_and_never_submits(route_db):
    first = start(route_db)
    assert first["batch"]["route_date"] == TODAY.isoformat()
    assert [store["customer_id"] for store in first["batch"]["stores"]] == ["C2", "C1", "C4"]
    assert count_orders(route_db) == 0
    for customer in ("C2", "C1", "C4"):
        current = control(route_db, "step", customer)
    assert current["status"] == "completed"
    assert count_orders(route_db) == 3
    for store in current["batch"]["stores"]:
        draft = route_db.get(SalesOrder, store["resource"]["id"])
        assert draft.status == "draft" and draft.sap_order_no is None
        assert draft.customer_id == store["customer_id"]
        assert draft.items[0]["qty"] == 1
        assert float(draft.items[0]["unit_price"]) == {"C2": 95, "C1": 100, "C4": 90}[draft.customer_id]


def test_step_retries_reload_and_resume_never_duplicate_drafts(route_db):
    start(route_db)
    first = control(route_db, "step", "C2")
    assert control(route_db, "step", "C2")["batch"]["stores"][0]["resource"] == first["batch"]["stores"][0]["resource"]
    restored = start(route_db)
    assert restored["batch"] == route_db.get(AssistantTaskExecution, ("S1", "route")).result["batch"]
    assert count_orders(route_db) == 1
    control(route_db, "resume")
    control(route_db, "step", "C1")
    assert count_orders(route_db) == 2


def test_draft_failure_rolls_back_that_store_and_progress_together(route_db, monkeypatch):
    start(route_db)
    create = orders.create

    def failed_after_flush(*args, **kwargs):
        create(*args, **kwargs)
        raise orders.OrderError("儲存測試失敗")

    monkeypatch.setattr(orders, "create", failed_after_flush)
    result = control(route_db, "step", "C2")
    assert count_orders(route_db) == 0
    assert result["batch"]["stores"][0]["status"] == "needs_attention"
    assert result["batch"]["stores"][0]["resource"] is None
    monkeypatch.setattr(orders, "create", create)
    control(route_db, "retry", "C2")
    control(route_db, "step", "C2")
    assert count_orders(route_db) == 1


def test_prepared_route_cannot_be_silently_reinterpreted(route_db):
    start(route_db)
    user = route_db.get(AppUser, "S1")
    with pytest.raises(orders.OrderError, match="來源訂單已保存"):
        actions.execute(route_db, user, user, "route", "order.route_repeat", "改成全部二十盒")
    assert count_orders(route_db) == 0


def test_pause_skip_retry_and_cancel_keep_saved_drafts(route_db):
    start(route_db)
    control(route_db, "step", "C2")
    control(route_db, "pause")
    assert control(route_db, "step", "C1")["batch"]["stores"][1]["status"] == "pending"
    assert count_orders(route_db) == 1
    assert control(route_db, "skip", "C1")["batch"]["stores"][1]["status"] == "skipped"
    control(route_db, "retry", "C1")
    control(route_db, "step", "C1")
    assert count_orders(route_db) == 2
    assert control(route_db, "skip", "C2")["batch"]["stores"][0]["status"] == "completed"
    control(route_db, "cancel")
    assert control(route_db, "resume")["batch"]["state"] == "cancelled"
    control(route_db, "step", "C4")
    assert count_orders(route_db) == 2


def test_missing_history_does_not_block_other_stores(route_db):
    route_db.query(SalesTransaction).filter(SalesTransaction.customer_id == "C2").delete()
    start(route_db)
    failed = control(route_db, "step", "C2")
    assert failed["batch"]["stores"][0]["status"] == "needs_attention"
    assert "沒有已成交" in failed["batch"]["stores"][0]["message"]
    control(route_db, "step", "C1")
    result = control(route_db, "step", "C4")
    assert result["batch"]["state"] == "waiting" and count_orders(route_db) == 2
    assert control(route_db, "skip", "C2")["status"] == "completed"


def test_hidden_product_rejects_whole_store_instead_of_dropping_lines(route_db):
    route_db.get(Product, "P1").name = "測試商品已下架"
    start(route_db)
    result = control(route_db, "step", "C2")
    assert "不可訂購" in result["batch"]["stores"][0]["message"]
    assert count_orders(route_db) == 0
    control(route_db, "step", "C4")
    assert count_orders(route_db) == 1


def test_current_price_promotion_and_original_aggregate_quantity(route_db):
    route_db.add(SalesTransaction(order_no="O3", customer_id="C2", date=dt.date(2031, 4, 3), sku="P1", qty=9, amount=900, cost=400, listing_fee=0, channel_reward=0))
    route_db.add(Promotion(id="PROMO", name="四月活動", department="測試", type="產品", start_date=TODAY, end_date=TODAY, pm_note=""))
    route_db.flush()
    route_db.add(PromotionItem(code="PI", promotion_id="PROMO", group_name="A", name="P1", sku="P1", deal="買十送一", buy_qty=10, free_qty=1, deal_price=800, list_price=100, ship_price=80))
    start(route_db)
    route_db.get(Product, "P1").unit_price = 200
    result = control(route_db, "step", "C2")
    store = result["batch"]["stores"][0]
    order = route_db.get(SalesOrder, store["resource"]["id"])
    assert order.items == [{"sku": "P1", "qty": 10, "unit_price": "190"}]
    assert order.amount == Decimal("1900")
    assert any("目前供貨價 190" in warning for warning in store["warnings"])
    assert any("四月活動" in warning and "買十送一" in warning for warning in store["warnings"])


@pytest.mark.parametrize("problem", ["payment", "price"])
def test_missing_terms_or_price_can_be_fixed_and_retried(route_db, problem):
    if problem == "payment":
        route_db.get(Customer, "C2").type = "outlet"
        route_db.get(Customer, "C2").payment_term = None
    else:
        route_db.get(Product, "P1").unit_price = 0
    start(route_db)
    assert control(route_db, "step", "C2")["batch"]["stores"][0]["status"] == "needs_attention"
    assert count_orders(route_db) == 0
    route_db.get(Customer, "C2").payment_term = "RM06"
    route_db.get(Product, "P1").unit_price = 100
    control(route_db, "retry", "C2")
    assert control(route_db, "step", "C2")["batch"]["stores"][0]["status"] == "completed"
    assert count_orders(route_db) == 1


def test_route_edits_and_new_transactions_do_not_change_saved_work(route_db):
    initial = start(route_db)
    route = route_db.get(Itinerary, initial["batch"]["route_id"])
    route.version += 1
    route_db.query(ItineraryStop).filter(ItineraryStop.itinerary_id == route.id).delete()
    route_db.add(SalesTransaction(order_no="NEW", customer_id="C2", date=TODAY, sku="P2", qty=50, amount=1000, cost=500, listing_fee=0, channel_reward=0))
    store = control(route_db, "step", "C2")["batch"]["stores"][0]
    order = route_db.get(SalesOrder, store["resource"]["id"])
    assert store["source_order_no"] == "O3"
    assert order.items[0]["sku"] == "P1" and order.items[0]["qty"] == 1


def test_receipt_cannot_be_used_by_another_account_or_rep(route_db):
    start(route_db)
    with pytest.raises(orders.OrderError, match="找不到"):
        control(route_db, "step", "C2", user_id="S2")
    user = route_db.get(AppUser, "S1")
    user._demo_scope = route_db.get(AppUser, "S2")
    with pytest.raises(orders.OrderError, match="身分已變更"):
        control(route_db, "resume")
    with pytest.raises(orders.OrderError, match="身分已變更"):
        start(route_db)
    del user._demo_scope


def test_more_than_three_stores_are_all_processed(route_db):
    initial = start(route_db, key="unused")
    for index in range(8):
        key = f"CX{index}"
        route_db.add(Customer(id=key, name=key, type="clinic", region="北區", city="臺北", area="中正", place_id="TPE", grade="A", owner_user_id="S1", lat=25, lng=121, payment_term="RM06"))
        route_db.flush()
        route_db.add(ItineraryStop(itinerary_id=initial["batch"]["route_id"], customer_id=key, position=index+3, source="rep", signal="", reason=""))
        route_db.add(SalesTransaction(order_no=f"X{index}", customer_id=key, date=TODAY, sku="P1", qty=index+1, amount=100, cost=40, listing_fee=0, channel_reward=0))
    started = start(route_db)
    assert len(started["batch"]["stores"]) == 11
    for store in started["batch"]["stores"]:
        result = control(route_db, "step", store["customer_id"])
    assert result["status"] == "completed" and count_orders(route_db) == 11


def test_missing_route_can_be_loaded_then_same_task_retried(route_db):
    route_db.query(ItineraryStop).filter(ItineraryStop.customer_id == "C3").delete()
    route_db.query(Itinerary).filter(Itinerary.user_id == "S2").delete()
    assert "尚未載入" in start(route_db, user_id="S2")["message"]
    route = Itinerary(user_id="S2", date=TODAY, suggested=[], urgent=None)
    route_db.add(route)
    route_db.flush()
    route_db.add(ItineraryStop(itinerary_id=route.id, customer_id="C3", position=0, source="rep", signal="", reason=""))
    assert start(route_db, user_id="S2")["batch"]["stores"][0]["customer_id"] == "C3"


def test_route_endpoint_requires_auth_and_enforces_snapshot_membership(route_db):
    api = TestClient(app)
    path = "/api/assistant-tasks/route/route-orders"
    assert api.post(path, json={"action": "resume"}).status_code == 401
    headers = {"Authorization": f"Bearer {auth.create_token(route_db.get(AppUser, 'S1'))}"}
    response = api.post("/api/assistant-tasks/execute", headers=headers, json={"task_id": "route", "capability": "order.route_repeat", "instruction": "今日路線照上次"})
    assert response.status_code == 200, response.text
    assert api.post(path, headers=headers, json={"action": "step", "customer_id": "C3"}).status_code == 404
    assert api.post(path, headers=headers, json={"action": "submit", "customer_id": "C2"}).status_code == 422
    assert api.post(path, headers=headers, json={"action": "step", "customer_id": "C2"}).status_code == 200
    assert count_orders(route_db) == 1
