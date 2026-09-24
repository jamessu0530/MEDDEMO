# 組織樹權限模型

2026-09-24

把現在的「兩個扁平角色 + owner／region 兩軸過濾」換成一棵組織樹，並讓每一種資料有自己的共享層級。

## 為什麼改

現在的權限是兩條硬編碼規則：業務看 `owner_user_id` 等於自己的客戶，主管看 `region` 等於自己轄區的客戶。這表達不了兩件實際存在的事：

- **組織圖。** 經理有直屬業務，同一個經理底下的人應該共享部分資訊。現在沒有任何回報線，`app_user` 連 `manager_id` 都沒有，主管是靠「同轄區」比對出來的。
- **共享的粒度。** 「看得到這家客戶」和「看得到這家客戶的逐字稿」是兩件事，現在綁在一起。業務之間完全看不到彼此的客戶，連客戶叫什麼名字都看不到，這比實務嚴格。

## 設計決定

四個已定案的決定，後面的設計都從這裡推出來：

1. **一棵組織樹**，不是組織／地理兩個獨立軸。縣市維持客戶屬性，不是組織層級。
2. **不同資料有不同共享層級**，不是「看得到客戶就看得到他的全部資料」。
3. **層級表寫死在程式碼**，不做成可設定的資料表。
4. **用 Postgres `ltree`** 表示樹與祖先關係。

第 4 點有已知取捨：這棵樹只有 12 個節點，GiST 索引沒有效益，換來的是多一個擴充與「產生 SQL 的模型可能不熟 `@>` 語法」的風險。取捨在知情下做出，緩解措施見〈對模型的影響〉。成本比初估低：`reset_schema` 沒有 migration，整個 schema 砍掉重建，加擴充就是在 `CREATE EXTENSION IF NOT EXISTS vector` 旁邊多一行。

## 資料模型

不另外開「團隊」節點——**經理本人就是團隊節點**。這樣主管的路徑天然是屬下路徑的前綴，後面的層級機制才成立。

### `org_unit`（新表，只放地理層，4 列）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | `str` PK | `TW`、`TW.N`、`TW.C`、`TW.S` |
| `name` | `str` | 全國／北區／中區／南區，給畫面用 |
| `kind` | `str` | `root` 或 `region`，`one_of` 約束 |
| `parent_id` | `str?` FK → `org_unit.id` | 根節點為 NULL |
| `path` | `ltree` unique | 與 `id` 同值，型別不同 |

### `app_user`（加三個欄位）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `manager_id` | `str?` FK → `app_user.id` | 直屬主管；經理為 NULL |
| `unit_id` | `str?` FK → `org_unit.id` | 沒有主管的人掛在哪個地理節點 |
| `org_path` | `ltree?` | **衍生欄位**，見下 |

`org_path` 的計算規則：

```
org_path = (manager_id 有值 ? 該主管的 org_path : unit.path) || id
```

`CheckConstraint` 允許兩種形態，二擇一：

- **在組織裡**：`manager_id` 與 `unit_id` 恰有一個有值，`org_path` 有值。
- **不在組織裡**：`manager_id`、`unit_id`、`org_path` 皆為 NULL，且 `acts_as_user_id` 有值。這是自建與第三方登入的帳號（見〈自建帳號與第三方登入〉）。

灌出來的樹：

```
TW                      全國
├─ TW.N                 北區
│  └─ TW.N.M01          陳建宏（經理，unit_id=TW.N）
│     ├─ TW.N.M01.U01   林昱辰（manager_id=M01）
│     └─ TW.N.M01.U02   王冠宇（manager_id=M01）
├─ TW.C ── TW.C.M02 ── TW.C.M02.U03
└─ TW.S ── TW.S.M03 ── TW.S.M03.U04
                    └─ TW.S.M03.U05
```

### 三個模型層面的約束

**ltree 標籤只能是 ASCII。** 用代號不用中文（`TW.N` 不是 `TW.北區`），中文名字放 `name`。使用者 id（`U01`、`M01`）本來就是 ASCII，可直接當標籤。

**`manager_id` 是真相來源，`org_path` 是衍生值。** 不做增量更新：組織有任何變動就整棵重算（12 個節點，成本可忽略）。重算函式 `rebuild_org_paths(session)` 放在 `services/org.py`，由灌資料程式與未來的組織維護流程呼叫。

**`role` 欄位保留不動。** `sales` / `manager` 兩值與 `manager_only` 依賴它，它管的是「能不能進主管端頁面」這種動作權限，跟樹管的「看得到哪些列」是不同的事，不合併。

## 共享層級

四個層級就是路徑深度（`ltree` 的 `nlevel` 是 1-based）：

```python
ROOT   = 1   # TW
REGION = 2   # TW.N
TEAM   = 3   # TW.N.M01
SELF   = 4   # TW.N.M01.U01
```

可見範圍 = **把自己的路徑截到該層級深度，再問「這是不是對方路徑的祖先」**。

```sql
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

`least(...)` 是整個設計的樞紐。M01 的路徑只有三層，要截到深度 4 也截不動，還是 `TW.N.M01`，於是他在 SELF 層級照樣涵蓋 U01 與 U02。**「主管看得到屬下」不是另一條規則，是同一個式子的自然結果**——沒有第二套邏輯要維護，也沒有兩套規則打架的可能。

驗算：

| 誰 | 層級 | 截到 | 看得到 |
|---|---|---|---|
| U01 | SELF (4) | `TW.N.M01.U01` | 只有自己 |
| U01 | TEAM (3) | `TW.N.M01` | U01、U02 |
| U01 | REGION (2) | `TW.N` | 北區全部 |
| U01 | ROOT (1) | `TW` | 全國 |
| M01 | SELF (4) | `TW.N.M01` | 自己 + U01、U02 |
| M01 | ROOT (1) | `TW` | 全國 |

沒設 `app.scope_path` 就不過濾，保留 `Scope.everything()` 給評測、測試與背景排程用。

## 讀取層級表

```python
# services/scope.py
SHARING_LEVEL = {
    "customer_basic":  ROOT,    # 客戶名稱、類型、區、縣市、等級、負責人
    "sales_figures":   REGION,  # 進貨金額、毛利、帳齡
    "visit_record":    TEAM,    # 拜訪紀錄與逐字稿
    "quote":           SELF,    # 報價、交易條件、議價卡
    "oa_form":         SELF,    # 出差單
}
```

對應到實際的過濾點：

| 資料 | 層級 | 依據誰的路徑 |
|---|---|---|
| ORM 客戶清單、基本資料 | ROOT | 客戶的 `owner_user_id` |
| `v_monthly_sales`、`v_margin_breakdown` | REGION | 客戶的 `owner_user_id` |
| `v_customer_summary` | REGION | 客戶的 `owner_user_id` |
| `v_visit_signal`、ORM 拜訪紀錄 | TEAM | **拜訪的業務 `visit.user_id`** |
| 報價、議價卡、`quote_items` | SELF | 客戶的 `owner_user_id` |
| OA 出差單 | SELF | 申請人 `applicant_id` |

兩個判斷要記錄理由：

**`v_customer_summary` 是 REGION 不是 ROOT。** 名字像客戶清單，但欄位是近 90 天進貨金額、平均單價、帳齡——那是業績數字。全國可見的只有客戶的名稱、類型、等級這一類靜態屬性，走 ORM 那條路。

**`v_visit_signal` 改依 `v.user_id` 過濾，現在是依 `c.owner_user_id`。** 今天兩者恆等（記別人客戶的拜訪會被擋），但「這筆拜訪是誰的」語意上就是那位業務。改成前者，未來出現代班或共同拜訪才不用重寫。

## 讀與寫要分開

這是把客戶可見範圍放寬到 ROOT 帶出的必要條件：**看得到一家客戶，不代表能對它做事。**

現在 `Scope.allows()` 同時被讀取與寫入路徑使用。放寬之後若不分開，任何人都能對任何客戶記拜訪、開報價，`test_recording_a_visit_for_someone_elses_customer_is_refused` 會失敗——而那個測試表達的規則是對的，要保留。

`Scope` 因此提供兩組方法：

```python
@dataclass(frozen=True)
class Scope:
    path: str | None = None          # 使用者的 org_path
    acting_user_id: str | None = None  # 代理後的實際使用者 id（OA 與「排入路線」用）

    @classmethod
    def everything(cls) -> Scope: ...
    @classmethod
    def for_user(cls, user: AppUser) -> Scope: ...

    # 讀：某個層級底下看不看得到
    def visible_at(self, level: int, owner_path_column) -> ColumnElement[bool]: ...
    def can_see(self, level: int, owner_path: str | None) -> bool: ...

    # 寫：這是不是我自己的（或我屬下的）
    def owns(self, customer: Customer) -> bool: ...
    def owns_filter(self) -> ColumnElement[bool]: ...
```

`owns()` 就是 SELF 層級（`visible_at(SELF, ...)`），另外命名是因為呼叫點讀起來要看得出這是動作授權而不是可見性。

### 主管的動作範圍會收窄

一個要記錄的行為變更：主管的 `owns()` 從「整個轄區」變成「直屬屬下」。今天 `Scope.allows()` 對主管回傳 `customer.region == user.region`，所以 M01 可以對北區任何客戶記拜訪；改完之後 M01 的 SELF 截到 `TW.N.M01`，只涵蓋 U01 與 U02 名下的客戶。

以目前的假資料兩者結果相同（北區只有 M01 一位主管、只有 U01 U02 兩位業務），所以沒有測試會因此改變結果。但語意上收窄了，而且這是刻意的：[api/manager.py:44](../../../backend/app/api/manager.py#L44) 註明「同一區有兩位主管時，大家都看得到」——那個放寬是為了風險通報這種**通知**情境，不該延伸到「能對客戶動手」。通知與簽核繼續用 `region` 過濾，不走樹。

每個呼叫點的歸屬：

| 位置 | 現在 | 改成 |
|---|---|---|
| `api/customers.py:153` `list_customers` | `customer_filter()` | `visible_at(ROOT)` |
| `api/customers.py:143` `_load` | `customer_filter()` | `visible_at(ROOT)` |
| `api/customers.py` `get_negotiation_card`、`quote_items`、`create_quote` | 經 `_load` | `owns()`，不是自己的回 403 |
| `api/visits.py:84` `_load`（讀） | `allows(customer)` | `can_see(TEAM, visit_rep_path)` |
| `api/visits.py` `update_fields`、`confirm`、`discard`、`reprocess`、`retry_writeback` | 經 `_load` | 再加 `visit.user_id == acting_user_id`，別人的拜訪唯讀 |
| `api/visits.py:151,156` `upload_audio` | `allows(customer)` | `owns(customer)` |
| `api/transcription.py:44` | `allows(customer)` | `owns(customer)` |
| `api/asks.py:75` `mentioned_customers` | `customer_filter()` | `owns_filter()` |
| `services/oa.py:88,127` | `.owner_id` | `.acting_user_id` |
| `services/sql_executor.py:60` | `Scope.everything()` | 不變 |

`api/asks.py` 維持 SELF 的理由：答案底下列出的客戶附帶「排入今天的路線」，那是動作，只能排自己的。這也是 `test_customers_named_in_an_answer_are_limited_to_the_asker` 表達的規則。

## 語意層

`sql_executor.run_readonly` 改成只塞一個設定：

```python
conn.execute(
    text("SELECT set_config('app.scope_path', :path, true)"),
    {"path": scope.path or ""},
)
```

四個 View 各自宣告深度常數呼叫 `app_in_scope(owner_path, depth)`。`v_customer_summary` 與 `v_visit_signal` 已經 `JOIN app_user`，直接取 `u.org_path`；`v_monthly_sales` 與 `v_margin_breakdown` 要新增對 `app_user` 的 join（12 列，成本可忽略）。

`GRANT EXECUTE ON FUNCTION app_in_scope(text, text)` 的簽章改成 `(ltree, int)`。

### 保留不動的兩道防線

**`org_path` 只出現在 `WHERE`，不進 View 的 `SELECT`。** `describe_views()` 餵給模型的欄位清單裡看不到它，過濾對模型維持隱形，跟現在一樣。

**`semantic_reader` 依舊沒有 `set_config` 權限。** 換成 ltree 之後這道防線原封不動：設定名稱從 `app.scope_owner`／`app.scope_region` 換成 `app.scope_path`，但「唯讀角色改不了它」的保證來自 `REVOKE EXECUTE ON FUNCTION pg_catalog.set_config`，與設定叫什麼無關。`sql_executor` 的 `SETTING_FUNCTIONS` 文字檢查也不變。

### 對模型的影響

ltree 的 `@>` 只出現在 View 定義的 `WHERE` 裡，模型看不到也不需要寫它——模型寫的是對 View 的查詢，不碰過濾邏輯。因此「模型不熟 ltree 語法」的風險實際上落在零：它不會需要產生 ltree 語法。`semantic_layer.sql` 裡仍要把 `@>` 的語意寫成註解，供人閱讀與維護。

## 自建帳號與第三方登入

`EXTERNAL_ACCOUNT_ACTS_AS = "U01"` 與 `acts_as_user_id` 的行為維持不變：這類帳號自己的 `org_path` 為 NULL、`manager_id` 與 `unit_id` 皆為 NULL（`CheckConstraint` 要允許「兩者皆空且 `acts_as_user_id` 有值」）。

`Scope.for_user()` 解析代理。`AppUser` 目前只有 `acts_as_user_id` 欄位、沒有對應的 relationship，所以要嘛在 `models.py` 補一個 self-referential relationship，要嘛讓 `for_user` 收 `Session` 自己查。**選補 relationship**：`for_user` 現有的呼叫點都沒有 `Session`，改簽章會波及十處以上。

```python
# models.py
acts_as: Mapped[AppUser | None] = relationship(remote_side=[id], foreign_keys=[acts_as_user_id])

# services/scope.py
@classmethod
def for_user(cls, user: AppUser) -> Scope:
    acting = user.acts_as or user
    return cls(path=acting.org_path, acting_user_id=acting.id)
```

這樣第三方登入的帳號取得 U01 的完整組織位置，包含 U01 在樹上的層級行為，行為與現在一致。

## 灌假資料

`data/seed/catalog.py` 加組織樹定義：

```python
ORG_UNITS = [
    ("TW",   "全國", "root",   None),
    ("TW.N", "北區", "region", "TW"),
    ("TW.C", "中區", "region", "TW"),
    ("TW.S", "南區", "region", "TW"),
]

# id, name, role, region, manager_id, unit_id
USERS = [
    ("U01", "林昱辰", "sales",   "北區", "M01", None),
    ("U02", "王冠宇", "sales",   "北區", "M01", None),
    ("U03", "黃怡君", "sales",   "中區", "M02", None),
    ("U04", "吳承翰", "sales",   "南區", "M03", None),
    ("U05", "李佳蓉", "sales",   "南區", "M03", None),
    ("M01", "陳建宏", "manager", "北區", None,  "TW.N"),
    ("M02", "張淑芬", "manager", "中區", None,  "TW.C"),
    ("M03", "許文彬", "manager", "南區", None,  "TW.S"),
]
```

`region` 欄位保留：`manager_only` 之外，`api/manager.py` 的風險通報與 `api/escalations.py` 的轉問題都用轄區過濾，那是獨立於樹的既有行為，這次不動。

灌完資料後呼叫 `rebuild_org_paths(session)` 算出 `org_path`。

`data/seed/generate.py` 的 users 組裝要跟著 `USERS` 的欄位變化更新。

## 測試

`backend/tests/test_scope.py` 現有五個測試全部保留並改寫成新模型，另外新增：

| 測試 | 驗什麼 |
|---|---|
| `test_org_paths_are_rebuilt_from_the_reporting_line` | `rebuild_org_paths` 對八個帳號算出正確路徑 |
| `test_everyone_sees_every_customer_in_the_list` | 客戶清單 ROOT：U01 看得到南區的客戶 |
| `test_sales_figures_stop_at_the_region` | U01 查 `v_monthly_sales` 看不到中區數字 |
| `test_teammates_share_visit_records` | U01 看得到 U02 的拜訪，看不到 U03 的 |
| `test_quotes_stay_with_their_owner` | U01 看不到 U02 的報價 |
| `test_a_manager_sees_everything_their_reports_own` | M01 在 SELF 層級看得到 U01 與 U02 的報價 |
| `test_recording_a_visit_for_someone_elses_customer_is_refused` | **保留**：看得到不等於能記拜訪 |
| `test_editing_someone_elses_visit_is_refused` | 同團隊的拜訪唯讀 |
| `test_the_model_cannot_lift_the_filter` | **保留**：改設定名為 `app.scope_path`，兩種繞法都要再試一次 |

## 不在這次範圍

**沒有新的畫面。** TEAM 層級讓業務看得到同事的拜訪紀錄，但目前沒有「團隊拜訪清單」這種 UI，這個能力只在直接開網址時看得到。要不要加畫面是獨立決定，不綁在這次的模型改動裡。

**沒有組織維護介面。** 組織在灌假資料時建好，改組織要改 `catalog.py` 並重建。第 3 點決定（層級表寫死）的同一個理由適用於此。

**不補其他權限缺口。** `api/mock_systems.py` 與 `api/products.py` 完全沒有認證、`EXTERNAL_ACCOUNT_ACTS_AS` 讓任何第三方登入者看得到 U01 的真實資料——這三件事已知，但屬於另一條線，不混進這次。

## 部署

`backend/app/db.py` 的 `reset_schema` 在 `CREATE EXTENSION IF NOT EXISTS vector` 旁加一行 `CREATE EXTENSION IF NOT EXISTS ltree`。`ltree` 在 Postgres 13 之後是 trusted extension，資料庫擁有者不需 superuser 即可建立。

沒有 migration：schema 砍掉重建。`db.schema_version()` 的指紋涵蓋 `models.py`、`semantic_layer.sql`、`generate.py`、`catalog.py`，這次四個檔案都會改，部署時會自動判定要重建。
