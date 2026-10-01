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


# 開、改名、封存


def create(client, headers, parent_id: int, name: str):
    return client.post("/api/channels", json={"parent_id": parent_id, "name": name}, headers=headers)


def change(client, headers, channel_id: int, **body):
    return client.patch(f"/api/channels/{channel_id}", json=body, headers=headers)


def ids(client, auth) -> dict[str, int]:
    return {name: c["id"] for name, c in by_name(client, auth("A01")).items()}


def test_who_can_open_a_topic_where(tx, client, auth):
    c = ids(client, auth)
    made = create(client, auth("M01"), c["北區"], "  陳列競賽 ")
    assert made.status_code == 201
    topic = made.json()
    assert (topic["kind"], topic["name"], topic["parent_id"], topic["region_id"]) == ("topic", "陳列競賽", c["北區"], "TW.N")
    assert (topic["audience"], topic["archived"], topic["can_manage"]) == ("北區所有人都看得到", False, True)
    assert "陳列競賽" in topic_names(client, auth("U02"))
    assert "陳列競賽" not in topic_names(client, auth("U04"))
    # 主管只管自己這一區，全國只有 IT
    assert create(client, auth("M01"), c["全國"], "北區也想公告").status_code == 403
    assert create(client, auth("M01"), c["南區"], "南區的事").status_code == 404
    assert create(client, auth("M03"), c["南區"], "左營檔期").status_code == 201
    assert create(client, auth("M04"), c["南區"], "台南診所").status_code == 201
    assert create(client, auth("U01"), c["北區"], "業務自己開").status_code == 403
    assert create(client, auth("A01"), c["全國"], "教育訓練").status_code == 201
    assert create(client, auth("A01"), c["中區"], "中區檔期").status_code == 201
    # 小組、地點、文字頻道底下不能再開
    assert create(client, auth("M01"), c["陳建宏小組"], "小組裡開").status_code == 400
    assert create(client, auth("A01"), c["台北市・大安區"], "地點裡開").status_code == 400
    assert create(client, auth("A01"), c["新品上市"], "頻道裡開").status_code == 400
    assert create(client, auth("A01"), 999_999, "不存在").status_code == 404


def test_a_self_created_account_cannot_open_topics(tx, client):
    created = client.post(
        "/api/auth/register", json={"name": "評審", "email": "judge@topics.test", "password": "judge-pass-1"}
    ).json()
    headers = {"Authorization": f"Bearer {created['token']}"}
    north = by_name(client, headers)["北區"]
    assert north["can_manage"] is False
    assert create(client, headers, north["id"], "評審開的").status_code == 403


def test_topic_names_are_trimmed_limited_and_unique_within_a_unit(tx, client, auth):
    c = ids(client, auth)
    assert create(client, auth("M01"), c["北區"], "   ").status_code == 422
    assert create(client, auth("M01"), c["北區"], "字" * 21).status_code == 422
    assert create(client, auth("M01"), c["北區"], "字" * 20).status_code == 201
    taken = create(client, auth("M01"), c["北區"], " 新品上市 ")
    assert taken.status_code == 409
    assert taken.json()["detail"] == "北區已經有叫「新品上市」的頻道"
    assert create(client, auth("M01"), c["北區"], "Promo").status_code == 201
    assert create(client, auth("M01"), c["北區"], "PROMO").status_code == 409
    # 別區可以用同一個名字；全國的重名訊息寫「全國」
    assert create(client, auth("M03"), c["南區"], "新品上市").status_code == 201
    assert create(client, auth("A01"), c["全國"], "公司公告").json()["detail"] == "全國已經有叫「公司公告」的頻道"


def test_managers_of_the_region_rename_and_archive_any_topic_there(tx, client, auth):
    c = ids(client, auth)
    topic = create(client, auth("A01"), c["北區"], "陳列競賽").json()["id"]
    renamed = change(client, auth("M01"), topic, name="陳列比賽")
    assert renamed.status_code == 200 and renamed.json()["name"] == "陳列比賽"
    assert change(client, auth("M01"), topic, name="補貨問題").status_code == 409
    assert change(client, auth("M01"), topic, name="  ").status_code == 422
    assert change(client, auth("M03"), topic, archived=True).status_code == 404
    assert change(client, auth("U01"), topic, archived=True).status_code == 403
    archived = change(client, auth("M01"), topic, archived=True)
    assert archived.status_code == 200 and archived.json()["archived"] is True
    assert by_name(client, auth("U01"))["陳列比賽"]["archived"] is True
    assert post(client, auth("U01"), topic, "還能說嗎").status_code == 409
    restored = change(client, auth("M01"), topic, archived=False)
    assert restored.json()["archived"] is False
    assert post(client, auth("U01"), topic, "又能說了").status_code == 201
    # 全國的文字頻道只有 IT 能動；整區頻道本身不能改名或封存
    assert change(client, auth("M01"), c["公司公告"], archived=True).status_code == 403
    assert change(client, auth("A01"), c["公司公告"], archived=True).status_code == 200
    assert change(client, auth("A01"), c["北區"], name="北北區").status_code == 400


def test_can_manage_follows_the_region(client, auth):
    m01 = by_name(client, auth("M01"))
    assert m01["北區"]["can_manage"] and m01["新品上市"]["can_manage"]
    assert not m01["全國"]["can_manage"] and not m01["公司公告"]["can_manage"]
    assert not m01["陳建宏小組"]["can_manage"] and not m01["台北市・大安區"]["can_manage"]
    assert not any(c["can_manage"] for c in listing(client, auth("U01")))
    m03 = by_name(client, auth("M03"))
    assert m03["南區"]["can_manage"] and not m03["全國"]["can_manage"]
    a01 = by_name(client, auth("A01"))
    assert all(a01[name]["can_manage"] for name in ("全國", "北區", "中區", "南區", "公司公告", "新品上市"))
    assert not a01["陳建宏小組"]["can_manage"]


def test_an_archived_topics_memory_cannot_be_edited(tx, client, auth):
    from app.models import MemoryItem

    news = by_name(client, auth("U01"))["新品上市"]["id"]
    memory = MemoryItem(channel_id=news, category="decision", text="新包裝下個月上市")
    tx.add(memory)
    tx.flush()
    assert change(client, auth("M01"), news, archived=True).status_code == 200
    refused = client.patch(f"/api/memory/{memory.id}", json={"text": "改一下"}, headers=auth("U01"))
    assert refused.status_code == 409
    assert refused.json()["detail"] == "這個頻道已封存，重點不能再改"


def test_shared_topic_memory_reaches_the_region_and_national_boards(tx, client, auth):
    from app.models import MemoryItem

    c = ids(client, auth)
    shared = MemoryItem(
        channel_id=c["新品上市"], category="decision", text="固循魚油下個月換新包裝，舊包裝先清",
        shared=True, shared_text="固循魚油下個月換新包裝",
    )
    tx.add(shared)
    tx.flush()
    for board in (c["北區"], c["全國"]):
        below = client.get(f"/api/channels/{board}/board", headers=auth("U01")).json()["below"]
        group = next(g for g in below if g["channel_id"] == c["新品上市"])
        assert [i["text"] for i in group["items"] if i["id"] == shared.id] == ["固循魚油下個月換新包裝"]


def test_opening_renaming_and_archiving_tell_every_socket(tx, client, engine, auth):
    from conftest import token_for

    def next_channels_event(ws) -> dict:
        while True:
            event = ws.receive_json()
            if event["type"] == "channels":
                return event

    c = ids(client, auth)
    with client.websocket_connect("/api/ws") as ws:
        ws.send_json({"type": "auth", "token": token_for(engine, "U04"), "active": True})
        assert ws.receive_json()["type"] == "ready"
        topic = create(client, auth("M01"), c["北區"], "陳列競賽").json()["id"]
        # 事件不帶內容，看不到北區的人也收得到；收到只是重新載入自己看得到的列表
        assert next_channels_event(ws) == {"type": "channels"}
        change(client, auth("M01"), topic, name="陳列比賽")
        assert next_channels_event(ws) == {"type": "channels"}
        change(client, auth("M01"), topic, archived=True)
        assert next_channels_event(ws) == {"type": "channels"}
