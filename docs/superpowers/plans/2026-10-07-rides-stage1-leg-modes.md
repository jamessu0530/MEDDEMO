# 座騎第一階段：每段路另外選交通方式（接在整天的預設上） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 業務的交通方式（`app_user.travel_mode`，開車／機車／大眾運輸）照舊是整天的預設；首頁蛇行路線兩站之間多一顆膠囊，每一段可以另外選開車、機車、大眾運輸或走路，時間、地圖上的線、站卡與導航都照每段實際的交通方式。

**Architecture:** 後端：`google_routes` 多一種 `walk`；`travel` 的 `along`／`lines` 收「每段的交通方式」，相鄰同一種的段合成一組、各組同時問 Google，`options` 一次問一段的四種。另外選的存在新表 `itinerary_leg`（只存跟預設不一樣的段），`services/itinerary.py` 算時間照每段的交通方式、排順序照預設；換整天的預設清掉今天另外選的。前端：膠囊與選單（從 `rides` 分支搬過來再接上預設），地圖站卡與導航照每段。

**Tech Stack:** FastAPI、SQLAlchemy 2.0、httpx、pytest；React 19、TypeScript、Tailwind 4、lucide-react、vitest。

**設計文件：** `docs/superpowers/specs/2026-10-07-ride-vehicles-design.md`（本計畫是〈分階段做〉的第 1 階段）。

**可以搬的程式：** 分支 `rides`（`git show rides:<路徑>`）是同一個功能、在「整天只有開車」的舊版上做的，已經過審查。
蛇行路線、調整清單、提案卡在 main 上沒被別人改過，那幾個檔可以整個搬；後端與 `api/route.ts`、`lib/travel-mode.ts`、`pages/today.tsx`
兩邊都改過，只能參考 `rides` 的寫法、照本計畫接到 main 現在的程式上。**不要 merge 或 cherry-pick `rides` 的 commit。**

## Global Constraints

- 註解與畫面文字一律繁體中文，註解密度與口吻照周圍的程式。畫面不用表情符號，圖示用 lucide。
- 交通方式的值：`drive`、`scooter`、`transit`、`walk`，順序固定是這四個。整天的預設只能是前三種（`models.TRAVEL_MODES`，`app_user` 的 CHECK 照舊）；單段四種都可以（`models.LEG_MODES`）。
- 畫面上的名稱：開車、機車、大眾運輸、走路。圖示：`Car`、`Motorbike`、`TrainFront`、`Footprints`。Google 導航的 `travelmode`：driving、two-wheeler、transit、walking。
- Google：`walk` 送 `{"travelMode": "WALK"}`（不帶 `routingPreference`），可以帶中間點。大眾運輸照舊一段一段問、出發時間今天早上 10 點。
- 估算：走路 ×1.3、時速 4.5、不加分鐘；Google 的走路時間不另外加。其他三種照 main 現在的 `PACES`、`GOOGLE_EXTRA_MINUTES`，不改。
- `itinerary_leg` 只存跟業務預設不一樣的段；`from_customer_id` 是 NULL 代表從辦公室出發；`(itinerary_id, from_customer_id, to_customer_id)` 唯一且 `NULLS NOT DISTINCT`。
- 一段的交通方式 = 有那一列就用它，沒有就用 `app_user.travel_mode`。排順序（`matrix`）照預設，跟 main 一樣。
- 換整天的預設（`set_travel_mode`）時，刪掉今天這份行程的全部 `itinerary_leg`。
- 選單底下要寫「機車、走路路線是 Google 測試版」；只要有一種是 Google 算的就寫 Google Maps，四種都是估算才寫「（估計）」。
- 測試永遠不連真的 Google（conftest 已清空金鑰；要測 Google 就用 `env` 設假金鑰並假造 `google_routes`）。
- 測試在隔離的資料庫與 Redis 跑：`TEST_DB_NAME=meddemo_test_legs TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests ...`。
- 前端：`npm --prefix frontend run test -- <檔名>`；全部改完跑 `npm --prefix frontend run typecheck`、`npm --prefix frontend run lint`、`npm --prefix frontend test`。
- 每個 commit 訊息用英文祈使句，最後空一行再加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

---

### Task 1: Google 與估算多一種走路，四種交通方式的表對齊

**Files:**
- Modify: `backend/app/services/google_routes.py`（`TravelMode`、`DayMode`、`TRAVEL`）
- Modify: `backend/app/services/travel.py`（`PACES`、`GOOGLE_EXTRA_MINUTES`）
- Modify: `backend/app/models.py`（`LEG_MODES`）
- Modify: `backend/app/api/itinerary.py`（整天預設的輸入輸出改用 `DayMode`）
- Test: `backend/tests/test_google_routes.py`、`backend/tests/test_travel.py`、`backend/tests/test_itinerary_api.py`

**Interfaces:**
- Produces:
  - `google_routes.TravelMode = Literal["drive", "scooter", "transit", "walk"]`（單段）
  - `google_routes.DayMode = Literal["drive", "scooter", "transit"]`（整天的預設）
  - `google_routes.TRAVEL` 四個鍵，照上面的順序；`"walk": {"travelMode": "WALK"}`
  - `models.LEG_MODES = (*TRAVEL_MODES, "walk")`
  - `travel.PACES["walk"] = Pace(1.3, 4.5, 0)`、`travel.GOOGLE_EXTRA_MINUTES["walk"] = 0`

- [ ] **Step 1: 寫失敗的測試**

`test_google_routes.py` 最後加：

```python
def test_walking_sends_walk_without_a_routing_preference_and_keeps_intermediates():
    answer = {"routes": [{"legs": [
        {"duration": "600s", "distanceMeters": 800}, {"duration": "300s", "distanceMeters": 400},
    ]}]}
    http, sent = fake(lambda request: (200, answer))
    legs = google_routes.route_legs("k", [TAIPEI_MAIN, TAIPEI_101, SONGSHAN], http=http, polylines=False, mode="walk")
    assert [(leg.seconds, leg.meters) for leg in legs] == [(600, 800), (300, 400)]
    (request,) = sent
    body = json.loads(request.content)
    assert body["travelMode"] == "WALK"
    assert "routingPreference" not in body and "departureTime" not in body
    assert body["intermediates"] == [waypoint(TAIPEI_101)]
```

`test_travel.py` 最後加：

```python
def test_walking_has_its_own_estimate_and_no_extra_minutes_on_google():
    # 緯度差 0.1 度約 11.12 公里，×1.3 = 14.46 公里，時速 4.5 要 193 分
    assert travel.estimate((25.0, 121.5), (25.1, 121.5), "walk") == (193, 14.5)
    assert travel.road(google_routes.Cell(seconds=600, meters=800), "walk") == (10, 0.8)


def test_the_four_mode_tables_stay_aligned():
    from app import models

    modes = tuple(google_routes.TRAVEL)
    assert modes == ("drive", "scooter", "transit", "walk")
    assert set(travel.PACES) == set(travel.GOOGLE_EXTRA_MINUTES) == set(modes)
    assert models.LEG_MODES == modes
    assert models.TRAVEL_MODES == modes[:3]
```

`test_itinerary_api.py` 最後加：

```python
def test_walking_cannot_be_the_whole_days_mode(client, auth):
    response = client.put("/api/itinerary/travel-mode", json={"mode": "walk"}, headers=auth())
    assert response.status_code == 422
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_legs TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_google_routes.py backend/tests/test_travel.py backend/tests/test_itinerary_api.py -q`
Expected: 前 3 個新測試 FAIL（`KeyError: 'walk'`、`LEG_MODES` 不存在）。`test_walking_cannot_be_the_whole_days_mode` 現在就會過
（`TravelMode` 還是三種）；它是 `TravelMode` 變成四種之後的防護，Step 4 要確認它還是過。

- [ ] **Step 3: 實作**

`google_routes.py`：

```python
# 單段可以選的交通方式；整天的預設只能是前三種（DayMode，models.TRAVEL_MODES），走路只能單段選
TravelMode = Literal["drive", "scooter", "transit", "walk"]
DayMode = Literal["drive", "scooter", "transit"]
```

`TRAVEL` 加一行（照順序放最後），上面的註解改成「開車與機車不看即時路況（Essentials）；大眾運輸、走路不能帶 routingPreference」：

```python
    "walk": {"travelMode": "WALK"},
```

模組說明的交通方式那段補一行：「走路（WALK）：測試版，跟開車一樣可以帶中間點，不送出發時間；只有單段可以選。」

`travel.py`：`PACES` 加 `"walk": Pace(1.3, 4.5, 0),`（註解「走路：時速 4.5，不用停車」），`GOOGLE_EXTRA_MINUTES` 加 `"walk": 0`。

`models.py`，`TRAVEL_MODES` 下面加：

```python
# 單段可以另外選的交通方式（itinerary_leg.mode）：多一種走路，走路不能當整天的預設
LEG_MODES = (*TRAVEL_MODES, "walk")
```

`api/itinerary.py`：`from app.services.google_routes import TravelMode` 改成 `from app.services.google_routes import DayMode, TravelMode`；
`TravelModeOut.mode`、`TravelModeInput.mode`、`TodayItinerary.travel_mode`、`TodayMap.travel_mode` 這幾個「整天的預設」都改成 `DayMode`。

- [ ] **Step 4: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_legs TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_google_routes.py backend/tests/test_travel.py backend/tests/test_itinerary_api.py backend/tests/test_itinerary.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/google_routes.py backend/app/services/travel.py backend/app/models.py backend/app/api/itinerary.py backend/tests
git commit -m "Add walking as a per-leg travel mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 時間與地圖的線照每段的交通方式問 Google

**Files:**
- Modify: `backend/app/services/travel.py`（`Matrix.estimated_legs`、`fill`、`along`、`lines`、新的 `options`、分組）
- Test: `backend/tests/test_travel.py`

**Interfaces:**
- Consumes: Task 1 的 `TravelMode`（四種）、`TRAVEL` 的鍵順序
- Produces:
  - `Modes = TravelMode | Sequence[TravelMode]`：一種（整條都用它）或每段一種（長度 = 點數 − 1）
  - `Matrix` 多 `estimated_legs: tuple[bool, ...] = ()`：第 n 段（第 n 點到第 n + 1 點）是不是估算的；同一點不算
  - `fill(points, road_cells, google, mode="drive", modes=())`：相鄰的格子估算時用 `modes[i]`，其他用 `mode`
  - `along(points, modes="drive") -> Matrix`
  - `lines(points, modes="drive") -> list[Line | None] | None`
  - `Option(mode, minutes, km, estimated, found)`、`options(a, b) -> list[Option]`（照 `TRAVEL` 的順序）

行為規定：

1. **分組**（`along` 與 `lines` 共用一支私有函式）：相鄰、交通方式相同的段合成一組 `(交通方式, 第一段, 最後一段)`，交給
   `google_routes.route_legs(key, points[first:last + 2], polylines=…, mode=…)`；大眾運輸也可以合成一組（`route_legs`
   自己會一段一段問）。**兩點相同的段不問 Google**，在那裡把組切開。各組用 `ThreadPoolExecutor` 同時送出。
2. 某一組丟 `RoutesError`：那組的段都當作沒拿到，記一行 warning，全部問完後 `_pause_google()` 一次。
   `route_legs` 回的 `None`（大眾運輸搭不到車）不算失敗、不暫停。
3. `along`：拿到的段用 `road(cell, 那一段的交通方式)`；沒拿到的、`None` 的用估算（那一段的交通方式）。回傳的 `estimated`
   = `any(estimated_legs)`。沒有金鑰（或暫停中）就整份估算。只給一種交通方式時，結果要跟現在的 `along(points, mode)` 一樣
   （現有的測試照舊要過）。
4. `lines`：快取的鍵改成 `LINES_CACHE_PREFIX`（換成 `"meddemo:route-lines:v3:"`）+ `sha256(json.dumps([每段的交通方式, points]))`。
   兩點相同的段回 `Line("", ())`。有任何一組失敗：失敗的段是 `None`（地圖畫直線）、**不寫快取**、暫停。沒有金鑰回 `None`、
   暫停中先看快取，照現在的規定。
5. `options(a, b)`：`TRAVEL` 的四種同時問 `route_legs(key, [a, b], polylines=False, mode=…)`；`a == b` 回 `(0, 0.0, estimated=False, found=True)`、
   沒有金鑰回估算 `(estimated=True, found=True)`、`None` 回估算 `found=False`、`RoutesError` 暫停並回估算 `found=True`。

- [ ] **Step 1: 寫失敗的測試**

`test_travel.py` 加（`DEPARTURE` 不需要：大眾運輸的出發時間由 `google_routes` 自己定）：

```python
FIVE = [(25.0, 121.5), (25.01, 121.5), (25.02, 121.5), (25.03, 121.5), (25.04, 121.5)]  # 4 段


def legs_by_mode(calls, fail=(), missing=()):
    """假的 Google：每段 10 分鐘、1 公里，不管交通方式；記下 (交通方式, 幾個點)。
    fail 裡的交通方式丟 RoutesError；missing 裡的每段回 None（大眾運輸搭不到車）。"""

    def route_legs(key, points, http=None, polylines=True, mode="drive"):
        calls.append((mode, len(points)))
        if mode in fail:
            raise google_routes.RoutesError("逾時")
        if mode in missing:
            return [None] * (len(points) - 1)
        return [google_routes.Leg(600, 1000, f"{mode}{n}") for n in range(len(points) - 1)]

    return route_legs


def test_along_groups_neighbouring_legs_of_one_mode(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []
    monkeypatch.setattr(google_routes, "route_legs", legs_by_mode(calls))
    result = travel.along(FIVE, ["walk", "walk", "transit", "scooter"])
    assert sorted(calls) == [("scooter", 2), ("transit", 2), ("walk", 3)]
    assert result.estimated is False and result.estimated_legs == (False,) * 4
    # 走路、大眾運輸不加，機車加 2 分
    assert [result.minutes[n][n + 1] for n in range(4)] == [10, 10, 10, 12]


def test_along_with_one_mode_is_one_request_as_before(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []
    monkeypatch.setattr(google_routes, "route_legs", legs_by_mode(calls))
    travel.along(FIVE, "scooter")
    assert calls == [("scooter", 5)]


def test_a_failing_group_only_estimates_its_legs_and_pauses_google(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    monkeypatch.setattr(google_routes, "route_legs", legs_by_mode([], fail={"walk"}))
    result = travel.along(FIVE, ["drive", "walk", "drive", "drive"])
    assert result.estimated_legs == (False, True, False, False)
    assert result.minutes[1][2] == travel.estimate(FIVE[1], FIVE[2], "walk")[0]
    assert result.minutes[0][1] == 15
    assert travel._server_key() == ""


def test_no_transit_service_is_estimated_without_pausing(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    monkeypatch.setattr(google_routes, "route_legs", legs_by_mode([], missing={"transit"}))
    result = travel.along(FIVE, ["drive", "transit", "drive", "drive"])
    assert result.estimated_legs == (False, True, False, False)
    assert travel._server_key() == "server-key"


def test_same_point_legs_are_not_sent_to_google(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []
    monkeypatch.setattr(google_routes, "route_legs", legs_by_mode(calls))
    points = [FIVE[0], FIVE[0], FIVE[1], FIVE[2]]
    result = travel.along(points, "walk")
    assert calls == [("walk", 3)]  # 第 0 段兩點相同，從第 1 點開始問
    assert result.minutes[0][1] == 0 and result.estimated_legs == (False, False, False)


def test_without_a_key_each_leg_is_estimated_with_its_own_mode():
    result = travel.along(FIVE, ["walk", "drive", "drive", "transit"])
    assert result.estimated is True and result.estimated_legs == (True,) * 4
    assert result.minutes[0][1] == travel.estimate(FIVE[0], FIVE[1], "walk")[0]
    assert result.minutes[3][4] == travel.estimate(FIVE[3], FIVE[4], "transit")[0]


def test_lines_follow_each_legs_mode_and_cache_by_modes(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []
    monkeypatch.setattr(google_routes, "route_legs", legs_by_mode(calls))
    first = travel.lines(FIVE, ["walk", "walk", "drive", "drive"])
    assert [line.polyline for line in first] == ["walk0", "walk1", "drive0", "drive1"]
    assert travel.lines(FIVE, ["walk", "walk", "drive", "drive"]) == first  # 快取
    travel.lines(FIVE, ["drive"] * 4)  # 交通方式不同就是不同的線
    assert sorted(calls) == [("drive", 3), ("drive", 5), ("walk", 3)]


def test_lines_with_a_failing_group_are_partial_and_not_cached(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []
    monkeypatch.setattr(google_routes, "route_legs", legs_by_mode(calls, fail={"walk"}))
    found = travel.lines(FIVE, ["drive", "walk", "drive", "drive"])
    assert found[0].polyline == "drive0" and found[1] is None and found[2].polyline == "drive0"
    monkeypatch.setattr(travel, "_google_paused_until", 0.0)
    monkeypatch.setattr(google_routes, "route_legs", legs_by_mode(calls))
    assert travel.lines(FIVE, ["drive", "walk", "drive", "drive"])[1].polyline == "walk0"  # 沒有快取壞的那份


def test_options_ask_all_four_modes_for_one_leg(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []
    monkeypatch.setattr(google_routes, "route_legs", legs_by_mode(calls, missing={"transit"}))
    found = travel.options(FIVE[0], FIVE[1])
    assert [o.mode for o in found] == ["drive", "scooter", "transit", "walk"]
    by_mode = {o.mode: o for o in found}
    assert (by_mode["drive"].minutes, by_mode["drive"].estimated, by_mode["drive"].found) == (15, False, True)
    assert by_mode["walk"].minutes == 10
    assert by_mode["transit"].found is False and by_mode["transit"].estimated is True
    assert sorted(calls) == [("drive", 2), ("scooter", 2), ("transit", 2), ("walk", 2)]


def test_options_without_a_key_or_for_the_same_point():
    found = travel.options(FIVE[0], FIVE[1])
    assert all(o.estimated and o.found for o in found)
    assert [o.minutes for o in found] == [travel.estimate(FIVE[0], FIVE[1], m)[0] for m in google_routes.TRAVEL]
    assert all((o.minutes, o.estimated) == (0, False) for o in travel.options(FIVE[0], FIVE[0]))
```

既有測試裡假造 `route_legs` 的函式要收得下 `mode` 關鍵字參數（main 上應該已經收了；沒有就補 `mode="drive"`）。

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_legs TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_travel.py -q`
Expected: 新測試 FAIL

- [ ] **Step 3: 實作**

照上面〈行為規定〉改 `travel.py`。參考 `git show rides:backend/app/services/travel.py` 的 `along`、`options`、`_groups`、`fill`
（那邊叫 `two_wheeler`、有 `departures` 參數與 `_transit_departure`——**這次不要**：大眾運輸的出發時間由 main 的
`google_routes._travel` 決定）。`along` 與 `lines` 共用同一支分組與送出的函式，不要寫兩份。

`matrix(points, mode)` 不動（排順序用整天的預設）。

- [ ] **Step 4: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_legs TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_travel.py backend/tests/test_google_routes.py backend/tests/test_itinerary.py backend/tests/test_team_itineraries.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/travel.py backend/tests/test_travel.py
git commit -m "Ask Google for each leg's own mode, grouping neighbours

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 行程記住另外選的段

**Files:**
- Modify: `backend/app/models.py`（`OrgUnit.city`、`ItineraryLeg`）
- Modify: `data/seed/catalog.py`（`REGION_OFFICE_CITY`）、`data/seed/generate.py`（org_unit 多寫 city）
- Modify: `backend/app/services/itinerary.py`
- Test: `backend/tests/test_itinerary.py`

**Interfaces:**
- Consumes: Task 2 的 `travel.along(points, modes)`、`travel.fill(..., mode=, modes=)`、`Matrix.estimated_legs`、`travel.options(a, b)`；Task 1 的 `LEG_MODES`
- Produces:
  - `models.ItineraryLeg(itinerary_id, from_customer_id: str | None, to_customer_id, mode)`（`mode` 的 CHECK 用 `LEG_MODES`）
  - `StopView` 多 `travel_estimated: bool = False`、`travel_mode: str = "drive"`（這一段實際用的）、`city: str = ""`
  - `ItineraryView` 多 `start_city: str | None = None`、`office_start: bool = True`；`travel_mode`（整天的預設）照舊
  - `service.NotALeg(ValueError)`，訊息「這兩家現在不是還沒走的一段，請重新整理」
  - `service.set_leg_mode(session, user_id, from_id, to_id, mode, version) -> Itinerary`
  - `service.leg_options(session, user_id, from_id, to_id) -> list[travel.Option]`
  - `service.office_city(session, rep) -> str | None`
  - `service.path_modes(session, itinerary) -> list[str]`：照 `stop_order` 的順序，從辦公室（沒有辦公室位置時從第一站）一段一段的交通方式，給地圖的線用

行為規定：

1. 資料表照設計〈資料〉；`REGION_OFFICE_CITY = {"TW.N": "台北市", "TW.C": "台中市", "TW.S": "高雄市"}`。
2. 今天走的順序 `_chain(day, open_) = [None, 跑完的站（照拜訪時間）…, 還沒跑的站…]`，相鄰兩個是一段；一段的交通方式 =
   `itinerary_leg` 有那一列就用它，不然 `day.rep.travel_mode`。
3. `_compose` 算時間：`_timed(points, 每段的交通方式, estimate)`；`estimate` 時用 `travel.fill(points, {}, google=False, mode=預設, modes=每段)`，
   否則 `travel.along(points, 每段)`。每站的 `travel_estimated` = `matrix.estimated_legs[n]`。跑完的站也帶那一段的 `travel_mode`。
   `start_city` = `office_city(rep)`；`office_start` = `office(rep) is not None`。
4. `set_leg_mode`：鎖、比 `version`（不對丟 `VersionConflict`）、這一段要是「到達的那家還沒跑」的一段（不是就 `NotALeg`）；
   先刪掉那一段的列（`from_customer_id IS NOT DISTINCT FROM`），`mode` 跟預設不一樣才存一列；版本加一。
5. `leg_options`：檢查同上（不鎖、不比版本），回 `travel.options(那段的起點, 終點)`。
6. `_prune_legs`：存檔、加一站、三顆鈕（插入下一站、暫緩、誤判）之後刪掉不再相鄰的列（照 `rides` 分支的寫法）。
7. `set_travel_mode`（main 已有）：預設真的換了才刪今天這份行程的全部 `itinerary_leg`，然後照舊換版。
8. 排順序的地方（`_create`、`candidates`、`optimized`、`_cheapest_index`）照 main 現在用 `day.rep.travel_mode`，不改。

參考 `git show rides:backend/app/services/itinerary.py`（`_chain`、`_leg_modes`、`_open_modes`、`_leg_index`、`_prune_legs`、
`set_leg_mode`、`leg_options`、`office_city`、`_compose` 的改法），差別是：預設不是固定開車、沒有出發時間、`_estimated` 不要自己算一份
（用 `travel.fill`）、多了 `office_start`、`path_modes` 與第 7 點。

- [ ] **Step 1: 寫失敗的測試**

`test_itinerary.py` 加（`legs_of`、`point_of` 是小工具）：

```python
def legs_of(tx, itinerary):
    return {
        (leg.from_customer_id, leg.to_customer_id): leg.mode
        for leg in tx.scalars(select(ItineraryLeg).where(ItineraryLeg.itinerary_id == itinerary.id))
    }


def point_of(tx, customer_id):
    customer = tx.get(Customer, customer_id)
    return customer.lat, customer.lng


def test_every_stop_says_how_it_is_reached_and_in_which_city(tx):
    view = service.view(tx, service.get_or_create(tx, "U01"))
    assert view.start_city == "台北市" and view.office_start is True
    assert all(s.travel_mode == "drive" and s.travel_estimated for s in view.stops)
    assert [s.city for s in view.stops] == [tx.get(Customer, s.customer_id).city for s in view.stops]


def test_a_leg_row_is_unique_even_from_the_office(tx):
    itinerary = new_itinerary(tx)
    tx.add(ItineraryLeg(itinerary_id=itinerary.id, from_customer_id=None, to_customer_id="C001", mode="walk"))
    tx.flush()
    with pytest.raises(IntegrityError), tx.begin_nested():
        tx.add(ItineraryLeg(itinerary_id=itinerary.id, from_customer_id=None, to_customer_id="C001", mode="transit"))
        tx.flush()


def test_changing_a_leg_retimes_it_and_the_stops_after_it(tx):
    itinerary = service.get_or_create(tx, "U01")
    before = service.view(tx, itinerary)
    a, b = before.stops[0].customer_id, before.stops[1].customer_id
    service.set_leg_mode(tx, "U01", a, b, "transit", before.version)
    after = service.view(tx, itinerary)
    assert after.version == before.version + 1 and after.travel_mode == "drive"
    assert after.stops[1].travel_mode == "transit"
    assert after.stops[1].travel_minutes == travel.estimate(point_of(tx, a), point_of(tx, b), "transit")[0]
    assert after.stops[2].planned_time >= before.stops[2].planned_time
    assert legs_of(tx, itinerary) == {(a, b): "transit"}


def test_picking_the_days_mode_deletes_the_row(tx):
    itinerary = service.get_or_create(tx, "U01")
    view = service.view(tx, itinerary)
    a = view.stops[0].customer_id
    service.set_leg_mode(tx, "U01", None, a, "walk", view.version)
    assert legs_of(tx, itinerary) == {(None, a): "walk"}
    service.set_leg_mode(tx, "U01", None, a, "drive", view.version + 1)
    assert legs_of(tx, itinerary) == {}


def test_a_leg_is_stored_against_the_default_not_against_driving(tx):
    itinerary = service.get_or_create(tx, "U01")
    service.set_travel_mode(tx, "U01", "scooter")
    view = service.view(tx, itinerary)
    a, b = view.stops[0].customer_id, view.stops[1].customer_id
    assert {s.travel_mode for s in view.stops} == {"scooter"}
    service.set_leg_mode(tx, "U01", a, b, "drive", view.version)
    assert legs_of(tx, itinerary) == {(a, b): "drive"}
    assert service.view(tx, itinerary).stops[1].travel_mode == "drive"


def test_changing_the_days_mode_clears_todays_legs(tx):
    itinerary = service.get_or_create(tx, "U01")
    view = service.view(tx, itinerary)
    a, b = view.stops[0].customer_id, view.stops[1].customer_id
    service.set_leg_mode(tx, "U01", a, b, "walk", view.version)
    service.set_travel_mode(tx, "U01", "transit")
    assert legs_of(tx, itinerary) == {}
    assert {s.travel_mode for s in service.view(tx, itinerary).stops} == {"transit"}


def test_only_a_leg_still_ahead_can_change(tx):
    itinerary = service.get_or_create(tx, "U01")
    view = service.view(tx, itinerary)
    a, b = view.stops[0].customer_id, view.stops[1].customer_id
    with pytest.raises(service.NotALeg):
        service.set_leg_mode(tx, "U01", b, a, "walk", view.version)
    with pytest.raises(service.VersionConflict):
        service.set_leg_mode(tx, "U01", a, b, "walk", view.version - 1)


def test_reordering_keeps_legs_still_next_to_each_other_and_drops_the_rest(tx):
    itinerary = service.get_or_create(tx, "U01")
    view = service.view(tx, itinerary)
    a, b, c, d, e = [s.customer_id for s in view.stops]
    service.set_leg_mode(tx, "U01", a, b, "walk", view.version)
    service.set_leg_mode(tx, "U01", c, d, "transit", view.version + 1)
    draft = service.draft_of(tx, itinerary)
    by_id = {s.customer_id: s for s in draft.stops}
    service.save(tx, "U01", view.version + 2, dataclasses.replace(draft, stops=[by_id[x] for x in (a, c, d, e, b)]))
    assert legs_of(tx, itinerary) == {(c, d): "transit"}


def test_removing_or_pinning_a_stop_drops_legs_no_longer_adjacent(tx):
    itinerary = service.get_or_create(tx, "U01")
    view = service.view(tx, itinerary)
    a, b, c, d, e = [s.customer_id for s in view.stops]
    service.set_leg_mode(tx, "U01", c, d, "transit", view.version)
    service.set_leg_mode(tx, "U01", d, e, "walk", view.version + 1)
    service.apply_feedback(tx, "U01", e, "pin", view.version + 2)  # e 移到下一站：d → e 不再相鄰
    assert legs_of(tx, itinerary) == {(c, d): "transit"}
    service.apply_feedback(tx, "U01", d, "snooze", view.version + 3)
    assert legs_of(tx, itinerary) == {}


def test_after_visiting_out_of_order_the_next_leg_starts_from_the_last_visit(tx):
    """先跑了第 3 站：下一段是「第 3 站 → 還沒跑的第一站」，到已完成那站的段不能改。"""
    itinerary = service.get_or_create(tx, "U01")
    view = service.view(tx, itinerary)
    a, b, c = [s.customer_id for s in view.stops[:3]]
    confirm_visit_today(tx, "U01", c)
    after = service.view(tx, itinerary)
    assert [s.customer_id for s in after.stops[:2]] == [c, a]
    service.set_leg_mode(tx, "U01", c, a, "walk", after.version)
    assert service.view(tx, itinerary).stops[1].travel_mode == "walk"
    with pytest.raises(service.NotALeg):
        service.set_leg_mode(tx, "U01", None, c, "walk", after.version + 1)
    assert service.view(tx, itinerary).stops[0].travel_mode == "drive"  # 已完成的站帶著那段的交通方式


def test_leg_options_ask_the_four_modes_for_that_leg(tx, monkeypatch):
    itinerary = service.get_or_create(tx, "U01")
    a = service.view(tx, itinerary).stops[0].customer_id
    seen = {}

    def fake_options(x, y):
        seen["args"] = (x, y)
        return [travel.Option(m, 1, 0.1, True, True) for m in google_routes.TRAVEL]

    monkeypatch.setattr(travel, "options", fake_options)
    assert [o.mode for o in service.leg_options(tx, "U01", None, a)] == ["drive", "scooter", "transit", "walk"]
    assert seen["args"] == (catalog.REGION_OFFICE["TW.N"], point_of(tx, a))
    with pytest.raises(service.NotALeg):
        service.leg_options(tx, "U01", a, a)


def test_path_modes_follow_the_stop_order_from_the_office(tx):
    itinerary = service.get_or_create(tx, "U01")
    view = service.view(tx, itinerary)
    a, b = view.stops[0].customer_id, view.stops[1].customer_id
    service.set_leg_mode(tx, "U01", a, b, "walk", view.version)
    assert service.path_modes(tx, itinerary) == ["drive", "walk", "drive", "drive", "drive"]
```

`confirm_visit_today(tx, user_id, customer_id)`：在 `test_itinerary.py` 裡找現有測試「今天跑完一站」的做法（建一筆今天、已確認的 `Visit`），
抽成這個小工具或直接照著寫；拜訪時間用 `dt.datetime.combine(TODAY, dt.time(10, 0), TAIPEI)`。

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_legs TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_itinerary.py -q`
Expected: 一開始就 ImportError（`ItineraryLeg`）

- [ ] **Step 3: 實作**（照〈行為規定〉與參考的寫法）

- [ ] **Step 4: 跑測試確認通過，再跑整個後端一次**

Run: `TEST_DB_NAME=meddemo_test_legs TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests -q`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/services/itinerary.py backend/tests/test_itinerary.py data/seed/catalog.py data/seed/generate.py
git commit -m "Remember legs travelled differently from the day's mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: API 與地圖的線照每段

**Files:**
- Modify: `backend/app/api/itinerary.py`
- Modify: `backend/app/services/team_itineraries.py`（`_legs` 收每段的交通方式）
- Modify: `backend/app/api/manager.py`（`TeamStop` 多 `travel_mode`）
- Test: `backend/tests/test_itinerary_api.py`、`backend/tests/test_team_itineraries.py`、`backend/tests/test_team_itineraries_api.py`

**Interfaces:**
- Consumes: Task 3 的 `StopView`、`ItineraryView`、`set_leg_mode`、`leg_options`、`NotALeg`、`path_modes`；Task 2 的 `travel.lines(points, modes)`
- Produces（給前端）：
  - `GET /api/itinerary/today`：每站多 `travel_mode`（四種）、`travel_estimated`、`city`；行程多 `start_city`、`office_start`
  - `GET /api/itinerary/today/legs/options?to=&from=` → `{"options": [{"mode", "minutes", "km", "estimated", "found"}]}`
  - `PUT /api/itinerary/today/legs`，body `{"from": str | null（一定要帶）, "to": str, "mode": 四種之一, "version": int}` → 行程；409／422／403
  - 主管的 `TeamStop` 多 `travel_mode`（那一段實際用的）
  - 首頁地圖與主管地圖的線：`team_itineraries._legs(origin, stops, modes)`，`modes` 由 `itineraries.path_modes` 來（沒有辦公室時去掉第一個）

- [ ] **Step 1: 寫失敗的測試**

`test_itinerary_api.py`：`test_today_has_the_fields_the_home_page_needs` 的欄位集合加上 `"travel_estimated", "travel_mode", "city"`，
行程那行加 `"start_city", "office_start"`。再加：

```python
def put_leg(client, auth, body, user_id="U01"):
    return client.put("/api/itinerary/today/legs", json=body, headers=auth(user_id))


def test_change_a_leg_through_the_api(client, auth):
    data = today(client, auth)
    assert data["start_city"] == "台北市" and data["office_start"] is True
    a, b = data["stops"][0]["customer_id"], data["stops"][1]["customer_id"]
    changed = put_leg(client, auth, {"from": a, "to": b, "mode": "walk", "version": data["version"]})
    assert changed.status_code == 200, changed.text
    after = changed.json()
    assert after["version"] == data["version"] + 1 and after["stops"][1]["travel_mode"] == "walk"
    assert after["travel_mode"] == "drive"
    assert today(client, auth)["stops"][1]["travel_mode"] == "walk"

    stale = put_leg(client, auth, {"from": a, "to": b, "mode": "transit", "version": data["version"]})
    assert stale.status_code == 409 and stale.json()["detail"] == "行程剛被改過，已幫你重新整理"
    apart = put_leg(client, auth, {"from": b, "to": a, "mode": "walk", "version": after["version"]})
    assert apart.status_code == 422 and apart.json()["detail"] == "這兩家現在不是還沒走的一段，請重新整理"
    assert put_leg(client, auth, {"from": a, "to": b, "mode": "rocket", "version": after["version"]}).status_code == 422
    assert put_leg(client, auth, {"to": a, "mode": "walk", "version": after["version"]}).status_code == 422  # 少了 from
    office = put_leg(client, auth, {"from": None, "to": a, "mode": "scooter", "version": after["version"]})
    assert office.status_code == 200 and office.json()["stops"][0]["travel_mode"] == "scooter"
    assert put_leg(client, auth, {"from": None, "to": a, "mode": "walk", "version": 1}, "M01").status_code == 403


def test_leg_options_through_the_api(client, auth):
    data = today(client, auth)
    a, c = data["stops"][0]["customer_id"], data["stops"][2]["customer_id"]
    response = client.get("/api/itinerary/today/legs/options", params={"to": a}, headers=auth())
    assert response.status_code == 200, response.text
    options = response.json()["options"]
    assert [o["mode"] for o in options] == ["drive", "scooter", "transit", "walk"]
    assert all(set(o) == {"mode", "minutes", "km", "estimated", "found"} for o in options)
    apart = client.get("/api/itinerary/today/legs/options", params={"from": a, "to": c}, headers=auth())
    assert apart.status_code == 422
    assert client.get("/api/itinerary/today/legs/options", params={"to": a}, headers=auth("M01")).status_code == 403
```

`test_team_itineraries.py`：找現有「有金鑰時地圖的線來自 Google」那一個測試（假造 `route_legs` 的那個），照它的寫法加一個：
U01 把第 1 → 2 站改成走路後，`rep_map` 問 Google 時有一組是 `mode="walk"`、其他段是開車。
`test_team_itineraries_api.py`：主管看得到的每一站多 `travel_mode`。

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_legs TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests/test_itinerary_api.py backend/tests/test_team_itineraries.py backend/tests/test_team_itineraries_api.py -q`
Expected: 新測試 FAIL

- [ ] **Step 3: 實作**

`api/itinerary.py`：`Stop` 加 `travel_estimated: bool`、`travel_mode: TravelMode`、`city: str`；`TodayItinerary` 加 `start_city: str | None`、`office_start: bool`；
`_out` 帶上；加 `LegInput`（`from_: str | None = Field(alias="from")`，沒有預設值）、`LegOptionOut`、`LegOptions` 與兩支路由，
照 `git show rides:backend/app/api/itinerary.py` 的 `leg_options`、`set_leg`（例外的順序：`VersionConflict` → 409、`NotALeg` → 422、
`LookupError` → 403；`PUT` 先 `session.commit()` 再 `service.view`）。

`team_itineraries.py`：`_legs(origin, stops, modes)` 改收每段的交通方式（長度跟段數一樣），呼叫 `travel.lines(path, modes)`；
`route()` 與 `rep_map()` 用 `itineraries.path_modes(session, itinerary)`，沒有辦公室（`origin is None`）時去掉第一個。

`api/manager.py`：`TeamStop` 加 `travel_mode: str`，從 `view.stops` 帶過來。

- [ ] **Step 4: 跑測試確認通過**（同 Step 2 的指令，再跑整個後端一次）

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/tests
git commit -m "Expose and change each leg's mode through the API and draw it on maps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 前端的型別、交通方式的字與舊行程的預設值

**Files:**
- Modify: `frontend/src/api/route.ts`
- Modify: `frontend/src/lib/travel-mode.ts`、`frontend/src/lib/travel-mode.test.ts`
- Modify: `frontend/src/components/route/travel-mode-icon.tsx`
- Create: `frontend/src/api/route.test.ts`（如果還沒有）
- Modify: 建 `RouteStop`／`TodayRoute`／`TeamStop` 假資料的測試（`npm run typecheck` 會列出來）

**Interfaces:**
- Produces:
  - `api/route.ts`：`TravelMode`（三種，照舊）、`LegMode = TravelMode | "walk"`、`RouteStop` 多 `travel_mode: LegMode`、`travel_estimated: boolean`、`city: string`；
    `TodayRoute` 多 `start_city: string | null`、`office_start: boolean`；`LegOption = { mode: LegMode; minutes; km; estimated; found }`；
    `getLegOptions(from, to, signal?)`、`setLegMode(userId, version, from, to, mode)`；`normalizeRoute(route)`（補預設值，`getTodayRoute` 的網路與快取兩條路都用）
  - `lib/travel-mode.ts`：`TRAVEL_MODES`（三種，照舊）、`LEG_MODES: LegMode[]`（四種）、`TRAVEL_MODE_LABEL: Record<LegMode, string>`（多走路）、
    `NAVIGATION_MODE: Record<LegMode, string>`（走路 `walking`）、`MODE_ICON: Record<LegMode, LucideIcon>`、`BETA_NOTE`、`legMinutes`、`legFrom`、
    `routeSource(mode: LegMode, estimated)`（走路寫「（Google 走路路線測試版）」）
  - `TravelModeIcon` 收 `LegMode`，圖示從 `MODE_ICON` 拿
  - `api/team-routes.ts` 的 `TeamStop` 多 `travel_mode: LegMode`

- [ ] **Step 1: 寫失敗的測試**

`lib/travel-mode.test.ts` 加：

```ts
it("單段多一種走路，字、圖示、導航都對得起來", () => {
  expect(LEG_MODES).toEqual(["drive", "scooter", "transit", "walk"])
  expect(TRAVEL_MODES).toEqual(LEG_MODES.slice(0, 3))
  expect(LEG_MODES.map((mode) => TRAVEL_MODE_LABEL[mode])).toEqual(["開車", "機車", "大眾運輸", "走路"])
  expect(Object.keys(MODE_ICON).sort()).toEqual([...LEG_MODES].sort())
  expect(NAVIGATION_MODE.walk).toBe("walking")
})

it("估算的分鐘數前面加「約」；第一站從辦公室出發", () => {
  expect(legMinutes(12, false)).toBe("12 分")
  expect(legMinutes(12, true)).toBe("約 12 分")
  expect(legFrom([{ customer_id: "a" }, { customer_id: "b" }], 0)).toBeNull()
  expect(legFrom([{ customer_id: "a" }, { customer_id: "b" }], 1)).toBe("a")
})
```

`api/route.test.ts`：

```ts
import { describe, expect, it } from "vitest"

import { normalizeRoute, type TodayRoute } from "@/api/route"

describe("normalizeRoute", () => {
  it("手機上存的舊行程補上每段的交通方式與辦公室", () => {
    const old = { travel_mode: "scooter", stops: [{ customer_id: "a" }] } as unknown as TodayRoute
    const route = normalizeRoute(old)
    expect(route.stops[0]).toMatchObject({ travel_mode: "scooter", travel_estimated: true, city: "" })
    expect(route).toMatchObject({ start_city: null, office_start: true })
  })

  it("再更舊的（沒有整天的交通方式）當開車；新的照舊", () => {
    const older = { stops: [{ customer_id: "a" }] } as unknown as TodayRoute
    expect(normalizeRoute(older).stops[0].travel_mode).toBe("drive")
    const fresh = { travel_mode: "drive", start_city: "台北市", office_start: false,
      stops: [{ customer_id: "a", travel_mode: "walk", travel_estimated: false, city: "新北市" }] } as unknown as TodayRoute
    expect(normalizeRoute(fresh)).toEqual(fresh)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm --prefix frontend run test -- travel-mode route.test`
Expected: FAIL

- [ ] **Step 3: 實作**

照〈Interfaces〉。`normalizeRoute`：每站缺 `travel_mode` 就用行程的 `travel_mode`（再缺就 `"drive"`）、`travel_estimated ?? true`、`city ?? ""`；
行程 `start_city ?? null`、`office_start ?? true`、`travel_mode ?? "drive"`。`getLegOptions`、`setLegMode` 照 `git show rides:frontend/src/api/route.ts`。
`setLegMode`、`setTravelMode` 與其他回傳行程的函式回來的也過一次 `normalizeRoute`。

- [ ] **Step 4: 補假資料、全部檢查**

Run: `npm --prefix frontend run typecheck`，把列出來的假資料補上新欄位（站：`travel_mode: "drive", travel_estimated: false, city: "台北市"`；
行程：`start_city: "台北市", office_start: true`；主管的站：`travel_mode: "drive"`），再跑
`npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend test`。
Expected: 全部通過

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "Type each leg's mode on the frontend and fill it in for old cached routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 首頁的膠囊與選單

**Files:**
- Create: `frontend/src/components/route/leg-chip.tsx`、`frontend/src/components/route/leg-chip.test.ts`
- Modify: `frontend/src/components/route-path.tsx`、`frontend/src/components/route-path.test.ts`
- Modify: `frontend/src/pages/today.tsx`

**Interfaces:**
- Consumes: Task 5 的型別、`LEG_MODES`、`TRAVEL_MODE_LABEL`、`MODE_ICON`、`BETA_NOTE`、`legMinutes`、`legFrom`、`getLegOptions`、`setLegMode`
- Produces: `RoutePath` 的 props：`stops`、`dayMode?: TravelMode`（預設 `"drive"`）、`officeStart?: boolean`（預設 `true`）、
  `onPickMode?: (from: string | null, to: string, mode: LegMode) => void`

從 `rides` 分支搬（`route-path.tsx`、`route-path.test.ts` 在 main 上沒被改過，可以整個拿 `git show rides:…` 的版本再改；
`leg-chip.tsx`、`leg-chip.test.ts` 是新檔），然後照下面改：

1. 值與字：`two_wheeler` → `scooter`；清單用 `LEG_MODES`、字用 `TRAVEL_MODE_LABEL`、圖示用 `MODE_ICON`（`rides` 版裡 `MODE_LABEL` 的地方都換掉）。
2. 選單裡整天的預設那一列（`dayMode`）在名稱後面加一個小標「整天預設」（`text-[0.6875rem] font-normal text-muted-foreground`）。
3. `officeStart` 是 false 時，第一站上面那一列照樣留高度，但不放膠囊。
4. 路線底下的「Google Maps」只看「還沒跑、而且不是第一段從辦公室出發卻沒有辦公室」的站；其他照 `rides` 版。
5. `today.tsx`：照 `rides` 版加 `pickMode`（409、422 提示並重新載入、成功清掉提示），`<RoutePath>` 帶 `dayMode={route.travel_mode}`、
   `officeStart={route.office_start}`、`onPickMode`（用的是手機上的舊行程或正在存時不給）。main 上的路線／地圖切換、滑進來的動畫照舊。

- [ ] **Step 1: 寫失敗的測試**

`leg-chip.test.ts` 先搬 `rides` 版，值換成 `scooter`，再加：

```ts
it("整天預設的那一列有標記", () => {
  const options = (["drive", "scooter", "transit", "walk"] as const).map((mode) => option(mode, 10))
  const html = renderToStaticMarkup(
    createElement(LegOptionList, { options, current: "walk", dayMode: "scooter", failed: false, onPick: () => {} })
  )
  expect(html.match(/整天預設/g)).toHaveLength(1)
  expect(html.indexOf("整天預設")).toBeGreaterThan(html.indexOf("機車"))
  expect(html.indexOf("整天預設")).toBeLessThan(html.indexOf("大眾運輸"))
})
```

`route-path.test.ts` 先搬 `rides` 版，`stop()` 的預設值用 `travel_mode: "drive"`，再加：

```ts
it("沒有辦公室起點時第一站上面不放膠囊", () => {
  const html = renderToStaticMarkup(
    createElement(MemoryRouter, null,
      createElement(RoutePath, { stops: [stop("a", "next"), stop("b", "todo")], officeStart: false, onPickMode: () => {} }))
  )
  expect(html.match(/data-leg-chip/g)).toHaveLength(1)
  expect(html).not.toContain("從辦公室")
})
```

Run: `npm --prefix frontend run test -- leg-chip route-path`
Expected: FAIL（`leg-chip` 還不存在等）

- [ ] **Step 2: 實作**（照上面 1–5）

- [ ] **Step 3: 全部檢查**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend test`
Expected: 全部通過

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "Pick a leg's own travel mode from a chip on the home route

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 地圖站卡、導航、設定頁與「路上」

**Files:**
- Modify: `frontend/src/components/route/map-stop-card.tsx`（與它的測試）
- Modify: `frontend/src/pages/settings.tsx`
- Modify: `frontend/src/pages/route-edit.tsx`、`frontend/src/components/route/proposal-sheet.tsx`
- Modify: `frontend/src/lib/team-routes.ts`、`frontend/src/lib/team-routes.test.ts`

行為規定：

1. 站卡：車程那一段的字與導航連結用 `detail?.travel_mode ?? mode`（這一段實際的交通方式，找不到那一站時用整天的）；
   「Google 的機車路線是測試版…」那行改成機車或走路都要提醒（走路寫「Google 的走路路線是測試版，可能少了部分步道」）。
2. 設定頁的交通方式底下加一行小字：「這是整天的預設；每一段可以在首頁的路線上另外選。」
3. 調整清單每站那行：`{TRAVEL_MODE_LABEL[stop.travel_mode]} {分} 分 · {公里} 公里`；整條的「車程」改「路上」。提案對照卡整條的「車程」改「路上」。
4. 主管頁 `totalsLine`：還沒跑的站全部是同一種、而且等於整天的預設時照舊寫那種交通方式；有任何一段不一樣就寫「路上」，
   來源照舊用 `routeSource(整天的預設, estimated)`。

- [ ] **Step 1: 寫失敗的測試**

`map-stop-card.test.ts` 加：那一站 `travel_mode: "walk"`、整天是開車時，卡上寫「走路約」、導航連結含 `travelmode=walking`、有走路測試版的提醒。
`team-routes.test.ts` 加：有一站 `travel_mode: "walk"` 時 `totalsLine` 寫「路上」；全部跟預設一樣時照舊。

Run: `npm --prefix frontend run test -- map-stop-card team-routes`
Expected: FAIL

- [ ] **Step 2: 實作**（照 1–4）

- [ ] **Step 3: 全部檢查**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend test`

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "Follow each leg's mode on the map card, navigation and route totals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 壓力測試與實際打開看

**Files:**
- Create: `backend/tests/test_itinerary_legs_stress.py`

- [ ] **Step 1: 壓力測試**

照 `git show rides:backend/tests/test_itinerary_legs_stress.py` 寫，假的 `route_legs` 簽名照 main（`mode="drive"`，沒有 `departure`），
交通方式輪流用 `["walk", "transit", "scooter"]`。20 位評審一起打 `legs/options` 與 `PUT legs`：選單全部 200，存檔正好 1 個 200、19 個 409。

Run: `TEST_DB_NAME=meddemo_test_legs TEST_REDIS_URL=redis://127.0.0.1:6379/9 uv run --project backend pytest backend/tests -q`
Expected: 全部 PASS

- [ ] **Step 2: 實際打開 App 看**

照 `run-stack-from-a-worktree` 的做法在這個 worktree 起一套隔離的環境（API 8011、Vite 5181、資料庫 `meddemo_legs_dev`、Redis 第 11 號庫、
`JWT_SECRET=legs-check`），用 headless Chrome（每段不超過 20 秒、每段新開）在 390 寬截圖，淺色與深色各一次：

1. 首頁路線：每站上面的膠囊、第一顆「從辦公室」、膠囊不壓到圓鈕、名字與「出發」泡泡。
2. 點第二顆膠囊：選單四種、整天預設的標記、沒有超出畫面左右、蓋在下一列上面。
3. 選「走路」：膠囊變走路、後面幾站的時間變了。
4. 切到地圖：第 1 → 2 段的線照走路畫（沒有金鑰時是直線也算，只看沒有壞掉），點第二站的站卡寫「走路約 … 分」、導航連結是 walking。
5. 地圖左上角換成機車：回到路線，所有膠囊都是機車（今天另外選的清掉了）。

看截圖有壓到或超出就調 `LegRow` 的高度或選單寬度，跑 `route-path`、`leg-chip` 的測試，重截，另外 commit。收掉背景程式、刪掉複製的
`backend/.env`、暫時的 Vite 設定、`dropdb meddemo_legs_dev`。

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_itinerary_legs_stress.py
git commit -m "Stress-test twenty judges changing the same leg at once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
