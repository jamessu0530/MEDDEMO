import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.models import AppUser, UserReportConfig
from app.services import auth, report_library as library, reports


def config(name="命名報表", **patch):
    return reports.ReportConfig.model_validate({"name": name, "template": "manager", "period": "this_month", "cards": [{"id": "sales", "title": "業績", "metric": "sales", "dimension": "owner", "visual": "bar"}], **patch})


def state(**patch):
    return library.BookmarkState.model_validate({"period": "this_month", "pages": [{"id": "overview"}], "cards": [{"id": "sales"}], **patch})


def client_for(session, user="M1"):
    return TestClient(app), {"Authorization": f"Bearer {auth.create_token(session.get(AppUser, user))}"}


def test_reading_legacy_does_not_rewrite_or_create_settings(interaction_session):
    user = interaction_session.get(AppUser, "M1")
    first = library.snapshot(interaction_session, user)
    assert first.active_report_id == library.DEFAULT_ID and len(first.documents) == 1
    assert interaction_session.get(UserReportConfig, user.id) is None
    reports.save_config(interaction_session, user, config())
    raw = interaction_session.get(UserReportConfig, user.id).config
    assert library.KEY not in raw
    assert library.snapshot(interaction_session, user).config.name == "命名報表"
    assert interaction_session.get(UserReportConfig, user.id).config == raw


def test_empty_canvas_can_be_saved_loaded_validated_copied_and_shared(interaction_session):
    client, headers = client_for(interaction_session)
    created = client.post("/api/reports/library", headers=headers, json={"config": config().model_dump(mode="json")}).json()
    report_id = created["active_report_id"]
    empty = config(cards=[], slicers=[{"dimension": "owner", "keys": ["S1"]}]).model_dump(mode="json")
    saved = client.put(f"/api/reports/library/{report_id}", headers=headers, json={"config": empty, "revision": 1})
    assert saved.status_code == 200 and saved.json()["config"] == empty
    loaded = client.get("/api/reports", headers=headers)
    assert loaded.status_code == 200 and loaded.json()["config"] == empty
    assert client.post("/api/reports/library/validate", headers=headers, json={"config": empty}).json() == empty
    data = client.post("/api/reports/data", headers=headers, json=empty)
    assert data.status_code == 200 and data.json()["cards"] == []
    copied = client.post("/api/reports/library", headers=headers, json={"config": empty, "source_id": report_id})
    assert copied.status_code == 200 and copied.json()["config"] == empty
    shared = client.post(f"/api/reports/library/{report_id}/share", headers=headers, json={"recipient_id": "S1", "revision": 2})
    assert shared.status_code == 200
    _, recipient = client_for(interaction_session, "S1")
    received = client.get("/api/reports", headers=recipient).json()
    # Sharing keeps the recipient's active report; open the delivered report explicitly.
    shared_id = next(item["id"] for item in received["documents"] if item["readonly"])
    opened = client.post("/api/reports/library/open", headers=recipient, json={"report_id": shared_id})
    assert opened.status_code == 200 and opened.json()["config"]["cards"] == []
    assert opened.json()["readonly"] is True
    foreign = empty | {"owner_id": "S3"}
    assert client.put(f"/api/reports/library/{report_id}", headers=headers, json={"config": foreign, "revision": 2}).status_code == 403


def test_create_open_copy_save_and_legacy_api_preserve_siblings_and_bookmarks(interaction_session):
    user = interaction_session.get(AppUser, "M1")
    original = config("原始")
    reports.save_config(interaction_session, user, original)
    marked = library.bookmark(interaction_session, user, library.DEFAULT_ID, "診所", state(slicers=[{"dimension": "customer_type", "keys": ["clinic"]}]))
    assert marked.revision == 1
    copy = library.create(interaction_session, user, config("副本"), library.DEFAULT_ID)
    copy_id = copy.active_report_id
    assert len(copy.documents) == 2 and copy_id != library.DEFAULT_ID
    assert copy.bookmarks[0].name == "診所" and copy.bookmarks[0].id != marked.bookmarks[0].id
    assert copy.bookmarks[0].state == marked.bookmarks[0].state
    changed = config("副本更名", period="six_months")
    saved = library.save(interaction_session, user, copy_id, changed, 1)
    assert saved.revision == 2 and saved.config.name == "副本更名"
    reports.save_config(interaction_session, user, config("舊客戶端儲存"))
    assert library.snapshot(interaction_session, user).revision == 3
    assert library.open_report(interaction_session, user, library.DEFAULT_ID).config == original
    assert reports.get_config(interaction_session, user) == original
    assert len(library.snapshot(interaction_session, user).documents) == 2


def test_save_conflict_does_not_overwrite_and_background_save_does_not_switch_active(interaction_session):
    user = interaction_session.get(AppUser, "M1")
    initial = library.create(interaction_session, user, config("第一份"))
    first_id = initial.active_report_id
    second = library.create(interaction_session, user, config("第二份"))
    saved = library.save(interaction_session, user, first_id, config("第一份修改"), 1)
    assert saved.active_report_id == first_id and saved.config.name == "第一份修改"
    assert library.snapshot(interaction_session, user).active_report_id == second.active_report_id
    with pytest.raises(library.LibraryError) as error:
        library.save(interaction_session, user, first_id, config("舊頁籤"), 1)
    assert error.value.status == 409
    assert library.open_report(interaction_session, user, first_id).config.name == "第一份修改"


def test_bookmarks_update_by_name_without_changing_config_or_report_revision(interaction_session):
    user = interaction_session.get(AppUser, "M1")
    reports.save_config(interaction_session, user, config())
    first = library.bookmark(interaction_session, user, library.DEFAULT_ID, "四月", state())
    updated = library.bookmark(interaction_session, user, library.DEFAULT_ID, "四月", state(period="last_month"))
    assert len(updated.bookmarks) == 1 and updated.bookmarks[0].id == first.bookmarks[0].id
    assert updated.bookmarks[0].state.period == "last_month"
    assert updated.config == config() and updated.revision == 1


@pytest.mark.parametrize("patch", [
    {"period": "custom"},
    {"selection_groups": []},
    {"drill_filters": {}},
    {"pages": [{"id": "overview"}, {"id": "overview"}]},
    {"cards": [{"id": "sales", "visual": "arbitrary"}]},
    {"slicers": [{"dimension": "owner", "keys": ["S1", "S1"]}]},
])
def test_bookmark_rejects_query_state_invalid_dates_and_duplicate_ids(patch):
    with pytest.raises(ValidationError):
        state(**patch)


def test_library_and_bookmark_limits_and_same_name_update_at_limit(interaction_session):
    user = interaction_session.get(AppUser, "M1")
    for index in range(19):
        library.create(interaction_session, user, config(str(index)))
    assert len(library.snapshot(interaction_session, user).documents) == 20
    with pytest.raises(library.LibraryError):
        library.create(interaction_session, user, config("超過上限"))
    for index in range(20):
        library.bookmark(interaction_session, user, library.DEFAULT_ID, str(index), state())
    assert len(library.bookmark(interaction_session, user, library.DEFAULT_ID, "0", state(period="last_month")).bookmarks) == 20
    with pytest.raises(library.LibraryError):
        library.bookmark(interaction_session, user, library.DEFAULT_ID, "超過上限", state())


def test_api_ownership_scope_validation_draft_validation_and_conflict(interaction_session):
    client, headers = client_for(interaction_session)
    created = client.post("/api/reports/library", headers=headers, json={"config": config().model_dump(mode="json")})
    assert created.status_code == 200
    body = created.json()
    assert body["account_id"] == "M1"
    report_id = body["active_report_id"]
    saved = client.put(f"/api/reports/library/{report_id}", headers=headers, json={"config": config("改名").model_dump(mode="json"), "revision": 1})
    assert saved.status_code == 200 and saved.json()["revision"] == 2
    assert client.put(f"/api/reports/library/{report_id}", headers=headers, json={"config": config("過期").model_dump(mode="json"), "revision": 1}).status_code == 409
    _, sales = client_for(interaction_session, "S1")
    assert client.post("/api/reports/library/open", headers=sales, json={"report_id": report_id}).status_code == 404
    assert client.put(f"/api/reports/library/{report_id}", headers=sales, json={"config": config().model_dump(mode="json"), "revision": 2}).status_code == 404
    assert client.post("/api/reports/library", headers=sales, json={"config": config(owner_id="S3").model_dump(mode="json")}).status_code == 403
    bad_bookmark = {"name": "越權", "state": state(slicers=[{"dimension": "owner", "keys": ["S3"]}]).model_dump(mode="json")}
    assert client.post(f"/api/reports/library/{report_id}/bookmarks", headers=headers, json=bad_bookmark).status_code == 403
    invalid = config().model_dump(mode="json")
    invalid["cards"][0]["format"] = {"metric_colors": {"sales": "url(secret)"}}
    assert client.post("/api/reports/library/validate", headers=headers, json={"config": invalid}).status_code == 422
    old_scope = config(owner_id="S3", slicers=[{"dimension": "owner", "keys": ["S1", "S3"]}]).model_dump(mode="json")
    validated = client.post("/api/reports/library/validate", headers=headers, json={"config": old_scope})
    assert validated.status_code == 200 and validated.json()["owner_id"] is None
    assert validated.json()["slicers"][0]["keys"] == ["S1"]
    current = client.get("/api/reports", headers=headers).json()
    assert current["config"]["name"] == "改名" and current["active_report_id"] == report_id
