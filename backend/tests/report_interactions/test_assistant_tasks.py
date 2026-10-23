import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models import AppUser, AssistantTaskExecution, SalesOrder
from app.services import assistant_tasks as planner, assistant_task_actions as actions, auth, report_library, reports
from scripts.upgrade_schema import PRE_TASKS_VERSION, upgrade
from app.models import AppSetting


def command(key, **patch):
    return {"action": "create", "key": key, "target_id": "", "capability": "report.create",
            "title": key, "instruction": f"建立{key}", "after": [], **patch}


def test_semantic_plan_keeps_twelve_tasks_and_their_dependencies():
    commands = [command(f"step-{n}", after=[f"step-{n - 1}"] if n else []) for n in range(12)]
    result = {"handled": True, "message": "已安排十二項工作", "commands": commands}
    prompts = []

    def generate(**values):
        prompts.append(json.loads(values["prompt"]))
        return result

    assert planner.plan("交辦十二項工作", tasks=[], llm=SimpleNamespace(json=generate)) == result
    assert len(prompts[0]["capabilities"]) > 3
    assert prompts[0]["question"] == "交辦十二項工作"


def test_voice_configuration_exposes_the_shared_task_tool():
    from app.services import voice
    config = voice.live_config([])
    assert [item.name for item in config.tools[0].function_declarations] == ["manage_tasks", "query_data", "search_knowledge"]
    assert {tool.name: tool.ask_kind for tool in voice.TOOLS}["manage_tasks"] == "tasks"


@pytest.mark.parametrize("commands", [
    [command("one"), command("one")],
    [command("one", after=["later"]), command("later")],
    [command("one", capability="shell.execute")],
    [command("one", action="resume", target_id="not-owned")],
])
def test_invalid_model_plans_are_rejected_as_a_whole(commands):
    with pytest.raises((ValueError, RuntimeError)):
        planner.validate_plan({"handled": True, "message": "", "commands": commands}, [])


def test_planner_resumes_by_existing_id_and_preserves_followup_requirements():
    task = {"id": "existing", "capability": "order.create", "title": "康泰開單", "instruction": "魚油十盒", "status": "waiting"}
    value = {"handled": True, "message": "補上客戶", "commands": [command("update", action="refine", target_id="existing", instruction="替康泰忠孝店開單，魚油十盒")]}
    assert planner.validate_plan(value, [task]) == value
    assert task["instruction"] == "魚油十盒"


@pytest.fixture
def tasks_db(interaction_session):
    AssistantTaskExecution.__table__.create(interaction_session.connection(), checkfirst=True)
    SalesOrder.__table__.create(interaction_session.connection(), checkfirst=True)
    return interaction_session


def order_json(**patch):
    return {"customer": "C1", "items": [{"product": "P1", "qty": 10, "unit": "盒"}], "shipping_date": "", "note": "", **patch}


def test_order_task_retries_create_one_draft_and_never_submit(tasks_db, monkeypatch):
    session = tasks_db
    user = session.get(AppUser, "S1")
    calls = []

    def generate(**values):
        calls.append(values)
        return order_json()

    monkeypatch.setattr(actions, "get_llm", lambda: SimpleNamespace(json=generate))
    first = actions.execute(session, user, user, "task-one", "order.create", "替 C1 開單，P1 十盒")
    second = actions.execute(session, user, user, "task-one", "order.create", "替 C1 開單，P1 十盒")
    assert first == second and first["status"] == "completed"
    assert len(calls) == 1
    assert session.scalar(select(func.count()).select_from(SalesOrder)) == 1
    order = session.get(SalesOrder, first["resource"]["id"])
    assert order.status == "draft" and order.sap_order_no is None
    assert order.items[0]["sku"] == "P1" and order.items[0]["qty"] == 10
    assert "草稿" in first["message"]


def test_customer_only_order_creates_a_visible_empty_draft_once(tasks_db, monkeypatch):
    user = tasks_db.get(AppUser, "S1")
    monkeypatch.setattr(actions, "get_llm", lambda: SimpleNamespace(json=lambda **_: order_json(items=[])))
    first = actions.execute(tasks_db, user, user, "customer-only", "order.create", "幫 C1 開單")
    second = actions.execute(tasks_db, user, user, "customer-only", "order.create", "幫 C1 開單")
    assert first == second and first["status"] == "completed"
    order = tasks_db.get(SalesOrder, first["resource"]["id"])
    assert order.items == [] and order.status == "draft" and order.sap_order_no is None
    assert first["resource"]["path"] == f"/orders/{order.id}"
    assert "新增商品" in first["message"]
    listing = actions.orders.list_orders(tasks_db, user)
    assert [item["id"] for item in listing["items"]] == [order.id]
    assert tasks_db.scalar(select(func.count()).select_from(SalesOrder)) == 1


def test_named_product_without_quantity_still_requires_clarification(tasks_db, monkeypatch):
    user = tasks_db.get(AppUser, "S1")
    monkeypatch.setattr(actions, "get_llm", lambda: SimpleNamespace(json=lambda **_: order_json(items=[{"product": "P1", "qty": 0, "unit": "盒"}])))
    result = actions.execute(tasks_db, user, user, "missing-qty", "order.create", "幫 C1 開 P1")
    assert result["status"] == "waiting" and result["resource"] is None
    assert tasks_db.scalar(select(func.count()).select_from(SalesOrder)) == 0


def test_task_plan_api_passes_previous_store_answer_to_planner(tasks_db, monkeypatch):
    user = tasks_db.get(AppUser, "S1")
    captured = {}

    def plan(question, **values):
        captured.update(values)
        return {"handled": True, "message": "已安排建立 C1 的草稿", "commands": [command("order", capability="order.create", instruction="幫 C1 開單")]}

    monkeypatch.setattr(planner, "plan", plan)
    earlier = [{"question": "剛剛查到哪家店？", "answer": "康泰忠孝店，編號 C1。"}]
    response = TestClient(app).post("/api/assistant-tasks/plan", headers={"Authorization": f"Bearer {auth.create_token(user)}"},
                                    json={"question": "幫我開那家店", "earlier": earlier})
    assert response.status_code == 200, response.text
    assert captured["earlier"] == earlier


def test_missing_ambiguous_and_unknown_customers_do_not_create_orders(tasks_db, monkeypatch):
    user = tasks_db.get(AppUser, "S1")
    monkeypatch.setattr(actions, "get_llm", lambda: SimpleNamespace(json=lambda **_: order_json(customer="")))
    result = actions.execute(tasks_db, user, user, "missing", "order.create", "魚油十盒")
    assert result["status"] == "waiting" and result["resource"] is None
    monkeypatch.setattr(actions, "get_llm", lambda: SimpleNamespace(json=lambda **_: order_json(customer="NO-SUCH-CUSTOMER")))
    result = actions.execute(tasks_db, user, user, "unknown", "order.create", "替不存在的客戶開單")
    assert result["status"] == "waiting" and "找不到" in result["message"]
    assert tasks_db.scalar(select(func.count()).select_from(SalesOrder)) == 0
    assert isinstance(actions.choose([{"id": "C1", "name": "康泰一店"}, {"id": "C2", "name": "康泰二店"}], "康泰", "id", "客戶"), str)


def test_refining_existing_order_updates_its_draft_instead_of_creating_again(tasks_db, monkeypatch):
    user = tasks_db.get(AppUser, "S1")
    monkeypatch.setattr(actions, "get_llm", lambda: SimpleNamespace(json=lambda **_: order_json()))
    first = actions.execute(tasks_db, user, user, "same", "order.create", "C1 P1 十盒")
    draft = tasks_db.get(SalesOrder, first["resource"]["id"])
    draft.items = [{"sku": "P1", "qty": 10, "unit_price": "88.00"}]
    draft.recipient, draft.shipping_address, draft.purchase_no = "原收件人", "已修改的收貨地址", "PO-KEEP"
    tasks_db.flush()
    monkeypatch.setattr(actions, "get_llm", lambda: SimpleNamespace(json=lambda **_: order_json(items=[{"product": "P1", "qty": 20, "unit": "盒"}])))
    second = actions.execute(tasks_db, user, user, "same", "order.create", "C1 P1 二十盒")
    assert first["resource"] == second["resource"]
    assert tasks_db.scalar(select(func.count()).select_from(SalesOrder)) == 1
    assert tasks_db.get(SalesOrder, first["resource"]["id"]).items[0]["qty"] == 20
    stored = tasks_db.get(SalesOrder, first["resource"]["id"])
    assert float(stored.items[0]["unit_price"]) == 88
    assert float(stored.amount) == 1760
    assert (stored.recipient, stored.shipping_address, stored.purchase_no) == ("原收件人", "已修改的收貨地址", "PO-KEEP")


def test_refining_with_missing_items_does_not_clear_existing_draft(tasks_db, monkeypatch):
    user = tasks_db.get(AppUser, "S1")
    monkeypatch.setattr(actions, "get_llm", lambda: SimpleNamespace(json=lambda **_: order_json()))
    first = actions.execute(tasks_db, user, user, "keep-items", "order.create", "C1 P1 十盒")
    monkeypatch.setattr(actions, "get_llm", lambda: SimpleNamespace(json=lambda **_: order_json(items=[])))
    revised = actions.execute(tasks_db, user, user, "keep-items", "order.create", "C1 的草稿補上備註")
    assert revised["status"] == "waiting" and revised["resource"] == first["resource"]
    order = tasks_db.get(SalesOrder, first["resource"]["id"])
    assert order.items[0]["sku"] == "P1" and order.items[0]["qty"] == 10


def test_report_tasks_keep_separate_documents_and_refine_the_original(tasks_db, monkeypatch):
    user = tasks_db.get(AppUser, "S1")

    def adjust(session, account, question, config):
        return reports.Adjustment(kind="proposal", message="已整理", config=config.model_copy(update={"name": question, "period": "this_month"}))

    monkeypatch.setattr(reports, "adjust", adjust)
    first = actions.execute(tasks_db, user, user, "report-one", "report.create", "本月業績")
    actions.execute(tasks_db, user, user, "report-two", "report.create", "客戶排行")
    revised = actions.execute(tasks_db, user, user, "report-one", "report.create", "本月業績新版")
    assert first["resource"] == revised["resource"]
    library = report_library.load(tasks_db, user)
    assert {item.config.name for item in library.documents} >= {"本月業績新版", "客戶排行"}
    assert len(library.documents) == 3  # Existing default and the two requested reports.


def test_cached_receipts_revalidate_resources_and_execution_identity(tasks_db, monkeypatch):
    user = tasks_db.get(AppUser, "S1")
    monkeypatch.setattr(actions, "get_llm", lambda: SimpleNamespace(json=lambda **_: order_json()))
    result = actions.execute(tasks_db, user, user, "private", "order.create", "C1 P1 十盒")
    order = tasks_db.get(SalesOrder, result["resource"]["id"])
    with pytest.raises(actions.orders.OrderError, match="身分"):
        actions.execute(tasks_db, user, tasks_db.get(AppUser, "S3"), "private", "order.create", "C1 P1 十盒")
    tasks_db.delete(order)
    tasks_db.flush()
    with pytest.raises(actions.orders.OrderError):
        actions.execute(tasks_db, user, user, "private", "order.create", "C1 P1 十盒")


def test_same_task_id_in_two_accounts_has_independent_receipts(tasks_db, monkeypatch):
    monkeypatch.setattr(actions, "get_llm", lambda: SimpleNamespace(json=lambda **_: order_json()))
    first = tasks_db.get(AppUser, "S1")
    second = tasks_db.get(AppUser, "S2")
    one = actions.execute(tasks_db, first, first, "same-id", "order.create", "C1 P1 十盒")
    two = actions.execute(tasks_db, second, second, "same-id", "order.create", "C1 P1 十盒")
    assert one["resource"]["id"] != two["resource"]["id"]
    assert tasks_db.get(AssistantTaskExecution, ("S1", "same-id")) is not None
    assert tasks_db.get(AssistantTaskExecution, ("S2", "same-id")) is not None


def test_failed_resource_write_and_receipt_roll_back_together(tasks_db, monkeypatch):
    user = tasks_db.get(AppUser, "S1")
    monkeypatch.setattr(actions, "get_llm", lambda: SimpleNamespace(json=lambda **_: order_json()))

    def interrupted(*args):
        actions.order_action(*args)
        raise RuntimeError("interrupted before receipt")

    monkeypatch.setitem(actions.ACTIONS, "order.create", interrupted)
    savepoint = tasks_db.begin_nested()
    try:
        with pytest.raises(RuntimeError, match="before receipt"):
            actions.execute(tasks_db, user, user, "interrupted", "order.create", "C1 P1 十盒")
    finally:
        savepoint.rollback()
    assert tasks_db.scalar(select(func.count()).select_from(SalesOrder)) == 0
    assert tasks_db.get(AssistantTaskExecution, ("S1", "interrupted")) is None


def test_task_endpoint_requires_auth_and_uses_current_account(tasks_db, monkeypatch):
    monkeypatch.setattr(actions, "get_llm", lambda: SimpleNamespace(json=lambda **_: order_json()))
    api = TestClient(app)
    body = {"task_id": "endpoint", "capability": "order.create", "instruction": "C1 P1 十盒"}
    assert api.post("/api/assistant-tasks/execute", json=body).status_code == 401
    headers = {"Authorization": f"Bearer {auth.create_token(tasks_db.get(AppUser, 'S1'))}"}
    response = api.post("/api/assistant-tasks/execute", headers=headers, json=body)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "completed"
    assert tasks_db.get(AssistantTaskExecution, ("S1", "endpoint")) is not None


def test_previous_schema_upgrades_additively_with_task_receipts(interaction_session):
    session = interaction_session
    session.add(AppSetting(key="schema_version", value=PRE_TASKS_VERSION))
    session.flush()
    assert "既有資料保留" in upgrade(session.connection())
    assert session.scalar(select(func.count()).select_from(AssistantTaskExecution)) == 0
