"""頻道（services/channels.py、api/channels.py）。

頻道跟著組織樹與地點自動存在；看不看得到跟客戶、拜訪同一個式子（Scope.can_see）：
全國頻道全公司、整區與地點頻道和客戶討論串整區、小組頻道到小組。
會發言或改組織的測試都跑在 tx fixture 的交易裡（conftest.py），測完回滾，不影響其他測試的未讀數。
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.main import app
from app.models import Channel
from app.services import channels

NORTH_PLACES = {
    "台北市・中正區", "台北市・大同區", "台北市・中山區", "台北市・松山區", "台北市・大安區", "台北市・萬華區",
    "台北市・信義區", "台北市・士林區", "台北市・北投區", "台北市・內湖區", "台北市・南港區", "台北市・文山區",
    "新北市",
}


@pytest.fixture
def client():
    return TestClient(app)


def listing(client, headers) -> list[dict]:
    response = client.get("/api/channels", headers=headers)
    assert response.status_code == 200
    return response.json()


def names(client, headers) -> set[str]:
    return {c["name"] for c in listing(client, headers)}


def channel_id(client, auth, name: str, user_id: str = "A01") -> int:
    return next(c["id"] for c in listing(client, auth(user_id)) if c["name"] == name)


def test_channels_follow_the_org_tree_and_places(engine):
    with Session(engine) as session:
        infos = channels.describe(session, list(session.scalars(select(Channel).where(Channel.kind != "customer"))))
    by_name = {i.name: i for i in infos}
    # 全國 1、整區 3、小組 4（每位主管一個）、地點 17
    assert len(infos) == 25
    assert (by_name["全國"].path, by_name["全國"].parent_id, by_name["全國"].region_id) == ("TW", None, None)
    assert (by_name["北區"].path, by_name["北區"].parent_id) == ("TW.N", by_name["全國"].id)
    assert (by_name["陳建宏小組"].path, by_name["陳建宏小組"].parent_id) == ("TW.N.M01", by_name["北區"].id)
    assert (by_name["台北市・大安區"].path, by_name["台北市・大安區"].region_id) == ("TW.N", "TW.N")
    assert by_name["台北市・大安區"].parent_id == by_name["北區"].id
    assert by_name["陳建宏小組"].audience == "只有陳建宏小組看得到"
    assert by_name["台北市・大安區"].audience == "北區所有人都看得到"
    assert by_name["全國"].audience == "全公司都看得到"


def test_each_account_sees_its_own_team_its_region_and_the_whole_company(client, auth):
    north = {"全國", "北區", "陳建宏小組"} | NORTH_PLACES
    assert names(client, auth("U01")) == north
    assert names(client, auth("M01")) == north
    # 南區兩組各看各的小組頻道，整區與地點一樣
    assert names(client, auth("U04")) == {"全國", "南區", "許文彬小組", "高雄市", "台南市"}
    assert names(client, auth("U05")) == {"全國", "南區", "蔡宗翰小組", "高雄市", "台南市"}
    assert names(client, auth("M04")) == {"全國", "南區", "蔡宗翰小組", "高雄市", "台南市"}
    # IT 坐在根節點上，全部看得到，包括各組的原始對話
    everything = listing(client, auth("A01"))
    assert len(everything) == 25
    # 全國在最前面，接著北區、北區的小組、北區的地點（照名稱排），再來中區、南區
    order = [c["name"] for c in everything]
    assert order[:4] == ["全國", "北區", "陳建宏小組", "台北市・中山區"]
    assert order.index("台北市・萬華區") < order.index("新北市")
    assert order.index("中區") < order.index("南區")


def test_channels_you_cannot_see_do_not_exist(client, auth):
    team = channel_id(client, auth, "陳建宏小組")
    for path in (f"/api/channels/{team}", f"/api/channels/{team}/messages"):
        assert client.get(path, headers=auth("U04")).status_code == 404
    assert client.post(f"/api/channels/{team}/messages", json={"body": "嗨"}, headers=auth("U04")).status_code == 404
    assert client.get("/api/channels/999999", headers=auth("A01")).status_code == 404
    assert client.get("/api/channels").status_code == 401


def test_a_self_created_account_sees_what_the_demo_rep_sees(tx, client):
    created = client.post(
        "/api/auth/register", json={"name": "評審", "email": "judge@channels.test", "password": "judge-pass-1"}
    ).json()
    headers = {"Authorization": f"Bearer {created['token']}"}
    assert names(client, headers) == {"全國", "北區", "陳建宏小組"} | NORTH_PLACES


def test_a_new_manager_gets_a_team_channel(tx, client, auth):
    boss = {"name": "測試主管", "email": "channel.boss@meddemo.tw", "password": "abcd1234", "role": "manager", "unit_id": "TW.C"}
    assert client.post("/api/admin/users", json=boss, headers=auth("A01")).status_code == 201
    assert "測試主管小組" in names(client, auth("A01"))
    assert "測試主管小組" not in names(client, auth("U03"))


def test_moving_a_manager_carries_the_team_channel(tx, client, auth):
    client.put("/api/admin/users/M01/unit", json={"unit_id": "TW.C"}, headers=auth("A01"))
    seen = names(client, auth("U01"))
    assert {"中區", "陳建宏小組", "台中市", "彰化縣"} <= seen
    assert "北區" not in seen and "台北市・大安區" not in seen


def test_a_demoted_managers_channel_is_archived_for_it_only(tx, client, auth):
    it = auth("A01")
    team = channel_id(client, auth, "蔡宗翰小組")
    client.put("/api/admin/users/U05/manager", json={"manager_id": "M03"}, headers=it)
    demoted = client.put("/api/admin/users/M04/role", json={"role": "sales", "manager_id": "M03"}, headers=it)
    assert demoted.status_code == 200
    assert "蔡宗翰小組" not in names(client, auth("U05"))
    assert "蔡宗翰小組" not in names(client, auth("M04"))
    archived = client.get(f"/api/channels/{team}", headers=it).json()
    assert archived["archived"] is True
    # 封存的頻道排在最後
    assert [c["name"] for c in listing(client, it)][-1] == "蔡宗翰小組"
    assert client.post(f"/api/channels/{team}/messages", json={"body": "還在嗎"}, headers=it).status_code == 409


def test_customer_threads_are_open_to_the_whole_region(tx, client, auth):
    # C002 康泰南京店在台北市中山區，負責人是王冠宇 U02
    opened = client.post("/api/customers/C002/thread", headers=auth("U01"))
    assert opened.status_code == 200
    thread = opened.json()
    assert (thread["kind"], thread["name"], thread["audience"]) == ("customer", "康泰連鎖藥局 · 南京店", "北區所有人都看得到")
    # 可以重複呼叫，拿到同一個
    assert client.post("/api/customers/C002/thread", headers=auth("M01")).json()["id"] == thread["id"]
    assert client.post("/api/customers/C002/thread", headers=auth("U04")).status_code == 404
    assert client.post("/api/customers/C999/thread", headers=auth("U01")).status_code == 404
    # 客戶討論串不放在頻道列表裡
    assert thread["id"] not in {c["id"] for c in listing(client, auth("U01"))}


def test_the_owner_always_sees_their_customers_thread(tx, client, auth):
    # IT 把北區的忠孝店交給南區的吳承翰：他截到整區看不到台北市，但負責人一定看得到自己客戶的討論串
    client.put("/api/admin/customers/C001/owner", json={"owner_id": "U04"}, headers=auth("A01"))
    assert client.post("/api/customers/C001/thread", headers=auth("U04")).status_code == 200
    assert client.post("/api/customers/C001/thread", headers=auth("M03")).status_code == 200
    assert client.post("/api/customers/C001/thread", headers=auth("U03")).status_code == 404
    assert "台北市・大安區" not in names(client, auth("U04"))


def test_ensure_channels_can_run_twice(tx):
    before = tx.scalar(select(Channel.id).order_by(Channel.id.desc()).limit(1))
    channels.ensure_channels(tx)
    channels.ensure_channels(tx)
    assert tx.scalar(select(Channel.id).order_by(Channel.id.desc()).limit(1)) == before
    # 每位主管剛好一個小組頻道
    assert tx.scalar(select(func.count()).select_from(Channel).where(Channel.kind == "team")) == 4
