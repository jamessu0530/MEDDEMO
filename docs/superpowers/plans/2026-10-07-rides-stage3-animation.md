# 座騎第三階段：騎乘動畫、座騎圖鑑與新竹的示範資料 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 首頁蛇行路線上，熊熊滾騎著「那一段的縣市 × 交通方式」的座騎停在下一站旁邊；完成一站回到首頁（或今天第一次打開）時，自動騎到下一站，跨縣市時半路冒煙換車。騎過的記在伺服器，收工旗子下面進「座騎圖鑑」看 28 種收集了幾種。示範業務今天的路線多一站新竹，評審看得到騎著貢丸進新竹。

**Architecture:** 後端多一張 `vehicle_ride` 與兩支 API（`services/vehicles.py`、`api/vehicles.py`），IT 重置示範行程時一起清。示範資料加新竹市與三家客戶（另一批、自己的亂數，不動既有的客戶）。前端：`lib/rides.ts` 加「這次該播哪一段」等純函式，`lib/ride-memory.ts` 記播過哪幾段與還沒送出的騎乘記錄；`components/rides/ride-on-route.tsx` 是路線上的那台座騎（停著、點了重播、用 Web Animations API 動外層的 div）；`pages/rides.tsx` 是圖鑑。

**Tech Stack:** FastAPI、SQLAlchemy 2.0、pytest；React 19、TypeScript、Web Animations API、vitest。

**設計文件：** `docs/superpowers/specs/2026-10-07-ride-vehicles-design.md`〈動畫〉〈座騎圖鑑〉〈示範資料〉〈出錯時〉〈測試〉（〈分階段做〉的第 3 階段）。座騎元件是第二階段做好的 `components/rides/ride.tsx`。

## Global Constraints

- 註解與畫面文字一律繁體中文；畫面不用表情符號，圖示用 lucide。不要對動到的前端檔案跑 `prettier --write`。
- 縣市名稱照資料庫（`台北市`、`新北市`、`新竹市`、`台中市`、`彰化縣`、`台南市`、`高雄市`）；交通方式 `drive`、`scooter`、`transit`、`walk`。
- 座騎元件 `<Ride city mode size flipped still label className />` 不改它的 SVG；**動畫一律做在包住它的外層 `<div>` 上**（座騎裡的定位、左右翻都是 SVG 的 transform 屬性，對 SVG 元素做 CSS／WAAPI transform 會把屬性蓋掉）。`Ride` 的 `.ride { display: block }` 沒放在 layer 裡，會贏過從 `className` 傳進去的 Tailwind utility——要改版面就包一層。
- 座騎畫布是 300×200，地面在 y=187：著地點是框的 (50%, 93.5%)，`transform-origin` 與停的位置都對齊這一點。
- 動畫只用 transform 與 opacity。系統設定「減少動態效果」時不移動、不浮動（WAAPI 不受 CSS 的 reduced-motion 規則管，要自己判斷 `matchMedia("(prefers-reduced-motion: reduce)")`）。
- 一段路的時間：0.3 秒冒出來、2.4 秒沿路走、0.3 秒到站壓扁回彈，共約 3 秒；跨縣市在走到一半時冒煙換車、頭上冒出新縣市的名字 1 秒。
- 播過哪幾段記在 localStorage，key 含日期與兩端的客戶；讀寫都包 try/catch。騎乘記錄送不出去先存 localStorage，下次打開首頁再送。
- 縣市名稱 → 座騎：`rideCity(city)`（`lib/rides.ts`）；不在七個縣市裡的，熊熊滾自己走（`Ride` 已處理）。
- 後端：業務由 token 決定（`acts_as_user_id or id`），主管與 IT 打業務的 API 回 403「主管沒有自己的拜訪路線」。
- 測試在隔離的資料庫與 Redis 跑：`TEST_DB_NAME=meddemo_test_rides3 TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests ...`。前端：`npm --prefix frontend run test -- <檔名>`；收尾跑 `npm --prefix frontend run typecheck`、`npm --prefix frontend run lint`、`npm --prefix frontend test`。
- 每個 commit 訊息用英文祈使句，最後空一行再加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

---

### Task 1: 後端記騎過哪些座騎

**Files:**
- Modify: `backend/app/models.py`（`VehicleRide`、`RIDE_CITIES`）
- Create: `backend/app/services/vehicles.py`、`backend/app/api/vehicles.py`；Modify: `backend/app/main.py`（`include_router`）
- Modify: `backend/app/services/itinerary.py` `reset_today`（多清 `vehicle_ride`）
- Create: `backend/tests/test_vehicles.py`

**Interfaces:**
- Produces:
  - `models.RIDE_CITIES = ("台北市", "新北市", "新竹市", "台中市", "彰化縣", "台南市", "高雄市")`（跟前端 `lib/rides.ts` 的 `RIDE_CITIES` 同一組、同順序）
  - `models.VehicleRide(user_id, city, mode, first_ridden_at)`：主鍵 `(user_id, city, mode)`；`city` CHECK 在 `RIDE_CITIES`、`mode` CHECK 在 `LEG_MODES`；`user_id` 外鍵 `app_user.id` `ondelete="CASCADE"`
  - `vehicles.record(session, user_id, rides: list[tuple[str, str]]) -> None`：`INSERT … ON CONFLICT DO NOTHING`（送兩次只記一次、第一次的時間不變）
  - `vehicles.collection(session, user_id) -> list[Ridden]`：28 筆，照 `RIDE_CITIES × LEG_MODES` 的順序，`Ridden(city, mode, ridden_at: datetime | None)`
  - `POST /api/vehicles/rides`：body `{"rides": [{"city": …, "mode": …}]}`（1～4 筆；`city` 是七個縣市的 Literal、`mode` 是 `TravelMode`），回 204
  - `GET /api/vehicles`：`{"total": 28, "ridden": n, "items": [{"city", "mode", "ridden_at"}]}`
  - 兩支都只給業務；主管、IT 403 `NO_ROUTE`（同 `api/itinerary.py` 的字）
  - `itinerary.reset_today` 多刪 `VehicleRide where user_id == user_id`

- [ ] **Step 1: 寫失敗的測試**（`backend/tests/test_vehicles.py`，用 `tx` 與 `TestClient(app)`，照 `test_itinerary_api.py` 的 fixture 寫法）

```python
"""座騎圖鑑：騎過哪些座騎（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md〈座騎圖鑑〉）。"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import RIDE_CITIES, VehicleRide
from app.services import itinerary as itinerary_service
from app.services import vehicles


@pytest.fixture
def client(tx):
    return TestClient(app)


def test_a_ride_is_recorded_once_and_keeps_its_first_time(tx):
    vehicles.record(tx, "U01", [("新竹市", "scooter")])
    first = tx.scalar(select(VehicleRide.first_ridden_at).where(VehicleRide.user_id == "U01"))
    vehicles.record(tx, "U01", [("新竹市", "scooter"), ("新北市", "scooter")])
    rows = tx.execute(select(VehicleRide.city, VehicleRide.mode, VehicleRide.first_ridden_at)
                      .where(VehicleRide.user_id == "U01").order_by(VehicleRide.city)).all()
    assert [(c, m) for c, m, _ in rows] == [("新北市", "scooter"), ("新竹市", "scooter")]
    assert next(t for c, _, t in rows if c == "新竹市") == first


def test_the_collection_lists_all_28_in_order(tx):
    vehicles.record(tx, "U01", [("台中市", "walk")])
    items = vehicles.collection(tx, "U01")
    assert len(items) == 28
    assert [(i.city, i.mode) for i in items[:4]] == [("台北市", "drive"), ("台北市", "scooter"), ("台北市", "transit"), ("台北市", "walk")]
    assert [i.city for i in items[::4]] == list(RIDE_CITIES)
    assert [(i.city, i.mode) for i in items if i.ridden_at] == [("台中市", "walk")]


def test_rides_through_the_api(client, auth):
    sent = client.post("/api/vehicles/rides", json={"rides": [{"city": "新竹市", "mode": "walk"}]}, headers=auth())
    assert sent.status_code == 204, sent.text
    data = client.get("/api/vehicles", headers=auth()).json()
    assert data["total"] == 28 and data["ridden"] == 1
    assert {(i["city"], i["mode"]) for i in data["items"] if i["ridden_at"]} == {("新竹市", "walk")}


@pytest.mark.parametrize("body", [
    {"rides": [{"city": "桃園市", "mode": "walk"}]},
    {"rides": [{"city": "新竹市", "mode": "rocket"}]},
    {"rides": []},
    {"rides": [{"city": "新竹市", "mode": "walk"}] * 5},
])
def test_bad_rides_are_refused(client, auth, body):
    assert client.post("/api/vehicles/rides", json=body, headers=auth()).status_code == 422


def test_managers_have_no_rides(client, auth):
    assert client.get("/api/vehicles", headers=auth("M01")).status_code == 403
    assert client.post("/api/vehicles/rides", json={"rides": [{"city": "新竹市", "mode": "walk"}]},
                       headers=auth("M01")).status_code == 403


def test_resetting_the_demo_itinerary_clears_rides(tx):
    vehicles.record(tx, "U01", [("新竹市", "walk")])
    itinerary_service.reset_today(tx, "U01")
    assert vehicles.collection(tx, "U01")[0].ridden_at is None
    assert tx.scalar(select(VehicleRide).where(VehicleRide.user_id == "U01")) is None
```

（代理示範業務的第三方登入帳號：跟其他路線 API 一樣用 `acts_as_user_id or id`。照 `test_itinerary_api.py` 裡既有「代理示範業務」測試的寫法，再加一個測試確認這種帳號送的記在 U01 名下。）

- [ ] **Step 2: 跑測試確認失敗**（ImportError）
- [ ] **Step 3: 實作**（模型、服務、API、`main.py` 掛上 router、`reset_today` 多一行）。`record` 用 `sqlalchemy.dialects.postgresql.insert(...).on_conflict_do_nothing(index_elements=["user_id", "city", "mode"])`。API 的 Literal：`RideCityName = Literal["台北市", "新北市", "新竹市", "台中市", "彰化縣", "台南市", "高雄市"]`。
- [ ] **Step 4: 跑測試確認通過，再跑整個後端一次**
- [ ] **Step 5: Commit** — `Record which ride vehicles each rep has ridden`

---

### Task 2: 示範資料加新竹市

**Files:**
- Modify: `data/seed/catalog.py`、`data/seed/generate.py`（必要時 `data/seed/seed.py`）
- Modify: 受影響的測試（`backend/tests/test_seed.py` 的地點與頻道數量等）
- Create: 驗收測試（放在 `backend/tests/test_today_route.py` 或新檔 `backend/tests/test_demo_hsinchu.py`）
- Modify: `docs/superpowers/specs/2026-10-07-ride-vehicles-design.md`〈示範資料〉（驗收條件改寫，見下）

**要做到的：**

1. `REGION_CITIES["北區"]` 加 `新竹市`；`PLACES` 加 `("HSZ", "新竹市", "TW.N")`；`DISTRICT_COORDS` 加 `("新竹市", "東區"): (24.8016, 120.9718)`、`("新竹市", "北區"): (24.8160, 120.9629)`、`("新竹市", "香山"): (24.7756, 120.9139)`。
2. 新增 3 家新竹市的客戶（至少一家藥局、一家診所；名稱照既有的命名方式「店名 · 地區」，連鎖分店照既有連鎖體系的規則），**算在林昱辰（U01）名下**。
3. **不動既有的客戶與隨機資料**：新的這一批放在既有清單之後、用自己的 `Random`（例如 `seed + 3`），而且不影響 `assigned[region]` 的輪流分配與既有的 `rng`、`extra_rng`、拜訪排程的亂數序列——既有客戶的編號（C001～C250）、拜訪、訂單、帳款都要跟現在一模一樣。做法自己選，但要有測試證明（例如：拿現在 main 上灌出來的某幾家客戶的關鍵欄位當固定值比對，或比對 C001～C250 的名稱與 owner 沒變）。
4. 讓其中一家**一定排進林昱辰今天的建議**、但**不是「需立即處理」那家**（那家會鎖在第一站）：不要給它逾期的承諾（會被強制排前面，最多兩家），用高分的非強制訊號，例如加進 `SCENARIO_CUSTOMERS`／`SCRIPTED_VISITS`／`GROWTH_CUSTOMERS` 這類既有機制，或很久沒去且等級 A。注意 `pick` 只會換進一家「商機」，而林昱辰已經有杏林（C061）。
5. **驗收條件**（寫成測試，用灌好的測試資料庫、`itinerary.get_or_create` + `view`）：
   - 林昱辰今天的路線有一站在新竹市，而且**那一站的前一站在新北市**（評審看得到從新北騎進新竹時換車）；
   - 路線裡也有台北市的站；
   - 「需立即處理」那家照舊是第一站。
   用什麼訊號達成都行，但要穩定（不靠 Google：測試沒有金鑰，順序照直線估算）。
6. 設計文件〈示範資料〉的驗收條件改成上面第 5 點的說法（原本寫「依序經過台北、新北、新竹」，但需立即處理那家在新北、一定排第一，所以不會是那個順序）。
7. 既有測試裡寫死的數量（客戶 250 → 253、地點 17 → 18、頻道 29 → 30 等）照新的資料更新；其他寫死的客戶編號不應該變（第 3 點）。

- [ ] **Step 1: 寫驗收測試與「既有客戶沒變」的測試**，確認失敗。
- [ ] **Step 2: 改示範資料**，跑那兩個測試到通過。
- [ ] **Step 3: 跑整個後端**，把真的因為多了三家、多一個地點而變的數字改掉；其他失敗代表動到了既有資料，回頭修。
- [ ] **Step 4: Commit** — `Add three Hsinchu customers so the demo route rides into Hsinchu`

---

### Task 3: 前端的純函式、記憶與 API

**Files:**
- Modify: `frontend/src/lib/rides.ts`、`frontend/src/lib/rides.test.ts`
- Create: `frontend/src/lib/ride-memory.ts`、`frontend/src/lib/ride-memory.test.ts`
- Create: `frontend/src/api/vehicles.ts`

**Interfaces:**
- Produces（`lib/rides.ts`）：
  - `type Leg = { from: string | null; to: string; fromCity: string | null; toCity: string; mode: LegMode }`：一段路；`from` 是 null 代表從辦公室出發，`fromCity` 是出發那一站（或辦公室）的縣市
  - `legInto(stops, index, startCity): Leg`：到第 `index` 站的那一段（`from` 用 `legFrom`；`fromCity` 是上一站的 `city`，第一站用 `startCity`）
  - `crossesCity(leg): boolean`：兩端都是 `RIDE_CITIES` 裡的縣市而且不一樣（有一端不認得就不算跨）
  - `legToPlay(stops, { played, officeStart, startCity }): Leg | null`：
    - 全部跑完 → null；
    - 有完成的站：「最後一個已完成的站 → 下一站（第一個還沒跑的）」這段，沒播過就回它；
    - 沒有完成的站：`officeStart` 時「辦公室 → 第 1 站」沒播過就回它；沒有辦公室起點回 null；
    - 播過了回 null。`played` 是 `Set<string>`，鍵用 `legKey(leg)`。
  - `legKey(leg): string`：`${leg.from ?? "office"}>${leg.to}`
  - `parkedLeg(stops, startCity): Leg | null`：停著的那台是哪一段（到「下一站」的那一段；全部跑完是 null）
  - `ridesOf(leg): { city: RideCity; mode: LegMode }[]`：這一段算騎過哪幾台——目的地縣市那一台，跨縣市再加出發縣市那一台；不在七個縣市裡的不算
- Produces（`lib/ride-memory.ts`，localStorage，讀寫都 try/catch、壞掉當作空的）：
  - `readPlayed(date: string): Set<string>`、`markPlayed(date: string, key: string): void`（key `meddemo:rides-played:<date>`）
  - `queueRides(rides)`、`takeQueuedRides()`（key `meddemo:rides-queue`，取出時清掉）
- Produces（`api/vehicles.ts`）：
  - `type RideCityName`、`type VehicleItem = { city; mode; ridden_at: string | null }`、`type Vehicles = { total: number; ridden: number; items: VehicleItem[] }`
  - `getVehicles(signal?) => Promise<Vehicles>`
  - `sendRides(rides) => Promise<void>`：先把 `takeQueuedRides()` 跟這次的併在一起（去重）送出；失敗就全部 `queueRides` 回去、不丟例外

- [ ] **Step 1: 寫失敗的測試**：`rides.test.ts` 用 `RouteStop` 假資料（照 `components/route-path.test.ts` 的 `stop()`）測 `legInto`、`crossesCity`（新北→新竹 true、台北→台北 false、桃園→新竹 false）、`legToPlay` 的五種情況（剛完成一站、今天第一次打開、沒有辦公室起點、都播過、全部跑完）、`parkedLeg`、`ridesOf`（同縣市一台、跨縣市兩台、不認得的縣市不算）；`ride-memory.test.ts` 用一個假的 `localStorage`（`vi.stubGlobal`）測讀寫、壞掉的 JSON、`localStorage` 丟例外時不會壞。
- [ ] **Step 2: 實作、跑測試、typecheck、lint**
- [ ] **Step 3: Commit** — `Work out which leg to ride and remember played legs and unsent rides`

---

### Task 4: 路線上的那台座騎（停著、點了重播）

**Files:**
- Create: `frontend/src/components/rides/ride-on-route.tsx`（與它的 css，如果需要）、`frontend/src/components/rides/ride-on-route.test.ts`
- Modify: `frontend/src/components/route-path.tsx`（拿掉站在路旁、點了進問答的 `Bear`；換成 `RideOnRoute`；收工旗子旁全部跑完時的 `yay` 熊熊滾照舊）
- Modify: `frontend/src/components/route-path.test.ts`

**行為：**

1. 停的位置：**下一站**那一列（`status === "next"`），圓鈕沒有名字的那一側（`labelSide(offset)` 的另一邊），離圓鈕 10px；座騎的地面線對齊圓鈕底邊。
2. 寬度：那一側從圓鈕邊到 `<ol>` 邊的空間減 4px，夾在 84～120px 之間（畫面中線的站約 120、偏 40 的約 104、偏 64 的約 84）；高是寬的 2/3。
3. 座騎：`<Ride city={leg.toCity} mode={leg.mode} still flipped={停在左邊} />`——停在圓鈕左側時臉朝右（不翻），停在右側時朝左（翻過來），都面向圓鈕。外層 div 慢慢上下浮（CSS keyframes，`ride-park-` 開頭；減少動態效果時不浮）。
4. 外層是 `<button>`：`aria-label`「熊熊滾騎著{特產}的{交通方式名稱}，點一下重播這一段」（特產用 `SPECIALTY`，不在七個縣市就寫「熊熊滾正走去下一站」之類），點了呼叫 `onReplay`（Task 5 接上動畫）。
5. 全部跑完：不顯示座騎，收工旗子旁照舊是 `Mascot state="yay"`。沒有下一站（例如今天沒有站）也不顯示。
6. 改了「到下一站那段」的交通方式（或整天的預設）：停著的座騎跟著換（重新 render 就會換，不重播）。
7. `RoutePath` 多收 `startCity?: string | null`（給第一段的出發縣市）。

- [ ] **Step 1: 寫失敗的測試**：`route-path.test.ts` 改掉「熊熊滾站在路旁，點了進問答」那個測試（不再有 `/ask` 連結），改成：有下一站時 render 一台 `data-city` 是下一站縣市、`data-mode` 是那段交通方式的座騎，`aria-label` 含「重播」；全部跑完時沒有座騎、有 `mascot-yay`。`ride-on-route.test.ts` 測寬度的夾值函式（抽成純函式 `parkWidth(offset, containerWidth)`）、停在哪一側（`parkSide(offset)`）、翻不翻。
- [ ] **Step 2: 實作，跑測試、typecheck、lint**
- [ ] **Step 3: 用 headless Chrome 截圖看停的樣子**（390 寬、淺色與深色；下一站在中線、偏右 64、偏左 64 三種位置都要看：可以改假資料的站數或用 `?` 參數，不要改程式邏輯）。座騎不壓到名字、圓鈕、膠囊、「出發」泡泡、急件卡片。
- [ ] **Step 4: Commit** — `Park the bear on the next leg's vehicle beside the next stop`

---

### Task 5: 騎乘動畫

**Files:**
- Modify: `frontend/src/components/rides/ride-on-route.tsx`（加動畫）
- Modify: `frontend/src/components/route-path.tsx`、`frontend/src/pages/today.tsx`（觸發與日期、只在路線分頁）
- Test: `frontend/src/components/rides/ride-on-route.test.ts`（純函式的部分）

**行為**（設計文件〈動畫〉）：

1. **什麼時候播**：首頁的路線分頁載入完（不是手機上的舊行程、不是在存檔中）、`legToPlay` 回一段時自動播；點停著的座騎重播「到下一站那段」（不管播過沒）。同一時間只播一段；播的時候再觸發就忽略。
2. **等墨退掉、捲到看得到**：`ink.phase()` 不是 `"idle"` 時用 `ink.subscribe` 等到 idle；再把下一站那一列 `scrollIntoView({ block: "center", behavior: 減少動態效果 ? "auto" : "smooth" })`，等約 400ms 再開始。
3. **路徑**：起點是上一站的停靠位置（「辦公室 → 第 1 站」的起點是第 1 站正上方、路線最上面），終點是下一站的停靠位置；兩點之間用二次貝茲曲線，控制點是兩站之間膠囊那一列的中點（跟蛇行的彎度一樣），取樣 16 點做成 WAAPI 的 keyframes（`transform: translate(x, y)`），作用在外層 div。往左走（終點 x < 起點 x）時座騎翻過來，到站後照 Task 4 的規則面向圓鈕。
4. **時間軸**（共約 3 秒，外層 div 上）：0–0.3 秒在起點彈出來（scale 0.6→1.1→1，座騎換成這一段的座騎）；0.3–2.7 秒沿路走（ease-in-out）；2.7–3.0 秒到站壓扁回彈（scale 1.1,0.9 → 1）。座騎本身在移動時拿掉 `still`（輪子轉、走路的動法），停下來再加回 `still`。
5. **跨縣市**（`crossesCity(leg)`）：走到 50% 時，在座騎位置冒一團淺紫（`#C9A2F5`）的煙（幾個圓放大、淡出，約 0.4 秒），煙最濃的那一刻把 `city` 從出發縣市換成目的地縣市；同時座騎上方冒出目的地縣市名稱的小標籤（`bg-card`、圓角、`text-xs font-semibold`），1 秒後淡出。
6. **騎過的記錄**：動畫一開始就 `sendRides(ridesOf(leg))`（中途切走也記得到），並 `markPlayed(date, legKey(leg))`。
7. **減少動態效果**：不移動、不冒煙、不彈，直接停在終點（目的地縣市的座騎）；記錄照送、照記播過。
8. **離開首頁、切到地圖分頁**：取消動畫（`animation.cancel()`），不留殘影。
9. **量不到位置**（ref 還沒掛上、`getBoundingClientRect` 是 0）：不播，直接停在終點，記錄照送。
10. 量位置與排程的純函式（貝茲取樣、時間軸切點、要不要翻）抽出來寫測試；DOM 與 WAAPI 的部分靠實際打開看。

- [ ] **Step 1: 寫純函式的失敗測試**（`samplePath(from, control, to, n)` 端點與中點、`shouldFlip(from, to)`、`timeline(cross)` 的切點）
- [ ] **Step 2: 實作動畫與觸發**，跑測試、typecheck、lint
- [ ] **Step 3: 實際打開看**：照 `run-stack-from-a-worktree` 起一套隔離環境（API 8013、Vite 5183、資料庫 `meddemo_rides3_dev`、Redis 第 11 號庫、`JWT_SECRET=rides3-check`），用 headless Chrome（每段 < 20 秒、新開 Chrome）在 390 寬：
  - 今天第一次打開：熊熊滾從路線上面騎到第 1 站，截動畫中間一張、停下來一張；
  - 跨縣市：把下一站之前那站設成完成（用 API 確認一筆今天的拜訪，或直接在測試資料庫插一筆已確認的拜訪），回首頁看到從新北騎進新竹、半路冒煙換車、頭上冒「新竹市」，截煙最濃與換好之後各一張；
  - 點停著的座騎重播；
  - 減少動態效果（`Emulation.setEmulatedMedia` 的 `prefers-reduced-motion: reduce`）：直接停在終點；
  - 深色主題一張。
  看截圖有怪的就修，再重截。收掉背景程式、刪掉暫時的檔案與資料庫。
- [ ] **Step 4: Commit** — `Ride the bear to the next stop and change vehicles at city borders`

---

### Task 6: 座騎圖鑑

**Files:**
- Create: `frontend/src/pages/rides.tsx`、`frontend/src/pages/rides.test.ts`（或元件拆出來測）
- Modify: `frontend/src/App.tsx`（`/rides` 路由，跟其他業務頁放一起）
- Modify: `frontend/src/components/route-path.tsx`（收工旗子下面一行入口）、`frontend/src/pages/today.tsx`（拿圖鑑的數字）

**行為**（設計文件〈座騎圖鑑〉）：

1. 入口：首頁路線最底下、收工旗子下面一行「座騎圖鑑 N/28」（`Link` 到 `/rides`，小字、主色）。N 從 `getVehicles()` 來；拿不到就只寫「座騎圖鑑」。動畫送出騎乘記錄後重拿一次（或直接在本地把那幾台算成騎過）。
2. 頁首：返回首頁、「座騎圖鑑」、「已收集 N/28」。下面一個縣市一區，照 `RIDE_CITIES` 的順序，區頭寫縣市與特產；每區四張卡（手機兩欄），卡上是 `<Ride size≈140 still />` 與交通方式名稱。
3. 騎過的：有顏色、平常靜止；點一下拿掉 `still` 動 3 秒再停；卡片下寫第一次騎的時間（`M/D HH:mm`）。
4. 沒騎過的：灰色剪影（外層 `filter: brightness(0)` 加淺色的 `opacity`，深色主題另外調；**不要用 CSS 改 fill**，線條會被填滿）、寫「還沒騎過」；點了在卡片下方提示「在{縣市}選{交通方式}就能收集」。
5. 主管、IT 打開 `/rides`：API 回 403，畫面寫「主管沒有自己的拜訪路線」（跟首頁一樣的處理）。
6. 連不上：寫「圖鑑暫時載入不了」與重試鈕。

- [ ] **Step 1: 寫失敗的測試**（`renderToStaticMarkup`：給一份 `Vehicles` 假資料，7 區 × 4 張、騎過的沒有剪影 class、沒騎過的有、「已收集 1/28」；入口那一行的字）
- [ ] **Step 2: 實作，跑測試、typecheck、lint**
- [ ] **Step 3: 截圖看**（390 寬，淺色、深色；騎過幾台與一台都沒騎的樣子）
- [ ] **Step 4: Commit** — `Add the ride collection page and its entry under the finish flag`

---

### Task 7: 收尾：README、規格與整體檢查

**Files:**
- Modify: `README.md`（首頁那一段補一句：熊熊滾騎著每段的座騎移到下一站、跨縣市換車；圖鑑在收工旗子下面；IT 重置也清騎過的記錄）
- Modify: `docs/superpowers/specs/2026-10-07-ride-vehicles-design.md`（把實作時定下來的細節寫回去：停的位置與寬度、動畫做在外層 div、剪影用 filter）

- [ ] **Step 1: 改文件**
- [ ] **Step 2: 全部檢查**：後端整個測試、前端 typecheck、lint、test、build。
- [ ] **Step 3: Commit** — `Describe the riding bear and the ride collection`
