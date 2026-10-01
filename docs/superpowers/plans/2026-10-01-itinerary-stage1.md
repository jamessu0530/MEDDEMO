# 行程第一階段：位置資料、排序程式、行程存檔 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 今日路線改成「當天第一次讀取時照模型的建議建一份存在伺服器、照順路排」，三顆鈕與問答的「排入今天的路線」改成直接改這份存著的行程；首頁看起來跟現在一樣。

**Architecture:** 客戶補上大概的經緯度（地區中心點加依 id 錯開），區處辦公室是出發點。`travel.py` 用直線估算車程矩陣，`route_planner.py` 是純函式的排序程式（窮舉、剪枝、守規則），`itinerary.py` 管存檔、版本與三顆鈕。`today_route.py` 只留「挑哪幾家」。API 從 `POST /api/route/today` 換成 `GET /api/itinerary/today` 等三支；手機上的 `route-feedback.ts` 拿掉。

**Tech Stack:** FastAPI、SQLAlchemy 2（Postgres）、pytest；React 19、TypeScript、vitest。

**設計文件：** `docs/superpowers/specs/2026-10-01-itinerary-planning-design.md`（本計畫是〈分階段做〉的第 1 階段，另含原屬第 2 階段的「問答『排入今天的路線』改接」，因為拿掉手機上的回饋之後它非改不可）。

## Global Constraints

- 一律用繁體中文寫註解與畫面文字，註解密度與口吻照周圍的程式。
- 畫面不用表情符號；圖示一律 lucide。
- 還沒跑的站最多 8 站（`route_planner.MAX_OPEN_STOPS = 8`）。
- 每站預設停留 40 分鐘（`itinerary.DEFAULT_DURATION = 40`）。
- 還沒跑任何一站時，從業務所屬區處辦公室 09:30 出發（沿用 `today_route.FIRST_STOP`）；跑過了，從最後完成那一站、拜訪時間加停留時間出發。跑完不回辦公室。
- 直線估算：直線距離 × 1.4 ÷ 時速 30 公里，再加 5 分鐘停車；同一點 0 分鐘。
- 暫緩跳過三天（`itinerary.SNOOZE_DAYS = 3`）。
- 行程是誰的由 token 決定：`user.acts_as_user_id or user.id`；主管與 IT 回 403「主管沒有自己的拜訪路線」。
- 版本對不上回 409「行程剛被改過，已幫你重新整理」。
- 假資料產生程式不能多耗亂數：客戶的位置用 id 的雜湊錯開，不用 `rng`。
- 測試一律在隔離的資料庫與 Redis 跑：`TEST_DB_NAME=meddemo_test_itinerary TEST_REDIS_URL=redis://127.0.0.1:6379/9`。

## 執行環境

在 worktree 裡做，不動主目錄（其他對話也在改 main）：

```bash
cd /Users/jamessu/Desktop/computersciencehomework/MEDDEMO
git worktree add .worktrees/itinerary -b itinerary main
cp backend/.env .worktrees/itinerary/backend/.env
cd .worktrees/itinerary/frontend && npm ci
```

之後所有指令都在 `/Users/jamessu/Desktop/computersciencehomework/MEDDEMO/.worktrees/itinerary` 下跑。後端測試：

```bash
TEST_DB_NAME=meddemo_test_itinerary TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/<file> -q
```

`backend/.env` 是 gitignore 的，最後刪掉複製進來的那份。

## 檔案

| 檔案 | 動作 | 職責 |
|---|---|---|
| `data/seed/catalog.py` | 改 | `AREA_DISTRICT`、`DISTRICT_COORDS`、`REGION_OFFICE` |
| `data/seed/generate.py` | 改 | `district_of`、`location_of`；客戶多 `area`／`lat`／`lng`，區處多 `lat`／`lng` |
| `backend/app/models.py` | 改 | `Customer.area/lat/lng`、`OrgUnit.lat/lng`、`Itinerary`、`ItineraryStop`、`ItineraryPrecedence`、`RouteSnooze`、`RouteSignalWeight` |
| `backend/app/services/travel.py` | 新 | 直線估算的車程矩陣 |
| `backend/app/services/route_planner.py` | 新 | 排序（純函式） |
| `backend/app/services/today_route.py` | 改 | 只留「挑哪幾家」：`pick`、`label`、`load_feedback`、`done_visits` |
| `backend/app/services/itinerary.py` | 新 | 建立、讀取、三顆鈕、加站、版本 |
| `backend/app/api/itinerary.py` | 新 | `GET /today`、`POST /today/feedback`、`POST /today/stops` |
| `backend/app/api/route.py` | 刪 | 舊的 `POST /api/route/today` |
| `backend/app/main.py` | 改 | 換 router |
| `backend/tests/test_seed.py` | 改 | 位置的測試 |
| `backend/tests/test_travel.py` | 新 | |
| `backend/tests/test_route_planner.py` | 新 | |
| `backend/tests/test_itinerary.py` | 新 | 服務層 |
| `backend/tests/test_itinerary_api.py` | 新 | API |
| `backend/tests/test_today_route.py` | 改 | 改測 `pick` |
| `backend/tests/test_oauth.py` | 改 | 換 API |
| `frontend/src/api/route.ts` | 改 | 新 API 與型別 |
| `frontend/src/pages/today.tsx` | 改 | 三顆鈕打 API |
| `frontend/src/components/ask/ask-result.tsx` | 改 | 「排入今天的路線」打 API |
| `frontend/src/lib/route-feedback.ts` | 刪 | |
| `frontend/src/components/route-path.test.ts` | 改 | 測試資料補新欄位 |
| `README.md` | 改 | 今日路線那一節 |

---

### Task 1: 客戶與區處辦公室的位置

**Files:**
- Modify: `data/seed/catalog.py`（`TAIPEI_BRANCH_DISTRICT` 之後）
- Modify: `data/seed/generate.py:1-20`（import）、`:185-236`（`customer_specs` 之後、`build_customers`）、`:935-938`（`org_units`）
- Modify: `backend/app/models.py:97-110`（`OrgUnit`）、`:207-225`（`Customer`）
- Test: `backend/tests/test_seed.py`

**Interfaces:**
- Produces: `customer.area: str`、`customer.lat: float`、`customer.lng: float`；`org_unit.lat/lng: float | None`（三個區有值）；`generate.district_of(type_, city, area) -> str`、`generate.location_of(customer_id, city, district) -> tuple[float, float]`、`generate.LOCATION_JITTER = 0.004`；`catalog.DISTRICT_COORDS: dict[tuple[str, str], tuple[float, float]]`、`catalog.REGION_OFFICE: dict[str, tuple[float, float]]`。

- [ ] **Step 1: 寫失敗的測試**

加在 `backend/tests/test_seed.py` 最後：

```python
def test_district_names_follow_the_branch_tables():
    # 台北市的連鎖分店照分店對照表；其他分店去掉「店」就是鄉鎮；不是行政區名稱的地區另外對
    assert generate.district_of("chain", "台北市", "忠孝店") == "大安"
    assert generate.district_of("chain", "新北市", "三重店") == "三重"
    assert generate.district_of("chain", "台中市", "逢甲店") == "西屯"
    assert generate.district_of("chain", "彰化縣", "彰化中正店") == "彰化"
    assert generate.district_of("independent", "台北市", "長春") == "中山"
    assert generate.district_of("independent", "台南市", "開元") == "北區"
    assert generate.district_of("clinic", "高雄市", "左營") == "左營"


def test_every_customer_sits_near_its_district_centre(db):
    found = rows(db, "SELECT id, city, area, lat, lng FROM customer")
    assert len(found) > 100
    for customer_id, city, area, lat, lng in found:
        centre_lat, centre_lng = catalog.DISTRICT_COORDS[(city, area)]
        assert abs(lat - centre_lat) <= generate.LOCATION_JITTER + 1e-9, customer_id
        assert abs(lng - centre_lng) <= generate.LOCATION_JITTER + 1e-9, customer_id
    # 同一區的店錯開，地圖上不會疊在同一點
    assert len({(lat, lng) for *_, lat, lng in found}) == len(found)


def test_each_region_has_an_office_to_start_from(db):
    offices = dict(rows(db, "SELECT id, lat FROM org_unit WHERE kind = 'region'"))
    assert set(offices) == set(catalog.REGION_OFFICE)
    assert all(lat is not None for lat in offices.values())
```

`rows(conn, sql)` 是這個檔案第 30 行已經有的小工具。

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_itinerary TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_seed.py -q -k "district or office"`
Expected: FAIL（`generate` 沒有 `district_of`）

- [ ] **Step 3: catalog 加位置資料**

在 `data/seed/catalog.py` 的 `TAIPEI_BRANCH_DISTRICT = {...}` 後面加：

```python
# 今日路線算車程用的位置（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md）。
# 客戶沒有真的地址：先把名稱裡的地區對到行政區或鄉鎮，再取那一區的大概中心點。
# 台北市的連鎖分店照 TAIPEI_BRANCH_DISTRICT；其他連鎖分店去掉「店」字就是鄉鎮，對不上的寫在這裡
AREA_DISTRICT = {
    "公益店": "西區", "文心店": "南屯", "逢甲店": "西屯", "漢口店": "北屯", "大墩店": "南屯",
    "東門店": "東區", "府前店": "中西", "海安店": "中西", "瑞豐店": "左營", "江子翠店": "板橋",
    "彰化中正店": "彰化", "長春": "中山", "逢甲": "西屯", "開元": "北區",
}

# (縣市, 行政區或鄉鎮) → 該區的大概中心點（緯度, 經度）
DISTRICT_COORDS = {
    ("台北市", "中正"): (25.0324, 121.5199), ("台北市", "大同"): (25.0634, 121.5133),
    ("台北市", "中山"): (25.0685, 121.5266), ("台北市", "松山"): (25.0597, 121.5577),
    ("台北市", "大安"): (25.0264, 121.5435), ("台北市", "萬華"): (25.0285, 121.4977),
    ("台北市", "信義"): (25.0330, 121.5654), ("台北市", "士林"): (25.0950, 121.5246),
    ("台北市", "北投"): (25.1321, 121.4987), ("台北市", "內湖"): (25.0689, 121.5889),
    ("台北市", "南港"): (25.0549, 121.6066), ("台北市", "文山"): (24.9887, 121.5700),
    ("新北市", "板橋"): (25.0115, 121.4627), ("新北市", "三重"): (25.0615, 121.4876),
    ("新北市", "中和"): (24.9994, 121.4990), ("新北市", "永和"): (25.0076, 121.5136),
    ("新北市", "新莊"): (25.0359, 121.4502), ("新北市", "新店"): (24.9675, 121.5418),
    ("新北市", "樹林"): (24.9907, 121.4206), ("新北市", "鶯歌"): (24.9555, 121.3546),
    ("新北市", "三峽"): (24.9341, 121.3687), ("新北市", "淡水"): (25.1693, 121.4408),
    ("新北市", "汐止"): (25.0629, 121.6580), ("新北市", "土城"): (24.9723, 121.4434),
    ("新北市", "蘆洲"): (25.0849, 121.4737), ("新北市", "五股"): (25.0828, 121.4381),
    ("新北市", "泰山"): (25.0590, 121.4309), ("新北市", "林口"): (25.0775, 121.3916),
    ("台中市", "西區"): (24.1414, 120.6714), ("台中市", "北屯"): (24.1822, 120.6863),
    ("台中市", "南屯"): (24.1386, 120.6432), ("台中市", "西屯"): (24.1813, 120.6417),
    ("台中市", "豐原"): (24.2521, 120.7182), ("台中市", "大甲"): (24.3489, 120.6223),
    ("台中市", "太平"): (24.1265, 120.7186), ("台中市", "大里"): (24.0994, 120.6779),
    ("台中市", "大雅"): (24.2290, 120.6478), ("台中市", "烏日"): (24.1047, 120.6239),
    ("台中市", "霧峰"): (24.0617, 120.7003), ("台中市", "潭子"): (24.2096, 120.7052),
    ("台中市", "沙鹿"): (24.2333, 120.5660), ("台中市", "清水"): (24.2686, 120.5598),
    ("台中市", "梧棲"): (24.2549, 120.5316), ("台中市", "龍井"): (24.1927, 120.5458),
    ("台中市", "后里"): (24.3047, 120.7107), ("台中市", "東勢"): (24.2586, 120.8279),
    ("彰化縣", "彰化"): (24.0809, 120.5385), ("彰化縣", "員林"): (23.9590, 120.5737),
    ("彰化縣", "鹿港"): (24.0569, 120.4344), ("彰化縣", "和美"): (24.1109, 120.4997),
    ("彰化縣", "溪湖"): (23.9622, 120.4793), ("彰化縣", "北斗"): (23.8705, 120.5203),
    ("彰化縣", "田中"): (23.8574, 120.5807), ("彰化縣", "二林"): (23.8988, 120.3740),
    ("台南市", "中西"): (22.9917, 120.1963), ("台南市", "東區"): (22.9806, 120.2244),
    ("台南市", "北區"): (23.0072, 120.2108), ("台南市", "安平"): (22.9927, 120.1660),
    ("台南市", "安南"): (23.0471, 120.1847), ("台南市", "永康"): (23.0262, 120.2570),
    ("台南市", "仁德"): (22.9718, 120.2516), ("台南市", "歸仁"): (22.9670, 120.2934),
    ("台南市", "新化"): (23.0384, 120.3108), ("台南市", "新市"): (23.0786, 120.2950),
    ("台南市", "善化"): (23.1322, 120.2967), ("台南市", "麻豆"): (23.1817, 120.2481),
    ("台南市", "佳里"): (23.1650, 120.1772), ("台南市", "學甲"): (23.2324, 120.1803),
    ("台南市", "西港"): (23.1231, 120.2034), ("台南市", "新營"): (23.3103, 120.3167),
    ("台南市", "鹽水"): (23.3198, 120.2662), ("台南市", "白河"): (23.3510, 120.4158),
    ("台南市", "柳營"): (23.2780, 120.3112), ("台南市", "關廟"): (22.9627, 120.3279),
    ("高雄市", "鼓山"): (22.6505, 120.2733), ("高雄市", "楠梓"): (22.7275, 120.3264),
    ("高雄市", "新興"): (22.6311, 120.3096), ("高雄市", "小港"): (22.5653, 120.3378),
    ("高雄市", "岡山"): (22.7969, 120.2955), ("高雄市", "鳳山"): (22.6266, 120.3567),
    ("高雄市", "大寮"): (22.6053, 120.3954), ("高雄市", "左營"): (22.6900, 120.2945),
    ("高雄市", "三民"): (22.6474, 120.3165), ("高雄市", "前金"): (22.6276, 120.2943),
    ("高雄市", "苓雅"): (22.6217, 120.3122), ("高雄市", "前鎮"): (22.5957, 120.3138),
    ("高雄市", "鳥松"): (22.6594, 120.3640), ("高雄市", "鹽埕"): (22.6235, 120.2850),
    ("高雄市", "仁武"): (22.7012, 120.3477), ("高雄市", "路竹"): (22.8567, 120.2614),
    ("高雄市", "橋頭"): (22.7575, 120.3058), ("高雄市", "大社"): (22.7305, 120.3473),
    ("高雄市", "旗山"): (22.8886, 120.4834),
}

# 區處辦公室（每天從這裡出發）：北區在台北市中山區、中區在台中市西屯區、南區在高雄市苓雅區
REGION_OFFICE = {
    "TW.N": (25.0520, 121.5440),
    "TW.C": (24.1630, 120.6430),
    "TW.S": (22.6210, 120.3120),
}
```

- [ ] **Step 4: generate 算地區與位置**

`data/seed/generate.py` 開頭的 import 區加 `import hashlib`（照字母順序放）。在 `place_of` 函式後面加：

```python
# 同一區的客戶錯開的最大幅度（度）：0.004 度約 400 公尺，還在同一區裡
LOCATION_JITTER = 0.004


def district_of(type_: str, city: str, area: str) -> str:
    """客戶所在的行政區或鄉鎮（不帶「區」「市」「鎮」），算車程與排序習慣的「地區」用。"""
    if city == "台北市" and type_ == "chain":
        return catalog.TAIPEI_BRANCH_DISTRICT[area]
    if area in catalog.AREA_DISTRICT:
        return catalog.AREA_DISTRICT[area]
    return area.removesuffix("店") if type_ == "chain" else area


def location_of(customer_id: str, city: str, district: str) -> tuple[float, float]:
    """那一區的中心點，依客戶 id 的雜湊錯開。用雜湊不用亂數：不能動到其他資料的亂數序列。"""
    centre = catalog.DISTRICT_COORDS.get((city, district))
    if centre is None:
        raise ValueError(f"{customer_id} 對不到位置（{city}・{district}），請在 catalog.py 的 DISTRICT_COORDS 補上")
    digest = hashlib.sha256(customer_id.encode()).digest()
    lat = centre[0] + (digest[0] / 255 * 2 - 1) * LOCATION_JITTER
    lng = centre[1] + (digest[1] / 255 * 2 - 1) * LOCATION_JITTER
    return round(lat, 6), round(lng, 6)
```

`build_customers` 裡 `customers.append({...})` 改成：

```python
        customer_id = f"C{i:03d}"
        district = district_of(type_, city, area)
        lat, lng = location_of(customer_id, city, district)
        customers.append({
            "id": customer_id, "name": name, "type": type_, "chain_group": group,
            "region": region, "city": city, "place_id": place_of(name, type_, city, area), "grade": grade,
            "contract_end_date": contract_end, "owner_user_id": owner,
            "area": district, "lat": lat, "lng": lng,
        })
```

`generate()` 裡的 `org_units` 改成：

```python
    org_units = [
        {"id": i, "name": n, "kind": k, "parent_id": p,
         "lat": catalog.REGION_OFFICE.get(i, (None, None))[0], "lng": catalog.REGION_OFFICE.get(i, (None, None))[1]}
        for i, n, k, p in catalog.ORG_UNITS
    ]
```

- [ ] **Step 5: models 加欄位**

`backend/app/models.py` 的 `OrgUnit` 在 `parent_id` 後面加：

```python
    # 區處辦公室的位置，今日路線每天從這裡出發；只有三個區有值
    lat: Mapped[float | None]
    lng: Mapped[float | None]
```

`Customer` 在 `owner_user_id` 後面加：

```python
    # 行政區或鄉鎮（「大安」「板橋」），排序習慣的「地區」用；位置是那一區的中心點錯開幾百公尺，
    # 沒有真的地址（data/seed/generate.py 的 location_of）
    area: Mapped[str]
    lat: Mapped[float]
    lng: Mapped[float]
```

- [ ] **Step 6: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_itinerary TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_seed.py -q`
Expected: 全部 PASS（含原本的 `test_generation_is_deterministic`）

- [ ] **Step 7: Commit**

```bash
git add data/seed/catalog.py data/seed/generate.py backend/app/models.py backend/tests/test_seed.py
git commit -m "Give every customer a district and an approximate location, and each region an office"
```

---

### Task 2: 直線估算的車程

**Files:**
- Create: `backend/app/services/travel.py`
- Test: `backend/tests/test_travel.py`

**Interfaces:**
- Produces: `travel.Point = tuple[float, float]`；`travel.Matrix(minutes: list[list[int]], km: list[list[float]], estimated: bool)`；`travel.straight_km(a, b) -> float`；`travel.estimate(a, b) -> tuple[int, float]`；`travel.matrix(points: list[Point]) -> Matrix`。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_travel.py`：

```python
"""車程：直線估算。"""

import pytest

from app.services import travel


def test_straight_distance_between_two_known_points():
    # 台北車站到台北 101 大約 5 公里
    assert travel.straight_km((25.0478, 121.5170), (25.0340, 121.5645)) == pytest.approx(5.0, abs=0.3)


def test_estimate_adds_detour_speed_and_parking():
    # 緯度差 0.1 度約 11.12 公里，乘 1.4 是 15.57 公里，時速 30 要 31 分鐘，加 5 分鐘停車
    minutes, km = travel.estimate((25.0, 121.5), (25.1, 121.5))
    assert km == 15.6
    assert minutes == 36


def test_same_point_needs_no_driving():
    assert travel.estimate((25.0, 121.5), (25.0, 121.5)) == (0, 0.0)


def test_matrix_is_symmetric_with_an_empty_diagonal():
    points = [(25.0, 121.5), (25.1, 121.5), (25.0, 121.6)]
    result = travel.matrix(points)
    assert result.estimated is True
    assert [result.minutes[i][i] for i in range(3)] == [0, 0, 0]
    assert result.minutes[0][1] == result.minutes[1][0] == 36
    assert result.km[0][1] == 15.6
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_itinerary TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_travel.py -q`
Expected: FAIL（`ImportError: cannot import name 'travel'`）

- [ ] **Step 3: 實作**

`backend/app/services/travel.py`：

```python
"""兩點之間開車要多久（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈車程與地圖〉）。

這一版只有直線估算。之後接 Google 的路線矩陣時呼叫端不用改，只換 matrix() 裡面，
Google 連不上或沒設金鑰時再退回這裡的估算。
"""

import math
from dataclasses import dataclass

Point = tuple[float, float]  # (緯度, 經度)

EARTH_RADIUS_KM = 6371.0
# 市區道路比直線長的倍數、平均車速、每到一站找車位的時間：估算用的經驗值
DETOUR_FACTOR = 1.4
SPEED_KMH = 30
PARKING_MINUTES = 5


@dataclass(frozen=True)
class Matrix:
    minutes: list[list[int]]  # minutes[i][j]：從第 i 點開到第 j 點
    km: list[list[float]]
    estimated: bool  # 直線估算的是 True，畫面要註明「估計」


def straight_km(a: Point, b: Point) -> float:
    """地表上兩點的直線距離（半正矢公式）。"""
    lat1, lng1, lat2, lng2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))


def estimate(a: Point, b: Point) -> tuple[int, float]:
    """(分鐘, 公里)。同一點是 0：同一棟樓裡換一家不用開車，也不用再找車位。"""
    if a == b:
        return 0, 0.0
    km = straight_km(a, b) * DETOUR_FACTOR
    return round(km / SPEED_KMH * 60) + PARKING_MINUTES, round(km, 1)


def matrix(points: list[Point]) -> Matrix:
    pairs = [[estimate(a, b) for b in points] for a in points]
    return Matrix(
        minutes=[[m for m, _ in row] for row in pairs],
        km=[[k for _, k in row] for row in pairs],
        estimated=True,
    )
```

- [ ] **Step 4: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_itinerary TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_travel.py -q`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/travel.py backend/tests/test_travel.py
git commit -m "Estimate driving time between two points from the straight-line distance"
```

---

### Task 3: 排序程式

**Files:**
- Create: `backend/app/services/route_planner.py`
- Test: `backend/tests/test_route_planner.py`

**Interfaces:**
- Consumes: 無（純函式；車程矩陣是 `list[list[int]]`）。
- Produces:
  - `MAX_OPEN_STOPS = 8`
  - `PlanStop(customer_id: str, point: int, duration: int, window: tuple[Literal["at","before","after"], dt.time] | None = None)`
  - `Rule(id: str, text: str, kind: Literal["precedence","first","last","lock"], customer_ids: tuple[str, ...], position: int | None = None)`；`precedence` 的 `customer_ids` 是 `(前, 後)`；`lock` 是 `(一家,)` 加 `position`（還沒跑的站裡第幾站，0 起算）
  - `Slot(customer_id: str, arrive: dt.datetime, leave: dt.datetime, travel_minutes: int, late_minutes: int)`
  - `Schedule(slots: list[Slot], late_minutes: int, travel_minutes: int)`
  - `Conflict(rules: list[Rule])`
  - `schedule(start: dt.datetime, start_point: int, ordered: list[PlanStop], minutes: list[list[int]]) -> Schedule`
  - `violations(ordered: list[str], rules: list[Rule]) -> list[Rule]`
  - `plan(start, start_point, stops, rules, minutes) -> Schedule | Conflict`（超過 8 站丟 `ValueError`）
  - `cheapest_insert(start, start_point, ordered, new: PlanStop, rules, minutes) -> int`

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_route_planner.py`：

```python
"""排序程式：守規則、晚到最少、車程最短。"""

import datetime as dt
import random
import time

import pytest

from app.services import route_planner as rp
from app.timeutil import TAIPEI

START = dt.datetime(2026, 10, 28, 9, 0, tzinfo=TAIPEI)
# 一條直線上的點：0 是出發點，每差一格開 10 分鐘
XS = [0, 1, 2, 3, 0.5]
LINE = [[round(abs(a - b) * 10) for b in XS] for a in XS]


def stop(cid, point, duration=30, window=None):
    return rp.PlanStop(customer_id=cid, point=point, duration=duration, window=window)


def order_of(result):
    assert isinstance(result, rp.Schedule), result
    return [s.customer_id for s in result.slots]


def test_picks_the_shortest_drive():
    result = rp.plan(START, 0, [stop("C", 3), stop("A", 1), stop("B", 2)], [], LINE)
    assert order_of(result) == ["A", "B", "C"]
    assert result.travel_minutes == 30


def test_precedence_is_kept_even_when_it_is_longer():
    before_a = rp.Rule(id="today:B>A", text="先 B 再 A", kind="precedence", customer_ids=("B", "A"))
    result = rp.plan(START, 0, [stop("A", 1), stop("B", 2), stop("C", 3)], [before_a], LINE)
    order = order_of(result)
    assert order.index("B") < order.index("A")
    assert result.travel_minutes == 50


def test_lateness_matters_more_than_driving():
    # A 在 30 分鐘外、約 09:40 以前到；先去近的 B 會晚到，所以先去 A，車程比較長也一樣
    far = stop("A", 3, window=("before", dt.time(9, 40)))
    result = rp.plan(START, 0, [stop("B", 1), far], [], LINE)
    assert order_of(result) == ["A", "B"]
    assert result.late_minutes == 0


def test_unavoidable_lateness_is_reported():
    result = rp.plan(START, 0, [stop("A", 3, window=("before", dt.time(9, 10)))], [], LINE)
    assert result.late_minutes == 20
    assert result.slots[0].late_minutes == 20


def test_after_and_at_windows_wait_for_the_time():
    result = rp.schedule(START, 0, [stop("A", 1, duration=20, window=("after", dt.time(10, 0)))], LINE)
    slot = result.slots[0]
    assert slot.arrive == START + dt.timedelta(minutes=10)
    assert slot.leave == dt.datetime(2026, 10, 28, 10, 20, tzinfo=TAIPEI)
    late = rp.schedule(START, 0, [stop("A", 3, window=("at", dt.time(9, 15)))], LINE)
    assert late.slots[0].late_minutes == 15


def test_a_locked_stop_stays_where_it_is():
    lock = rp.Rule(id="lock:C", text="C 排第一站", kind="lock", customer_ids=("C",), position=0)
    result = rp.plan(START, 0, [stop("A", 1), stop("B", 2), stop("C", 3)], [lock], LINE)
    assert order_of(result)[0] == "C"


def test_first_and_last_rules():
    first = rp.Rule(id="habit:1", text="C 排第一", kind="first", customer_ids=("C",))
    last = rp.Rule(id="habit:2", text="A 排最後", kind="last", customer_ids=("A",))
    result = rp.plan(START, 0, [stop("A", 1), stop("B", 2), stop("C", 3)], [first, last], LINE)
    assert order_of(result) == ["C", "B", "A"]


def test_contradicting_rules_are_named():
    a_first = rp.Rule(id="today:A>B", text="先 A 再 B", kind="precedence", customer_ids=("A", "B"))
    b_first = rp.Rule(id="today:B>A", text="先 B 再 A", kind="precedence", customer_ids=("B", "A"))
    result = rp.plan(START, 0, [stop("A", 1), stop("B", 2)], [a_first, b_first], LINE)
    assert isinstance(result, rp.Conflict)
    assert {r.id for r in result.rules} == {"today:A>B", "today:B>A"}


def test_a_lock_that_breaks_a_precedence_is_a_conflict():
    lock = rp.Rule(id="lock:A", text="A 排第一站", kind="lock", customer_ids=("A",), position=0)
    after_b = rp.Rule(id="today:B>A", text="先 B 再 A", kind="precedence", customer_ids=("B", "A"))
    result = rp.plan(START, 0, [stop("A", 1), stop("B", 2)], [lock, after_b], LINE)
    assert isinstance(result, rp.Conflict)
    assert {r.id for r in result.rules} == {"lock:A", "today:B>A"}


def test_rules_about_absent_customers_are_ignored():
    rule = rp.Rule(id="today:X>A", text="先 X 再 A", kind="precedence", customer_ids=("X", "A"))
    assert order_of(rp.plan(START, 0, [stop("A", 1)], [rule], LINE)) == ["A"]


def test_no_stops_is_an_empty_plan():
    result = rp.plan(START, 0, [], [], LINE)
    assert result.slots == [] and result.travel_minutes == 0


def test_more_than_eight_open_stops_is_refused():
    with pytest.raises(ValueError):
        rp.plan(START, 0, [stop(f"S{i}", 1) for i in range(9)], [], LINE)


def test_eight_stops_are_planned_within_a_second():
    rng = random.Random(7)
    points = [(rng.random(), rng.random()) for _ in range(9)]
    minutes = [[round(((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5 * 60) for b in points] for a in points]
    stops = [stop(f"S{i}", i + 1) for i in range(8)]
    began = time.perf_counter()
    result = rp.plan(START, 0, stops, [], minutes)
    assert time.perf_counter() - began < 1.0
    assert len(order_of(result)) == 8


def test_violations_lists_the_broken_rules():
    before = rp.Rule(id="today:B>A", text="先 B 再 A", kind="precedence", customer_ids=("B", "A"))
    lock = rp.Rule(id="lock:C", text="C 排第一站", kind="lock", customer_ids=("C",), position=0)
    last = rp.Rule(id="habit:1", text="B 排最後", kind="last", customer_ids=("B",))
    assert rp.violations(["C", "B", "A"], [before, lock, last]) == [last]
    assert rp.violations(["A", "B", "C"], [before, lock, last]) == [before, lock, last]


def test_cheapest_insert_goes_between_its_neighbours():
    assert rp.cheapest_insert(START, 0, [stop("A", 1), stop("C", 3)], stop("B", 2), [], LINE) == 1


def test_cheapest_insert_does_not_move_a_locked_stop():
    # X 就在出發點旁邊，沒有鎖的話排第一最順（5 + 25 + 10 = 40 分鐘）；
    # A 鎖在第一站，X 只能插在 A 後面，排最後（30 + 10 + 15 = 55）比插中間（30 + 25 + 15 = 70）順
    ordered = [stop("A", 3), stop("C", 2)]
    assert rp.cheapest_insert(START, 0, ordered, stop("X", 4), [], LINE) == 0
    lock = rp.Rule(id="lock:A", text="A 排第一站", kind="lock", customer_ids=("A",), position=0)
    assert rp.cheapest_insert(START, 0, ordered, stop("X", 4), [lock], LINE) == 2
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_itinerary TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_route_planner.py -q`
Expected: FAIL（`ImportError`）

- [ ] **Step 3: 實作**

`backend/app/services/route_planner.py`：

```python
"""排今天的順序（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈排序程式〉）。

純函式：不碰資料庫、不估車程，車程矩陣由呼叫端給。一天還沒跑的站最多 8 站（40,320 種排法），
用深度優先全部試過——違反規則的分支直接剪掉，已經比目前最好的差也剪掉——保證找到最好的那條：
先比晚到分鐘數，一樣再比總車程。

規則分兩級：先後、排第一、排最後、鎖住的位置一定要守，守不住就不排（回 Conflict，講出是哪幾條）；
約的時間盡量守，趕不上照樣排，記下晚到幾分鐘。
"""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass
from typing import Literal

MAX_OPEN_STOPS = 8

WindowKind = Literal["at", "before", "after"]


@dataclass(frozen=True)
class PlanStop:
    customer_id: str
    point: int  # 在車程矩陣裡是第幾點
    duration: int  # 停留幾分鐘
    window: tuple[WindowKind, dt.time] | None = None  # 約的時間：幾點到／以前／以後


@dataclass(frozen=True)
class Rule:
    """一定要守的規則。precedence 的 customer_ids 是 (前, 後)；first、last 是符合的那幾家；
    lock 是一家，加上它在還沒跑的站裡的位置（0 起算）。"""

    id: str
    text: str  # 給人看的一句話，排不出來時拿來講是哪幾條打架
    kind: Literal["precedence", "first", "last", "lock"]
    customer_ids: tuple[str, ...]
    position: int | None = None


@dataclass(frozen=True)
class Slot:
    customer_id: str
    arrive: dt.datetime
    leave: dt.datetime
    travel_minutes: int  # 從上一站（或出發點）開過來
    late_minutes: int


@dataclass(frozen=True)
class Schedule:
    slots: list[Slot]
    late_minutes: int
    travel_minutes: int


@dataclass(frozen=True)
class Conflict:
    """排不出來：拿掉其中任何一條就排得出來的那幾條；找不到單獨一條擋住的，就是全部的規則。"""

    rules: list[Rule]


def _visit(t: dt.datetime, travel: int, stop: PlanStop) -> tuple[dt.datetime, dt.datetime, int]:
    """(到達, 離開, 晚到幾分鐘)。「幾點到」與「以後」早到就等；「幾點到」與「以前」晚到要記下來。"""
    arrive = t + dt.timedelta(minutes=travel)
    begin, late = arrive, 0
    if stop.window:
        kind, at = stop.window
        target = arrive.replace(hour=at.hour, minute=at.minute, second=0, microsecond=0)
        if kind in ("at", "after") and arrive < target:
            begin = target
        if kind in ("at", "before") and arrive > target:
            late = math.ceil((arrive - target).total_seconds() / 60)
    return arrive, begin + dt.timedelta(minutes=stop.duration), late


def schedule(start: dt.datetime, start_point: int, ordered: list[PlanStop], minutes: list[list[int]]) -> Schedule:
    """照給的順序算每一站幾點到、幾點走，不改順序。"""
    t, here, slots = start, start_point, []
    for stop in ordered:
        travel = minutes[here][stop.point]
        arrive, leave, late = _visit(t, travel, stop)
        slots.append(Slot(stop.customer_id, arrive, leave, travel, late))
        t, here = leave, stop.point
    return Schedule(slots, sum(s.late_minutes for s in slots), sum(s.travel_minutes for s in slots))


def violations(ordered: list[str], rules: list[Rule]) -> list[Rule]:
    """這個順序違反哪幾條規則。只看今天行程裡有的客戶；規則提到的客戶不在行程裡就不算違反。"""
    position = {cid: i for i, cid in enumerate(ordered)}
    broken = []
    for rule in rules:
        here = [cid for cid in rule.customer_ids if cid in position]
        if rule.kind == "precedence":
            ok = len(here) < 2 or position[rule.customer_ids[0]] < position[rule.customer_ids[1]]
        elif rule.kind in ("first", "last"):
            chosen = [position[cid] for cid in here]
            others = [i for cid, i in position.items() if cid not in rule.customer_ids]
            if not chosen or not others:
                ok = True
            elif rule.kind == "first":
                ok = max(chosen) < min(others)
            else:
                ok = min(chosen) > max(others)
        else:
            ok = not here or position[here[0]] == rule.position
        if not ok:
            broken.append(rule)
    return broken


def _before(stops: list[PlanStop], rules: list[Rule]) -> dict[str, set[str]]:
    """每一家前面一定要先跑完哪幾家（先後、排第一、排最後換算成兩兩的先後）。"""
    present = {s.customer_id for s in stops}
    before: dict[str, set[str]] = {cid: set() for cid in present}
    for rule in rules:
        if rule.kind == "precedence":
            first, then = rule.customer_ids
            if first in present and then in present:
                before[then].add(first)
        elif rule.kind in ("first", "last"):
            chosen = set(rule.customer_ids) & present
            for other in present - chosen:
                for cid in chosen:
                    if rule.kind == "first":
                        before[other].add(cid)
                    else:
                        before[cid].add(other)
    return before


def _locks(stops: list[PlanStop], rules: list[Rule]) -> dict[int, str] | None:
    """鎖住的位置 → 那一家。兩家鎖在同一個位置、或位置超出站數，就是排不出來（None）。"""
    present = {s.customer_id for s in stops}
    locks: dict[int, str] = {}
    for rule in rules:
        if rule.kind != "lock" or rule.customer_ids[0] not in present:
            continue
        if rule.position is None or not 0 <= rule.position < len(stops) or rule.position in locks:
            return None
        locks[rule.position] = rule.customer_ids[0]
    return locks


def _search(
    start: dt.datetime, start_point: int, stops: list[PlanStop], rules: list[Rule], minutes: list[list[int]]
) -> Schedule | None:
    locks = _locks(stops, rules)
    if locks is None:
        return None
    before = _before(stops, rules)
    locked = set(locks.values())
    by_id = {s.customer_id: s for s in stops}
    free = [s for s in stops if s.customer_id not in locked]
    best: list[tuple[int, int, list[PlanStop]]] = []
    order: list[PlanStop] = []
    used: set[str] = set()

    def walk(t: dt.datetime, here: int, late: int, travel: int) -> None:
        # 晚到與車程只會越加越多：已經不比目前最好的好，後面怎麼排都不會變好
        if best and (late, travel) >= best[0][:2]:
            return
        if len(order) == len(stops):
            best[:] = [(late, travel, list(order))]
            return
        position = len(order)
        choices = [by_id[locks[position]]] if position in locks else free
        for stop in choices:
            cid = stop.customer_id
            if cid in used or not before[cid] <= used:
                continue
            leg = minutes[here][stop.point]
            _, leave, stop_late = _visit(t, leg, stop)
            used.add(cid)
            order.append(stop)
            walk(leave, stop.point, late + stop_late, travel + leg)
            order.pop()
            used.discard(cid)

    walk(start, start_point, 0, 0)
    return schedule(start, start_point, best[0][2], minutes) if best else None


def plan(
    start: dt.datetime, start_point: int, stops: list[PlanStop], rules: list[Rule], minutes: list[list[int]]
) -> Schedule | Conflict:
    """守住所有規則、晚到最少、再來車程最短的順序；守不住就回 Conflict。"""
    if len(stops) > MAX_OPEN_STOPS:
        raise ValueError(f"還沒跑的站最多 {MAX_OPEN_STOPS} 站")
    found = _search(start, start_point, stops, rules, minutes)
    if found is not None:
        return found
    blocking = [
        rule for i, rule in enumerate(rules)
        if _search(start, start_point, stops, rules[:i] + rules[i + 1:], minutes) is not None
    ]
    return Conflict(blocking or list(rules))


def cheapest_insert(
    start: dt.datetime, start_point: int, ordered: list[PlanStop], new: PlanStop, rules: list[Rule],
    minutes: list[list[int]],
) -> int:
    """新的一站插在第幾站（還沒跑的站裡，0 起算）晚到與車程增加最少、又不違反規則。
    插在哪裡都違反就放最後，讓業務自己調。"""
    best_index, best_cost = len(ordered), None
    for index in range(len(ordered) + 1):
        trial = ordered[:index] + [new] + ordered[index:]
        if violations([s.customer_id for s in trial], rules):
            continue
        result = schedule(start, start_point, trial, minutes)
        cost = (result.late_minutes, result.travel_minutes)
        if best_cost is None or cost < best_cost:
            best_index, best_cost = index, cost
    return best_index
```

- [ ] **Step 4: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_itinerary TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_route_planner.py -q`
Expected: 16 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/route_planner.py backend/tests/test_route_planner.py
git commit -m "Plan the day's order by trying every arrangement that keeps the rules"
```

---

### Task 4: 行程與回饋的資料表

**Files:**
- Modify: `backend/app/models.py`（檔案最後加）
- Test: `backend/tests/test_itinerary.py`（新）

**Interfaces:**
- Produces: `Itinerary`（`id`、`user_id`、`date`、`version`、`suggested`、`urgent`、`skipped_habit_ids`、`created_at`、`updated_at`）、`ItineraryStop`（`id`、`itinerary_id`、`position`、`customer_id`、`source`、`signal`、`reason`、`window_kind`、`window_time`、`duration_minutes`、`note`、`locked`）、`ItineraryPrecedence`（`itinerary_id`、`before_customer_id`、`after_customer_id`）、`RouteSnooze`（`user_id`、`customer_id`、`until`）、`RouteSignalWeight`（`user_id`、`signal`、`weight`）；`ITINERARY_STOP_SOURCES = ("model", "rep", "ai", "ask")`。

設計文件寫的是一張 `route_feedback`；這裡拆成 `route_snooze` 與 `route_signal_weight` 兩張，主鍵各自清楚。Task 8 順手改設計文件那一行。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_itinerary.py`：

```python
"""今天的行程：資料表、建立、讀取、三顆鈕、加站。"""

import datetime as dt

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Itinerary, ItineraryStop


def new_itinerary(tx, user_id="U01"):
    itinerary = Itinerary(user_id=user_id, date=dt.date(2026, 10, 1), suggested=[])
    tx.add(itinerary)
    tx.flush()
    return itinerary


def test_one_itinerary_per_rep_per_day(tx):
    new_itinerary(tx)
    with pytest.raises(IntegrityError), tx.begin_nested():
        new_itinerary(tx)


def test_a_customer_appears_once_on_an_itinerary(tx):
    itinerary = new_itinerary(tx)
    tx.add(ItineraryStop(itinerary_id=itinerary.id, position=0, customer_id="C001", source="model", signal="ar", reason="x"))
    tx.flush()
    with pytest.raises(IntegrityError), tx.begin_nested():
        tx.add(ItineraryStop(itinerary_id=itinerary.id, position=1, customer_id="C001", source="rep", signal="ar", reason="x"))
        tx.flush()


def test_a_window_needs_both_kind_and_time(tx):
    itinerary = new_itinerary(tx)
    with pytest.raises(IntegrityError), tx.begin_nested():
        tx.add(ItineraryStop(
            itinerary_id=itinerary.id, position=0, customer_id="C001", source="model", signal="ar", reason="x",
            window_kind="before",
        ))
        tx.flush()
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_itinerary TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_itinerary.py -q`
Expected: FAIL（`ImportError: cannot import name 'Itinerary'`）

- [ ] **Step 3: 加資料表**

`backend/app/models.py` 最後加（`BigInteger`、`Identity`、`CheckConstraint`、`UniqueConstraint`、`ForeignKey`、`ARRAY`、`JSONB`、`false`、`func` 都已經 import）：

```python
# 行程裡每一站的來源。model：系統早上排的；rep：業務自己加的；ai：跟熊熊滾說加的；ask：問答頁「排入今天的路線」
ITINERARY_STOP_SOURCES = ("model", "rep", "ai", "ask")


class Itinerary(Base):
    """一位業務一天的行程（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md）。

    當天第一次讀取時照模型的建議建好（services/itinerary.py），之後以這份為準，模型不再重排。
    """

    __tablename__ = "itinerary"
    __table_args__ = (UniqueConstraint("user_id", "date"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"))
    date: Mapped[dt.date]
    # 每存一次加一：兩個人同時改同一位業務的行程時，後存的那一個擋下來，不默默蓋掉
    version: Mapped[int] = mapped_column(server_default="1")
    # 建立當下模型建議的站（客戶、訊號、理由，照順序），主管頁比對「改了什麼」用，之後不再改
    suggested: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    # 「需立即處理」那張卡；按了三顆鈕之一、那站拿掉或跑完之後清成 NULL
    urgent: Mapped[dict[str, Any] | None]
    # 今天不套用的排序習慣（第二階段才有習慣）
    skipped_habit_ids: Mapped[list[int]] = mapped_column(ARRAY(BigInteger), server_default="{}")
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


class ItineraryStop(Base):
    """行程裡的一站。已完成與否不存：看今天有沒有這家已確認的拜訪紀錄。"""

    __tablename__ = "itinerary_stop"
    __table_args__ = (
        UniqueConstraint("itinerary_id", "customer_id"),
        one_of("source", ITINERARY_STOP_SOURCES, "source"),
        CheckConstraint("window_kind IS NULL OR window_kind IN ('at', 'before', 'after')", name="window_kind"),
        CheckConstraint("(window_kind IS NULL) = (window_time IS NULL)", name="window_pair"),
        CheckConstraint("duration_minutes > 0", name="duration_positive"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    itinerary_id: Mapped[int] = mapped_column(ForeignKey("itinerary.id", ondelete="CASCADE"))
    position: Mapped[int]
    customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"))
    source: Mapped[str]
    signal: Mapped[str]
    reason: Mapped[str]
    # 約的時間：at 幾點到、before 幾點以前、after 幾點以後
    window_kind: Mapped[str | None]
    window_time: Mapped[dt.time | None]
    duration_minutes: Mapped[int] = mapped_column(server_default="40")
    note: Mapped[str | None]
    # 重排時位置不動
    locked: Mapped[bool] = mapped_column(server_default=false())


class ItineraryPrecedence(Base):
    """今天設的先後：before 那家要排在 after 那家前面。刪掉其中一站時一起刪。"""

    __tablename__ = "itinerary_precedence"
    __table_args__ = (CheckConstraint("before_customer_id <> after_customer_id", name="two_customers"),)

    itinerary_id: Mapped[int] = mapped_column(ForeignKey("itinerary.id", ondelete="CASCADE"), primary_key=True)
    before_customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"), primary_key=True)
    after_customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"), primary_key=True)


class RouteSnooze(Base):
    """「暫緩」「誤判」：這家到哪一天以前不排進每天的建議。原本存在手機上，改存伺服器。"""

    __tablename__ = "route_snooze"

    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), primary_key=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"), primary_key=True)
    until: Mapped[dt.date]


class RouteSignalWeight(Base):
    """「插入下一站」加一、「誤判」減一：這類提醒在每天的建議裡排前面或後面一點（today_route.PERSONAL_STEP）。"""

    __tablename__ = "route_signal_weight"

    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), primary_key=True)
    signal: Mapped[str] = mapped_column(primary_key=True)
    weight: Mapped[float] = mapped_column(server_default="0")
```

如果 `dict[str, Any] | None` 沒有自動對到 JSONB（`type_annotation_map` 只寫了 `dict[str, Any]`），改成 `mapped_column(JSONB(none_as_null=True))`。

- [ ] **Step 4: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_itinerary TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_itinerary.py backend/tests/test_seed.py -q`
Expected: 全部 PASS（`models.py` 改了，conftest 會依新的定義重建測試庫）

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/tests/test_itinerary.py
git commit -m "Add tables for the day's itinerary, its stops and precedences, and route feedback"
```

---

### Task 5: 行程服務（建立、讀取、三顆鈕、加站）

**Files:**
- Modify: `backend/app/services/today_route.py`
- Create: `backend/app/services/itinerary.py`
- Test: `backend/tests/test_itinerary.py`（接著寫）

**Interfaces:**
- Consumes: Task 1 的 `Customer.lat/lng/area`、`OrgUnit.lat/lng`；Task 2 的 `travel.matrix`；Task 3 的 `route_planner.*`；Task 4 的資料表。
- Produces（`today_route`）：
  - `Pick(today: dt.date, rep: AppUser, done: list[tuple[Visit, Customer]], picked: list[dict], urgent: Urgent | None)`；`picked` 每項是 `{"candidate": route_model.Candidate, "signal": str, "reason": str, ...}`，分數高的在前
  - `pick(session, user_id, feedback: Feedback | None = None) -> Pick`
  - `label(session, owner_id, customer_id) -> tuple[str, str]`
  - `load_feedback(session, user_id, today) -> Feedback`
  - `done_visits(session, user_id, today) -> list[tuple[Visit, Customer]]`（原 `_done_visits`）
  - `build()` 照舊（Task 6 才拿掉）
- Produces（`itinerary`）：
  - `DEFAULT_DURATION = 40`、`SNOOZE_DAYS = 3`
  - `VersionConflict(Exception)`、`NotOnItinerary(LookupError)`
  - `StopView`（`customer_id, customer_name, type, grade, planned_time, status, signal, reason, visit_id, source, duration_minutes, late_minutes, travel_minutes, travel_km`）
  - `ItineraryView`（`date, rep, version, done, total, urgent, stops, travel_minutes, travel_km, finish_time, estimated`）
  - `Skipped(customer_id, customer_name, reason)`
  - `get_or_create(session, user_id) -> Itinerary`（不是業務丟 `LookupError`）
  - `view(session, itinerary) -> ItineraryView`
  - `apply_feedback(session, user_id, customer_id, action: Literal["pin","snooze","misjudge"], version: int) -> Itinerary`
  - `add_stops(session, user_id, customer_ids: list[str], source: str = "ask") -> tuple[Itinerary, list[str], list[Skipped]]`

- [ ] **Step 1: 寫失敗的測試**

接在 `backend/tests/test_itinerary.py` 後面（import 區補上這幾行）：

```python
import itertools

import catalog
from sqlalchemy import select

from app.models import Customer, RouteSignalWeight, RouteSnooze, Visit
from app.services import itinerary as service
from app.services import route_planner, today_route, travel
from app.timeutil import TAIPEI

TODAY = dt.date(2026, 10, 28)


def test_first_read_builds_the_suggestion_ordered_by_distance(tx):
    itinerary = service.get_or_create(tx, "U01")
    view = service.view(tx, itinerary)
    assert view.date == TODAY and view.version == 1 and view.estimated is True
    assert len(view.stops) == view.total == today_route.ROUTE_SIZE
    assert [s.status for s in view.stops] == ["next"] + ["todo"] * 4
    assert all(s.source == "model" and s.duration_minutes == 40 for s in view.stops)
    times = [s.planned_time for s in view.stops]
    assert times == sorted(times) and times[0] > "09:30"
    # 「需立即處理」那家鎖在第一站，其他幾站的順序是所有排法裡車程最短的
    assert view.urgent and view.stops[0].customer_id == view.urgent["customer_id"]
    customers = {c.id: c for c in tx.scalars(select(Customer).where(Customer.id.in_([s.customer_id for s in view.stops])))}
    ids = [s.customer_id for s in view.stops]
    points = [catalog.REGION_OFFICE["TW.N"]] + [(customers[cid].lat, customers[cid].lng) for cid in ids]
    minutes = travel.matrix(points).minutes
    start = dt.datetime(2026, 10, 28, 9, 30, tzinfo=TAIPEI)
    stops = [route_planner.PlanStop(cid, n + 1, 40) for n, cid in enumerate(ids)]
    best = min(
        route_planner.schedule(start, 0, [stops[0], *rest], minutes).travel_minutes
        for rest in itertools.permutations(stops[1:])
    )
    assert view.travel_minutes == best
    assert itinerary.suggested == [{"customer_id": s.customer_id, "signal": s.signal, "reason": s.reason} for s in view.stops]


def test_second_read_returns_the_saved_itinerary(tx):
    first = service.view(tx, service.get_or_create(tx, "U01"))
    second = service.view(tx, service.get_or_create(tx, "U01"))
    assert first == second
    assert len(tx.scalars(select(Itinerary).where(Itinerary.user_id == "U01")).all()) == 1


def test_each_rep_gets_their_own_customers(tx):
    seen = set()
    for rep_id in ("U01", "U02", "U03", "U04", "U05"):
        ids = {s.customer_id for s in service.view(tx, service.get_or_create(tx, rep_id)).stops}
        assert len(ids) == today_route.ROUTE_SIZE and not ids & seen
        seen |= ids


def test_managers_have_no_itinerary(tx):
    with pytest.raises(LookupError):
        service.get_or_create(tx, "M01")


def test_pin_moves_a_stop_to_next_and_bumps_the_version(tx):
    itinerary = service.get_or_create(tx, "U01")
    last = service.view(tx, itinerary).stops[-1]
    service.apply_feedback(tx, "U01", last.customer_id, "pin", 1)
    view = service.view(tx, itinerary)
    assert view.stops[0].customer_id == last.customer_id and view.stops[0].status == "next"
    assert view.version == 2
    assert tx.get(RouteSignalWeight, ("U01", last.signal)).weight == 1


def test_snooze_drops_the_stop_and_skips_three_days(tx):
    itinerary = service.get_or_create(tx, "U01")
    target = service.view(tx, itinerary).stops[2]
    service.apply_feedback(tx, "U01", target.customer_id, "snooze", 1)
    view = service.view(tx, itinerary)
    assert target.customer_id not in {s.customer_id for s in view.stops} and view.total == 4
    assert tx.get(RouteSnooze, ("U01", target.customer_id)).until == dt.date(2026, 10, 31)


def test_misjudge_also_lowers_that_kind_of_reminder(tx):
    itinerary = service.get_or_create(tx, "U01")
    target = service.view(tx, itinerary).stops[1]
    service.apply_feedback(tx, "U01", target.customer_id, "misjudge", 1)
    assert tx.get(RouteSignalWeight, ("U01", target.signal)).weight == -1
    assert tx.get(RouteSnooze, ("U01", target.customer_id)) is not None


def test_any_button_on_the_urgent_stop_clears_the_card(tx):
    itinerary = service.get_or_create(tx, "U01")
    urgent = service.view(tx, itinerary).urgent
    service.apply_feedback(tx, "U01", urgent["customer_id"], "pin", 1)
    assert service.view(tx, itinerary).urgent is None


def test_a_stale_version_is_refused(tx):
    service.get_or_create(tx, "U01")
    with pytest.raises(service.VersionConflict):
        service.apply_feedback(tx, "U01", "C001", "pin", 99)


def test_feedback_for_a_customer_not_on_the_itinerary(tx):
    service.get_or_create(tx, "U01")
    with pytest.raises(service.NotOnItinerary):
        service.apply_feedback(tx, "U01", "C999", "pin", 1)


def test_a_finished_visit_moves_to_the_front(tx):
    itinerary = service.get_or_create(tx, "U01")
    target = service.view(tx, itinerary).stops[1]
    at = dt.datetime(2026, 10, 28, 9, 40, tzinfo=TAIPEI)
    tx.add(Visit(id="VTEST1", customer_id=target.customer_id, user_id="U01", visited_at=at,
                 transcript="測試", status="synced", confirmed_at=at))
    tx.flush()
    view = service.view(tx, itinerary)
    assert view.done == 1 and view.total == 5
    assert view.stops[0].customer_id == target.customer_id
    assert (view.stops[0].status, view.stops[0].planned_time, view.stops[0].visit_id) == ("done", "09:40", "VTEST1")
    # 下一站從那一家、09:40 加停留 40 分鐘之後出發
    assert view.stops[1].status == "next" and view.stops[1].planned_time >= "10:20"


def test_added_stops_go_where_they_detour_least(tx):
    itinerary = service.get_or_create(tx, "U01")
    on_route = [s.customer_id for s in service.view(tx, itinerary).stops]
    mine = tx.scalars(select(Customer.id).where(Customer.owner_user_id == "U01", Customer.id.not_in(on_route))).first()
    theirs = tx.scalars(select(Customer.id).where(Customer.owner_user_id == "U02")).first()
    tx.add(RouteSnooze(user_id="U01", customer_id=mine, until=dt.date(2026, 10, 30)))
    tx.flush()
    _, added, skipped = service.add_stops(tx, "U01", [mine, theirs, on_route[0]])
    view = service.view(tx, itinerary)
    stop = next(s for s in view.stops if s.customer_id == mine)
    assert len(added) == 1 and stop.source == "ask" and stop.reason
    assert {(s.customer_id, s.reason) for s in skipped} == {(theirs, "不是你的客戶"), (on_route[0], "已經在今天的行程裡")}
    assert view.version == 2
    # 加進來就取消暫緩，不然明天的建議照樣不排
    assert tx.get(RouteSnooze, ("U01", mine)) is None
    # 第一站鎖著，不會被插隊
    assert view.stops[0].customer_id == on_route[0]


def test_no_more_than_eight_open_stops(tx):
    service.get_or_create(tx, "U01")
    on_route = [s.customer_id for s in service.view(tx, service.get_or_create(tx, "U01")).stops]
    more = tx.scalars(select(Customer.id).where(Customer.owner_user_id == "U01", Customer.id.not_in(on_route)).limit(5)).all()
    _, added, skipped = service.add_stops(tx, "U01", list(more))
    assert len(added) == 3
    assert [s.reason for s in skipped] == ["今天已經排了 8 站", "今天已經排了 8 站"]
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_itinerary TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_itinerary.py -q`
Expected: 前 3 個 PASS，其他 FAIL（`ImportError: cannot import name 'itinerary'`）

- [ ] **Step 3: today_route 拆出「挑哪幾家」**

`backend/app/services/today_route.py`：

1. import 區的 models 那行改成：
   ```python
   from app.models import AppUser, Customer, Product, RouteSignalWeight, RouteSnooze, SalesTransaction, SapQuotationDraft, Visit
   ```
2. `_done_visits` 改名 `done_visits`（定義與 `build` 裡的呼叫都改），docstring 不變。
3. 在 `TodayRoute` dataclass 後面加：
   ```python
   @dataclass
   class Pick:
       """模型挑出來今天要去的幾家，分數高的在前；順序交給 services/itinerary.py 排順路。"""

       today: dt.date
       rep: AppUser
       done: list[tuple[Visit, Customer]]
       picked: list[dict]  # {"candidate", "signal", "reason", ...}
       urgent: Urgent | None
   ```
4. 在 `_urgent` 函式後面加：
   ```python
   def _label(candidate: route_model.Candidate, today: dt.date, due: dt.date | None, opportunity: str | None) -> tuple[str, str, bool]:
       """這家為什麼排進來（訊號、一句理由），以及是不是還沒處理的逾期承諾。"""
       # 承諾到期之後又去過，就當作處理完了：系統沒有結案紀錄，只能這樣判斷
       unresolved = due is not None and (candidate.last_visit_date is None or due > candidate.last_visit_date)
       signal, reason = _signal_and_reason(candidate, today)
       # 商機的說明排在帳款與間隔這類壞消息後面：同一家兩種都有時，先講要處理的問題
       if opportunity and signal not in ("ar", "interval"):
           signal, reason = "opportunity", opportunity
       if unresolved:
           signal, reason = "commitment", f"答應的事 {due:%m/%d} 到期，已經過 {(today - due).days} 天"
       return signal, reason, unresolved


   def label(session: Session, owner_id: str, customer_id: str) -> tuple[str, str]:
       """業務自己加進行程的那一家，用跟模型挑的同一套說法寫理由。只能問這位業務自己的客戶。"""
       today = customer_profile.app_today(session)
       candidate = next(c for c in route_model.candidates(session, today, owner_id=owner_id) if c.customer_id == customer_id)
       due = _overdue_commitments(session, owner_id, today).get(customer_id)
       signal, reason, _ = _label(candidate, today, due, _opportunities(session, owner_id, today).get(customer_id))
       return signal, reason


   def load_feedback(session: Session, user_id: str, today: dt.date) -> Feedback:
       """業務按過的暫緩與誤判（services/itinerary.py 寫的），排每天的建議時用。過期的暫緩不算。"""
       snoozed = dict(session.execute(
           select(RouteSnooze.customer_id, RouteSnooze.until)
           .where(RouteSnooze.user_id == user_id, RouteSnooze.until > today)
       ).all())
       weights = dict(session.execute(
           select(RouteSignalWeight.signal, RouteSignalWeight.weight).where(RouteSignalWeight.user_id == user_id)
       ).all())
       return Feedback(snoozed=snoozed, signal_weights=weights)
   ```
5. 把 `build` 從開頭到算出 `urgent` 為止（`feedback = feedback or Feedback()` 到 `urgent = _urgent(...)` 那段）搬進新的 `pick`，迴圈裡算訊號的那幾行改用 `_label`：
   ```python
   def pick(session: Session, user_id: str, feedback: Feedback | None = None) -> Pick:
       feedback = feedback or Feedback()
       today = customer_profile.app_today(session)
       rep = session.get(AppUser, user_id)
       if rep is None or rep.role != "sales":
           raise LookupError(user_id)

       done = done_visits(session, user_id, today)
       done_ids = {c.id for _, c in done}
       overdue = _overdue_commitments(session, user_id, today)
       opportunities = _opportunities(session, user_id, today)
       model = route_model.load_model()

       pool = []
       for candidate in route_model.candidates(session, today, owner_id=user_id):
           if candidate.customer_id in done_ids:
               continue
           snooze_until = feedback.snoozed.get(candidate.customer_id)
           # 業務按了暫緩就不排，逾期的承諾也一樣：他知道自己今天去不去得了，按了沒反應更難解釋
           if snooze_until and snooze_until > today:
               continue
           opportunity = opportunities.get(candidate.customer_id)
           signal, reason, unresolved = _label(candidate, today, overdue.get(candidate.customer_id), opportunity)
           base = route_model.score(candidate.features, model) if model else route_model.rule_score(candidate)
           weight = max(-PERSONAL_LIMIT, min(PERSONAL_LIMIT, feedback.signal_weights.get(signal, 0)))
           pool.append({
               "candidate": candidate, "signal": signal, "reason": reason,
               "score": base * (1 + PERSONAL_STEP * weight),
               # 按過「插入下一站」的排最前面，其次是逾期的承諾，再來才照分數。
               # 這類提醒被按過「誤判」就不再硬排：業務說這種提醒對他沒用，硬排等於不理他
               "rank": (candidate.customer_id in feedback.pinned, unresolved and weight >= 0),
               "opportunity": opportunity,
           })
       # （以下 sort、逾期承諾上限、picked、商機換站的程式原封不動搬過來）
       ...
       urgent = None
       # 只有真的有事才給卡片：「很久沒拜訪」是排序的理由，但不值得用紅卡叫業務立刻處理
       if picked and picked[0]["signal"] not in ("routine", "visit"):
           urgent = _urgent(session, picked[0]["candidate"], picked[0]["signal"], picked[0]["reason"])
       return Pick(today=today, rep=rep, done=done, picked=picked, urgent=urgent)
   ```
   「原封不動搬過來」指的是原 `build` 裡從 `pool.sort(...)` 到 `picked[replaceable[-1]] = best` 這一段，一行都不改。
6. `build` 改成用 `pick`：
   ```python
   def build(session: Session, user_id: str, feedback: Feedback | None = None) -> TodayRoute:
       result = pick(session, user_id, feedback)
       stops = [
           Stop(
               customer_id=c.id, customer_name=c.name, type=c.type, grade=c.grade,
               planned_time=v.visited_at.astimezone(TAIPEI).strftime("%H:%M"),
               status="done", signal="routine", reason="已完成", visit_id=v.id,
           )
           for v, c in result.done
       ]
       start = dt.datetime.combine(result.today, FIRST_STOP) + dt.timedelta(minutes=STOP_GAP_MINUTES * len(stops))
       for n, item in enumerate(result.picked):
           candidate = item["candidate"]
           stops.append(Stop(
               customer_id=candidate.customer_id, customer_name=candidate.name, type=candidate.type,
               grade=candidate.grade,
               planned_time=(start + dt.timedelta(minutes=STOP_GAP_MINUTES * n)).strftime("%H:%M"),
               status="next" if n == 0 else "todo", signal=item["signal"], reason=item["reason"],
           ))
       return TodayRoute(date=result.today, rep=result.rep, done=len(result.done), total=len(stops),
                         urgent=result.urgent, stops=stops)
   ```

Run: `TEST_DB_NAME=meddemo_test_itinerary TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_today_route.py backend/tests/test_quotes.py -q`
Expected: 全部 PASS（行為沒變）

- [ ] **Step 4: 行程服務**

`backend/app/services/itinerary.py`：

```python
"""今天的行程（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md）。

當天第一次讀取時照模型的建議建一份存起來：模型挑哪幾家（today_route.pick），順序交給 route_planner 排順路，
「需立即處理」那家鎖在第一站。之後一律以存著的為準，模型不再重排；業務或主管誰先讀都一樣。
已完成與否不存：跟以前一樣看今天有沒有這家已確認的拜訪紀錄，跑完的站排在最前面。
"""

from __future__ import annotations

import dataclasses
import datetime as dt
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    AppUser, Customer, Itinerary, ItineraryPrecedence, ItineraryStop, OrgUnit, RouteSignalWeight, RouteSnooze, Visit,
)
from app.services import customer_profile, route_planner, today_route, travel
from app.timeutil import TAIPEI

# 每站預設停留多久。以前用「平均 70 分鐘一站」排時間，那包含了車程；現在車程另外算
DEFAULT_DURATION = 40
# 暫緩跳過三天：足夠跳過這一趟和隔天的路線，又不會整個週期看不到這家（跟原本手機上的一樣）
SNOOZE_DAYS = 3

FeedbackAction = Literal["pin", "snooze", "misjudge"]


class VersionConflict(Exception):
    """行程在讀取之後被改過：兩個人同時改同一位業務的行程，後存的那一個擋下來。"""


class NotOnItinerary(LookupError):
    """這家不在今天還沒跑的站裡。"""


@dataclass
class StopView:
    customer_id: str
    customer_name: str
    type: str
    grade: str
    planned_time: str  # 已完成的是拜訪時間，其他是排出來的到達時間
    status: str  # done／next／todo
    signal: str
    reason: str
    visit_id: str | None
    source: str
    duration_minutes: int
    late_minutes: int
    travel_minutes: int | None  # 從上一站開過來；已完成的站是 None
    travel_km: float | None


@dataclass
class ItineraryView:
    date: dt.date
    rep: AppUser
    version: int
    done: int
    total: int
    urgent: dict | None
    stops: list[StopView]
    travel_minutes: int
    travel_km: float
    finish_time: str | None  # 最後一站離開的時間
    estimated: bool  # 車程是直線估算的


@dataclass
class Skipped:
    customer_id: str
    customer_name: str
    reason: str


def get_or_create(session: Session, user_id: str) -> Itinerary:
    """今天的行程，沒有就照模型的建議建一份。不是業務（主管、IT）丟 LookupError。"""
    today = customer_profile.app_today(session)
    rep = session.get(AppUser, user_id)
    if rep is None or rep.role != "sales":
        raise LookupError(user_id)
    found = _find(session, user_id, today)
    if found:
        return found
    try:
        with session.begin_nested():
            return _create(session, rep, today)
    except IntegrityError:
        # 同一位業務兩個請求同時第一次讀：另一個先建好了，用那一份
        found = _find(session, user_id, today)
        if found is None:
            raise
        return found


def view(session: Session, itinerary: Itinerary) -> ItineraryView:
    """畫面要的樣子：跑完的站在前（照拜訪時間），還沒跑的照存著的順序，時間與車程現算。"""
    rep = session.get(AppUser, itinerary.user_id)
    done = today_route.done_visits(session, rep.id, itinerary.date)
    rows = _rows(session, itinerary)
    done_ids = {c.id for _, c in done}
    open_rows = [r for r in rows if r.customer_id not in done_ids]
    customers = _customers(session, [r.customer_id for r in open_rows])
    start, origin = _start(session, rep, itinerary.date, done, _durations(rows))
    points = [_point(customers[r.customer_id]) for r in open_rows]
    matrix = travel.matrix([origin or (points[0] if points else (0.0, 0.0)), *points])
    planned = route_planner.schedule(start, 0, [_plan_stop(r, n + 1) for n, r in enumerate(open_rows)], matrix.minutes)

    by_customer = {r.customer_id: r for r in rows}
    stops = []
    for visit, customer in done:
        row = by_customer.get(customer.id)
        stops.append(StopView(
            customer_id=customer.id, customer_name=customer.name, type=customer.type, grade=customer.grade,
            planned_time=visit.visited_at.astimezone(TAIPEI).strftime("%H:%M"), status="done",
            signal="routine", reason="已完成", visit_id=visit.id, source=row.source if row else "rep",
            duration_minutes=row.duration_minutes if row else DEFAULT_DURATION, late_minutes=0,
            travel_minutes=None, travel_km=None,
        ))
    total_km = 0.0
    for n, (row, slot) in enumerate(zip(open_rows, planned.slots, strict=True)):
        customer = customers[row.customer_id]
        km = matrix.km[n][n + 1]
        total_km += km
        stops.append(StopView(
            customer_id=customer.id, customer_name=customer.name, type=customer.type, grade=customer.grade,
            planned_time=slot.arrive.strftime("%H:%M"), status="next" if n == 0 else "todo",
            signal=row.signal, reason=row.reason, visit_id=None, source=row.source,
            duration_minutes=row.duration_minutes, late_minutes=slot.late_minutes,
            travel_minutes=slot.travel_minutes, travel_km=km,
        ))
    open_ids = {r.customer_id for r in open_rows}
    urgent = itinerary.urgent if itinerary.urgent and itinerary.urgent["customer_id"] in open_ids else None
    return ItineraryView(
        date=itinerary.date, rep=rep, version=itinerary.version, done=len(done), total=len(stops), urgent=urgent,
        stops=stops, travel_minutes=planned.travel_minutes, travel_km=round(total_km, 1),
        finish_time=planned.slots[-1].leave.strftime("%H:%M") if planned.slots else None,
        estimated=matrix.estimated,
    )


def apply_feedback(session: Session, user_id: str, customer_id: str, action: FeedbackAction, version: int) -> Itinerary:
    """需立即處理的三顆鈕。插入下一站：移到還沒跑的第一站，同類提醒之後排前面一點；
    暫緩：從今天拿掉，三天內的建議不排；誤判：暫緩，再加上同類提醒之後少排一點。"""
    itinerary = get_or_create(session, user_id)
    if itinerary.version != version:
        raise VersionConflict
    rows = _rows(session, itinerary)
    done_ids = {c.id for _, c in today_route.done_visits(session, user_id, itinerary.date)}
    row = next((r for r in rows if r.customer_id == customer_id and customer_id not in done_ids), None)
    if row is None:
        raise NotOnItinerary(customer_id)
    if action == "pin":
        finished = [r for r in rows if r.customer_id in done_ids]
        rest = [r for r in rows if r.customer_id not in done_ids and r is not row]
        _renumber([*finished, row, *rest])
        _adjust_weight(session, user_id, row.signal, 1)
    else:
        _remove(session, itinerary, row)
        _snooze(session, user_id, customer_id, itinerary.date + dt.timedelta(days=SNOOZE_DAYS))
        if action == "misjudge":
            _adjust_weight(session, user_id, row.signal, -1)
    if itinerary.urgent and itinerary.urgent["customer_id"] == customer_id:
        itinerary.urgent = None
    _touch(itinerary)
    session.flush()
    return itinerary


def add_stops(
    session: Session, user_id: str, customer_ids: list[str], source: str = "ask"
) -> tuple[Itinerary, list[str], list[Skipped]]:
    """把幾家加進今天的行程，各自插在多繞最少、又不動到鎖住的站的位置。回傳 (行程, 加進去的店名, 沒加的與原因)。
    加進來的那家一併取消暫緩，否則明天的建議照樣不排它。"""
    itinerary = get_or_create(session, user_id)
    rep = session.get(AppUser, user_id)
    done = today_route.done_visits(session, user_id, itinerary.date)
    done_ids = {c.id for _, c in done}
    rows = _rows(session, itinerary)
    open_rows = [r for r in rows if r.customer_id not in done_ids]
    on_route = {r.customer_id for r in rows}
    wanted = list(dict.fromkeys(customer_ids))
    found = _customers(session, wanted)
    added: list[str] = []
    skipped: list[Skipped] = []
    for cid in wanted:
        customer = found.get(cid)
        if customer is None or customer.owner_user_id != user_id:
            skipped.append(Skipped(cid, customer.name if customer else cid, "不是你的客戶"))
            continue
        if cid in done_ids:
            skipped.append(Skipped(cid, customer.name, "今天已經去過了"))
            continue
        if cid in on_route:
            skipped.append(Skipped(cid, customer.name, "已經在今天的行程裡"))
            continue
        if len(open_rows) >= route_planner.MAX_OPEN_STOPS:
            skipped.append(Skipped(cid, customer.name, f"今天已經排了 {route_planner.MAX_OPEN_STOPS} 站"))
            continue
        signal, reason = today_route.label(session, user_id, cid)
        row = ItineraryStop(
            itinerary_id=itinerary.id, position=len(rows), customer_id=cid, source=source,
            signal=signal, reason=reason, duration_minutes=DEFAULT_DURATION,
        )
        index = _cheapest_index(session, rep, itinerary.date, done, _durations(rows), open_rows, row, customer)
        open_rows.insert(index, row)
        rows.append(row)
        session.add(row)
        on_route.add(cid)
        added.append(customer.name)
        session.execute(delete(RouteSnooze).where(RouteSnooze.user_id == user_id, RouteSnooze.customer_id == cid))
    if added:
        _renumber([r for r in rows if r.customer_id in done_ids] + open_rows)
        _touch(itinerary)
    session.flush()
    return itinerary, added, skipped


def _find(session: Session, user_id: str, today: dt.date) -> Itinerary | None:
    return session.scalar(select(Itinerary).where(Itinerary.user_id == user_id, Itinerary.date == today))


def _create(session: Session, rep: AppUser, today: dt.date) -> Itinerary:
    picked = today_route.pick(session, rep.id, today_route.load_feedback(session, rep.id, today))
    items = {item["candidate"].customer_id: item for item in picked.picked}
    customers = _customers(session, list(items))
    start, origin = _start(session, rep, today, picked.done, {})
    points = [_point(customers[cid]) for cid in items]
    minutes = travel.matrix([origin or (points[0] if points else (0.0, 0.0)), *points]).minutes
    stops = [route_planner.PlanStop(customer_id=cid, point=n + 1, duration=DEFAULT_DURATION) for n, cid in enumerate(items)]
    rules = []
    if picked.urgent:
        # 「需立即處理」那家鎖在第一站，其他照順路排；業務之後可以拖走或解鎖
        rules.append(route_planner.Rule(
            id=f"lock:{picked.urgent.customer_id}", text=f"{picked.urgent.customer_name}排第一站",
            kind="lock", customer_ids=(picked.urgent.customer_id,), position=0,
        ))
    result = route_planner.plan(start, 0, stops, rules, minutes)
    # 只有鎖第一站這一條規則，不會排不出來；萬一排不出來就照模型挑的順序
    order = [s.customer_id for s in result.slots] if isinstance(result, route_planner.Schedule) else list(items)
    itinerary = Itinerary(
        user_id=rep.id, date=today,
        suggested=[{"customer_id": cid, "signal": items[cid]["signal"], "reason": items[cid]["reason"]} for cid in order],
        urgent=dataclasses.asdict(picked.urgent) if picked.urgent else None,
    )
    session.add(itinerary)
    session.flush()
    session.add_all([
        ItineraryStop(
            itinerary_id=itinerary.id, position=n, customer_id=cid, source="model",
            signal=items[cid]["signal"], reason=items[cid]["reason"], duration_minutes=DEFAULT_DURATION,
            locked=picked.urgent is not None and cid == picked.urgent.customer_id,
        )
        for n, cid in enumerate(order)
    ])
    session.flush()
    return itinerary


def _start(
    session: Session, rep: AppUser, today: dt.date, done: list[tuple[Visit, Customer]], durations: dict[str, int]
) -> tuple[dt.datetime, travel.Point | None]:
    """從哪裡、幾點出發。還沒跑任何一站：區處辦公室 09:30；跑過了：最後完成那一站，拜訪時間加停留之後。
    區處沒有位置（組織管理新開的區）時回 None，呼叫端改從第一站出發。"""
    if done:
        visit, customer = done[-1]
        minutes = durations.get(customer.id, DEFAULT_DURATION)
        return visit.visited_at.astimezone(TAIPEI) + dt.timedelta(minutes=minutes), _point(customer)
    office = session.scalar(select(OrgUnit).where(OrgUnit.kind == "region", OrgUnit.name == rep.region))
    origin = (office.lat, office.lng) if office and office.lat is not None and office.lng is not None else None
    return dt.datetime.combine(today, today_route.FIRST_STOP, TAIPEI), origin


def _cheapest_index(
    session: Session, rep: AppUser, today: dt.date, done: list[tuple[Visit, Customer]], durations: dict[str, int],
    open_rows: list[ItineraryStop], new_row: ItineraryStop, new_customer: Customer,
) -> int:
    customers = _customers(session, [r.customer_id for r in open_rows]) | {new_customer.id: new_customer}
    start, origin = _start(session, rep, today, done, durations)
    ids = [r.customer_id for r in open_rows] + [new_customer.id]
    points = [_point(customers[cid]) for cid in ids]
    minutes = travel.matrix([origin or points[0], *points]).minutes
    ordered = [_plan_stop(r, n + 1) for n, r in enumerate(open_rows)]
    new = route_planner.PlanStop(customer_id=new_customer.id, point=len(ids), duration=new_row.duration_minutes)
    locks = [
        route_planner.Rule(
            id=f"lock:{r.customer_id}", text=f"{customers[r.customer_id].name}鎖在第 {n + 1} 站",
            kind="lock", customer_ids=(r.customer_id,), position=n,
        )
        for n, r in enumerate(open_rows) if r.locked
    ]
    return route_planner.cheapest_insert(start, 0, ordered, new, locks, minutes)


def _rows(session: Session, itinerary: Itinerary) -> list[ItineraryStop]:
    return list(session.scalars(
        select(ItineraryStop).where(ItineraryStop.itinerary_id == itinerary.id)
        .order_by(ItineraryStop.position, ItineraryStop.id)
    ))


def _customers(session: Session, ids: list[str]) -> dict[str, Customer]:
    return {c.id: c for c in session.scalars(select(Customer).where(Customer.id.in_(ids)))} if ids else {}


def _durations(rows: list[ItineraryStop]) -> dict[str, int]:
    return {r.customer_id: r.duration_minutes for r in rows}


def _point(customer: Customer) -> travel.Point:
    return customer.lat, customer.lng


def _plan_stop(row: ItineraryStop, point: int) -> route_planner.PlanStop:
    window = (row.window_kind, row.window_time) if row.window_kind and row.window_time else None
    return route_planner.PlanStop(customer_id=row.customer_id, point=point, duration=row.duration_minutes, window=window)


def _renumber(rows: list[ItineraryStop]) -> None:
    for n, row in enumerate(rows):
        row.position = n


def _remove(session: Session, itinerary: Itinerary, row: ItineraryStop) -> None:
    session.execute(delete(ItineraryPrecedence).where(
        ItineraryPrecedence.itinerary_id == itinerary.id,
        or_(ItineraryPrecedence.before_customer_id == row.customer_id,
            ItineraryPrecedence.after_customer_id == row.customer_id),
    ))
    session.delete(row)


def _snooze(session: Session, user_id: str, customer_id: str, until: dt.date) -> None:
    stmt = insert(RouteSnooze).values(user_id=user_id, customer_id=customer_id, until=until)
    session.execute(stmt.on_conflict_do_update(
        index_elements=["user_id", "customer_id"],
        set_={"until": func.greatest(RouteSnooze.until, stmt.excluded.until)},
    ))


def _adjust_weight(session: Session, user_id: str, signal: str, delta: int) -> None:
    stmt = insert(RouteSignalWeight).values(user_id=user_id, signal=signal, weight=delta)
    session.execute(stmt.on_conflict_do_update(
        index_elements=["user_id", "signal"], set_={"weight": RouteSignalWeight.weight + delta},
    ))


def _touch(itinerary: Itinerary) -> None:
    itinerary.version += 1
    itinerary.updated_at = func.now()
```

- [ ] **Step 5: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_itinerary TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_itinerary.py backend/tests/test_today_route.py -q`
Expected: 全部 PASS

`tx.get(RouteSignalWeight, ...)` 若拿到的是 upsert 之前快取的物件，在讀之前加 `tx.expire_all()`。

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/today_route.py backend/app/services/itinerary.py backend/tests/test_itinerary.py
git commit -m "Save the day's itinerary in route order and handle the three buttons and added stops on it"
```

---

### Task 6: 行程 API，拿掉舊的路線 API

**Files:**
- Create: `backend/app/api/itinerary.py`
- Delete: `backend/app/api/route.py`
- Modify: `backend/app/main.py:11`、`:31`
- Modify: `backend/app/services/today_route.py`（拿掉 `build`、`TodayRoute`、`Stop`、`Feedback.pinned`、`STOP_GAP_MINUTES`）
- Modify: `backend/app/services/org_admin.py:126`（註解）
- Create: `backend/tests/test_itinerary_api.py`
- Modify: `backend/tests/test_today_route.py`（改測 `pick`）、`backend/tests/test_oauth.py:71`

**Interfaces:**
- Consumes: Task 5 的 `itinerary.get_or_create/view/apply_feedback/add_stops`、`VersionConflict`、`NotOnItinerary`、`Skipped`、`ItineraryView`。
- Produces（HTTP）：
  - `GET /api/itinerary/today` → `TodayItinerary`：`{date, rep{id,name,region}, version, done, total, urgent|null, stops[{customer_id, customer_name, type, grade, planned_time, status, signal, reason, visit_id, source, duration_minutes, late_minutes, travel_minutes, travel_km}], travel_minutes, travel_km, finish_time, estimated}`
  - `POST /api/itinerary/today/feedback` `{customer_id, action: "pin"|"snooze"|"misjudge", version}` → `TodayItinerary`；409／404／403
  - `POST /api/itinerary/today/stops` `{customer_ids: [...]}`（1～20 個）→ `{itinerary: TodayItinerary, added: [店名], skipped: [{customer_id, customer_name, reason}]}`

- [ ] **Step 1: 寫失敗的 API 測試**

`backend/tests/test_itinerary_api.py`：

```python
"""行程 API：誰看得到、JSON 長什麼樣、三顆鈕與加站。服務本身的行為在 test_itinerary.py。"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import Customer


@pytest.fixture
def client(tx):
    return TestClient(app)


def today(client, auth, user_id="U01"):
    response = client.get("/api/itinerary/today", headers=auth(user_id))
    assert response.status_code == 200, response.text
    return response.json()


def test_today_has_the_fields_the_home_page_needs(client, auth):
    data = today(client, auth)
    assert data["date"] == "2026-10-28" and data["rep"]["name"] == "林昱辰"
    assert data["version"] == 1 and data["estimated"] is True
    assert data["total"] == len(data["stops"]) == 5
    first = data["stops"][0]
    assert set(first) == {
        "customer_id", "customer_name", "type", "grade", "planned_time", "status", "signal", "reason", "visit_id",
        "source", "duration_minutes", "late_minutes", "travel_minutes", "travel_km",
    }
    assert data["urgent"]["customer_id"] == first["customer_id"]
    assert data["finish_time"] > first["planned_time"]


def test_only_a_signed_in_sales_rep_has_an_itinerary(client, auth):
    assert client.get("/api/itinerary/today").status_code == 401
    denied = client.get("/api/itinerary/today", headers=auth("M01"))
    assert denied.status_code == 403 and denied.json()["detail"] == "主管沒有自己的拜訪路線"


def test_pin_through_the_api(client, auth):
    last = today(client, auth)["stops"][-1]
    response = client.post(
        "/api/itinerary/today/feedback",
        json={"customer_id": last["customer_id"], "action": "pin", "version": 1},
        headers=auth(),
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["stops"][0]["customer_id"] == last["customer_id"] and data["version"] == 2


def test_stale_version_and_unknown_customer(client, auth):
    first = today(client, auth)["stops"][0]
    stale = client.post(
        "/api/itinerary/today/feedback",
        json={"customer_id": first["customer_id"], "action": "snooze", "version": 7}, headers=auth(),
    )
    assert stale.status_code == 409 and stale.json()["detail"] == "行程剛被改過，已幫你重新整理"
    missing = client.post(
        "/api/itinerary/today/feedback", json={"customer_id": "C999", "action": "pin", "version": 1}, headers=auth(),
    )
    assert missing.status_code == 404


def test_add_stops_from_an_answer(client, auth, tx):
    on_route = [s["customer_id"] for s in today(client, auth)["stops"]]
    mine = tx.scalars(select(Customer).where(Customer.owner_user_id == "U01", Customer.id.not_in(on_route))).first()
    response = client.post("/api/itinerary/today/stops", json={"customer_ids": [mine.id, on_route[0]]}, headers=auth())
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["added"] == [mine.name]
    assert data["skipped"][0]["reason"] == "已經在今天的行程裡"
    assert mine.id in {s["customer_id"] for s in data["itinerary"]["stops"]}
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_itinerary TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_itinerary_api.py -q`
Expected: FAIL（404 Not Found）

- [ ] **Step 3: API**

`backend/app/api/itinerary.py`：

```python
"""今天的行程（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md）。

行程是誰的由 token 決定，不是前端說了算：第三方登入開的帳號自己沒有客戶，看示範業務的行程。
"""

import dataclasses
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.db import get_session
from app.models import AppUser
from app.services import itinerary as service

router = APIRouter(prefix="/api/itinerary", tags=["itinerary"])
SessionDep = Annotated[Session, Depends(get_session)]
NO_ROUTE = "主管沒有自己的拜訪路線"


class Rep(BaseModel):
    id: str
    name: str
    region: str


class Urgent(BaseModel):
    customer_id: str
    customer_name: str
    signal: str
    headline: str
    detail: str
    note: str | None


class Stop(BaseModel):
    customer_id: str
    customer_name: str
    type: str
    grade: str
    planned_time: str
    status: str
    signal: str
    reason: str
    visit_id: str | None
    source: str
    duration_minutes: int
    late_minutes: int
    travel_minutes: int | None
    travel_km: float | None


class TodayItinerary(BaseModel):
    date: date
    rep: Rep
    version: int
    done: int
    total: int
    urgent: Urgent | None
    stops: list[Stop]
    travel_minutes: int
    travel_km: float
    finish_time: str | None
    estimated: bool


class FeedbackInput(BaseModel):
    customer_id: str
    action: Literal["pin", "snooze", "misjudge"]
    version: int


class StopsInput(BaseModel):
    customer_ids: list[str] = Field(min_length=1, max_length=20)


class SkippedStop(BaseModel):
    customer_id: str
    customer_name: str
    reason: str


class StopsResult(BaseModel):
    itinerary: TodayItinerary
    added: list[str]
    skipped: list[SkippedStop]


def _rep_id(user: AppUser) -> str:
    return user.acts_as_user_id or user.id


def _out(view: service.ItineraryView) -> TodayItinerary:
    return TodayItinerary(
        date=view.date, rep=Rep(id=view.rep.id, name=view.rep.name, region=view.rep.region),
        version=view.version, done=view.done, total=view.total,
        urgent=Urgent(**view.urgent) if view.urgent else None,
        stops=[Stop(**dataclasses.asdict(stop)) for stop in view.stops],
        travel_minutes=view.travel_minutes, travel_km=view.travel_km, finish_time=view.finish_time,
        estimated=view.estimated,
    )


@router.get("/today", response_model=TodayItinerary)
def get_today(session: SessionDep, user: CurrentUser):
    """今天的行程；當天第一次讀取時照模型的建議建好。"""
    try:
        itinerary = service.get_or_create(session, _rep_id(user))
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    result = _out(service.view(session, itinerary))
    session.commit()
    return result


@router.post("/today/feedback", response_model=TodayItinerary)
def send_feedback(session: SessionDep, body: FeedbackInput, user: CurrentUser):
    """需立即處理的三顆鈕：插入下一站、暫緩、誤判。"""
    try:
        itinerary = service.apply_feedback(session, _rep_id(user), body.customer_id, body.action, body.version)
    except service.VersionConflict:
        raise HTTPException(409, "行程剛被改過，已幫你重新整理") from None
    except service.NotOnItinerary:
        raise HTTPException(404, "這家不在今天還沒跑的站裡") from None
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    result = _out(service.view(session, itinerary))
    session.commit()
    return result


@router.post("/today/stops", response_model=StopsResult)
def add_stops(session: SessionDep, body: StopsInput, user: CurrentUser):
    """問答答案提到的客戶加進今天的行程，各自插在多繞最少的位置。"""
    try:
        itinerary, added, skipped = service.add_stops(session, _rep_id(user), body.customer_ids)
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    result = StopsResult(
        itinerary=_out(service.view(session, itinerary)), added=added,
        skipped=[SkippedStop(**dataclasses.asdict(item)) for item in skipped],
    )
    session.commit()
    return result
```

`backend/app/main.py`：import 那行把 `route` 換成 `itinerary`（照字母順序放在 `first_week` 之後），`app.include_router(route.router)` 改成 `app.include_router(itinerary.router)`。然後 `git rm backend/app/api/route.py`。

- [ ] **Step 4: today_route 拿掉舊的輸出與「插入下一站」清單**

`backend/app/services/today_route.py`：

1. 刪掉 `Stop`、`TodayRoute` 兩個 dataclass、`build` 函式、`STOP_GAP_MINUTES` 常數與它上面那行註解（`FIRST_STOP` 留著，註解改成「第一站的出門時間，跟假資料排拜訪用的節奏一致（9:30 出門）」）。
2. `Feedback` 拿掉 `pinned`，docstring 改成「業務按過的暫緩與誤判（存在伺服器，load_feedback 讀出來）。」
3. 模組 docstring 第 3～6 行改成：
   ```
   排序用學出來的模型（route_model），沒有模型檔就退回規則排序。承諾逾期的客戶不管分數高低都排進來，
   因為那是答應過客戶的事，不該讓模型決定。這裡只決定今天去哪幾家；順序由 services/itinerary.py 排順路。
   ```
4. `pick` 裡 `pool.append` 的 `"rank"` 改成 `"forced"`：
   ```python
               # 逾期的承諾排最前面，再來才照分數。這類提醒被按過「誤判」就不再硬排：
               # 業務說這種提醒對他沒用，硬排等於不理他
               "forced": unresolved and weight >= 0,
   ```
   後面用到 `rank` 的三處改成：
   ```python
       pool.sort(key=lambda item: (item["forced"], item["score"]), reverse=True)
       # 逾期承諾超過上限的，排回分數的隊伍裡，不再硬插到前面
       kept, dropped = [], []
       for item in pool:
           (dropped if item["forced"] and sum(1 for k in kept if k["forced"]) >= MAX_OVERDUE_STOPS else kept).append(item)
   ```
   ```python
           replaceable = [i for i, item in enumerate(picked) if not item["forced"]]
   ```
5. `TAIPEI` 若已沒有用到就從 import 拿掉（`ruff` 會抓）。

`backend/app/services/org_admin.py:126` 的 `services/today_route.py 只排業務的` 改成 `services/itinerary.py 只排業務的`。

- [ ] **Step 5: 改寫 test_today_route.py**

整個檔案換成：

```python
"""今日路線挑哪幾家：模型、逾期承諾、商機、暫緩與誤判。順序與存檔在 test_itinerary.py。"""

import datetime as dt

from sqlalchemy.orm import Session

from app.models import RouteSignalWeight, RouteSnooze
from app.services import route_model, today_route

TODAY = dt.date(2026, 10, 28)


def pick(engine, user_id="U01", feedback=None):
    with Session(engine) as session:
        return today_route.pick(session, user_id, feedback)


def ids(result):
    return [item["candidate"].customer_id for item in result.picked]


def test_pick_lists_five_customers_with_reasons(engine):
    result = pick(engine)
    assert result.today == TODAY and result.rep.name == "林昱辰"
    assert len(result.picked) == today_route.ROUTE_SIZE == len(set(ids(result)))
    assert all(item["reason"] and item["signal"] in today_route.SIGNAL_LABEL for item in result.picked)


def test_every_rep_picks_their_own_customers(engine):
    seen = set()
    for rep_id in ("U01", "U02", "U03", "U04", "U05"):
        picked = set(ids(pick(engine, rep_id)))
        assert len(picked) == today_route.ROUTE_SIZE and not picked & seen
        seen |= picked


def test_urgent_card_explains_the_first_pick(engine):
    result = pick(engine)
    assert result.urgent.customer_id == result.picked[0]["candidate"].customer_id
    assert result.urgent.headline == today_route.SIGNAL_LABEL[result.picked[0]["signal"]]
    assert result.urgent.detail


def test_snoozed_customer_is_not_picked(engine):
    first = ids(pick(engine))[0]
    after = pick(engine, feedback=today_route.Feedback(snoozed={first: dt.date(2026, 10, 31)}))
    assert first not in ids(after) and len(after.picked) == today_route.ROUTE_SIZE


def test_snooze_expires(engine):
    first = ids(pick(engine))[0]
    after = pick(engine, feedback=today_route.Feedback(snoozed={first: TODAY}))
    assert ids(after)[0] == first


def test_marking_a_signal_wrong_pushes_that_kind_down(engine):
    before = pick(engine)
    signal = before.picked[0]["signal"]
    after = pick(engine, feedback=today_route.Feedback(signal_weights={signal: -5}))
    # 分數被壓一半，同類提醒不會再排第一（除非整條路線都是同一類）
    assert after.picked[0]["signal"] != signal or len({item["signal"] for item in before.picked}) == 1


def test_overdue_commitment_beats_the_model(engine):
    result = pick(engine)
    overdue = [item for item in result.picked if item["signal"] == "commitment"]
    assert overdue, "假資料裡應該有逾期的承諾"
    assert result.picked[0]["signal"] == "commitment"
    assert len(overdue) <= today_route.MAX_OVERDUE_STOPS


def test_saved_feedback_is_read_back(tx):
    tx.add_all([
        RouteSnooze(user_id="U01", customer_id="C001", until=dt.date(2026, 10, 31)),
        RouteSnooze(user_id="U01", customer_id="C002", until=TODAY),
        RouteSignalWeight(user_id="U01", signal="ar", weight=-2),
    ])
    tx.flush()
    feedback = today_route.load_feedback(tx, "U01", TODAY)
    # 期限是今天的暫緩已經過了
    assert feedback.snoozed == {"C001": dt.date(2026, 10, 31)}
    assert feedback.signal_weights == {"ar": -2}


def test_label_explains_a_customer_the_rep_adds(engine):
    with Session(engine) as session:
        signal, reason = today_route.label(session, "U01", "C061")
    assert signal in today_route.SIGNAL_LABEL and reason


def test_model_file_matches_the_features_in_code():
    model = route_model.load_model()
    assert model, "權重檔要跟著程式一起進 git"
    assert set(model["weights"]) == set(route_model.FEATURES) == set(model["mean"]) == set(model["sd"])
    # 訓練時記下的成績：模型要比現行規則好，否則不值得上線
    assert model["metrics"]["auc"] > model["metrics"]["rule_auc"]


def test_growing_clinics_are_opportunities(engine):
    with Session(engine) as session:
        found = today_route._opportunities(session, "U01", TODAY)
    # 杏林診所（C061）是刻意設計的「慢箋成長」：慢性處方每次多進五成
    assert "單次進貨金額從" in found["C061"] and "學名藥比價表" in found["C061"]


def test_every_rep_with_an_opportunity_gets_one_picked(engine):
    for rep_id in ("U01", "U02", "U03", "U04", "U05"):
        result = pick(engine, rep_id)
        with Session(engine) as session:
            has_any = bool(today_route._opportunities(session, rep_id, TODAY))
        labelled = [item for item in result.picked if item["signal"] == "opportunity"]
        assert bool(labelled) == has_any, rep_id
        assert all(item["reason"] for item in labelled)
```

`backend/tests/test_oauth.py:71-72` 改成：

```python
    route = client.get("/api/itinerary/today", headers=headers).json()
    assert route["rep"]["id"] == "U01" and len(route["stops"]) == 5
```

注意：這個測試不在 `tx` 裡，會在測試庫留下 U01 當天的行程；其他行程測試都用 `tx`，看到已存在的行程也照樣成立（`version` 仍是 1）。

- [ ] **Step 6: 跑後端全部測試**

Run: `TEST_DB_NAME=meddemo_test_itinerary TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests -q`
Expected: 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add -A backend
git commit -m "Serve the saved itinerary from /api/itinerary and retire the per-request route API"
```

---

### Task 7: 前端換成存著的行程

**Files:**
- Modify: `frontend/src/api/route.ts`
- Modify: `frontend/src/pages/today.tsx`
- Modify: `frontend/src/components/ask/ask-result.tsx:1-11`、`:137-178`
- Modify: `frontend/src/components/route-path.test.ts:9-22`
- Delete: `frontend/src/lib/route-feedback.ts`

**Interfaces:**
- Consumes: Task 6 的三支 API。
- Produces:
  - `RouteStop` 多 `source`、`duration_minutes`、`late_minutes`、`travel_minutes`、`travel_km`
  - `TodayRoute` 多 `version`、`travel_minutes`、`travel_km`、`finish_time`、`estimated`
  - `RouteAction = "pin" | "snooze" | "misjudge"`
  - `getTodayRoute(userId: string, signal?: AbortSignal): Promise<{ route: TodayRoute; cached: boolean }>`
  - `sendRouteFeedback(userId: string, customerId: string, action: RouteAction, version: number): Promise<TodayRoute>`
  - `addStopsToToday(userId: string, customerIds: string[]): Promise<AddStopsResult>`，`AddStopsResult = { itinerary: TodayRoute; added: string[]; skipped: { customer_id: string; customer_name: string; reason: string }[] }`

- [ ] **Step 1: 改 route-path 測試的資料（先讓型別跟上）**

`frontend/src/components/route-path.test.ts` 的 `stop()` 回傳物件在 `visit_id: null,` 後面加：

```ts
    source: "model",
    duration_minutes: 40,
    late_minutes: 0,
    travel_minutes: 10,
    travel_km: 3.2,
```

- [ ] **Step 2: api/route.ts**

型別：`RouteStop` 在 `visit_id` 後面加：

```ts
  // model：系統早上排的；rep：業務自己加的；ai：跟熊熊滾說加的；ask：問答頁「排入今天的路線」
  source: "model" | "rep" | "ai" | "ask"
  duration_minutes: number
  // 約的時間趕不上會晚到幾分鐘（第二階段才能設約的時間）
  late_minutes: number
  // 從上一站開過來；已完成的站是 null
  travel_minutes: number | null
  travel_km: number | null
```

`TodayRoute` 改成：

```ts
export type TodayRoute = {
  date: string
  rep: { id: string; name: string }
  // 每改一次加一；三顆鈕送出時帶著，行程剛被別人改過後端會回 409
  version: number
  done: number
  total: number
  urgent: RouteUrgent | null
  stops: RouteStop[]
  travel_minutes: number
  travel_km: number
  finish_time: string | null
  // 車程是直線估算的
  estimated: boolean
}

export type RouteAction = "pin" | "snooze" | "misjudge"

export type AddStopsResult = {
  itinerary: TodayRoute
  added: string[]
  skipped: { customer_id: string; customer_name: string; reason: string }[]
}
```

刪掉 `RouteFeedback` 型別與它上面的註解。`getTodayRoute` 換成：

```ts
/**
 * 今天的行程（存在伺服器，當天第一次讀取時照系統的建議建好）；連不上伺服器時改用上次拿到的那份（cached 為 true，畫面上要標明）。
 * 是哪一位業務由後端看 token 認，不必送 user_id；這裡的 userId 只用來分開每個人在這支手機上的快取。
 */
export async function getTodayRoute(userId: string, signal?: AbortSignal) {
  try {
    const route = await request<TodayRoute>("/api/itinerary/today", { signal })
    writeCache(routeKey(userId), route)
    return { route, cached: false }
  } catch (error) {
    // 主管沒有自己的拜訪路線（403）：這不是連不上，不能拿舊的那份出來充數
    if (error instanceof ApiError && error.status === 403) throw error
    const cached = signal?.aborted ? null : readCache<TodayRoute>(routeKey(userId))
    if (cached) return { route: cached, cached: true }
    throw error
  }
}

/** 需立即處理的三顆鈕：後端直接改今天的行程，回傳改好的那一份 */
export async function sendRouteFeedback(userId: string, customerId: string, action: RouteAction, version: number) {
  const route = await request<TodayRoute>(
    "/api/itinerary/today/feedback",
    jsonBody("POST", { customer_id: customerId, action, version })
  )
  writeCache(routeKey(userId), route)
  return route
}

/** 問答答案提到的客戶加進今天的行程，後端各自插在多繞最少的位置 */
export async function addStopsToToday(userId: string, customerIds: string[]) {
  const result = await request<AddStopsResult>(
    "/api/itinerary/today/stops",
    jsonBody("POST", { customer_ids: customerIds })
  )
  writeCache(routeKey(userId), result.itinerary)
  return result
}
```

- [ ] **Step 3: today.tsx 的三顆鈕**

1. import：`import { getTodayRoute, sendRouteFeedback, type RouteAction, type TodayRoute } from "@/api/route"`；刪掉 `import { markMisjudged, pinCustomer, readFeedback, snoozeCustomer } from "@/lib/route-feedback"`。
2. `TodayPage` 上面的 docstring 最後兩行改成：
   ```
    * 最上面是「需立即處理」，業務按三顆鈕給回饋（插入下一站／暫緩／誤判），
    * 後端直接改存著的今日行程（services/itinerary.py），回來的就是改好的那一份。
   ```
3. `getTodayRoute(userId, readFeedback(userId), controller.signal)` 改成 `getTodayRoute(userId, controller.signal)`。
4. `pin`、`snooze`、`misjudge` 三個函式與上面那行註解換成：
   ```tsx
   // 三顆鈕：後端改今天的行程，回來的就是改好的那一份。行程剛被別人改過（409）就重新載入最新的
   async function feedback(action: RouteAction, message: string) {
     if (!user || !urgent || !route) return
     setBusy(true)
     try {
       const next = await sendRouteFeedback(user.id, urgent.customer_id, action, route.version)
       setState({ status: "ready", route: next, cached: false })
       setHint(message)
       setBusy(false)
     } catch (error) {
       if (error instanceof ApiError && error.status === 409) {
         setHint(error.message)
         reload()
         return
       }
       setHint(error instanceof ApiError ? error.message : "連不上伺服器，這次沒有改到，請再試一次。")
       setBusy(false)
     }
   }

   const pin = () => feedback("pin", "已插到下一站，之後這類提醒會排前面一點。")
   const snooze = () => feedback("snooze", "先暫緩，三天內不會再排這家。")
   const misjudge = () => feedback("misjudge", "知道了，這類提醒會少排一點。")
   ```
5. `busy && route` 那段的「重新排今天的順序…」改成「更新今天的行程…」。

- [ ] **Step 4: ask-result.tsx 的「排入今天的路線」**

import 區：刪掉 `import { pinCustomers, readFeedback } from "@/lib/route-feedback"`，加上
`import { ApiError } from "@/api/client"` 與 `import { addStopsToToday } from "@/api/route"`（照現有 import 的排列放）。

`PinToRoute` 整個換成：

```tsx
type PinState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "done"; added: string[]; skipped: { customer_id: string; customer_name: string; reason: string }[] }
  | { status: "error"; message: string }

/**
 * 原型的「排入拜訪」：答案提到的客戶加進今天的行程，各自插在多繞最少的位置。系統只有今天的行程、
 * 沒有排日期的拜訪計畫，按鈕照實說「今天」。只有業務看得到：主管沒有路線。
 */
function PinToRoute({ customers }: { customers: Ask["customers"] }) {
  const user = useAuth()?.user
  const [state, setState] = useState<PinState>({ status: "idle" })
  if (!user || user.role !== "sales") return null

  if (state.status === "done") {
    return (
      <div className="flex flex-col items-start gap-0.5 rounded-lg bg-primary/10 px-3 pt-2.5 text-sm text-primary">
        {state.added.length > 0 && (
          <span className="flex items-center gap-1.5">
            <Check className="size-4 shrink-0" />
            已加進今天的行程，插在順路的位置
          </span>
        )}
        {state.skipped.map((item) => (
          <span key={item.customer_id} className="text-xs text-muted-foreground">
            {item.customer_name}沒加進去：{item.reason}
          </span>
        ))}
        <Link to="/" className="flex min-h-11 items-center font-medium underline underline-offset-4">
          去今日路線
        </Link>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground">答案提到的客戶：{customers.map((customer) => customer.name).join("、")}</p>
      <Button
        className="h-11"
        disabled={state.status === "busy"}
        onClick={async () => {
          setState({ status: "busy" })
          try {
            const result = await addStopsToToday(user.id, customers.map((customer) => customer.id))
            setState({ status: "done", added: result.added, skipped: result.skipped })
          } catch (error) {
            setState({ status: "error", message: error instanceof ApiError ? error.message : "連不上伺服器，請再試一次" })
          }
        }}
      >
        <CalendarPlus className="size-4" />
        排入今天的路線（{customers.length} 家）
      </Button>
      {state.status === "error" && <p className="text-xs text-destructive">{state.message}</p>}
    </div>
  )
}
```

- [ ] **Step 5: 刪掉手機上的回饋**

```bash
git rm frontend/src/lib/route-feedback.ts
grep -rn "route-feedback\|RouteFeedback\|readFeedback" frontend/src
```
Expected: grep 沒有結果。

- [ ] **Step 6: 型別、lint、測試、建置**

```bash
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
```
Expected: 全部成功。

- [ ] **Step 7: Commit**

```bash
git add -A frontend
git commit -m "Read the saved itinerary on the home page and send the three buttons and added stops to it"
```

---

### Task 8: 文件、整體驗證

**Files:**
- Modify: `README.md:178-215`（今日路線）、程式結構表（`today_route.py` 那一列附近）
- Modify: `docs/superpowers/specs/2026-10-01-itinerary-planning-design.md`（`route_feedback` 那一段）

- [ ] **Step 1: README**

〈今日路線（首頁）〉一節：

1. 「排順序的是學出來的模型」那一點的開頭改成「**挑今天去哪幾家的是學出來的模型**，順序另外排順路（見下面〈行程存在伺服器〉）」。
2. 「三顆鈕」整點換成：
   ```markdown
   - **行程存在伺服器**（設計見 [docs/superpowers/specs/2026-10-01-itinerary-planning-design.md](docs/superpowers/specs/2026-10-01-itinerary-planning-design.md)）：
     - 當天第一次打開時，模型挑好幾家，再由排序程式（`backend/app/services/route_planner.py`）排順路：把所有排法試過，挑總車程最短的那條；「需立即處理」那家鎖在第一站。之後一律讀存著的這份，模型不再重排。
     - 客戶沒有真的地址：位置是所在行政區的中心點，依客戶編號錯開幾百公尺（`data/seed/catalog.py` 的 `DISTRICT_COORDS`）。從區處辦公室 9:30 出發，車程用直線距離 × 1.4 ÷ 時速 30 公里再加 5 分鐘停車估算，每站停 40 分鐘。
     - 兩個人同時改同一位業務的行程時，後送出的那一個會被擋下來（版本號），畫面重新載入最新的。
   - **三顆鈕**（插入下一站／暫緩／誤判）直接改今天的行程：
     - 插入下一站：移到下一站，同類提醒之後排前面一點。暫緩：從今天拿掉，三天內不排這家。誤判：同類提醒之後少排一點，這家也先暫緩。
     - 暫緩與誤判存在伺服器（`route_snooze`、`route_signal_weight`），影響的是之後每天的建議。每按一次，該類提醒的分數調整一成，上下限五次，免得按久了完全蓋過模型。
     - 業務按了暫緩就不排，逾期的承諾也一樣；某類提醒被按過誤判，那類就不再硬排。
     - **回饋沒有拿去重新訓練模型**（監督式學習權重不在這次範圍）。決賽被問到就照實說：回饋已經在收，調的是這位業務自己的排序。
   - 問答答案的「排入今天的路線」也是直接加進今天的行程，插在多繞最少的位置；一天還沒跑的站最多 8 站。
   ```
3. 程式結構表 `today_route.py` 那一列改成 `今日路線：挑今天要去哪幾家、為什麼`，後面加三列：
   ```
   backend/app/services/route_planner.py 排今天的順序：守住規則、晚到最少、車程最短
   backend/app/services/travel.py      兩點之間開車要多久（直線估算）
   backend/app/services/itinerary.py   今天的行程：存檔、版本、三顆鈕、加站
   ```

- [ ] **Step 2: 設計文件的資料表名**

`docs/superpowers/specs/2026-10-01-itinerary-planning-design.md` 〈原本存在手機上的回饋〉第一句改成：
「**`route_snooze`**（`user_id`、`customer_id`、`until`）與 **`route_signal_weight`**（`user_id`、`signal`、`weight`）：」，其餘不變；〈原本的功能怎麼接〉表格裡的 `route_feedback` 也改成這兩張表名。

- [ ] **Step 3: 後端與前端全部重跑**

```bash
TEST_DB_NAME=meddemo_test_itinerary TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests -q
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
```
Expected: 全部成功，貼出 pytest 的最後一行與 vitest 的通過數。

- [ ] **Step 4: 實機看一次**

照 [[run-stack-from-a-worktree]] 的作法起一套獨立的後端（資料庫 `meddemo_itinerary_dev`、Redis 11 號庫、port 8011）並灌資料，Vite 用暫時的 `vite.itinerary.config.ts` 把 proxy 指到 8011、port 5181。用無頭 Chrome（每段 20 秒內、各自的 port 與 `--user-data-dir`）以 U01 登入，在 375×812 截圖：

1. 首頁：五站、第一站是「需立即處理」那家、時間從 9:30 之後遞增。
2. 按「暫緩」：那一站消失、提示「先暫緩，三天內不會再排這家。」，重新整理後仍然消失（存在伺服器）。
3. 問答頁查數字的答案按「排入今天的路線」：顯示「已加進今天的行程，插在順路的位置」，回首頁看得到那一家。

截圖放 scratchpad，看過之後刪掉暫時的 vite 設定、停掉服務、刪掉 dev 資料庫與複製進來的 `backend/.env`。

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/specs/2026-10-01-itinerary-planning-design.md
git commit -m "Describe the saved, route-ordered itinerary in the README"
```

- [ ] **Step 6: 交給使用者決定要不要推**

回報：測試結果、截圖看到的狀況、分支 `itinerary` 上的 commit 清單。推到 main 前要先 `git fetch` 並 rebase 到 `origin/main`（其他對話也在改 `models.py`），由使用者說「推上去」才推（[[push-straight-to-main]]）。
