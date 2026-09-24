# 組織樹權限模型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把扁平的 sales／manager 兩軸權限換成一棵組織樹，並讓每一種資料有自己的共享層級。

**Architecture:** 組織是一棵樹，每個人有一條 `ltree` 路徑（`TW.N.M01.U01`）。可見範圍 = 把自己的路徑截到該種資料的共享層級深度，再看對方是不是在底下（`<@` / `@>`）。主管的路徑比較短、截不動，所以「主管看得到屬下」是同一個式子的自然結果，不是第二條規則。ORM 與語意層 SQL 共用同一套深度常數。

**Tech Stack:** Python 3.12、FastAPI、SQLAlchemy 2.0、Postgres 16（`ltree` + `pgvector`）、pytest。

規格見 [docs/superpowers/specs/2026-09-24-org-tree-permissions-design.md](../specs/2026-09-24-org-tree-permissions-design.md)。

## Global Constraints

- **不加新的 Python 相依。** `sqlalchemy-utils` 沒裝也不要裝，`LTREE` 型別自己宣告一個最小可用的。
- **ltree 標籤只能是 ASCII。** 節點代號用 `TW`、`TW.N`、`U01`，中文名字放 `name` 欄位。
- **沒有 migration。** schema 砍掉重建（`app.db.reset_schema`），改完跑 `uv run --project backend python data/seed/seed.py`。
- **`role` 欄位不動。** `sales` / `manager` 與 `manager_only` 管的是頁面動作權限，跟樹管的列可見性是兩回事。
- **風險通報與簽核繼續用 `region` 過濾。** `api/manager.py`、`api/escalations.py` 這次完全不碰。
- **測試指令**：`uv run --project backend pytest backend/tests`。單檔：`uv run --project backend pytest backend/tests/test_scope.py -v`。
- **需要資料庫**：`docker compose up -d --wait db redis`。測試會自建 `meddemo_test`。
- **commit 訊息結尾**加上 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`。
- **分支**：`org-tree-permissions`（已建立，spec 已在上面）。

## File Structure

| 檔案 | 責任 |
|---|---|
| `backend/app/models.py` | 新增 `LTREE` 型別、`OrgUnit` 表、`AppUser` 的 `manager_id`／`unit_id`／`org_path`／`acts_as` |
| `backend/app/services/org.py` | **新檔**。`rebuild_org_paths()`：從 `manager_id`／`unit_id` 整棵重算 `org_path` |
| `backend/app/services/scope.py` | 改寫。層級常數、`Scope.users_at()`／`can_see()`／`owns_filter()` |
| `backend/app/sql/semantic_layer.sql` | `app_in_scope(ltree, int)`，四個 View 各自宣告深度 |
| `backend/app/services/sql_executor.py` | 只塞一個設定 `app.scope_path` |
| `backend/app/db.py` | `CREATE EXTENSION IF NOT EXISTS ltree` |
| `data/seed/catalog.py` | `ORG_UNITS`、`USERS` 加 `manager_id`／`unit_id` |
| `data/seed/generate.py` | 組 `org_unit` 與新的 `app_user` 欄位 |
| `data/seed/seed.py` | 灌完呼叫 `rebuild_org_paths` |
| `backend/app/api/customers.py` | 讀 ROOT、寫 SELF |
| `backend/app/api/visits.py` | 讀 TEAM、寫 SELF |
| `backend/app/api/asks.py`、`transcription.py` | 改用新 API，維持 SELF |
| `backend/app/services/oa.py` | `.owner_id` → `.acting_user_id` |
| `backend/tests/test_scope.py` | 改寫既有五個測試，新增六個 |

## 任務順序的理由

Task 3 是一次性切換：`Scope` 的舊 API（`owner_id`／`region`／`allows`／`customer_filter`）被所有呼叫點使用，沒辦法逐一遷移。所以 Task 3 把 `Scope` 換掉**並同時改完所有呼叫點，行為保持不變**——全部用 SELF，在現有假資料下與今天等價（M01 的 SELF 截到 `TW.N.M01`，正好涵蓋 U01、U02，等於今天的「北區」）。現有測試在 Task 3 結束時應該全綠。Task 4～6 才逐項放寬層級。

---

### Task 1: ltree 擴充與組織樹的 schema

**Files:**
- Modify: `backend/app/db.py:60`
- Modify: `backend/app/models.py`（imports、`LTREE`、`OrgUnit`、`AppUser`）
- Test: `backend/tests/test_scope.py`

**Interfaces:**
- Consumes: 無
- Produces:
  - `app.models.LTREE`（`UserDefinedType`，`get_col_spec()` 回 `"LTREE"`）
  - `app.models.ORG_UNIT_KINDS = ("root", "region")`
  - `app.models.OrgUnit`：`id: str`（同時就是路徑）、`name: str`、`kind: str`、`parent_id: str | None`
  - `app.models.AppUser.manager_id: str | None`、`.unit_id: str | None`、`.org_path: str | None`、`.acts_as: AppUser | None`

- [ ] **Step 1: 寫失敗的測試**

加到 `backend/tests/test_scope.py` 最下面：

```python
def test_the_org_tree_is_stored_as_ltree_paths(engine):
    from sqlalchemy import text as sql_text

    with engine.connect() as conn:
        assert conn.execute(sql_text("SELECT 1 FROM pg_extension WHERE extname = 'ltree'")).scalar() == 1
        kind = conn.execute(sql_text("""
            SELECT format_type(a.atttypid, a.atttypmod)
            FROM pg_attribute a
            WHERE a.attrelid = 'app_user'::regclass AND a.attname = 'org_path'
        """)).scalar()
        assert kind == "ltree"
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `uv run --project backend pytest backend/tests/test_scope.py::test_the_org_tree_is_stored_as_ltree_paths -v`
Expected: FAIL — `assert None == 1`（沒有 ltree 擴充），或建表時就炸。

- [ ] **Step 3: 加擴充**

`backend/app/db.py`，在 `CREATE EXTENSION IF NOT EXISTS vector` 那一行下面加一行：

```python
        conn.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS vector")
        # ltree：組織樹的路徑與祖先比對（services/scope.py）。Postgres 13 起是 trusted extension，
        # 資料庫擁有者不需要 superuser 就能建立
        conn.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS ltree")
```

- [ ] **Step 4: 宣告 LTREE 型別**

`backend/app/models.py`，在 `one_of` 函式上面加。import 區塊要多一個 `from sqlalchemy.types import UserDefinedType`，並在 `from sqlalchemy.orm import ...` 那行加上 `relationship`：

```python
class LTREE(UserDefinedType):
    """Postgres 的 ltree。SQLAlchemy 沒有內建，宣告一個最小可用的（不加 sqlalchemy-utils 相依）。

    只有 AppUser.org_path 用它：它是唯一會出現在 SQL 比對裡的路徑欄位。
    OrgUnit 的路徑就是它的 id（'TW'、'TW.N'），純字串處理，不需要這個型別。
    """

    cache_ok = True

    def get_col_spec(self, **kw: Any) -> str:
        return "LTREE"
```

- [ ] **Step 5: 加 OrgUnit 表**

`backend/app/models.py`，放在 `AppUser` 上面（`AppUser.unit_id` 要指到它）：

```python
ORG_UNIT_KINDS = ("root", "region")


class OrgUnit(Base):
    """組織樹的地理層，只有四列。人不放這裡：經理本人就是團隊節點，掛在 AppUser 上。

    id 同時就是這個節點的路徑（'TW'、'TW.N'），所以不另外存 path 欄位。
    """

    __tablename__ = "org_unit"
    __table_args__ = (one_of("kind", ORG_UNIT_KINDS, "kind"),)

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str]
    kind: Mapped[str]
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("org_unit.id"))
```

- [ ] **Step 6: 加 AppUser 的欄位**

`backend/app/models.py` 的 `AppUser`。`__table_args__` 從

```python
    __table_args__ = (one_of("role", ("sales", "manager"), "role"),)
```

改成

```python
    __table_args__ = (
        one_of("role", ("sales", "manager"), "role"),
        # 在組織裡：manager_id 與 unit_id 恰有一個有值，路徑算得出來。
        # 不在組織裡：三個都空，且一定是代理別人的帳號（自建與第三方登入，見 api/auth.py）
        CheckConstraint(
            "((manager_id IS NULL) <> (unit_id IS NULL) AND org_path IS NOT NULL)"
            " OR (manager_id IS NULL AND unit_id IS NULL AND org_path IS NULL"
            "     AND acts_as_user_id IS NOT NULL)",
            name="org_position",
        ),
    )
```

在 `acts_as_user_id` 那一行下面加三個欄位與一個 relationship：

```python
    # 組織樹（services/org.py）。manager_id 與 unit_id 是真相來源，org_path 是整棵重算出來的衍生值。
    # 經理沒有 manager_id、掛在地理節點上；業務有 manager_id，路徑接在主管後面
    manager_id: Mapped[str | None] = mapped_column(ForeignKey("app_user.id"))
    unit_id: Mapped[str | None] = mapped_column(ForeignKey("org_unit.id"))
    org_path: Mapped[str | None] = mapped_column(LTREE)
    # app_user 有兩個指向自己的外鍵（acts_as_user_id 與 manager_id），要明講是哪一個
    acts_as: Mapped["AppUser | None"] = relationship(
        remote_side="AppUser.id", foreign_keys="AppUser.acts_as_user_id"
    )
```

- [ ] **Step 7: 跑測試確認通過**

Run: `uv run --project backend pytest backend/tests/test_scope.py::test_the_org_tree_is_stored_as_ltree_paths -v`
Expected: PASS

- [ ] **Step 8: 確認沒弄壞別的**

Run: `uv run --project backend pytest backend/tests -x -q`
Expected: 全部通過。`org_position` 約束此時還沒有資料違反它（假資料的八個帳號三欄都是 NULL 且 `acts_as_user_id` 也是 NULL）——**如果這裡失敗且訊息是 `org_position`，代表 Task 2 必須跟這一個 task 一起完成**；把 Task 2 接著做完再一起 commit。

- [ ] **Step 9: Commit**

```bash
git add backend/app/db.py backend/app/models.py backend/tests/test_scope.py
git commit -m "$(cat <<'EOF'
Add the org tree schema and the ltree extension

OrgUnit holds the four geographic nodes; the reporting line lives on
AppUser. org_path is derived and filled in by the next commit.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 算出路徑並灌進假資料

**Files:**
- Create: `backend/app/services/org.py`
- Modify: `data/seed/catalog.py:7-15`（`USERS`）、新增 `ORG_UNITS`
- Modify: `data/seed/generate.py:544-548`（users 組裝）、`:580`（回傳的 dict）
- Modify: `data/seed/seed.py`
- Test: `backend/tests/test_scope.py`

**Interfaces:**
- Consumes: Task 1 的 `OrgUnit`、`AppUser.manager_id`／`.unit_id`／`.org_path`
- Produces: `app.services.org.rebuild_org_paths(session: Session) -> None`

- [ ] **Step 1: 寫失敗的測試**

加到 `backend/tests/test_scope.py`：

```python
def test_org_paths_are_rebuilt_from_the_reporting_line(engine):
    with Session(engine) as session:
        paths = {u.id: u.org_path for u in session.scalars(select(AppUser)).all()}
    assert paths == {
        "U01": "TW.N.M01.U01",
        "U02": "TW.N.M01.U02",
        "U03": "TW.C.M02.U03",
        "U04": "TW.S.M03.U04",
        "U05": "TW.S.M03.U05",
        "M01": "TW.N.M01",
        "M02": "TW.C.M02",
        "M03": "TW.S.M03",
    }
```

`backend/tests/test_scope.py` 的 import 區要加 `from sqlalchemy import select`。

- [ ] **Step 2: 跑測試確認它失敗**

Run: `uv run --project backend pytest backend/tests/test_scope.py::test_org_paths_are_rebuilt_from_the_reporting_line -v`
Expected: FAIL — 全部是 `None`。

- [ ] **Step 3: 寫 rebuild_org_paths**

新檔 `backend/app/services/org.py`：

```python
"""組織樹。

manager_id 與 unit_id 是真相來源，org_path 是算出來的衍生值：
經理掛在地理節點上（unit_id），業務接在主管後面（manager_id）。

樹只有十幾個節點，任何變動就整棵重算，不做增量更新。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppUser, OrgUnit


def rebuild_org_paths(session: Session) -> None:
    """依回報線重算每個帳號的 org_path。三個欄位都空的帳號（代理別人的）維持 None。"""
    units = {unit.id: unit for unit in session.scalars(select(OrgUnit)).all()}
    users = {user.id: user for user in session.scalars(select(AppUser)).all()}
    resolved: dict[str, str | None] = {}

    def path_of(user: AppUser, seen: frozenset[str]) -> str | None:
        if user.id in resolved:
            return resolved[user.id]
        if user.id in seen:
            raise ValueError(f"組織有循環：{user.id}")
        if user.manager_id is None and user.unit_id is None:
            path = None
        elif user.manager_id is None:
            path = f"{units[user.unit_id].id}.{user.id}"
        else:
            above = path_of(users[user.manager_id], seen | {user.id})
            if above is None:
                raise ValueError(f"{user.manager_id} 不在組織裡，{user.id} 的路徑算不出來")
            path = f"{above}.{user.id}"
        resolved[user.id] = path
        return path

    for user in users.values():
        user.org_path = path_of(user, frozenset())
    session.flush()
```

- [ ] **Step 4: 加組織定義到 catalog**

`data/seed/catalog.py`，把 `USERS` 換掉並在它上面加 `ORG_UNITS`：

```python
# 組織樹的地理層。id 同時就是 ltree 路徑，只能用 ASCII
ORG_UNITS = [
    # id, name, kind, parent_id
    ("TW", "全國", "root", None),
    ("TW.N", "北區", "region", "TW"),
    ("TW.C", "中區", "region", "TW"),
    ("TW.S", "南區", "region", "TW"),
]

USERS = [
    # id, name, role, region, manager_id, unit_id
    # 經理掛在地理節點上，業務掛在經理底下；org_path 由 services/org.py 算出來
    ("U01", "林昱辰", "sales", "北區", "M01", None),
    ("U02", "王冠宇", "sales", "北區", "M01", None),
    ("U03", "黃怡君", "sales", "中區", "M02", None),
    ("U04", "吳承翰", "sales", "南區", "M03", None),
    ("U05", "李佳蓉", "sales", "南區", "M03", None),
    ("M01", "陳建宏", "manager", "北區", None, "TW.N"),
    ("M02", "張淑芬", "manager", "中區", None, "TW.C"),
    ("M03", "許文彬", "manager", "南區", None, "TW.S"),
]
```

- [ ] **Step 5: 組裝 org_unit 與新的 app_user 欄位**

`data/seed/generate.py`，把

```python
    users = [
        {"id": i, "name": n, "role": r, "region": g,
         "email": f"{i.lower()}@meddemo.tw", "password_hash": password_hash, "session_version": 1}
        for i, n, r, g in catalog.USERS
    ]
```

換成

```python
    users = [
        {"id": i, "name": n, "role": r, "region": g,
         "email": f"{i.lower()}@meddemo.tw", "password_hash": password_hash, "session_version": 1,
         "manager_id": m, "unit_id": u}
        for i, n, r, g, m, u in catalog.USERS
    ]
    org_units = [
        {"id": i, "name": n, "kind": k, "parent_id": p}
        for i, n, k, p in catalog.ORG_UNITS
    ]
```

再把 `"app_user": users,` 那一行改成兩行（`org_unit` 要排在 `app_user` 前面，外鍵才成立）：

```python
        "org_unit": org_units,
        "app_user": users,
```

- [ ] **Step 6: 灌完之後重算路徑**

`data/seed/seed.py`，在 `for name in ...: session.execute(insert(model), data[name])` 那個迴圈之後、第一個 `session.execute(text(...))` 之前，加：

```python
        # 帳號灌好之後才算得出路徑（org.rebuild_org_paths 要讀 manager_id 與 unit_id）
        rebuild_org_paths(session)
```

檔案上方加 import：`from app.services.org import rebuild_org_paths`。

同一個檔案的 `TABLES`（29 行起，註解寫「依外鍵相依的順序寫入」）要把 `org_unit` 插在 `app_user` 前面，因為 `app_user.unit_id` 指向它：

```python
# 依外鍵相依的順序寫入
TABLES = [
    ("org_unit", models.OrgUnit),
    ("app_user", models.AppUser),
    ("product", models.Product),
```

- [ ] **Step 7: 重灌資料並跑測試**

```bash
docker compose up -d --wait db redis
uv run --project backend python data/seed/seed.py
uv run --project backend pytest backend/tests/test_scope.py::test_org_paths_are_rebuilt_from_the_reporting_line -v
```
Expected: PASS

- [ ] **Step 8: 跑全部測試**

Run: `uv run --project backend pytest backend/tests -q`
Expected: 全部通過（此時權限行為還沒變）。

- [ ] **Step 9: Commit**

```bash
git add backend/app/services/org.py data/seed/catalog.py data/seed/generate.py data/seed/seed.py backend/tests/test_scope.py
git commit -m "$(cat <<'EOF'
Derive org paths from the reporting line

manager_id and unit_id are the source of truth; org_path is recomputed
for the whole tree rather than patched incrementally.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 改寫 Scope 並切換所有呼叫點（行為不變）

這一 task 的驗收標準是**現有測試全綠**。不放寬任何層級，只是把兩軸過濾換成樹。

**Files:**
- Modify: `backend/app/services/scope.py`（整檔改寫）
- Modify: `backend/app/api/customers.py:143,153`
- Modify: `backend/app/api/visits.py:84,151,156`
- Modify: `backend/app/api/asks.py:75`
- Modify: `backend/app/api/transcription.py:44`
- Modify: `backend/app/services/oa.py:88,127`
- Modify: `backend/app/services/sql_executor.py:60-68`（只改 `Scope.everything()` 的相容性，設定名稱在 Task 4 改）
- Test: `backend/tests/test_scope.py`

**Interfaces:**
- Consumes: Task 2 的 `AppUser.org_path`
- Produces:
  - `app.services.scope.ROOT = 1`、`REGION = 2`、`TEAM = 3`、`SELF = 4`
  - `app.services.scope.SHARING_LEVEL: dict[str, int]`
  - `Scope(path: str | None = None, acting_user_id: str | None = None)`
  - `Scope.everything() -> Scope`、`Scope.for_user(user: AppUser) -> Scope`
  - `Scope.prefix(level: int) -> str | None`
  - `Scope.can_see(level: int, org_path: str | None) -> bool`
  - `Scope.users_at(level: int) -> Select | None`（`None` 代表不過濾）
  - `Scope.customers_at(level: int) -> ColumnElement[bool]`
  - `Scope.visits_at(level: int) -> ColumnElement[bool]`
  - `app.services.scope.owner_path(session: Session, customer: Customer) -> str | None`

- [ ] **Step 1: 寫失敗的測試**

加到 `backend/tests/test_scope.py`：

```python
def test_a_shallower_path_covers_everyone_below_it():
    from app.services.scope import REGION, SELF, TEAM, Scope

    sales = Scope(path="TW.N.M01.U01")
    assert sales.can_see(SELF, "TW.N.M01.U01") is True
    assert sales.can_see(SELF, "TW.N.M01.U02") is False
    assert sales.can_see(TEAM, "TW.N.M01.U02") is True
    assert sales.can_see(TEAM, "TW.C.M02.U03") is False
    assert sales.can_see(REGION, "TW.N.M01") is True

    # 主管的路徑截不到 SELF 的深度，所以在 SELF 層級就已經涵蓋屬下
    manager = Scope(path="TW.N.M01")
    assert manager.prefix(SELF) == "TW.N.M01"
    assert manager.can_see(SELF, "TW.N.M01.U01") is True
    assert manager.can_see(SELF, "TW.C.M02.U03") is False

    # everything()：評測與背景排程用，不過濾
    assert Scope.everything().can_see(SELF, "TW.C.M02.U03") is True
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `uv run --project backend pytest backend/tests/test_scope.py::test_a_shallower_path_covers_everyone_below_it -v`
Expected: FAIL — `ImportError: cannot import name 'REGION'`

- [ ] **Step 3: 改寫 scope.py**

`backend/app/services/scope.py` 整檔換成：

```python
"""資料權限：誰看得到哪些資料。

組織是一棵樹（services/org.py），每個人有一條路徑，例如業務 U01 是 TW.N.M01.U01、
他的主管 M01 是 TW.N.M01。

可見範圍 = 把自己的路徑截到該種資料的共享層級深度，再看對方是不是在底下。
主管的路徑比較短、截不動，所以「主管看得到屬下」不必另外寫規則，是同一個式子的結果。

數字查詢的 SQL 是模型寫的，靠提示叫它「只查自己的」擋不住，所以過濾做在資料庫：
四個語意層 View 都用 app_in_scope() 過濾，路徑由 sql_executor 在每次查詢的交易裡設定。
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import ColumnElement, Select, cast, literal, select, true
from sqlalchemy.orm import Session

from app.models import LTREE, AppUser, Customer, Visit

# 共享層級就是路徑深度（ltree 的 nlevel 從 1 起算）
ROOT = 1     # TW
REGION = 2   # TW.N
TEAM = 3     # TW.N.M01
SELF = 4     # TW.N.M01.U01

# 每一種資料看得多遠。改這裡要同步改 sql/semantic_layer.sql 裡各個 View 宣告的深度
SHARING_LEVEL = {
    "customer_basic": ROOT,   # 客戶名稱、類型、區、等級、負責人
    "sales_figures": REGION,  # 進貨金額、毛利、帳齡
    "visit_record": TEAM,     # 拜訪紀錄與逐字稿
    "quote": SELF,            # 報價、交易條件、議價卡
    "oa_form": SELF,          # 出差單
}


@dataclass(frozen=True)
class Scope:
    path: str | None = None
    # 代理之後的實際使用者。第三方登入的帳號看的是示範業務的資料（見 api/auth.py）
    acting_user_id: str | None = None

    @classmethod
    def everything(cls) -> Scope:
        """不過濾。只給評測、測試與背景排程用，API 一律用 for_user。"""
        return cls()

    @classmethod
    def for_user(cls, user: AppUser) -> Scope:
        acting = user.acts_as or user
        return cls(path=acting.org_path, acting_user_id=acting.id)

    def prefix(self, level: int) -> str | None:
        """自己的路徑截到 level 深度。已經比 level 淺就原樣回傳——主管就是靠這個涵蓋屬下。"""
        if self.path is None:
            return None
        return ".".join(self.path.split(".")[:level])

    def can_see(self, level: int, org_path: str | None) -> bool:
        prefix = self.prefix(level)
        if prefix is None:
            return True
        if org_path is None:
            return False
        return org_path == prefix or org_path.startswith(f"{prefix}.")

    def users_at(self, level: int) -> Select | None:
        """這個層級底下有哪些人。None 代表不過濾。"""
        prefix = self.prefix(level)
        if prefix is None:
            return None
        # <@ 是「是……的子孫或自己」
        return select(AppUser.id).where(AppUser.org_path.bool_op("<@")(cast(literal(prefix), LTREE)))

    def customers_at(self, level: int) -> ColumnElement[bool]:
        """加在 where 上，依客戶負責人的位置過濾。查詢裡要有 Customer。"""
        users = self.users_at(level)
        return true() if users is None else Customer.owner_user_id.in_(users)

    def visits_at(self, level: int) -> ColumnElement[bool]:
        """加在 where 上，依做這次拜訪的業務過濾。查詢裡要有 Visit。"""
        users = self.users_at(level)
        return true() if users is None else Visit.user_id.in_(users)


def owner_path(session: Session, customer: Customer | None) -> str | None:
    """客戶負責人在組織樹上的位置。客戶不存在就回 None，呼叫端一律當作看不到。"""
    if customer is None:
        return None
    owner = session.get(AppUser, customer.owner_user_id)
    return owner.org_path if owner else None
```

- [ ] **Step 4: 切換 customers.py**

`backend/app/api/customers.py`。import 改成 `from app.services.scope import SELF, Scope, owner_path`。

`_load`（143 行附近）：

```python
        _customer_query().where(Customer.id == customer_id, Scope.for_user(user).customers_at(SELF))
```

`list_customers`（153 行附近）：

```python
    stmt = _customer_query().where(Scope.for_user(user).customers_at(SELF))
```

（Task 5 才放寬成 ROOT。）

- [ ] **Step 5: 切換 visits.py**

`backend/app/api/visits.py`。import 改成 `from app.services.scope import SELF, Scope, owner_path`。

`_load`（84 行附近）：

```python
    if visit is None or not Scope.for_user(user).can_see(
        SELF, owner_path(session, session.get(Customer, visit.customer_id))
    ):
        raise HTTPException(404, "找不到這筆拜訪紀錄")
```

`upload_audio` 的兩處（151、156 行附近）：

```python
        if not Scope.for_user(user).can_see(SELF, owner_path(session, session.get(Customer, existing.customer_id))):
            raise HTTPException(404, "找不到這家客戶")
```

```python
    customer = session.get(Customer, customer_id)
    if not Scope.for_user(user).can_see(SELF, owner_path(session, customer)):
        raise HTTPException(404, "找不到這家客戶")
```

第二處把原本的 `customer is None or` 拿掉：`owner_path()` 收到 `None` 會回 `None`，`can_see` 收到 `None` 回 `False`，結果一樣但少一個分支。

- [ ] **Step 6: 切換 asks.py 與 transcription.py**

`backend/app/api/asks.py:75`：

```python
        select(Customer.id, Customer.name).where(Scope.for_user(user).customers_at(SELF))
```

import 加 `SELF`。

`backend/app/api/transcription.py:44`：

```python
    if customer_id and not Scope.for_user(user).can_see(SELF, owner_path(session, session.get(Customer, customer_id))):
```

import 改成 `from app.services.scope import SELF, Scope, owner_path`。

- [ ] **Step 7: 切換 oa.py**

`backend/app/services/oa.py`，兩處 `.owner_id` 換成 `.acting_user_id`：

第 88 行附近：

```python
    return form.applicant_id == Scope.for_user(user).acting_user_id
```

第 127 行附近：

```python
    owner = Scope.for_user(user).acting_user_id
```

- [ ] **Step 8: 讓舊的語意層暫時還能跑**

`backend/app/services/sql_executor.py` 這一 task 先不改 SQL 設定名稱（Task 4 才改），但 `Scope` 已經沒有 `owner_id`／`region` 了。把第 64-68 行暫時改成：

```python
            # Task 4 會把語意層換成 app.scope_path；在那之前先讓既有的兩個設定收到空值（不過濾）
            conn.execute(
                text("SELECT set_config('app.scope_owner', '', true), set_config('app.scope_region', '', true)"),
            )
```

**這會讓 `test_data_queries_only_see_the_askers_customers` 暫時失敗。** 把那個測試標上 `@pytest.mark.skip(reason="Task 4 換成 app.scope_path 之後改寫")`，Task 4 再拿掉。

- [ ] **Step 9: 跑全部測試**

Run: `uv run --project backend pytest backend/tests -q`
Expected: 全部通過，只有一個 skip。特別確認這四個斷言仍然成立（M01 的 SELF 截到 `TW.N.M01`，涵蓋 U01、U02）：

```
客戶 C002（U02 的）：U01 → 404、U02 → 200、M01 → 200、M02 → 404
```

- [ ] **Step 10: Commit**

```bash
git add backend/app/services/scope.py backend/app/api/customers.py backend/app/api/visits.py backend/app/api/asks.py backend/app/api/transcription.py backend/app/services/oa.py backend/app/services/sql_executor.py backend/tests/test_scope.py
git commit -m "$(cat <<'EOF'
Filter by position in the org tree instead of owner and region

Pure refactor: every call site asks for the SELF level, which matches
today's behaviour because a manager's path is short enough to cover
their reports.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 語意層改用 ltree，銷售數字放寬到同區

**Files:**
- Modify: `backend/app/sql/semantic_layer.sql`（`app_in_scope`、四個 View、GRANT）
- Modify: `backend/app/services/sql_executor.py:64-68`
- Test: `backend/tests/test_scope.py`

**Interfaces:**
- Consumes: Task 3 的 `Scope.path`
- Produces: SQL 函式 `app_in_scope(owner_path ltree, share_depth int) -> boolean`；交易設定 `app.scope_path`

- [ ] **Step 1: 寫失敗的測試**

把 Task 3 標了 skip 的 `test_data_queries_only_see_the_askers_customers` 換成這兩個（拿掉 skip 標記）：

```python
def test_sales_figures_stop_at_the_region(engine):
    sql = "SELECT count(DISTINCT customer_id) FROM v_customer_summary"
    assert run_readonly(engine, sql).rows == [[250]]
    # U01 在 REGION 層級看得到整個北區，不只自己的 50 家
    assert run_readonly(engine, sql, Scope(path="TW.N.M01.U01")).rows == [[100]]
    assert run_readonly(engine, sql, Scope(path="TW.N.M01")).rows == [[100]]
    assert run_readonly(engine, sql, Scope(path="TW.C.M02.U03")).rows == [[50]]
    for view in ("v_monthly_sales", "v_margin_breakdown"):
        rows = run_readonly(engine, f"SELECT count(DISTINCT customer_id) FROM {view}", Scope(path="TW.N.M01.U01")).rows
        assert rows[0][0] <= 100


def test_visit_records_stop_at_the_team(engine):
    sql = "SELECT count(DISTINCT rep_id) FROM v_visit_signal"
    # 同一個團隊（U01 與 U02）看得到彼此的拜訪，看不到別區的
    assert run_readonly(engine, sql, Scope(path="TW.N.M01.U01")).rows == [[2]]
    assert run_readonly(engine, sql, Scope(path="TW.C.M02.U03")).rows == [[1]]
```

並把 `test_the_model_cannot_lift_the_filter` 裡的設定名稱從 `app.scope_owner` 換成 `app.scope_path`、`Scope(owner_id="U01")` 換成 `Scope(path="TW.N.M01.U01")`：

```python
def test_the_model_cannot_lift_the_filter(engine):
    scope = Scope(path="TW.N.M01.U01")
    with pytest.raises(QueryRejected):
        run_readonly(engine, "SELECT set_config('app.scope_path', '', true)", scope)
    # 文字檢查擋不住 Unicode 跳脫的函式名稱，要靠資料庫收回的權限擋下
    sneaky = """WITH x AS (SELECT U&"set\\005fconfig"('app.scope_path', '', true))
                SELECT (SELECT count(*) FROM x), count(DISTINCT customer_id) FROM v_customer_summary"""
    with pytest.raises(Exception, match="permission denied"):
        run_readonly(engine, sneaky, scope)
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `uv run --project backend pytest backend/tests/test_scope.py -k "sales_figures or visit_records or cannot_lift" -v`
Expected: FAIL

- [ ] **Step 3: 換掉 app_in_scope**

`backend/app/sql/semantic_layer.sql`，把現有的註解與函式（`-- 資料權限……` 到 `$$;`）換成：

```sql
-- 資料權限（backend/app/services/scope.py）：組織是一棵樹，每個人有一條路徑，
-- 例如業務 U01 是 TW.N.M01.U01、他的主管 M01 是 TW.N.M01。
-- sql_executor 在每次查詢的交易裡設定查詢者的路徑，每個 View 宣告自己的共享深度。
--
-- 可見範圍 = 把查詢者的路徑截到該 View 的深度，再問「這是不是對方路徑的祖先」（@>）。
-- least() 是關鍵：主管的路徑比較短，截不動，所以他在任何深度都涵蓋自己底下的人——
-- 「主管看得到屬下」不是另一條規則，是同一個式子的結果。
--
-- 深度：1=全國 TW，2=區 TW.N，3=團隊 TW.N.M01，4=個人 TW.N.M01.U01。
-- 沒設定就不過濾（評測、背景排程）。current_setting(..., true) 在沒設過時回 NULL，不會報錯
CREATE FUNCTION app_in_scope(owner_path ltree, share_depth int) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN COALESCE(current_setting('app.scope_path', true), '') = '' THEN true
    ELSE subpath(current_setting('app.scope_path', true)::ltree, 0,
                 least(share_depth, nlevel(current_setting('app.scope_path', true)::ltree)))
         @> owner_path
  END
$$;
```

- [ ] **Step 4: 四個 View 各自宣告深度**

`v_monthly_sales`：`FROM sales_transaction t` 底下的 join 區加一行，`WHERE` 換掉。

```sql
FROM sales_transaction t
JOIN customer c ON c.id = t.customer_id
JOIN product p ON p.sku = t.sku
JOIN app_user owner ON owner.id = c.owner_user_id
WHERE app_in_scope(owner.org_path, 2)   -- 銷售數字：同一區看得到
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11;
```

`v_customer_summary`：已經有 `JOIN app_user u ON u.id = c.owner_user_id`，只換 `WHERE`：

```sql
WHERE app_in_scope(u.org_path, 2);   -- 進貨金額與帳齡也是業績數字：同一區
```

`v_visit_signal`：已經有 `JOIN app_user u ON u.id = v.user_id`（就是做這次拜訪的業務），換 `WHERE` 的第二個條件：

```sql
WHERE v.status IN ('confirmed', 'synced')
  AND app_in_scope(u.org_path, 3);   -- 拜訪紀錄與逐字稿：直屬團隊。依做拜訪的業務，不是客戶負責人
```

`v_margin_breakdown`：

```sql
FROM sales_transaction t
JOIN customer c ON c.id = t.customer_id
JOIN product p ON p.sku = t.sku
JOIN app_user owner ON owner.id = c.owner_user_id
WHERE app_in_scope(owner.org_path, 2)   -- 毛利結構：同一區
GROUP BY 1, 2, 3, 4, 5, 6, 7;
```

**`org_path` 一律只出現在 `WHERE`，不進 `SELECT`**：`describe_views()` 餵給模型的欄位清單裡看不到它，過濾對模型維持隱形。

- [ ] **Step 5: 改 GRANT 的簽章**

`backend/app/sql/semantic_layer.sql` 最下面：

```sql
GRANT EXECUTE ON FUNCTION app_in_scope(ltree, int) TO semantic_reader;
```

（`REVOKE EXECUTE ON FUNCTION pg_catalog.set_config` 那兩行完全不動——設定改名不影響那道防線。）

- [ ] **Step 6: 改 sql_executor 塞的設定**

`backend/app/services/sql_executor.py`，把 Task 3 留下的暫時版本換成：

```python
            # 範圍在切成唯讀角色之前設好；第三個參數 true 代表只在這個交易有效，交易結束就還原
            conn.execute(
                text("SELECT set_config('app.scope_path', :path, true)"),
                {"path": scope.path or ""},
            )
```

並更新上面 `SETTING_FUNCTIONS` 的註解，把 `app.scope_owner／app.scope_region` 改成 `app.scope_path`。

- [ ] **Step 7: 重灌資料並跑測試**

```bash
uv run --project backend python data/seed/seed.py
uv run --project backend pytest backend/tests/test_scope.py -v
```
Expected: PASS

- [ ] **Step 8: 跑全部測試**

Run: `uv run --project backend pytest backend/tests -q`
Expected: 全部通過。`test_asks.py`、`test_eval_*` 若有斷言依賴「只看得到自己 50 家」的數字，要跟著改成同區的數字——**改測試前先確認新數字是對的，不要為了讓測試綠而改斷言**。

- [ ] **Step 9: Commit**

```bash
git add backend/app/sql/semantic_layer.sql backend/app/services/sql_executor.py backend/tests/test_scope.py
git commit -m "$(cat <<'EOF'
Filter the semantic layer by org path and share figures region-wide

Each view declares its own sharing depth. org_path stays out of every
SELECT list, so the filter remains invisible to the model writing SQL.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 客戶清單放寬到全國，動作留在 SELF

**Files:**
- Modify: `backend/app/api/customers.py`（`_load` 加層級參數、`list_customers`、四支動作端點）
- Test: `backend/tests/test_scope.py`

**Interfaces:**
- Consumes: Task 3 的 `Scope.customers_at()`、`ROOT`、`SELF`
- Produces: `customers._load(session, customer_id, user, level)`（多一個必填的 `level` 參數）

- [ ] **Step 1: 寫失敗的測試**

把現有的 `test_sales_see_their_own_customers_and_managers_their_region` 換成：

```python
def test_everyone_sees_every_customer_but_only_acts_on_their_own(client, auth):
    assert client.get("/api/customers").status_code == 401
    # 客戶清單是全國共享的：名稱、類型、區、等級、負責人
    assert len(client.get("/api/customers", headers=auth("U01")).json()) == 250
    assert len(client.get("/api/customers", headers=auth("M01")).json()) == 250
    assert client.get("/api/customers/C002", headers=auth("U03")).status_code == 200

    # 但檔案、議價卡、報價還是只有負責人與他的主管看得到。C002 是王冠宇（U02）的
    assert client.get("/api/customers/C002/profile", headers=auth("U01")).status_code == 404
    assert client.get("/api/customers/C002/profile", headers=auth("U02")).status_code == 200
    assert client.get("/api/customers/C002/profile", headers=auth("M01")).status_code == 200
    assert client.get("/api/customers/C002/negotiation", headers=auth("M02")).status_code == 404
```

`test_recording_a_visit_for_someone_elses_customer_is_refused` **保留不動**——它現在表達的正是「看得到不等於能記拜訪」。

再加一個：

```python
def test_quoting_for_someone_elses_customer_is_refused(client, auth):
    # QuoteInput 是 {"items": [QuoteLineInput]}，QuoteLineInput 是 {"sku", "qty"}（customers.py:202-208）
    body = {"items": [{"sku": "RX-TAM02", "qty": 10}]}
    assert client.post("/api/customers/C002/quotes", json=body, headers=auth("U01")).status_code == 404
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `uv run --project backend pytest backend/tests/test_scope.py -k "everyone_sees or quoting_for" -v`
Expected: FAIL — 清單回 50 不是 250。

- [ ] **Step 3: 讓 _load 收層級**

`backend/app/api/customers.py`，`_load` 改成：

```python
def _load(session: Session, customer_id: str, user: AppUser, level: int) -> tuple[Customer, CustomerItem]:
    """看不到的客戶跟不存在一樣回 404，不透露這個編號是別人的客戶。

    level 決定這次要求的是哪一種資料：客戶本身是全國共享（ROOT），
    檔案、議價卡與報價是負責人自己的（SELF）。
    """
    row = session.execute(
        _customer_query().where(Customer.id == customer_id, Scope.for_user(user).customers_at(level))
    ).one_or_none()
    if row is None:
        raise HTTPException(404, "找不到這家客戶")
    return session.get(Customer, customer_id), CustomerItem(**row._mapping)
```

import 加 `ROOT`：`from app.services.scope import ROOT, SELF, Scope, owner_path`。

- [ ] **Step 4: 每支端點指定層級**

同一個檔案裡：

```python
    stmt = _customer_query().where(Scope.for_user(user).customers_at(ROOT))   # list_customers
```

```python
def get_customer(session: SessionDep, customer_id: str, user: CurrentUser):
    return _load(session, customer_id, user, ROOT)[1]
```

`get_profile`、`get_negotiation_card`、`quote_items`、`create_quote` 四支的 `_load(...)` 一律補上 `SELF`。

`get_profile` 是 SELF 不是 ROOT：它回的是近 90 天進貨金額、帳齡、未結報價、承諾與客訴，那是負責人自己的經營資料，不是「這家店叫什麼名字」。

- [ ] **Step 5: 跑測試**

Run: `uv run --project backend pytest backend/tests/test_scope.py -v`
Expected: PASS

- [ ] **Step 6: 跑全部測試**

Run: `uv run --project backend pytest backend/tests -q`
Expected: 全部通過。`test_api.py`、`test_customer_profile.py` 若斷言了客戶清單的長度，改成 250。

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/customers.py backend/tests/test_scope.py
git commit -m "$(cat <<'EOF'
Share the customer list company-wide, keep actions with the owner

Seeing a customer no longer implies acting on it: the profile, the
negotiation card and quoting stay at the SELF level.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 拜訪紀錄同團隊可讀，修改仍只限本人

**Files:**
- Modify: `backend/app/api/visits.py`（`_load` 分讀寫）
- Test: `backend/tests/test_scope.py`

**Interfaces:**
- Consumes: Task 3 的 `Scope.can_see()`、`TEAM`、`SELF`
- Produces: `visits._load(session, visit_id, user, *, lock=False, write=False)`

- [ ] **Step 1: 寫失敗的測試**

加到 `backend/tests/test_scope.py`。假資料裡每一筆拜訪的 `status` 都是 `synced`（`data/seed/generate.py:504`），所以直接撈一筆 U02 的現成紀錄，不用自己建：

```python
def test_teammates_can_read_a_visit_but_only_the_owner_can_change_it(client, auth, engine):
    with Session(engine) as session:
        visit = session.scalars(
            select(Visit).where(Visit.user_id == "U02", Visit.status.in_(("confirmed", "synced")))
        ).first()
        visit_id = visit.id

    # U01 與 U02 同一個團隊（都在 M01 底下）
    assert client.get(f"/api/visits/{visit_id}", headers=auth("U01")).status_code == 200
    assert client.get(f"/api/visits/{visit_id}", headers=auth("M01")).status_code == 200
    # U03 在中區，看不到
    assert client.get(f"/api/visits/{visit_id}", headers=auth("U03")).status_code == 404
    # 看得到不等於能改：同團隊的拜訪唯讀
    assert client.delete(f"/api/visits/{visit_id}", headers=auth("U01")).status_code == 404
```

import 區要有 `from app.models import AppUser, AskRecord, Visit`。

- [ ] **Step 2: 跑測試確認它失敗**

Run: `uv run --project backend pytest backend/tests/test_scope.py::test_teammates_can_read_a_visit_but_only_the_owner_can_change_it -v`
Expected: FAIL — U01 讀 U02 的拜訪目前是 404。

- [ ] **Step 3: 讓 _load 分讀寫**

`backend/app/api/visits.py`：

```python
def _load(session: Session, visit_id: str, user: AppUser, *, lock: bool = False, write: bool = False) -> Visit:
    """看不到的拜訪跟不存在一樣回 404。

    讀是團隊層級（同一個主管底下的業務互相看得到，主管看得到全部屬下的）；
    改、確認、刪除只限這筆拜訪本人，別人的一律唯讀，同樣回 404 不回 403。
    """
    visit = session.get(Visit, visit_id, with_for_update=lock)
    if visit is None:
        raise HTTPException(404, "找不到這筆拜訪紀錄")
    scope = Scope.for_user(user)
    rep = session.get(AppUser, visit.user_id)
    if not scope.can_see(TEAM, rep.org_path if rep else None):
        raise HTTPException(404, "找不到這筆拜訪紀錄")
    if write and not scope.can_see(SELF, rep.org_path if rep else None):
        raise HTTPException(404, "找不到這筆拜訪紀錄")
    return visit
```

import 改成 `from app.services.scope import SELF, TEAM, Scope, owner_path`，並確認 `AppUser` 有在 `from app.models import ...` 裡。

過濾依據從「客戶的負責人」換成「做這次拜訪的業務」（`visit.user_id`），跟 `v_visit_signal` 一致。

- [ ] **Step 4: 五支寫入端點加上 write=True**

同一個檔案，`update_fields`、`confirm`、`reprocess`、`retry_writeback`、`discard` 五支的 `_load(...)` 都加 `write=True`：

```python
    visit = _load(session, visit_id, user, lock=True, write=True)   # update_fields、confirm
```

```python
    visit = _load(session, visit_id, user, write=True)              # reprocess、retry_writeback、discard
```

`get_visit` 與 `submit_transcript` 之外的都要改。`submit_transcript` 是補逐字稿，也算修改，**也要加 `write=True`**。

`upload_audio` 兩處不經過 `_load`，維持 Task 3 的 `can_see(SELF, owner_path(...))`，不動。

- [ ] **Step 5: 跑測試**

Run: `uv run --project backend pytest backend/tests/test_scope.py -v`
Expected: PASS

- [ ] **Step 6: 跑全部測試**

Run: `uv run --project backend pytest backend/tests -q`
Expected: 全部通過。

- [ ] **Step 7: 更新 README**

`README.md` 的「資料權限：只看得到自己的客戶」那一節（125-133 行附近）整段改寫：標題改成「資料權限：組織樹與共享層級」，說明四個層級與那張資料對照表，並保留「數字查詢的過濾做在資料庫」與 `set_config` 那兩段（它們仍然成立，只是設定名稱換成 `app.scope_path`）。第 107 行「主管端 `/manager` 只有 `role = manager` 的帳號進得去」不用改。

- [ ] **Step 8: Commit**

```bash
git add backend/app/api/visits.py backend/tests/test_scope.py README.md
git commit -m "$(cat <<'EOF'
Let a team read each other's visits, keep edits with the rep

Reads use the TEAM level and key off the rep who made the visit, matching
v_visit_signal. Every mutating endpoint stays at SELF.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 完工檢查

- [ ] `uv run --project backend pytest backend/tests` 全綠
- [ ] `uv run --project backend python data/seed/seed.py` 能從零重建
- [ ] `cd frontend && npm run build` 過（前端沒改，但型別檢查要確認沒被 API 回應的變化影響）
- [ ] `git log --oneline main..` 有六個 commit，spec 在最前面

## 一個刻意保留的不一致

同一組數字，從兩道門進來的層級不同：

- **問答（語意層）** 走 `v_customer_summary`，REGION——U01 問「北區哪幾家在衰退」會拿到 U02 客戶的數字。
- **客戶檔案頁**（`GET /api/customers/{id}/profile`）SELF——U01 直接打開 U02 客戶的檔案是 404。

spec 的層級表沒有把複合端點寫進去，這是實作時的裁決。理由是**複合回應取其內容中最嚴格的層級**：`CustomerProfile` 裡有 `open_quotes`（報價，SELF）、`commitments`、`complaints`，不只是業績數字，整頁給出去等於把 SELF 的東西一起給了。要嘛整頁降到 SELF，要嘛把回應拆成分級的區塊——後者要改 Pydantic 模型與前端，不在這次範圍。

選整頁 SELF 的附帶好處：現有測試裡 `/profile` 與 `/negotiation` 的四個斷言完全不用改。

想改成「檔案頁也開到同區、但報價區塊對非負責人隱藏」的話，那是 `CustomerProfile.open_quotes` 改成 `list[OpenQuote] | None` 加前端一段說明，約半個 task 的量，可以之後再加。

## 已知不在範圍內

- **沒有新畫面。** TEAM 層級讓業務看得到同事的拜訪，但沒有「團隊拜訪清單」UI，這個能力只在直接開網址時看得到。
- **沒有組織維護介面。** 改組織要改 `catalog.py` 並重灌。
- **其他權限缺口不補。** `api/mock_systems.py` 與 `api/products.py` 沒有認證、`EXTERNAL_ACCOUNT_ACTS_AS` 讓第三方登入者看得到 U01 的真實資料——已知，另一條線。
