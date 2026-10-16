"""經理的頻道原文可以引用成方法卡；公開卡片不會公開私人來源。"""

import datetime as dt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.main import app
from app.models import AppUser, Attachment, Channel, ChannelMessage, Customer, MethodCard, MethodCardSource, Place
from app.services import channels, method_cards

CARD = {
    "title": "來源測試：先問下次日期", "situation": "客戶說再考慮。",
    "approach": "整理後的做法：詢問下次方便討論的日期。", "tags": ["newcomer"],
}


@pytest.fixture
def client(tx):
    return TestClient(app)


def channel(tx, kind="national", manager="M01"):
    user = tx.get(AppUser, manager)
    stmt = select(Channel).where(Channel.kind == kind)
    if kind == "region":
        stmt = stmt.where(Channel.unit_id == user.unit_id)
    elif kind == "team":
        stmt = stmt.where(Channel.manager_id == user.id)
    elif kind == "place":
        stmt = stmt.join(Place, Channel.place_id == Place.id).where(Place.unit_id == user.unit_id)
    elif kind == "customer":
        customer = tx.scalar(select(Customer).where(Customer.owner_user_id == "U01"))
        return channels.customer_thread(tx, user, customer.id).id
    elif kind == "topic":
        row = Channel(kind="topic", unit_id=user.unit_id, name="來源測試頻道", created_by=user.id)
        tx.add(row)
        tx.flush()
        return row.id
    return tx.scalar(stmt.order_by(Channel.id).limit(1)).id


def message(tx, channel_id, body="原始經理建議：問下週哪一天方便。", author="M01", kind="user", deleted=False):
    row = ChannelMessage(
        channel_id=channel_id, author_id=author if kind == "user" else None, kind=kind, body=body,
        created_at=dt.datetime(2026, 10, 10, 8, 30, tzinfo=dt.UTC),
        deleted_at=dt.datetime.now(dt.UTC) if deleted else None,
    )
    tx.add(row)
    tx.flush()
    return row


def candidates(client, headers, **params):
    response = client.get("/api/methods/sources", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def create(client, headers, source_id=None, **extra):
    return client.post("/api/methods", json=CARD | {"source_message_id": source_id} | extra, headers=headers)


def public_card(client, headers, card_id):
    return next(card for card in client.get("/api/methods", headers=headers).json() if card["id"] == card_id)


def assert_redacted(source):
    assert source["can_view"] is False
    assert all(source[key] is None for key in ("message_id", "channel_id", "channel_name", "body"))
    timestamp = source["created_at"]
    if isinstance(timestamp, dt.datetime):
        timestamp = timestamp.isoformat()
    assert source["author_name"] == "陳建宏" and timestamp.startswith("2026-10-10T08:30")


@pytest.mark.parametrize("kind", ["national", "region", "team", "place", "customer", "topic"])
def test_any_visible_channel_kind_can_be_searched_selected_and_attached(tx, client, auth, kind):
    channel_id = channel(tx, kind)
    source = message(tx, channel_id)
    expected = {
        "message_id": source.id, "channel_id": channel_id,
        "channel_name": channels.get_channel(tx, tx.get(AppUser, "M01"), channel_id).name,
        "author_name": "陳建宏", "body": source.body, "created_at": "2026-10-10T08:30:00Z",
    }
    assert candidates(client, auth("M01"), q="原始經理建議", channel_id=channel_id) == {"items": [expected], "next_before": None}
    assert client.get(f"/api/methods/sources/{source.id}", headers=auth("M01")).json() == expected
    card = create(client, auth("M01"), source.id)
    assert card.status_code == 201
    assert card.json()["source"] == expected | {"can_view": True}
    # 任何頻道，不只側欄頻道；客戶來源也要在不帶 channel_id 的搜尋裡。
    assert source.id in {item["message_id"] for item in candidates(client, auth("M01"), q="原始經理建議")["items"]}


@pytest.mark.parametrize("author,kind,body,deleted", [
    ("U01", "user", "業務說的", False), ("A01", "user", "IT 說的", False),
    (None, "ai", "AI 整理建議", False), (None, "notice", "風險通知", False),
    ("M01", "user", "", False), ("M01", "user", " \n\t\r ", False),
    ("M01", "user", "經理原文已刪除", True),
])
def test_only_undeleted_nonempty_human_manager_text_is_eligible(tx, client, auth, author, kind, body, deleted):
    source = message(tx, channel(tx), body=body, author=author, kind=kind, deleted=deleted)
    assert source.id not in {item["message_id"] for item in candidates(client, auth("A01"))["items"]}
    assert client.get(f"/api/methods/sources/{source.id}", headers=auth("A01")).status_code == 404
    assert create(client, auth("A01"), source.id).status_code == 404


def test_manager_and_it_can_search_but_reps_and_guests_cannot(tx, client, auth):
    source = message(tx, channel(tx))
    for path in ("/api/methods/sources", f"/api/methods/sources/{source.id}"):
        assert client.get(path).status_code == 401
        assert client.get(path, headers=auth("U01")).status_code == 403
        assert client.get(path, headers=auth("M01")).status_code == 200
        assert client.get(path, headers=auth("A01")).status_code == 200
    with pytest.raises(method_cards.Forbidden):
        method_cards.list_sources(tx, tx.get(AppUser, "U01"))


def test_an_attachment_caption_does_not_make_an_attachment_only_message_eligible(tx, client, auth):
    source = message(tx, channel(tx), body="")
    tx.add(Attachment(
        message_id=source.id, uploader_id="M01", kind="image", filename="建議.png", mime_type="image/png",
        content=b"x", size_bytes=1, search_tokens="", caption="這張圖有經理的建議",
    ))
    tx.flush()
    assert client.get(f"/api/methods/sources/{source.id}", headers=auth("M01")).status_code == 404
    assert create(client, auth("M01"), source.id).status_code == 404


@pytest.mark.parametrize("kind", ["region", "team", "place", "topic"])
def test_invisible_channels_and_sources_are_hidden_on_every_selection_path(tx, client, auth, kind):
    channel_id = channel(tx, kind)
    source = message(tx, channel_id, body="區域私人資料")
    other = auth("M02")
    assert candidates(client, other, q="區域私人資料")["items"] == []
    assert client.get("/api/methods/sources", params={"channel_id": channel_id}, headers=other).status_code == 404
    assert client.get(f"/api/methods/sources/{source.id}", headers=other).status_code == 404
    assert create(client, other, source.id).status_code == 404
    assert create(client, auth("A01"), source.id).status_code == 201


def test_cross_region_customer_owner_and_their_manager_keep_access(tx, client, auth):
    channel_id = channel(tx, "customer")
    source = message(tx, channel_id)
    customer = tx.get(Customer, tx.get(Channel, channel_id).customer_id)
    customer.owner_user_id = "U04"
    tx.flush()
    assert candidates(client, auth("M03"), channel_id=channel_id)["items"][0]["message_id"] == source.id
    assert client.get(f"/api/methods/sources/{source.id}", headers=auth("M03")).status_code == 200
    assert client.get(f"/api/methods/sources/{source.id}", headers=auth("M02")).status_code == 200
    made = create(client, auth("M03"), source.id).json()
    assert public_card(client, auth("U04"), made["id"])["source"]["can_view"] is True
    assert public_card(client, auth("U03"), made["id"])["source"]["can_view"] is True


def test_archived_topic_stays_visible_but_archived_team_is_it_only(tx, client, auth):
    topic = channel(tx, "topic")
    source = message(tx, topic)
    tx.get(Channel, topic).archived_at = dt.datetime.now(dt.UTC)
    team = channel(tx, "team", "M04")
    team_source = message(tx, team, author="M03")
    tx.get(AppUser, "M04").deactivated_at = dt.datetime.now(dt.UTC)
    tx.flush()
    assert client.get(f"/api/methods/sources/{source.id}", headers=auth("M01")).status_code == 200
    assert client.get(f"/api/methods/sources/{team_source.id}", headers=auth("M03")).status_code == 404
    assert client.get(f"/api/methods/sources/{team_source.id}", headers=auth("A01")).status_code == 200


def test_keyword_search_is_literal_and_pagination_never_repeats_or_skips(tx, client, auth):
    channel_id = channel(tx)
    literals = ["特殊關鍵字 A_B 3%", "特殊關鍵字 AxB 30x", "特殊關鍵字 share\\sales 10/送"]
    rows = [message(tx, channel_id, body=body) for body in literals]
    for query, row in (("A_B", rows[0]), ("3%", rows[0]), ("share\\sales", rows[2]), ("\\", rows[2]), ("10/送", rows[2])):
        assert [item["message_id"] for item in candidates(client, auth("M01"), q=query)["items"]] == [row.id]
    assert candidates(client, auth("M01"), q="share_sales")["items"] == []
    bulk = [message(tx, channel_id, body=f"來源分頁測試 {i}") for i in range(55)]
    first = candidates(client, auth("M01"), q="來源分頁測試", limit=50)
    assert len(first["items"]) == 50
    assert first["next_before"] == first["items"][-1]["message_id"]
    second = candidates(client, auth("M01"), q="來源分頁測試", limit=50, before=first["next_before"])
    assert second["next_before"] is None
    assert [item["message_id"] for item in first["items"] + second["items"]] == [row.id for row in reversed(bulk)]
    assert client.get("/api/methods/sources", params={"limit": 51}, headers=auth("M01")).status_code == 422


def test_source_snapshots_are_separate_from_the_card_author_and_client_cannot_forge_them(tx, client, auth):
    source = message(tx, channel(tx), author="M02")
    made = create(client, auth("M01"), source.id)
    assert made.status_code == 201
    card = made.json()
    assert card["author_name"] == "陳建宏" and card["source"]["author_name"] == "張淑芬"
    assert card["approach"] == CARD["approach"] and card["source"]["body"] == source.body
    stored = tx.get(MethodCardSource, card["id"])
    assert stored.body == source.body and stored.message_id == source.id
    for spoof in ({"source": {"body": "假的"}}, {"source_body": "假的"}, {"author_name": "假的"}):
        assert create(client, auth("M01"), source.id, **spoof).status_code == 422
    for invalid in (True, "1", 0, -1):
        assert create(client, auth("M01"), invalid).status_code == 422
    assert create(client, auth("M01"), 999999999).status_code == 404
    # 保存的姓名與原文不會跟著外部資料意外變動。
    tx.get(AppUser, "M02").name = "改名"
    source.body = "資料後來被改過"
    tx.flush()
    shown = public_card(client, auth("U01"), card["id"])["source"]
    assert shown["author_name"] == "張淑芬" and shown["body"] == stored.body


def test_attach_replace_omit_and_explicitly_remove_source(tx, client, auth):
    channel_id = channel(tx)
    first, second = message(tx, channel_id), message(tx, channel_id, body="另一個經理建議")
    made = client.post("/api/methods", json=CARD, headers=auth("M01")).json()
    assert made["source"] is None
    path = f"/api/methods/{made['id']}"
    assert client.patch(path, json={"source": {"body": "偽造的來源"}}, headers=auth("M01")).status_code == 422
    attached = client.patch(path, json={"source_message_id": first.id}, headers=auth("M01")).json()
    assert attached["source"]["message_id"] == first.id and attached["updated_at"] > made["updated_at"]
    same = client.patch(path, json={"source_message_id": first.id}, headers=auth("M01")).json()
    assert same["updated_at"] == attached["updated_at"]
    edited = client.patch(path, json={"situation": "只改情況"}, headers=auth("M01")).json()
    assert edited["source"] == attached["source"]
    changed = client.patch(path, json={"source_message_id": second.id}, headers=auth("M01")).json()
    assert changed["source"]["body"] == second.body and changed["updated_at"] > edited["updated_at"]
    assert client.patch(path, json={"source_message_id": first.id}, headers=auth("M02")).status_code == 403
    invalid = message(tx, channel(tx, "team", "M02"), author="M02")
    rejected = client.patch(path, json={"source_message_id": invalid.id, "title": "不能部分儲存"}, headers=auth("M01"))
    assert rejected.status_code == 404
    retained = public_card(client, auth("U01"), made["id"])
    assert retained["source"] == changed["source"] and retained["title"] == CARD["title"]
    removed = client.patch(path, json={"source_message_id": None}, headers=auth("M01")).json()
    assert removed["source"] is None and removed["updated_at"] > changed["updated_at"]
    assert client.patch(path, json={"source_message_id": None}, headers=auth("M01")).json()["updated_at"] == removed["updated_at"]
    tx.expire_all()
    assert tx.get(MethodCardSource, made["id"]) is None


def test_role_is_checked_when_attaching_but_existing_attribution_is_preserved(tx, client, auth):
    source = message(tx, channel(tx), author="M04")
    made = create(client, auth("M01"), source.id).json()
    former_manager = tx.get(AppUser, "M04")
    former_manager.role, former_manager.manager_id, former_manager.unit_id = "sales", "M03", None
    former_manager.org_path = "TW.S.M03.M04"
    tx.flush()
    assert client.get(f"/api/methods/sources/{source.id}", headers=auth("M01")).status_code == 404
    assert create(client, auth("M01"), source.id).status_code == 404
    assert client.patch(f"/api/methods/{made['id']}", json={"source_message_id": source.id}, headers=auth("M01")).status_code == 404
    assert public_card(client, auth("U01"), made["id"])["source"] == made["source"]


def test_public_card_source_is_redacted_on_all_shared_read_paths(tx, client, auth):
    source = message(tx, channel(tx, "team"))
    made = create(client, auth("M01"), source.id).json()
    for user_id in ("U03", "M02", "U04"):
        card = public_card(client, auth(user_id), made["id"])
        assert card["approach"] == CARD["approach"]
        assert_redacted(card["source"])
        feedback = client.post(f"/api/methods/{made['id']}/feedback", json={"helped": True}, headers=auth(user_id)).json()
        assert_redacted(feedback["source"])
    related = method_cards.related(tx, tx.get(AppUser, "U03"), tags={"newcomer"}, customer_type=None, customer_id=None, limit=50)
    assert_redacted(next(card for card in related if card["id"] == made["id"])["source"])
    assert public_card(client, auth("U01"), made["id"])["source"]["can_view"] is True
    assert next(card for card in client.get("/api/methods/mine", headers=auth("M01")).json() if card["id"] == made["id"])["source"]["can_view"] is True
    # 可見性依讀取當下，不依整理卡片時的權限。
    tx.get(AppUser, "M01").unit_id = "TW.C"
    tx.get(AppUser, "M01").org_path = "TW.C.M01"
    tx.flush()
    assert_redacted(public_card(client, auth("U01"), made["id"])["source"])
    assert next(card for card in client.get("/api/methods/mine", headers=auth("A01")).json() if card["id"] == made["id"])["source"]["can_view"] is True


@pytest.mark.parametrize("hard_delete", [False, True])
def test_deleting_original_removes_source_access_but_keeps_organized_card(tx, client, auth, hard_delete):
    source = message(tx, channel(tx))
    source_id = source.id
    made = create(client, auth("M01"), source_id).json()
    if hard_delete:
        tx.execute(delete(ChannelMessage).where(ChannelMessage.id == source_id))
    else:
        channels.delete_message(tx, tx.get(AppUser, "A01"), source_id)
    tx.flush()
    for user_id in ("M01", "A01", "U01"):
        card = public_card(client, auth(user_id), made["id"])
        assert card["approach"] == CARD["approach"]
        assert_redacted(card["source"])
    assert client.get(f"/api/methods/sources/{source_id}", headers=auth("A01")).status_code == 404
    path = f"/api/methods/{made['id']}"
    assert client.patch(path, json={"source_message_id": source_id}, headers=auth("M01")).status_code == 404
    # 沒重新選取來源時，原有卡片仍可整理；FK 保留快照但解除已不存在的訊息。
    assert client.patch(path, json={"situation": "後來補充"}, headers=auth("M01")).status_code == 200
    tx.expire_all()
    snapshot = tx.get(MethodCardSource, made["id"])
    assert snapshot.body == "原始經理建議：問下週哪一天方便。"
    assert (snapshot.message_id is None) is hard_delete
    tx.execute(delete(MethodCard).where(MethodCard.id == made["id"]))
    tx.flush()
    tx.expire_all()
    assert tx.get(MethodCardSource, made["id"]) is None


def test_channel_message_author_role_is_current_human_role_only(tx, client, auth):
    channel_id = channel(tx)
    rows = [message(tx, channel_id, author=author, kind=kind) for author, kind in (
        ("M01", "user"), ("U01", "user"), ("A01", "user"), (None, "ai"), (None, "notice"),
    )]
    response = client.get(f"/api/channels/{channel_id}/messages", headers=auth("M01"))
    assert response.status_code == 200
    by_id = {item["id"]: item for item in response.json()}
    assert [by_id[row.id]["author_role"] for row in rows] == ["manager", "sales", "it", None, None]
    posted = client.post(f"/api/channels/{channel_id}/messages", json={"body": "新發言的 role 也要提供"}, headers=auth("M01"))
    assert posted.status_code == 201 and posted.json()["author_role"] == "manager"
