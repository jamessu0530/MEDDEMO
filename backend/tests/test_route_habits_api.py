"""我的排序習慣 API：列表、新增、停用、刪除；別人的動不了，主管沒有。"""

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client(tx):
    return TestClient(app)


def habits(client, auth, user_id="U01"):
    response = client.get("/api/route-habits", headers=auth(user_id))
    assert response.status_code == 200, response.text
    return response.json()


def test_the_list_has_today_state_and_the_form_options(client, auth):
    data = habits(client, auth)
    assert data["weekday"] == 2  # 10/28 是星期三
    assert [(h["text"], h["today"]) for h in data["habits"]] == [
        ("康泰連鎖藥局的店排在診所前面", "applied"),
        ("星期三 敦南內科診所 · 大安 排最後", "applied"),
        ("杏林診所 · 大安 都 11:00 以前到", "applied"),
    ]
    first = data["habits"][0]
    assert first["subject"] == {"by": "chain", "value": "康泰連鎖藥局"}
    assert first["object"] == {"by": "type", "value": "clinic"} and first["source"] == "ai"
    assert data["habits"][2]["window_time"] == "11:00"
    assert [o["label"] for o in data["targets"]["type"]] == ["連鎖藥局", "獨立藥局", "診所"]
    assert len(data["targets"]["customer"]) == 50


def test_add_switch_off_and_delete(client, auth):
    made = client.post(
        "/api/route-habits", json={"kind": "first", "subject": {"by": "area", "value": "板橋"}, "weekday": 0},
        headers=auth(),
    )
    assert made.status_code == 201, made.text
    habit = made.json()
    assert (habit["text"], habit["source"], habit["today"]) == ("星期一先跑板橋", "manual", "other_day")
    off = client.patch(f"/api/route-habits/{habit['id']}", json={"active": False}, headers=auth())
    assert off.status_code == 200 and off.json()["today"] == "off"
    assert client.delete(f"/api/route-habits/{habit['id']}", headers=auth()).status_code == 204
    assert habit["id"] not in {h["id"] for h in habits(client, auth)["habits"]}


def test_bad_habits_and_other_peoples_habits(client, auth):
    bad = client.post(
        "/api/route-habits", json={"kind": "precedence", "subject": {"by": "type", "value": "clinic"}}, headers=auth(),
    )
    assert bad.status_code == 422 and bad.json()["detail"] == "先後要選前後兩個對象"
    mine = habits(client, auth)["habits"][0]["id"]
    assert client.patch(f"/api/route-habits/{mine}", json={"active": False}, headers=auth("U02")).status_code == 404
    assert client.delete(f"/api/route-habits/{mine}", headers=auth("U02")).status_code == 404
    assert client.get("/api/route-habits", headers=auth("M01")).status_code == 403
    assert client.get("/api/route-habits").status_code == 401


def test_a_habit_skipped_today_says_why(client, auth):
    data = client.get("/api/itinerary/today", headers=auth()).json()
    first = habits(client, auth)["habits"][0]["id"]
    body = {
        "stops": [
            {k: s[k] for k in ("customer_id", "duration_minutes", "window_kind", "window_time", "note", "locked")}
            for s in data["stops"] if s["status"] != "done"
        ],
        "precedences": data["precedences"], "skipped_habit_ids": [first], "habits": [], "version": data["version"],
    }
    assert client.put("/api/itinerary/today", json=body, headers=auth()).status_code == 200
    listed = habits(client, auth)["habits"][0]
    assert (listed["today"], listed["skip_reason"]) == ("skipped", "你選了今天不套用")
