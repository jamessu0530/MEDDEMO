"""客戶檔案（FR-2）：用灌好的假資料檢查數字與待處理事項。談判卡的測試在 test_negotiation.py。"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import customer_profile


@pytest.fixture
def client(engine, sign_in):
    # 用到的 C001、C030 分屬北區兩位業務，他們的主管 M01 兩家都看得到
    return sign_in(TestClient(app), "M01")


def test_profile_shows_the_lengthening_interval_and_open_items(client):
    # 康泰忠孝店是刻意設計的案例：進貨間隔 21 → 34 天、單次金額持平，10/19 拜訪提到御松田
    profile = client.get("/api/customers/C001/profile").json()
    stats = profile["stats"]
    assert (stats["interval_before"], stats["interval_last_90d"]) == (21.0, 34.3)
    assert stats["interval_alert"] is True
    assert profile["highlights"][0] == "進貨間隔從 21 天拉長到 34 天，單次金額持平"
    assert "答應客戶的「回報檔期」已過期限（10/24）" in profile["highlights"]
    assert "10/19 拜訪提到競品御松田" in profile["highlights"]
    assert len(profile["intervals"]) == 6 and profile["intervals"][-1]["month"] == "2026-10"
    assert [c["text"] for c in profile["commitments"] if c["overdue"]] == ["回報檔期"]
    assert [c["text"] for c in profile["complaints"]] == ["補貨延遲三天"]
    assert [c["name"] for c in profile["competitors"]] == ["御松田"]
    assert len(profile["open_quotes"]) == 1


def test_the_complaint_still_makes_the_brief_when_there_are_five_sentences(client):
    # 康泰忠孝店有 5 句：間隔、上次訂的、過期承諾、競品、客訴；上限 5 句才不會把客訴擠掉
    highlights = client.get("/api/customers/C001/profile").json()["highlights"]
    assert "客訴：補貨延遲三天（10/19）" in highlights
    assert len(highlights) == 5


def test_a_steady_customer_gets_no_interval_alert(client):
    # 明德北投：間隔 34.4 → 36.0 天，變化不到兩成
    profile = client.get("/api/customers/C030/profile").json()
    assert profile["stats"]["interval_alert"] is False
    assert not any("拉長" in line for line in profile["highlights"])


def test_an_unknown_customer_is_not_found(client):
    assert client.get("/api/customers/C999/profile").status_code == 404


def test_the_brief_says_which_packs_changed_since_the_last_order(client):
    highlights = client.get("/api/customers/C001/profile").json()["highlights"]
    # 排在進貨間隔那句後面
    assert highlights[1] == "上次訂的有 3 項這期促銷變了：40EXa眼藥水(中口)沒了、金舒胃平(小口)要買的量變多、威鎮凝膠沒有促銷了"
    assert not any("上次訂的" in line for line in client.get("/api/customers/C030/profile").json()["highlights"])


def test_the_brief_lists_three_changes_at_most():
    shorts = ["甲沒了", "乙沒了", "丙沒了", "丁沒了"]
    assert customer_profile.last_order_highlight(shorts) == "上次訂的有 4 項這期促銷變了：甲沒了、乙沒了、丙沒了等"
    assert customer_profile.last_order_highlight([]) is None
