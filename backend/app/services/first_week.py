"""新人第一週：你在哪一區、主管是誰、賣什麼、先認識哪幾家客戶、第一週每天做什麼。

頁面上的內容不讓 AI 生成（NFR-1）：「你是誰、賣什麼」來自模擬 SAP 的人員主檔（SapEmployee），
哪一區、主管是誰看組織樹，客戶與進貨金額現查，每天做什麼是 resources/first_week.json 裡人寫的句子。

範圍照 services/scope.py：名下客戶是代理之後的那位業務的（自建與第三方登入的帳號看示範業務林昱辰的）；
「同一區賣最好的品項」是業績數字，看得到整個轄區（SHARING_LEVEL["sales_figures"]），
沒有超出他在問答本來就查得到的資料。
"""

import datetime as dt
import json
import logging
from pathlib import Path
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models import CUSTOMER_TYPES, AppUser, Customer, DocumentChunk, Product, SalesTransaction, SapEmployee
from app.services.customer_profile import RECENT_DAYS, app_today
from app.services.scope import SHARING_LEVEL, Scope

logger = logging.getLogger(__name__)

CONFIG_FILE = Path(__file__).resolve().parents[1] / "resources" / "first_week.json"
# 到職 30 天內算新人：首頁多一張入口卡。過了還是打得開這一頁，只是首頁不再提醒
NEWCOMER_DAYS = 30
# 每條產品線列同一區賣最好的三個品項
TOP_PRODUCTS = 3
# 先認識的客戶列五家：一天跑 3～5 家，一天就能走完
KEY_CUSTOMERS = 5
# 先認識 A 級的，不足五家才用 B 級補；C 級不列
KEY_GRADES = ("A", "B")
GRADES = ("A", "B", "C")


def load_config() -> dict[str, Any]:
    return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))


def has_page(user: AppUser) -> bool:
    """業務帳號都有這一頁（不是新人也能回來看）；主管與 IT 沒有。"""
    return user.role == "sales"


def status(session: Session, user: AppUser) -> dict[str, Any]:
    """首頁的入口卡用：要不要顯示、到職第幾天，以及第一週有哪些事（task_ids）。

    勾選進度只記在手機裡，卡片上的「完成 4／15」要知道現在設定檔裡有哪些 id 才算得出來；
    附在這裡，首頁就不必為了一張卡把整頁的資料都查一遍。主管與 IT 沒有這一頁，也就沒有事要做。
    """
    task_ids = [task["id"] for day in load_config()["days"] for task in day["tasks"]] if has_page(user) else []
    return {**newcomer(session, user), "task_ids": task_ids}


def newcomer(session: Session, user: AppUser) -> dict[str, Any]:
    """是不是新人、到職第幾天（到職日當天是第 1 天）。

    沒有人員主檔的業務帳號（自建與第三方登入的）一律當新人，沒有到職日所以 day_no 是 None：
    決賽評審用自己的帳號登入，看到的就是新人的畫面。
    """
    if not has_page(user):
        return {"is_newcomer": False, "day_no": None}
    employee = session.get(SapEmployee, user.id)
    if employee is None:
        return {"is_newcomer": True, "day_no": None}
    # 跟系統日比，不跟真實時間比：假資料的「今天」固定在決賽日
    day_no = (app_today(session) - employee.hire_date).days + 1
    return {"is_newcomer": day_no <= NEWCOMER_DAYS, "day_no": day_no}


def page(session: Session, user: AppUser) -> dict[str, Any]:
    """整頁的資料。呼叫端先用 has_page 擋掉主管與 IT。"""
    scope = Scope.for_user(user)
    # 代理之後的那位業務：哪一區、主管是誰、名下客戶都看他的
    acting = user.acts_as or user
    employee = session.get(SapEmployee, user.id)
    manager = session.get(AppUser, acting.manager_id) if acting.manager_id else None
    own = Customer.owner_user_id == scope.acting_user_id
    since = app_today(session) - dt.timedelta(days=RECENT_DAYS)

    cities = session.scalars(
        select(Customer.city).where(own).group_by(Customer.city).order_by(func.count().desc(), Customer.city)
    ).all()
    config = load_config()
    titles = _document_titles(session, config)
    return {
        **newcomer(session, user),
        "employee": {
            "employee_no": employee.employee_no if employee else None,
            "hire_date": employee.hire_date if employee else None,
            "region": acting.region,
            "manager_name": manager.name if manager else None,
            "cities": list(cities),
            "proxy_of": acting.name if user.acts_as_user_id else None,
        },
        "customers": _customer_counts(session, own),
        "product_lines": _product_lines(session, scope, employee, since),
        "promotion": _running_promotion(session),
        "key_customers": _key_customers(session, own, since),
        "days": [
            {
                "day": day["day"], "title": day["title"],
                "tasks": [
                    # 文件不在索引裡就不給連結：點了只會是「找不到這份文件」
                    {"id": task["id"], "text": task["text"], "to": task.get("to"),
                     "doc": task["doc"] if task.get("doc") in titles else None}
                    for task in day["tasks"]
                ],
            }
            for day in config["days"]
        ],
        "documents": [{"source_name": name, "title": titles[name]} for name in config["documents"] if name in titles],
    }


def _customer_counts(session: Session, own) -> dict[str, Any]:
    """名下客戶幾家，依類型、依等級。名下還沒有客戶（IT 剛開的帳號）就都是 0。"""
    rows = session.execute(select(Customer.type, Customer.grade, func.count()).where(own).group_by(Customer.type, Customer.grade)).all()
    return {
        "total": sum(count for _, _, count in rows),
        "by_type": {type_: sum(count for t, _, count in rows if t == type_) for type_ in CUSTOMER_TYPES},
        "by_grade": {grade: sum(count for _, g, count in rows if g == grade) for grade in GRADES},
    }


def _product_lines(session: Session, scope: Scope, employee: SapEmployee | None, since: dt.date) -> list[dict[str, Any]]:
    """每條產品線：品項表裡有幾個品項、同一區近 90 天進貨金額最高的幾個。

    產品線照人員主檔；自己沒有主檔的（自建帳號）看代理的那位業務的，連他也沒有就是全部類別。
    """
    sku_counts = dict(session.execute(select(Product.category, func.count()).group_by(Product.category)).all())
    employee = employee or session.get(SapEmployee, scope.acting_user_id)
    lines = employee.product_lines if employee else sorted(sku_counts)
    ranked = session.execute(
        select(Product.category, Product.sku, Product.name, Product.unit_price, Product.aliases)
        .join(SalesTransaction, SalesTransaction.sku == Product.sku)
        .join(Customer, Customer.id == SalesTransaction.customer_id)
        .where(
            Product.category.in_(lines),
            SalesTransaction.date > since,
            # 業績數字共享到整個轄區：同區業務看到的排名一樣，不只算自己名下的客戶
            scope.customers_at(SHARING_LEVEL["sales_figures"]),
        )
        .group_by(Product.sku)
        .order_by(func.sum(SalesTransaction.amount).desc(), Product.sku)
    ).all()
    top: dict[str, list[dict[str, Any]]] = {line: [] for line in lines}
    for row in ranked:
        if len(top[row.category]) < TOP_PRODUCTS:
            top[row.category].append({
                "sku": row.sku, "name": row.name, "unit_price": float(row.unit_price), "aliases": list(row.aliases),
            })
    return [{"category": line, "sku_count": sku_counts.get(line, 0), "top": top[line]} for line in lines]


def _running_promotion(session: Session) -> dict[str, Any] | None:
    """進行中的那一期促銷：名稱與幾個促銷品項。跟促銷頁一樣讀語意層的 View，狀態只在那裡算一次。"""
    row = session.execute(text("""
        SELECT p.promotion_name AS name, count(i.item_code) AS item_count
        FROM v_promotion p
        LEFT JOIN v_promotion_item i ON i.promotion_name = p.promotion_name
        WHERE p.status = '進行中'
        GROUP BY p.promotion_name, p.start_date
        ORDER BY p.start_date DESC
        LIMIT 1
    """)).mappings().first()
    return dict(row) if row else None


def _key_customers(session: Session, own, since: dt.date) -> list[dict[str, Any]]:
    """先認識的幾家：名下 A 級客戶裡近 90 天進貨金額最高的，不足再用 B 級補。"""
    amount = func.coalesce(func.sum(SalesTransaction.amount), 0)
    rows = session.execute(
        select(Customer.id, Customer.name, Customer.type, Customer.grade, Customer.city, amount.label("amount_last_90d"))
        # 近 90 天沒進貨的客戶也要在：條件放在 JOIN 上，不放 WHERE
        .outerjoin(SalesTransaction, (SalesTransaction.customer_id == Customer.id) & (SalesTransaction.date > since))
        .where(own, Customer.grade.in_(KEY_GRADES))
        .group_by(Customer.id)
        .order_by(Customer.grade, amount.desc(), Customer.id)
        .limit(KEY_CUSTOMERS)
    ).all()
    return [{**row._mapping, "amount_last_90d": float(row.amount_last_90d)} for row in rows]


def _document_titles(session: Session, config: dict[str, Any]) -> dict[str, str]:
    """設定檔提到的文件（必讀文件與每天要讀的）在索引裡的標題。找不到的記一筆 log，頁面上不列。"""
    names = set(config["documents"]) | {task["doc"] for day in config["days"] for task in day["tasks"] if task.get("doc")}
    titles = dict(session.execute(
        select(DocumentChunk.source_name, DocumentChunk.doc_title).where(DocumentChunk.source_name.in_(names)).distinct()
    ).all())
    for name in sorted(names - set(titles)):
        logger.warning("first_week.json 列的文件 %s 不在文件索引裡，新人第一週頁不列這一份", name)
    return titles
