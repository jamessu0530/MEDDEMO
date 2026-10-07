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
from app.models import AppUser, Channel
from app.services import channels

NORTH_PLACES = {
    "台北市・中正區", "台北市・大同區", "台北市・中山區", "台北市・松山區", "台北市・大安區", "台北市・萬華區",
    "台北市・信義區", "台北市・士林區", "台北市・北投區", "台北市・內湖區", "台北市・南港區", "台北市・文山區",
    "新北市", "新竹市",
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
        infos = channels.describe(
            session, list(session.scalars(select(Channel).where(Channel.kind.not_in(("customer", "topic")))))
        )
    by_name = {i.name: i for i in infos}
    # 全國 1、整區 3、小組 4（每位主管一個）、地點 18
    assert len(infos) == 26
    assert (by_name["全國"].path, by_name["全國"].parent_id, by_name["全國"].region_id) == ("TW", None, None)
    assert (by_name["北區"].path, by_name["北區"].parent_id) == ("TW.N", by_name["全國"].id)
    assert (by_name["陳建宏小組"].path, by_name["陳建宏小組"].parent_id) == ("TW.N.M01", by_name["北區"].id)
    assert (by_name["台北市・大安區"].path, by_name["台北市・大安區"].region_id) == ("TW.N", "TW.N")
    assert by_name["台北市・大安區"].parent_id == by_name["北區"].id
    assert by_name["陳建宏小組"].audience == "只有陳建宏小組看得到"
    assert by_name["台北市・大安區"].audience == "北區所有人都看得到"
    assert by_name["全國"].audience == "全公司都看得到"


def test_each_account_sees_its_own_team_its_region_and_the_whole_company(client, auth):
    north = {"全國", "公司公告", "北區", "新品上市", "補貨問題", "陳建宏小組"} | NORTH_PLACES
    assert names(client, auth("U01")) == north
    assert names(client, auth("M01")) == north
    # 南區兩組各看各的小組頻道，整區、地點與全國的文字頻道一樣
    assert names(client, auth("U04")) == {"全國", "公司公告", "南區", "許文彬小組", "高雄市", "台南市"}
    assert names(client, auth("U05")) == {"全國", "公司公告", "南區", "蔡宗翰小組", "高雄市", "台南市"}
    assert names(client, auth("M04")) == {"全國", "公司公告", "南區", "蔡宗翰小組", "高雄市", "台南市"}
    # IT 坐在根節點上，全部看得到，包括各組的原始對話
    everything = listing(client, auth("A01"))
    assert len(everything) == 29
    # 全國與它的文字頻道在最前面，接著北區、北區的文字頻道、小組、地點（照名稱排），再來中區、南區
    order = [c["name"] for c in everything]
    assert order[:7] == ["全國", "公司公告", "北區", "新品上市", "補貨問題", "陳建宏小組", "台北市・中山區"]
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
    assert names(client, headers) == {"全國", "公司公告", "北區", "新品上市", "補貨問題", "陳建宏小組"} | NORTH_PLACES


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


def post(client, headers, channel, body):
    return client.post(f"/api/channels/{channel}/messages", json={"body": body}, headers=headers)


def history(client, headers, channel, **params):
    response = client.get(f"/api/channels/{channel}/messages", params=params, headers=headers)
    assert response.status_code == 200
    return response.json()


def test_posting_and_polling_for_new_messages(tx, client, auth):
    team = channel_id(client, auth, "陳建宏小組", "U01")
    before = history(client, auth("U02"), team)
    posted = post(client, auth("U01"), team, "  忠孝店的檔期資料我週三前給  ")
    assert posted.status_code == 201
    message = posted.json()
    assert (message["kind"], message["body"], message["author_name"], message["mine"]) == (
        "user", "忠孝店的檔期資料我週三前給", "林昱辰", True
    )
    # 同組的人輪詢拿得到，對他來說不是自己發的
    new = history(client, auth("U02"), team, after=before[-1]["id"] if before else 0)
    assert [m["id"] for m in new][-1] == message["id"] and new[-1]["mine"] is False
    # 空白、太長的訊息擋下
    assert post(client, auth("U01"), team, "   ").status_code == 422
    assert post(client, auth("U01"), team, "字" * 2001).status_code == 422


def test_scrolling_back_pages_from_old_to_new(tx, client, auth):
    national = channel_id(client, auth, "全國", "U01")
    ids = [post(client, auth("U01"), national, f"第 {n} 則").json()["id"] for n in range(3)]
    latest = history(client, auth("U03"), national, limit=2)
    assert [m["id"] for m in latest] == ids[1:]
    assert [m["id"] for m in history(client, auth("U03"), national, before=ids[1], limit=2)][-1] == ids[0]


def test_unread_skips_my_own_messages_and_only_moves_forward(tx, client, auth):
    team = channel_id(client, auth, "陳建宏小組", "U01")

    def unread(user_id):
        return next(c["unread"] for c in listing(client, auth(user_id)) if c["id"] == team)

    # 不靠灌資料的對話：自己先放一則，U02 讀到這裡
    first = post(client, auth("M01"), team, "這週的拜訪量記得回報").json()
    assert client.post(f"/api/channels/{team}/read", json={"message_id": first["id"]}, headers=auth("U02")).status_code == 204
    assert unread("U02") == 0
    mine = post(client, auth("U01"), team, "新的一則").json()
    assert unread("U02") == 1
    # 發言的人自己不算未讀，發言之前的也一起算讀過
    assert unread("U01") == 0
    # 舊的請求晚到，不會把讀到的位置往回拉；比最新還大的編號也只算到最新那則
    client.post(f"/api/channels/{team}/read", json={"message_id": mine["id"] + 1000}, headers=auth("U02"))
    client.post(f"/api/channels/{team}/read", json={"message_id": 1}, headers=auth("U02"))
    assert unread("U02") == 0
    post(client, auth("M01"), team, "再一則")
    assert unread("U02") == 1


def test_the_badge_counts_my_team_my_region_and_my_customers_only(tx, client, auth):
    def badge(user_id):
        return client.get("/api/channels/unread", headers=auth(user_id)).json()["count"]

    # 灌資料放的對話：陳建宏小組 5 則（林昱辰 2、陳建宏 2、王冠宇 1）、大安區 2 則、忠孝店討論串 2 則（林昱辰），
    # 文字頻道：新品上市 2 則（陳建宏、王冠宇）、補貨問題 1 則（林昱辰）、公司公告 1 則（James）
    assert badge("U02") == 7          # 小組裡別人發的 4 則、新品上市 1、補貨問題 1、公司公告 1；地點頻道不算紅點
    assert badge("U01") == 6          # 小組裡別人發的 3 則、新品上市 2、公司公告 1；忠孝店與補貨問題是自己發的
    assert badge("M01") == 8          # 小組 3 則、組員負責的忠孝店 2 則、新品上市 1、補貨問題 1、公司公告 1
    assert badge("A01") == 3          # IT 只算全國與三個區，加上底下的文字頻道：新品上市 2、補貨問題 1
    national = channel_id(client, auth, "全國", "U04")
    post(client, auth("U04"), national, "南區這週辦檔期")
    assert badge("U02") == 8 and badge("A01") == 4


def test_a_place_lists_only_threads_with_messages(tx, client, auth):
    zhongshan = channel_id(client, auth, "台北市・中山區", "U01")
    thread = client.post("/api/customers/C002/thread", headers=auth("U01")).json()
    assert client.get(f"/api/channels/{zhongshan}/threads", headers=auth("U01")).json() == []
    post(client, auth("U01"), thread["id"], "南京店店長換人了")
    listed = client.get(f"/api/channels/{zhongshan}/threads", headers=auth("U02")).json()
    assert [(t["name"], t["unread"]) for t in listed] == [("康泰連鎖藥局 · 南京店", 1)]
    # 大安區有灌資料放的忠孝店討論串
    daan = channel_id(client, auth, "台北市・大安區", "U01")
    assert [t["name"] for t in client.get(f"/api/channels/{daan}/threads", headers=auth("M01")).json()] == [
        "康泰連鎖藥局 · 忠孝店"
    ]


def test_threads_404s_on_a_channel_that_is_not_a_place(client, auth):
    # 全國、整區、小組頻道底下沒有討論串，回 404 而不是空清單，免得畫面顯示「還沒有人開討論串」這種誤導的訊息
    national = channel_id(client, auth, "全國")
    team = channel_id(client, auth, "陳建宏小組")
    for cid in (national, team):
        response = client.get(f"/api/channels/{cid}/threads", headers=auth("U01"))
        assert response.status_code == 404
        assert response.json()["detail"] == "找不到這個地點"


@pytest.mark.parametrize("body", [
    "@熊熊滾 近效期退貨運費誰付？", "請問 @熊熊 一下", "請@熊熊滾回答", "＠熊熊滾 在嗎",
    "@AI 幫我整理", "@ai請問", "＠ＡＩ 請問", "第一行\n@熊熊滾 第二行",
])
def test_these_call_the_mascot(body):
    assert channels.mentions_mascot(body)


@pytest.mark.parametrize("body", ["寄到 x@ai.com", "@AIDS 衛教單張", "熊熊滾好可愛", "@熊 在嗎"])
def test_these_do_not_call_the_mascot(body):
    assert not channels.mentions_mascot(body)


def visible(session, user_id: str, name: str):
    user = session.get(AppUser, user_id)
    return user, next(i for i in channels.visible_channels(session, user) if i.name == name)


def test_a_message_remembers_whether_it_called_the_mascot_and_the_mascot_replies_to_it(tx, client, auth):
    user, team = visible(tx, "U01", "陳建宏小組")
    asked = channels.post(tx, user, team, "@熊熊滾 在嗎")
    reply = channels.post_mascot(tx, team.id, "在喔", asked.id)
    assert asked.mentions_ai is True and asked.reply_to_id is None
    assert (reply.kind, reply.author_id, reply.reply_to_id, reply.mentions_ai) == ("ai", None, asked.id, False)
    assert reply.id > asked.id
    # 一般發言 mentions_ai 是 false；API 都帶這兩欄
    plain = post(client, auth("U01"), team.id, "忠孝店的檔期資料我週三前給").json()
    assert (plain["mentions_ai"], plain["reply_to_id"]) == (False, None)
    latest = history(client, auth("U02"), team.id)[-3:]
    assert [(m["kind"], m["reply_to_id"]) for m in latest] == [("user", None), ("ai", asked.id), ("user", None)]
    # 寫入排隊（編號順序等於寫完的順序）在 test_attachments 的 test_posts_to_one_channel_take_numbers_in_the_order_they_finish
