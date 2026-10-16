import copy
import datetime as dt

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.models import AppUser, UserReportConfig
from app.services import auth, report_library as library, reports


def config(**patch):
    return reports.ReportConfig.model_validate({"name": "共享報表", "template": "manager", "period": "this_month", "cards": [{"id": "sales", "title": "業績", "metric": "sales", "dimension": "owner", "visual": "bar"}], **patch})


def headers(session, key):
    return {"Authorization": f"Bearer {auth.create_token(session.get(AppUser, key))}"}


def test_load_timestamp_is_actual_utc_and_distinct_from_business_date(interaction_session):
    before = dt.datetime.now(dt.timezone.utc)
    result = reports.data(interaction_session, interaction_session.get(AppUser, "M1"), config(refresh_seconds=60))
    assert before <= result.loaded_at <= dt.datetime.now(dt.timezone.utc)
    assert result.as_of.isoformat() == "2031-04-17"
    assert result.cards[0].total == 2250


@pytest.mark.parametrize("seconds", [0, 60, 300, 900])
def test_refresh_interval_round_trip(interaction_session, seconds):
    user = interaction_session.get(AppUser, "M1")
    reports.save_config(interaction_session, user, config(refresh_seconds=seconds))
    assert reports.get_config(interaction_session, user).refresh_seconds == seconds


@pytest.mark.parametrize("seconds", [-1, 1, 30, 3600, "60"])
def test_refresh_interval_rejects_arbitrary_values(seconds):
    with pytest.raises(ValidationError): config(refresh_seconds=seconds)


def test_share_snapshots_settings_without_results_and_receiver_uses_own_scope(interaction_session):
    s = interaction_session; sender = s.get(AppUser, "M1"); recipient = s.get(AppUser, "S1")
    source = library.create(s, sender, config(refresh_seconds=60))
    old_source = copy.deepcopy(s.get(UserReportConfig, sender.id).config)
    result = library.share(s, sender, source.active_report_id, "S1", source.revision)
    receiver = library.snapshot(s, recipient)
    assert receiver.active_report_id == library.DEFAULT_ID  # 不強迫接收者切走原報表
    opened = library.open_report(s, recipient, result["shared_report_id"])
    assert opened.readonly and opened.shared_from.name == "M1"
    assert opened.shared_from.revision == source.revision
    assert not opened.bookmarks and opened.config.refresh_seconds == 60
    assert reports.data(s, recipient, opened.config).cards[0].total == 2250
    assert reports.data(s, sender, source.config).cards[0].total == 2250
    assert s.get(UserReportConfig, sender.id).config == old_source
    raw = s.get(UserReportConfig, recipient.id).config
    assert "loaded_at" not in str(raw) and "selection_groups" not in str(raw)
    assert set(result) == {"recipient_name", "report_name", "shared_report_id", "updated"}


def test_receiver_repairs_inaccessible_owner_filters_and_remains_scoped(interaction_session):
    s = interaction_session; sender = s.get(AppUser, "M1"); recipient = s.get(AppUser, "S1")
    source = library.create(s, sender, config(owner_id="S2", slicers=[{"dimension": "owner", "keys": ["S2"]}]))
    shared = library.share(s, sender, source.active_report_id, "S1", source.revision)
    received = library.open_report(s, recipient, shared["shared_report_id"])
    assert received.config.owner_id == "S2" and received.config.slicers[0].keys == ["S2"]
    assert reports.data(s, recipient, received.config).cards[0].total == 700
    assert library.snapshot(s, sender).config.owner_id == "S2"


def test_readonly_all_mutations_denied_but_copy_is_personally_editable(interaction_session):
    s = interaction_session; sender = s.get(AppUser, "M1"); recipient = s.get(AppUser, "S1")
    source = library.create(s, sender, config())
    received = library.share(s, sender, source.active_report_id, "S1", source.revision)
    opened = library.open_report(s, recipient, received["shared_report_id"])
    before = copy.deepcopy(s.get(UserReportConfig, recipient.id).config)
    client = TestClient(app); h = headers(s, "S1"); report_id = opened.active_report_id
    payload = opened.config.model_dump(mode="json")
    for method, path, body in [
        ("put", "/api/reports/config", payload),
        ("put", f"/api/reports/library/{report_id}", {"config": payload, "revision": opened.revision}),
        ("post", f"/api/reports/library/{report_id}/bookmarks", {"name": "不允許", "state": {"period": "this_month"}}),
        ("post", f"/api/reports/library/{report_id}/share", {"recipient_id": "S2", "revision": opened.revision}),
    ]:
        assert getattr(client, method)(path, json=body, headers=h).status_code == 403
    s.expire_all(); assert s.get(UserReportConfig, recipient.id).config == before
    clone = library.create(s, recipient, opened.config.model_copy(update={"name": "我的副本"}), report_id)
    assert not clone.readonly and clone.shared_from is None
    assert library.save(s, recipient, clone.active_report_id, config(name="可編輯", template="sales"), clone.revision).config.name == "可編輯"
    assert library.snapshot(s, sender).config == source.config


def test_repeat_share_updates_same_readonly_copy_and_requires_current_source_version(interaction_session):
    s = interaction_session; sender = s.get(AppUser, "M1"); recipient = s.get(AppUser, "S1")
    original = library.create(s, sender, config())
    first = library.share(s, sender, original.active_report_id, "S1", 1)
    saved = library.save(s, sender, original.active_report_id, config(name="新版", period="six_months"), 1)
    assert library.snapshot(s, recipient, report_id=first["shared_report_id"]).config.name == "共享報表"
    with pytest.raises(library.LibraryError) as error: library.share(s, sender, saved.active_report_id, "S1", 1)
    assert error.value.status == 409
    second = library.share(s, sender, saved.active_report_id, "S1", 2)
    assert second["updated"] and second["shared_report_id"] == first["shared_report_id"]
    received = library.snapshot(s, recipient, report_id=first["shared_report_id"])
    assert len(received.documents) == 2 and received.config.name == "新版" and received.revision == 2


@pytest.mark.parametrize("recipient", ["M1", "S3", "M2", "missing", "S1' OR TRUE --"])
def test_invalid_cross_team_recipients_cannot_write_any_settings(interaction_session, recipient):
    s = interaction_session; sender = s.get(AppUser, "M1")
    source = library.create(s, sender, config())
    with pytest.raises(library.LibraryError) as error: library.share(s, sender, source.active_report_id, recipient, 1)
    assert error.value.status == 403
    assert s.get(UserReportConfig, "S3") is None


def test_recipient_list_and_share_api_are_account_scoped(interaction_session):
    s = interaction_session; client = TestClient(app)
    assert {item["id"] for item in client.get('/api/reports/share-recipients', headers=headers(s,"M1")).json()} == {"S1", "S2"}
    assert {item["id"] for item in client.get('/api/reports/share-recipients', headers=headers(s,"S1")).json()} == {"M1", "S2"}
    result = client.post('/api/reports/library/report-default/share', json={"recipient_id":"S1", "revision":1}, headers=headers(s,"M1"))
    assert result.status_code == 200
    key = result.json()["shared_report_id"]
    assert client.post('/api/reports/library/open',json={"report_id":key}, headers=headers(s,"S2")).status_code == 404
    assert client.post('/api/reports/library/not-owned/share',json={"recipient_id":"S2","revision":1}, headers=headers(s,"S1")).status_code == 404


def test_shared_export_keeps_recipient_scope(interaction_session):
    s=interaction_session; source=library.create(s,s.get(AppUser,"M1"),config())
    result=library.share(s,s.get(AppUser,"M1"),source.active_report_id,"S1",1)
    received=library.open_report(s,s.get(AppUser,"S1"),result["shared_report_id"])
    response=TestClient(app).post('/api/reports/export',json={"config":received.config.model_dump(mode="json"),"format":"csv","data":"details"},headers=headers(s,"S1"))
    assert response.status_code==200 and "C1" in response.text and "C2" in response.text and "C3" in response.text


def test_shared_library_limit_fails_without_overwriting_recipient(interaction_session):
    s=interaction_session; recipient=s.get(AppUser,"S1"); sender=s.get(AppUser,"M1")
    for number in range(19):library.create(s,recipient,config(name=str(number)))
    source=library.create(s,sender,config())
    before=copy.deepcopy(s.get(UserReportConfig,"S1").config)
    with pytest.raises(library.LibraryError):library.share(s,sender,source.active_report_id,"S1",1)
    assert s.get(UserReportConfig,"S1").config==before


def test_demo_proxy_cannot_share_using_another_accounts_organization(interaction_session):
    s=interaction_session
    proxy=AppUser(id="PROXY",name="代理帳號",role="sales",region="北區",acts_as_user_id="M1")
    s.add(proxy);s.flush()
    assert library.recipients(s,proxy)==[]
    with pytest.raises(library.LibraryError) as error:library.share(s,proxy,library.DEFAULT_ID,"S1",1)
    assert error.value.status==403 and s.get(UserReportConfig,"S1") is None


def test_shared_settings_do_not_keep_access_after_recipient_changes_team(interaction_session):
    s=interaction_session;sender=s.get(AppUser,"M1");recipient=s.get(AppUser,"S1")
    source=library.create(s,sender,config(owner_id="S2"))
    result=library.share(s,sender,source.active_report_id,"S1",1)
    recipient.manager_id="M2";recipient.org_path="TW.N.M2.S1";s.flush()
    received=library.snapshot(s,recipient,report_id=result["shared_report_id"])
    assert received.config.owner_id == "S2"
    assert reports.data(s,recipient,received.config).cards[0].total==700
    assert "S1" not in {item.id for item in library.recipients(s,sender)}
