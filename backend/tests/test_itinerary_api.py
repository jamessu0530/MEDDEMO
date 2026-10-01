"""行程 API：誰看得到、JSON 長什麼樣、三顆鈕與加站。服務本身的行為在 test_itinerary.py。"""

import pytest
from fastapi.testclient import TestClient
from route_fakes import FakeLLM
from sqlalchemy import select, text

from app.main import app
from app.models import Customer, Itinerary, RouteSignalWeight, RouteSnooze
from app.services import itinerary as service
from app.services import itinerary_ai


@pytest.fixture
def client(tx):
    return TestClient(app)


def today(client, auth, user_id="U01"):
    response = client.get("/api/itinerary/today", headers=auth(user_id))
    assert response.status_code == 200, response.text
    return response.json()


def test_today_has_the_fields_the_home_page_needs(client, auth):
    data = today(client, auth)
    assert data["date"] == "2026-10-28" and data["rep"]["name"] == "林昱辰"
    assert data["version"] == 1 and data["estimated"] is True
    assert data["total"] == len(data["stops"]) == 5
    first = data["stops"][0]
    assert set(first) == {
        "customer_id", "customer_name", "type", "grade", "planned_time", "status", "signal", "reason", "visit_id",
        "source", "duration_minutes", "late_minutes", "travel_minutes", "travel_km",
        "window_kind", "window_time", "note", "locked", "habit_ids",
    }
    assert {"rules", "violations", "precedences", "skipped_habits"} <= set(data)
    assert data["urgent"]["customer_id"] == first["customer_id"]
    assert data["finish_time"] > first["planned_time"]


def test_only_a_signed_in_sales_rep_has_an_itinerary(client, auth):
    assert client.get("/api/itinerary/today").status_code == 401
    denied = client.get("/api/itinerary/today", headers=auth("M01"))
    assert denied.status_code == 403 and denied.json()["detail"] == "主管沒有自己的拜訪路線"


def test_pin_through_the_api(client, auth):
    last = today(client, auth)["stops"][-1]
    response = client.post(
        "/api/itinerary/today/feedback",
        json={"customer_id": last["customer_id"], "action": "pin", "version": 1},
        headers=auth(),
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["stops"][0]["customer_id"] == last["customer_id"] and data["version"] == 2


def test_stale_version_and_unknown_customer(client, auth):
    first = today(client, auth)["stops"][0]
    stale = client.post(
        "/api/itinerary/today/feedback",
        json={"customer_id": first["customer_id"], "action": "snooze", "version": 7}, headers=auth(),
    )
    assert stale.status_code == 409 and stale.json()["detail"] == "行程剛被改過，已幫你重新整理"
    missing = client.post(
        "/api/itinerary/today/feedback", json={"customer_id": "C999", "action": "pin", "version": 1}, headers=auth(),
    )
    assert missing.status_code == 404


def test_it_resets_the_demo_reps_itinerary(client, auth, tx):
    urgent_id = today(client, auth)["urgent"]["customer_id"]
    # 誤判同時留下 route_snooze 與 route_signal_weight 兩張表的紀錄，reset 兩個都要清掉
    feedback = client.post(
        "/api/itinerary/today/feedback",
        json={"customer_id": urgent_id, "action": "misjudge", "version": 1},
        headers=auth(),
    )
    assert feedback.status_code == 200, feedback.text

    # 評審加的、停用的習慣也要清掉
    added = client.post("/api/route-habits", json={"kind": "first", "subject": {"by": "area", "value": "板橋"}}, headers=auth())
    assert added.status_code == 201, added.text
    first = client.get("/api/route-habits", headers=auth()).json()["habits"][0]["id"]
    assert client.patch(f"/api/route-habits/{first}", json={"active": False}, headers=auth()).status_code == 200

    reset = client.post("/api/admin/demo-itinerary/reset", headers=auth("A01"))
    assert reset.status_code == 200, reset.text
    assert reset.json() == {"rep_id": "U01", "rep_name": "林昱辰"}

    assert tx.scalar(select(Itinerary).where(Itinerary.user_id == "U01")) is None
    assert tx.scalar(select(RouteSnooze).where(RouteSnooze.user_id == "U01")) is None
    assert tx.scalar(select(RouteSignalWeight).where(RouteSignalWeight.user_id == "U01")) is None

    rebuilt = today(client, auth)
    assert rebuilt["version"] == 1 and rebuilt["urgent"] is not None
    habits = client.get("/api/route-habits", headers=auth()).json()["habits"]
    assert [(h["text"], h["active"]) for h in habits] == [
        ("康泰連鎖藥局的店排在診所前面", True),
        ("星期三 敦南內科診所 · 大安 排最後", True),
        ("杏林診所 · 大安 都 11:00 以前到", True),
    ]


def test_reset_demo_itinerary_is_it_only(client, auth):
    for user_id in ("M01", "U01"):
        assert client.post("/api/admin/demo-itinerary/reset", headers=auth(user_id)).status_code == 403


def test_add_stops_from_an_answer(client, auth, tx):
    on_route = [s["customer_id"] for s in today(client, auth)["stops"]]
    mine = tx.scalars(select(Customer).where(Customer.owner_user_id == "U01", Customer.id.not_in(on_route))).first()
    response = client.post("/api/itinerary/today/stops", json={"customer_ids": [mine.id, on_route[0]]}, headers=auth())
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["added"] == [mine.name]
    assert data["skipped"][0]["reason"] == "已經在今天的行程裡"
    assert mine.id in {s["customer_id"] for s in data["itinerary"]["stops"]}


def draft_body(data):
    """讀到的行程原封不動地換成草稿（跟前端 lib/itinerary.ts 的 draftFrom 一樣）。"""
    fields = ("customer_id", "duration_minutes", "window_kind", "window_time", "note", "locked")
    return {
        "stops": [{key: s[key] for key in fields} for s in data["stops"] if s["status"] != "done"],
        "precedences": data["precedences"],
        "skipped_habit_ids": [h["id"] for h in data["skipped_habits"]],
        "habits": [],
    }


def test_preview_and_save_the_list(client, auth):
    data = today(client, auth)
    body = draft_body(data)
    body["stops"][1].update(window_kind="before", window_time="09:40")
    body["stops"][2]["duration_minutes"] = 90
    later, earlier = body["stops"][4]["customer_id"], body["stops"][3]["customer_id"]
    body["precedences"] = [{"before": later, "after": earlier}]
    preview = client.post("/api/itinerary/today/preview", json=body, headers=auth())
    assert preview.status_code == 200, preview.text
    shown = preview.json()
    assert shown["stops"][1]["late_minutes"] > 0 and shown["stops"][1]["window_time"] == "09:40"
    assert shown["violations"] == [f"today:{later}>{earlier}"]
    assert today(client, auth)["version"] == data["version"]
    # 照先後換過來再存
    body["stops"][3], body["stops"][4] = body["stops"][4], body["stops"][3]
    saved = client.put("/api/itinerary/today", json={**body, "version": data["version"]}, headers=auth())
    assert saved.status_code == 200, saved.text
    after = saved.json()
    assert after["version"] == data["version"] + 1 and after["violations"] == []
    assert [s["customer_id"] for s in after["stops"]] == [s["customer_id"] for s in body["stops"]]
    assert after["precedences"] == body["precedences"]
    stale = client.put("/api/itinerary/today", json={**body, "version": data["version"]}, headers=auth())
    assert stale.status_code == 409 and stale.json()["detail"] == "行程剛被改過，已幫你重新整理"


def test_a_bad_draft_is_refused(client, auth, tx):
    body = draft_body(today(client, auth))
    theirs = tx.scalars(select(Customer.id).where(Customer.owner_user_id == "U02")).first()
    bad = client.post("/api/itinerary/today/preview", json={**body, "insert": theirs}, headers=auth())
    assert bad.status_code == 422 and bad.json()["detail"] == "只能排自己的客戶"
    half = {**body, "stops": [{**body["stops"][0], "window_kind": "at"}]}
    assert client.post("/api/itinerary/today/preview", json=half, headers=auth()).status_code == 422
    assert client.post("/api/itinerary/today/preview", json=body, headers=auth("M01")).status_code == 403
    assert client.put("/api/itinerary/today", json={**body, "version": 1}, headers=auth("M01")).status_code == 403


def test_candidates_through_the_api(client, auth):
    ids = [s["customer_id"] for s in today(client, auth)["stops"]]
    response = client.get(
        "/api/itinerary/today/candidates", params={"order": ",".join(ids[:4]), "locked": ids[0]}, headers=auth(),
    )
    assert response.status_code == 200, response.text
    found = response.json()
    assert len(found["nearby"]) == 5 and found["full"] is False
    assert set(found["nearby"][0]) == {
        "customer_id", "customer_name", "type", "area", "signal", "after_stop", "extra_minutes",
    }
    assert ids[4] in {c["customer_id"] for c in found["nearby"] + found["others"]}
    assert client.get("/api/itinerary/today/candidates", headers=auth("M01")).status_code == 403


def test_an_it_reset_between_reading_and_saving_is_a_409(client, auth, monkeypatch):
    first = today(client, auth)["stops"][0]["customer_id"]
    real = service.get_or_create

    def reset_meanwhile(session, user_id):
        itinerary = real(session, user_id)
        session.execute(text("DELETE FROM itinerary WHERE id = :id"), {"id": itinerary.id})
        return itinerary

    monkeypatch.setattr(service, "get_or_create", reset_meanwhile)
    response = client.post(
        "/api/itinerary/today/feedback", json={"customer_id": first, "action": "pin", "version": 1}, headers=auth(),
    )
    assert response.status_code == 409 and response.json()["detail"] == "行程剛被改過，已幫你重新整理"


def test_asking_needs_gemini(client, auth):
    response = client.post("/api/itinerary/today/ask", json={"question": "幫我排順一點"}, headers=auth())
    assert response.status_code == 503 and response.json()["detail"] == "熊熊滾現在沒辦法排行程"


def test_ask_and_apply_a_proposal(client, auth, monkeypatch):
    ids = [s["customer_id"] for s in today(client, auth)["stops"]]
    llm = FakeLLM([{"op": "move", "customer_id": ids[4], "to_position": 2}])
    monkeypatch.setattr(itinerary_ai, "get_llm", lambda: llm)
    asked = client.post("/api/itinerary/today/ask", json={"question": "鶯歌店排第二站"}, headers=auth())
    assert asked.status_code == 200, asked.text
    proposal = asked.json()
    assert proposal["kind"] == "proposal" and proposal["changed"] is True and proposal["question"] == "鶯歌店排第二站"
    assert set(proposal) == {
        "id", "question", "kind", "summary", "changed", "before", "after", "rule_costs", "late", "habits_added",
        "habits_disabled", "dropped", "notes", "conflict", "mention", "candidates", "text", "estimated",
    }
    assert [s["customer_id"] for s in proposal["after"]["stops"]][:2] == [ids[0], ids[4]]
    applied = client.post(f"/api/itinerary/proposals/{proposal['id']}/apply", headers=auth())
    assert applied.status_code == 200, applied.text
    assert applied.json()["version"] == 2 and applied.json()["stops"][1]["customer_id"] == ids[4]
    again = client.post(f"/api/itinerary/proposals/{proposal['id']}/apply", headers=auth())
    assert again.status_code == 409 and again.json()["detail"] == "行程在你問完之後改過了"


def test_the_optimize_button_and_proposals_that_cannot_be_applied(client, auth):
    optimized = client.post("/api/itinerary/today/optimize", headers=auth())
    assert optimized.status_code == 200, optimized.text
    proposal = optimized.json()
    assert proposal["question"] is None and proposal["kind"] == "proposal"
    response = client.post(f"/api/itinerary/proposals/{proposal['id']}/apply", headers=auth())
    if proposal["changed"]:
        assert response.status_code == 200
    else:
        assert response.status_code == 422 and response.json()["detail"] == "這個提案不能套用"
    assert client.post("/api/itinerary/proposals/999999/apply", headers=auth()).status_code == 404


def test_managers_cannot_ask_or_apply(client, auth):
    for path in ("/api/itinerary/today/ask", "/api/itinerary/today/optimize", "/api/itinerary/proposals/1/apply"):
        response = client.post(path, json={"question": "幫我排順一點"}, headers=auth("M01"))
        assert response.status_code == 403, path
