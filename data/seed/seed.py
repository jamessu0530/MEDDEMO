"""重建資料庫並灌入假資料。

    uv run --project backend python data/seed/seed.py [--as-of 2026-10-28]

會清掉整個 public schema，依 SQLAlchemy models 重建資料表與語意層 View，再重新產生資料。
只有兩樣東西會留下來：自己開的帳號（含第三方登入自動開的），以及第三方登入的綁定。
"""

import argparse
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

# macOS 上 .venv 會被標成隱藏，Python 就略過可編輯安裝的 .pth、找不到 app；直接把 backend 加進搜尋路徑
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from sqlalchemy import Connection, insert, select, text  # noqa: E402
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, undefer

import catalog
import generate
from app import models
from app.db import make_engine, reset_schema, schema_version
from app.embeddings import optional_embedder
from app.services import approvals, attachment_processing, attachments, channel_memory, route_habits
from app.services.auth import EXTERNAL_ACCOUNT_ACTS_AS
from app.services.channels import ensure_channels
from app.services.documents import index_documents
from app.services.org import paths_from_reports, rebuild_org_paths, region_of

# 示範對話附的照片與 PDF（backend/scripts/draw_seed_images.py 畫的）
ATTACHMENTS_DIR = Path(__file__).resolve().parent / "attachments"

# 決賽日。評測題庫的標準答案以這一天為「今天」計算
DEFAULT_AS_OF = date(2026, 10, 28)

# 依外鍵相依的順序寫入
TABLES = [
    ("org_unit", models.OrgUnit),
    ("place", models.Place),
    ("app_user", models.AppUser),
    ("product", models.Product),
    ("promotion", models.Promotion),
    ("promotion_item", models.PromotionItem),
    ("customer", models.Customer),
    ("sales_transaction", models.SalesTransaction),
    ("receivable", models.Receivable),
    ("visit", models.Visit),
    ("crm_visit_record", models.CrmVisitRecord),
    ("sap_quotation_draft", models.SapQuotationDraft),
    ("oa_expense_form", models.OaExpenseForm),
    ("writeback_log", models.WritebackLog),
    ("sap_employee", models.SapEmployee),
]


@dataclass
class KeptAccounts:
    """重灌前先讀出來、灌完再放回去的東西。資料表一改部署就會重灌（.github/workflows/ci-cd.yml），
    這兩樣不留的話，綁過 Google 的人下次登入會被當成新來的、另開一個帳號，自己開的帳號則整個消失。
    他們的提問、頻道訊息這些內容不留：那些跟著假資料一起重來。"""

    # app_user 裡自己開的帳號（有 acts_as_user_id 的列），欄位照舊資料表的樣子
    users: list[dict[str, Any]]
    # user_identity 的每一列，公司帳號綁的也算
    identities: list[dict[str, Any]]


def saved_accounts(conn: Connection) -> KeptAccounts:
    """重建之前讀。全新的資料庫、或舊到還沒有這些表與欄位的資料庫，就是沒有東西要留。"""
    # 直接問系統目錄，不用 SQLAlchemy 的反射：反射會去認每個欄位的型別，遇到 ltree 就印警告
    ready = conn.execute(text("""
        SELECT to_regclass('public.user_identity') IS NOT NULL AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'app_user' AND column_name = 'acts_as_user_id'
        )
    """)).scalar()
    if not ready:
        return KeptAccounts([], [])
    users = conn.execute(text("SELECT * FROM app_user WHERE acts_as_user_id IS NOT NULL ORDER BY id")).mappings()
    identities = conn.execute(text("SELECT * FROM user_identity ORDER BY id")).mappings()
    return KeptAccounts([dict(row) for row in users], [dict(row) for row in identities])


def restore_accounts(session: Session, kept: KeptAccounts) -> tuple[int, int]:
    """把留下來的帳號與綁定放回剛灌好的資料庫，回傳（帳號數, 綁定數）。

    只放得回去的才放：工號或信箱跟新的公司帳號撞了的帳號跳過；綁定掛的帳號已經不在了
    （公司帳號改了工號、或那個自建帳號剛好被跳過）也跳過。
    舊資料表有、新資料表沒有的欄位直接丟掉；新欄位用資料表的預設值。"""
    demo = session.get(models.AppUser, EXTERNAL_ACCOUNT_ACTS_AS)
    ids = set(session.scalars(select(models.AppUser.id)))
    emails = set(session.scalars(select(models.AppUser.email).where(models.AppUser.email.is_not(None))))
    user_columns = {column.key for column in models.AppUser.__table__.columns}
    accounts = 0
    for row in kept.users:
        # 沒有示範業務就沒有人可以代理，自建帳號在組織約束下站不住
        if demo is None or row["id"] in ids or (row.get("email") and row["email"] in emails):
            continue
        values = {key: value for key, value in row.items() if key in user_columns}
        # 位置照自建帳號的形狀重填：不在組織樹上、代理示範業務；轄區隨後由 rebuild_org_paths 再算一次
        values |= {
            "role": "sales", "acts_as_user_id": demo.id, "region": demo.region,
            "manager_id": None, "unit_id": None, "org_path": None,
        }
        session.execute(insert(models.AppUser), [values])
        ids.add(row["id"])
        emails.add(row.get("email"))
        accounts += 1
    # id 是資料庫自己編的（GENERATED ALWAYS），不能指定
    identity_columns = {column.key for column in models.UserIdentity.__table__.columns} - {"id"}
    bindings = 0
    for row in kept.identities:
        if row["user_id"] not in ids:
            continue
        session.execute(insert(models.UserIdentity), [{key: value for key, value in row.items() if key in identity_columns}])
        bindings += 1
    return accounts, bindings


def restore_or_skip(session: Session, kept: KeptAccounts) -> tuple[int, int]:
    """放不回去就整批放棄，灌資料照常往下走。走到這裡資料庫已經清空重建了，
    為了幾筆舊帳號讓整次重灌失敗，線上會剩下一個空的資料庫；少了這些帳號，頂多是那些人重新登入一次。"""
    try:
        with session.begin_nested():
            return restore_accounts(session, kept)
    except SQLAlchemyError as exc:
        print(f"自己開的帳號與第三方登入的綁定沒有留下來：{exc}", file=sys.stderr)
        return 0, 0


def seed_conversations(session: Session) -> int:
    """頻道裡預先寫好的對話（catalog.CONVERSATIONS）與整理好的記憶（catalog.MEMORY）。
    時間從灌資料的這一刻往前推，之後有人發言一定排在後面。
    不放在 generate.py：那裡的產出跟著 as_of 固定下來，這裡的時間要跟著實際灌資料的日子走。"""
    now = datetime.now(generate.TAIPEI)
    count = 0
    # 每個頻道第幾行對話是哪一則訊息、附件檔名是哪一個附件，整理記憶時對得回去
    message_ids: dict[tuple[str, str], list[int]] = {}
    attachment_ids: dict[str, int] = {}
    channel_ids: dict[tuple[str, str], int] = {}
    for (kind, key), lines in catalog.CONVERSATIONS:
        if kind == "customer":
            customer_id = session.scalar(select(models.Customer.id).where(models.Customer.name == key))
            channel = models.Channel(kind="customer", customer_id=customer_id)
            session.add(channel)
            session.flush()
        else:
            column = {"team": models.Channel.manager_id, "place": models.Channel.place_id}[kind]
            channel = session.scalar(select(models.Channel).where(column == key))
        for days_ago, clock, author_id, body, *files in lines:
            hour, minute = map(int, clock.split(":"))
            at = (now - timedelta(days=days_ago)).replace(hour=hour, minute=minute, second=0, microsecond=0)
            message = models.ChannelMessage(channel_id=channel.id, author_id=author_id, kind="user", body=body, created_at=at)
            session.add(message)
            count += 1
            session.flush()
            message_ids.setdefault((kind, key), []).append(message.id)
            if files:
                attachment_ids |= seed_attachments(session, message, files[0])
        # 每個頻道寫完就送出去：編號照加入的順序，同一個頻道裡越晚的編號越大
        session.flush()
        channel_ids[(kind, key)] = channel.id
    seed_memory(session, now.date(), channel_ids, message_ids, attachment_ids)
    return count


def seed_memory(
    session: Session,
    today: date,
    channel_ids: dict[tuple[str, str], int],
    message_ids: dict[tuple[str, str], list[int]],
    attachment_ids: dict[str, int],
) -> None:
    """示範對話整理好的重點。這些頻道算是已經整理到最後一則，熊熊滾不會再整理一次。"""
    for owner, items in catalog.MEMORY:
        lines = message_ids[owner]
        for entry in items:
            shared = "shared_text" in entry
            due_in = entry.get("due_in")
            session.add(models.MemoryItem(
                channel_id=channel_ids[owner], category=entry["category"], text=entry["text"],
                status=entry.get("status", "open"),
                due_date=today + timedelta(days=due_in) if due_in is not None else None,
                source_message_ids=[lines[i] for i in entry["sources"]],
                attachment_ids=[attachment_ids[name] for name in entry.get("files", [])],
                shared_attachment_ids=[attachment_ids[name] for name in entry.get("share_files", [])],
                shared=shared, shared_text=entry.get("shared_text"),
            ))
        session.get(models.Channel, channel_ids[owner]).memory_through_id = lines[-1]
    session.flush()


def seed_attachments(session: Session, message: models.ChannelMessage, names: tuple[str, ...]) -> dict[str, int]:
    """示範對話附的照片與 PDF，照上傳的流程整理（清 EXIF、縮圖）。說明是手寫的，所以直接算處理完；
    向量等有設定 embedding 再算（灌資料不需要金鑰）。回傳 {檔名: 附件編號}。"""
    author = session.get(models.AppUser, message.author_id)
    added = {}
    for name in names:
        prepared = attachments.prepare((ATTACHMENTS_DIR / name).read_bytes(), name)
        added[name] = attachments.add(
            session, author, prepared, context=message.body, message_id=message.id,
            caption=catalog.SEED_ATTACHMENTS[name], status="ready",
        )
    session.flush()
    return {name: attachment.id for name, attachment in added.items()}


def seed_approval_steps(session: Session) -> int:
    """優惠與合約申請單的關卡與活動日誌，關卡的名稱與指派照 App 開新單時的做法（services/approvals.py）。

    人簽過的歷史單每一關都簽完，最後一關的結果就是整張單的結果；展示用的五張裡，等簽的停在區處主管那一關，
    系統核准的第二關沒有簽核人。展示用的五張順便用訓練好的模型補上機率：假資料產生時還沒有模型。
    """
    forms = session.scalars(
        select(models.OaExpenseForm).where(models.OaExpenseForm.kind != "trip").order_by(models.OaExpenseForm.id)
    ).all()
    steps, activity = [], []
    signers: dict[tuple[str, str], dict[str, models.AppUser]] = {}
    for form in forms:
        at = form.created_at
        steps.append({
            "form_id": form.id, "step_no": 1, "role_label": "請求者", "user_id": form.applicant_id, "title": "業務",
            "status": "done", "acted_at": at,
        })
        activity.append({
            "form_id": form.id, "action": "submitted", "actor_id": form.applicant_id, "detail": "經辦人送出", "created_at": at,
        })
        if form.auto_approved or form.status == "pending":
            form.model_probability, threshold = approvals.estimate(form.kind, form.model_features)
        if form.auto_approved:
            steps.append({
                "form_id": form.id, "step_no": 2, "role_label": approvals.AUTO_STEP_LABEL, "user_id": None, "title": "模型",
                "status": "done", "acted_at": at,
            })
            # 還沒訓練過模型（第一次灌資料）就沒有機率可寫；訓練完重灌一次才有
            detail = approvals.auto_detail(form.model_probability, threshold) if threshold is not None else "系統核准"
            activity.append({"form_id": form.id, "action": "auto_approved", "actor_id": None, "detail": detail, "created_at": at})
            continue
        key = (form.applicant_id, form.required_level)
        if key not in signers:
            signers[key] = approvals.signers(session, session.get(models.AppUser, form.applicant_id), form.required_level)
        chain = approvals.LEVEL_STEPS[form.required_level]
        for step_no, step in enumerate(chain, start=2):
            signer = signers[key][step]
            decided = form.status != "pending"
            # 每一關隔一小時，都在送單當天簽完（《報價權限與折扣審核》：1 個工作天內完成簽核）
            acted_at = at + timedelta(hours=step_no - 1)
            steps.append({
                "form_id": form.id, "step_no": step_no, "role_label": approvals.STEP_ROLE_LABEL[step], "user_id": signer.id,
                "title": approvals.STEP_TITLE[step],
                "status": "done" if decided else "pending" if step_no == 2 else "waiting",
                "acted_at": acted_at if decided else None,
            })
            if not decided:
                continue
            # 前面幾關都是核准；整張單的結果記在最後一關
            last = step == chain[-1]
            action = form.status if last else "approved"
            detail = {"approved": f"{approvals.STEP_TITLE[step]}核准", "rejected": "已駁回", "returned": "已退回"}[action]
            activity.append({"form_id": form.id, "action": action, "actor_id": signer.id, "detail": detail, "created_at": acted_at})
    session.execute(insert(models.OaApprovalStep), steps)
    session.execute(insert(models.OaActivity), activity)
    return len(forms)


def seed_method_cards(session: Session, cards: list[dict[str, Any]], feedback: list[dict[str, Any]]) -> tuple[int, int]:
    """方法卡與回饋（generate.build_method_cards），回傳（卡片數, 回饋數）。不放進 TABLES：卡片的 id 是資料庫
    自己編的（GENERATED ALWAYS），不能指定，所以先寫卡片、再用標題查回 id 寫回饋。
    時間跟頻道的對話一樣，從灌資料的這一刻往前推。"""
    now = datetime.now(generate.TAIPEI)
    for card in cards:
        written = now - timedelta(days=card["days_ago"])
        values = {key: value for key, value in card.items() if key != "days_ago"}
        session.add(models.MethodCard(**values, created_at=written, updated_at=written))
    session.flush()
    ids = dict(session.execute(select(models.MethodCard.title, models.MethodCard.id)).all())
    rows = [
        {
            "card_id": ids[f["card_title"]], "user_id": f["user_id"], "customer_id": f["customer_id"], "helped": f["helped"],
            "created_at": (now - timedelta(days=f["days_ago"])).replace(
                hour=f["minute"] // 60, minute=f["minute"] % 60, second=0, microsecond=0
            ),
        }
        for f in feedback
    ]
    # 編號照時間排，越晚按的編號越大
    rows.sort(key=lambda row: row["created_at"])
    session.execute(insert(models.MethodCardFeedback), rows)
    return len(cards), len(rows)


def seed(url: str | None, as_of: date) -> dict[str, int]:
    data = generate.generate(as_of)
    engine = make_engine(url)
    with engine.connect() as conn:
        kept = saved_accounts(conn)
    reset_schema(engine)
    with Session(engine) as session, session.begin():
        session.add_all([
            models.AppSetting(key="as_of_date", value=as_of.isoformat()),
            # 部署流程拿它比對：程式裡的資料表定義一改，就知道 VM 上的資料庫要重建
            models.AppSetting(key="schema_version", value=schema_version()),
        ])
        for name, model in TABLES:
            rows = data[name]
            if name == "app_user":
                # org_position 約束是一般 CHECK 約束，Postgres 不支援延遲檢查：
                # manager_id／unit_id 有值的那一列，org_path 得在同一筆 INSERT 就一起帶著，
                # 沒有「先插入、稍後用 rebuild_org_paths 補上」的空間，所以先在寫入前算好路徑
                # region 是從路徑算出來的衍生值，也是 NOT NULL，一樣得在這筆 INSERT 帶著
                units = data["org_unit"]
                reports = {u["id"]: (u["role"], u["manager_id"], u["unit_id"]) for u in rows}
                paths = paths_from_reports({u["id"]: u["kind"] for u in units}, reports)
                names = {u["id"]: u["name"] for u in units}
                rows = [{**u, "org_path": paths[u["id"]], "region": region_of(paths[u["id"]], names)} for u in rows]
                # manager_id 指向同一張表：經理要先寫進去，業務那幾列的外鍵才成立
                rows.sort(key=lambda u: u["manager_id"] is not None)
            session.execute(insert(model), rows)
        # 重灌前的自建帳號與第三方登入綁定放回來；放在重算組織之前，轄區才會跟著示範業務一起算
        kept_accounts, kept_identities = restore_or_skip(session, kept)
        # 跟 services/org.py 的演算法核對一次：組織管理頁改組織時，也是呼叫這個函式重算
        rebuild_org_paths(session)
        # 歷史出差單當已核准：請求者與區處主管兩關都過，申請匣才不會被幾千張舊單塞滿
        session.execute(text("""
            INSERT INTO oa_approval_step (form_id, step_no, role_label, user_id, title, status, acted_at)
            SELECT o.id, 1, '請求者', o.applicant_id, '業務', 'done', o.created_at
            FROM oa_expense_form o
            WHERE o.kind = 'trip'
        """))
        session.execute(text("""
            INSERT INTO oa_approval_step (form_id, step_no, role_label, user_id, title, status, acted_at)
            SELECT o.id, 2, '經辦人的主管', m.id, '區處主管', 'done', o.created_at
            FROM oa_expense_form o
            -- 簽核的是申請人的直屬主管，跟 App 開新單時一樣（services/oa.py）
            JOIN app_user m ON m.id = (SELECT manager_id FROM app_user WHERE id = o.applicant_id)
            WHERE o.kind = 'trip'
        """))
        session.execute(text("""
            INSERT INTO oa_activity (form_id, action, actor_id, detail, created_at)
            SELECT o.id, 'submitted', o.applicant_id, '經辦人送出', o.created_at
            FROM oa_expense_form o
            WHERE o.kind = 'trip'
        """))
        session.execute(text("""
            INSERT INTO oa_activity (form_id, action, actor_id, detail, created_at)
            SELECT o.id, 'approved', m.id, '簽核者', o.created_at
            FROM oa_expense_form o
            -- 簽核的是申請人的直屬主管，跟 App 開新單時一樣（services/oa.py）
            JOIN app_user m ON m.id = (SELECT manager_id FROM app_user WHERE id = o.applicant_id)
            WHERE o.kind = 'trip'
        """))
        # 優惠與合約的申請單：歷史單的關卡與日誌，加上展示用五張的機率
        seed_approval_steps(session)
        # 全國、整區、地點與小組頻道（客戶討論串第一次有人打開才建）
        ensure_channels(session)
        messages = seed_conversations(session)
        method_cards, method_feedback = seed_method_cards(session, data["method_card"], data["method_card_feedback"])
        # 示範業務的三條排序習慣（services/route_habits.DEMO_HABITS），IT 重置示範業務的行程時也照這份重建
        route_habits.reset_demo(session, catalog.DEMO_USER_ID)
        # 假資料的拜訪編號是直接指定的，序號要接在後面，新拜訪才不會撞號
        session.execute(text("SELECT setval('visit_seq', :n)"), {"n": len(data["visit"])})
        # 內部文件建索引；有設定 embedding 服務才一併算向量，否則只建關鍵字索引
        embedder = optional_embedder()
        chunks = index_documents(session, embed=embedder.embed_documents if embedder else None)
        # 示範對話的照片與 PDF、整理好的重點：有設定 embedding 才補向量（跟上面的文件一樣）
        if embedder:
            for attachment in session.scalars(select(models.Attachment).options(undefer(models.Attachment.content))):
                attachment_processing.describe_and_embed(session, attachment, embedder=embedder, caption=False)
            items = list(session.scalars(select(models.MemoryItem).order_by(models.MemoryItem.id)))
            vectors = embedder.embed_documents([(None, channel_memory.memory_text(item)) for item in items])
            for item, vector in zip(items, vectors, strict=True):
                item.embedding = vector
    engine.dispose()
    return {name: len(data[name]) for name, _ in TABLES} | {
        "document_chunk": chunks, "channel_message": messages,
        "method_card": method_cards, "method_card_feedback": method_feedback,
        "route_habit": len(route_habits.DEMO_HABITS),
        "kept_account": kept_accounts, "kept_identity": kept_identities,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--as-of", type=date.fromisoformat, default=DEFAULT_AS_OF)
    parser.add_argument("--database-url", help="預設讀環境變數 DATABASE_URL")
    args = parser.parse_args()
    counts = seed(args.database_url, args.as_of)
    print(f"as_of={args.as_of}")
    for name, n in counts.items():
        print(f"{name:22} {n:6}")


if __name__ == "__main__":
    main()
