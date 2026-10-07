"""拜訪備忘與日曆的 API：權限跟報價一樣，只有負責人與他的主管。"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.tasks import redis


@pytest.fixture
def api():
    yield TestClient(app)
    redis().flushdb()


def test_next_visit_notes_and_writing_one(tx, api, auth):
    before = api.get("/api/customers/C001/notes", headers=auth("U01")).json()["next"]
    # 示範資料：忠孝店一則要帶的、一則講過的，要帶的在前
    assert [n["kind"] for n in before] == ["bring", "told"]
    created = api.post(
        "/api/customers/C001/notes", json={"kind": "told", "text": " 跟店長說了大口送葡萄籽 "}, headers=auth("U01"),
    )
    assert created.status_code == 201
    note = created.json()
    # 講過的沒給日期就是今天（系統日）
    assert (note["text"], note["on_date"], note["customer_name"], note["visit_id"]) == (
        "跟店長說了大口送葡萄籽", "2026-10-28", "康泰連鎖藥局 · 忠孝店", None,
    )
    after = api.get("/api/customers/C001/notes", headers=auth("U01")).json()["next"]
    assert note["id"] in {n["id"] for n in after}

    changed = api.patch(f"/api/notes/{note['id']}", json={"kind": "bring", "on_date": None}, headers=auth("U01"))
    assert (changed.json()["kind"], changed.json()["on_date"]) == ("bring", None)
    assert api.delete(f"/api/notes/{note['id']}", headers=auth("U01")).status_code == 204
    assert api.patch(f"/api/notes/{note['id']}", json={"text": "x"}, headers=auth("U01")).status_code == 404


def test_bad_notes_are_rejected(tx, api, auth):
    def post(body, customer="C001"):
        return api.post(f"/api/customers/{customer}/notes", json=body, headers=auth("U01")).status_code

    assert post({"kind": "todo", "text": "x"}) == 422
    assert post({"kind": "bring", "text": "   "}) == 422
    assert post({"kind": "bring", "text": "長" * 201}) == 422
    assert post({"kind": "bring", "text": "x", "on_date": "下週三"}) == 422
    assert post({"kind": "bring", "text": "x"}, customer="C002") == 404  # 王冠宇的客戶
    told = api.post("/api/customers/C001/notes", json={"kind": "told", "text": "x"}, headers=auth("U01")).json()
    # 講過的一定有日期
    assert api.patch(f"/api/notes/{told['id']}", json={"on_date": None}, headers=auth("U01")).status_code == 422
    assert api.patch(f"/api/notes/{told['id']}", json={"text": " "}, headers=auth("U01")).status_code == 422


def test_who_can_see_the_notes(tx, api, auth):
    note = api.post("/api/customers/C001/notes", json={"kind": "bring", "text": "DM"}, headers=auth("U01")).json()
    assert api.get("/api/customers/C001/notes", headers=auth("M01")).status_code == 200  # 主管
    assert api.get("/api/customers/C001/notes", headers=auth("U02")).status_code == 404  # 同區別的業務
    assert api.delete(f"/api/notes/{note['id']}", headers=auth("U02")).status_code == 404
    assert api.patch(f"/api/notes/{note['id']}", json={"text": "改"}, headers=auth("M01")).status_code == 200


def test_the_calendar_month(tx, api, auth):
    month = api.get("/api/calendar?month=2026-10", headers=auth("U01")).json()
    assert (month["month"], month["today"]) == ("2026-10", "2026-10-28")
    days = {d["date"]: d for d in month["days"]}
    assert [n["text"] for n in days["2026-10-30"]["notes"]] == ["Premium 眼藥水的貨架卡與試用包"]
    assert days["2026-10-20"]["notes"][0]["kind"] == "told"  # 忠孝店 10/20 講過
    assert all(d["visits"] or d["notes"] for d in month["days"])
    assert any(d["visits"] for d in month["days"])
    assert [d["date"] for d in month["days"]] == sorted(d["date"] for d in month["days"])
    # 預設系統日那個月
    assert api.get("/api/calendar", headers=auth("U01")).json()["month"] == "2026-10"
    november = api.get("/api/calendar?month=2026-11", headers=auth("U01")).json()
    assert "2026-11-04" in {d["date"] for d in november["days"]}  # 學名藥比價表
    assert api.get("/api/calendar?month=2026-13", headers=auth("U01")).status_code == 422
    assert api.get("/api/calendar?month=1028", headers=auth("U01")).status_code == 422
    # 別的業務看不到林昱辰的備忘
    other = api.get("/api/calendar?month=2026-10", headers=auth("U02")).json()
    assert all(n["customer_id"] not in {"C001", "C025", "C027", "C061"} for d in other["days"] for n in d["notes"])
