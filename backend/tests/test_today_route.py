"""今日路線：排序、三顆鈕的回饋、已完成幾家。"""

import datetime as dt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.models import Visit
from app.services import route_model, today_route
from app.timeutil import TAIPEI


@pytest.fixture
def client(engine):
    return TestClient(app)


def route(client, auth, user_id="U01", **feedback):
    body = {"feedback": feedback} if feedback else {}
    response = client.post("/api/route/today", json=body, headers=auth(user_id))
    assert response.status_code == 200, response.text
    return response.json()


def test_route_lists_five_stops_in_time_order(client, auth):
    data = route(client, auth)
    assert data["date"] == "2026-10-28"
    assert data["rep"]["name"] == "林昱辰"
    assert len(data["stops"]) == today_route.ROUTE_SIZE == data["total"]
    times = [s["planned_time"] for s in data["stops"]]
    assert times == sorted(times) and times[0] == "09:30"
    assert [s["status"] for s in data["stops"]] == ["next"] + ["todo"] * 4
    # 每一站都要說得出為什麼排它，不能只有客戶名字
    assert all(s["reason"] and s["signal"] in today_route.SIGNAL_LABEL for s in data["stops"])
    assert len({s["customer_id"] for s in data["stops"]}) == len(data["stops"])


def test_every_rep_gets_a_route_of_their_own_customers(client, engine, auth):
    seen = set()
    for rep_id in ("U01", "U02", "U03", "U04", "U05"):
        stops = route(client, auth, rep_id)["stops"]
        assert len(stops) == today_route.ROUTE_SIZE
        ids = {s["customer_id"] for s in stops}
        assert not (ids & seen)  # 一家客戶只屬於一位業務
        seen |= ids


def test_urgent_card_explains_the_first_stop(client, auth):
    data = route(client, auth)
    urgent = data["urgent"]
    assert urgent["customer_id"] == data["stops"][0]["customer_id"]
    assert urgent["headline"] == today_route.SIGNAL_LABEL[data["stops"][0]["signal"]]
    assert urgent["detail"]


def test_snoozing_drops_the_customer_from_today(client, auth):
    first = route(client, auth)["stops"][0]
    after = route(client, auth, snoozed=[{"customer_id": first["customer_id"], "until": "2026-10-31"}])
    assert first["customer_id"] not in {s["customer_id"] for s in after["stops"]}
    assert len(after["stops"]) == today_route.ROUTE_SIZE  # 補一家進來，不會少一站


def test_snooze_expires(client, auth):
    first = route(client, auth)["stops"][0]
    after = route(client, auth, snoozed=[{"customer_id": first["customer_id"], "until": "2026-10-28"}])
    assert after["stops"][0]["customer_id"] == first["customer_id"]


def test_pinning_moves_a_customer_to_the_first_stop(client, auth):
    stops = route(client, auth)["stops"]
    last = stops[-1]
    after = route(client, auth, pinned=[last["customer_id"]])
    assert after["stops"][0]["customer_id"] == last["customer_id"]
    assert after["stops"][0]["status"] == "next"


def test_marking_a_signal_wrong_pushes_that_kind_down(client, auth):
    stops = route(client, auth)["stops"]
    signal = stops[0]["signal"]
    after = route(client, auth, signal_weights={signal: -5})["stops"]
    # 分數被壓一半，同類提醒不會再排第一站（除非整條路線都是同一類）
    assert after[0]["signal"] != signal or len({s["signal"] for s in stops}) == 1


def test_overdue_commitment_beats_the_model(client, engine, auth):
    data = route(client, auth)
    overdue = [s for s in data["stops"] if s["signal"] == "commitment"]
    assert overdue, "假資料裡應該有逾期的承諾"
    assert data["stops"][0]["signal"] == "commitment"
    # 逾期承諾最多硬排兩家，其餘照分數排
    assert len(overdue) <= today_route.MAX_OVERDUE_STOPS


def test_finished_visits_count_as_done(client, engine, auth):
    with Session(engine) as session:
        stop = route(client, auth)["stops"][1]
        visited_at = dt.datetime(2026, 10, 28, 9, 40, tzinfo=TAIPEI)
        visit = Visit(
            id="VTEST1", customer_id=stop["customer_id"], user_id="U01", visited_at=visited_at,
            transcript="測試", status="synced", confirmed_at=visited_at,
        )
        session.add(visit)
        session.commit()
        try:
            data = route(client, auth)
            assert data["done"] == 1
            first = data["stops"][0]
            assert first["status"] == "done" and first["visit_id"] == "VTEST1"
            assert first["planned_time"] == "09:40"
            assert data["total"] == today_route.ROUTE_SIZE
            assert stop["customer_id"] not in {s["customer_id"] for s in data["stops"][1:]}
        finally:
            session.delete(session.get(Visit, "VTEST1"))
            session.commit()


def test_only_a_logged_in_sales_rep_gets_a_route(client, auth):
    assert client.post("/api/route/today", json={}).status_code == 401
    assert client.post("/api/route/today", json={}, headers={"Authorization": "Bearer not-a-real-token"}).status_code == 401
    # 主管沒有自己的客戶，也就沒有路線
    assert client.post("/api/route/today", json={}, headers=auth("M01")).status_code == 403


def test_model_file_matches_the_features_in_code(client, auth):
    model = route_model.load_model()
    assert model, "權重檔要跟著程式一起進 git"
    assert set(model["weights"]) == set(route_model.FEATURES) == set(model["mean"]) == set(model["sd"])
    # 訓練時記下的成績：模型要比現行規則好，否則不值得上線
    assert model["metrics"]["auc"] > model["metrics"]["rule_auc"]


def test_growing_clinics_are_opportunities(engine):
    from app.services import today_route as service

    with Session(engine) as session:
        found = service._opportunities(session, "U01", dt.date(2026, 10, 28))
    # 杏林診所（C061）是刻意設計的「慢箋成長」：慢性處方每次多進五成
    assert "單次進貨金額從" in found["C061"] and "學名藥比價表" in found["C061"]


def test_every_rep_with_an_opportunity_gets_one_on_the_route(client, auth, engine):
    from app.services import today_route as service

    for rep_id in ("U01", "U02", "U03", "U04", "U05"):
        stops = route(client, auth, rep_id)["stops"]
        with Session(engine) as session:
            has_any = bool(service._opportunities(session, rep_id, dt.date(2026, 10, 28)))
        labelled = [s for s in stops if s["signal"] == "opportunity"]
        assert bool(labelled) == has_any, rep_id
        assert all(s["reason"] for s in labelled)
