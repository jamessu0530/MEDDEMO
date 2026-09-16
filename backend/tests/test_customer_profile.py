"""客戶檔案（FR-2）與談判卡（FR-3）：用灌好的假資料檢查數字、待處理事項與內部文件的切入點。"""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.services import customer_profile
from app.services.documents import index_documents


@pytest.fixture
def client(engine, sign_in):
    # 用到的 C001、C030 分屬北區兩位業務，北區主管兩家都看得到
    return sign_in(TestClient(app), "M01")


@pytest.fixture
def company_docs(engine):
    """重建成完整的 20 份內部文件：別的測試會把索引換成兩份測試用文件。"""
    with Session(engine) as session:
        index_documents(session)
        session.commit()


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


def test_a_steady_customer_gets_no_interval_alert(client):
    # 明德北投：間隔 34.4 → 36.0 天，變化不到兩成
    profile = client.get("/api/customers/C030/profile").json()
    assert profile["stats"]["interval_alert"] is False
    assert not any("拉長" in line for line in profile["highlights"])


def test_an_unknown_customer_is_not_found(client):
    assert client.get("/api/customers/C999/profile").status_code == 404


def test_negotiation_card_compares_with_the_region_and_quotes_company_documents(client, company_docs):
    card = client.get("/api/customers/C001/negotiation").json()
    assert card["turnover"] and all(item["orders_per_month"] >= 0 for item in card["turnover"])
    assert any(item["region_orders_per_month"] for item in card["turnover"])
    margin = card["margin"]
    assert 0 < margin["net_margin_rate"] < 1 and margin["summary"].startswith("上架費")
    # 忠孝店近期提到競品、進貨間隔拉長：切入點依序是這兩個情況，內容是內部文件的原文
    assert [tip["reason"] for tip in card["tips"][:2]] == ["近 90 天的拜訪提到競品", "進貨間隔拉長"]
    assert [tip["section"] for tip in card["tips"][:2]] == ["陳列位被調降或被競品取代", "檔期活動的申請期限"]
    assert len(card["tips"]) <= 3


def test_only_chain_customers_have_a_negotiation_card(client):
    assert client.get("/api/customers/C030/negotiation").status_code == 409


@pytest.mark.parametrize(
    ("signal", "section"),
    [
        ("competitor", "陳列位被調降或被競品取代"),
        ("interval_up", "檔期活動的申請期限"),
        ("contract_ending", "連鎖合約的續約與費率調整"),
        ("ar_overdue", "帳齡超過 60 天的處理"),
        ("chain", "陳列位與上架費的連動"),
    ],
)
def test_each_topic_in_the_settings_finds_its_intended_section(engine, company_docs, signal, section):
    """negotiation_topics.json 的每組關鍵字都要找到想要的段落；改了文件或關鍵字，這裡會先發現"""
    topics = {topic["signal"]: topic for topic in json.loads(customer_profile.TOPICS_FILE.read_text(encoding="utf-8"))["topics"]}
    with Session(engine) as session:
        assert customer_profile._best_section(session, topics[signal]["keywords"], set()).section == section
