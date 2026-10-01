"""文字頻道（docs/superpowers/specs/2026-10-01-channel-rail-design.md）：區的主管與 IT 在整區頻道、IT 在全國頻道底下開的頻道。

灌資料放了三個：全國「公司公告」（A01 開）、北區「新品上市」「補貨問題」（M01 開）。
會發言或改資料的測試都跑在 tx fixture 的交易裡（conftest.py），測完回滾。
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.main import app
from app.models import Channel
from app.services import channels


@pytest.fixture
def client():
    return TestClient(app)


def listing(client, headers) -> list[dict]:
    response = client.get("/api/channels", headers=headers)
    assert response.status_code == 200
    return response.json()


def by_name(client, headers) -> dict[str, dict]:
    return {c["name"]: c for c in listing(client, headers)}


def topic_names(client, headers) -> list[str]:
    return [c["name"] for c in listing(client, headers) if c["kind"] == "topic"]


def post(client, headers, channel_id: int, body: str):
    return client.post(f"/api/channels/{channel_id}/messages", json={"body": body}, headers=headers)


def test_topics_hang_under_their_region_or_the_whole_company(engine):
    with Session(engine) as session:
        infos = {i.name: i for i in channels.describe(session, list(session.scalars(select(Channel))))}
    news, notice = infos["新品上市"], infos["公司公告"]
    assert (news.kind, news.path, news.region_id, news.parent_id) == ("topic", "TW.N", "TW.N", infos["北區"].id)
    assert (news.audience, news.archived) == ("北區所有人都看得到", False)
    assert (notice.kind, notice.path, notice.region_id, notice.parent_id) == ("topic", "TW", None, infos["全國"].id)
    assert notice.audience == "全公司都看得到"
    # 文字頻道也用 unit_id 指北區，整區與小組頻道的上層不能被它搶走
    assert infos["北區"].parent_id == infos["全國"].id
    assert infos["陳建宏小組"].parent_id == infos["北區"].id
    assert infos["台北市・大安區"].parent_id == infos["北區"].id


def test_everyone_in_the_region_sees_its_topics_and_everyone_sees_the_national_ones(client, auth):
    assert topic_names(client, auth("U01")) == ["公司公告", "新品上市", "補貨問題"]
    assert topic_names(client, auth("M01")) == ["公司公告", "新品上市", "補貨問題"]
    assert topic_names(client, auth("U04")) == ["公司公告"]
    assert topic_names(client, auth("A01")) == ["公司公告", "新品上市", "補貨問題"]
    news = by_name(client, auth("U01"))["新品上市"]
    assert news["parent_id"] == by_name(client, auth("U01"))["北區"]["id"]
    for path in (f"/api/channels/{news['id']}", f"/api/channels/{news['id']}/messages"):
        assert client.get(path, headers=auth("U04")).status_code == 404


def test_topics_sit_right_after_their_parent(client, auth):
    order = [c["name"] for c in listing(client, auth("U01"))]
    assert order[:6] == ["全國", "公司公告", "北區", "新品上市", "補貨問題", "陳建宏小組"]


def test_an_archived_topic_stays_visible_but_read_only(tx, client, auth):
    news = by_name(client, auth("U01"))["新品上市"]
    tx.execute(update(Channel).where(Channel.id == news["id"]).values(archived_at=func.now()))
    tx.flush()
    listed = by_name(client, auth("U01"))["新品上市"]
    assert listed["archived"] is True
    # 封存的排在同一層沒封存的後面
    assert topic_names(client, auth("U01")) == ["公司公告", "補貨問題", "新品上市"]
    assert client.get(f"/api/channels/{news['id']}/messages", headers=auth("U01")).status_code == 200
    refused = post(client, auth("U01"), news["id"], "還能說嗎")
    assert refused.status_code == 409
    assert refused.json()["detail"] == "這個頻道已封存，不能再發言"


def test_the_badge_counts_topics_under_my_region_and_the_whole_company(tx, client, auth):
    def badge(user_id: str) -> int:
        return client.get("/api/channels/unread", headers=auth(user_id)).json()["count"]

    south = Channel(kind="topic", unit_id="TW.S", name="南區檔期", created_by="M03")
    tx.add(south)
    tx.flush()
    u01, u04 = badge("U01"), badge("U04")
    assert post(client, auth("M03"), south.id, "高雄這週加訂").status_code == 201
    assert (badge("U01"), badge("U04")) == (u01, u04 + 1)
    news = by_name(client, auth("U01"))["新品上市"]
    assert post(client, auth("M01"), news["id"], "試吃包下週到").status_code == 201
    assert badge("U01") == u01 + 1
    # 封存的文字頻道不算紅點：灌資料的兩則加上剛剛那一則都不算了
    tx.execute(update(Channel).where(Channel.id == news["id"]).values(archived_at=func.now()))
    tx.flush()
    assert badge("U01") == u01 - 2


def test_ensure_channels_does_not_mistake_a_topic_for_the_region_channel(tx):
    tx.execute(delete(Channel).where(Channel.kind == "region", Channel.unit_id == "TW.C"))
    tx.add(Channel(kind="topic", unit_id="TW.C", name="中區檔期", created_by="M02"))
    tx.flush()
    channels.ensure_channels(tx)
    assert tx.scalar(select(func.count()).select_from(Channel).where(Channel.kind == "region", Channel.unit_id == "TW.C")) == 1


@pytest.mark.parametrize(
    "duplicate",
    [
        lambda: Channel(kind="region", unit_id="TW.N"),
        lambda: Channel(kind="topic", unit_id="TW.N", name="新品上市", created_by="M01"),
        lambda: Channel(kind="topic", unit_id="TW", name="公司公告", created_by="A01"),
    ],
    ids=["second-region-channel", "same-topic-name", "same-national-topic-name"],
)
def test_the_database_refuses_duplicates(tx, duplicate):
    with pytest.raises(IntegrityError), tx.begin_nested():
        tx.add(duplicate())
        tx.flush()


def test_topic_names_ignore_case_and_only_clash_within_one_unit(tx):
    tx.add(Channel(kind="topic", unit_id="TW.N", name="Promo", created_by="M01"))
    tx.add(Channel(kind="topic", unit_id="TW.S", name="新品上市", created_by="M03"))
    tx.flush()
    with pytest.raises(IntegrityError), tx.begin_nested():
        tx.add(Channel(kind="topic", unit_id="TW.N", name="PROMO", created_by="M01"))
        tx.flush()


def test_only_topics_have_a_name_and_every_topic_has_one(tx):
    for bad in (
        Channel(kind="topic", unit_id="TW.N", created_by="M01"),
        Channel(kind="region", unit_id="TW.N", name="北北區"),
    ):
        with pytest.raises(IntegrityError), tx.begin_nested():
            tx.add(bad)
            tx.flush()
