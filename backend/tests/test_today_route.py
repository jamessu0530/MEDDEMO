"""今日路線挑哪幾家：模型、逾期承諾、商機、暫緩與誤判。順序與存檔在 test_itinerary.py。"""

import datetime as dt

from sqlalchemy.orm import Session

from app.models import Customer, RouteSignalWeight, RouteSnooze
from app.services import customer_profile, route_model, today_route

TODAY = dt.date(2026, 10, 28)


def pick(engine, user_id="U01", feedback=None):
    with Session(engine) as session:
        return today_route.pick(session, user_id, feedback)


def ids(result):
    return [item["candidate"].customer_id for item in result.picked]


def test_pick_lists_five_customers_with_reasons(engine):
    result = pick(engine)
    assert result.today == TODAY and result.rep.name == "林昱辰"
    assert len(result.picked) == today_route.ROUTE_SIZE == len(set(ids(result)))
    assert all(item["reason"] and item["signal"] in today_route.SIGNAL_LABEL for item in result.picked)


def test_every_rep_picks_their_own_customers(engine):
    seen = set()
    for rep_id in ("U01", "U02", "U03", "U04", "U05"):
        picked = set(ids(pick(engine, rep_id)))
        assert len(picked) == today_route.ROUTE_SIZE and not picked & seen
        seen |= picked


def test_urgent_card_explains_the_first_pick(engine):
    result = pick(engine)
    assert result.urgent.customer_id == result.picked[0]["candidate"].customer_id
    assert result.urgent.headline == today_route.SIGNAL_LABEL[result.picked[0]["signal"]]
    assert result.urgent.detail


def test_snoozed_customer_is_not_picked(engine):
    first = ids(pick(engine))[0]
    after = pick(engine, feedback=today_route.Feedback(snoozed={first: dt.date(2026, 10, 31)}))
    assert first not in ids(after) and len(after.picked) == today_route.ROUTE_SIZE


def test_snooze_expires(engine):
    first = ids(pick(engine))[0]
    after = pick(engine, feedback=today_route.Feedback(snoozed={first: TODAY}))
    assert ids(after)[0] == first


def test_marking_a_signal_wrong_pushes_that_kind_down(engine):
    before = pick(engine)
    signal = before.picked[0]["signal"]
    after = pick(engine, feedback=today_route.Feedback(signal_weights={signal: -5}))
    # 分數被壓一半，同類提醒不會再排第一（除非整條路線都是同一類）
    assert after.picked[0]["signal"] != signal or len({item["signal"] for item in before.picked}) == 1


def test_overdue_commitment_beats_the_model(engine):
    result = pick(engine)
    overdue = [item for item in result.picked if item["signal"] == "commitment"]
    assert overdue, "假資料裡應該有逾期的承諾"
    assert result.picked[0]["signal"] == "commitment"
    assert len(overdue) <= today_route.MAX_OVERDUE_STOPS


def test_saved_feedback_is_read_back(tx):
    tx.add_all([
        RouteSnooze(user_id="U01", customer_id="C001", until=dt.date(2026, 10, 31)),
        RouteSnooze(user_id="U01", customer_id="C002", until=TODAY),
        RouteSignalWeight(user_id="U01", signal="ar", weight=-2),
    ])
    tx.flush()
    feedback = today_route.load_feedback(tx, "U01", TODAY)
    # 期限是今天的暫緩已經過了
    assert feedback.snoozed == {"C001": dt.date(2026, 10, 31)}
    assert feedback.signal_weights == {"ar": -2}


def test_label_explains_a_customer_the_rep_adds(engine):
    with Session(engine) as session:
        signal, reason = today_route.label(session, "U01", "C061")
    assert signal in today_route.SIGNAL_LABEL and reason


def test_model_file_matches_the_features_in_code():
    model = route_model.load_model()
    assert model, "權重檔要跟著程式一起進 git"
    assert set(model["weights"]) == set(route_model.FEATURES) == set(model["mean"]) == set(model["sd"])
    # 訓練時記下的成績：模型要比現行規則好，否則不值得上線
    assert model["metrics"]["auc"] > model["metrics"]["rule_auc"]


def test_growing_clinics_are_opportunities(engine):
    with Session(engine) as session:
        found = today_route._opportunities(session, "U01", TODAY)
    # 杏林診所（C061）是刻意設計的「慢箋成長」：慢性處方每次多進五成
    assert "單次進貨金額從" in found["C061"] and "學名藥比價表" in found["C061"]


def test_every_rep_with_an_opportunity_gets_one_picked(engine):
    for rep_id in ("U01", "U02", "U03", "U04", "U05"):
        result = pick(engine, rep_id)
        with Session(engine) as session:
            has_any = bool(today_route._opportunities(session, rep_id, TODAY))
        labelled = [item for item in result.picked if item["signal"] == "opportunity"]
        assert bool(labelled) == has_any, rep_id
        assert all(item["reason"] for item in labelled)


def test_labels_for_several_customers_at_once(tx):
    from sqlalchemy import select

    from app.models import Customer

    ids = tx.scalars(select(Customer.id).where(Customer.owner_user_id == "U01").order_by(Customer.id).limit(3)).all()
    found = today_route.labels(tx, "U01", list(ids))
    assert set(found) == set(ids)
    assert found[ids[0]] == today_route.label(tx, "U01", ids[0])


def test_the_urgent_card_does_not_borrow_the_last_order_sentence(engine):
    # 「上次訂的…促銷變了」只放在客戶檔案，首頁需立即處理那張卡的背景不拿它
    with Session(engine) as session:
        highlights = customer_profile.build_profile(session, session.get(Customer, "C001")).highlights
        assert any(h.startswith(customer_profile.LAST_ORDER_PREFIX) for h in highlights)
        candidate = next(c for c in route_model.candidates(session, TODAY, owner_id="U01") if c.customer_id == "C001")
        urgent = today_route._urgent(session, candidate, "interval", "進貨間隔拉長")
    assert urgent.note and not urgent.note.startswith(customer_profile.LAST_ORDER_PREFIX)
