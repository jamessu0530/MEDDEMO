# 頻道第一階段：能聊天 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 地點、頻道、訊息、未讀與權限做好，業務、主管、IT 能在全國、整區、小組、地點頻道與客戶討論串裡發言、輪詢新訊息。

**Architecture:** 新表 `place`（地點）、`channel`、`channel_message`、`channel_read`，客戶多一個 `place_id`。
頻道不存路徑，只記屬於誰；`services/channels.py` 每次從組織樹現算路徑，看不看得到一律用
`Scope.can_see(共享層級, 頻道路徑)`。API 在 `api/channels.py`，前端新增頻道列表、頻道頁、客戶討論串清單，
未讀數沿用「主管回覆」的輪詢做法。

**Tech Stack:** FastAPI、SQLAlchemy 2（Postgres 16、ltree）、pytest；React 19、react-router、Tailwind、vitest。

**Spec:** [docs/superpowers/specs/2026-09-28-channels-design.md](../specs/2026-09-28-channels-design.md)（這份計畫只做「分階段」的第 1 階段）

## Global Constraints

- 頻道種類與共享層級：`national` 全國 `ROOT`；`region` 整區、`place` 地點、`customer` 客戶討論串 `REGION`；`team` 小組 `TEAM`。
- 客戶的負責人與他的主管一定看得到自己客戶的討論串（多一條 `can_see(SELF, 負責人路徑)`）。
- 封存的小組頻道（主管已經不是在職主管）唯讀、只有 IT 看得到；發言回 409。
- 看不到的頻道，API 一律 404。
- 訊息最多 2,000 字；第一版不能改、不能刪。
- 地點 17 個：台北市十二個行政區，加上新北市、台中市、彰化縣、高雄市、台南市；台北市的客戶對不到行政區時灌資料直接失敗並點名。
- 南區新增主管 M04，李佳蓉 U05 移到他底下；北區不動。
- 所有使用者看得到的文字用繁體中文；程式註解照現有檔案的密度與語氣（中文、說明「為什麼」）。
- 手機版面，`max-w-md`。

## 本機環境

- 資料庫與 Redis：`docker compose up -d --wait db redis`
- 後端測試：`uv run --project backend pytest backend/tests -q`（會自己建 `meddemo_test` 並灌資料）
- 前端：在 `frontend/` 裡 `npm run typecheck`、`npm run lint`、`npm test`、`npm run build`
- 改了 `models.py`、`catalog.py`、`generate.py` 之後，開發用的資料庫要重灌：`uv run --project backend python data/seed/seed.py`

## 檔案結構

| 檔案 | 動作 | 負責 |
|---|---|---|
| `backend/app/models.py` | 改 | `Place`、`Customer.place_id`、`Channel`、`ChannelMessage`、`ChannelRead` |
| `backend/app/services/scope.py` | 改 | `SHARING_LEVEL` 加三個頻道層級 |
| `backend/app/services/channels.py` | 新增 | 頻道的路徑、名稱、權限、訊息、未讀 |
| `backend/app/services/org_admin.py` | 改 | 組織異動後補小組頻道 |
| `backend/app/api/channels.py` | 新增 | 頻道 API |
| `backend/app/main.py` | 改 | 掛上 router |
| `backend/app/api/auth.py` | 改 | 刪帳號的說明補上頻道訊息 |
| `data/seed/catalog.py` | 改 | `PLACES`、台北市對照表、M04、`CONVERSATIONS` |
| `data/seed/generate.py` | 改 | 客戶的地點、`place` 資料 |
| `data/seed/seed.py` | 改 | 寫入 `place`、建頻道、放預先寫好的對話 |
| `backend/tests/conftest.py` | 改 | `tx` fixture 從 `test_admin.py` 搬過來共用 |
| `backend/tests/test_channels.py` | 新增 | 頻道的權限、訊息、未讀、討論串、組織異動 |
| `backend/tests/test_seed.py`、`test_admin.py`、`test_scope.py`、`test_auth.py` | 改 | 地點、M04、刪帳號 |
| `README.md` | 改 | 帳號數 |
| `frontend/src/api/channels.ts` | 新增 | API 呼叫與型別 |
| `frontend/src/lib/channels.ts`（＋`.test.ts`） | 新增 | 列表分組、訊息合併 |
| `frontend/src/lib/count-poller.ts` | 新增 | 每分鐘問一次數字的共用輪詢（主管回覆與頻道未讀共用） |
| `frontend/src/lib/manager-replies.ts` | 改 | 改用 `CountPoller` |
| `frontend/src/lib/channel-unread.ts` | 新增 | 頻道紅點數字 |
| `frontend/src/components/channels-link.tsx` | 新增 | 主管端、組織管理頁標頭的頻道按鈕；紅點 `UnreadDot` |
| `frontend/src/components/channel-row.tsx` | 新增 | 頻道列表與客戶討論串清單共用的一列 |
| `frontend/src/components/bottom-nav.tsx` | 改 | 第五個分頁「頻道」 |
| `frontend/src/pages/channels.tsx` | 新增 | 頻道列表 |
| `frontend/src/pages/channel.tsx` | 新增 | 頻道頁（對話） |
| `frontend/src/pages/channel-threads.tsx` | 新增 | 地點頻道底下的客戶討論串 |
| `frontend/src/pages/customer.tsx`、`manager.tsx`、`admin.tsx`、`privacy.tsx`、`App.tsx` | 改 | 入口、路由、隱私權說明 |

---

### Task 1: 地點與客戶的地點欄位

**Files:**
- Modify: `backend/app/models.py`（`Customer` 前面加 `Place`；`Customer` 加 `place_id`）
- Modify: `data/seed/catalog.py`（`REGION_CITIES` 後面加 `PLACES` 與兩張台北市對照表）
- Modify: `data/seed/generate.py:183-215`（`customer_specs`、`build_customers`，新增 `place_of`）、`generate()` 的回傳值
- Modify: `data/seed/seed.py:30-44`（`TABLES`）
- Test: `backend/tests/test_seed.py`

**Interfaces:**
- Produces: `models.Place(id: str, name: str, unit_id: str)`；`models.Customer.place_id: str`；`generate.place_of(name, type_, city, area) -> str`；`generate.generate()` 多回傳 `"place"`；`catalog.PLACES: list[tuple[str, str, str]]`

- [ ] **Step 1: 寫會失敗的測試**

加到 `backend/tests/test_seed.py` 最後：

```python
def test_every_customer_sits_on_a_place_in_its_own_region(db):
    # 縣市一個地點，台北市客戶多，拆成十二個行政區；每個地點都有客戶
    by_place = dict(rows(db, "SELECT p.name, count(*) FROM customer c JOIN place p ON p.id = c.place_id GROUP BY 1"))
    assert len(by_place) == 17
    assert by_place["台北市・大安區"] > 0 and by_place["新北市"] > 0
    # 地點所在的區就是客戶的區；台北市的客戶一定對到行政區，其他縣市就是縣市本身
    assert rows(db, """
        SELECT c.name FROM customer c
        JOIN place p ON p.id = c.place_id
        JOIN org_unit u ON u.id = p.unit_id
        WHERE u.name <> c.region
           OR (c.city = '台北市' AND p.name NOT LIKE '台北市・%')
           OR (c.city <> '台北市' AND p.name <> c.city)
    """) == []
    # 連鎖分店與「長春」這種不是行政區名稱的地區，照對照表放
    places = dict(rows(db, "SELECT c.name, p.name FROM customer c JOIN place p ON p.id = c.place_id"))
    assert places["康泰連鎖藥局 · 忠孝店"] == "台北市・大安區"
    assert places["福安連鎖藥局 · 西門店"] == "台北市・萬華區"
    assert places["家家藥局 · 長春"] == "台北市・中山區"


def test_a_taipei_customer_without_a_district_fails_loudly():
    with pytest.raises(ValueError, match="測試藥局 · 天龍"):
        generate.place_of("測試藥局 · 天龍", "independent", "台北市", "天龍")
    with pytest.raises(ValueError, match="康泰連鎖藥局 · 新開店"):
        generate.place_of("康泰連鎖藥局 · 新開店", "chain", "台北市", "新開店")
    assert generate.place_of("德安藥局 · 逢甲", "independent", "台中市", "逢甲") == "TXG"
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `uv run --project backend pytest backend/tests/test_seed.py -q -k "place or district"`
Expected: FAIL（`generate` 沒有 `place_of`；資料庫沒有 `place` 表）

- [ ] **Step 3: 加資料表**

`backend/app/models.py`，在 `class Customer(Base):` 前面加：

```python
class Place(Base):
    """地點頻道的範圍：縣市，台北市客戶多，細分到行政區（services/channels.py）。
    客戶掛在一個地點上，地點掛在一個區上：整區的人看得到這個地點的頻道與底下的客戶討論串。
    id 只用 ASCII（'TPE-DA'、'NTPC'），網址與約束訊息裡比較好認。"""

    __tablename__ = "place"

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(unique=True)
    unit_id: Mapped[str] = mapped_column(ForeignKey("org_unit.id"))
```

`Customer` 的 `city: Mapped[str]` 下一行加：

```python
    # 地點（縣市，台北市到行政區）：客戶討論串掛在這裡。city 保留，今日路線與語意層照舊用它
    place_id: Mapped[str] = mapped_column(ForeignKey("place.id"))
```

- [ ] **Step 4: 加目錄資料**

`data/seed/catalog.py`，`REGION_SALES = ...` 那一行後面加：

```python
# 地點頻道（docs/superpowers/specs/2026-09-28-channels-design.md）：縣市一個，台北市客戶多，拆成十二個行政區。
# id, name, 所在的區
PLACES = [
    ("TPE-ZZ", "台北市・中正區", "TW.N"), ("TPE-DT", "台北市・大同區", "TW.N"),
    ("TPE-ZS", "台北市・中山區", "TW.N"), ("TPE-SS", "台北市・松山區", "TW.N"),
    ("TPE-DA", "台北市・大安區", "TW.N"), ("TPE-WH", "台北市・萬華區", "TW.N"),
    ("TPE-XY", "台北市・信義區", "TW.N"), ("TPE-SL", "台北市・士林區", "TW.N"),
    ("TPE-BT", "台北市・北投區", "TW.N"), ("TPE-NH", "台北市・內湖區", "TW.N"),
    ("TPE-NG", "台北市・南港區", "TW.N"), ("TPE-WS", "台北市・文山區", "TW.N"),
    ("NTPC", "新北市", "TW.N"),
    ("TXG", "台中市", "TW.C"), ("CHW", "彰化縣", "TW.C"),
    ("KHH", "高雄市", "TW.S"), ("TNN", "台南市", "TW.S"),
]
# 台北市獨立藥局與診所名稱裡的地區，不是行政區名稱的另外對（長春路在中山區）；其他的地區就是行政區
TAIPEI_AREA_DISTRICT = {"長春": "中山"}
# 台北市的連鎖分店在哪個行政區
TAIPEI_BRANCH_DISTRICT = {
    "忠孝店": "大安", "南京店": "中山", "內湖店": "內湖", "士林店": "士林", "信義店": "信義",
    "大安店": "大安", "松山店": "松山", "南港店": "南港", "天母店": "士林", "公館店": "中正",
    "景美店": "文山", "西門店": "萬華", "民權店": "中山", "木柵店": "文山", "北投店": "北投",
    "萬華店": "萬華",
}
```

- [ ] **Step 5: 產生客戶的地點**

`data/seed/generate.py`：把 `customer_specs` 與 `build_customers` 換成下面這樣，並在兩者之間加 `place_of`：

```python
PLACE_BY_NAME = {name: place_id for place_id, name, _ in catalog.PLACES}


def customer_specs(chains, independents, clinics):
    """(名稱, 類型, 連鎖體系, 區處, 城市, 地區)。地區是連鎖的分店名、其他客戶名稱裡的地區，用來對到地點"""
    specs = []
    for group, region, branches in chains:
        for branch, city in branches:
            specs.append((f"{group} · {branch}", "chain", group, region, city, branch))
    for name, area, region, city in independents:
        specs.append((f"{name} · {area}", "independent", None, region, city, area))
    for name, area, region, city in clinics:
        specs.append((f"{name} · {area}", "clinic", None, region, city, area))
    return specs


def place_of(name: str, type_: str, city: str, area: str) -> str:
    """客戶所在的地點（catalog.PLACES 的 id）：台北市對到行政區，其他縣市就是縣市本身。
    對不到就直接失敗並點名是哪一家：地點決定討論串掛在哪、整區誰看得到，不能默默放錯。"""
    if city == "台北市":
        if type_ == "chain":
            district = catalog.TAIPEI_BRANCH_DISTRICT.get(area)
        else:
            district = catalog.TAIPEI_AREA_DISTRICT.get(area, area)
        place = PLACE_BY_NAME.get(f"台北市・{district}區")
    else:
        place = PLACE_BY_NAME.get(city)
    if place is None:
        raise ValueError(f"{name} 對不到地點（{city}・{area}），請在 catalog.py 的台北市對照表補上")
    return place


def build_customers(rng, as_of, specs, assigned, first_id=1):
    """同一區的客戶由該區業務輪流負責；assigned 記每一區已經分了幾家，補客戶時接著輪。"""
    customers = []
    for i, (name, type_, group, region, city, area) in enumerate(specs, start=first_id):
        owners = catalog.REGION_SALES[region]
        owner = owners[assigned[region] % len(owners)]
        assigned[region] += 1
        weights = GRADE_WEIGHTS[type_]
        grade = rng.choices(list(weights), weights=list(weights.values()))[0]
        if i == 1:
            grade = "A"
        elif name in SCENARIO_CUSTOMERS and grade == "C":
            grade = "B"
        has_contract = type_ == "chain" or (type_ == "independent" and rng.random() < 0.4)
        contract_end = as_of + timedelta(days=rng.randint(20, 400)) if has_contract else None
        customers.append({
            "id": f"C{i:03d}", "name": name, "type": type_, "chain_group": group,
            "region": region, "city": city, "place_id": place_of(name, type_, city, area), "grade": grade,
            "contract_end_date": contract_end, "owner_user_id": owner,
        })
    return customers
```

`place_of` 不用亂數，原本的等級、合約、交易、拜訪一筆都不會變。

`generate()` 裡 `org_units = [...]` 後面加：

```python
    places = [{"id": i, "name": n, "unit_id": u} for i, n, u in catalog.PLACES]
```

回傳的 dict 在 `"org_unit": org_units,` 下一行加 `"place": places,`。

- [ ] **Step 6: 灌資料時寫入地點**

`data/seed/seed.py` 的 `TABLES`，在 `("org_unit", models.OrgUnit),` 下一行加：

```python
    ("place", models.Place),
```

- [ ] **Step 7: 跑測試確認通過**

Run: `uv run --project backend pytest backend/tests/test_seed.py -q`
Expected: 全部 PASS（包含原本的 `test_generation_is_deterministic`、`test_scale_matches_plan`）

- [ ] **Step 8: Commit**

```bash
git add backend/app/models.py data/seed/catalog.py data/seed/generate.py data/seed/seed.py backend/tests/test_seed.py
git commit -m "Put every customer on a place, with Taipei split by district"
```

---

### Task 2: 南區多一組（M04）

**Files:**
- Modify: `data/seed/catalog.py:18-29`（`USERS`）
- Modify: `data/seed/generate.py:579`（註解的帳號數）
- Modify: `README.md:101`
- Test: `backend/tests/test_scope.py:302-316`、`backend/tests/test_admin.py`

**Interfaces:**
- Produces: 帳號 M04「蔡宗翰」（南區主管），U05 的 `org_path` 變成 `TW.S.M04.U05`；組織管理頁新開的主管從 M05 編起

- [ ] **Step 1: 改測試的期望值**

`backend/tests/test_scope.py` 的 `test_org_paths_are_rebuilt_from_the_reporting_line`，期望的 dict 改成：

```python
    assert paths == {
        "U01": "TW.N.M01.U01",
        "U02": "TW.N.M01.U02",
        "U03": "TW.C.M02.U03",
        "U04": "TW.S.M03.U04",
        # 南區兩組：頻道的整區看板才看得到「各組」
        "U05": "TW.S.M04.U05",
        "M01": "TW.N.M01",
        "M02": "TW.C.M02",
        "M03": "TW.S.M03",
        "M04": "TW.S.M04",
        # IT 坐在根節點上，路徑就是根節點本身
        "A01": "TW",
    }
```

`backend/tests/test_admin.py`：

- `test_it_sits_on_the_root_and_sees_everything` 裡的 `"TW.S.M03.U05"` 改成 `"TW.S.M04.U05"`。
- `test_only_it_can_open_the_org_admin` 的集合加上 `"M04"`。
- `test_a_deactivated_account_cannot_sign_in` 的 `assert fresh(tx, "U05").org_path == "TW.S.M03.U05"` 改成 `"TW.S.M04.U05"`。
- `test_the_guards_explain_what_cannot_be_done` 的 `"2 位在職的業務" in refused("POST", "/api/admin/users/M03/deactivate", {})` 改成 `"1 位在職的業務"`。
- `test_a_new_account_gets_the_next_number_and_can_sign_in` 最後一段改成：

```python
    manager = {"name": "測試主管", "email": "new.boss@meddemo.tw", "password": "abcd1234", "role": "manager", "unit_id": "TW.S"}
    chart = client.post("/api/admin/users", json=manager, headers=auth("A01")).json()
    # M 開頭接著 M04 編；IT 是 A01，不佔主管的號碼
    assert member(chart, "M05")["region"] == "南區"
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `uv run --project backend pytest backend/tests/test_scope.py backend/tests/test_admin.py -q`
Expected: FAIL（還沒有 M04）

- [ ] **Step 3: 加帳號**

`data/seed/catalog.py` 的 `USERS`，U05 那一列改成接在 M04 後面，M03 下面加 M04，IT 那段註解的編號跟著改：

```python
USERS = [
    # id, name, role, manager_id, unit_id, email（None 就用工號小寫加網域）
    # 主管掛在區上、IT 掛在根節點上，業務掛在主管底下；org_path 與 region 由 services/org.py 算出來
    ("U01", "林昱辰", "sales", "M01", None, None),
    ("U02", "王冠宇", "sales", "M01", None, None),
    ("U03", "黃怡君", "sales", "M02", None, None),
    ("U04", "吳承翰", "sales", "M03", None, None),
    # 南區兩組各一位業務：頻道的整區看板要看得到「各組」往上傳的重點
    ("U05", "李佳蓉", "sales", "M04", None, None),
    ("M01", "陳建宏", "manager", None, "TW.N", None),
    ("M02", "張淑芬", "manager", None, "TW.C", None),
    ("M03", "許文彬", "manager", None, "TW.S", None),
    ("M04", "蔡宗翰", "manager", None, "TW.S", None),
    # 開發者自己的帳號：IT，全公司看得到也動得了，並且是唯一能在組織管理頁改組織的人。
    # 用自己的信箱才能在展示時登入；A 開頭跟主管的 M 分開，新開的主管帳號照 M05、M06 編下去
    ("A01", "James", "it", None, "TW", "jamessu2026@gmail.com"),
]
```

`REGION_SALES` 不動：客戶照舊由區裡的業務輪流負責，U05 仍然負責原本那 50 家。

- [ ] **Step 4: 改帳號數的說明**

- `data/seed/generate.py` 的 `# 公司給的帳號。Email 用工號，密碼九個帳號都一樣，由 DEMO_PASSWORD 設定` 改成「密碼十個帳號都一樣」。
- `README.md` 第 101 行的兩處「九個帳號」改成「十個帳號」。

- [ ] **Step 5: 跑整套後端測試**

Run: `uv run --project backend pytest backend/tests -q`
Expected: 全部 PASS。有其他測試因為 U05 換主管而失敗的話，照「U05 現在在 M04 底下、M03 只帶 U04」改期望值，不要改 catalog。

- [ ] **Step 6: Commit**

```bash
git add data/seed/catalog.py data/seed/generate.py README.md backend/tests/test_scope.py backend/tests/test_admin.py
git commit -m "Give the south region a second team under M04"
```

---

### Task 3: 頻道資料表與權限

**Files:**
- Modify: `backend/app/models.py`（檔案最後加頻道三張表）
- Modify: `backend/app/services/scope.py:36-47`（`SHARING_LEVEL`）
- Create: `backend/app/services/channels.py`
- Modify: `backend/app/services/org_admin.py:312-317`（`_rebuild`）
- Modify: `data/seed/seed.py`（建頻道）
- Modify: `backend/tests/conftest.py`（加 `tx`）、`backend/tests/test_admin.py`（拿掉自己的 `tx`）
- Test: `backend/tests/test_channels.py`

**Interfaces:**
- Consumes: `models.Place`、`models.Customer.place_id`（Task 1）
- Produces（`app/services/channels.py`）：
  - `class NotFound(Exception)`、`class Archived(Exception)`
  - `@dataclass(frozen=True) class ChannelInfo(id: int, kind: str, name: str, path: str | None, region_id: str | None, parent_id: int | None, archived: bool, customer_id: str | None, audience: str, owner_path: str | None = None)`
  - `ensure_channels(session: Session) -> None`
  - `can_see(user: AppUser, info: ChannelInfo) -> bool`
  - `visible_channels(session: Session, user: AppUser) -> list[ChannelInfo]`
  - `get_channel(session: Session, user: AppUser, channel_id: int) -> ChannelInfo`（看不到就 `NotFound`）
  - `customer_thread(session: Session, user: AppUser, customer_id: str) -> ChannelInfo`
  - `describe(session: Session, channels: list[Channel]) -> list[ChannelInfo]`
- Produces（`app/models.py`）：`CHANNEL_KINDS`、`MESSAGE_KINDS`、`MESSAGE_MAX_LENGTH = 2000`、`Channel`、`ChannelMessage`、`ChannelRead`
- Produces（`tests/conftest.py`）：fixture `tx`（一條連線的交易，API 與測試共用，測完回滾）

- [ ] **Step 1: 把 `tx` fixture 搬到 conftest**

`backend/tests/conftest.py` 最後加：

```python
@pytest.fixture
def tx(engine):
    """一條連線包一個交易，API 與測試都在裡面，測完回滾。commit 只會結束一個 savepoint。
    會改組織或發訊息的測試都用它，別的測試看到的還是原本灌好的資料。"""
    from app.db import get_session
    from app.main import app

    with engine.connect() as conn:
        outer = conn.begin()

        def session():
            with Session(bind=conn, join_transaction_mode="create_savepoint") as s:
                yield s

        app.dependency_overrides[get_session] = session
        try:
            with Session(bind=conn, join_transaction_mode="create_savepoint") as orm:
                yield orm
        finally:
            app.dependency_overrides.pop(get_session, None)
            outer.rollback()
```

`backend/tests/test_admin.py`：刪掉檔案裡自己的 `tx` fixture（第 25-41 行），並拿掉因此用不到的 `from app.db import get_session`。模組說明裡「（tx fixture）」後面補一句「定義在 conftest.py」。

- [ ] **Step 2: 寫會失敗的測試**

新增 `backend/tests/test_channels.py`：

```python
"""頻道（services/channels.py、api/channels.py）。

頻道跟著組織樹與地點自動存在；看不看得到跟客戶、拜訪同一個式子（Scope.can_see）：
全國頻道全公司、整區與地點頻道和客戶討論串整區、小組頻道到小組。
會發言或改組織的測試都跑在 tx fixture 的交易裡（conftest.py），測完回滾，不影響其他測試的未讀數。
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.main import app
from app.models import Channel
from app.services import channels

NORTH_PLACES = {
    "台北市・中正區", "台北市・大同區", "台北市・中山區", "台北市・松山區", "台北市・大安區", "台北市・萬華區",
    "台北市・信義區", "台北市・士林區", "台北市・北投區", "台北市・內湖區", "台北市・南港區", "台北市・文山區",
    "新北市",
}


@pytest.fixture
def client():
    return TestClient(app)


def listing(client, headers) -> list[dict]:
    response = client.get("/api/channels", headers=headers)
    assert response.status_code == 200
    return response.json()


def names(client, headers) -> set[str]:
    return {c["name"] for c in listing(client, headers)}


def channel_id(client, auth, name: str, user_id: str = "A01") -> int:
    return next(c["id"] for c in listing(client, auth(user_id)) if c["name"] == name)


def test_channels_follow_the_org_tree_and_places(engine):
    with Session(engine) as session:
        infos = channels.describe(session, list(session.scalars(select(Channel).where(Channel.kind != "customer"))))
    by_name = {i.name: i for i in infos}
    # 全國 1、整區 3、小組 4（每位主管一個）、地點 17
    assert len(infos) == 25
    assert (by_name["全國"].path, by_name["全國"].parent_id, by_name["全國"].region_id) == ("TW", None, None)
    assert (by_name["北區"].path, by_name["北區"].parent_id) == ("TW.N", by_name["全國"].id)
    assert (by_name["陳建宏小組"].path, by_name["陳建宏小組"].parent_id) == ("TW.N.M01", by_name["北區"].id)
    assert (by_name["台北市・大安區"].path, by_name["台北市・大安區"].region_id) == ("TW.N", "TW.N")
    assert by_name["台北市・大安區"].parent_id == by_name["北區"].id
    assert by_name["陳建宏小組"].audience == "只有陳建宏小組看得到"
    assert by_name["台北市・大安區"].audience == "北區所有人都看得到"
    assert by_name["全國"].audience == "全公司都看得到"


def test_each_account_sees_its_own_team_its_region_and_the_whole_company(client, auth):
    north = {"全國", "北區", "陳建宏小組"} | NORTH_PLACES
    assert names(client, auth("U01")) == north
    assert names(client, auth("M01")) == north
    # 南區兩組各看各的小組頻道，整區與地點一樣
    assert names(client, auth("U04")) == {"全國", "南區", "許文彬小組", "高雄市", "台南市"}
    assert names(client, auth("U05")) == {"全國", "南區", "蔡宗翰小組", "高雄市", "台南市"}
    assert names(client, auth("M04")) == {"全國", "南區", "蔡宗翰小組", "高雄市", "台南市"}
    # IT 坐在根節點上，全部看得到，包括各組的原始對話
    everything = listing(client, auth("A01"))
    assert len(everything) == 25
    # 全國在最前面，接著北區、北區的小組、北區的地點（照名稱排），再來中區、南區
    order = [c["name"] for c in everything]
    assert order[:4] == ["全國", "北區", "陳建宏小組", "台北市・中山區"]
    assert order.index("台北市・萬華區") < order.index("新北市")
    assert order.index("中區") < order.index("南區")


def test_channels_you_cannot_see_do_not_exist(client, auth):
    team = channel_id(client, auth, "陳建宏小組")
    for path in (f"/api/channels/{team}", f"/api/channels/{team}/messages"):
        assert client.get(path, headers=auth("U04")).status_code == 404
    assert client.post(f"/api/channels/{team}/messages", json={"body": "嗨"}, headers=auth("U04")).status_code == 404
    assert client.get("/api/channels/999999", headers=auth("A01")).status_code == 404
    assert client.get("/api/channels").status_code == 401


def test_a_self_created_account_sees_what_the_demo_rep_sees(tx, client):
    created = client.post(
        "/api/auth/register", json={"name": "評審", "email": "judge@channels.test", "password": "judge-pass-1"}
    ).json()
    headers = {"Authorization": f"Bearer {created['token']}"}
    assert names(client, headers) == {"全國", "北區", "陳建宏小組"} | NORTH_PLACES


def test_a_new_manager_gets_a_team_channel(tx, client, auth):
    boss = {"name": "測試主管", "email": "channel.boss@meddemo.tw", "password": "abcd1234", "role": "manager", "unit_id": "TW.C"}
    assert client.post("/api/admin/users", json=boss, headers=auth("A01")).status_code == 201
    assert "測試主管小組" in names(client, auth("A01"))
    assert "測試主管小組" not in names(client, auth("U03"))


def test_moving_a_manager_carries_the_team_channel(tx, client, auth):
    client.put("/api/admin/users/M01/unit", json={"unit_id": "TW.C"}, headers=auth("A01"))
    seen = names(client, auth("U01"))
    assert {"中區", "陳建宏小組", "台中市", "彰化縣"} <= seen
    assert "北區" not in seen and "台北市・大安區" not in seen


def test_a_demoted_managers_channel_is_archived_for_it_only(tx, client, auth):
    it = auth("A01")
    team = channel_id(client, auth, "蔡宗翰小組")
    client.put("/api/admin/users/U05/manager", json={"manager_id": "M03"}, headers=it)
    demoted = client.put("/api/admin/users/M04/role", json={"role": "sales", "manager_id": "M03"}, headers=it)
    assert demoted.status_code == 200
    assert "蔡宗翰小組" not in names(client, auth("U05"))
    assert "蔡宗翰小組" not in names(client, auth("M04"))
    archived = client.get(f"/api/channels/{team}", headers=it).json()
    assert archived["archived"] is True
    # 封存的頻道排在最後
    assert [c["name"] for c in listing(client, it)][-1] == "蔡宗翰小組"
    assert client.post(f"/api/channels/{team}/messages", json={"body": "還在嗎"}, headers=it).status_code == 409


def test_customer_threads_are_open_to_the_whole_region(tx, client, auth):
    # C002 康泰南京店在台北市中山區，負責人是王冠宇 U02
    opened = client.post("/api/customers/C002/thread", headers=auth("U01"))
    assert opened.status_code == 200
    thread = opened.json()
    assert (thread["kind"], thread["name"], thread["audience"]) == ("customer", "康泰連鎖藥局 · 南京店", "北區所有人都看得到")
    # 可以重複呼叫，拿到同一個
    assert client.post("/api/customers/C002/thread", headers=auth("M01")).json()["id"] == thread["id"]
    assert client.post("/api/customers/C002/thread", headers=auth("U04")).status_code == 404
    assert client.post("/api/customers/C999/thread", headers=auth("U01")).status_code == 404
    # 客戶討論串不放在頻道列表裡
    assert thread["id"] not in {c["id"] for c in listing(client, auth("U01"))}


def test_the_owner_always_sees_their_customers_thread(tx, client, auth):
    # IT 把北區的忠孝店交給南區的吳承翰：他截到整區看不到台北市，但負責人一定看得到自己客戶的討論串
    client.put("/api/admin/customers/C001/owner", json={"owner_id": "U04"}, headers=auth("A01"))
    assert client.post("/api/customers/C001/thread", headers=auth("U04")).status_code == 200
    assert client.post("/api/customers/C001/thread", headers=auth("M03")).status_code == 200
    assert client.post("/api/customers/C001/thread", headers=auth("U03")).status_code == 404
    assert "台北市・大安區" not in names(client, auth("U04"))


def test_ensure_channels_can_run_twice(tx):
    before = tx.scalar(select(Channel.id).order_by(Channel.id.desc()).limit(1))
    channels.ensure_channels(tx)
    channels.ensure_channels(tx)
    assert tx.scalar(select(Channel.id).order_by(Channel.id.desc()).limit(1)) == before
    # 每位主管剛好一個小組頻道
    assert tx.scalar(select(func.count()).select_from(Channel).where(Channel.kind == "team")) == 4
```

這一步只要求頻道、權限與客戶討論串；訊息的測試在 Task 4。`test_channels_you_cannot_see_do_not_exist` 與
`test_a_demoted_managers_channel_is_archived_for_it_only` 會打發言的 API，Task 3 還沒有，所以 Step 9 暫時跳過，Task 4 再一起跑。

- [ ] **Step 3: 加資料表**

`backend/app/models.py` 最後加：

```python
# national：全國；region：整區；team：一位主管帶的小組；place：地點（縣市，台北市到行政區）；customer：一家客戶的討論串
CHANNEL_KINDS = ("national", "region", "team", "place", "customer")
# user：人發的；ai：AI 主理發的；notice：拜訪的風險通報（見 docs/superpowers/specs/2026-09-28-channels-design.md）
MESSAGE_KINDS = ("user", "ai", "notice")
# 一則訊息最多幾個字。回報一件事用不到這麼多，再長多半是誤貼了一大段
MESSAGE_MAX_LENGTH = 2000


class Channel(Base):
    """頻道。不存路徑，只記屬於誰：路徑每次從組織樹現算（services/channels.py），
    主管調區、客戶換負責人都不必另外同步。"""

    __tablename__ = "channel"
    __table_args__ = (
        one_of("kind", CHANNEL_KINDS, "kind"),
        # 依種類只有一個歸屬欄位有值
        CheckConstraint(
            "(kind IN ('national', 'region')"
            "  AND unit_id IS NOT NULL AND manager_id IS NULL AND place_id IS NULL AND customer_id IS NULL)"
            " OR (kind = 'team'"
            "  AND manager_id IS NOT NULL AND unit_id IS NULL AND place_id IS NULL AND customer_id IS NULL)"
            " OR (kind = 'place'"
            "  AND place_id IS NOT NULL AND unit_id IS NULL AND manager_id IS NULL AND customer_id IS NULL)"
            " OR (kind = 'customer'"
            "  AND customer_id IS NOT NULL AND unit_id IS NULL AND manager_id IS NULL AND place_id IS NULL)",
            name="owner",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    kind: Mapped[str]
    # 每個歸屬只有一個頻道（NULL 不算重複）
    unit_id: Mapped[str | None] = mapped_column(ForeignKey("org_unit.id"), unique=True)
    manager_id: Mapped[str | None] = mapped_column(ForeignKey("app_user.id"), unique=True)
    place_id: Mapped[str | None] = mapped_column(ForeignKey("place.id"), unique=True)
    customer_id: Mapped[str | None] = mapped_column(ForeignKey("customer.id"), unique=True)
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


class ChannelMessage(Base):
    """頻道裡的一則訊息。第一版不能改、不能刪：回報會被整理進記憶，原文留著才追得回來。"""

    __tablename__ = "channel_message"
    __table_args__ = (
        one_of("kind", MESSAGE_KINDS, "kind"),
        # 人發的一定有作者；AI 主理與風險通報沒有
        CheckConstraint("(kind = 'user') = (author_id IS NOT NULL)", name="author"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    # 輪詢「這個頻道這則之後的新訊息」靠這個索引
    channel_id: Mapped[int] = mapped_column(ForeignKey("channel.id", ondelete="CASCADE"), index=True)
    # 自建帳號刪除時，他發的訊息一起刪（隱私權政策寫的刪除方式）；公司帳號只能停用，不會被刪
    author_id: Mapped[str | None] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(server_default="user")
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


class ChannelRead(Base):
    """每個人在每個頻道讀到哪一則，算未讀數用。記在實際登入的帳號上，不是代理的那位。"""

    __tablename__ = "channel_read"

    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), primary_key=True)
    channel_id: Mapped[int] = mapped_column(ForeignKey("channel.id", ondelete="CASCADE"), primary_key=True)
    last_read_id: Mapped[int] = mapped_column(BigInteger)
```

- [ ] **Step 4: 加共享層級**

`backend/app/services/scope.py` 的 `SHARING_LEVEL`，`"manager_inbox": SELF,` 前面加：

```python
    # 頻道（services/channels.py）：全國頻道全公司；整區、地點頻道與客戶討論串整區；小組頻道到小組
    "channel_national": ROOT,
    "channel_region": REGION,
    "channel_team": TEAM,
```

- [ ] **Step 5: 寫頻道服務（權限部分）**

新增 `backend/app/services/channels.py`：

```python
"""頻道：誰看得到哪些頻道、頻道叫什麼、訊息與未讀（docs/superpowers/specs/2026-09-28-channels-design.md）。

頻道不存路徑，只記屬於誰（區、主管、地點、客戶），路徑每次從組織樹現算：
全國與整區是地理節點本身，小組是主管的 org_path，地點與客戶討論串是地點所在的那一區。
看不看得到跟客戶、拜訪同一個式子：Scope.can_see(共享層級, 頻道路徑)，不另外寫規則。

頻道總共二十幾個，加上有人打開過的客戶討論串，整批讀進來在 Python 裡算，不必寫成 SQL。
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import AppUser, Channel, Customer, OrgUnit, Place
from app.services.scope import SELF, SHARING_LEVEL, Scope

# 頻道列表的區順序，跟組織管理頁一樣由北到南
REGION_ORDER = ("TW.N", "TW.C", "TW.S")
KIND_ORDER = ("national", "region", "team", "place", "customer")
LEVEL = {
    "national": SHARING_LEVEL["channel_national"],
    "region": SHARING_LEVEL["channel_region"],
    "team": SHARING_LEVEL["channel_team"],
    "place": SHARING_LEVEL["channel_region"],
    "customer": SHARING_LEVEL["channel_region"],
}


class NotFound(Exception):
    """頻道不存在，或登入者看不到。API 一律回 404，不透露它存在。"""


class Archived(Exception):
    """小組頻道的主管已經不是在職主管：只能看，不能發言。"""


@dataclass(frozen=True)
class ChannelInfo:
    id: int
    kind: str
    name: str
    # 組織樹上的路徑，算看不看得到用。封存的小組頻道是 None
    path: str | None
    # 所在的區（地理節點 id），頻道列表依這個分組；全國與封存的頻道是 None
    region_id: str | None
    # 上層頻道：客戶討論串 → 地點 → 整區 → 全國；小組 → 整區
    parent_id: int | None
    archived: bool
    customer_id: str | None
    # 輸入框上的提示：誰看得到這裡的訊息
    audience: str
    # 客戶討論串的負責人路徑：負責人與他的主管一定看得到自己客戶的討論串
    owner_path: str | None = None


def ensure_channels(session: Session) -> None:
    """補上缺的全國、整區、地點與小組頻道，可以重複呼叫。灌資料與每次組織異動後呼叫（services/org_admin.py）。
    客戶討論串不在這裡建：第一次有人打開才建（customer_thread）。"""
    have_units = set(session.scalars(select(Channel.unit_id).where(Channel.unit_id.is_not(None))))
    for unit in session.scalars(select(OrgUnit)):
        if unit.id not in have_units:
            session.add(Channel(kind="national" if unit.kind == "root" else "region", unit_id=unit.id))
    have_places = set(session.scalars(select(Channel.place_id).where(Channel.place_id.is_not(None))))
    for place_id in session.scalars(select(Place.id)):
        if place_id not in have_places:
            session.add(Channel(kind="place", place_id=place_id))
    have_teams = set(session.scalars(select(Channel.manager_id).where(Channel.manager_id.is_not(None))))
    for manager_id in session.scalars(select(AppUser.id).where(AppUser.role == "manager")):
        if manager_id not in have_teams:
            session.add(Channel(kind="team", manager_id=manager_id))
    session.flush()


def describe(session: Session, channels: list[Channel]) -> list[ChannelInfo]:
    """算出每個頻道的名稱、路徑、所在的區與上層，順序跟傳進來的一樣。"""
    units = {u.id: u for u in session.scalars(select(OrgUnit))}
    places = {p.id: p for p in session.scalars(select(Place))}
    by_unit = dict(session.execute(select(Channel.unit_id, Channel.id).where(Channel.unit_id.is_not(None))).all())
    by_place = dict(session.execute(select(Channel.place_id, Channel.id).where(Channel.place_id.is_not(None))).all())
    root = next(u.id for u in units.values() if u.kind == "root")
    manager_ids = {c.manager_id for c in channels if c.manager_id}
    managers = {u.id: u for u in session.scalars(select(AppUser).where(AppUser.id.in_(manager_ids)))}
    customer_ids = {c.customer_id for c in channels if c.customer_id}
    customers = {
        customer.id: (customer, owner_path)
        for customer, owner_path in session.execute(
            select(Customer, AppUser.org_path)
            .join(AppUser, AppUser.id == Customer.owner_user_id)
            .where(Customer.id.in_(customer_ids))
        )
    }

    def everyone_in(unit_id: str) -> str:
        return f"{units[unit_id].name}所有人都看得到"

    infos = []
    for c in channels:
        if c.kind in ("national", "region"):
            unit = units[c.unit_id]
            if unit.kind == "root":
                infos.append(ChannelInfo(c.id, c.kind, unit.name, unit.id, None, None, False, None, "全公司都看得到"))
            else:
                infos.append(ChannelInfo(c.id, c.kind, unit.name, unit.id, unit.id, by_unit[root], False, None, everyone_in(unit.id)))
        elif c.kind == "team":
            manager = managers[c.manager_id]
            name = f"{manager.name}小組"
            if manager.role != "manager" or manager.deactivated_at is not None:
                infos.append(ChannelInfo(c.id, "team", name, None, None, None, True, None, "已封存，只有 IT 看得到"))
            else:
                infos.append(ChannelInfo(
                    c.id, "team", name, manager.org_path, manager.unit_id, by_unit[manager.unit_id], False, None,
                    f"只有{name}看得到",
                ))
        elif c.kind == "place":
            place = places[c.place_id]
            infos.append(ChannelInfo(
                c.id, "place", place.name, place.unit_id, place.unit_id, by_unit[place.unit_id], False, None,
                everyone_in(place.unit_id),
            ))
        else:
            customer, owner_path = customers[c.customer_id]
            place = places[customer.place_id]
            infos.append(ChannelInfo(
                c.id, "customer", customer.name, place.unit_id, place.unit_id, by_place[place.id], False,
                customer.id, everyone_in(place.unit_id), owner_path,
            ))
    return infos


def can_see(user: AppUser, info: ChannelInfo) -> bool:
    if info.archived:
        # 主管已經不在，組員也都換到別組了，留給 IT 查
        return user.role == "it"
    scope = Scope.for_user(user)
    if info.path is not None and scope.can_see(LEVEL[info.kind], info.path):
        return True
    # IT 可以把客戶交給別區的業務（org_admin.reassign_customer 不限區），那位業務截到整區看不到這個地點
    return info.kind == "customer" and scope.can_see(SELF, info.owner_path)


def _order(info: ChannelInfo) -> tuple[int, int, int, str, int]:
    group = 0 if info.kind == "national" else 2 if info.archived else 1
    region = REGION_ORDER.index(info.region_id) if info.region_id in REGION_ORDER else len(REGION_ORDER)
    # 地點照名稱排，台北市的行政區會排在一起；其他照建立的先後
    name = info.name if info.kind == "place" else ""
    return (group, region, KIND_ORDER.index(info.kind), name, info.id)


def visible_channels(session: Session, user: AppUser) -> list[ChannelInfo]:
    """看得到的頻道，不含客戶討論串（太多了，從地點頻道或客戶檔案進去）。
    全國在最前面，接著各區由北到南（整區、小組、地點），封存的在最後。"""
    rows = list(session.scalars(select(Channel).where(Channel.kind != "customer")))
    return sorted((info for info in describe(session, rows) if can_see(user, info)), key=_order)


def get_channel(session: Session, user: AppUser, channel_id: int) -> ChannelInfo:
    channel = session.get(Channel, channel_id)
    if channel is None:
        raise NotFound
    info = describe(session, [channel])[0]
    if not can_see(user, info):
        raise NotFound
    return info


def customer_thread(session: Session, user: AppUser, customer_id: str) -> ChannelInfo:
    """這家客戶的討論串，沒有就建一個。看不到的一樣丟 NotFound；呼叫端沒有 commit，剛建的也不會留下。"""
    channel = session.scalar(select(Channel).where(Channel.customer_id == customer_id))
    if channel is None:
        if session.get(Customer, customer_id) is None:
            raise NotFound
        channel = Channel(kind="customer", customer_id=customer_id)
        try:
            with session.begin_nested():
                session.add(channel)
        except IntegrityError:
            # 兩個人同時第一次打開：對方先建好了，拿他建的那一個
            channel = session.scalar(select(Channel).where(Channel.customer_id == customer_id))
    info = describe(session, [channel])[0]
    if not can_see(user, info):
        raise NotFound
    return info
```

- [ ] **Step 6: 組織異動後補小組頻道**

`backend/app/services/org_admin.py`：import 區加 `from app.services.channels import ensure_channels`，`_rebuild` 改成：

```python
def _rebuild(session: Session) -> None:
    """重算整棵樹。規則寫在 paths_from_reports，這裡的檢查漏掉的，它還會再擋一次。
    新的主管（新增帳號、業務升主管）順便開小組頻道。"""
    try:
        rebuild_org_paths(session)
    except ValueError as exc:
        raise OrgError(str(exc)) from None
    ensure_channels(session)
```

- [ ] **Step 7: 灌資料時建頻道**

`data/seed/seed.py`：import 區加 `from app.services.channels import ensure_channels`；在 `session.execute(text("SELECT setval('visit_seq', :n)"), ...)` 前面加：

```python
        # 全國、整區、地點與小組頻道（客戶討論串第一次有人打開才建）
        ensure_channels(session)
```

- [ ] **Step 8: 暫時掛上只有權限的 API，讓測試跑得動**

Task 4 會寫完整的 `api/channels.py`。這一步先新增只含 `GET /api/channels`、`GET /api/channels/{id}`、`POST /api/customers/{id}/thread` 的版本：
從 Task 4 Step 4 的完整檔案取模組說明、import（拿掉 `Query`、`status`、`Field`、`MESSAGE_MAX_LENGTH`、`ChannelMessage`）、`router`、`SessionDep`、
`ChannelItem`、`_visible`，以及 `list_channels`、`get_channel`、`open_customer_thread` 三個端點；因為還沒有未讀，`_items` 先寫成：

```python
def _items(session: Session, user: AppUser, infos: list[ChannelInfo]) -> list[ChannelItem]:
    return [
        ChannelItem(
            id=i.id, kind=i.kind, name=i.name, region_id=i.region_id, parent_id=i.parent_id,
            archived=i.archived, customer_id=i.customer_id, audience=i.audience, unread=0, last_message_at=None,
        )
        for i in infos
    ]
```

`backend/app/main.py`：`from app.api import ...` 那行加上 `channels`，並加 `app.include_router(channels.router)`。

- [ ] **Step 9: 跑測試確認通過**

Run: `uv run --project backend pytest backend/tests/test_channels.py -q -k "not cannot_see and not archived"`
Expected: PASS（`cannot_see` 與 `archived` 兩個會用到發言，等 Task 4）

Run: `uv run --project backend pytest backend/tests/test_admin.py backend/tests/test_seed.py -q`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add backend/app/models.py backend/app/services/scope.py backend/app/services/channels.py backend/app/services/org_admin.py backend/app/api/channels.py backend/app/main.py data/seed/seed.py backend/tests/conftest.py backend/tests/test_admin.py backend/tests/test_channels.py
git commit -m "Add channels that follow the org tree and places"
```

---

### Task 4: 訊息、已讀與未讀

**Files:**
- Modify: `backend/app/services/channels.py`（加訊息、已讀、未讀、討論串清單）
- Modify: `backend/app/api/channels.py`（完整版本）
- Modify: `backend/app/api/auth.py:217-229`（`delete_account` 的說明）
- Test: `backend/tests/test_channels.py`、`backend/tests/test_auth.py:264-289`

**Interfaces:**
- Consumes: Task 3 的 `ChannelInfo`、`get_channel`、`describe`、`can_see`、`visible_channels`、`customer_thread`、`NotFound`、`Archived`
- Produces（`app/services/channels.py`）：
  - `MESSAGE_PAGE = 50`
  - `messages(session, channel_id: int, *, after: int | None = None, before: int | None = None, limit: int = MESSAGE_PAGE) -> list[Row[tuple[ChannelMessage, str | None]]]`（由舊到新；第二欄是作者名字）
  - `post(session, user: AppUser, info: ChannelInfo, body: str) -> ChannelMessage`（封存丟 `Archived`）
  - `mark_read(session, user: AppUser, channel_id: int, message_id: int) -> None`
  - `unread_counts(session, user: AppUser, channel_ids: list[int]) -> dict[int, int]`
  - `last_message_at(session, channel_ids: list[int]) -> dict[int, datetime]`
  - `badge_count(session, user: AppUser) -> int`
  - `threads(session, user: AppUser, place: ChannelInfo) -> list[ChannelInfo]`
- Produces（HTTP，前端 Task 6 用）：

| 方法 | 路徑 | 回傳 |
|---|---|---|
| GET | `/api/channels` | `ChannelItem[]` |
| GET | `/api/channels/unread` | `{count}` |
| GET | `/api/channels/{id}` | `ChannelItem` |
| GET | `/api/channels/{id}/messages?after=&before=&limit=` | `MessageItem[]`（由舊到新） |
| POST | `/api/channels/{id}/messages` `{body}` | `MessageItem`，201 |
| POST | `/api/channels/{id}/read` `{message_id}` | 204 |
| GET | `/api/channels/{id}/threads` | `ChannelItem[]` |
| POST | `/api/customers/{id}/thread` | `ChannelItem` |

  `ChannelItem = {id, kind, name, region_id, parent_id, archived, customer_id, audience, unread, last_message_at}`；
  `MessageItem = {id, kind, author_id, author_name, body, created_at, mine}`

- [ ] **Step 1: 寫會失敗的測試**

加到 `backend/tests/test_channels.py` 最後：

```python
def post(client, headers, channel, body):
    return client.post(f"/api/channels/{channel}/messages", json={"body": body}, headers=headers)


def history(client, headers, channel, **params):
    response = client.get(f"/api/channels/{channel}/messages", params=params, headers=headers)
    assert response.status_code == 200
    return response.json()


def test_posting_and_polling_for_new_messages(tx, client, auth):
    team = channel_id(client, auth, "陳建宏小組", "U01")
    before = history(client, auth("U02"), team)
    posted = post(client, auth("U01"), team, "  忠孝店的檔期資料我週三前給  ")
    assert posted.status_code == 201
    message = posted.json()
    assert (message["kind"], message["body"], message["author_name"], message["mine"]) == (
        "user", "忠孝店的檔期資料我週三前給", "林昱辰", True
    )
    # 同組的人輪詢拿得到，對他來說不是自己發的
    new = history(client, auth("U02"), team, after=before[-1]["id"] if before else 0)
    assert [m["id"] for m in new][-1] == message["id"] and new[-1]["mine"] is False
    # 空白、太長的訊息擋下
    assert post(client, auth("U01"), team, "   ").status_code == 422
    assert post(client, auth("U01"), team, "字" * 2001).status_code == 422


def test_scrolling_back_pages_from_old_to_new(tx, client, auth):
    national = channel_id(client, auth, "全國", "U01")
    ids = [post(client, auth("U01"), national, f"第 {n} 則").json()["id"] for n in range(3)]
    latest = history(client, auth("U03"), national, limit=2)
    assert [m["id"] for m in latest] == ids[1:]
    assert [m["id"] for m in history(client, auth("U03"), national, before=ids[1], limit=2)][-1] == ids[0]


def test_unread_skips_my_own_messages_and_only_moves_forward(tx, client, auth):
    team = channel_id(client, auth, "陳建宏小組", "U01")

    def unread(user_id):
        return next(c["unread"] for c in listing(client, auth(user_id)) if c["id"] == team)

    # 不靠灌資料的對話：自己先放一則，U02 讀到這裡
    first = post(client, auth("M01"), team, "這週的拜訪量記得回報").json()
    assert client.post(f"/api/channels/{team}/read", json={"message_id": first["id"]}, headers=auth("U02")).status_code == 204
    assert unread("U02") == 0
    mine = post(client, auth("U01"), team, "新的一則").json()
    assert unread("U02") == 1
    # 發言的人自己不算未讀，發言之前的也一起算讀過
    assert unread("U01") == 0
    # 舊的請求晚到，不會把讀到的位置往回拉；比最新還大的編號也只算到最新那則
    client.post(f"/api/channels/{team}/read", json={"message_id": mine["id"] + 1000}, headers=auth("U02"))
    client.post(f"/api/channels/{team}/read", json={"message_id": 1}, headers=auth("U02"))
    assert unread("U02") == 0
    post(client, auth("M01"), team, "再一則")
    assert unread("U02") == 1


def test_the_badge_counts_my_team_my_region_and_my_customers_only(tx, client, auth):
    def badge(user_id):
        return client.get("/api/channels/unread", headers=auth(user_id)).json()["count"]

    # 灌資料放的對話：陳建宏小組 5 則（林昱辰 2、陳建宏 2、王冠宇 1）、大安區 2 則、忠孝店討論串 2 則（林昱辰）
    assert badge("U02") == 4          # 小組裡別人發的 4 則；地點頻道不算紅點
    assert badge("U01") == 3          # 小組裡別人發的 3 則；忠孝店是自己負責、自己發的
    assert badge("M01") == 5          # 小組 3 則，加上組員負責的忠孝店 2 則
    assert badge("A01") == 0          # IT 只算全國與三個區
    national = channel_id(client, auth, "全國", "U04")
    post(client, auth("U04"), national, "南區這週辦檔期")
    assert badge("U02") == 5 and badge("A01") == 1


def test_a_place_lists_only_threads_with_messages(tx, client, auth):
    zhongshan = channel_id(client, auth, "台北市・中山區", "U01")
    thread = client.post("/api/customers/C002/thread", headers=auth("U01")).json()
    assert client.get(f"/api/channels/{zhongshan}/threads", headers=auth("U01")).json() == []
    post(client, auth("U01"), thread["id"], "南京店店長換人了")
    listed = client.get(f"/api/channels/{zhongshan}/threads", headers=auth("U02")).json()
    assert [(t["name"], t["unread"]) for t in listed] == [("康泰連鎖藥局 · 南京店", 1)]
    # 大安區有灌資料放的忠孝店討論串
    daan = channel_id(client, auth, "台北市・大安區", "U01")
    assert [t["name"] for t in client.get(f"/api/channels/{daan}/threads", headers=auth("M01")).json()] == [
        "康泰連鎖藥局 · 忠孝店"
    ]
```

`backend/tests/test_auth.py` 的 `test_a_self_created_account_can_delete_itself_with_its_data`：在 `client.post("/api/asks", ...)` 下一行加：

```python
    national = next(c["id"] for c in client.get("/api/channels", headers=headers).json() if c["kind"] == "national")
    client.post(f"/api/channels/{national}/messages", json={"body": "刪帳號前說的話"}, headers=headers)
```

並在 `ask_record` 那行斷言下面加：

```python
            # 自己在頻道發的訊息一起刪
            assert conn.execute(sql("SELECT count(*) FROM channel_message WHERE author_id = :u"), {"u": user_id}).scalar_one() == 0
```

`test_the_badge_counts...` 與 `test_a_place_lists...` 需要 Task 5 灌好的對話，Task 4 的 Step 6 先排除它們。

- [ ] **Step 2: 跑測試確認失敗**

Run: `uv run --project backend pytest backend/tests/test_channels.py -q -k "posting or scrolling or unread_skips or cannot_see or archived"`
Expected: FAIL（`/messages`、`/read` 還沒有；發言 404/405）

- [ ] **Step 3: 服務加訊息與未讀**

`backend/app/services/channels.py`：

import 區改成：

```python
import datetime as dt

from sqlalchemy import Row, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import AppUser, Channel, ChannelMessage, ChannelRead, Customer, OrgUnit, Place
from app.services.scope import SELF, SHARING_LEVEL, Scope
```

`LEVEL = {...}` 後面加：

```python
# 一次給幾則訊息：打開頻道先給最新的一頁，往上捲再要前一頁
MESSAGE_PAGE = 50
```

檔案最後加：

```python
def messages(
    session: Session, channel_id: int, *, after: int | None = None, before: int | None = None, limit: int = MESSAGE_PAGE
) -> list[Row[tuple[ChannelMessage, str | None]]]:
    """(訊息, 作者名字)，由舊到新。after：輪詢用，這則之後的新訊息；before：往上捲，這則之前的一頁；
    都沒給就是最新的一頁。"""
    stmt = (
        select(ChannelMessage, AppUser.name)
        .outerjoin(AppUser, AppUser.id == ChannelMessage.author_id)
        .where(ChannelMessage.channel_id == channel_id)
    )
    if after is not None:
        return list(session.execute(stmt.where(ChannelMessage.id > after).order_by(ChannelMessage.id).limit(limit)))
    if before is not None:
        stmt = stmt.where(ChannelMessage.id < before)
    return list(session.execute(stmt.order_by(ChannelMessage.id.desc()).limit(limit)))[::-1]


def post(session: Session, user: AppUser, info: ChannelInfo, body: str) -> ChannelMessage:
    """發言。記在實際登入的帳號上（自建帳號用自己的名字，不是代理的示範業務）；自己發的就算讀過了。"""
    if info.archived:
        raise Archived
    message = ChannelMessage(channel_id=info.id, author_id=user.id, kind="user", body=body)
    session.add(message)
    session.flush()
    mark_read(session, user, info.id, message.id)
    session.refresh(message)
    return message


def mark_read(session: Session, user: AppUser, channel_id: int, message_id: int) -> None:
    """讀到 message_id 這一則。只往前推：畫面上舊的請求晚到，不會把位置往回拉；
    超過頻道最新一則的編號只算到最新那則，之後的新訊息才不會被吃掉。"""
    latest = session.scalar(select(func.max(ChannelMessage.id)).where(ChannelMessage.channel_id == channel_id))
    if latest is None:
        return
    stmt = insert(ChannelRead).values(user_id=user.id, channel_id=channel_id, last_read_id=min(message_id, latest))
    session.execute(stmt.on_conflict_do_update(
        index_elements=[ChannelRead.user_id, ChannelRead.channel_id],
        set_={"last_read_id": func.greatest(ChannelRead.last_read_id, stmt.excluded.last_read_id)},
    ))


def unread_counts(session: Session, user: AppUser, channel_ids: list[int]) -> dict[int, int]:
    """每個頻道有幾則還沒讀。自己發的不算；沒有未讀的頻道不會出現在結果裡。"""
    if not channel_ids:
        return {}
    last_read = (
        select(ChannelRead.last_read_id)
        .where(ChannelRead.user_id == user.id, ChannelRead.channel_id == ChannelMessage.channel_id)
        .scalar_subquery()
    )
    rows = session.execute(
        select(ChannelMessage.channel_id, func.count())
        .where(
            ChannelMessage.channel_id.in_(channel_ids),
            ChannelMessage.id > func.coalesce(last_read, 0),
            ChannelMessage.author_id.is_distinct_from(user.id),
        )
        .group_by(ChannelMessage.channel_id)
    )
    return dict(rows.all())


def last_message_at(session: Session, channel_ids: list[int]) -> dict[int, dt.datetime]:
    if not channel_ids:
        return {}
    rows = session.execute(
        select(ChannelMessage.channel_id, func.max(ChannelMessage.created_at))
        .where(ChannelMessage.channel_id.in_(channel_ids))
        .group_by(ChannelMessage.channel_id)
    )
    return dict(rows.all())


def badge_count(session: Session, user: AppUser) -> int:
    """分頁列紅點的數字：全國、自己的區、自己的小組，加上自己負責（主管是組內業務負責）的客戶討論串。
    地點頻道與別人客戶的討論串太多，只在列表上顯示未讀，不算進紅點。IT 看得到每一組，只算全國與三個區。"""
    kinds = ("national", "region") if user.role == "it" else ("national", "region", "team")
    ids = [info.id for info in visible_channels(session, user) if info.kind in kinds and not info.archived]
    if user.role != "it":
        mine = Scope.for_user(user).customers_at(SELF)
        ids += list(session.scalars(select(Channel.id).join(Customer, Customer.id == Channel.customer_id).where(mine)))
    return sum(unread_counts(session, user, ids).values())


def threads(session: Session, user: AppUser, place: ChannelInfo) -> list[ChannelInfo]:
    """地點頻道底下有人發過言的客戶討論串，最近有訊息的在前。其他種類的頻道沒有討論串。"""
    if place.kind != "place":
        return []
    place_id = session.get(Channel, place.id).place_id
    last = func.max(ChannelMessage.id)
    rows = session.execute(
        select(Channel)
        .join(Customer, Customer.id == Channel.customer_id)
        .join(ChannelMessage, ChannelMessage.channel_id == Channel.id)
        .where(Customer.place_id == place_id)
        .group_by(Channel.id)
        .order_by(last.desc())
    ).scalars()
    return [info for info in describe(session, list(rows)) if can_see(user, info)]
```

- [ ] **Step 4: 完整的 API**

`backend/app/api/channels.py` 整份換成：

```python
"""頻道 API（docs/superpowers/specs/2026-09-28-channels-design.md）：頻道列表、訊息、已讀、客戶討論串。

誰看得到哪些頻道由 services/channels.py 決定；看不到的一律 404，不透露它存在。
訊息靠畫面輪詢（打開頻道時每 3 秒問一次 after 之後的新訊息），不開長連線。
"""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.db import get_session
from app.models import MESSAGE_MAX_LENGTH, AppUser, ChannelMessage
from app.services import channels
from app.services.channels import ChannelInfo

router = APIRouter(tags=["channels"])
SessionDep = Annotated[Session, Depends(get_session)]


class ChannelItem(BaseModel):
    id: int
    kind: str
    name: str
    region_id: str | None
    parent_id: int | None
    archived: bool
    customer_id: str | None
    # 輸入框上的提示：誰看得到這裡的訊息
    audience: str
    unread: int
    last_message_at: dt.datetime | None


class MessageItem(BaseModel):
    id: int
    kind: str
    author_id: str | None
    author_name: str | None
    body: str
    created_at: dt.datetime
    # 是不是登入者自己發的（自建帳號看的是示範業務的頻道，但發言記在自己名下）
    mine: bool


class MessageInput(BaseModel):
    body: str = Field(min_length=1, max_length=MESSAGE_MAX_LENGTH)


class ReadInput(BaseModel):
    message_id: int


class Unread(BaseModel):
    count: int


def _items(session: Session, user: AppUser, infos: list[ChannelInfo]) -> list[ChannelItem]:
    ids = [info.id for info in infos]
    unread = channels.unread_counts(session, user, ids)
    latest = channels.last_message_at(session, ids)
    return [
        ChannelItem(
            id=i.id, kind=i.kind, name=i.name, region_id=i.region_id, parent_id=i.parent_id,
            archived=i.archived, customer_id=i.customer_id, audience=i.audience,
            unread=unread.get(i.id, 0), last_message_at=latest.get(i.id),
        )
        for i in infos
    ]


def _message(message: ChannelMessage, author_name: str | None, user: AppUser) -> MessageItem:
    return MessageItem(
        id=message.id, kind=message.kind, author_id=message.author_id, author_name=author_name,
        body=message.body, created_at=message.created_at, mine=message.author_id == user.id,
    )


def _visible(session: Session, user: AppUser, channel_id: int) -> ChannelInfo:
    try:
        return channels.get_channel(session, user, channel_id)
    except channels.NotFound:
        raise HTTPException(404, "找不到這個頻道") from None


@router.get("/api/channels", response_model=list[ChannelItem])
def list_channels(session: SessionDep, user: CurrentUser):
    """看得到的頻道，不含客戶討論串。全國在最前面，接著各區由北到南（整區、小組、地點）。"""
    return _items(session, user, channels.visible_channels(session, user))


# 要寫在 /api/channels/{channel_id} 前面，不然 unread 會被當成頻道編號
@router.get("/api/channels/unread", response_model=Unread)
def unread_badge(session: SessionDep, user: CurrentUser):
    """分頁列紅點的數字（規則見 services/channels.badge_count）。畫面每分鐘問一次。"""
    return Unread(count=channels.badge_count(session, user))


@router.get("/api/channels/{channel_id}", response_model=ChannelItem)
def get_channel(session: SessionDep, user: CurrentUser, channel_id: int):
    return _items(session, user, [_visible(session, user, channel_id)])[0]


@router.get("/api/channels/{channel_id}/messages", response_model=list[MessageItem])
def list_messages(
    session: SessionDep,
    user: CurrentUser,
    channel_id: int,
    after: int | None = None,
    before: int | None = None,
    limit: Annotated[int, Query(ge=1, le=channels.MESSAGE_PAGE)] = channels.MESSAGE_PAGE,
):
    """由舊到新。after 給輪詢用，before 給往上捲；都沒給就是最新的一頁。"""
    info = _visible(session, user, channel_id)
    rows = channels.messages(session, info.id, after=after, before=before, limit=limit)
    return [_message(message, author_name, user) for message, author_name in rows]


@router.post("/api/channels/{channel_id}/messages", response_model=MessageItem, status_code=status.HTTP_201_CREATED)
def post_message(session: SessionDep, user: CurrentUser, channel_id: int, body: MessageInput):
    info = _visible(session, user, channel_id)
    text = body.body.strip()
    if not text:
        raise HTTPException(422, "訊息不能是空的")
    try:
        message = channels.post(session, user, info, text)
    except channels.Archived:
        raise HTTPException(409, "這個小組頻道已封存，不能再發言") from None
    session.commit()
    return _message(message, user.name, user)


@router.post("/api/channels/{channel_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(session: SessionDep, user: CurrentUser, channel_id: int, body: ReadInput):
    info = _visible(session, user, channel_id)
    channels.mark_read(session, user, info.id, body.message_id)
    session.commit()


@router.get("/api/channels/{channel_id}/threads", response_model=list[ChannelItem])
def list_threads(session: SessionDep, user: CurrentUser, channel_id: int):
    """地點頻道底下有人發過言的客戶討論串，最近有訊息的在前。"""
    info = _visible(session, user, channel_id)
    return _items(session, user, channels.threads(session, user, info))


@router.post("/api/customers/{customer_id}/thread", response_model=ChannelItem)
def open_customer_thread(session: SessionDep, user: CurrentUser, customer_id: str):
    """這家客戶的討論串，沒有就建一個，可以重複呼叫。整區的人與負責人（和他的主管）打得開。"""
    try:
        info = channels.customer_thread(session, user, customer_id)
    except channels.NotFound:
        raise HTTPException(404, "找不到這家客戶的討論串") from None
    session.commit()
    return _items(session, user, [info])[0]
```

- [ ] **Step 5: 刪帳號的說明**

`backend/app/api/auth.py` 的 `delete_account` 說明，「一起刪掉：帳號、綁定的第三方身分、自己的提問與轉給主管的提問（外鍵 ON DELETE CASCADE）。」改成：

```python
    一起刪掉：帳號、綁定的第三方身分、自己的提問與轉給主管的提問、自己在頻道發的訊息與已讀位置
    （外鍵 ON DELETE CASCADE）。
```

- [ ] **Step 6: 跑測試確認通過**

Run: `uv run --project backend pytest backend/tests/test_channels.py -q -k "not badge and not place_lists"`
Expected: PASS

Run: `uv run --project backend pytest backend/tests/test_auth.py -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/channels.py backend/app/api/channels.py backend/app/api/auth.py backend/tests/test_channels.py backend/tests/test_auth.py
git commit -m "Let people post in channels, poll for new messages and track unread"
```

---

### Task 5: 預先寫好的對話

**Files:**
- Modify: `data/seed/catalog.py`（最後加 `CONVERSATIONS`）
- Modify: `data/seed/seed.py`（`seed_conversations`）
- Test: `backend/tests/test_seed.py`、`backend/tests/test_channels.py`（Task 4 暫時排除的兩個）

**Interfaces:**
- Consumes: Task 3 的 `ensure_channels`、`models.Channel`、`models.ChannelMessage`
- Produces: `catalog.CONVERSATIONS`；`seed.seed_conversations(session) -> int`；`seed()` 的回傳多一個 `"channel_message"`

- [ ] **Step 1: 寫會失敗的測試**

加到 `backend/tests/test_seed.py` 最後：

```python
def test_seeded_conversations_sit_in_their_channels(db):
    found = dict(rows(db, """
        SELECT CASE ch.kind WHEN 'team' THEN m.name || '小組' WHEN 'place' THEN p.name ELSE cu.name END, count(*)
        FROM channel_message msg
        JOIN channel ch ON ch.id = msg.channel_id
        LEFT JOIN app_user m ON m.id = ch.manager_id
        LEFT JOIN place p ON p.id = ch.place_id
        LEFT JOIN customer cu ON cu.id = ch.customer_id
        GROUP BY 1
    """))
    assert found == {
        "陳建宏小組": 5, "台北市・大安區": 2, "康泰連鎖藥局 · 忠孝店": 2, "許文彬小組": 2, "蔡宗翰小組": 2,
    }
    # 全國 1、整區 3、小組 4、地點 17，加上灌資料建的忠孝店討論串
    assert rows(db, "SELECT count(*) FROM channel")[0][0] == 26
    # 時間都在灌資料之前，同一個頻道裡編號越大越晚
    assert rows(db, "SELECT count(*) FROM channel_message WHERE created_at > now()")[0][0] == 0
    assert rows(db, """
        SELECT count(*) FROM channel_message a JOIN channel_message b
          ON a.channel_id = b.channel_id AND a.id < b.id AND a.created_at > b.created_at
    """)[0][0] == 0
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `uv run --project backend pytest backend/tests/test_seed.py -q -k conversations`
Expected: FAIL（沒有訊息）

- [ ] **Step 3: 加對話**

`data/seed/catalog.py` 最後加：

```python
# 頻道裡預先寫好的對話，打開頻道就有東西看：(頻道, [(幾天前, 幾點幾分, 誰, 內容), ...])。
# 頻道是 ("team", 主管工號)、("place", 地點 id) 或 ("customer", 客戶名稱)，同一個頻道裡照時間排。
# 延續既有情境：忠孝店補貨延遲與外盒破損、御松田在北區搶陳列位、左營店進貨間隔拉長、杏林診所慢箋成長。
# 忠孝店、板橋店是林昱辰的客戶，南京店、三重店是王冠宇的，左營店是吳承翰的
CONVERSATIONS = [
    (("team", "M01"), [
        (3, "09:12", "U01", "忠孝店店長又在問補貨，上次延遲三天，這週的魚油也還沒到"),
        (3, "09:40", "M01", "我去問物流，是不是北區倉的排程又卡住了"),
        (3, "10:05", "U02", "三重店也反映發票又開錯，我這週會跟會計對一次"),
        (2, "17:30", "M01", "物流回覆：下週一開始北區補貨改成一週兩次。昱辰週五前跟忠孝店店長說一聲"),
        (1, "11:20", "U01", "跟店長講了，他說再延遲就要考慮換御松田的魚油，板橋店那邊也聽到御松田在談陳列位"),
    ]),
    (("place", "TPE-DA"), [
        (4, "14:10", "U02", "大安這邊最近好幾家店都說御松田的業務在跑，開買十送一"),
        (2, "16:45", "U01", "杏林診所的慢箋量一直在長，下次可以帶學名藥比價表過去"),
    ]),
    (("customer", "康泰連鎖藥局 · 忠孝店"), [
        (5, "10:30", "U01", "店長說補貨延遲三天，到貨還有兩盒外盒破損，要我們回報檔期"),
        (1, "11:25", "U01", "下週一起一週補貨兩次，檔期資料週三前給店長"),
    ]),
    (("team", "M03"), [
        (3, "10:00", "U04", "左營店這幾個月進貨間隔拉長，店長說櫃檯旁邊的陳列位被換掉了"),
        (2, "09:15", "M03", "下週我跟你一起去一趟左營店，順便談檔期"),
    ]),
    (("team", "M04"), [
        (2, "15:20", "U05", "台南這邊有兩家診所在問血糖試紙，說別家報得比較低"),
        (1, "09:05", "M04", "先看一下報價權限的規範，超過五趴的折扣要我核准"),
    ]),
]
```

- [ ] **Step 4: 灌資料時寫入**

`data/seed/seed.py`：

import 區改成：

```python
from datetime import date, datetime, timedelta
...
from sqlalchemy import insert, select, text  # noqa: E402
from sqlalchemy.orm import Session

import catalog
import generate
```

（`...` 代表原本其他 import 不動；`catalog` 在 `generate` 旁邊，同一個資料夾。）

`seed()` 前面加：

```python
def seed_conversations(session: Session) -> int:
    """頻道裡預先寫好的對話（catalog.CONVERSATIONS）。時間從灌資料的這一刻往前推，之後有人發言一定排在後面。
    不放在 generate.py：那裡的產出跟著 as_of 固定下來，這裡的時間要跟著實際灌資料的日子走。"""
    now = datetime.now(generate.TAIPEI)
    count = 0
    for (kind, key), lines in catalog.CONVERSATIONS:
        if kind == "customer":
            customer_id = session.scalar(select(models.Customer.id).where(models.Customer.name == key))
            channel = models.Channel(kind="customer", customer_id=customer_id)
            session.add(channel)
            session.flush()
        else:
            column = {"team": models.Channel.manager_id, "place": models.Channel.place_id}[kind]
            channel = session.scalar(select(models.Channel).where(column == key))
        for days_ago, clock, author_id, body in lines:
            hour, minute = map(int, clock.split(":"))
            at = (now - timedelta(days=days_ago)).replace(hour=hour, minute=minute, second=0, microsecond=0)
            session.add(models.ChannelMessage(channel_id=channel.id, author_id=author_id, kind="user", body=body, created_at=at))
            count += 1
        # 每個頻道寫完就送出去：編號照加入的順序，同一個頻道裡越晚的編號越大
        session.flush()
    return count
```

`seed()` 裡 `ensure_channels(session)` 下一行加：

```python
        messages = seed_conversations(session)
```

最後的 `return` 改成：

```python
    return {name: len(data[name]) for name, _ in TABLES} | {"document_chunk": chunks, "channel_message": messages}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `uv run --project backend pytest backend/tests/test_seed.py backend/tests/test_channels.py -q`
Expected: 全部 PASS（包含 Task 4 暫時排除的 `badge` 與 `place_lists`）

- [ ] **Step 6: 跑整套後端測試**

Run: `uv run --project backend pytest backend/tests -q`
Expected: 全部 PASS

- [ ] **Step 7: Commit**

```bash
git add data/seed/catalog.py data/seed/seed.py backend/tests/test_seed.py
git commit -m "Seed a few conversations so the channels are not empty"
```

---

### Task 6: 前端的 API、分組與輪詢

**Files:**
- Create: `frontend/src/api/channels.ts`
- Create: `frontend/src/lib/channels.ts`、`frontend/src/lib/channels.test.ts`
- Create: `frontend/src/lib/count-poller.ts`
- Modify: `frontend/src/lib/manager-replies.ts`（改用 `CountPoller`，對外的名字不變）
- Create: `frontend/src/lib/channel-unread.ts`

**Interfaces:**
- Consumes: Task 4 的 HTTP API
- Produces:
  - `api/channels.ts`：型別 `ChannelKind`、`Channel`、`ChannelMessage`；函式 `listChannels(signal?)`、`getChannelUnread(signal?)`、`getChannel(id, signal?)`、`listMessages(id, { after?, before? }, signal?)`、`postMessage(id, body)`、`markRead(id, messageId)`、`listThreads(id, signal?)`、`openCustomerThread(customerId)`
  - `lib/channels.ts`：`type ChannelSection = { key: string; title: string; channels: Channel[]; places: Channel[] }`；`groupChannels(channels: Channel[]): ChannelSection[]`；`sortUnreadFirst(channels: Channel[]): Channel[]`；`mergeMessages(current: ChannelMessage[], incoming: ChannelMessage[]): ChannelMessage[]`；`MESSAGE_PAGE = 50`
  - `lib/count-poller.ts`：`class CountPoller`（`subscribe`、`getSnapshot`、`refresh`）
  - `lib/channel-unread.ts`：`channelUnread: CountPoller`、`useChannelUnread(): number`
  - `lib/manager-replies.ts`：`managerReplies`、`useUnseenReplies` 照舊

- [ ] **Step 1: 寫會失敗的測試**

新增 `frontend/src/lib/channels.test.ts`：

```ts
import { describe, expect, it } from "vitest"

import type { Channel, ChannelMessage } from "@/api/channels"
import { groupChannels, mergeMessages, sortUnreadFirst } from "@/lib/channels"

const channel = (id: number, kind: Channel["kind"], name: string, region_id: string | null, extra: Partial<Channel> = {}) =>
  ({ id, kind, name, region_id, unread: 0, archived: false, ...extra }) as Channel
const message = (id: number) => ({ id, body: `第 ${id} 則` }) as ChannelMessage

describe("groupChannels", () => {
  it("全國一段，每一區一段（整區、小組在上，地點另外收合），封存的最後", () => {
    const sections = groupChannels([
      channel(1, "national", "全國", null),
      channel(2, "region", "北區", "TW.N"),
      channel(5, "team", "陳建宏小組", "TW.N"),
      channel(9, "place", "台北市・大安區", "TW.N"),
      channel(3, "region", "南區", "TW.S"),
      channel(6, "team", "許文彬小組", "TW.S"),
      channel(7, "team", "蔡宗翰小組", null, { archived: true }),
    ])
    expect(sections.map((s) => [s.title, s.channels.map((c) => c.name), s.places.map((c) => c.name)])).toEqual([
      ["全國", ["全國"], []],
      ["北區", ["北區", "陳建宏小組"], ["台北市・大安區"]],
      ["南區", ["南區", "許文彬小組"], []],
      ["已封存", ["蔡宗翰小組"], []],
    ])
  })
})

describe("sortUnreadFirst", () => {
  it("有未讀的排前面，其餘照原本的順序", () => {
    const places = [channel(1, "place", "中正", "TW.N"), channel(2, "place", "大同", "TW.N", { unread: 2 }), channel(3, "place", "中山", "TW.N")]
    expect(sortUnreadFirst(places).map((c) => c.name)).toEqual(["大同", "中正", "中山"])
  })
})

describe("mergeMessages", () => {
  it("輪詢拿到的接在後面，自己剛送出又被輪詢拿到的只留一份", () => {
    expect(mergeMessages([message(1), message(3)], [message(3), message(4)]).map((m) => m.id)).toEqual([1, 3, 4])
  })

  it("往上捲拿到的舊訊息放到前面", () => {
    expect(mergeMessages([message(5), message(6)], [message(2), message(3)]).map((m) => m.id)).toEqual([2, 3, 5, 6])
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run（在 `frontend/`）：`npm test -- src/lib/channels.test.ts`
Expected: FAIL（找不到 `@/api/channels`、`@/lib/channels`）

- [ ] **Step 3: API 呼叫**

新增 `frontend/src/api/channels.ts`：

```ts
import { jsonBody, request } from "@/api/client"

// national 全國；region 整區；team 一位主管帶的小組；place 地點（縣市，台北市到行政區）；customer 一家客戶的討論串
export type ChannelKind = "national" | "region" | "team" | "place" | "customer"

export type Channel = {
  id: number
  kind: ChannelKind
  name: string
  // 所在的區（TW.N），頻道列表依這個分組；全國與封存的頻道是 null
  region_id: string | null
  parent_id: number | null
  // 主管已經不在的小組頻道：只剩 IT 看得到，不能再發言
  archived: boolean
  customer_id: string | null
  // 輸入框上的提示：誰看得到這裡的訊息
  audience: string
  unread: number
  last_message_at: string | null
}

export type ChannelMessage = {
  id: number
  // user 人發的；ai AI 主理；notice 拜訪的風險通報
  kind: "user" | "ai" | "notice"
  author_id: string | null
  author_name: string | null
  body: string
  created_at: string
  mine: boolean
}

/** 看得到的頻道，不含客戶討論串；後端已經依全國 → 各區排好 */
export function listChannels(signal?: AbortSignal) {
  return request<Channel[]>("/api/channels", { signal })
}

/** 分頁列紅點的數字：全國、自己的區、自己的小組、自己負責的客戶討論串 */
export function getChannelUnread(signal?: AbortSignal) {
  return request<{ count: number }>("/api/channels/unread", { signal })
}

export function getChannel(id: number, signal?: AbortSignal) {
  return request<Channel>(`/api/channels/${id}`, { signal })
}

/** 由舊到新。after 給輪詢用，before 給往上捲；都不給就是最新的一頁 */
export function listMessages(id: number, params: { after?: number; before?: number }, signal?: AbortSignal) {
  const query = new URLSearchParams()
  if (params.after !== undefined) query.set("after", String(params.after))
  if (params.before !== undefined) query.set("before", String(params.before))
  const suffix = query.toString() ? `?${query}` : ""
  return request<ChannelMessage[]>(`/api/channels/${id}/messages${suffix}`, { signal })
}

export function postMessage(id: number, body: string) {
  return request<ChannelMessage>(`/api/channels/${id}/messages`, jsonBody("POST", { body }))
}

export function markRead(id: number, messageId: number) {
  return request<void>(`/api/channels/${id}/read`, jsonBody("POST", { message_id: messageId }))
}

/** 地點頻道底下有人發過言的客戶討論串 */
export function listThreads(id: number, signal?: AbortSignal) {
  return request<Channel[]>(`/api/channels/${id}/threads`, { signal })
}

/** 這家客戶的討論串，沒有就建一個 */
export function openCustomerThread(customerId: string) {
  return request<Channel>(`/api/customers/${customerId}/thread`, { method: "POST" })
}
```

- [ ] **Step 4: 分組與合併**

新增 `frontend/src/lib/channels.ts`：

```ts
import type { Channel, ChannelMessage } from "@/api/channels"

// 後端一次給幾則；往上捲拿到比這個少，就是到頂了
export const MESSAGE_PAGE = 50

export type ChannelSection = { key: string; title: string; channels: Channel[]; places: Channel[] }

/** 頻道列表的分段：全國一段；每一區一段，整區與小組在上面，地點另外放（畫面上收合）；封存的最後。
 * 後端已經排好順序，這裡只分組 */
export function groupChannels(channels: Channel[]): ChannelSection[] {
  const sections: ChannelSection[] = []
  const national = channels.filter((c) => c.kind === "national")
  if (national.length) sections.push({ key: "national", title: "全國", channels: national, places: [] })
  for (const region of channels.filter((c) => c.kind === "region")) {
    const inRegion = channels.filter((c) => c.region_id === region.region_id && !c.archived)
    sections.push({
      key: region.region_id ?? String(region.id),
      title: region.name,
      channels: [region, ...inRegion.filter((c) => c.kind === "team")],
      places: sortUnreadFirst(inRegion.filter((c) => c.kind === "place")),
    })
  }
  const archived = channels.filter((c) => c.archived)
  if (archived.length) sections.push({ key: "archived", title: "已封存", channels: archived, places: [] })
  return sections
}

/** 有未讀的排前面，其餘照原本的順序（sort 是穩定排序） */
export function sortUnreadFirst(channels: Channel[]) {
  return [...channels].sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0))
}

/** 新拿到的訊息併進畫面上的：同一則只留一份（自己剛送出的，下一輪輪詢又會拿到），照編號由舊到新 */
export function mergeMessages(current: ChannelMessage[], incoming: ChannelMessage[]) {
  const byId = new Map(current.map((m) => [m.id, m]))
  for (const message of incoming) byId.set(message.id, message)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}
```

- [ ] **Step 5: 跑測試確認通過**

Run（在 `frontend/`）：`npm test -- src/lib/channels.test.ts`
Expected: PASS

- [ ] **Step 6: 共用的數字輪詢**

新增 `frontend/src/lib/count-poller.ts`，內容是原本 `lib/manager-replies.ts` 的 class，改成吃一個取數字的函式：

```ts
// 紅點數字不像聊天，晚一分鐘看到沒關係；一分鐘問一次，一台手機一天最多 1,440 個很小的請求
const POLL_MS = 60_000

/** 有畫面在看的時候，每分鐘問一次某個數字（主管回覆、頻道未讀）。手機從背景切回來、恢復連線時先問一次 */
export class CountPoller {
  private count = 0
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly fetchCount: () => Promise<{ count: number }>

  constructor(fetchCount: () => Promise<{ count: number }>) {
    this.fetchCount = fetchCount
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.start()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop()
    }
  }

  getSnapshot = () => this.count

  /** 看過之後馬上重問一次，紅點不必等下一分鐘才消失 */
  refresh = async () => {
    if (document.visibilityState === "hidden" || !navigator.onLine) return
    try {
      const { count } = await this.fetchCount()
      if (count === this.count) return
      this.count = count
      this.listeners.forEach((listener) => listener())
    } catch {
      // 連不上就等下一輪
    }
  }

  private readonly onWake = () => void this.refresh()

  private start() {
    void this.refresh()
    this.timer = setInterval(this.onWake, POLL_MS)
    document.addEventListener("visibilitychange", this.onWake)
    window.addEventListener("online", this.onWake)
  }

  private stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    document.removeEventListener("visibilitychange", this.onWake)
    window.removeEventListener("online", this.onWake)
  }
}
```

`frontend/src/lib/manager-replies.ts` 整份換成：

```ts
import { useSyncExternalStore } from "react"

import { getUnseenCount } from "@/api/escalations"
import { CountPoller } from "@/lib/count-poller"

/** 業務還沒看過的主管回覆有幾則（FR-8.4「有回覆會通知你」）。有畫面在看的時候，每分鐘問一次 */
export const managerReplies = new CountPoller(() => getUnseenCount())

export function useUnseenReplies() {
  return useSyncExternalStore(managerReplies.subscribe, managerReplies.getSnapshot)
}
```

新增 `frontend/src/lib/channel-unread.ts`：

```ts
import { useSyncExternalStore } from "react"

import { getChannelUnread } from "@/api/channels"
import { CountPoller } from "@/lib/count-poller"

/** 頻道分頁與標頭按鈕上的紅點。讀過一個頻道之後呼叫 channelUnread.refresh()，紅點馬上更新 */
export const channelUnread = new CountPoller(() => getChannelUnread())

export function useChannelUnread() {
  return useSyncExternalStore(channelUnread.subscribe, channelUnread.getSnapshot)
}
```

- [ ] **Step 7: 型別、lint、測試**

Run（在 `frontend/`）：`npm run typecheck && npm run lint && npm test`
Expected: 全部通過

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/channels.ts frontend/src/lib/channels.ts frontend/src/lib/channels.test.ts frontend/src/lib/count-poller.ts frontend/src/lib/manager-replies.ts frontend/src/lib/channel-unread.ts
git commit -m "Add the channel API client and a shared count poller"
```

---

### Task 7: 前端畫面

**Files:**
- Create: `frontend/src/components/channels-link.tsx`、`frontend/src/components/channel-row.tsx`
- Create: `frontend/src/pages/channels.tsx`、`frontend/src/pages/channel.tsx`、`frontend/src/pages/channel-threads.tsx`
- Modify: `frontend/src/components/bottom-nav.tsx`
- Modify: `frontend/src/pages/manager.tsx:65-76`、`frontend/src/pages/admin.tsx:84-96`（標頭）
- Modify: `frontend/src/pages/customer.tsx:92-96`（標頭）
- Modify: `frontend/src/pages/privacy.tsx:11,52,93`
- Modify: `frontend/src/App.tsx`（路由）

**Interfaces:**
- Consumes: Task 6 的 `api/channels.ts`、`lib/channels.ts`、`lib/channel-unread.ts`
- Produces: 路由 `/channels`、`/channels/:channelId`、`/channels/:channelId/threads`；頻道頁接受 `location.state = { backTo?: string }`

- [ ] **Step 1: 標頭的頻道按鈕**

新增 `frontend/src/components/channels-link.tsx`：

```tsx
import { MessagesSquare } from "lucide-react"
import { Link } from "react-router"

import { useChannelUnread } from "@/lib/channel-unread"

/** 主管端與組織管理頁沒有底部分頁列，頻道的入口放在標頭，紅點一樣每分鐘更新 */
export function ChannelsLink() {
  const unread = useChannelUnread()
  return (
    <Link
      to="/channels"
      aria-label={unread ? `頻道，${unread} 則未讀` : "頻道"}
      className="relative flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
    >
      <MessagesSquare className="size-5" />
      {unread > 0 && <UnreadDot count={unread} className="absolute top-1.5 right-1" />}
    </Link>
  )
}

export function UnreadDot({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white",
        className
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}
```

（`channels-link.tsx` 另外 import `{ cn } from "@/lib/utils"`。）

新增 `frontend/src/components/channel-row.tsx`，頻道列表與客戶討論串清單共用的一列：

```tsx
import { Link } from "react-router"

import type { Channel } from "@/api/channels"
import { UnreadDot } from "@/components/channels-link"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

/** 頻道列表、客戶討論串清單的一列：名稱（有未讀就粗體）、最近一則的時間、未讀數。
 * backTo 是進到頻道後返回鍵要回哪裡，沒給就回頻道列表 */
export function ChannelRow({ channel, indent = false, backTo }: { channel: Channel; indent?: boolean; backTo?: string }) {
  return (
    <Link
      to={`/channels/${channel.id}`}
      state={backTo ? { backTo } : undefined}
      className={cn("flex min-h-12 items-center gap-3 border-t py-2 pr-4 first:border-t-0", indent ? "pl-10" : "pl-4")}
    >
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm", channel.unread > 0 && "font-semibold")}>{channel.name}</p>
        {channel.last_message_at && (
          <p className="text-[11px] text-muted-foreground">最近 {formatDateTime(channel.last_message_at)}</p>
        )}
      </div>
      {channel.unread > 0 && <UnreadDot count={channel.unread} />}
    </Link>
  )
}
```

`frontend/src/pages/manager.tsx` 的標頭 `trailing`，在設定按鈕前面加 `<ChannelsLink />`（並 import `{ ChannelsLink } from "@/components/channels-link"`）：

```tsx
        trailing={
          <>
            <ChannelsLink />
            {user?.role === "it" && (
              <Link to="/admin" aria-label="組織管理" className={HEADER_BUTTON}>
                <Network className="size-5" />
              </Link>
            )}
            <Link to="/settings" aria-label="帳號設定" className={HEADER_BUTTON}>
              <Settings className="size-5" />
            </Link>
          </>
        }
```

`frontend/src/pages/admin.tsx` 的標頭 `trailing` 改成：

```tsx
        trailing={
          <>
            <ChannelsLink />
            <Link
              to="/settings"
              aria-label="帳號設定"
              className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <Settings className="size-5" />
            </Link>
          </>
        }
```

- [ ] **Step 2: 底部分頁列**

`frontend/src/components/bottom-nav.tsx`：

```tsx
import { BadgePercent, CalendarDays, MessageCircleQuestion, MessagesSquare, Users } from "lucide-react"
import { NavLink } from "react-router"

import { UnreadDot } from "@/components/channels-link"
import { useChannelUnread } from "@/lib/channel-unread"
import { useUploadQueue } from "@/lib/offline-queue"
import { cn } from "@/lib/utils"

const TABS = [
  { to: "/", label: "今日", icon: CalendarDays },
  { to: "/customers", label: "客戶", icon: Users },
  { to: "/channels", label: "頻道", icon: MessagesSquare },
  { to: "/ask", label: "問答", icon: MessageCircleQuestion },
  { to: "/promotions", label: "促銷", icon: BadgePercent },
]
```

元件本體：`const pending = ...` 下一行加 `const unread = useChannelUnread()`；原本 `{to === "/customers" && pending > 0 && (...)}` 那段後面加：

```tsx
            {to === "/channels" && unread > 0 && <UnreadDot count={unread} className="absolute -top-1.5 -right-2.5" />}
```

- [ ] **Step 3: 頻道列表頁**

新增 `frontend/src/pages/channels.tsx`：

```tsx
import { useEffect, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

import { listChannels, type Channel } from "@/api/channels"
import { BottomNav } from "@/components/bottom-nav"
import { ChannelRow } from "@/components/channel-row"
import { UnreadDot } from "@/components/channels-link"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { homePath, useAuth } from "@/lib/auth"
import { groupChannels } from "@/lib/channels"

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; channels: Channel[] }

/** 頻道列表：全國、自己的區、自己的小組、區裡的地點。IT 看得到每一區每一組 */
export function ChannelsPage() {
  const user = useAuth()?.user
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [openPlaces, setOpenPlaces] = useState<Set<string>>(new Set())

  useEffect(() => {
    const controller = new AbortController()
    const load = () =>
      listChannels(controller.signal)
        .then((channels) => setState({ status: "ready", channels }))
        .catch(() => {
          if (!controller.signal.aborted) setState((s) => (s.status === "ready" ? s : { status: "error" }))
        })
    void load()
    // 從頻道回來、手機切回前景時更新未讀數
    const onVisible = () => document.visibilityState === "visible" && void load()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      controller.abort()
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [attempt])

  const sales = user?.role === "sales"
  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader title="頻道" backTo={sales || !user ? undefined : homePath(user.role)} />
      <main className="flex flex-1 flex-col gap-5 px-4 pt-4 pb-24">
        {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入頻道中…</p>}
        {state.status === "error" && (
          <Notice text="連不上伺服器，頻道沒有載入。" action={{ label: "重新載入", onClick: () => setAttempt((n) => n + 1) }} />
        )}
        {state.status === "ready" &&
          groupChannels(state.channels).map((section) => {
            const open = openPlaces.has(section.key)
            const placeUnread = section.places.reduce((sum, c) => sum + c.unread, 0)
            return (
              <section key={section.key} className="flex flex-col gap-1">
                <p className="px-1 text-xs font-semibold text-muted-foreground">{section.title}</p>
                <div className="overflow-hidden rounded-2xl border bg-card">
                  {section.channels.map((channel) => (
                    <ChannelRow key={channel.id} channel={channel} />
                  ))}
                  {section.places.length > 0 && (
                    <button
                      type="button"
                      className="flex min-h-12 w-full items-center gap-2 border-t px-4 text-left text-sm"
                      aria-expanded={open}
                      onClick={() =>
                        setOpenPlaces((prev) => {
                          const next = new Set(prev)
                          if (open) next.delete(section.key)
                          else next.add(section.key)
                          return next
                        })
                      }
                    >
                      {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      <span className="flex-1">地點（{section.places.length}）</span>
                      {placeUnread > 0 && <UnreadDot count={placeUnread} />}
                    </button>
                  )}
                  {open && section.places.map((channel) => <ChannelRow key={channel.id} channel={channel} indent />)}
                </div>
              </section>
            )
          })}
      </main>
      {sales && <BottomNav />}
    </div>
  )
}
```

- [ ] **Step 4: 頻道頁**

新增 `frontend/src/pages/channel.tsx`：

```tsx
import { useEffect, useRef, useState } from "react"
import { SendHorizontal, Store } from "lucide-react"
import { Link, useLocation, useParams } from "react-router"

import { ApiError } from "@/api/client"
import { getChannel, listMessages, markRead, postMessage, type Channel, type ChannelMessage } from "@/api/channels"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { channelUnread } from "@/lib/channel-unread"
import { MESSAGE_PAGE, mergeMessages } from "@/lib/channels"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

// 打開頻道時每 3 秒問一次新訊息；畫面在背景就不問
const POLL_MS = 3_000
const MAX_LENGTH = 2000
const KIND_LABEL: Record<Channel["kind"], string> = {
  national: "全國頻道",
  region: "整區頻道",
  team: "小組頻道",
  place: "地點頻道",
  customer: "客戶討論串",
}

export type ChannelLocationState = { backTo?: string }
type LoadState = { status: "loading" } | { status: "error"; missing: boolean } | { status: "ready"; channel: Channel }

/** 頻道頁：訊息由舊到新，最新的在最下面；往上捲可以載入更早的。
 * 換頻道（從討論串跳到另一個）時用 key 整個重來，不必在 effect 裡把每個狀態清回初始值 */
export function ChannelPage() {
  const id = Number(useParams().channelId)
  return <ChannelView key={id} id={id} />
}

function ChannelView({ id }: { id: number }) {
  const { backTo = "/channels" } = (useLocation().state as ChannelLocationState | null) ?? {}
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [messages, setMessages] = useState<ChannelMessage[]>([])
  const [hasOlder, setHasOlder] = useState(false)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const lastId = messages.at(-1)?.id

  // 頻道資訊與最新一頁
  useEffect(() => {
    const controller = new AbortController()
    Promise.all([getChannel(id, controller.signal), listMessages(id, {}, controller.signal)])
      .then(([channel, page]) => {
        setState({ status: "ready", channel })
        setMessages(page)
        setHasOlder(page.length === MESSAGE_PAGE)
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setState({ status: "error", missing: error instanceof ApiError && error.status === 404 })
      })
    return () => controller.abort()
  }, [id])

  // 輪詢新訊息
  useEffect(() => {
    if (state.status !== "ready") return
    const controller = new AbortController()
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden" || !navigator.onLine) return
      listMessages(id, { after: lastId ?? 0 }, controller.signal)
        .then((page) => page.length && setMessages((current) => mergeMessages(current, page)))
        .catch(() => {
          // 連不上就等下一輪
        })
    }, POLL_MS)
    return () => {
      clearInterval(timer)
      controller.abort()
    }
  }, [id, lastId, state.status])

  // 看到最新一則就算讀過，紅點跟著更新；新訊息進來捲到最下面
  useEffect(() => {
    if (lastId === undefined) return
    bottom.current?.scrollIntoView({ block: "end" })
    markRead(id, lastId)
      .then(() => channelUnread.refresh())
      .catch(() => {
        // 下一則進來會再記一次
      })
  }, [id, lastId])

  async function loadOlder() {
    const first = messages[0]?.id
    if (first === undefined) return
    const page = await listMessages(id, { before: first }).catch(() => [])
    setMessages((current) => mergeMessages(page, current))
    setHasOlder(page.length === MESSAGE_PAGE)
  }

  async function send() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setSendError(null)
    try {
      const message = await postMessage(id, body)
      setMessages((current) => mergeMessages(current, [message]))
      setDraft("")
    } catch (error) {
      setSendError(error instanceof ApiError ? error.message : "沒有送出，請再試一次")
    } finally {
      setSending(false)
    }
  }

  if (state.status !== "ready") {
    return (
      <div className="flex min-h-svh flex-col">
        <PageHeader title="頻道" backTo={backTo} />
        <main className="flex-1 p-4">
          {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>}
          {state.status === "error" && (
            <Notice text={state.missing ? "找不到這個頻道，或是你看不到它。" : "連不上伺服器，頻道沒有載入。"} />
          )}
        </main>
      </div>
    )
  }

  const { channel } = state
  return (
    <div className="flex h-svh flex-col">
      <PageHeader title={channel.name} subtitle={KIND_LABEL[channel.kind]} backTo={backTo} />
      {channel.kind === "place" && (
        <Link to={`/channels/${channel.id}/threads`} className="flex min-h-11 items-center gap-2 border-b px-4 text-sm text-primary">
          <Store className="size-4" />
          這裡的客戶討論串
        </Link>
      )}
      <main className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {hasOlder && (
          <Button variant="ghost" className="self-center text-xs" onClick={() => void loadOlder()}>
            載入更早的訊息
          </Button>
        )}
        {messages.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">還沒有人發言。</p>}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        <div ref={bottom} />
      </main>
      <footer className="border-t bg-card px-4 pt-2 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        {channel.archived ? (
          <p className="py-2 text-center text-sm text-muted-foreground">這個小組頻道已封存，不能再發言。</p>
        ) : (
          <>
            <p className="pb-1 text-[11px] text-muted-foreground">{channel.audience}</p>
            {sendError && <p className="pb-1 text-xs text-destructive">{sendError}</p>}
            <div className="flex items-end gap-2">
              <Textarea
                value={draft}
                maxLength={MAX_LENGTH}
                rows={1}
                placeholder="回報一件事…"
                className="max-h-32 min-h-11 flex-1 resize-none"
                onChange={(event) => setDraft(event.target.value)}
              />
              <Button className="size-11 shrink-0" aria-label="送出" disabled={!draft.trim() || sending} onClick={() => void send()}>
                <SendHorizontal className="size-4" />
              </Button>
            </div>
          </>
        )}
      </footer>
    </div>
  )
}

function MessageBubble({ message }: { message: ChannelMessage }) {
  if (message.kind !== "user") {
    // AI 主理與風險通報（第 3 階段）先用同一種樣式
    return (
      <div className="rounded-xl bg-muted px-3 py-2 text-sm">
        <p className="text-[11px] text-muted-foreground">
          {message.kind === "ai" ? "AI 主理" : "風險通報"} · {formatDateTime(message.created_at)}
        </p>
        <p className="whitespace-pre-wrap">{message.body}</p>
      </div>
    )
  }
  return (
    <div className={cn("flex max-w-[85%] flex-col gap-0.5", message.mine ? "self-end items-end" : "self-start")}>
      <p className="px-1 text-[11px] text-muted-foreground">
        {message.mine ? "" : `${message.author_name} · `}
        {formatDateTime(message.created_at)}
      </p>
      <p
        className={cn(
          "rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap",
          message.mine ? "bg-primary text-primary-foreground" : "border bg-card"
        )}
      >
        {message.body}
      </p>
    </div>
  )
}
```

- [ ] **Step 5: 客戶討論串清單頁**

新增 `frontend/src/pages/channel-threads.tsx`：

```tsx
import { useEffect, useState } from "react"
import { useParams } from "react-router"

import { getChannel, listThreads, type Channel } from "@/api/channels"
import { ChannelRow } from "@/components/channel-row"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; place: Channel; threads: Channel[] }

/** 地點頻道底下有人發過言的客戶討論串。沒發過言的從客戶檔案的「討論串」按鈕開 */
export function ChannelThreadsPage() {
  const id = Number(useParams().channelId)
  const [state, setState] = useState<LoadState>({ status: "loading" })

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([getChannel(id, controller.signal), listThreads(id, controller.signal)])
      .then(([place, threads]) => setState({ status: "ready", place, threads }))
      .catch(() => !controller.signal.aborted && setState({ status: "error" }))
    return () => controller.abort()
  }, [id])

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title={state.status === "ready" ? state.place.name : "客戶討論串"}
        subtitle="客戶討論串"
        backTo={`/channels/${id}`}
      />
      <main className="flex flex-1 flex-col gap-3 px-4 pt-4 pb-10">
        {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>}
        {state.status === "error" && <Notice text="連不上伺服器，討論串沒有載入。" />}
        {state.status === "ready" && state.threads.length === 0 && (
          <Notice text="這裡的客戶還沒有人開討論串。要開一個，從客戶檔案右上角的「討論串」進去。" />
        )}
        {state.status === "ready" && state.threads.length > 0 && (
          <div className="overflow-hidden rounded-2xl border bg-card">
            {state.threads.map((thread) => (
              <ChannelRow key={thread.id} channel={thread} backTo={`/channels/${id}/threads`} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 6: 客戶檔案的「討論串」按鈕**

`frontend/src/pages/customer.tsx`：import 區的 lucide 改成 `import { FileText, Handshake, MessagesSquare, Mic } from "lucide-react"`，並加 `import { openCustomerThread } from "@/api/channels"`。`const [attempt, setAttempt] = useState(0)` 下一行加：

```tsx
  const [threadError, setThreadError] = useState<string | null>(null)

  async function openThread() {
    setThreadError(null)
    try {
      const thread = await openCustomerThread(customerId)
      navigate(`/channels/${thread.id}`, { state: { backTo: `/customers/${customerId}` } })
    } catch {
      setThreadError("討論串沒有打開，請再試一次")
    }
  }
```

有資料時的 `PageHeader` 改成：

```tsx
      <PageHeader
        title={customer.name}
        subtitle={`${CUSTOMER_TYPE_LABEL[customer.type]} · ${customer.grade} 級 · ${customer.region}`}
        backTo={backTo}
        trailing={
          <button
            type="button"
            aria-label="討論串"
            onClick={() => void openThread()}
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <MessagesSquare className="size-5" />
          </button>
        }
      />
```

`{flash && ...}` 下一行加：

```tsx
        {threadError && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{threadError}</p>}
```

- [ ] **Step 7: 路由**

`frontend/src/App.tsx`：import 加

```tsx
import { ChannelPage } from "@/pages/channel"
import { ChannelThreadsPage } from "@/pages/channel-threads"
import { ChannelsPage } from "@/pages/channels"
```

`<Route path="/ask" element={<AskPage />} />` 下一行加：

```tsx
            {/* 頻道：業務、主管、IT 都進得去，看得到哪些頻道由後端依組織樹決定 */}
            <Route path="/channels" element={<ChannelsPage />} />
            <Route path="/channels/:channelId" element={<ChannelPage />} />
            <Route path="/channels/:channelId/threads" element={<ChannelThreadsPage />} />
```

- [ ] **Step 8: 隱私權政策**

`frontend/src/pages/privacy.tsx`：

- `const UPDATED = "2026 年 9 月 17 日"` 改成實作當天的日期，格式照舊（例如 `"2026 年 9 月 28 日"`）。
- 第 52 行「問答的提問、語音問答的聲音、拜訪錄音、逐字稿與整理出來的拜訪紀錄、報價草稿。」改成「問答的提問、語音問答的聲音、拜訪錄音、逐字稿與整理出來的拜訪紀錄、報價草稿、在頻道裡發的訊息。」
- 第 93 行「帳號、提問與報價草稿：保留到你刪除帳號為止。」改成「帳號、提問、頻道訊息與報價草稿：保留到你刪除帳號為止。」

- [ ] **Step 9: 型別、lint、測試、建置**

Run（在 `frontend/`）：`npm run typecheck && npm run lint && npm test && npm run build`
Expected: 全部通過

- [ ] **Step 10: 在瀏覽器實際跑一次**

照 README 啟動資料庫、重灌資料、API 與前端（`uv run --project backend python data/seed/seed.py`、uvicorn、`npm run dev`），用 `u01@meddemo.tw`（密碼 `meddemo1234`）登入，確認：

1. 底部分頁列有「頻道」，紅點是 3。
2. 頻道列表：全國、北區（北區、陳建宏小組、地點（13）收合）。展開地點，大安區排在最前面（有未讀）。
3. 進陳建宏小組：看到 5 則灌好的對話，自己的在右邊；輸入框上寫「只有陳建宏小組看得到」。發一則，馬上出現在最下面；回列表，紅點變少。
4. 另開一個無痕視窗用 `u02@meddemo.tw` 登入，進同一個小組頻道，3 秒內看到 U01 剛發的那則。
5. 大安區 → 「這裡的客戶討論串」列出忠孝店；客戶檔案（C001）右上角「討論串」打開同一個討論串，返回鍵回客戶檔案。
6. 用 `m01@meddemo.tw` 登入：主管端標頭有頻道按鈕、紅點 5。用 IT 帳號登入：組織管理頁標頭有頻道按鈕，列表有三個區、四個小組。
7. 用 `u04@meddemo.tw` 登入：看不到北區與陳建宏小組；直接打開陳建宏小組的網址顯示「找不到這個頻道」。

- [ ] **Step 11: Commit**

```bash
git add frontend/src
git commit -m "Add the channel list, channel page and customer threads to the app"
```

---

## 完成後

- 跑一次完整檢查：`uv run --project backend pytest backend/tests -q`，以及在 `frontend/` 裡 `npm run typecheck && npm run lint && npm test && npm run build`。
- 第 2 階段（記憶）另寫一份計畫：`memory_item`、整理記憶的背景工作、記憶看板、往上傳與撤回。
