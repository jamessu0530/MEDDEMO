"""Durable, one-store-at-a-time route orders. Draft and progress commit together.

The itinerary and source orders are frozen when the task starts. Catalog, price,
payment terms and access are checked again for each store. No operation submits.
"""

import copy
import hashlib
from decimal import Decimal

from pydantic import ValidationError
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models import AppUser, AssistantTaskExecution, Customer, Itinerary, ItineraryStop, Promotion, PromotionItem, SalesTransaction
from app.services import order_workspace as orders
from app.services.auth import role_data_user

CAPABILITY = "order.route_repeat"


def result(batch: dict) -> dict:
    stores = batch["stores"]
    done = sum(store["status"] == "completed" for store in stores)
    attention = sum(store["status"] == "needs_attention" for store in stores)
    skipped = sum(store["status"] == "skipped" for store in stores)
    pending = sum(store["status"] == "pending" for store in stores)
    if not pending and batch["state"] not in ("cancelled", "paused"):
        batch["state"] = "waiting" if attention else "completed"
    label = {"running": "處理中", "paused": "已暫停", "waiting": "部分店家需要處理",
             "completed": "已完成", "cancelled": "已取消後續處理"}[batch["state"]]
    return {"status": "completed" if batch["state"] == "completed" else "waiting",
            "message": f"路線開單{label}：{done}/{len(stores)} 家已建草稿，{attention} 家待確認，{skipped} 家跳過。草稿請逐張檢查後送出。",
            "resource": None, "batch": batch}


def prepare(session: Session, account: AppUser, user: AppUser, instruction: str, previous: dict | None) -> dict:
    if previous and previous.get("batch"):
        return previous  # Never reinterpret or recreate a prepared batch on refinement.
    rep = role_data_user(user)
    if rep.role != "sales":
        raise orders.OrderError("請切換到業務身分，再依該業務的今日路線開單。", 403)
    today = orders.customer_profile.app_today(session)
    route = session.scalar(select(Itinerary).where(Itinerary.user_id == rep.id, Itinerary.date == today))
    if not route:
        return {"status": "waiting", "message": "尚未載入今日路線，請先開啟今日路線，確認店家後再繼續。", "resource": None}
    stops = session.execute(select(Customer.id, Customer.name).join(ItineraryStop, ItineraryStop.customer_id == Customer.id)
                            .where(ItineraryStop.itinerary_id == route.id).order_by(ItineraryStop.position, ItineraryStop.id)).all()
    if not stops:
        return {"status": "waiting", "message": "今日路線沒有店家，請先加入店家後再繼續。", "resource": None}
    # Freeze the most recent completed purchase for each store, excluding drafts.
    sources = {}
    first_day = func.min(SalesTransaction.date)
    for row in session.execute(select(SalesTransaction.customer_id, SalesTransaction.order_no, first_day.label("date"))
                               .where(SalesTransaction.customer_id.in_([stop.id for stop in stops]))
                               .group_by(SalesTransaction.customer_id, SalesTransaction.order_no)
                               .order_by(first_day.desc(), SalesTransaction.order_no.desc())):
        sources.setdefault(row.customer_id, row)
    batch = {"state": "running", "revision": 1, "rep_id": rep.id, "rep_name": rep.name,
             "route_id": route.id, "route_version": route.version, "route_date": route.date.isoformat(), "stores": []}
    for stop in stops:
        source = sources.get(stop.id)
        batch["stores"].append({"customer_id": stop.id, "customer_name": stop.name, "status": "pending",
                                "source_order_no": source.order_no if source else None,
                                "source_date": source.date.isoformat() if source else None,
                                "message": "等待建立草稿", "warnings": [], "resource": None})
    return result(batch)


def create_store(session: Session, user: AppUser, batch: dict, store: dict) -> None:
    if not store["source_order_no"]:
        raise orders.OrderError("沒有已成交的歷史訂單，請手動選擇商品與數量。")
    source = orders.last_purchase(session, user, store["customer_id"], source_order_no=store["source_order_no"])
    if source is None:
        raise orders.OrderError("原歷史訂單已不存在，請人工確認。")
    if source["unavailable_count"]:
        raise orders.OrderError(f"上次訂單有 {source['unavailable_count']} 項商品已下架或不可訂購，請人工確認整張訂單。")
    if not source["items"]:
        raise orders.OrderError("上次訂單沒有可訂購的商品，請人工確認。")
    defaults = orders.customer_defaults(session, user, store["customer_id"])
    customer = defaults["customer"]
    if not customer["payment_term"]:
        raise orders.OrderError("尚未設定付款條件，請先補齊客戶資料再重試。")
    warnings = []
    items = []
    for item in source["items"]:
        if item["unit_price"] <= 0:
            raise orders.OrderError(f"{item['name']}尚無標準供貨價，請先確認價格。")
        items.append(orders.ItemInput(sku=item["sku"], qty=item["last_qty"], unit_price=Decimal(str(item["unit_price"]))))
        if Decimal(str(item["unit_price"])) != Decimal(str(item["last_unit_price"])):
            warnings.append(f"{item['name']}單價：上次 {item['last_unit_price']:g} → 目前供貨價 {item['unit_price']:g}。")
    today = defaults["as_of"]
    promotions = session.execute(select(Promotion.name, PromotionItem.name.label("item_name"), PromotionItem.deal)
                                .join(PromotionItem, PromotionItem.promotion_id == Promotion.id)
                                .where(Promotion.start_date <= today, Promotion.end_date >= today,
                                       PromotionItem.sku.in_([item.sku for item in items]))
                                .order_by(Promotion.id, PromotionItem.code)).all()
    for promo in promotions:
        warnings.append(f"目前促銷：{promo.name}／{promo.item_name}：{promo.deal}。本草稿採供貨價，優惠與贈品請在訂單頁確認。")
    if not customer["address"]:
        warnings.append("尚無收貨地址，請在訂單頁補齊。")
    saved = orders.create(session, user, orders.OrderInput(
        customer_id=customer["id"], ship_to_id=customer["id"], shipping_date=today,
        shipping_address=customer["address"] or "", payment_term=customer["payment_term"],
        note=f"依 {batch['route_date']} 路線，參考歷史訂單 {source['order_no']}（{store['source_date']}）建立草稿。", items=items,
    ), commit=False)
    store.update(status="completed", message=f"已建立草稿 {saved['order_no']}", warnings=warnings,
                 resource={"id": saved["id"], "path": f"/orders/{saved['id']}"},
                 item_count=len(items), amount=saved["amount"])


def control(session: Session, account: AppUser, user: AppUser, task_id: str, action: str, customer_id: str | None = None) -> dict:
    # Same lock as generic execute: retries, simultaneous tabs and pause serialize.
    lock = int.from_bytes(hashlib.sha256(f"{account.id}:{task_id}".encode()).digest()[:8], signed=True)
    session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock})
    record = session.get(AssistantTaskExecution, (account.id, task_id), populate_existing=True)
    if not record or record.capability != CAPABILITY or not record.result.get("batch"):
        raise orders.OrderError("找不到這項路線開單工作。", 404)
    batch = copy.deepcopy(record.result["batch"])
    if record.scope_user_id != user.id or batch["rep_id"] != role_data_user(user).id:
        raise orders.OrderError("業務身分已變更，請回原身分續做這項工作。", 409)
    store = next((item for item in batch["stores"] if item["customer_id"] == customer_id), None)
    if action in ("step", "skip", "retry") and store is None:
        raise orders.OrderError("這家店不在本次保存的路線中。", 404)
    if batch["state"] == "cancelled":
        return record.result
    if action == "cancel":
        batch["state"] = "cancelled"
    elif action == "pause":
        if batch["state"] != "completed":
            batch["state"] = "paused"
    elif action == "resume":
        batch["state"] = "running"
    elif action == "skip":
        if store["status"] != "completed":
            store.update(status="skipped", message="已跳過；未建立草稿。")
    elif action == "retry":
        if store["status"] in ("needs_attention", "skipped"):
            store.update(status="pending", message="等待重試", warnings=[])
            batch["state"] = "running"
    elif action == "step" and batch["state"] == "running" and store["status"] == "pending":
        # A failed store cannot roll back drafts that were already committed.
        try:
            with session.begin_nested():
                create_store(session, user, batch, store)
        except (orders.OrderError, ValidationError) as exc:
            store.update(status="needs_attention", message=str(exc) if isinstance(exc, orders.OrderError)
                         else "上次訂單的數量、價格或付款條件無法沿用，請人工確認。", warnings=[])
    batch["revision"] += 1
    saved = result(batch)
    record.result = saved
    session.commit()
    return saved
