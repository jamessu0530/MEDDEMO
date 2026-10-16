import datetime as dt
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.models import AppUser
from app.services import auth, reports, report_library as library
from app.services.report_analytics import analysis


def query(**patch):
    return reports.ReportQuery.model_validate({"name": "工作區驗收", "template": "manager", "period": "this_month", "pages": [{"id": "overview", "name": "總覽"}, {"id": "customer-page", "name": "客戶分析", "tooltip": True}], "cards": [
        {"id": "source", "title": "來源", "metric": "sales", "dimension": "customer", "visual": "bar", "drillthrough_page": "customer-page", "tooltip_page": "customer-page"},
        {"id": "target", "title": "接收", "metric": "sales", "dimension": "customer", "visual": "column", "page_id": "customer-page"},
        {"id": "unaffected", "title": "保留", "metric": "sales", "dimension": "customer", "visual": "table", "page_id": "customer-page"}],
        "objects": [{"id": "customer-slicer", "kind": "slicer", "slicer": {"dimension": "customer", "pages": ["customer-page"], "cards": ["target"]}}, {"id": "headline", "kind": "text", "text": "<script>alert(1)</script>", "locked": True, "hidden": True}], **patch})


def result(session, report, user="M1"):
    return {card.id: card for card in reports.data(session, session.get(AppUser, user), report).cards}


def test_canvas_selection_affects_only_target_page_and_cards(interaction_session):
    values = result(interaction_session, query(canvas_selections=[{"object_id": "customer-slicer", "keys": ["C1"]}]))
    assert values["source"].total == values["unaffected"].total == 1350
    assert values["target"].total == 400


def test_cross_page_conditions_intersect_fixed_and_canvas_conditions(interaction_session):
    report = query(navigation_page="customer-page", navigation_filters=[{"dimension": "customer", "key": "C2"}])
    values = result(interaction_session, report)
    assert values["source"].total == 1350 and values["target"].total == values["unaffected"].total == 700
    report.canvas_selections = [reports.CanvasSlicerSelection(object_id="customer-slicer", keys=["C1"])]
    values = result(interaction_session, report)
    assert values["target"].total == 0 and values["unaffected"].total == 700


def test_cross_page_conditions_cannot_expand_account_scope(interaction_session):
    assert result(interaction_session, query(navigation_page="customer-page", navigation_filters=[{"dimension": "customer", "key": "C3"}]))["target"].total == 0
    with pytest.raises(reports.OwnerNotAllowed):
        result(interaction_session, query(navigation_page="customer-page", navigation_filters=[{"dimension": "owner", "key": "S3"}]))
    report = query(objects=[{"id": "owners", "kind": "slicer", "slicer": {"dimension": "owner"}}], canvas_selections=[{"object_id": "owners", "keys": ["S3"]}])
    with pytest.raises(reports.OwnerNotAllowed):
        result(interaction_session, report)


@pytest.mark.parametrize("patch", [
    {"objects": [{"id": "source", "kind": "text"}]},
    {"objects": [{"id": "bad", "kind": "image", "image": "https://example.org/image.png"}]},
    {"objects": [{"id": "bad", "kind": "image", "image": "data:image/svg+xml;base64,PHN2Zy8+"}]},
    {"objects": [{"id": "bad", "kind": "image", "image": "data:image/png;base64,invalid"}]},
    {"objects": [{"id": "bad", "kind": "button"}]},
    {"objects": [{"id": "bad", "kind": "text", "page_id": "missing"}]},
    {"objects": [{"id": "bad", "kind": "button", "action": {"kind": "page", "target": "missing"}}]},
    {"canvas_selections": [{"object_id": "headline", "keys": ["C1"]}]},
    {"canvas_selections": [{"object_id": "customer-slicer", "keys": ["C1", "C1"]}]},
    {"navigation_page": "missing"},
    {"navigation_filters": [{"dimension": "customer", "key": "C1"}]},
    {"objects": [{"id": "a", "kind": "slicer", "slicer": {"dimension": "customer", "sync_group": "same"}}, {"id": "b", "kind": "slicer", "slicer": {"dimension": "product", "sync_group": "same"}}]},
])
def test_reject_invalid_object_and_interaction_references(patch):
    with pytest.raises(ValidationError):
        query(**patch)


def test_design_and_exploration_bookmarks_roundtrip(interaction_session):
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {auth.create_token(interaction_session.get(AppUser, 'M1'))}"}
    config = reports.ReportConfig.model_validate(query().model_dump(include=set(reports.ReportConfig.model_fields)))
    created = client.post("/api/reports/library", headers=headers, json={"config": config.model_dump(mode="json")})
    assert created.status_code == 200
    id = created.json()["active_report_id"]
    state = library.BookmarkState(period="this_month", exploration=library.Exploration(canvas_values={"customer-slicer": ["C1"]}, hidden={"headline": False}, navigation_page="customer-page", navigation_filters=[reports.ReportFilter(dimension="customer", key="C1")], selections=[reports.ReportSelectionGroup(source_id="source", points=[reports.ReportSelectionPoint(label="C1", filters=[reports.ReportFilter(dimension="customer", key="C1")])])]))
    marked = library.bookmark(interaction_session, interaction_session.get(AppUser, "M1"), id, "客戶視圖", state)
    assert marked.bookmarks[0].state.exploration == state.exploration
    assert marked.config.objects[1].text.startswith("<script>")  # Stored plain text; React escapes it.
    assert marked.config.cards[0].tooltip_page == "customer-page"
    state.exploration.navigation_filters = [reports.ReportFilter(dimension="owner", key="S3")]
    with pytest.raises(reports.OwnerNotAllowed):
        library.bookmark(interaction_session, interaction_session.get(AppUser, "M1"), id, "越權", state)


def test_map_coordinates_only_include_scoped_customer_points(interaction_session):
    report = query()
    report.cards[0].visual = "map"
    values = result(interaction_session, report)["source"]
    assert {point.key for point in values.points} == {"C1", "C2", "C4"}
    assert all(point.lat is not None and point.lng is not None for point in values.points)
    assert "模擬位置" in values.note


def test_funnel_uses_explicit_stage_order(interaction_session):
    report = query()
    report.cards[0] = reports.ReportCard.model_validate(report.cards[0].model_dump() | {"visual": "funnel", "stage_order": ["C4", "C1"]})
    values = result(interaction_session, report)["source"]
    assert [point.key for point in values.points] == ["C4", "C1"]
    assert values.total == 1350  # Complete range total remains explicit.


@pytest.mark.parametrize("visual", ["waterfall", "funnel"])
def test_nonadditive_metrics_reject_stage_charts(visual):
    with pytest.raises(ValidationError):
        reports.ReportCard(id="bad", title="bad", metric="avg_order_value", dimension="customer", visual=visual)


def test_linear_forecast_excludes_incomplete_and_future_buckets():
    points = [SimpleNamespace(key=f"2030-{i:02d}", label=str(i), value=i * 10) for i in range(1, 9)]
    value = analysis(points, "month", dt.date(2030, 1, 1), dt.date(2030, 8, 31), dt.date(2030, 7, 15), 3)
    assert len(value["trend"]) == 6
    assert [point["key"] for point in value["forecast"]] == ["2030-07", "2030-08", "2030-09"]
    assert [point["value"] for point in value["forecast"]] == pytest.approx([70, 80, 90])
    points[3].value = None
    assert analysis(points, "month", dt.date(2030, 1, 1), dt.date(2030, 8, 31), dt.date(2030, 7, 15), 3)["forecast"] == []


def test_short_history_never_fabricates_predictions():
    points = [SimpleNamespace(key=f"2030-{i:02d}", label=str(i), value=i) for i in range(1, 6)]
    assert analysis(points, "month", dt.date(2030, 1, 1), dt.date(2030, 5, 31), dt.date(2030, 6, 1), 3)["forecast"] == []


def test_bookmark_preserves_drill_starting_from_user_selected_year(interaction_session):
    session = interaction_session
    user = session.get(AppUser, "M1")
    config = reports.ReportConfig(name="日期書籤", template="manager", period="year", cards=[reports.ReportCard(id="dates", title="月份", metric="sales", dimension="month", visual="line")])
    created = library.create(session, user, config)
    point = reports.ReportSelectionPoint(label="2031", filters=[reports.ReportFilter(dimension="year", key="2031")])
    state = library.BookmarkState(period="year", exploration=library.Exploration(drills={"dates": library.DrillState(dimension="quarter", steps=[library.DrillStep(dimension="year", point=point)])}))
    saved = library.bookmark(session, user, created.active_report_id, "年度下鑽", state)
    assert saved.bookmarks[0].state.exploration.drills["dates"].dimension == "quarter"


def test_ai_context_omits_image_bytes_and_restores_existing_image(interaction_session):
    import base64
    import io
    from PIL import Image
    stream = io.BytesIO()
    Image.new("RGB", (2, 2), "white").save(stream, format="PNG")
    image = "data:image/png;base64," + base64.b64encode(stream.getvalue()).decode()
    config = reports.ReportConfig(name="圖片保留", template="manager", period="year", cards=[], objects=[reports.StudioObject(id="photo", kind="image", image=image)])

    class Model:
        def json(self, *, prompt, **kwargs):
            import json
            context = json.loads(prompt)["current_config"]
            assert context["objects"][0]["image"] == ""
            return {"kind": "proposal", "message": "保留圖片", "config": context}

    result = reports.adjust(interaction_session, interaction_session.get(AppUser, "M1"), "保留版面", config, llm=Model())
    assert result.config.objects[0].image == image


def test_ai_schema_remains_supported_and_validates_new_visuals():
    from jsonschema import Draft202012Validator
    from app.llm import api_schema, check_output
    schema = reports.ADJUSTMENT_SCHEMA
    Draft202012Validator.check_schema(schema)
    assert api_schema(schema) == schema
    visuals = schema["properties"]["config"]["properties"]["cards"]["items"]["properties"]["visual"]["enum"]
    assert {"waterfall", "funnel", "map"} <= set(visuals)
    check_output(schema, {"kind": "proposal", "message": "可用畫布", "config": reports.ReportConfig.model_validate(query().model_dump(include=set(reports.ReportConfig.model_fields))).model_dump(mode="json")})


def test_copy_remaps_bookmark_button_target(interaction_session):
    session, user = interaction_session, interaction_session.get(AppUser, "M1")
    config = reports.ReportConfig(name="按鈕複製", template="manager", period="year", cards=[])
    original = library.create(session, user, config)
    marked = library.bookmark(session, user, original.active_report_id, "總覽", library.BookmarkState(period="year"))
    config.objects = [reports.StudioObject(id="button", kind="button", action={"kind": "bookmark", "target": marked.bookmarks[0].id})]
    copied = library.create(session, user, config, original.active_report_id)
    assert copied.config.objects[0].action.target == copied.bookmarks[0].id != marked.bookmarks[0].id
