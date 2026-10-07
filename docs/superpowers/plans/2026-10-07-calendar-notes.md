# 拜訪備忘與日曆 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 錄音與手寫的「要帶的／講過的」備忘存進 `customer_note`，下次去這家時客戶檔案與今日路線看得到，有日期的放上日曆。

**Architecture:** 新表 `customer_note`；`services/customer_notes.py` 集中三個規則（確認拜訪時怎麼寫、下次去這家列哪幾則、一個月的日曆）；`api/notes.py` 提供客戶備忘的增改刪與日曆；拜訪欄位多 `notes`，AI 提示多第 10 條。前端：確認頁的備忘欄位、客戶檔案一區、今日路線小卡、`/calendar` 月曆頁。

**Tech Stack:** FastAPI、SQLAlchemy 2、Postgres、pytest；React 19、TypeScript、Vitest、lucide-react。

**Spec:** `docs/superpowers/specs/2026-10-07-calendar-notes-design.md`

## Global Constraints

- 權限：`SHARING_LEVEL["quote"]`（SELF），看不到的客戶與備忘一律 404。
- 系統日：`customer_profile.app_today(session)`（測試是 2026-10-28）。
- 種類只有 `bring`（要帶的）、`told`（講過的）；內容 1～200 字；講過的一定有日期。
- 畫面不用 emoji，用 lucide 圖示（`Package`、`MessageSquareQuote`、`CalendarDays`）。
- 註解與訊息用繁體中文，照附近程式的密度；前端不跑 Prettier（專案原本就沒照它排）。
- 後端測試：`TEST_DB_NAME=meddemo_test_notes TEST_REDIS_URL=redis://127.0.0.1:6379/13 uv run --project backend pytest <檔案> -q`
- 前端：`npm --prefix frontend test -- <檔案>`、`npm --prefix frontend run typecheck`、`npm --prefix frontend run lint`。

---

### Task 1: `customer_note` 表與示範資料

**Files:**
- Modify: `backend/app/models.py`（加 `CustomerNote`、`NOTE_KINDS`）
- Modify: `data/seed/catalog.py`（加 `NOTES`）、`data/seed/generate.py`（`build_notes`，放進 `generate()` 的結果）、`data/seed/seed.py`（`TABLES` 加 `customer_note`，放在 `visit` 後面）
- Test: `backend/tests/test_seed.py`

**Interfaces:**
- Produces: `models.CustomerNote(id, customer_id, user_id, kind, text, on_date, visit_id, created_at)`、`models.NOTE_KINDS = ("bring", "told")`。

- [ ] **Step 1: 失敗的測試**（`test_seed.py` 最後）

```python
def test_demo_notes_belong_to_the_demo_rep(db):
    rows_ = rows(db, """
        SELECT n.kind, n.on_date, c.owner_user_id FROM customer_note n JOIN customer c ON c.id = n.customer_id
    """)
    assert rows_ and all(owner == "U01" for _, _, owner in rows_)
    kinds = {kind for kind, _, _ in rows_}
    assert kinds == {"bring", "told"}
    # 有日期與沒日期的要帶的都有，日曆與「下次去」才都有東西看
    assert any(k == "bring" and d is None for k, d, _ in rows_) and any(k == "bring" and d for k, d, _ in rows_)
```

- [ ] **Step 2: 跑，確認失敗**（`relation "customer_note" does not exist`）

- [ ] **Step 3: 資料表**（`models.py`，接在 `FollowUpReminder` 後面）

```python
NOTE_KINDS = ("bring", "told")


class CustomerNote(Base):
    """拜訪備忘：下次要帶的東西（bring）與跟客戶講過的促銷（told）。錄音確認時寫進來，業務也能手寫
    （docs/superpowers/specs/2026-10-07-calendar-notes-design.md）。"""

    __tablename__ = "customer_note"
    __table_args__ = (
        one_of("kind", NOTE_KINDS, "kind"),
        # 講過的一定是某一天講的；要帶的沒講日期就不放上日曆
        CheckConstraint("kind = 'bring' OR on_date IS NOT NULL", name="told_has_date"),
        CheckConstraint("char_length(text) BETWEEN 1 AND 200", name="text_length"),
        Index("ix_customer_note_customer_created", "customer_id", "created_at"),
        Index("ix_customer_note_on_date", "on_date"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"))
    # 誰記的：錄音來的是做這次拜訪的人，手寫的是實際寫的人
    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id"))
    kind: Mapped[str]
    text: Mapped[str]
    # 放在日曆的哪一天；要帶的沒講日期、這次也沒有追蹤日就是 NULL
    on_date: Mapped[dt.date | None]
    # 從哪次拜訪來的，手寫的是 NULL
    visit_id: Mapped[str | None] = mapped_column(ForeignKey("visit.id", ondelete="CASCADE"))
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())
```

（`one_of` 的簽名照檔案裡其他用法：`one_of(column, values, name)`。）

- [ ] **Step 4: 示範資料**

`catalog.py` 最後：

```python
# 拜訪備忘的示範資料（docs/superpowers/specs/2026-10-07-calendar-notes-design.md）：林昱辰的幾家客戶。
# (客戶, 種類, 內容, 日期離展示日幾天；None 是沒有日期)。都是手寫的（沒有 visit_id），不動亂數
NOTES = [
    ("C001", "told", "跟店長說 Premium 眼藥水小口買 22 送 1，大口加送葡萄籽 4 瓶", -8),
    ("C001", "bring", "Premium 眼藥水的貨架卡與試用包", 2),
    ("C025", "told", "骨營膠囊大口滿 $27,300 送 9 組痠痛組", -6),
    ("C025", "bring", "骨營的 DM 二十張", None),
    ("C027", "bring", "學名藥比價表", 7),
    ("C061", "told", "黃金奇異果益生菌直走 5 組 $4,650，附試吃包", -3),
    ("C061", "bring", "衛教單張（益生菌）", None),
]
```

`generate.py`：

```python
def build_notes(as_of):
    """拜訪備忘的示範資料：日期跟著展示日走，換展示日不必改資料。"""
    return [
        {
            "customer_id": customer_id, "user_id": catalog.DEMO_USER_ID, "kind": kind, "text": text,
            "on_date": as_of + timedelta(days=offset) if offset is not None else None,
            "visit_id": None,
        }
        for customer_id, kind, text, offset in catalog.NOTES
    ]
```

在 `generate()` 回傳的 dict 加 `"customer_note": build_notes(as_of)`（放在最後，不呼叫亂數）。`seed.py` 的 `TABLES` 在 `("visit", models.Visit),` 後面加 `("customer_note", models.CustomerNote),`。

- [ ] **Step 5: 跑測試通過**：`test_seed.py`
- [ ] **Step 6: Commit** `Add the customer_note table and demo notes for the demo rep`

---

### Task 2: 規則：確認時寫備忘、下次去這家、一個月的日曆

**Files:**
- Create: `backend/app/services/customer_notes.py`
- Test: `backend/tests/test_customer_notes.py`

**Interfaces:**
- Produces:
  - `notes_from_visit(session, visit) -> list[CustomerNote]`：照 `visit.fields_final["notes"]` 建（`session.add`，不 commit）。
  - `next_notes(session, customer_id) -> list[CustomerNote]`
  - `month_notes(session, owner_id, first: date, last: date) -> list[tuple[CustomerNote, str]]`（備忘＋客戶名稱）
  - `month_visits(session, owner_id, first, last) -> list[tuple[Visit, str]]`
  - `ordered(notes) -> list`：要帶的在前、同種照建立時間。

- [ ] **Step 1: 失敗的測試**

```python
"""拜訪備忘的規則：確認時怎麼寫、下次去這家列哪幾則、一個月的日曆。"""

import datetime as dt

from app.models import CustomerNote, Visit
from app.services import customer_notes

TAIPEI = dt.timezone(dt.timedelta(hours=8))


def visit(tx, customer_id="C003", notes=None, follow_up=None, day=dt.date(2026, 10, 20)):
    fields = {"competitor": None, "complaint": None, "intent": None, "commitment": None,
              "follow_up_date": follow_up, "notes": notes}
    v = Visit(customer_id=customer_id, user_id="U01", visited_at=dt.datetime.combine(day, dt.time(10), TAIPEI),
              fields_raw=fields, fields_final=fields, status="confirmed")
    tx.add(v)
    tx.flush()
    return v


def test_notes_from_a_visit_get_their_dates(tx):
    v = visit(tx, notes=[
        {"kind": "bring", "text": "骨營 DM", "date": "2026-11-02"},
        {"kind": "bring", "text": "試用包", "date": None},
        {"kind": "told", "text": "小口買 22 送 1", "date": None},
    ], follow_up="2026-10-30")
    made = customer_notes.notes_from_visit(tx, v)
    assert [(n.kind, n.text, n.on_date, n.visit_id, n.user_id) for n in made] == [
        ("bring", "骨營 DM", dt.date(2026, 11, 2), v.id, "U01"),
        # 沒講日期就放追蹤日
        ("bring", "試用包", dt.date(2026, 10, 30), v.id, "U01"),
        # 講過的放拜訪日
        ("told", "小口買 22 送 1", dt.date(2026, 10, 20), v.id, "U01"),
    ]
    no_follow_up = visit(tx, notes=[{"kind": "bring", "text": "POP", "date": None}])
    assert customer_notes.notes_from_visit(tx, no_follow_up)[0].on_date is None
    assert customer_notes.notes_from_visit(tx, visit(tx)) == []


def test_the_newest_visit_with_notes_replaces_the_older_ones(tx):
    old = visit(tx, notes=[{"kind": "bring", "text": "舊的 DM", "date": None}], day=dt.date(2026, 10, 1))
    customer_notes.notes_from_visit(tx, old)
    tx.flush()
    tx.add(CustomerNote(customer_id="C003", user_id="U01", kind="told", text="手寫的舊話", on_date=dt.date(2026, 10, 2)))
    tx.flush()
    new = visit(tx, notes=[{"kind": "told", "text": "新的條件", "date": None},
                           {"kind": "bring", "text": "新的試用包", "date": None}])
    customer_notes.notes_from_visit(tx, new)
    tx.flush()
    tx.add(CustomerNote(customer_id="C003", user_id="U01", kind="bring", text="之後手寫的", on_date=None))
    tx.flush()
    # 沒有備忘的拜訪不會把舊的蓋掉
    visit(tx)
    assert [n.text for n in customer_notes.next_notes(tx, "C003")] == ["新的試用包", "之後手寫的", "新的條件"]


def test_without_visit_notes_all_hand_written_ones_show(tx):
    for text, kind in (("寫的第一則", "told"), ("寫的第二則", "bring")):
        tx.add(CustomerNote(customer_id="C005", user_id="U01", kind=kind, text=text, on_date=dt.date(2026, 10, 3)))
        tx.flush()
    assert [n.text for n in customer_notes.next_notes(tx, "C005")] == ["寫的第二則", "寫的第一則"]


def test_a_month_of_notes_and_visits_for_one_rep(tx):
    first, last = dt.date(2026, 10, 1), dt.date(2026, 10, 31)
    notes = customer_notes.month_notes(tx, "U01", first, last)
    # 示範資料：忠孝店 10/20 講過、10/30 要帶；沒日期的不上日曆；別人的客戶不列
    assert ("C001", dt.date(2026, 10, 30), "bring") in {(n.customer_id, n.on_date, n.kind) for n, _ in notes}
    assert all(n.on_date is not None and first <= n.on_date <= last for n, _ in notes)
    visits = customer_notes.month_visits(tx, "U01", first, last)
    assert visits and all(v.status in ("confirmed", "synced") for v, _ in visits)
    assert customer_notes.month_notes(tx, "U02", first, last) == []
```

- [ ] **Step 2: 跑，確認失敗**（找不到 `customer_notes`）

- [ ] **Step 3: 實作** `backend/app/services/customer_notes.py`

```python
"""拜訪備忘（docs/superpowers/specs/2026-10-07-calendar-notes-design.md）。

三個規則都寫在這裡，客戶檔案、今日路線、日曆讀同一份：確認拜訪時怎麼寫、下次去這家列哪幾則、一個月的日曆。
"""

import datetime as dt
from collections.abc import Iterable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Customer, CustomerNote, Visit
from app.timeutil import TAIPEI, local_date

# 確認過的拜訪：回寫成功與否都算，日曆上那天就是有去
CONFIRMED = ("confirmed", "synced")


def ordered(notes: Iterable[CustomerNote]) -> list[CustomerNote]:
    """要帶的排前面（出門前要準備），同種照建立的先後（流水號；同一個交易裡建的 created_at 一樣）。"""
    return sorted(notes, key=lambda n: (n.kind != "bring", n.id))


def notes_from_visit(session: Session, visit: Visit) -> list[CustomerNote]:
    """確認拜訪時把 notes 欄位寫進備忘表。要帶的沒講日期就放追蹤日；講過的放拜訪日。"""
    fields = visit.fields_final or {}
    follow_up = fields.get("follow_up_date")
    made = []
    for item in fields.get("notes") or []:
        if item["kind"] == "told":
            on_date = local_date(visit.visited_at)
        else:
            day = item.get("date") or follow_up
            on_date = dt.date.fromisoformat(day) if day else None
        note = CustomerNote(
            customer_id=visit.customer_id, user_id=visit.user_id, kind=item["kind"], text=item["text"],
            on_date=on_date, visit_id=visit.id,
        )
        session.add(note)
        made.append(note)
    return made


def next_notes(session: Session, customer_id: str) -> list[CustomerNote]:
    """下次去這家要記得的：最近一次有備忘的拜訪記下的，加上那之後手寫的。沒有拜訪來的就列全部手寫的。"""
    latest = session.scalars(
        select(CustomerNote).where(CustomerNote.customer_id == customer_id, CustomerNote.visit_id.is_not(None))
        .order_by(CustomerNote.id.desc()).limit(1)
    ).first()
    query = select(CustomerNote).where(CustomerNote.customer_id == customer_id)
    if latest is None:
        query = query.where(CustomerNote.visit_id.is_(None))
    else:
        query = query.where(
            (CustomerNote.visit_id == latest.visit_id)
            | (CustomerNote.visit_id.is_(None) & (CustomerNote.id > latest.id))
        )
    return ordered(session.scalars(query))


def month_notes(session: Session, owner_id: str, first: dt.date, last: dt.date) -> list[tuple[CustomerNote, str]]:
    """這位業務負責的客戶，日期落在這段期間的備忘（附客戶名稱）。"""
    rows = session.execute(
        select(CustomerNote, Customer.name).join(Customer, Customer.id == CustomerNote.customer_id)
        .where(Customer.owner_user_id == owner_id, CustomerNote.on_date.between(first, last))
    ).all()
    by_day = sorted(rows, key=lambda r: r[0].on_date)
    return [(note, name) for note, name in by_day]


def month_visits(session: Session, owner_id: str, first: dt.date, last: dt.date) -> list[tuple[Visit, str]]:
    """這位業務負責的客戶，這段期間確認過的拜訪（附客戶名稱），照拜訪時間排。"""
    start = dt.datetime.combine(first, dt.time(), TAIPEI)
    end = dt.datetime.combine(last + dt.timedelta(days=1), dt.time(), TAIPEI)
    return [tuple(r) for r in session.execute(
        select(Visit, Customer.name).join(Customer, Customer.id == Visit.customer_id)
        .where(Customer.owner_user_id == owner_id, Visit.status.in_(CONFIRMED),
               Visit.visited_at >= start, Visit.visited_at < end)
        .order_by(Visit.visited_at)
    ).all()]
```

（`TAIPEI` 在 `app.timeutil`；若沒有，`local_date` 旁邊的時區常數照它的名字用。）

- [ ] **Step 4: 跑測試通過**
- [ ] **Step 5: Commit** `Decide which notes show next visit and which land on each calendar day`

---

### Task 3: 拜訪欄位 `notes`、AI 提示、確認時寫進備忘表

**Files:**
- Modify: `backend/app/schemas/visit_fields.schema.json`、`backend/app/services/extraction.py`（`FIELD_KEYS`、`PROMPT` 第 10 條）、`backend/app/api/visits.py`（`confirm` 呼叫 `notes_from_visit`）
- Modify: `data/seed/generate.py`（`render_visit` 的 `fields` 補 `"notes": None`）、`backend/scripts/eval_voice.py`（`SCORED_KEYS`）
- Modify tests: `backend/tests/test_visits.py`（`FIELDS` 加 `"notes": None`）、`backend/tests/test_eval_corpus.py`、`backend/tests/test_llm.py`、`backend/tests/test_customer_notes.py`
- Docs: `docs/visit-fields.md`

**Interfaces:**
- Consumes: `customer_notes.notes_from_visit`（Task 2）。
- Produces: 欄位 `notes: [{kind, text, date}] | null`；`eval_voice.SCORED_KEYS`。

- [ ] **Step 1: 失敗的測試**

`test_llm.py` 的 `test_nullable_fields_keep_their_structure` 加：

```python
    notes = fields["notes"]
    assert notes["type"] == ["array", "null"]
    assert notes["items"]["properties"]["kind"]["enum"] == ["bring", "told"]
```

`test_visits.py` 加：

```python
def test_confirming_files_the_notes(client, providers, engine):
    notes = [{"kind": "bring", "text": "骨營 DM", "date": None}, {"kind": "told", "text": "小口買 22 送 1", "date": None}]
    visit_id = make_draft(client, providers, FakeExtractor(fields={**FIELDS, "notes": notes}))
    client.post(f"/api/visits/{visit_id}/confirm")
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT kind, text, on_date FROM customer_note WHERE visit_id = :v ORDER BY id"), {"v": visit_id}
        ).all()
    # 要帶的沒講日期，用這次的追蹤日 10/24；講過的放拜訪日
    assert [(k, t, str(d)) for k, t, d in rows][0] == ("bring", "骨營 DM", "2026-10-24")
    assert rows[1][0] == "told" and rows[1][2] is not None
```

並在 `client` fixture 的清理表清單前面加 `"customer_note"`（它有 `visit_id`）。

`test_customer_notes.py` 加：

```python
def test_the_prompt_asks_for_notes():
    from datetime import date
    from app.services import extraction
    prompt = extraction.build_prompt("逐字稿", date(2026, 10, 28), [])
    assert "10. notes" in prompt and "bring" in prompt and "told" in prompt
    assert "notes" in extraction.FIELD_KEYS
```

- [ ] **Step 2: 跑，確認失敗**

- [ ] **Step 3: schema、提示、確認**

schema 的 `required` 加 `"notes"`，`properties` 加 spec 裡那一段 `notes`。`extraction.py`：

```python
FIELD_KEYS = ("competitor", "complaint", "intent", "commitment", "follow_up_date", "notes")
```

`PROMPT` 開頭的「整理成五個欄位」改「整理成六個欄位」，第 9 條後面加：

```
10. notes 收兩種：bring 是業務說下次要帶給客戶的東西（DM、POP、海報、試用包、樣品、衛教單張、比價表…）；told 是業務跟客戶講了哪些促銷、實銷、搭贈、活動條件。text 用業務的講法、精簡成一句。date 只在業務講了哪天要帶、或下次哪天去時才填（照第 3 條換算），told 一律填 null。可以跟 commitment、intent 重複，例如「我答應下次帶比價表」兩邊都填。
```

`SYSTEM` 的「固定的五個欄位」改「固定的六個欄位」。

`visits.py`：import `from app.services import customer_notes`；`confirm` 在 `create_reminder(session, visit)` 後面加 `customer_notes.notes_from_visit(session, visit)`。

- [ ] **Step 4: 假資料、評測、測試資料**

`generate.py` 的 `render_visit` 建 `fields` 時加 `"notes": None`（與其他欄位一起；找 `fields = {` 那一行）。`FIELD_KEYS` 在 generate.py 第 25 行也加 `"notes"`（若它拿來建 `sources` 或 `fields`）。

`eval_voice.py`：

```python
# 題庫只寫了原本五個欄位的答案；備忘不評（docs/superpowers/specs/2026-10-07-calendar-notes-design.md）
SCORED_KEYS = tuple(key for key in FIELD_KEYS if key != "notes")
```

`main()` 裡的 `FIELD_KEYS` 全換成 `SCORED_KEYS`。`test_eval_corpus.py`：`as_fields` 加 `"notes": None`；`all(... for key in FIELD_KEYS)` 換成 `eval_voice.SCORED_KEYS`。

`test_visits.py`：`FIELDS` 加 `"notes": None`。

`docs/visit-fields.md`：表格加一列 `notes`；規則加第 10 條（同提示）；標題「五欄位」改「六個欄位」。

- [ ] **Step 5: 跑測試通過**：`test_llm.py test_visits.py test_eval_corpus.py test_seed.py test_customer_notes.py`
- [ ] **Step 6: Commit** `Pick out notes to bring and promotions told from voice notes and file them on confirm`

---

### Task 4: 備忘與日曆的 API

**Files:**
- Create: `backend/app/api/notes.py`；Modify: `backend/app/main.py`（`include_router`）
- Test: `backend/tests/test_notes_api.py`

**Interfaces:**
- Consumes: `customer_notes.*`（Task 2）、`customers._load`。
- Produces（前端 Task 5 用）：
  - `GET /api/customers/{id}/notes` → `{next: Note[]}`
  - `POST /api/customers/{id}/notes` `{kind, text, on_date?}` → `Note`（201）
  - `PATCH /api/notes/{id}` `{kind?, text?, on_date?}` → `Note`
  - `DELETE /api/notes/{id}` → 204
  - `GET /api/calendar?month=YYYY-MM` → `{month, today, days: [{date, visits: [{visit_id, customer_id, customer_name}], notes: Note[]}]}`
  - `Note = {id, customer_id, customer_name, kind, text, on_date, visit_id, created_at}`

- [ ] **Step 1: 失敗的測試**

```python
"""拜訪備忘與日曆的 API：權限跟報價一樣，只有負責人與他的主管。"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.tasks import redis


@pytest.fixture
def api():
    yield TestClient(app)
    redis().flushdb()


def test_next_visit_notes_and_writing_one(tx, api, auth):
    before = api.get("/api/customers/C001/notes", headers=auth("U01")).json()["next"]
    assert [n["kind"] for n in before] == ["bring", "told"]  # 示範資料：要帶的在前
    created = api.post("/api/customers/C001/notes", json={"kind": "told", "text": "跟店長說了大口送葡萄籽"},
                       headers=auth("U01"))
    assert created.status_code == 201
    note = created.json()
    # 講過的沒給日期就是今天（系統日）
    assert (note["on_date"], note["customer_name"], note["visit_id"]) == ("2026-10-28", "康泰連鎖藥局 · 忠孝店", None)
    after = api.get("/api/customers/C001/notes", headers=auth("U01")).json()["next"]
    assert note["id"] in {n["id"] for n in after}

    changed = api.patch(f"/api/notes/{note['id']}", json={"kind": "bring", "on_date": None}, headers=auth("U01"))
    assert changed.json()["kind"] == "bring" and changed.json()["on_date"] is None
    assert api.delete(f"/api/notes/{note['id']}", headers=auth("U01")).status_code == 204
    assert api.patch(f"/api/notes/{note['id']}", json={"text": "x"}, headers=auth("U01")).status_code == 404


def test_bad_notes_are_rejected(tx, api, auth):
    post = lambda body, customer="C001": api.post(f"/api/customers/{customer}/notes", json=body, headers=auth("U01")).status_code  # noqa: E731
    assert post({"kind": "todo", "text": "x"}) == 422
    assert post({"kind": "bring", "text": "   "}) == 422
    assert post({"kind": "bring", "text": "長" * 201}) == 422
    assert post({"kind": "bring", "text": "x", "on_date": "下週三"}) == 422
    assert post({"kind": "bring", "text": "x"}, customer="C002") == 404  # 王冠宇的客戶
    told = api.post("/api/customers/C001/notes", json={"kind": "told", "text": "x"}, headers=auth("U01")).json()
    assert api.patch(f"/api/notes/{told['id']}", json={"on_date": None}, headers=auth("U01")).status_code == 422


def test_who_can_see_the_notes(tx, api, auth):
    note = api.post("/api/customers/C001/notes", json={"kind": "bring", "text": "DM"}, headers=auth("U01")).json()
    assert api.get("/api/customers/C001/notes", headers=auth("M01")).status_code == 200  # 主管
    assert api.get("/api/customers/C001/notes", headers=auth("U02")).status_code == 404  # 同區別的業務
    assert api.delete(f"/api/notes/{note['id']}", headers=auth("U02")).status_code == 404


def test_the_calendar_month(tx, api, auth):
    month = api.get("/api/calendar?month=2026-10", headers=auth("U01")).json()
    assert (month["month"], month["today"]) == ("2026-10", "2026-10-28")
    days = {d["date"]: d for d in month["days"]}
    assert any(n["text"].startswith("Premium 眼藥水的貨架卡") for n in days["2026-10-30"]["notes"])
    assert all(d["visits"] or d["notes"] for d in month["days"])
    assert any(d["visits"] for d in month["days"])
    assert api.get("/api/calendar", headers=auth("U01")).json()["month"] == "2026-10"  # 預設系統日那個月
    assert api.get("/api/calendar?month=2026-13", headers=auth("U01")).status_code == 422
    assert api.get("/api/calendar?month=1028", headers=auth("U01")).status_code == 422
```

- [ ] **Step 2: 跑，確認失敗**（404）

- [ ] **Step 3: 實作** `backend/app/api/notes.py`

```python
"""拜訪備忘與日曆（docs/superpowers/specs/2026-10-07-calendar-notes-design.md）。

備忘的權限跟報價一樣：負責人與他的主管，其他人跟客戶不存在一樣回 404。日曆看的是行程主人負責的客戶，
跟今日路線一樣（代理示範業務的帳號看示範業務的）。
"""

import calendar
import datetime as dt
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.api.customers import _load
from app.db import get_session
from app.models import AppUser, Customer, CustomerNote
from app.services import customer_notes, customer_profile
from app.services.scope import SHARING_LEVEL
from app.timeutil import local_date

router = APIRouter(tags=["notes"])
SessionDep = Annotated[Session, Depends(get_session)]
Kind = Literal["bring", "told"]
TEXT_MAX = 200


class NoteOut(BaseModel):
    id: int
    customer_id: str
    customer_name: str
    kind: Kind
    text: str
    on_date: dt.date | None
    visit_id: str | None
    created_at: dt.datetime


class NextNotes(BaseModel):
    next: list[NoteOut]


class NoteInput(BaseModel):
    kind: Kind
    text: str = Field(max_length=TEXT_MAX)
    on_date: dt.date | None = None

    @field_validator("text")
    @classmethod
    def not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("備忘不能空白")
        return value.strip()


class NotePatch(BaseModel):
    kind: Kind | None = None
    text: str | None = Field(default=None, max_length=TEXT_MAX)
    on_date: dt.date | None = None

    @field_validator("text")
    @classmethod
    def not_blank(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("備忘不能空白")
        return value.strip() if value is not None else None


class CalendarVisit(BaseModel):
    visit_id: str
    customer_id: str
    customer_name: str


class CalendarDay(BaseModel):
    date: dt.date
    visits: list[CalendarVisit]
    notes: list[NoteOut]


class CalendarMonth(BaseModel):
    month: str
    today: dt.date
    days: list[CalendarDay]


def _out(note: CustomerNote, customer_name: str) -> NoteOut:
    return NoteOut(
        id=note.id, customer_id=note.customer_id, customer_name=customer_name, kind=note.kind, text=note.text,
        on_date=note.on_date, visit_id=note.visit_id, created_at=note.created_at,
    )


def _load_note(session: Session, note_id: int, user: AppUser) -> tuple[CustomerNote, Customer]:
    note = session.get(CustomerNote, note_id)
    if note is None:
        raise HTTPException(404, "找不到這則備忘")
    try:
        customer, _ = _load(session, note.customer_id, user, SHARING_LEVEL["quote"])
    except HTTPException:
        raise HTTPException(404, "找不到這則備忘") from None
    return note, customer


@router.get("/api/customers/{customer_id}/notes", response_model=NextNotes)
def next_notes(session: SessionDep, customer_id: str, user: CurrentUser):
    """下次去這家要記得的：最近一次有備忘的拜訪記下的，加上那之後手寫的。"""
    customer, _ = _load(session, customer_id, user, SHARING_LEVEL["quote"])
    return NextNotes(next=[_out(n, customer.name) for n in customer_notes.next_notes(session, customer.id)])


@router.post("/api/customers/{customer_id}/notes", status_code=201, response_model=NoteOut)
def create_note(session: SessionDep, customer_id: str, body: NoteInput, user: CurrentUser):
    customer, _ = _load(session, customer_id, user, SHARING_LEVEL["quote"])
    # 講過的一定是某一天講的：沒給就是今天（系統日，跟首頁同一天）
    on_date = body.on_date or (customer_profile.app_today(session) if body.kind == "told" else None)
    note = CustomerNote(customer_id=customer.id, user_id=user.id, kind=body.kind, text=body.text, on_date=on_date)
    session.add(note)
    session.commit()
    return _out(note, customer.name)


@router.patch("/api/notes/{note_id}", response_model=NoteOut)
def update_note(session: SessionDep, note_id: int, body: NotePatch, user: CurrentUser):
    note, customer = _load_note(session, note_id, user)
    changes = body.model_dump(exclude_unset=True)
    kind = changes.get("kind") or note.kind
    on_date = changes["on_date"] if "on_date" in changes else note.on_date
    if kind == "told" and on_date is None:
        raise HTTPException(422, "講過的備忘要有日期")
    note.kind, note.on_date = kind, on_date
    if changes.get("text"):
        note.text = changes["text"]
    session.commit()
    return _out(note, customer.name)


@router.delete("/api/notes/{note_id}", status_code=204)
def delete_note(session: SessionDep, note_id: int, user: CurrentUser):
    note, _ = _load_note(session, note_id, user)
    session.delete(note)
    session.commit()
    return Response(status_code=204)


@router.get("/api/calendar", response_model=CalendarMonth)
def calendar_month(session: SessionDep, user: CurrentUser, month: str | None = None):
    """這個月有東西的每一天：那天確認過的拜訪、日期在那天的備忘。"""
    today = customer_profile.app_today(session)
    try:
        first = dt.date.fromisoformat(f"{month}-01") if month else today.replace(day=1)
    except ValueError:
        raise HTTPException(422, "month 要寫成 YYYY-MM") from None
    last = first.replace(day=calendar.monthrange(first.year, first.month)[1])
    owner = user.acts_as_user_id or user.id
    days: dict[dt.date, CalendarDay] = {}

    def day(d: dt.date) -> CalendarDay:
        return days.setdefault(d, CalendarDay(date=d, visits=[], notes=[]))

    for visit, name in customer_notes.month_visits(session, owner, first, last):
        day(local_date(visit.visited_at)).visits.append(
            CalendarVisit(visit_id=visit.id, customer_id=visit.customer_id, customer_name=name)
        )
    notes = customer_notes.month_notes(session, owner, first, last)
    names = {n.id: name for n, name in notes}
    for note in customer_notes.ordered(n for n, _ in notes):
        day(note.on_date).notes.append(_out(note, names[note.id]))
    return CalendarMonth(month=f"{first:%Y-%m}", today=today, days=sorted(days.values(), key=lambda d: d.date))
```

`main.py` import `notes` 與 `app.include_router(notes.router)`。`month=1028` 也要 422：`fromisoformat("1028-01")` 會丟 ValueError，`2026-13-01` 也會。

- [ ] **Step 4: 跑測試通過**
- [ ] **Step 5: Commit** `Serve next-visit notes, hand-written notes and the calendar month`

---

### Task 5: 前端 API 與月曆的 lib

**Files:**
- Create: `frontend/src/api/notes.ts`、`frontend/src/lib/calendar.ts`、`frontend/src/lib/calendar.test.ts`

**Interfaces:**
- Produces:
  - 型別 `Note`、`NoteKind`、`CalendarMonth`、`CalendarDay`；`getNextNotes(customerId, signal)`、`createNote(customerId, {kind, text, on_date})`、`updateNote(id, patch)`、`deleteNote(id)`、`getCalendar(month, signal)`。
  - `monthGrid(month: string): (string | null)[]`：從星期一開始，前後補 null，長度是 7 的倍數；元素是 `YYYY-MM-DD`。
  - `shiftMonth(month: string, delta: number): string`
  - `noteDate(date: string): string`（`2026-10-30` → `10/30`）
  - `NOTE_KIND_LABEL = { bring: "要帶的", told: "講過的" }`

- [ ] **Step 1: 失敗的測試**

```ts
import { describe, expect, it } from "vitest"

import { monthGrid, noteDate, shiftMonth } from "@/lib/calendar"

describe("monthGrid", () => {
  it("從星期一開始，前後補空格", () => {
    const grid = monthGrid("2026-10")
    // 2026-10-01 是星期四：前面補三格
    expect(grid.slice(0, 4)).toEqual([null, null, null, "2026-10-01"])
    expect(grid.length % 7).toBe(0)
    expect(grid.filter(Boolean)).toHaveLength(31)
    expect(grid.at(-1)).toBeNull() // 10/31 是星期六，後面補一格
  })
  it("月初剛好是星期一就不補", () => {
    expect(monthGrid("2026-06")[0]).toBe("2026-06-01")
  })
})

describe("shiftMonth", () => {
  it("跨年", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01")
    expect(shiftMonth("2026-01", -1)).toBe("2025-12")
  })
})

describe("noteDate", () => {
  it("月/日", () => {
    expect(noteDate("2026-10-30")).toBe("10/30")
  })
})
```

- [ ] **Step 2: 跑，確認失敗**

- [ ] **Step 3: 實作** `lib/calendar.ts`

```ts
// 月曆的排法（pages/calendar.tsx）：純計算，日期一律用 YYYY-MM-DD 字串，不經過時區

export const NOTE_KIND_LABEL = { bring: "要帶的", told: "講過的" } as const

const pad = (n: number) => String(n).padStart(2, "0")

/** 一個月的格子，從星期一開始；前後補 null 湊滿整週 */
export function monthGrid(month: string): (string | null)[] {
  const [year, mon] = month.split("-").map(Number)
  const days = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  // getUTCDay：星期日是 0；換成星期一是 0
  const lead = (new Date(Date.UTC(year, mon - 1, 1)).getUTCDay() + 6) % 7
  const cells: (string | null)[] = Array(lead).fill(null)
  for (let d = 1; d <= days; d++) cells.push(`${month}-${pad(d)}`)
  while (cells.length % 7) cells.push(null)
  return cells
}

export function shiftMonth(month: string, delta: number) {
  const [year, mon] = month.split("-").map(Number)
  const date = new Date(Date.UTC(year, mon - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`
}

/** 2026-10-30 → 10/30 */
export function noteDate(date: string) {
  const [, mon, day] = date.split("-").map(Number)
  return `${mon}/${day}`
}
```

`api/notes.ts`：照 `api/customers.ts` 的寫法用 `request`、`jsonBody`，型別照 Task 4 的 Produces。

- [ ] **Step 4: 跑測試通過**
- [ ] **Step 5: Commit** `Add the notes API client and the month grid`

---

### Task 6: 確認頁的「備忘」欄位

**Files:**
- Modify: `frontend/src/api/visits.ts`（`NoteItem`、`VisitFields.notes`、`FieldKey`）、`frontend/src/components/visit/field-format.ts`（`FIELD_ORDER`、`FIELD_LABEL`、`summarize`、`notesLine`）、`frontend/src/components/visit/field-editor.tsx`（`NotesEditor`）、`frontend/src/components/visit/field-format.test.ts`

**Interfaces:**
- Produces: `NoteItem = { kind: "bring" | "told"; text: string; date: string | null }`；`notesLine(notes: NoteItem[]): string`。

- [ ] **Step 1: 失敗的測試**（`field-format.test.ts` 加）

```ts
describe("notesLine", () => {
  it("要帶的在前，有日期寫日期", () => {
    expect(
      notesLine([
        { kind: "told", text: "小口買 22 送 1", date: null },
        { kind: "bring", text: "骨營的 DM", date: null },
        { kind: "bring", text: "試用包", date: "2026-10-30" },
      ])
    ).toBe("要帶：骨營的 DM、試用包（10/30）；講過：小口買 22 送 1")
  })
})
```

- [ ] **Step 2: 跑，確認失敗**

- [ ] **Step 3: 實作**

`field-format.ts`：`FIELD_ORDER` 最後加 `"notes"`，`FIELD_LABEL.notes = "備忘"`；

```ts
/** 備忘一行：「要帶：骨營的 DM、試用包（10/30）；講過：小口買 22 送 1」 */
export function notesLine(notes: NoteItem[]) {
  const part = (kind: NoteItem["kind"], label: string) => {
    const items = notes.filter((n) => n.kind === kind).map((n) => (n.date ? `${n.text}（${noteDate(n.date)}）` : n.text))
    return items.length ? `${label}：${items.join("、")}` : null
  }
  return [part("bring", "要帶"), part("told", "講過")].filter(Boolean).join("；")
}
```

`summarize` 加 `case "notes": return fields.notes ? notesLine(fields.notes) : null`。

`field-editor.tsx`：`{field === "notes" && <NotesEditor initial={visit.fields.notes} {...props} />}`；`NotesEditor` 照 `CompetitorEditor` 的樣子：每列一個種類 `<select>`（要帶的／講過的）、內容 `Input`、要帶的才有 `type="date"` 的日期 `Input`、刪除鈕；「新增一則」；存檔時去掉空白內容、講過的日期設 null，全空就存 null。

- [ ] **Step 4: typecheck、lint、測試通過**
- [ ] **Step 5: Commit** `Show and edit the notes on the visit confirm page`

---

### Task 7: 客戶檔案「下次去要記得」與記一筆的對話框

**Files:**
- Create: `frontend/src/components/note-dialog.tsx`（新增與修改共用；日曆也用）、`frontend/src/components/next-notes.tsx`（一則備忘的列，客戶檔案與小卡共用）
- Modify: `frontend/src/pages/customer.tsx`（「進門前三分鐘」下面加一區）

**Interfaces:**
- Consumes: `api/notes.ts`、`lib/calendar.ts`（Task 5）。
- Produces:
  - `NoteDialog({ open, onOpenChange, customerId, note?, defaultDate?, onSaved })`：沒有 `note` 是新增；有就是修改（多一個刪除）。
  - `NoteRow({ note, onClick? })`：圖示（要帶的 `Package`、講過的 `MessageSquareQuote`）、內容、日期。

- [ ] **Step 1: 實作 `NoteDialog`**：照 `field-editor.tsx` 的 `Dialog` 用法；種類用兩顆切換鈕；內容 `Textarea`（maxLength 200）；日期 `Input type="date"`（講過的預設 `defaultDate` 或空白＝今天由後端補）。送出呼叫 `createNote` 或 `updateNote`，錯誤顯示在對話框裡。
- [ ] **Step 2: 客戶檔案**：載入時另外打 `getNextNotes(customerId)`；一區標題「下次去要記得」、右上「記一筆」；要帶的在前（後端已排好）；點一則開 `NoteDialog` 修改；沒有時一行「還沒有備忘」。載入失敗這一區顯示「備忘沒有載入」，不影響其他區。
- [ ] **Step 3: typecheck、lint、測試**
- [ ] **Step 4: Commit** `Show next-visit notes on the customer profile and let the rep write one`

---

### Task 8: 今日路線小卡列備忘

**Files:**
- Modify: `frontend/src/components/route-path.tsx`（`StopPopover`）

- [ ] **Step 1**：`StopPopover` 打開時 `getNextNotes(stop.customer_id, signal)`，成功就在理由下面列最多三則 `NoteRow`，多的寫「還有 N 則」；失敗或沒有就不顯示這一區。`useEffect` 依 `stop.customer_id`，元件卸載時 abort。
- [ ] **Step 2: typecheck、lint、測試**
- [ ] **Step 3: Commit** `List the customer's notes on the route stop card`

---

### Task 9: 日曆頁

**Files:**
- Create: `frontend/src/pages/calendar.tsx`
- Modify: `frontend/src/App.tsx`（`/calendar`）、`frontend/src/pages/today.tsx`（橫幅上的日期改成連到 `/calendar` 的 `Link`）

- [ ] **Step 1: 頁面**：
  - 狀態：`month`（預設 `null` → 後端回的 `month`）、`selected`（預設後端回的 `today`）。
  - 頁首 `PageHeader title="日曆" backTo="/"`；月份列：上一個月、`2026 年 10 月`、下一個月（各一顆 h-11 的鈕）。
  - 星期列「一二三四五六日」；`monthGrid(month)` 畫 7 欄的格子，每格 `aspect-square` 不固定寬（`grid-cols-7`，不會橫向捲動）；日期數字；下面最多三個小點：拜訪（`bg-muted-foreground`）、要帶的（`bg-primary`）、講過的（`bg-amber-500`）；系統日框起來、選到的那天底色。
  - 選到的那天：標題「10 月 30 日（星期五）」；拜訪列表（客戶名稱 → `/visits/{id}`）、備忘列表（`NoteRow` 加客戶名稱 → `/customers/{id}`）；都沒有寫「這天沒有拜訪也沒有備忘」。
  - 「在這天記一筆」：先選客戶（`listCustomers` 只留 `owner_id` 是行程主人的，照名稱排；用 `<select>`），再開 `NoteDialog`，`defaultDate` 是那一天；存完重新載入這個月。
- [ ] **Step 2: 首頁橫幅**：`formatDayLabel(route.date)` 那個元素包成 `Link to="/calendar"`（`aria-label="打開日曆"`），旁邊加 `CalendarDays` 小圖示。
- [ ] **Step 3: typecheck、lint、測試**
- [ ] **Step 4: Commit** `Add the calendar page and open it from the home banner`

---

### Task 10: 文件、真的 Gemini、整套跑起來看

- [ ] **Step 1: README**：「口述到回寫」加一句備忘；「客戶檔案與談判卡」加「下次去要記得」；「今日路線」加小卡的備忘與日曆入口；目錄加 `services/customer_notes.py`、`api/notes.py`、`pages/calendar.tsx`。
- [ ] **Step 2: 全部後端測試**：`TEST_DB_NAME=meddemo_test_notes TEST_REDIS_URL=redis://127.0.0.1:6379/13 uv run --project backend pytest backend/tests -q`
- [ ] **Step 3: 真的 Gemini**：scratchpad 腳本照 `visit_processing._extract` 跑：「下次記得帶骨營的 DM 過去」「下週三再去，記得帶試用包」「跟店長說了 Premium 小口買 22 送 1」「店長抱怨補貨延遲三天」，加兩句混著報價、承諾的話，跑兩次；格式沒被拒、種類與日期對。
- [ ] **Step 4: 整套跑起來**：dev 資料庫 `meddemo_notes_dev`、API 8013、Vite 5184（臨時 config，用完刪）；headless Chrome（每段 20 秒內）看日曆（10 月、點 10/30）、客戶檔案的「下次去要記得」與記一筆、首頁小卡；390px 沒有橫向捲動。
- [ ] **Step 5: Commit** `Describe visit notes and the calendar in the README`
