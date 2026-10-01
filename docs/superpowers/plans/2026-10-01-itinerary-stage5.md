# 行程第五階段：主管端的行程分頁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 主管端多一個「行程」分頁，放在最前面、預設打開：團隊總覽（Google 地圖上每位業務沿路的路線、每人一張卡），點進去是一位業務的詳細（地圖含被拿掉的站、跟系統早上的建議比、行程清單）。只能看、只看今天。

**Architecture:** 後端新的 `services/team_itineraries.py` 讀每位業務今天的行程（`itinerary.get_or_create` 與 `view`，沒有就照第一次讀取的規則建），加上座標、沿路的線（`travel.lines`，Google 的折線放 Redis 一天）與「跟系統早上的建議比」；`api/manager.py` 多兩支 API。前端 `components/manager/` 放分頁、卡片與地圖；Google 地圖（`@vis.gl/react-google-maps`）由 `map-slot.tsx` 用 `import()` 另外打包，沒有金鑰或載不下來就換成一行「地圖暫時載入不了」。

**Tech Stack:** FastAPI、SQLAlchemy、Redis、pytest；React 19、TypeScript、react-router、`@vis.gl/react-google-maps`、vitest。

**設計文件：** `docs/superpowers/specs/2026-10-01-itinerary-planning-design.md`〈主管端：行程分頁〉（本計畫是〈分階段做〉的第 5 階段）。即時位置（頭像、位置那一行、WebSocket 的即時更新）是第 6 階段。

## Global Constraints

- 一律用繁體中文寫註解與畫面文字；畫面文字照設計文件的用字。畫面不用表情符號，圖示一律 lucide；卡片與能按的東西用既有的厚底樣式（`rounded-2xl border-2 bg-card shadow-lip`，能按的加 `press`）。
- 分頁順序「行程、提問、風險通報、簽核、方法卡」，預設打開「行程」（網址沒有 `view`）；原本把 `/manager` 當提問頁的連結（「回提問」）改成 `/manager?view=asks`。
- 一位業務的詳細：`/manager?view=routes&rep=<user_id>`。
- 範圍跟 `api/manager.py` 一樣：主管看自己底下的業務、IT 看全公司（`SHARING_LEVEL["manager_inbox"]`）；不含代理示範業務的帳號（`acts_as_user_id` 有值）與停用的人。業務打這兩支 API 回 403「這個頁面只有主管看得到」；看不到的人或不是業務回 404「找不到這位業務」。
- 只能看、只看今天（系統的今天 `app_today`）；讀一位業務的行程時沒有就照第一次讀取的規則建好（`itinerary.get_or_create`），API 讀完要 commit。
- 主管端的邏輯放新模組，不改 `services/itinerary.py`（Track A 正在改它）。
- 車程的分鐘數與公里數不快取（Google 條款）；沿路的線（經緯度）可以快取：`travel.lines` 照那一串點放 Redis 一天。
- 總覽的頁首：「10/28（三）· 北區 2 位業務 · 11:02 更新」（IT 是「全公司 5 位業務」；時間是台北的真實時間）。
- 卡片：「N/M 站 · 共 X 公里 · 約 HH:MM 收工」與進度條；「下一站：第 3 站 德安藥局 · 大安 · 10:40 到」；紅「拿掉系統排的 1 站：和康藥局 · 松山（帳款逾期）」；琥珀「1 站會晚到 25 分鐘」（兩站以上「2 站會晚到，最多 25 分鐘」）；灰「照系統建議，還沒動過」。`共 X 公里` 跟業務自己看到的總里程同一個數字（`ItineraryView.travel_km`，從出發點或最後跑完那一站算起）。
- 詳細：地圖下「共 X 公里 · 車程 N 小時 M 分（Google 道路車程）」或「（估計）」；「跟系統早上的建議比」：拿掉（含理由）、自己加的、順序改過的（「德安藥局提到佑生藥局前面」），沒有差異寫「照系統建議」；行程清單點客戶進客戶檔案，返回回到這位業務的詳細。
- 地圖：每位業務一個顏色，跟頭像底色同一套、同一個順序（`components/user-avatar.tsx` 的 `TONES`）；已跑完的段深色、還沒去的段淡色；站點是圓形編號（已完成實心、還沒去空心），點了彈出客戶名與到達時間；圖例列出每位業務的顏色；詳細頁的地圖多畫被拿掉的站（紅色虛線圈加「（拿掉）」）。
- 沒有瀏覽器金鑰、Google 的程式載不下來或金鑰被拒時，地圖區塊換成一行「地圖暫時載入不了」，下面的清單照常。
- Google 條款：Routes 的內容（車程、公里）顯示在沒有 Google 地圖的地方要標「Google Maps」（不翻譯、Roboto、12sp 以上）。有任何一份不是估算時，清單最下面加一行 `Google Maps`。
- 這一階段畫面開著時每 60 秒重拿一次（只在前景）；第 6 階段改成收到 WebSocket 事件才拿。
- 測試在隔離的資料庫與 Redis 跑：`TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7`；前端 `cd frontend && npm run typecheck && npm run lint && npm test && npm run build`。
- 跟 Track A 共用的檔案（`README.md`、`frontend/src/App.tsx`、`backend/app/main.py`、`backend/app/models.py`）只做局部、加新的一段；`frontend/src/api/route.ts` Track A 可能改名，這一階段的前端不 import 它。
- 每個 commit 訊息最後空一行再加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## 執行環境

worktree：`/Users/jamessu/Desktop/computersciencehomework/MEDDEMO/.worktrees/itinerary-maps`（分支 `itinerary-maps`，第 4 階段已在上面）。所有指令在這個目錄下跑。

## 檔案

| 檔案 | 動作 | 職責 |
|---|---|---|
| `backend/app/services/travel.py` | 改 | `lines(points)`：沿路的線，Redis 一天 |
| `backend/app/services/team_itineraries.py` | 新 | 看得到哪些業務、一位業務的地圖資料、跟建議比 |
| `backend/app/api/manager.py` | 改 | `GET /api/manager/itineraries`、`GET /api/manager/itineraries/{user_id}` |
| `backend/tests/conftest.py` | 改 | 每個測試前清掉沿路的線的快取 |
| `backend/tests/test_travel.py` | 改 | `lines` |
| `backend/tests/test_team_itineraries.py` | 新 | 服務 |
| `backend/tests/test_team_itineraries_api.py` | 新 | API |
| `frontend/src/api/team-routes.ts` | 新 | 型別與三支 API（總覽、詳細、地圖金鑰） |
| `frontend/src/lib/team-routes.ts` | 新 | 純函式：頁首、卡片各行、時間、約的時間、折線解碼、地圖範圍、路線顏色 |
| `frontend/src/lib/team-routes.fixtures.ts` | 新 | 測試用的假資料 |
| `frontend/src/lib/team-routes.test.ts` | 新 | |
| `frontend/src/lib/avatars.ts`、`frontend/src/lib/presence.ts` | 改 | hook 多給 `getServerSnapshot`，元件測試才 render 得出頭像 |
| `frontend/src/components/user-avatar.tsx` | 改 | `TONES` 的註解指向路線顏色 |
| `frontend/src/components/manager/route-map.tsx` | 新 | Google 地圖（只被 `import()` 載入） |
| `frontend/src/components/manager/map-slot.tsx` | 新 | 拿金鑰、`import()`、載不下來換成一行說明 |
| `frontend/src/components/manager/rep-route-card.tsx` | 新 | 總覽的一張卡 |
| `frontend/src/components/manager/rep-route-card.test.ts` | 新 | |
| `frontend/src/components/manager/routes-panel.tsx` | 新 | 總覽與詳細 |
| `frontend/src/pages/manager.tsx` | 改 | 分頁順序、預設、「回提問」 |
| `frontend/package.json`、`package-lock.json`、`tsconfig.app.json` | 改 | `@vis.gl/react-google-maps`、`@types/google.maps` |
| `README.md` | 改 | 新的一節〈主管端的團隊行程〉、「轉給主管」那一節的網址 |

---

### Task 1: 沿路的線（`travel.lines`）

**Files:**
- Modify: `backend/app/services/travel.py`
- Modify: `backend/tests/conftest.py`（`_reset_google_pause` 後面）
- Test: `backend/tests/test_travel.py`

**Interfaces:**
- Consumes: `google_routes.route_legs(key, points, http=None, polylines=True)`、`google_routes.RoutesError`；`travel._server_key()`、`travel._pause_google()`（第 4 階段）。
- Produces: `travel.lines(points: list[Point]) -> list[str] | None`：每一段沿路的編碼折線（共 `len(points) - 1` 段）；少於兩點回 `[]`；沒設金鑰、Google 暫停中或失敗回 `None`（地圖畫直線）。`travel.LINES_CACHE_PREFIX = "meddemo:route-lines:"`、`travel.LINES_TTL_SECONDS = 24 * 3600`。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_travel.py` 最後加：

```python
@pytest.fixture
def google_lines(monkeypatch, env):
    """設假金鑰，Google 的路線換成假的：第 n 段的折線是 "line{n}"。記下每次問了哪些點、要不要折線。"""
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []

    def route_legs(key, points, http=None, polylines=True):
        calls.append((points, polylines))
        return [google_routes.Leg(seconds=60, meters=500, polyline=f"line{n}") for n in range(len(points) - 1)]

    monkeypatch.setattr(google_routes, "route_legs", route_legs)
    return calls


def test_lines_come_from_google_once_then_from_the_cache(google_lines):
    assert travel.lines(POINTS) == ["line0", "line1"]
    assert travel.lines(POINTS) == ["line0", "line1"]
    assert google_lines == [(POINTS, True)]
    # 快取裡只有折線（經緯度），沒有車程的秒數與公尺：Google 的條款只允許快取經緯度
    (key,) = redis().keys(f"{travel.LINES_CACHE_PREFIX}*")
    assert json.loads(redis().get(key)) == ["line0", "line1"]
    assert 0 < redis().ttl(key) <= travel.LINES_TTL_SECONDS


def test_a_different_order_is_a_different_route(google_lines):
    travel.lines(POINTS)
    travel.lines(list(reversed(POINTS)))
    assert len(google_lines) == 2


def test_without_a_key_there_are_no_lines_and_the_map_draws_straight_ones(google_lines, env):
    env(GOOGLE_MAPS_SERVER_KEY="")
    assert travel.lines(POINTS) is None
    assert google_lines == []


def test_google_failing_means_no_lines_and_a_pause(monkeypatch, env):
    env(GOOGLE_MAPS_SERVER_KEY="server-key")
    calls = []

    def broken(key, points, http=None, polylines=True):
        calls.append(points)
        raise google_routes.RoutesError("逾時")

    monkeypatch.setattr(google_routes, "route_legs", broken)
    assert travel.lines(POINTS) is None
    # 暫停中：不再問 Google
    assert travel.lines(POINTS) is None
    assert len(calls) == 1


def test_a_single_point_has_no_legs(google_lines):
    assert travel.lines([POINTS[0]]) == []
    assert google_lines == []
```

同一個檔案開頭的 import 加上 `import json` 與 `from app.tasks import redis`：

```python
"""車程：直線估算，以及設了金鑰時改問 Google（假的，不連網路）。"""

import json

import pytest

from app.services import google_routes, travel
from app.tasks import redis
```

（保留檔案裡原本其他的 import，只加這兩個。）

`backend/tests/conftest.py`，在 `_reset_google_pause` 這個 fixture 後面加：

```python
@pytest.fixture(autouse=True)
def _clear_route_lines():
    """沿路的線快取在 Redis（travel.lines），測試之間不留：同一串點在下一個測試不該拿到上一個測試的假折線。"""
    from app.services import travel

    keys = redis().keys(f"{travel.LINES_CACHE_PREFIX}*")
    if keys:
        redis().delete(*keys)
```

（`redis` 在 conftest 開頭已經 `from app.tasks import redis`。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_travel.py -q`
Expected: FAIL（`travel` 沒有 `lines`、`LINES_CACHE_PREFIX`）

- [ ] **Step 3: 實作**

`backend/app/services/travel.py`：

1. import 區照字母順序加 `import hashlib`、`import json`，以及：
   ```python
   from redis.exceptions import RedisError
   ```
   放在第三方 import；`from app.tasks import redis` 放在 `from app.services import google_routes` 後面。
2. `GOOGLE_RETRY_SECONDS` 那一段後面加：
   ```python
   # 沿路的線（主管頁的地圖）：折線就是一串經緯度，Google 的條款允許快取（最多 30 天）。
   # 同一串點畫出來的線一樣，放 Redis 一天；車程的分鐘、公里不放
   LINES_CACHE_PREFIX = "meddemo:route-lines:"
   LINES_TTL_SECONDS = 24 * 3600
   ```
3. `along` 後面加：

```python
def lines(points: list[Point]) -> list[str] | None:
    """照這個順序開過去，每一段沿路的線（Google 的編碼折線，共 len(points) - 1 段），主管頁的地圖畫路線用。
    沒設金鑰、Google 暫停中或失敗就回 None，地圖改畫直線。"""
    if len(points) < 2:
        return []
    key = _server_key()
    if not key:
        return None
    cache_key = LINES_CACHE_PREFIX + hashlib.sha256(json.dumps(points).encode()).hexdigest()
    try:
        cached = redis().get(cache_key)
    except RedisError:
        cached = None
    if cached:
        return json.loads(cached)
    try:
        legs = google_routes.route_legs(key, points)
    except google_routes.RoutesError as exc:
        _pause_google()
        log.warning("Google 沿路的線沒有拿到，地圖改畫直線：%s", exc)
        return None
    found = [leg.polyline for leg in legs]
    try:
        redis().set(cache_key, json.dumps(found), ex=LINES_TTL_SECONDS)
    except RedisError:
        log.warning("沿路的線沒有存進 Redis，下次再問 Google", exc_info=True)
    return found
```

4. 模組說明最後那一段的最後加一句：「主管頁沿路的線（經緯度）例外，可以快取，見 lines()。」

- [ ] **Step 4: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_travel.py -q`
Expected: 全部通過

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/travel.py backend/tests/conftest.py backend/tests/test_travel.py
git commit -m "Fetch the road-following line of a route for the manager's map and keep it in Redis for a day

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 一位業務的地圖資料與「跟系統早上的建議比」

**Files:**
- Create: `backend/app/services/team_itineraries.py`
- Test: `backend/tests/test_team_itineraries.py`

**Interfaces:**
- Consumes: `itinerary.get_or_create(session, user_id) -> Itinerary`、`itinerary.view(session, itinerary) -> ItineraryView`（`stops: list[StopView]`，`StopView` 有 `customer_id, customer_name, planned_time, status, signal, reason, source, duration_minutes, late_minutes`）；`Itinerary.suggested`（`[{"customer_id", "signal", "reason"}, ...]`，照順序）、`Itinerary.version`；`travel.lines(points)`（Task 1）；`today_route.SIGNAL_LABEL`；`Scope.for_user(user).includes(level, column)`、`SHARING_LEVEL["manager_inbox"]`。
- Produces（Task 3 用）：
  - `team_itineraries.reps(session, viewer: AppUser) -> list[AppUser]`（照 id 排）
  - `team_itineraries.find_rep(session, viewer, user_id) -> AppUser | None`
  - `team_itineraries.route(session, rep: AppUser) -> RepRoute`
  - `RepRoute(rep: AppUser, view: ItineraryView, origin: tuple[float, float] | None, stops: list[MapStop], legs: list[Leg], removed: list[RemovedStop], added: list[str], moved: list[str], untouched: bool)`
  - `MapStop(number: int, customer_id, customer_name, area, lat: float, lng: float, status, planned_time, duration_minutes: int, late_minutes: int, source, signal, reason, window_kind: str | None, window_time: str | None)`（`window_time` 是 "HH:MM"）
  - `Leg(polyline: str | None, done: bool)`；`RemovedStop(customer_id, customer_name, area, lat, lng, label, reason)`
  - `team_itineraries.moved_sentences(suggested: list[str], current: list[str], names: dict[str, str]) -> list[str]`；`team_itineraries.short_name(customer) -> str`

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_team_itineraries.py`：

```python
"""主管端的行程分頁：看得到哪些業務、地圖要的座標與線、跟系統早上的建議比改了什麼。"""

import datetime as dt

from sqlalchemy import delete, select

from app.models import AppUser, Customer, Itinerary, OrgUnit, Visit
from app.services import google_routes
from app.services import itinerary as itineraries
from app.services import team_itineraries as team
from app.services.today_route import SIGNAL_LABEL
from app.timeutil import TAIPEI


def person(tx, user_id):
    return tx.get(AppUser, user_id)


def test_a_manager_sees_their_own_reps_and_it_sees_everyone(tx):
    # 代理示範業務的帳號（第三方登入）看的就是示範業務那一份，不另外列
    tx.add(AppUser(id="OAUTHTEAM", name="評審", role="sales", region="北區", acts_as_user_id="U01"))
    tx.flush()
    assert [r.id for r in team.reps(tx, person(tx, "M01"))] == ["U01", "U02"]
    everyone = [r.id for r in team.reps(tx, person(tx, "A01"))]
    assert {"U01", "U02", "U03", "U04", "U05"} <= set(everyone) and "OAUTHTEAM" not in everyone
    assert all(person(tx, rid).role == "sales" for rid in everyone)
    assert team.find_rep(tx, person(tx, "M01"), "U02").name == "王冠宇"
    assert team.find_rep(tx, person(tx, "M01"), "U03") is None
    assert team.find_rep(tx, person(tx, "M01"), "M01") is None


def test_reading_a_reps_route_builds_todays_itinerary_if_missing(tx):
    tx.execute(delete(Itinerary).where(Itinerary.user_id == "U02"))
    route = team.route(tx, person(tx, "U02"))
    assert tx.scalar(select(Itinerary).where(Itinerary.user_id == "U02")) is not None
    assert route.view.version == 1 and route.untouched is True
    assert route.removed == [] and route.added == [] and route.moved == []


def test_stops_carry_numbers_and_coordinates_and_the_route_starts_at_the_office(tx):
    route = team.route(tx, person(tx, "U01"))
    assert [s.number for s in route.stops] == list(range(1, len(route.stops) + 1))
    first = tx.get(Customer, route.stops[0].customer_id)
    assert (route.stops[0].lat, route.stops[0].lng, route.stops[0].area) == (first.lat, first.lng, first.area)
    assert route.stops[0].window_kind is None and route.stops[0].window_time is None
    office = tx.scalar(select(OrgUnit).where(OrgUnit.kind == "region", OrgUnit.name == "北區"))
    assert route.origin == (office.lat, office.lng)
    # 沒有金鑰：每一段都畫直線；辦公室開到第 1 站是第 0 段
    assert len(route.legs) == len(route.stops)
    assert all(leg.polyline is None and leg.done is False for leg in route.legs)


def test_legs_to_finished_stops_are_marked_done(tx):
    itinerary = itineraries.get_or_create(tx, "U01")
    target = itineraries.view(tx, itinerary).stops[1]
    at = dt.datetime(2026, 10, 28, 9, 40, tzinfo=TAIPEI)
    tx.add(Visit(id="VTEAM1", customer_id=target.customer_id, user_id="U01", visited_at=at,
                 transcript="測試", status="synced", confirmed_at=at))
    tx.flush()
    route = team.route(tx, person(tx, "U01"))
    assert route.stops[0].customer_id == target.customer_id and route.stops[0].status == "done"
    assert [leg.done for leg in route.legs] == [True] + [False] * (len(route.legs) - 1)
    # 先跑了建議的第 2 站：跑的順序跟建議不一樣，也算順序改過
    first_suggested = tx.get(Customer, itinerary.suggested[0]["customer_id"])
    assert route.moved == [f"{team.short_name(tx.get(Customer, target.customer_id))}提到{team.short_name(first_suggested)}前面"]
    assert route.untouched is False


def test_changes_against_the_morning_suggestion(tx):
    itinerary = itineraries.get_or_create(tx, "U01")
    stops = itineraries.view(tx, itinerary).stops
    dropped, last = stops[1], stops[-1]
    itineraries.apply_feedback(tx, "U01", dropped.customer_id, "snooze", itinerary.version)
    itineraries.apply_feedback(tx, "U01", last.customer_id, "pin", itinerary.version)
    mine = tx.scalars(
        select(Customer).where(Customer.owner_user_id == "U01", Customer.id.not_in([s.customer_id for s in stops]))
    ).first()
    itineraries.add_stops(tx, "U01", [mine.id], source="rep")

    route = team.route(tx, person(tx, "U01"))
    (removed,) = route.removed
    assert removed.customer_id == dropped.customer_id and removed.customer_name == dropped.customer_name
    assert removed.label == SIGNAL_LABEL[dropped.signal] and removed.reason == dropped.reason
    customer = tx.get(Customer, dropped.customer_id)
    assert (removed.lat, removed.lng, removed.area) == (customer.lat, customer.lng, customer.area)
    assert route.added == [mine.name]
    # 被插到下一站的那一家提到原本第一站的前面；被拿掉、自己加的不算順序改過
    moved_name = team.short_name(tx.get(Customer, last.customer_id))
    first_name = team.short_name(tx.get(Customer, stops[0].customer_id))
    assert route.moved == [f"{moved_name}提到{first_name}前面"]
    assert route.untouched is False


def test_moved_sentences_name_the_stop_that_moved():
    names = {c: c for c in "ABCDX"}
    assert team.moved_sentences(list("ABCD"), list("ABCD"), names) == []
    assert team.moved_sentences(list("ABCD"), list("DABC"), names) == ["D提到A前面"]
    assert team.moved_sentences(list("ABCD"), list("BCDA"), names) == ["A移到D後面"]
    assert team.moved_sentences(list("ABCD"), list("ACBD"), names) == ["C提到B前面"]
    assert team.moved_sentences(list("ABCD"), list("AXCD"), names) == []


def test_short_names_drop_the_district_but_keep_chain_branches():
    assert team.short_name(Customer(name="杏林診所 · 大安", area="大安")) == "杏林診所"
    assert team.short_name(Customer(name="康泰 · 忠孝店", area="大安")) == "康泰 · 忠孝店"


def test_with_a_server_key_the_legs_carry_googles_lines(tx, monkeypatch, env):
    itineraries.get_or_create(tx, "U01")  # 建的時候要排順序、會問整份矩陣，先在沒有金鑰時建好
    env(GOOGLE_MAPS_SERVER_KEY="server-key")

    def route_legs(key, points, http=None, polylines=True):
        return [google_routes.Leg(seconds=60, meters=500, polyline=f"line{n}") for n in range(len(points) - 1)]

    monkeypatch.setattr(google_routes, "route_legs", route_legs)
    route = team.route(tx, person(tx, "U01"))
    assert [leg.polyline for leg in route.legs] == [f"line{n}" for n in range(len(route.legs))]
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_team_itineraries.py -q`
Expected: FAIL（`ImportError: cannot import name 'team_itineraries'`）

- [ ] **Step 3: 實作**

`backend/app/services/team_itineraries.py`：

```python
"""主管端的行程分頁（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈主管端：行程分頁〉）。

主管看自己底下的業務、IT 看全公司，跟 api/manager.py 同一個範圍（SHARING_LEVEL["manager_inbox"]）；只能看、只看今天。
業務今天還沒打開首頁時，主管一讀就照第一次讀取的規則建好行程（itinerary.get_or_create）。
行程怎麼存、怎麼排時間都在 services/itinerary.py，這裡只讀它的結果，再加上地圖要的座標與沿路的線，
以及跟系統早上的建議（Itinerary.suggested）比改了什麼。
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppUser, Customer, ItineraryStop, OrgUnit
from app.services import itinerary as itineraries
from app.services import travel
from app.services.scope import SHARING_LEVEL, Scope
from app.services.today_route import SIGNAL_LABEL


@dataclass
class MapStop:
    number: int  # 第幾站（1 起算，已完成的在前）
    customer_id: str
    customer_name: str
    area: str
    lat: float
    lng: float
    status: str  # done／next／todo
    planned_time: str  # 已完成的是拜訪時間，其他是排出來的到達時間
    duration_minutes: int
    late_minutes: int
    source: str
    signal: str
    reason: str
    window_kind: str | None  # 約的時間：at 幾點到、before 幾點以前、after 幾點以後
    window_time: str | None  # HH:MM


@dataclass
class RemovedStop:
    """系統早上排了、現在不在行程裡的站（業務拿掉或暫緩的）。"""

    customer_id: str
    customer_name: str
    area: str
    lat: float
    lng: float
    label: str  # 系統排它的理由類別（「帳款逾期」）
    reason: str


@dataclass
class Leg:
    polyline: str | None  # Google 的編碼折線；沒有（沒設金鑰、Google 失敗）就畫直線
    done: bool  # 這一段開到的那一站已經跑完：地圖上畫深色


@dataclass
class RepRoute:
    rep: AppUser
    view: itineraries.ItineraryView
    origin: travel.Point | None  # 區處辦公室；還沒有位置的區是 None，路線從第一站畫起
    stops: list[MapStop]
    legs: list[Leg]  # 從出發點（或第一站）一段一段開到最後一站
    removed: list[RemovedStop]
    added: list[str]  # 自己加的（店名）
    moved: list[str]  # 「德安藥局提到佑生藥局前面」
    untouched: bool  # 照系統建議，還沒動過


def reps(session: Session, viewer: AppUser) -> list[AppUser]:
    """看得到的業務：主管是自己底下的人，IT 是全公司。
    代理示範業務的帳號（第三方登入）不列，他們看的就是示範業務那一份；停用的人也不列。"""
    return list(session.scalars(
        select(AppUser)
        .where(
            AppUser.role == "sales",
            AppUser.acts_as_user_id.is_(None),
            AppUser.deactivated_at.is_(None),
            Scope.for_user(viewer).includes(SHARING_LEVEL["manager_inbox"], AppUser.id),
        )
        .order_by(AppUser.id)
    ))


def find_rep(session: Session, viewer: AppUser, user_id: str) -> AppUser | None:
    return next((rep for rep in reps(session, viewer) if rep.id == user_id), None)


def route(session: Session, rep: AppUser) -> RepRoute:
    """一位業務今天的行程，給地圖與清單用；今天還沒有就照模型的建議建一份。"""
    itinerary = itineraries.get_or_create(session, rep.id)
    view = itineraries.view(session, itinerary)
    suggested = itinerary.suggested or []
    current_ids = [s.customer_id for s in view.stops]
    suggested_ids = [item["customer_id"] for item in suggested]
    customers = _customers(session, current_ids + suggested_ids)
    rows = {
        row.customer_id: row
        for row in session.scalars(select(ItineraryStop).where(ItineraryStop.itinerary_id == itinerary.id))
    }
    stops = [
        _map_stop(n + 1, stop, customers[stop.customer_id], rows.get(stop.customer_id))
        for n, stop in enumerate(view.stops)
    ]

    origin = _office(session, rep)
    path = ([origin] if origin else []) + [(s.lat, s.lng) for s in stops]
    found = travel.lines(path)
    # 第 n 段開到 path 的第 n + 1 點：有辦公室時就是第 n 站，沒有時是第 n + 1 站
    ends = stops if origin else stops[1:]
    legs = [Leg(polyline=found[n] if found else None, done=end.status == "done") for n, end in enumerate(ends)]

    on_route = set(current_ids)
    removed = [_removed(customers[item["customer_id"]], item) for item in suggested if item["customer_id"] not in on_route]
    in_suggestion = set(suggested_ids)
    added = [s.customer_name for s in view.stops if s.customer_id not in in_suggestion]
    moved = moved_sentences(suggested_ids, current_ids, {cid: short_name(c) for cid, c in customers.items()})
    return RepRoute(
        rep=rep, view=view, origin=origin, stops=stops, legs=legs, removed=removed, added=added, moved=moved,
        untouched=itinerary.version == 1 and not removed and not added and not moved,
    )


def moved_sentences(suggested: list[str], current: list[str], names: dict[str, str]) -> list[str]:
    """兩邊都有的站裡，順序改過的那幾家各一句：「德安藥局提到佑生藥局前面」「和平藥局移到康泰 · 忠孝店後面」。

    留在原本相對順序裡最多的那一串當作沒動（最長遞增子序列；一樣長時留後面的），其他的就是被移動的。
    往前移的找現在排在它後面、原本在它前面的第一家；往後移的找現在排在它前面、原本在它後面的最後一家。"""
    rank = {cid: n for n, cid in enumerate(suggested)}
    common = [cid for cid in current if cid in rank]
    order = [rank[cid] for cid in common]
    length = [1] * len(order)
    previous = [-1] * len(order)
    for i in range(len(order)):
        for j in range(i):
            # >=：一樣長時接在後面那一家，留下的那一串偏後面，句子就會講「提到誰前面」
            if order[j] < order[i] and length[j] + 1 >= length[i]:
                length[i], previous[i] = length[j] + 1, j
    kept: set[int] = set()
    if order:
        i = max(range(len(order)), key=lambda k: (length[k], k))
        while i != -1:
            kept.add(i)
            i = previous[i]
    sentences = []
    for i, cid in enumerate(common):
        if i in kept:
            continue
        later = [k for k in range(i + 1, len(common)) if order[k] < order[i]]
        if later:
            sentences.append(f"{names[cid]}提到{names[common[later[0]]]}前面")
        else:
            earlier = [k for k in range(i) if order[k] > order[i]]
            sentences.append(f"{names[cid]}移到{names[common[earlier[-1]]]}後面")
    return sentences


def short_name(customer: Customer) -> str:
    """店名去掉後面的地區（「杏林診所 · 大安」→「杏林診所」）；連鎖分店的「康泰 · 忠孝店」後面是分店，不去掉。"""
    return customer.name.removesuffix(f" · {customer.area}")


def _customers(session: Session, ids: list[str]) -> dict[str, Customer]:
    return {c.id: c for c in session.scalars(select(Customer).where(Customer.id.in_(ids)))} if ids else {}


def _office(session: Session, rep: AppUser) -> travel.Point | None:
    """區處辦公室的位置：每天從這裡出發（跟 itinerary._start 同一個規則）。還沒有位置的區回 None。"""
    office = session.scalar(select(OrgUnit).where(OrgUnit.kind == "region", OrgUnit.name == rep.region))
    return (office.lat, office.lng) if office and office.lat is not None and office.lng is not None else None


def _map_stop(number: int, stop: itineraries.StopView, customer: Customer, row: ItineraryStop | None) -> MapStop:
    return MapStop(
        number=number, customer_id=stop.customer_id, customer_name=stop.customer_name, area=customer.area,
        lat=customer.lat, lng=customer.lng, status=stop.status, planned_time=stop.planned_time,
        duration_minutes=stop.duration_minutes, late_minutes=stop.late_minutes, source=stop.source,
        signal=stop.signal, reason=stop.reason,
        window_kind=row.window_kind if row else None,
        window_time=row.window_time.strftime("%H:%M") if row and row.window_time else None,
    )


def _removed(customer: Customer, item: dict) -> RemovedStop:
    return RemovedStop(
        customer_id=customer.id, customer_name=customer.name, area=customer.area, lat=customer.lat, lng=customer.lng,
        label=SIGNAL_LABEL.get(item["signal"], item["signal"]), reason=item["reason"],
    )
```

- [ ] **Step 4: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_team_itineraries.py -q`
Expected: 全部通過

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/team_itineraries.py backend/tests/test_team_itineraries.py
git commit -m "Gather each rep's route for the manager: stops with coordinates, road lines and what changed since the morning

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 主管端的兩支 API

**Files:**
- Modify: `backend/app/api/manager.py`
- Test: `backend/tests/test_team_itineraries_api.py`

**Interfaces:**
- Consumes: Task 2 的 `team_itineraries.reps / find_rep / route` 與 `RepRoute`、`MapStop`、`Leg`、`RemovedStop`；`customer_profile.app_today(session)`；`app.timeutil.TAIPEI`。
- Produces（前端 Task 4 照這個 JSON 寫型別）：
  - `GET /api/manager/itineraries` → `{"date": "2026-10-28", "updated_at": "11:02", "scope": "北區" | "全公司", "reps": [RepRoute]}`
  - `GET /api/manager/itineraries/{user_id}` → `RepRoute`
  - `RepRoute` JSON：`{"rep": {"id","name","region"}, "version", "done", "total", "travel_minutes", "travel_km", "finish_time", "estimated", "origin": {"lat","lng"} | null, "stops": [TeamStop], "legs": [{"polyline": str | null, "done": bool}], "removed": [{"customer_id","customer_name","area","lat","lng","label","reason"}], "added": [str], "moved": [str], "untouched": bool}`
  - `TeamStop` JSON：`{"number","customer_id","customer_name","area","lat","lng","status","planned_time","duration_minutes","late_minutes","source","signal","reason","window_kind","window_time"}`

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_team_itineraries_api.py`：

```python
"""主管端的行程 API：誰看得到、JSON 長什麼樣、主管一讀就把行程建好存起來。服務的行為在 test_team_itineraries.py。"""

import re

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.main import app
from app.models import Itinerary

ROUTE_FIELDS = {
    "rep", "version", "done", "total", "travel_minutes", "travel_km", "finish_time", "estimated", "origin",
    "stops", "legs", "removed", "added", "moved", "untouched",
}
STOP_FIELDS = {
    "number", "customer_id", "customer_name", "area", "lat", "lng", "status", "planned_time", "duration_minutes",
    "late_minutes", "source", "signal", "reason", "window_kind", "window_time",
}


@pytest.fixture
def client(tx):
    return TestClient(app)


def test_a_manager_gets_the_team_overview(client, auth):
    response = client.get("/api/manager/itineraries", headers=auth("M01"))
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["date"] == "2026-10-28" and data["scope"] == "北區"
    assert re.fullmatch(r"\d\d:\d\d", data["updated_at"])
    assert [r["rep"]["id"] for r in data["reps"]] == ["U01", "U02"]
    first = data["reps"][0]
    assert set(first) == ROUTE_FIELDS
    assert first["rep"] == {"id": "U01", "name": "林昱辰", "region": "北區"}
    assert set(first["stops"][0]) == STOP_FIELDS
    assert set(first["origin"]) == {"lat", "lng"}
    assert len(first["legs"]) == len(first["stops"]) and first["legs"][0] == {"polyline": None, "done": False}
    assert first["estimated"] is True


def test_it_sees_the_whole_company(client, auth):
    data = client.get("/api/manager/itineraries", headers=auth("A01")).json()
    assert data["scope"] == "全公司"
    assert {"U01", "U02", "U03", "U04", "U05"} <= {r["rep"]["id"] for r in data["reps"]}


def test_reps_cannot_open_the_team_routes(client, auth):
    for path in ("/api/manager/itineraries", "/api/manager/itineraries/U01"):
        response = client.get(path, headers=auth("U01"))
        assert response.status_code == 403 and response.json()["detail"] == "這個頁面只有主管看得到"
    assert client.get("/api/manager/itineraries").status_code == 401


def test_one_reps_detail_only_inside_your_team(client, auth):
    detail = client.get("/api/manager/itineraries/U02", headers=auth("M01"))
    assert detail.status_code == 200, detail.text
    assert detail.json()["rep"]["name"] == "王冠宇" and set(detail.json()) == ROUTE_FIELDS
    for user_id in ("U03", "M01", "NOBODY"):
        response = client.get(f"/api/manager/itineraries/{user_id}", headers=auth("M01"))
        assert response.status_code == 404 and response.json()["detail"] == "找不到這位業務"
    assert client.get("/api/manager/itineraries/U03", headers=auth("A01")).status_code == 200


def test_a_managers_read_saves_the_itinerary_it_built(client, auth, tx):
    tx.execute(delete(Itinerary).where(Itinerary.user_id == "U02"))
    assert client.get("/api/manager/itineraries/U02", headers=auth("M01")).status_code == 200
    assert tx.scalar(select(Itinerary).where(Itinerary.user_id == "U02")) is not None
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_team_itineraries_api.py -q`
Expected: FAIL（404，還沒有這兩支 API）

- [ ] **Step 3: 實作**

`backend/app/api/manager.py`：

1. 模組說明第一行改成 `"""主管端：風險通報（原型回寫完成頁的「主管同步收到通報」），以及團隊今天的行程（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈主管端：行程分頁〉）。`，其餘不動。
2. import 區加：
   ```python
   import dataclasses
   ```
   （放在 `import datetime as dt` 前面）以及
   ```python
   from app.services import customer_profile
   from app.services import team_itineraries as team
   from app.timeutil import TAIPEI
   ```
3. 檔案最後加：

```python
# 團隊今天的行程：只能看、只看今天。業務今天還沒打開首頁時，主管一讀就照第一次讀取的規則建好，所以讀完要 commit


class TeamRep(BaseModel):
    id: str
    name: str
    region: str


class LatLng(BaseModel):
    lat: float
    lng: float


class TeamStop(BaseModel):
    number: int
    customer_id: str
    customer_name: str
    area: str
    lat: float
    lng: float
    status: str
    planned_time: str
    duration_minutes: int
    late_minutes: int
    source: str
    signal: str
    reason: str
    window_kind: str | None
    window_time: str | None


class TeamLeg(BaseModel):
    polyline: str | None
    done: bool


class TeamRemovedStop(BaseModel):
    customer_id: str
    customer_name: str
    area: str
    lat: float
    lng: float
    label: str
    reason: str


class RepRoute(BaseModel):
    rep: TeamRep
    version: int
    done: int
    total: int
    travel_minutes: int
    travel_km: float
    finish_time: str | None
    estimated: bool
    origin: LatLng | None
    stops: list[TeamStop]
    legs: list[TeamLeg]
    removed: list[TeamRemovedStop]
    added: list[str]
    moved: list[str]
    untouched: bool


class TeamRoutes(BaseModel):
    date: dt.date
    updated_at: str  # 台北的真實時間 HH:MM
    scope: str  # 主管是自己那一區（「北區」），IT 是「全公司」
    reps: list[RepRoute]


def _route_out(route: team.RepRoute) -> RepRoute:
    view = route.view
    return RepRoute(
        rep=TeamRep(id=route.rep.id, name=route.rep.name, region=route.rep.region),
        version=view.version, done=view.done, total=view.total, travel_minutes=view.travel_minutes,
        travel_km=view.travel_km, finish_time=view.finish_time, estimated=view.estimated,
        origin=LatLng(lat=route.origin[0], lng=route.origin[1]) if route.origin else None,
        stops=[TeamStop(**dataclasses.asdict(stop)) for stop in route.stops],
        legs=[TeamLeg(**dataclasses.asdict(leg)) for leg in route.legs],
        removed=[TeamRemovedStop(**dataclasses.asdict(stop)) for stop in route.removed],
        added=route.added, moved=route.moved, untouched=route.untouched,
    )


@router.get("/itineraries", response_model=TeamRoutes)
def team_itineraries(session: SessionDep, manager: ManagerUser):
    """團隊今天的行程：每位業務的路線、進度，以及跟系統早上的建議比改了什麼。"""
    routes = [team.route(session, rep) for rep in team.reps(session, manager)]
    result = TeamRoutes(
        date=customer_profile.app_today(session),
        updated_at=dt.datetime.now(TAIPEI).strftime("%H:%M"),
        scope="全公司" if manager.role == "it" else manager.region,
        reps=[_route_out(route) for route in routes],
    )
    session.commit()
    return result


@router.get("/itineraries/{user_id}", response_model=RepRoute)
def rep_itinerary(session: SessionDep, user_id: str, manager: ManagerUser):
    """一位業務今天的行程。看不到的人跟不存在一樣回 404，不透露有沒有這個帳號。"""
    rep = team.find_rep(session, manager, user_id)
    if rep is None:
        raise HTTPException(404, "找不到這位業務")
    result = _route_out(team.route(session, rep))
    session.commit()
    return result
```

- [ ] **Step 4: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests -q`
Expected: 全部通過

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/manager.py backend/tests/test_team_itineraries_api.py
git commit -m "Serve the team's routes for today and one rep's route to managers and IT

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 前端的資料與純函式

**Files:**
- Create: `frontend/src/api/team-routes.ts`
- Create: `frontend/src/lib/team-routes.ts`
- Create: `frontend/src/lib/team-routes.fixtures.ts`
- Test: `frontend/src/lib/team-routes.test.ts`
- Modify: `frontend/src/lib/avatars.ts`（`useAvatarUrl`）、`frontend/src/lib/presence.ts`（`usePresence`、`usePresenceMap`）
- Modify: `frontend/src/components/user-avatar.tsx`（`TONES` 上面的註解）

**Interfaces:**
- Consumes: Task 3 的 JSON；`avatarTone(id, tones)`（`lib/presence.ts`）；`formatDayLabel(iso)`（`lib/format.ts`，"2026-10-28" → "10/28（三）"）。
- Produces（Task 5、6 用）：
  - `api/team-routes.ts`：型別 `StopStatus`、`StopSource`、`TeamStop`、`TeamLeg`、`RemovedStop`、`RepRoute`、`TeamRoutes`、`MapsConfig`（`{ browser_key: string; map_id: string } | null`）、`LatLng`；`getTeamRoutes(signal?)`、`getRepRoute(userId, signal?)`、`getMapsConfig(signal?)`。
  - `lib/team-routes.ts`：`ROUTE_COLOR_VARS`、`routeColorVar(userId)`、`headerLine(data)`、`progressLine(route)`、`nextStopLine(stops)`、`removedLine(removed)`、`lateLine(stops)`、`formatDriveTime(minutes)`、`totalsLine(route)`、`windowLabel(stop)`、`SOURCE_LABEL`、`decodePolyline(encoded)`、`boundsOf(points)`、`legPaths(route)`。
  - `lib/team-routes.fixtures.ts`：`teamStop(number, status, extra?)`、`repRoute(extra?)`、`teamRoutes(extra?)`。

- [ ] **Step 1: 型別與 API**

`frontend/src/api/team-routes.ts`：

```ts
import { request } from "@/api/client"

// 主管端的行程分頁（後端 api/manager.py 的 /api/manager/itineraries）：只能看、只看今天。
// 站的狀態與來源跟業務首頁同一套（後端 services/itinerary.py），這裡自己寫一份，不跟業務那邊的型別綁在一起
export type StopStatus = "done" | "next" | "todo"
// model：系統早上排的；rep：業務自己加的；ai：跟熊熊滾說加的；ask：問答頁「排入今天的路線」
export type StopSource = "model" | "rep" | "ai" | "ask"

export type LatLng = { lat: number; lng: number }

export type TeamStop = LatLng & {
  // 第幾站，1 起算，已完成的在前
  number: number
  customer_id: string
  customer_name: string
  area: string
  status: StopStatus
  // 已完成的是拜訪時間，其他是排出來的到達時間
  planned_time: string
  duration_minutes: number
  late_minutes: number
  source: StopSource
  signal: string
  reason: string
  // 約的時間：at 幾點到、before 幾點以前、after 幾點以後
  window_kind: "at" | "before" | "after" | null
  window_time: string | null
}

// 沿路的一段：polyline 是 Google 的編碼折線，沒有（沒設金鑰、Google 失敗）就畫直線；done 是開到的那一站跑完了
export type TeamLeg = { polyline: string | null; done: boolean }

// 系統早上排了、現在不在行程裡的站
export type RemovedStop = LatLng & {
  customer_id: string
  customer_name: string
  area: string
  // 系統排它的理由類別（「帳款逾期」）
  label: string
  reason: string
}

export type RepRoute = {
  rep: { id: string; name: string; region: string }
  version: number
  done: number
  total: number
  travel_minutes: number
  travel_km: number
  finish_time: string | null
  // 車程是直線估算的
  estimated: boolean
  // 區處辦公室，路線從這裡畫起；還沒有位置的區是 null
  origin: LatLng | null
  stops: TeamStop[]
  legs: TeamLeg[]
  removed: RemovedStop[]
  // 自己加的（店名）
  added: string[]
  // 「德安藥局提到佑生藥局前面」
  moved: string[]
  untouched: boolean
}

export type TeamRoutes = {
  date: string
  // 台北時間 HH:MM
  updated_at: string
  // 主管是自己那一區（「北區」），IT 是「全公司」
  scope: string
  reps: RepRoute[]
}

// 主管頁的 Google 地圖要的設定；沒有瀏覽器金鑰是 null，地圖區塊就換成一行說明
export type MapsConfig = { browser_key: string; map_id: string } | null

export function getTeamRoutes(signal?: AbortSignal) {
  return request<TeamRoutes>("/api/manager/itineraries", { signal })
}

export function getRepRoute(userId: string, signal?: AbortSignal) {
  return request<RepRoute>(`/api/manager/itineraries/${encodeURIComponent(userId)}`, { signal })
}

export function getMapsConfig(signal?: AbortSignal) {
  return request<MapsConfig>("/api/maps/config", { signal })
}
```

- [ ] **Step 2: 測試用的假資料**

`frontend/src/lib/team-routes.fixtures.ts`：

```ts
import type { RepRoute, StopStatus, TeamRoutes, TeamStop } from "@/api/team-routes"

/** 測試用的一站：預設是還沒去、10:00 到、沒有約時間、系統排的 */
export function teamStop(number: number, status: StopStatus, extra: Partial<TeamStop> = {}): TeamStop {
  return {
    number,
    customer_id: `C${number}`,
    customer_name: `客戶${number} · 大安`,
    area: "大安",
    lat: 25.03 + number / 100,
    lng: 121.54,
    status,
    planned_time: "10:00",
    duration_minutes: 40,
    late_minutes: 0,
    source: "model",
    signal: "ar",
    reason: "帳款最久拖了 78 天",
    window_kind: null,
    window_time: null,
    ...extra,
  }
}

/** 測試用的一位業務：林昱辰、三站（第 1 站跑完了）、還沒動過 */
export function repRoute(extra: Partial<RepRoute> = {}): RepRoute {
  return {
    rep: { id: "U01", name: "林昱辰", region: "北區" },
    version: 1,
    done: 1,
    total: 3,
    travel_minutes: 85,
    travel_km: 18.2,
    finish_time: "16:40",
    estimated: true,
    origin: { lat: 25.052, lng: 121.544 },
    stops: [teamStop(1, "done"), teamStop(2, "next", { planned_time: "10:40" }), teamStop(3, "todo")],
    legs: [
      { polyline: null, done: true },
      { polyline: null, done: false },
      { polyline: null, done: false },
    ],
    removed: [],
    added: [],
    moved: [],
    untouched: true,
    ...extra,
  }
}

export function teamRoutes(extra: Partial<TeamRoutes> = {}): TeamRoutes {
  return { date: "2026-10-28", updated_at: "11:02", scope: "北區", reps: [repRoute(), repRoute({ rep: { id: "U02", name: "王冠宇", region: "北區" } })], ...extra }
}
```

- [ ] **Step 3: 寫失敗的測試**

`frontend/src/lib/team-routes.test.ts`：

```ts
import { describe, expect, it } from "vitest"

import { avatarTone } from "@/lib/presence"
import {
  boundsOf,
  decodePolyline,
  formatDriveTime,
  headerLine,
  lateLine,
  legPaths,
  nextStopLine,
  progressLine,
  removedLine,
  ROUTE_COLOR_VARS,
  routeColorVar,
  totalsLine,
  windowLabel,
} from "@/lib/team-routes"
import { repRoute, teamRoutes, teamStop } from "@/lib/team-routes.fixtures"

const removed = (name: string, label: string) => ({
  customer_id: name, customer_name: name, area: "松山", lat: 25.06, lng: 121.55, label, reason: "帳款最久拖了 78 天",
})

describe("團隊總覽的文字", () => {
  it("頁首寫日期、範圍、幾位業務與更新時間", () => {
    expect(headerLine(teamRoutes())).toBe("10/28（三）· 北區 2 位業務 · 11:02 更新")
    expect(headerLine(teamRoutes({ scope: "全公司", reps: [] }))).toBe("10/28（三）· 全公司 0 位業務 · 11:02 更新")
  })

  it("進度、公里與收工時間；跑完了就沒有收工時間", () => {
    expect(progressLine(repRoute())).toBe("1/3 站 · 共 18.2 公里 · 約 16:40 收工")
    expect(progressLine(repRoute({ done: 3, travel_km: 0, finish_time: null }))).toBe("3/3 站 · 共 0 公里")
  })

  it("下一站寫站號、店名與到達時間", () => {
    expect(nextStopLine(repRoute().stops)).toBe("下一站：第 2 站 客戶2 · 大安 · 10:40 到")
    expect(nextStopLine([teamStop(1, "done")])).toBeNull()
  })

  it("拿掉系統排的站：店名加理由類別，好幾家用頓號分開", () => {
    expect(removedLine([])).toBeNull()
    expect(removedLine([removed("和康藥局 · 松山", "帳款逾期")])).toBe("拿掉系統排的 1 站：和康藥局 · 松山（帳款逾期）")
    expect(removedLine([removed("甲", "帳款逾期"), removed("乙", "例行拜訪")])).toBe(
      "拿掉系統排的 2 站：甲（帳款逾期）、乙（例行拜訪）"
    )
  })

  it("會晚到只算還沒跑的站", () => {
    expect(lateLine(repRoute().stops)).toBeNull()
    expect(lateLine([teamStop(1, "done", { late_minutes: 30 }), teamStop(2, "next", { late_minutes: 25 })])).toBe(
      "1 站會晚到 25 分鐘"
    )
    expect(lateLine([teamStop(1, "next", { late_minutes: 10 }), teamStop(2, "todo", { late_minutes: 25 })])).toBe(
      "2 站會晚到，最多 25 分鐘"
    )
  })
})

describe("一位業務的詳細", () => {
  it("車程寫成幾小時幾分", () => {
    expect(formatDriveTime(0)).toBe("0 分")
    expect(formatDriveTime(45)).toBe("45 分")
    expect(formatDriveTime(60)).toBe("1 小時")
    expect(formatDriveTime(85)).toBe("1 小時 25 分")
  })

  it("地圖下面那一行標明是 Google 的道路車程還是估計", () => {
    expect(totalsLine(repRoute())).toBe("共 18.2 公里 · 車程 1 小時 25 分（估計）")
    expect(totalsLine(repRoute({ estimated: false }))).toBe("共 18.2 公里 · 車程 1 小時 25 分（Google 道路車程）")
  })

  it("約的時間", () => {
    expect(windowLabel(teamStop(1, "todo"))).toBeNull()
    expect(windowLabel(teamStop(1, "todo", { window_kind: "at", window_time: "11:00" }))).toBe("約 11:00 到")
    expect(windowLabel(teamStop(1, "todo", { window_kind: "before", window_time: "11:00" }))).toBe("11:00 以前到")
    expect(windowLabel(teamStop(1, "todo", { window_kind: "after", window_time: "14:00" }))).toBe("14:00 以後到")
  })
})

describe("地圖", () => {
  it("路線顏色跟頭像底色同一套、同一個順序", () => {
    expect(ROUTE_COLOR_VARS).toHaveLength(5)
    for (const id of ["U01", "U02", "U03", "M01"]) {
      expect(routeColorVar(id)).toBe(ROUTE_COLOR_VARS[avatarTone(id, ROUTE_COLOR_VARS.length)])
    }
  })

  it("解得開 Google 的編碼折線", () => {
    // Google 文件上的例子
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ])
    expect(decodePolyline("")).toEqual([])
  })

  it("每一段有折線用折線，沒有就從上一點連直線到這一站", () => {
    const route = repRoute({
      legs: [
        { polyline: "_p~iF~ps|U_ulLnnqC", done: true },
        { polyline: null, done: false },
        { polyline: null, done: false },
      ],
    })
    const paths = legPaths(route)
    expect(paths).toHaveLength(3)
    expect(paths[0]).toEqual({ done: true, path: [{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }] })
    expect(paths[1]).toEqual({ done: false, path: [route.stops[0], route.stops[1]].map(({ lat, lng }) => ({ lat, lng })) })
    // 沒有出發點：第一段從第 1 站開到第 2 站
    const noOffice = legPaths(repRoute({ origin: null, legs: [{ polyline: null, done: false }, { polyline: null, done: false }] }))
    expect(noOffice[0].path).toEqual([route.stops[0], route.stops[1]].map(({ lat, lng }) => ({ lat, lng })))
  })

  it("地圖範圍框住所有的點", () => {
    expect(boundsOf([])).toBeNull()
    expect(boundsOf([{ lat: 25, lng: 121.5 }, { lat: 24, lng: 121.6 }, { lat: 24.5, lng: 121.4 }])).toEqual({
      north: 25,
      south: 24,
      east: 121.6,
      west: 121.4,
    })
  })
})
```

- [ ] **Step 4: 跑測試確認失敗**

Run: `cd frontend && npx vitest run src/lib/team-routes.test.ts`
Expected: FAIL（找不到 `@/lib/team-routes`）

- [ ] **Step 5: 實作純函式**

`frontend/src/lib/team-routes.ts`：

```ts
import type { LatLng, RemovedStop, RepRoute, StopSource, TeamRoutes, TeamStop } from "@/api/team-routes"
import { formatDayLabel } from "@/lib/format"
import { avatarTone } from "@/lib/presence"

/*
 * 主管端行程分頁的文字與地圖資料（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈主管端：行程分頁〉）。
 * 純函式，畫面（components/manager/）只負責排版。
 */

// 路線的顏色跟頭像底色同一套、同一個順序（components/user-avatar.tsx 的 TONES）：地圖上的線一看就知道是誰。
// 寫成 CSS 變數，深色配色下跟著換；Google 地圖的線畫在 canvas 上，要用時再換成實際的顏色
export const ROUTE_COLOR_VARS = ["--primary", "--chart-4", "--chart-5", "--warning", "--muted-foreground"] as const

export function routeColorVar(userId: string) {
  return ROUTE_COLOR_VARS[avatarTone(userId, ROUTE_COLOR_VARS.length)]
}

/** 總覽的頁首：「10/28（三）· 北區 2 位業務 · 11:02 更新」 */
export function headerLine(data: TeamRoutes) {
  // 全形括號後面本來就有空白，「·」前面不再空一格（設計文件的寫法）
  return `${formatDayLabel(data.date)}· ${data.scope} ${data.reps.length} 位業務 · ${data.updated_at} 更新`
}

/** 「1/3 站 · 共 18.2 公里 · 約 16:40 收工」。公里數跟業務自己看到的總里程同一個數字；跑完了就沒有收工時間 */
export function progressLine(route: RepRoute) {
  const parts = [`${route.done}/${route.total} 站`, `共 ${route.travel_km} 公里`]
  if (route.finish_time) parts.push(`約 ${route.finish_time} 收工`)
  return parts.join(" · ")
}

/** 「下一站：第 2 站 德安藥局 · 大安 · 10:40 到」；都跑完了是 null */
export function nextStopLine(stops: TeamStop[]) {
  const next = stops.find((stop) => stop.status === "next")
  return next ? `下一站：第 ${next.number} 站 ${next.customer_name} · ${next.planned_time} 到` : null
}

/** 紅字：「拿掉系統排的 1 站：和康藥局 · 松山（帳款逾期）」 */
export function removedLine(removed: RemovedStop[]) {
  if (!removed.length) return null
  return `拿掉系統排的 ${removed.length} 站：${removed.map((stop) => `${stop.customer_name}（${stop.label}）`).join("、")}`
}

/** 琥珀色：還沒跑、約的時間趕不上的站。「1 站會晚到 25 分鐘」；兩站以上「2 站會晚到，最多 25 分鐘」 */
export function lateLine(stops: TeamStop[]) {
  const late = stops.filter((stop) => stop.status !== "done" && stop.late_minutes > 0)
  if (!late.length) return null
  const most = Math.max(...late.map((stop) => stop.late_minutes))
  return late.length === 1 ? `1 站會晚到 ${most} 分鐘` : `${late.length} 站會晚到，最多 ${most} 分鐘`
}

/** 85 → 「1 小時 25 分」 */
export function formatDriveTime(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest} 分`
  return rest ? `${hours} 小時 ${rest} 分` : `${hours} 小時`
}

/** 詳細頁地圖下面那一行：「共 18.2 公里 · 車程 1 小時 25 分（Google 道路車程）」或「（估計）」 */
export function totalsLine(route: RepRoute) {
  const source = route.estimated ? "（估計）" : "（Google 道路車程）"
  return `共 ${route.travel_km} 公里 · 車程 ${formatDriveTime(route.travel_minutes)}${source}`
}

/** 約的時間：「約 11:00 到」「11:00 以前到」「14:00 以後到」 */
export function windowLabel(stop: TeamStop) {
  if (!stop.window_kind || !stop.window_time) return null
  if (stop.window_kind === "at") return `約 ${stop.window_time} 到`
  return `${stop.window_time} ${stop.window_kind === "before" ? "以前" : "以後"}到`
}

// 這一站是誰排進來的；系統排的不另外標
export const SOURCE_LABEL: Record<StopSource, string> = {
  model: "系統排的",
  rep: "自己加的",
  ai: "跟熊熊滾說加的",
  ask: "問答加的",
}

/** Google 的編碼折線（Encoded Polyline Algorithm Format）解成經緯度 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    const deltas: number[] = []
    for (let axis = 0; axis < 2; axis += 1) {
      let result = 0
      let shift = 0
      let byte: number
      do {
        byte = encoded.charCodeAt(index) - 63
        index += 1
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      deltas.push(result & 1 ? ~(result >> 1) : result >> 1)
    }
    lat += deltas[0]
    lng += deltas[1]
    points.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }
  return points
}

/** 地圖要框住的範圍；沒有任何點是 null */
export function boundsOf(points: LatLng[]) {
  if (!points.length) return null
  const lats = points.map((point) => point.lat)
  const lngs = points.map((point) => point.lng)
  return { north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lngs), west: Math.min(...lngs) }
}

/** 一位業務沿路的每一段要畫的點：有折線用折線，沒有就從上一點直接連到這一站。
 *  第 n 段從「出發點加各站」的第 n 點開到第 n + 1 點（後端 services/team_itineraries.py 同一個規則） */
export function legPaths(route: RepRoute) {
  const points: LatLng[] = [
    ...(route.origin ? [route.origin] : []),
    ...route.stops.map(({ lat, lng }) => ({ lat, lng })),
  ]
  return route.legs.map((leg, n) => ({
    done: leg.done,
    path: leg.polyline ? decodePolyline(leg.polyline) : [points[n], points[n + 1]],
  }))
}
```

- [ ] **Step 6: 頭像在測試裡也 render 得出來**

`renderToStaticMarkup` 碰到沒有 `getServerSnapshot` 的 `useSyncExternalStore` 會丟錯，卡片（Task 6）的測試要 render 頭像。這幾個 hook 在瀏覽器裡的行為不變，只是多給第三個參數（伺服器端用同一份）：

- `frontend/src/lib/avatars.ts`：`return useSyncExternalStore(avatars.subscribe, () => avatars.urlOf(id))` 改成
  ```ts
    const read = () => avatars.urlOf(id)
    // 第三個參數給伺服器端 render（元件測試）用，同一份
    return useSyncExternalStore(avatars.subscribe, read, read)
  ```
- `frontend/src/lib/presence.ts`：`usePresence` 同樣改成 `const read = () => presence.statusOf(id)` 加 `useSyncExternalStore(presence.subscribe, read, read)`；`usePresenceMap` 改成 `useSyncExternalStore(presence.subscribe, presence.getSnapshot, presence.getSnapshot)`。

`frontend/src/components/user-avatar.tsx` 的 `TONES` 上面那行註解後面加一句：「順序跟主管頁路線的顏色一樣（lib/team-routes.ts 的 ROUTE_COLOR_VARS），改這裡要一起改。」

- [ ] **Step 7: 跑測試確認通過**

Run: `cd frontend && npm run typecheck && npm run lint && npm test`
Expected: 全部通過

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/team-routes.ts frontend/src/lib/team-routes.ts frontend/src/lib/team-routes.fixtures.ts \
  frontend/src/lib/team-routes.test.ts frontend/src/lib/avatars.ts frontend/src/lib/presence.ts frontend/src/components/user-avatar.tsx
git commit -m "Describe the team's routes for the manager page: header, card lines, drive time and decoded road lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Google 地圖（另外打包）

**Files:**
- Modify: `frontend/package.json`、`frontend/package-lock.json`（`npm install`）
- Modify: `frontend/tsconfig.app.json`（`types`）
- Create: `frontend/src/components/manager/route-map.tsx`
- Create: `frontend/src/components/manager/map-slot.tsx`

**Interfaces:**
- Consumes: Task 4 的型別、`getMapsConfig`、`boundsOf`、`legPaths`、`routeColorVar`。
- Produces（Task 6 用）：`<MapSlot routes={RepRoute[]} removed?={RemovedStop[]} />`（`components/manager/map-slot.tsx` 的具名匯出）。`route-map.tsx` 只給 `map-slot.tsx` 用 `import()` 載入，別的地方不能直接 import，不然它會被打包進主程式。

- [ ] **Step 1: 裝套件**

```bash
cd frontend && npm install @vis.gl/react-google-maps@^1.10.1 && npm install -D @types/google.maps
```

`frontend/tsconfig.app.json` 的 `"types": ["vite/client"]` 改成 `"types": ["vite/client", "google.maps"]`（`@vis.gl/react-google-maps` 的型別裡用到 `google.maps` 這個全域命名空間）。

- [ ] **Step 2: 地圖**

`frontend/src/components/manager/route-map.tsx`：

```tsx
import { useEffect, useState } from "react"
import {
  AdvancedMarker,
  APILoadingStatus,
  APIProvider,
  InfoWindow,
  Map,
  Polyline,
  useApiLoadingStatus,
} from "@vis.gl/react-google-maps"

import type { MapsConfig, RemovedStop, RepRoute, TeamStop } from "@/api/team-routes"
import { boundsOf, legPaths, routeColorVar } from "@/lib/team-routes"

// 還沒有任何點時框住台灣本島
const TAIWAN = { north: 25.35, south: 21.85, east: 122.05, west: 119.95 }
// 已經跑完的段深色、還沒去的段淡色
const DONE_OPACITY = 0.95
const TODO_OPACITY = 0.35
// 讀不到 CSS 變數時用主色
const FALLBACK_COLOR = "#9B51E0"

type Props = {
  config: NonNullable<MapsConfig>
  routes: RepRoute[]
  removed?: RemovedStop[]
  onFail: () => void
}

type Selected = { stop: TeamStop; repName: string }

/** CSS 變數換成實際的顏色：Google 地圖的線畫在 canvas 上，不認 var(--primary) */
function cssColor(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || FALLBACK_COLOR
}

/**
 * 主管頁的地圖（Google Maps JavaScript API，docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈地圖〉）。
 * 這支連同 @vis.gl/react-google-maps 只由 map-slot.tsx 用 import() 載入，另外打包，不算進業務首頁的下載量。
 * 金鑰被拒或 Google 的程式載不下來時呼叫 onFail，由外面換成一行「地圖暫時載入不了」。
 */
export default function RouteMap({ config, routes, removed = [], onFail }: Props) {
  const [selected, setSelected] = useState<Selected | null>(null)
  const points = [
    ...routes.flatMap((route) => [...(route.origin ? [route.origin] : []), ...route.stops]),
    ...removed,
  ]
  const bounds = boundsOf(points) ?? TAIWAN
  return (
    <APIProvider apiKey={config.browser_key} language="zh-TW" region="TW" onError={onFail}>
      <LoadWatch onFail={onFail} />
      <div className="h-64 overflow-hidden rounded-2xl border-2 shadow-lip">
        <Map
          mapId={config.map_id}
          defaultBounds={{ ...bounds, padding: 32 }}
          gestureHandling="cooperative"
          disableDefaultUI
          clickableIcons={false}
          className="size-full"
        >
          {routes.map((route) => (
            <RouteLayer
              key={route.rep.id}
              route={route}
              onSelect={(stop) => setSelected({ stop, repName: route.rep.name })}
            />
          ))}
          {removed.map((stop) => (
            <AdvancedMarker
              key={stop.customer_id}
              position={{ lat: stop.lat, lng: stop.lng }}
              title={`${stop.customer_name}（拿掉）`}
              anchorLeft="-50%"
              anchorTop="-12px"
            >
              {/* 被拿掉的站：紅色虛線圈加「（拿掉）」 */}
              <span className="flex flex-col items-center">
                <span className="size-6 rounded-full border-2 border-dashed border-destructive bg-background/70" />
                <span className="mt-0.5 rounded bg-background/90 px-1 text-[0.625rem] font-semibold text-destructive">
                  （拿掉）
                </span>
              </span>
            </AdvancedMarker>
          ))}
          {selected && (
            <InfoWindow
              position={{ lat: selected.stop.lat, lng: selected.stop.lng }}
              pixelOffset={[0, -14]}
              onCloseClick={() => setSelected(null)}
              headerContent={<span className="text-sm font-semibold text-neutral-900">{selected.stop.customer_name}</span>}
            >
              {/* 資訊視窗的底一律是白的，不跟深色配色：字用固定的深灰 */}
              <p className="text-xs text-neutral-700">
                {selected.repName} · 第 {selected.stop.number} 站 · {selected.stop.planned_time}{" "}
                {selected.stop.status === "done" ? "完成" : "到"}
              </p>
            </InfoWindow>
          )}
        </Map>
      </div>
      {routes.length > 1 && <Legend routes={routes} />}
    </APIProvider>
  )
}

/** 金鑰被拒（AUTH_FAILURE）或程式載不下來（FAILED）：交給外面換成說明 */
function LoadWatch({ onFail }: { onFail: () => void }) {
  const status = useApiLoadingStatus()
  useEffect(() => {
    if (status === APILoadingStatus.FAILED || status === APILoadingStatus.AUTH_FAILURE) onFail()
  }, [status, onFail])
  return null
}

/** 一位業務的路線：沿路的線（跑完的段深色、還沒去的淡色）與圓形編號（已完成實心、還沒去空心） */
function RouteLayer({ route, onSelect }: { route: RepRoute; onSelect: (stop: TeamStop) => void }) {
  const colorVar = routeColorVar(route.rep.id)
  const color = cssColor(colorVar)
  return (
    <>
      {legPaths(route).map((leg, n) => (
        <Polyline
          key={n}
          path={leg.path}
          strokeColor={color}
          strokeOpacity={leg.done ? DONE_OPACITY : TODO_OPACITY}
          strokeWeight={5}
          clickable={false}
        />
      ))}
      {route.stops.map((stop) => {
        const done = stop.status === "done"
        return (
          <AdvancedMarker
            key={stop.customer_id}
            position={{ lat: stop.lat, lng: stop.lng }}
            title={`第 ${stop.number} 站 ${stop.customer_name}`}
            onClick={() => onSelect(stop)}
            anchorLeft="-50%"
            anchorTop="-50%"
          >
            <span
              className="flex size-6 items-center justify-center rounded-full border-2 text-[0.6875rem] font-bold tabular-nums shadow-sm"
              style={
                done
                  ? { background: `var(${colorVar})`, borderColor: `var(${colorVar})`, color: "var(--background)" }
                  : { background: "var(--background)", borderColor: `var(${colorVar})`, color: `var(${colorVar})` }
              }
            >
              {stop.number}
            </span>
          </AdvancedMarker>
        )
      })}
    </>
  )
}

/** 圖例：每位業務的顏色 */
function Legend({ routes }: { routes: RepRoute[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="圖例">
      {routes.map((route) => (
        <li key={route.rep.id} className="flex items-center gap-1.5">
          <span className="h-1.5 w-4 rounded-full" style={{ background: `var(${routeColorVar(route.rep.id)})` }} />
          {route.rep.name}
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 3: 地圖區塊（拿金鑰、`import()`、載不下來的說明）**

`frontend/src/components/manager/map-slot.tsx`：

```tsx
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react"

import { getMapsConfig, type MapsConfig, type RemovedStop, type RepRoute } from "@/api/team-routes"

// 用 import() 另外打包：Google 地圖與 @vis.gl/react-google-maps 只有主管頁的行程分頁用得到
const RouteMap = lazy(() => import("@/components/manager/route-map"))

/**
 * 主管頁的地圖區塊。先問後端有沒有瀏覽器金鑰（GET /api/maps/config，不寫進前端的建置）；
 * 沒有金鑰、Google 的程式載不下來或金鑰被拒，就換成一行「地圖暫時載入不了」，下面的清單照常。
 */
export function MapSlot({ routes, removed }: { routes: RepRoute[]; removed?: RemovedStop[] }) {
  // undefined：還在問；null：沒有瀏覽器金鑰
  const [config, setConfig] = useState<MapsConfig | undefined>(undefined)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getMapsConfig(controller.signal)
      .then(setConfig)
      .catch(() => {
        if (!controller.signal.aborted) setConfig(null)
      })
    return () => controller.abort()
  }, [])

  if (config === undefined) return <MapPlaceholder />
  if (config === null || failed) {
    return (
      <p data-map-fallback className="rounded-xl bg-muted px-3 py-2.5 text-center text-xs text-muted-foreground">
        地圖暫時載入不了
      </p>
    )
  }
  return (
    <MapBoundary onFail={() => setFailed(true)}>
      <Suspense fallback={<MapPlaceholder />}>
        <RouteMap config={config} routes={routes} removed={removed} onFail={() => setFailed(true)} />
      </Suspense>
    </MapBoundary>
  )
}

function MapPlaceholder() {
  return <div aria-hidden className="h-64 animate-pulse rounded-2xl bg-muted" />
}

/**
 * 地圖那一包是打開行程分頁才下載的，收訊不好就會失敗；沒有錯誤邊界的話 React 會卸載整頁，
 * 連下面的清單都看不到。擋在地圖這一區，換成說明。React 的錯誤邊界只能用 class 元件寫（pages/ask.tsx 同）。
 */
class MapBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onFail()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
```

- [ ] **Step 4: 型別、lint、建置；確認地圖另外打包**

```bash
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
grep -l "APILoadingStatus\|maps.googleapis" dist/assets/*.js
grep -L "APILoadingStatus" dist/assets/index-*.js
```
Expected: 前四個全部成功。第一個 grep 列出的只有一個不是 `index-*.js` 的檔案（route-map 那一包）；第二個 grep 列出主程式 `index-*.js`（代表主程式裡沒有 Google 地圖的程式）。

這一步還沒有畫面用到 `MapSlot`（Task 6 才接上），build 時 `route-map` 可能被當成沒用到而不產生那一包；那就在 Task 6 的 Step 6 再做這個檢查，這裡只要前四個成功。

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/tsconfig.app.json \
  frontend/src/components/manager/route-map.tsx frontend/src/components/manager/map-slot.tsx
git commit -m "Draw the team's road-following routes on a Google map loaded on demand, with a one-line fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 行程分頁：總覽、卡片、詳細，排在最前面

**Files:**
- Create: `frontend/src/components/manager/rep-route-card.tsx`
- Test: `frontend/src/components/manager/rep-route-card.test.ts`
- Create: `frontend/src/components/manager/routes-panel.tsx`
- Modify: `frontend/src/pages/manager.tsx`

**Interfaces:**
- Consumes: Task 4 的 API、純函式與 fixtures；Task 5 的 `MapSlot`；`LiveAvatar`（`components/user-avatar.tsx`）；`Notice`；`CustomerLocationState`（`pages/customer.tsx`，`{ backTo?: string }`）。
- Produces: `RoutesPanel`（`components/manager/routes-panel.tsx` 的具名匯出）；`RepRouteCard`。

- [ ] **Step 1: 寫失敗的測試**

`frontend/src/components/manager/rep-route-card.test.ts`：

```ts
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import type { RepRoute } from "@/api/team-routes"
import { RepRouteCard } from "@/components/manager/rep-route-card"
import { repRoute, teamStop } from "@/lib/team-routes.fixtures"

const render = (route: RepRoute) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RepRouteCard, { route })))

describe("RepRouteCard", () => {
  it("名字、進度、下一站，點了進這位業務的詳細", () => {
    const html = render(repRoute())
    expect(html).toContain("林昱辰")
    expect(html).toContain("1/3 站 · 共 18.2 公里 · 約 16:40 收工")
    expect(html).toContain("下一站：第 2 站 客戶2 · 大安 · 10:40 到")
    expect(html).toContain('href="/manager?view=routes&amp;rep=U01"')
    expect(html).toContain('aria-valuenow="1"')
  })

  it("還沒動過是灰色的一行", () => {
    const html = render(repRoute())
    expect(html).toContain("照系統建議，還沒動過")
    expect(html).not.toContain("拿掉系統排的")
  })

  it("拿掉系統排的站是紅字、會晚到是琥珀色", () => {
    const html = render(
      repRoute({
        untouched: false,
        removed: [{ customer_id: "C9", customer_name: "和康藥局 · 松山", area: "松山", lat: 25.06, lng: 121.55, label: "帳款逾期", reason: "x" }],
        stops: [teamStop(1, "done"), teamStop(2, "next", { late_minutes: 25 })],
      })
    )
    expect(html).toMatch(/text-destructive[^>]*>(<svg[\s\S]*?<\/svg>)?拿掉系統排的 1 站：和康藥局 · 松山（帳款逾期）/)
    expect(html).toMatch(/text-warning[^>]*>(<svg[\s\S]*?<\/svg>)?1 站會晚到 25 分鐘/)
    expect(html).not.toContain("照系統建議，還沒動過")
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd frontend && npx vitest run src/components/manager/rep-route-card.test.ts`
Expected: FAIL（找不到 `@/components/manager/rep-route-card`）

- [ ] **Step 3: 卡片**

`frontend/src/components/manager/rep-route-card.tsx`：

```tsx
import { ChevronRight, CircleMinus, Clock } from "lucide-react"
import { Link } from "react-router"

import type { RepRoute } from "@/api/team-routes"
import { LiveAvatar } from "@/components/user-avatar"
import { lateLine, nextStopLine, progressLine, removedLine, routeColorVar } from "@/lib/team-routes"

/** 團隊總覽的一張卡：頭像、進度、下一站，以及要主管注意的事（拿掉系統排的站、會晚到、還沒動過）。點了進詳細 */
export function RepRouteCard({ route }: { route: RepRoute }) {
  const removed = removedLine(route.removed)
  const late = lateLine(route.stops)
  const next = nextStopLine(route.stops)
  const percent = route.total ? Math.round((route.done / route.total) * 100) : 0
  return (
    <Link
      to={`/manager?view=routes&rep=${route.rep.id}`}
      className="flex flex-col gap-2 rounded-2xl border-2 bg-card p-4 shadow-lip press"
    >
      <div className="flex items-center gap-2.5">
        <LiveAvatar id={route.rep.id} name={route.rep.name} />
        <div className="min-w-0 flex-1">
          <p className="leading-snug font-semibold">{route.rep.name}</p>
          <p className="text-xs text-muted-foreground tabular-nums">{progressLine(route)}</p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </div>
      {/* 進度條用這位業務在地圖上的顏色 */}
      <div
        role="progressbar"
        aria-label="今天的進度"
        aria-valuemin={0}
        aria-valuemax={route.total}
        aria-valuenow={route.done}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full" style={{ width: `${percent}%`, background: `var(${routeColorVar(route.rep.id)})` }} />
      </div>
      {next && <p className="text-xs">{next}</p>}
      {removed && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <CircleMinus className="mt-0.5 size-3.5 shrink-0" />
          {removed}
        </p>
      )}
      {late && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <Clock className="mt-0.5 size-3.5 shrink-0" />
          {late}
        </p>
      )}
      {route.untouched && <p className="text-xs text-muted-foreground">照系統建議，還沒動過</p>}
    </Link>
  )
}
```

- [ ] **Step 4: 跑卡片的測試確認通過**

Run: `cd frontend && npx vitest run src/components/manager/rep-route-card.test.ts`
Expected: 3 passed

- [ ] **Step 5: 總覽與詳細**

`frontend/src/components/manager/routes-panel.tsx`：

```tsx
import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Link, useNavigate, useSearchParams } from "react-router"

import { ApiError } from "@/api/client"
import { getRepRoute, getTeamRoutes, type RepRoute, type TeamRoutes, type TeamStop } from "@/api/team-routes"
import { MapSlot } from "@/components/manager/map-slot"
import { RepRouteCard } from "@/components/manager/rep-route-card"
import { Notice } from "@/components/notice"
import { LiveAvatar } from "@/components/user-avatar"
import { headerLine, progressLine, SOURCE_LABEL, totalsLine, windowLabel } from "@/lib/team-routes"
import { cn } from "@/lib/utils"
import type { CustomerLocationState } from "@/pages/customer"

// 畫面開著（在前景）就每 60 秒重拿一次；第 6 階段改成收到 WebSocket 事件才拿
const POLL_MS = 60_000

type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T }

const LOAD_FAILED = "連不上伺服器，團隊行程沒有載入。"

/**
 * 主管端的「行程」分頁（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈主管端：行程分頁〉）：
 * 預設是團隊總覽，網址帶 rep 就是那位業務的詳細（/manager?view=routes&rep=U01）。只能看、只看今天。
 */
export function RoutesPanel() {
  const [params] = useSearchParams()
  const rep = params.get("rep")
  return rep ? <RepDetail key={rep} userId={rep} /> : <TeamOverview />
}

/** 畫面在前景時每 60 秒加一，拿來觸發重拿 */
function usePollTick() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setTick((n) => n + 1)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [])
  return tick
}

/** 載入一份資料；背景重拿失敗就留著上一份，不把畫面換成錯誤 */
function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, key: string) {
  const [state, setState] = useState<Load<T>>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const tick = usePollTick()
  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
      .then((data) => setState({ status: "ready", data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof ApiError && error.status === 404 ? error.message : LOAD_FAILED
        setState((current) => (current.status === "ready" ? current : { status: "error", message }))
      })
    return () => controller.abort()
    // load 每次 render 都是新的函式；要不要重拿只看 key、按了重新載入、輪詢
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt, tick])
  const retry = () => {
    setState({ status: "loading" })
    setAttempt((n) => n + 1)
  }
  return { state, retry }
}

function Loading() {
  return <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>
}

function TeamOverview() {
  const navigate = useNavigate()
  const { state, retry } = useLoad<TeamRoutes>(getTeamRoutes, "team")
  if (state.status === "loading") return <Loading />
  if (state.status === "error") {
    return (
      <Notice
        text={state.message}
        action={{ label: "重新載入", onClick: retry }}
        secondary={{ label: "看提問", onClick: () => navigate("/manager?view=asks") }}
      />
    )
  }
  const { data } = state
  return (
    <>
      <p className="text-xs text-muted-foreground">{headerLine(data)}</p>
      {data.reps.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">你底下還沒有業務。</p>
      ) : (
        <>
          <MapSlot routes={data.reps} />
          {data.reps.map((route) => (
            <RepRouteCard key={route.rep.id} route={route} />
          ))}
          <GoogleAttribution routes={data.reps} />
        </>
      )}
    </>
  )
}

function RepDetail({ userId }: { userId: string }) {
  const navigate = useNavigate()
  const { state, retry } = useLoad<RepRoute>((signal) => getRepRoute(userId, signal), userId)
  if (state.status === "loading") return <Loading />
  if (state.status === "error") {
    return (
      <Notice
        text={state.message}
        action={{ label: "重新載入", onClick: retry }}
        secondary={{ label: "回團隊行程", onClick: () => navigate("/manager") }}
      />
    )
  }
  const route = state.data
  // 從客戶檔案按返回，回到這位業務的詳細
  const backTo = `/manager?view=routes&rep=${route.rep.id}`
  return (
    <>
      <Link to="/manager" className="-ml-1 flex h-11 items-center gap-1 self-start text-sm text-muted-foreground">
        <ChevronLeft className="size-4" />
        團隊行程
      </Link>
      <div className="flex items-center gap-2.5">
        <LiveAvatar id={route.rep.id} name={route.rep.name} size="lg" />
        <div className="min-w-0">
          <p className="text-base font-semibold">{route.rep.name}</p>
          <p className="text-xs text-muted-foreground tabular-nums">{progressLine(route)}</p>
        </div>
      </div>
      <MapSlot routes={[route]} removed={route.removed} />
      <p className="text-xs tabular-nums">{totalsLine(route)}</p>
      <section className="flex flex-col gap-1.5 rounded-2xl border-2 bg-card p-4 shadow-lip">
        <h2 className="text-sm font-semibold">跟系統早上的建議比</h2>
        <Changes route={route} />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">今天的行程</h2>
        <ol className="flex flex-col gap-2">
          {route.stops.map((stop) => (
            <StopRow key={stop.customer_id} stop={stop} backTo={backTo} />
          ))}
        </ol>
      </section>
      <GoogleAttribution routes={[route]} />
    </>
  )
}

/** 跟系統早上的建議比：拿掉的（含理由）、自己加的、順序改過的；都沒有就是照系統建議 */
function Changes({ route }: { route: RepRoute }) {
  if (!route.removed.length && !route.added.length && !route.moved.length) {
    return <p className="text-xs text-muted-foreground">照系統建議</p>
  }
  return (
    <ul className="flex flex-col gap-1 text-xs leading-relaxed">
      {route.removed.map((stop) => (
        <li key={stop.customer_id} className="text-destructive">
          拿掉：{stop.customer_name}（{stop.label}）· {stop.reason}
        </li>
      ))}
      {route.added.map((name) => (
        <li key={name}>自己加的：{name}</li>
      ))}
      {route.moved.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}

/** 行程清單的一站：跟業務看到的一樣（到達時間、停留、約的時間、會晚到、來源），點了進客戶檔案 */
function StopRow({ stop, backTo }: { stop: TeamStop; backTo: string }) {
  const done = stop.status === "done"
  const window = windowLabel(stop)
  return (
    <li>
      <Link
        to={`/customers/${stop.customer_id}`}
        state={{ backTo } satisfies CustomerLocationState}
        className={cn("flex items-start gap-3 rounded-xl border-2 bg-card px-3 py-2.5 shadow-lip press", done && "opacity-60")}
      >
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold tabular-nums">
          {stop.number}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug font-medium">{stop.customer_name}</span>
          <span className="block text-xs text-muted-foreground tabular-nums">
            {done ? `${stop.planned_time} 完成` : `${stop.planned_time} 到 · 停 ${stop.duration_minutes} 分`}
          </span>
          <span className="mt-1 flex flex-wrap gap-1 empty:hidden">
            {window && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[0.6875rem]">{window}</span>}
            {!done && stop.late_minutes > 0 && (
              <span className="rounded-md bg-destructive/10 px-1.5 py-0.5 text-[0.6875rem] text-destructive">
                會晚到 {stop.late_minutes} 分
              </span>
            )}
            {stop.source !== "model" && (
              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[0.6875rem] text-primary">
                {SOURCE_LABEL[stop.source]}
              </span>
            )}
          </span>
        </span>
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  )
}

/**
 * Google 的條款：Routes API 的內容（車程、公里）顯示在不是 Google 地圖的地方要標「Google Maps」，
 * 字型 Roboto、不翻譯、不換行。有任何一份是 Google 的道路車程才標
 */
function GoogleAttribution({ routes }: { routes: RepRoute[] }) {
  if (routes.every((route) => route.estimated)) return null
  return (
    <p translate="no" className="text-center text-xs whitespace-nowrap text-muted-foreground" style={{ fontFamily: "Roboto, Arial, sans-serif" }}>
      Google Maps
    </p>
  )
}
```

`frontend/src/pages/manager.tsx`：

1. import 區加 `import { RoutesPanel } from "@/components/manager/routes-panel"`（照字母順序放在 `ChannelsLink` 那一行後面）。
2. 分頁的定義改成：
   ```tsx
   // 主管端的分頁：團隊今天的行程（預設）、業務轉來的提問、拜訪提到競品或客訴的風險通報、簽核、自己寫的方法卡。
   // 記在網址上，從客戶檔案回來還停在同一頁
   const VIEWS = ["routes", "asks", "notices", "oa", "methods"] as const
   type View = (typeof VIEWS)[number]
   const VIEW_TITLE: Record<View, string> = {
     routes: "團隊行程",
     asks: "待回覆的提問",
     notices: "風險通報",
     oa: "OA 簽核",
     methods: "方法卡",
   }
   const VIEW_TAB: Record<View, string> = { routes: "行程", asks: "提問", notices: "風險通報", oa: "簽核", methods: "方法卡" }
   ```
3. `const view: View = VIEWS.find(...) ?? "asks"` 的 `"asks"` 改成 `"routes"`。
4. `switchView` 改成（從某位業務的詳細按「行程」也要回到總覽，所以不能看到同一個分頁就略過）：
   ```tsx
   function switchView(next: View) {
     setParams(next === "routes" ? {} : { view: next }, { replace: true })
   }
   ```
5. 分頁列：五個分頁在 375px 寬要排得下（「風險通報」加未讀數最寬）。外層 `className="flex border-b bg-background px-4"` 改成 `"flex border-b bg-background px-2"`；每個分頁按鈕的 `"-mb-px flex h-11 flex-1 items-center justify-center gap-1.5 border-b-2 text-sm"` 改成 `"-mb-px flex h-11 min-w-0 flex-1 items-center justify-center gap-1 border-b-2 text-[0.8125rem] whitespace-nowrap"`。
6. `<main>` 裡：
   ```tsx
        {view === "routes" ? (
          <RoutesPanel />
        ) : view === "asks" ? (
          <EscalationsPanel />
        ) : view === "notices" ? (
   ```
   （其餘照舊）
7. 兩處 `secondary={{ label: "回提問", onClick: () => navigate("/manager") }}` 改成 `navigate("/manager?view=asks")`。
8. `ManagerPage` 上面的說明改成 `/** 主管端（FR-8.4 延伸）：看團隊今天的行程、回覆業務轉過來的提問、看風險通報、簽申請單（出差單、優惠、合約）、寫方法卡。主管看自己底下的人，IT 看全公司 */`。

- [ ] **Step 6: 型別、lint、測試、建置；地圖另外打包**

```bash
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
grep -l "APILoadingStatus" dist/assets/*.js
grep -c "APILoadingStatus" dist/assets/index-*.js
```
Expected: 前四個全部成功；第一個 grep 只列出一個檔案、而且不是 `index-*.js`；第二個印出 `0`（主程式裡沒有 Google 地圖的程式）。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/manager/rep-route-card.tsx frontend/src/components/manager/rep-route-card.test.ts \
  frontend/src/components/manager/routes-panel.tsx frontend/src/pages/manager.tsx
git commit -m "Open the manager side on the team's routes: a map, one card per rep and each rep's detail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 文件

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README**

1. 〈轉給主管與主管回覆（FR-8.4 延伸）〉第二點的「**主管端**在 `/manager`（首頁右上「主管端」）：看待回覆的提問和系統當時的回覆。」改成「**主管端**的「提問」分頁（`/manager?view=asks`）：看待回覆的提問和系統當時的回覆。」，同一點後面的字不動。
2. 在〈轉給主管與主管回覆〉這一節最後一點後面、〈方法卡〉前面，加新的一節：

```markdown
## 主管端的團隊行程

設計見 [docs/superpowers/specs/2026-10-01-itinerary-planning-design.md](docs/superpowers/specs/2026-10-01-itinerary-planning-design.md)〈主管端：行程分頁〉。

- 主管端打開就是「行程」分頁（分頁順序：行程、提問、風險通報、簽核、方法卡）。主管看自己底下的業務，IT 看全公司；只能看、只看今天。
- **總覽**：Google 地圖上每位業務一個顏色（跟頭像底色同一套），路線沿道路畫，跑完的段深色、還沒去的淡色，站點是圓形編號（已完成實心）。每位業務一張卡：進度、公里數、約幾點收工、下一站，紅字是拿掉了系統排的哪幾站，琥珀色是會晚到的站，沒動過的寫「照系統建議，還沒動過」。
- **一位業務的詳細**（點卡片）：地圖多畫被拿掉的站（紅色虛線圈），下面是總公里數與車程（標明 Google 道路車程或估計）、「跟系統早上的建議比」（拿掉、自己加的、順序改過的），以及跟業務看到的一樣的行程清單，點客戶進客戶檔案。
- 業務今天還沒打開首頁時，主管一讀就照系統的建議建好他的行程（跟業務第一次讀取一樣）。
- 地圖用 `@vis.gl/react-google-maps`，只有這一頁用 `import()` 另外下載，不算進業務首頁。瀏覽器金鑰由 `GET /api/maps/config` 給；沒設金鑰或 Google 載不下來時，地圖換成一行「地圖暫時載入不了」，下面的卡片照常。沿路的線向 Google Routes API 要，同一串點的線放 Redis 一天（條款允許快取經緯度；車程不快取）。
- 畫面開著時每 60 秒重拿一次。
```

- [ ] **Step 2: 全部測試**

```bash
TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests -q
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
```
Expected: 全部通過。

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Describe the manager's team routes in the README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 實機檢查（controller 自己做，不派給 implementer）

照 [[run-stack-from-a-worktree]]：資料庫 `meddemo_maps_dev`、Redis 10 號庫、後端 port 8013、Vite port 5183（暫時的 `vite.maps.config.ts`，mergeConfig 把 proxy 含 `/api/ws` 指到 8013，不 commit）。灌資料：`uv run --project backend python data/seed/seed.py --database-url <url>`。無頭 Chrome 每段 20 秒內、各自的 port 與 `--user-data-dir`，localStorage 放 `meddemo:onboarded`、`meddemo:token`、`meddemo:user`。在 375×812 截圖：

1. M01 的總覽：頁首、地圖區塊「地圖暫時載入不了」（沒有瀏覽器金鑰）、兩張卡、分頁列五個分頁排得下（有未讀數時也是）。
2. 後端用假的 `GOOGLE_MAPS_BROWSER_KEY` 重開：地圖試著載入，金鑰被拒後換成「地圖暫時載入不了」。
3. 點王冠宇的卡：詳細頁、總公里那一行、「跟系統早上的建議比」寫「照系統建議」、行程清單；點一家進客戶檔案，按返回回到詳細。
4. A01 的總覽：「全公司 5 位業務」。
5. 「回提問」（簽核、方法卡載入失敗時的次要按鈕）不必實測；確認提問分頁的網址是 `/manager?view=asks`。

截圖放 scratchpad；看完停掉服務、刪掉暫時的 vite 設定、刪掉 dev 資料庫並清空 Redis 10。
