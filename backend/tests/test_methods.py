"""方法卡（services/method_cards.py、api/methods.py）。

主管寫、全公司看；業務按「有幫上／沒幫上」，採用次數＝有幫上的筆數。
灌資料放了十張卡與三百筆回饋（catalog.METHOD_CARDS），test_seed.py 會對每張卡的次數，
所以這裡每個測試都跑在 tx fixture 的交易裡（conftest.py），測完回滾。
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import AppUser, MethodCard, MethodCardFeedback
from app.services import method_cards

CARD = {
    "title": "測試：客戶說要再想想",
    "situation": "談到最後客戶說要再想想、下次再說。",
    "approach": "1. 不要追問為什麼。\n2. 問他下次哪一天方便，寫進追蹤日。",
    "customer_type": None,
    "tags": ["newcomer"],
}
RIVAL = "御松田來搶陳列位：先守住櫃檯旁那一格"
SMALL_LOT = "獨立藥局小口進貨：算一盒賺多少給老闆看"
GENERICS = "慢箋量在長的診所：帶學名藥比價表去"
DISCOUNT = "客戶開口要折扣：先問量，超過 3% 不要當場答應"


@pytest.fixture
def client(tx):
    return TestClient(app)


def create(client, headers, **changes):
    return client.post("/api/methods", json=CARD | changes, headers=headers)


def listing(client, headers, **params) -> list[dict]:
    response = client.get("/api/methods", params=params, headers=headers)
    assert response.status_code == 200
    return response.json()


def titles(client, headers, **params) -> list[str]:
    return [card["title"] for card in listing(client, headers, **params)]


def card(client, headers, title: str, **params) -> dict:
    return next(c for c in listing(client, headers, **params) if c["title"] == title)


def press(client, headers, card_id: int, helped: bool, customer_id: str | None = None):
    body = {"helped": helped} | ({"customer_id": customer_id} if customer_id else {})
    return client.post(f"/api/methods/{card_id}/feedback", json=body, headers=headers)


def test_everyone_signed_in_sees_every_published_card_most_adopted_first(client, auth):
    cards = listing(client, auth("U04"))
    assert len(cards) == 10
    assert set(cards[0]) == {
        "id", "title", "situation", "approach", "customer_type", "tags", "author_name", "status",
        "adopted", "not_helped", "my_feedback", "updated_at",
    }
    # 北區主管寫的卡，南區的業務一樣看得到：方法卡不分區
    assert (cards[0]["title"], cards[0]["author_name"], cards[0]["adopted"], cards[0]["not_helped"]) == (RIVAL, "陳建宏", 46, 6)
    assert [c["adopted"] for c in cards] == sorted((c["adopted"] for c in cards), reverse=True)
    assert all(c["status"] == "published" and c["my_feedback"] is None for c in cards)
    # 主管、IT、自建帳號看到的是同一份
    for user_id in ("M02", "A01"):
        assert titles(client, auth(user_id)) == [c["title"] for c in cards]
    created = client.post(
        "/api/auth/register", json={"name": "評審", "email": "judge.list@methods.test", "password": "judge-pass-1"}
    ).json()
    assert titles(client, {"Authorization": f"Bearer {created['token']}"}) == [c["title"] for c in cards]
    assert client.get("/api/methods").status_code == 401


def test_cards_with_the_same_adoption_put_the_latest_edit_first(client, auth):
    first = create(client, auth("M01"), title="測試：先寫的").json()
    second = create(client, auth("M01"), title="測試：後寫的").json()
    assert titles(client, auth("U01"))[-2:] == ["測試：後寫的", "測試：先寫的"]
    assert client.patch(f"/api/methods/{first['id']}", json={"situation": "改過了"}, headers=auth("M01")).status_code == 200
    assert titles(client, auth("U01"))[-2:] == ["測試：先寫的", "測試：後寫的"]
    # 有人說有幫上，就排到沒人按過的前面
    assert press(client, auth("U01"), second["id"], True).status_code == 200
    assert titles(client, auth("U01"))[-2:] == ["測試：後寫的", "測試：先寫的"]


def test_the_list_filters_by_tag_customer_type_and_keyword(client, auth):
    rep = auth("U01")
    assert len(titles(client, rep, tag="newcomer")) == 3
    assert titles(client, rep, tag="contract_ending") == ["連鎖續約：到期前三個月先把淨毛利算清楚"]
    # 適用類型：指定那一種的，加上每種客戶都適用的
    clinic = listing(client, rep, customer_type="clinic")
    assert {c["customer_type"] for c in clinic} == {"clinic", None} and len(clinic) == 6
    assert titles(client, rep, tag="cost", customer_type="independent") == [SMALL_LOT, DISCOUNT]
    # 關鍵字在標題、情況、做法裡找，英文不分大小寫
    assert titles(client, rep, q="比價表") == [GENERICS]
    assert titles(client, rep, q="壓庫存") == [SMALL_LOT]
    assert titles(client, rep, q="財務部") == ["帳款超過 60 天：先打電話問付款日，再進門"]
    assert titles(client, rep, q=" amlodipine ") == [GENERICS]
    # % 是字面上的百分比，不是萬用字元
    assert titles(client, rep, q="3%") == [GENERICS, DISCOUNT]
    assert titles(client, rep, q="這句話沒有任何一張卡寫過") == []
    assert client.get("/api/methods", params={"tag": "unknown"}, headers=rep).status_code == 422
    assert client.get("/api/methods", params={"customer_type": "hospital"}, headers=rep).status_code == 422


def test_keyword_wildcards_and_escape_characters_are_taken_literally(client, auth):
    boss, rep = auth("M01"), auth("U01")
    create(client, boss, title="測試：料號 A_B 的搭贈")
    create(client, boss, title="測試：料號 AxB 的搭贈")
    create(client, boss, title="測試：路徑", approach="報表放在 share\\sales 底下。")
    create(client, boss, title="測試：比例", approach="買 10/送 2 換算成折扣。")
    # _ 在 LIKE 裡是「任何一個字」：當成萬用字元的話 A_B 會連 AxB 一起找到
    assert titles(client, rep, q="A_B") == ["測試：料號 A_B 的搭贈"]
    # 反斜線是 Postgres LIKE 預設的跳脫字元、斜線是這裡指定的跳脫字元，兩個都要當一般的字
    assert titles(client, rep, q="share\\sales") == ["測試：路徑"]
    assert titles(client, rep, q="\\") == ["測試：路徑"]
    assert titles(client, rep, q="10/送") == ["測試：比例"]
    assert titles(client, rep, q="share_sales") == []


def test_only_managers_and_it_write_cards(client, auth):
    assert create(client, auth("U01")).status_code == 403
    assert TestClient(app).post("/api/methods", json=CARD).status_code == 401
    created = create(client, auth("M02"), title="  測試：客戶說要再想想  ", tags=["newcomer", "cost", "newcomer"])
    assert created.status_code == 201
    new = created.json()
    assert (new["title"], new["author_name"], new["status"], new["tags"]) == ("測試：客戶說要再想想", "張淑芬", "published", ["newcomer", "cost"])
    assert (new["adopted"], new["not_helped"], new["my_feedback"]) == (0, 0, None)
    # 寫好馬上全公司看得到
    assert new["id"] in {c["id"] for c in listing(client, auth("U05"))}
    # IT 也能寫
    assert create(client, auth("A01"), title="測試：IT 寫的").json()["author_name"] == "James"


def test_a_card_is_edited_by_its_author_or_it_only(client, auth):
    mine = create(client, auth("M02")).json()
    path = f"/api/methods/{mine['id']}"
    assert client.patch(path, json={"title": "測試：別人改的"}, headers=auth("M01")).status_code == 403
    assert client.patch(path, json={"title": "測試：業務改的"}, headers=auth("U03")).status_code == 403
    assert client.patch(path, json={"title": "測試"}).status_code == 401
    edited = client.patch(
        path, json={"title": "測試：作者改的", "customer_type": "chain", "tags": ["competitor"]}, headers=auth("M02")
    )
    assert edited.status_code == 200
    body = edited.json()
    # 沒送的欄位不動
    assert (body["title"], body["customer_type"], body["tags"], body["situation"]) == (
        "測試：作者改的", "chain", ["competitor"], CARD["situation"]
    )
    # 適用類型送 null 是改回「都適用」，跟沒送不一樣
    assert client.patch(path, json={"customer_type": None}, headers=auth("M02")).json()["customer_type"] is None
    by_it = client.patch(path, json={"approach": "IT 補了一句。"}, headers=auth("A01")).json()
    # IT 改誰的都行，作者還是原本那位
    assert (by_it["approach"], by_it["author_name"]) == ("IT 補了一句。", "張淑芬")
    assert client.patch("/api/methods/999999", json={"title": "測試：不存在"}, headers=auth("A01")).status_code == 404


def test_a_retired_card_disappears_for_reps_but_stays_with_its_author(client, auth):
    mine = create(client, auth("M03")).json()
    path = f"/api/methods/{mine['id']}"
    assert client.patch(path, json={"status": "retired"}, headers=auth("M03")).json()["status"] == "retired"
    for user_id in ("U04", "M03", "A01"):
        assert mine["id"] not in {c["id"] for c in listing(client, auth(user_id))}
    # 作者在主管端看得到、IT 看全部，別的主管看不到
    assert mine["id"] in {c["id"] for c in client.get("/api/methods/mine", headers=auth("M03")).json()}
    assert mine["id"] in {c["id"] for c in client.get("/api/methods/mine", headers=auth("A01")).json()}
    assert mine["id"] not in {c["id"] for c in client.get("/api/methods/mine", headers=auth("M04")).json()}
    # 下架的卡不收回饋
    assert press(client, auth("U04"), mine["id"], True).status_code == 404
    # 重新上架
    assert client.patch(path, json={"status": "published"}, headers=auth("M03")).status_code == 200
    assert mine["id"] in {c["id"] for c in listing(client, auth("U04"))}
    assert client.patch(path, json={"status": "deleted"}, headers=auth("M03")).status_code == 422


def test_the_manager_tab_lists_my_own_cards_and_it_sees_them_all(client, auth):
    mine = client.get("/api/methods/mine", headers=auth("M01")).json()
    assert {c["author_name"] for c in mine} == {"陳建宏"} and len(mine) == 3
    assert {c["title"]: c["adopted"] for c in mine}[RIVAL] == 46
    assert len(client.get("/api/methods/mine", headers=auth("A01")).json()) == 10
    assert client.get("/api/methods/mine", headers=auth("U01")).status_code == 403
    assert client.get("/api/methods/mine").status_code == 401
    # 最近改過的排最前面：剛寫好的卡還沒有人採用，照採用次數排會沉到最底下
    new = create(client, auth("M01")).json()
    assert client.get("/api/methods/mine", headers=auth("M01")).json()[0]["id"] == new["id"]


def test_pressing_again_changes_the_answer_instead_of_adding_one(client, auth):
    rep = auth("U01")
    before = card(client, rep, RIVAL)
    first = press(client, rep, before["id"], True)
    assert first.status_code == 200
    assert (first.json()["adopted"], first.json()["not_helped"], first.json()["my_feedback"]) == (47, 6, True)
    # 同一個答案再按一次，次數不重複算
    assert press(client, rep, before["id"], True).json()["adopted"] == 47
    changed = press(client, rep, before["id"], False).json()
    assert (changed["adopted"], changed["not_helped"], changed["my_feedback"]) == (46, 7, False)
    # 別人看到的次數也跟著變，但他自己沒按過
    seen = card(client, auth("U02"), RIVAL)
    assert (seen["adopted"], seen["not_helped"], seen["my_feedback"]) == (46, 7, None)
    assert press(client, rep, 999999, True).status_code == 404
    assert client.post(f"/api/methods/{before['id']}/feedback", json={"helped": True}).status_code == 401


def test_each_customer_counts_once_and_my_feedback_follows_the_customer(client, auth):
    rep = auth("U02")
    target = card(client, rep, DISCOUNT)
    # C002 康泰南京店是王冠宇的客戶；灌資料沒有他在這家按這張卡的紀錄
    assert card(client, rep, DISCOUNT, customer_id="C002")["my_feedback"] is None
    assert press(client, rep, target["id"], True).json()["adopted"] == 8
    on_customer = press(client, rep, target["id"], False, "C002").json()
    assert (on_customer["adopted"], on_customer["not_helped"], on_customer["my_feedback"]) == (8, 2, False)
    # 清單上按的跟在那家客戶按的是兩筆，各看各的
    assert card(client, rep, DISCOUNT)["my_feedback"] is True
    assert card(client, rep, DISCOUNT, customer_id="C002")["my_feedback"] is False
    assert card(client, rep, DISCOUNT, customer_id="C004")["my_feedback"] is None
    assert press(client, rep, target["id"], True, "C999").status_code == 404
    # 客戶清單全公司共享：別區的客戶也可以記
    assert press(client, rep, target["id"], True, "C017").status_code == 200


def test_a_self_created_account_gives_feedback_under_its_own_name(tx, client, auth):
    created = client.post(
        "/api/auth/register", json={"name": "評審", "email": "judge@methods.test", "password": "judge-pass-1"}
    ).json()
    judge = {"Authorization": f"Bearer {created['token']}"}
    target = card(client, judge, SMALL_LOT)
    assert press(client, judge, target["id"], True).json()["adopted"] == 45
    # 記在自己名下，不是他代理的林昱辰：林昱辰自己還沒按過，也還能再按一筆
    rows = tx.execute(
        select(MethodCardFeedback.user_id, AppUser.acts_as_user_id)
        .join(AppUser, AppUser.id == MethodCardFeedback.user_id)
        .where(MethodCardFeedback.card_id == target["id"], MethodCardFeedback.customer_id.is_(None))
    ).all()
    assert [tuple(row) for row in rows] == [(created["user"]["id"], "U01")]
    assert card(client, auth("U01"), SMALL_LOT)["my_feedback"] is None
    assert press(client, auth("U01"), target["id"], True).json()["adopted"] == 46
    # 刪除帳號時回饋一起刪（隱私權政策寫的刪除方式），次數跟著少一筆
    assert client.delete("/api/auth/me", headers=judge).status_code == 204
    assert card(client, auth("U01"), SMALL_LOT)["adopted"] == 45


def test_a_bad_card_is_refused_with_the_field_named(client, auth):
    boss = auth("M01")
    cases = [
        ({"tags": ["unknown"]}, "標籤"),
        ({"tags": []}, "標籤"),
        ({"customer_type": "hospital"}, "適用類型"),
        ({"title": "短"}, "標題"),
        ({"title": "字" * 41}, "標題"),
        ({"situation": "   "}, "情況"),
        ({"situation": "字" * 201}, "情況"),
        ({"approach": ""}, "做法"),
        ({"approach": "字" * 2001}, "做法"),
    ]
    for changes, field in cases:
        response = create(client, boss, **changes)
        assert response.status_code == 422, changes
        assert field in response.json()["detail"], changes
    # 修改時一樣檢查
    mine = create(client, boss).json()
    edited = client.patch(f"/api/methods/{mine['id']}", json={"tags": ["newcomer", "vip"]}, headers=boss)
    assert edited.status_code == 422 and "標籤" in edited.json()["detail"]
    # 剛好在上限的收得下
    assert create(client, boss, title="字" * 40, situation="字" * 200, approach="字" * 2000).status_code == 201


def test_a_demoted_authors_card_stays_up_and_only_it_can_change_it(client, auth):
    it = auth("A01")
    mine = create(client, auth("M04")).json()
    path = f"/api/methods/{mine['id']}"
    # 蔡宗翰降成業務、改掛許文彬底下（主管降業務前底下要先清空）
    client.put("/api/admin/users/U05/manager", json={"manager_id": "M03"}, headers=it)
    assert client.put("/api/admin/users/M04/role", json={"role": "sales", "manager_id": "M03"}, headers=it).status_code == 200
    assert mine["id"] in {c["id"] for c in listing(client, auth("U01"))}
    # 他自己現在是業務，改不了；新主管也不是作者
    assert client.patch(path, json={"title": "測試：降調後改的"}, headers=auth("M04")).status_code == 403
    assert client.patch(path, json={"title": "測試：新主管改的"}, headers=auth("M03")).status_code == 403
    assert client.patch(path, json={"status": "retired"}, headers=it).status_code == 200


def test_a_deactivated_authors_card_stays_up_and_it_can_change_it(client, auth):
    it = auth("A01")
    author = auth("M04")
    mine = create(client, author).json()
    path = f"/api/methods/{mine['id']}"
    # 蔡宗翰停用（主管底下有在職的業務不能停用，先把李佳蓉換到許文彬底下）
    client.put("/api/admin/users/U05/manager", json={"manager_id": "M03"}, headers=it)
    assert client.post("/api/admin/users/M04/deactivate", json={}, headers=it).status_code == 200
    # 卡片照舊上架，名字也還在；灌資料時他寫的那兩張也一樣
    listed = {c["id"]: c for c in listing(client, auth("U05"))}
    assert listed[mine["id"]]["author_name"] == "蔡宗翰"
    assert {SMALL_LOT, "走出店門一分鐘內，把五件事講完"} <= {c["title"] for c in listed.values()}
    assert press(client, auth("U05"), mine["id"], True).json()["adopted"] == 1
    # 他自己登不進來了，之後只有 IT 改得了
    assert client.patch(path, json={"title": "測試：停用後改的"}, headers=author).status_code == 401
    assert client.patch(path, json={"title": "測試：別的主管改的"}, headers=auth("M03")).status_code == 403
    edited = client.patch(path, json={"title": "測試：IT 代改的"}, headers=it)
    assert (edited.status_code, edited.json()["title"], edited.json()["author_name"]) == (200, "測試：IT 代改的", "蔡宗翰")
    assert mine["id"] in {c["id"] for c in client.get("/api/methods/mine", headers=it).json()}


def test_the_service_hands_cards_to_other_features(tx):
    # 第二輪談判卡與新人頁會直接呼叫這兩個函式
    rep = tx.get(AppUser, "U01")
    newcomer = method_cards.list_published(tx, rep, tag="newcomer")
    assert [c["adopted"] for c in newcomer] == [43, 12, 7]
    one = tx.scalar(select(MethodCard).where(MethodCard.title == RIVAL))
    # 灌資料時林昱辰在自己的某一家連鎖客戶按過這張卡：帶那家客戶就看得到他當時按什麼
    helped, customer_id = tx.execute(
        select(MethodCardFeedback.helped, MethodCardFeedback.customer_id)
        .where(MethodCardFeedback.card_id == one.id, MethodCardFeedback.user_id == "U01")
        .limit(1)
    ).one()
    out = method_cards.card_out(tx, one, rep, customer_id=customer_id)
    assert (out["id"], out["author_name"], out["adopted"], out["not_helped"], out["my_feedback"]) == (one.id, "陳建宏", 46, 6, helped)
    assert method_cards.card_out(tx, one, rep)["my_feedback"] is None
