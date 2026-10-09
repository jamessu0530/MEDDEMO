# 點站就騎過去、個人頁的獎牌與圖表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 首頁點一站熊熊滾就騎過去並記成「到過」，新增個人頁（事蹟數字、可以在牆上轉的立體獎牌、兩張會長出來的圖）。

**Architecture:** 後端多一張 `stop_arrival`（哪份行程、哪一家、第一次與最後一次點的時間），行程照它把站標成 `done`、位置與時間不動；`services/achievements.py` 從它算獎牌，另算三格數字、前五名與每月業績，`GET /api/me` 一次給個人頁。前端 `RoutePath` 改成點站就從熊停的那一站（或最上面新加的辦公室圓鈕）騎到點的那一站；個人頁的獎牌用 three.js 畫在一張蓋住獎牌牆的 canvas 上（scissor 一格一格畫），跑不動就退回平塗 SVG。

**Tech Stack:** FastAPI、SQLAlchemy 2、PostgreSQL、pytest；React 19、react-router 8、Tailwind 4、vitest；新加 `three`（與 `@types/three`）。

**Spec:** `docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md`；個人頁長相以 `docs/superpowers/specs/assets/2026-10-09-personal-page-demo.html` 為準（瀏覽器打開就會動，獎牌、圖表的程式可以直接對照）。

## Global Constraints

- 畫面上的字一律繁體中文；不用 emoji，圖示用 lucide 或字。
- 前端程式一行約 120 字，**不要跑 `prettier --write`**（.prettierrc 寫 80 但整個專案不是照它排的）。
- 註解照周圍的密度與語氣：中文、講為什麼；docstring 開頭註明設計文件的出處。
- 獎牌門檻：跑過的藥局 1／3／5 家，跑過的縣市 1／2／3 個（後端常數 `MEDAL_TIERS`）。
- 獎牌只算 `stop_arrival`（首頁點過的站），以前的拜訪不算；解鎖日期是那份行程的日期（系統日），不是真實時間。
- 「近一年」＝系統日往前 365 天（`(today - 365, today]`）；每月業績是含這個月的近六個月，這個月寫算到系統日。
- 個人頁與 `arrive` 只有業務（含代理示範業務的帳號）能用；主管、IT 回 403「主管沒有自己的拜訪路線」。
- 減少動態效果（`prefers-reduced-motion`）時：熊不移動、獎牌不自己擺也不快轉（拖著轉照常）、圖表直接畫好。
- 後端測試在 worktree 裡跑：`TEST_DB_NAME=meddemo_test_tapride TEST_REDIS_URL=redis://127.0.0.1:6379/12 uv run --project backend pytest backend/tests/<檔案> -q`（不要用預設庫名，免得清掉別的 session 的測試資料庫）。
- 前端：`npm --prefix frontend run test -- <檔案>`、`npm --prefix frontend run typecheck`、`npm --prefix frontend run lint`。
- 每個 commit 訊息最後一行：`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`（前面空一行）。commit 標題用英文、祈使句、講做了什麼（照 `git log` 的寫法）。

---

## File Structure

後端
- `backend/app/models.py`：加 `StopArrival`；`NOTE_KINDS` 加 `competitor`。
- `backend/app/services/itinerary.py`：`arrive()`、行程的到過狀態（`StopView.arrived_at`、`done`、`next`）、`stop_order`。
- `backend/app/services/achievements.py`（新）：獎牌、三格數字、前五名、每月業績。
- `backend/app/api/me.py`（新）：`GET /api/me`、`MedalOut`。
- `backend/app/api/itinerary.py`：`POST /api/itinerary/today/stops/{customer_id}/arrive`、`Stop.arrived_at`。
- `backend/app/services/customer_profile.py`：進門前三分鐘拿掉競品那句。
- `backend/app/services/customer_notes.py`：確認拜訪時寫競品備忘、日曆濾掉競品。
- `backend/app/api/notes.py`：`NoteOut.kind` 多競品、`GET /api/customers/{customer_id}/brief`。
- `backend/app/main.py`：掛上 `me.router`。
- `data/seed/catalog.py`：示範備忘加兩則競品。
- `backend/scripts/stress_arrivals.py`（新）：壓力測試。

前端
- `frontend/src/api/route.ts`：`RouteStop.arrived_at`、`arriveAt()`。
- `frontend/src/api/me.ts`（新）：個人頁的型別與 `getMe()`。
- `frontend/src/api/notes.ts`：`NoteKind` 多 `competitor`、`WritableNoteKind`、`getBrief()`。
- `frontend/src/lib/rides.ts`：`anchorId`、`hereOf`、`legBetween`、`lastLeg`；拿掉 `legInto`、`legKey`、`parkedLeg`、`legToPlay`。
- `frontend/src/lib/ride-memory.ts`：只留騎過的座騎送不出去時的佇列。
- `frontend/src/lib/format.ts`：`formatTaipeiTime`、`formatWan`。
- `frontend/src/lib/medals.ts`（新）：獎牌的字、看過的記錄、首頁提示那一句、圖表的刻度。
- `frontend/src/lib/ride-on-route.ts`：`legPoints` 改成量任兩站。
- `frontend/src/components/rides/ride-on-route.tsx`：點了才騎（`play`）、量任兩站、`onEnd`。
- `frontend/src/components/route-path.tsx`：辦公室圓鈕、點站就騎、小卡的進門前三分鐘、到過的標籤。
- `frontend/src/components/route/unlock-toast.tsx`（新）：首頁的解鎖提示。
- `frontend/src/pages/today.tsx`：接 `arrive`、拿掉自動騎、解鎖提示、名字連到 `/me`。
- `frontend/src/components/note-row.tsx`、`note-dialog.tsx`、`next-notes.tsx`、`lib/calendar.ts`：競品備忘。
- `frontend/src/pages/me.tsx`（新）、`frontend/src/components/me/medal-wall.tsx`（新）、`medal-scene.ts`（新，three.js）、`flat-medal.tsx`（新）、`sales-charts.tsx`（新）。
- `frontend/src/App.tsx`：`/me`。

---

### Task 1: 後端：點站記成到過，行程照它標成跑完

**Files:**
- Modify: `backend/app/models.py`（`ItineraryLeg` 後面加 `StopArrival`）
- Modify: `backend/app/services/itinerary.py`
- Modify: `backend/app/api/itinerary.py:47-71`（`Stop` 加 `arrived_at`）
- Modify: `backend/tests/test_itinerary_api.py:31-36`（欄位清單加 `arrived_at`）
- Test: `backend/tests/test_stop_arrivals.py`（新）

**Interfaces:**
- Produces: `models.StopArrival(itinerary_id, customer_id, first_at, last_at)`；`itinerary.arrive(session, user_id: str, customer_id: str) -> Itinerary`（不在今天行程上丟 `NotOnItinerary`，不是業務丟 `LookupError`）；`StopView.arrived_at: dt.datetime | None`（這份行程最後一次點的時間）；`ItineraryView.done` 含到過的站。

- [ ] **Step 1: 寫失敗的測試** `backend/tests/test_stop_arrivals.py`

```python
"""點站就算到過（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈行程〉）：
到過的站標成跑完，但留在原本的位置、時間照原本排的；主管頁的地圖也算它跑完。"""

import pytest
from sqlalchemy import func, select

from app.models import AppUser, StopArrival
from app.services import itinerary as service
from app.services import team_itineraries as team


def route(tx):
    itinerary = service.get_or_create(tx, "U01")
    return itinerary, service.view(tx, itinerary)


def test_an_arrived_stop_is_done_but_stays_in_place(tx):
    itinerary, before = route(tx)
    service.arrive(tx, "U01", before.stops[2].customer_id)
    after = service.view(tx, itinerary)
    assert [s.customer_id for s in after.stops] == [s.customer_id for s in before.stops]
    assert [s.planned_time for s in after.stops] == [s.planned_time for s in before.stops]
    assert [s.status for s in after.stops] == ["next", "todo", "done", "todo", "todo"]
    assert after.stops[2].arrived_at is not None and after.stops[0].arrived_at is None
    assert after.done == 1
    # 版本加一：主管頁靠 Itinerary 改了才收到 itinerary 事件（app/realtime.py）
    assert after.version == before.version + 1


def test_next_skips_arrived_stops(tx):
    itinerary, before = route(tx)
    service.arrive(tx, "U01", before.stops[0].customer_id)
    assert [s.status for s in service.view(tx, itinerary).stops][:2] == ["done", "next"]


def test_tapping_again_only_moves_the_last_time(tx):
    itinerary, before = route(tx)
    a, b = before.stops[0].customer_id, before.stops[1].customer_id
    for customer_id in (a, b, a):
        service.arrive(tx, "U01", customer_id)
    rows = {r.customer_id: r for r in tx.scalars(select(StopArrival).where(StopArrival.itinerary_id == itinerary.id))}
    assert set(rows) == {a, b}
    assert rows[a].first_at < rows[b].first_at < rows[a].last_at


def test_only_stops_on_todays_route(tx):
    route(tx)
    with pytest.raises(service.NotOnItinerary):
        service.arrive(tx, "U01", "C999")


def test_managers_have_no_route_to_tap(tx):
    with pytest.raises(LookupError):
        service.arrive(tx, "M01", "C001")


def test_resetting_the_demo_route_clears_arrivals(tx):
    _, before = route(tx)
    service.arrive(tx, "U01", before.stops[0].customer_id)
    service.reset_today(tx, "U01")
    assert tx.scalar(select(func.count()).select_from(StopArrival)) == 0


def test_the_map_counts_arrived_stops_as_finished(tx):
    itinerary, before = route(tx)
    service.arrive(tx, "U01", before.stops[1].customer_id)
    found = team.rep_map(tx, tx.get(AppUser, "U01"), itinerary)
    assert [s.status for s in found.stops] == ["next", "done", "todo", "todo", "todo"]
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_tapride TEST_REDIS_URL=redis://127.0.0.1:6379/12 uv run --project backend pytest backend/tests/test_stop_arrivals.py -q`
Expected: FAIL，`ImportError: cannot import name 'StopArrival'`。

- [ ] **Step 3: 加資料表** `backend/app/models.py`，接在 `class ItineraryLeg` 整個定義之後：

```python
class StopArrival(Base):
    """首頁點過的站（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈資料〉）。

    點了熊熊滾就騎過去，這一站算到過：不用錄音、不用送出拜訪。first_at 算獎牌的解鎖（第幾家是哪一次點到的），
    last_at 決定熊熊滾停在哪一站。拿掉這一站時不刪：點過就算跑過，獎牌不會因為改路線掉回去。
    行程刪掉（IT 重置示範業務的行程）時一起刪，獎牌跟著歸零。
    """

    __tablename__ = "stop_arrival"

    itinerary_id: Mapped[int] = mapped_column(ForeignKey("itinerary.id", ondelete="CASCADE"), primary_key=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customer.id"), primary_key=True)
    # clock_timestamp 而不是 now()：now() 是交易開始的時間，同一個交易裡點好幾站會分不出先後
    first_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.clock_timestamp())
    last_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.clock_timestamp())
```

- [ ] **Step 4: 行程照到過的站算** `backend/app/services/itinerary.py`

4a. import 加 `StopArrival`（照字母順序放進 `from app.models import (...)` 那一串）。

4b. `StopView` 最後加一個欄位：

```python
    city: str = ""  # 客戶在哪個縣市（熊熊滾騎哪個縣市的座騎）
    # 首頁點過這一站：這份行程裡最後一次點的時間（熊熊滾停在最後點的那一站）；沒點過是 None
    arrived_at: dt.datetime | None = None
```

4c. `_Day` 加欄位與方法（接在 `habits` 之後）：

```python
    habits: list[RouteHabit]
    # 首頁點過的站（客戶 → 那一列）：標成跑完，但位置與時間照存著的
    arrivals: dict[str, StopArrival] = field(default_factory=dict)

    @property
    def done_ids(self) -> set[str]:
        return {c.id for _, c in self.done}

    def arrived_at(self, customer_id: str) -> dt.datetime | None:
        found = self.arrivals.get(customer_id)
        return found.last_at if found else None
```

4d. `_day()` 讀進來：

```python
def _day(session: Session, itinerary: Itinerary) -> _Day:
    rep = session.get(AppUser, itinerary.user_id)
    arrivals = session.scalars(select(StopArrival).where(StopArrival.itinerary_id == itinerary.id))
    return _Day(
        itinerary=itinerary, rep=rep, done=today_route.done_visits(session, rep.id, itinerary.date),
        rows=_rows(session, itinerary), habits=route_habits.for_day(session, rep.id, itinerary.date),
        arrivals={a.customer_id: a for a in arrivals},
    )
```

4e. `_compose()` 改四個地方：

- 跑完的站那一圈的 `StopView(...)` 最後加參數 `arrived_at=day.arrived_at(customer.id)`。
- 還沒跑的那一圈（`for n, (o, slot) in enumerate(zip(open_, planned.slots, strict=True)):`）前面加一行：

```python
    # 到過的站標成跑完、留在原位；「下一站」是第一個既沒跑完也沒到過的
    upcoming = next((n for n, o in enumerate(open_) if o.customer.id not in day.arrivals), None)
```

  圈裡的 `status="next" if n == 0 else "todo"` 改成 `status="done" if o.customer.id in day.arrivals else "next" if n == upcoming else "todo"`，
  `StopView(...)` 最後加參數 `arrived_at=day.arrived_at(o.customer.id)`。
- 圈後面的 `urgent = itinerary.urgent if itinerary.urgent and itinerary.urgent["customer_id"] in open_ids else None` 換成：

```python
    # 到過的那家不再是需立即處理
    pending_ids = open_ids - set(day.arrivals)
    urgent = itinerary.urgent if itinerary.urgent and itinerary.urgent["customer_id"] in pending_ids else None
```

- `ItineraryView(...)` 的 `done=len(day.done)` 改成 `done=len(day.done) + sum(1 for o in open_ if o.customer.id in day.arrivals)`。

4f. `stop_order()` 改成：

```python
    day = _day(session, itinerary)
    return [(c, True) for _, c in day.done] + [
        (o.customer, o.customer.id in day.arrivals) for o in _saved_open(session, day)
    ]
```

docstring 的「(客戶, 跑完了嗎)」後面補「到過的站也算跑完」。

4g. 新函式（放在 `set_leg_mode` 前面）：

```python
def arrive(session: Session, user_id: str, customer_id: str) -> Itinerary:
    """首頁點了路線上的一站：記成到過（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md）。

    第一次點建一列，再點只改最後一次的時間。不比版本、不管順序，點了一定成功；不在今天的行程上丟 NotOnItinerary。
    行程的版本加一：主管頁收到 itinerary 事件跟著更新（app/realtime.py），手上舊版本的人改行程時會被擋下來重新載入。
    """
    itinerary = get_or_create(session, user_id)
    _lock(session, itinerary)
    on_route = session.scalar(
        select(ItineraryStop.id).where(ItineraryStop.itinerary_id == itinerary.id, ItineraryStop.customer_id == customer_id)
    )
    if on_route is None:
        raise NotOnItinerary(customer_id)
    session.execute(
        insert(StopArrival)
        .values(itinerary_id=itinerary.id, customer_id=customer_id)
        .on_conflict_do_update(index_elements=["itinerary_id", "customer_id"], set_={"last_at": func.clock_timestamp()})
    )
    _touch(itinerary)
    session.flush()
    return itinerary
```

（`_lock` 遇到行程剛被刪掉會丟 `VersionConflict`，API 那層轉成 409。）

- [ ] **Step 5: API 的站多 `arrived_at`** `backend/app/api/itinerary.py` 的 `class Stop` 最後加：

```python
    city: str
    # 首頁點過這一站：這份行程裡最後一次點的時間；沒點過是 null
    arrived_at: datetime | None
```

檔頭 `from datetime import date, time` 改成 `from datetime import date, datetime, time`。`backend/tests/test_itinerary_api.py` 的 `test_today_has_the_fields_the_home_page_needs` 那個欄位集合加上 `"arrived_at"`。

- [ ] **Step 6: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_tapride TEST_REDIS_URL=redis://127.0.0.1:6379/12 uv run --project backend pytest backend/tests/test_stop_arrivals.py backend/tests/test_itinerary.py backend/tests/test_itinerary_api.py backend/tests/test_team_itineraries.py backend/tests/test_team_itineraries_api.py -q`
Expected: 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/app/services/itinerary.py backend/app/api/itinerary.py backend/tests/test_stop_arrivals.py backend/tests/test_itinerary_api.py
git commit -m "Mark a tapped stop as arrived and count it as done without moving it"
```

---

### Task 2: 後端：獎牌、個人頁的數字、點站的 API

**Files:**
- Create: `backend/app/services/achievements.py`
- Create: `backend/app/api/me.py`
- Modify: `backend/app/api/itinerary.py`（`ArriveResult` 與 `POST /today/stops/{customer_id}/arrive`）
- Modify: `backend/app/main.py`（import 加 `me`，`app.include_router(me.router)` 接在 `vehicles.router` 後面）
- Test: `backend/tests/test_achievements.py`（新）

**Interfaces:**
- Consumes: Task 1 的 `StopArrival`、`itinerary.arrive`、`NotOnItinerary`、`VersionConflict`。
- Produces: `achievements.MEDAL_TIERS`；`achievements.medals(session, rep_id) -> list[Medal]`（固定 6 筆，順序 stores 1–3、cities 1–3）；`achievements.newly_unlocked(before, after) -> list[Medal]`；`achievements.build(session, rep: AppUser) -> Me`；`api.me.MedalOut`；`POST /api/itinerary/today/stops/{customer_id}/arrive` 回 `{itinerary: TodayItinerary, unlocked: MedalOut[]}`；`GET /api/me` 回 `MeOut`：

```json
{"name": "林昱辰", "region": "北區",
 "stats": {"visits_last_year": 1078, "customers": 53, "sales_last_year": 31337833.0},
 "medals": [{"kind": "stores", "tier": 1, "need": 1, "have": 0, "unlocked_on": null}, "..."],
 "top_customers": [{"customer_id": "C0xx", "name": "康泰連鎖藥局 · 內湖店", "amount": 2511468.0}, "..."],
 "monthly": [{"month": "2026-05", "amount": 2920623.0, "through": null}, "...", {"month": "2026-10", "amount": 1865839.0, "through": "2026-10-28"}]}
```

- [ ] **Step 1: 寫失敗的測試** `backend/tests/test_achievements.py`

```python
"""個人頁：獎牌只算點過的站，另有三格事蹟數字、前五名與每月業績
（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈API〉）。"""

import datetime as dt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.main import app
from app.models import ItineraryStop
from app.services import achievements
from app.services import itinerary as service

# 測試資料庫的系統日（seed.DEFAULT_AS_OF）：解鎖日期是那份行程的日期，不是真實時間
DAY = dt.date(2026, 10, 28)


@pytest.fixture
def client(tx):
    return TestClient(app)


def tap(tx, *indexes):
    itinerary = service.get_or_create(tx, "U01")
    stops = service.view(tx, itinerary).stops
    for i in indexes:
        service.arrive(tx, "U01", stops[i].customer_id)
    return itinerary, stops


def by_key(found):
    return {(m.kind, m.tier): m for m in found}


def test_six_medals_and_nothing_unlocked_before_any_tap(tx):
    found = achievements.medals(tx, "U01")
    assert [(m.kind, m.tier, m.need) for m in found] == [
        ("stores", 1, 1), ("stores", 2, 3), ("stores", 3, 5), ("cities", 1, 1), ("cities", 2, 2), ("cities", 3, 3),
    ]
    assert all(m.have == 0 and m.unlocked_on is None for m in found)


def test_three_stores_unlock_silver_on_the_route_day(tx):
    _, stops = tap(tx, 0, 1, 2)
    found = by_key(achievements.medals(tx, "U01"))
    assert found[("stores", 2)].have == 3 and found[("stores", 2)].unlocked_on == DAY
    assert found[("stores", 3)].unlocked_on is None
    cities = {s.city for s in stops[:3]}
    for tier, need in enumerate((1, 2, 3), start=1):
        medal = found[("cities", tier)]
        assert medal.have == len(cities)
        assert medal.unlocked_on == (DAY if need <= len(cities) else None)


def test_tapping_the_same_stop_twice_counts_once(tx):
    tap(tx, 0, 0)
    assert by_key(achievements.medals(tx, "U01"))[("stores", 1)].have == 1


def test_a_removed_stop_still_counts(tx):
    itinerary, stops = tap(tx, 0)
    tx.execute(delete(ItineraryStop).where(
        ItineraryStop.itinerary_id == itinerary.id, ItineraryStop.customer_id == stops[0].customer_id
    ))
    assert by_key(achievements.medals(tx, "U01"))[("stores", 1)].have == 1


def test_newly_unlocked_lists_only_what_this_tap_unlocked(tx):
    before = achievements.medals(tx, "U01")
    tap(tx, 0)
    after = achievements.medals(tx, "U01")
    assert [(m.kind, m.tier) for m in achievements.newly_unlocked(before, after)] == [("stores", 1), ("cities", 1)]
    assert achievements.newly_unlocked(after, after) == []


def test_arrive_through_the_api(client, auth):
    route = client.get("/api/itinerary/today", headers=auth()).json()
    first = route["stops"][0]["customer_id"]
    sent = client.post(f"/api/itinerary/today/stops/{first}/arrive", headers=auth())
    assert sent.status_code == 200, sent.text
    data = sent.json()
    assert data["itinerary"]["stops"][0]["status"] == "done" and data["itinerary"]["stops"][0]["arrived_at"]
    assert data["itinerary"]["version"] == route["version"] + 1
    assert [(m["kind"], m["tier"], m["unlocked_on"]) for m in data["unlocked"]] == [
        ("stores", 1, "2026-10-28"), ("cities", 1, "2026-10-28"),
    ]
    again = client.post(f"/api/itinerary/today/stops/{first}/arrive", headers=auth()).json()
    assert again["unlocked"] == []


def test_arrive_refuses_other_customers_and_managers(client, auth):
    client.get("/api/itinerary/today", headers=auth())
    missing = client.post("/api/itinerary/today/stops/C999/arrive", headers=auth())
    assert missing.status_code == 404
    assert client.post("/api/itinerary/today/stops/C001/arrive", headers=auth("M01")).status_code == 403


def test_me_has_what_the_personal_page_shows(client, auth):
    data = client.get("/api/me", headers=auth()).json()
    assert data["name"] == "林昱辰" and data["region"] == "北區"
    assert data["stats"]["customers"] == 53
    assert data["stats"]["visits_last_year"] > 900 and data["stats"]["sales_last_year"] > 0
    amounts = [c["amount"] for c in data["top_customers"]]
    assert len(amounts) == 5 and amounts == sorted(amounts, reverse=True)
    assert [m["month"] for m in data["monthly"]] == ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]
    assert [m["through"] for m in data["monthly"]] == [None] * 5 + ["2026-10-28"]
    assert len(data["medals"]) == 6


def test_managers_have_no_personal_page(client, auth):
    found = client.get("/api/me", headers=auth("M01"))
    assert found.status_code == 403 and found.json()["detail"] == "主管沒有自己的拜訪路線"
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_tapride TEST_REDIS_URL=redis://127.0.0.1:6379/12 uv run --project backend pytest backend/tests/test_achievements.py -q`
Expected: FAIL，`ImportError: cannot import name 'achievements'`。

- [ ] **Step 3: 寫服務** `backend/app/services/achievements.py`

```python
"""個人頁（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈個人頁〉〈API〉）：
三格事蹟數字、獎牌、賣最多的藥局與每月業績。

獎牌只算首頁點過的站（stop_arrival），以前的拜訪不算：示範業務一年拜訪過名下全部 53 家，算進來的話一打開就全部解鎖，
評審看不到解鎖的那一刻。解鎖日期用那份行程的日期（系統日），跟畫面上的「今天」一致，不用真實時間。
"""

import datetime as dt
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AppUser, Customer, Itinerary, SalesTransaction, StopArrival, Visit
from app.services.customer_profile import app_today
from app.timeutil import TAIPEI

# 每一類三級（銅、銀、金）的門檻：跑過幾家藥局、跑過幾個縣市
MEDAL_TIERS = {"stores": (1, 3, 5), "cities": (1, 2, 3)}
# 三格數字與前五名看近一年；每月業績看含這個月的近六個月
YEAR_DAYS = 365
MONTHS = 6
TOP_CUSTOMERS = 5


@dataclass
class Medal:
    kind: str  # stores：跑過的藥局；cities：跑過的縣市
    tier: int  # 1 銅、2 銀、3 金
    need: int
    have: int
    unlocked_on: dt.date | None


@dataclass
class Stats:
    visits_last_year: int
    customers: int
    sales_last_year: float


@dataclass
class TopCustomer:
    customer_id: str
    name: str
    amount: float


@dataclass
class MonthSales:
    month: str  # 2026-05
    amount: float
    through: dt.date | None  # 這個月還沒過完：算到哪天（系統日）；其他月是 None


@dataclass
class Me:
    name: str
    region: str
    stats: Stats
    medals: list[Medal]
    top_customers: list[TopCustomer]
    monthly: list[MonthSales]


def medals(session: Session, rep_id: str) -> list[Medal]:
    """這位業務所有行程裡點過的站：不同的客戶幾家、不同的縣市幾個。第 N 家（第 N 個縣市）第一次點到的那份行程的日期就是解鎖日。"""
    rows = session.execute(
        select(StopArrival.customer_id, Customer.city, StopArrival.first_at, Itinerary.date)
        .join(Customer, Customer.id == StopArrival.customer_id)
        .join(Itinerary, Itinerary.id == StopArrival.itinerary_id)
        .where(Itinerary.user_id == rep_id)
        .order_by(StopArrival.first_at, StopArrival.customer_id)
    ).all()
    store_days: list[dt.date] = []
    city_days: list[dt.date] = []
    stores: set[str] = set()
    cities: set[str] = set()
    for customer_id, city, _, day in rows:
        if customer_id not in stores:
            stores.add(customer_id)
            store_days.append(day)
        if city and city not in cities:
            cities.add(city)
            city_days.append(day)
    return [
        Medal(kind, tier, need, len(days), days[need - 1] if len(days) >= need else None)
        for kind, days in (("stores", store_days), ("cities", city_days))
        for tier, need in enumerate(MEDAL_TIERS[kind], start=1)
    ]


def newly_unlocked(before: list[Medal], after: list[Medal]) -> list[Medal]:
    """點這一站之前還沒解鎖、點了之後解鎖的（首頁跳「解鎖銀牌：跑過 3 家藥局」用）。"""
    was = {(m.kind, m.tier) for m in before if m.unlocked_on}
    return [m for m in after if m.unlocked_on and (m.kind, m.tier) not in was]


def _months(today: dt.date, count: int) -> list[dt.date]:
    """含這個月往前 count 個月的第一天，由舊到新。"""
    starts, year, month = [], today.year, today.month
    for _ in range(count):
        starts.append(dt.date(year, month, 1))
        year, month = (year, month - 1) if month > 1 else (year - 1, 12)
    return starts[::-1]


def build(session: Session, rep: AppUser) -> Me:
    today = app_today(session)
    year_from = today - dt.timedelta(days=YEAR_DAYS)
    owned = Customer.owner_user_id == rep.id

    def sales(*where):
        return (
            select(func.coalesce(func.sum(SalesTransaction.amount), 0))
            .join(Customer, Customer.id == SalesTransaction.customer_id)
            .where(owned, *where)
        )

    in_year = (SalesTransaction.date > year_from, SalesTransaction.date <= today)
    # 拜訪照台北時間的日期算，跟首頁、日曆同一套（timeutil.local_date）
    since = dt.datetime.combine(year_from + dt.timedelta(days=1), dt.time(), TAIPEI)
    until = dt.datetime.combine(today + dt.timedelta(days=1), dt.time(), TAIPEI)
    stats = Stats(
        visits_last_year=session.scalar(
            select(func.count()).select_from(Visit).where(
                Visit.user_id == rep.id, Visit.confirmed_at.is_not(None), Visit.visited_at >= since, Visit.visited_at < until
            )
        ),
        customers=session.scalar(select(func.count()).select_from(Customer).where(owned)),
        sales_last_year=float(session.scalar(sales(*in_year))),
    )
    amount = func.sum(SalesTransaction.amount)
    top = session.execute(
        select(Customer.id, Customer.name, amount)
        .join(SalesTransaction, SalesTransaction.customer_id == Customer.id)
        .where(owned, *in_year)
        .group_by(Customer.id, Customer.name)
        .order_by(amount.desc(), Customer.id)
        .limit(TOP_CUSTOMERS)
    ).all()
    monthly = []
    for start in _months(today, MONTHS):
        end = (start.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
        partial = end > today
        total = session.scalar(sales(SalesTransaction.date >= start, SalesTransaction.date <= min(end, today)))
        monthly.append(MonthSales(f"{start:%Y-%m}", float(total), today if partial else None))
    return Me(
        name=rep.name, region=rep.region, stats=stats, medals=medals(session, rep.id),
        top_customers=[TopCustomer(cid, name, float(total)) for cid, name, total in top], monthly=monthly,
    )
```

- [ ] **Step 4: 個人頁的 API** `backend/app/api/me.py`

```python
"""個人頁（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈個人頁〉）。

是誰的由 token 決定：代理示範業務的帳號看示範業務的；主管與 IT 沒有拜訪路線，也就沒有個人頁。
"""

import dataclasses
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.db import get_session
from app.models import AppUser
from app.services import achievements

router = APIRouter(prefix="/api/me", tags=["me"])
SessionDep = Annotated[Session, Depends(get_session)]
NO_ROUTE = "主管沒有自己的拜訪路線"


class MedalOut(BaseModel):
    kind: Literal["stores", "cities"]
    tier: Literal[1, 2, 3]
    need: int
    have: int
    unlocked_on: date | None


class StatsOut(BaseModel):
    visits_last_year: int
    customers: int
    sales_last_year: float


class TopCustomerOut(BaseModel):
    customer_id: str
    name: str
    amount: float


class MonthOut(BaseModel):
    month: str
    amount: float
    through: date | None


class MeOut(BaseModel):
    name: str
    region: str
    stats: StatsOut
    medals: list[MedalOut]
    top_customers: list[TopCustomerOut]
    monthly: list[MonthOut]


def medal_out(medal: achievements.Medal) -> MedalOut:
    return MedalOut(**dataclasses.asdict(medal))


@router.get("", response_model=MeOut)
def get_me(session: SessionDep, user: CurrentUser):
    """個人頁的全部數字：三格事蹟、六面獎牌、近一年賣最多的五家、近六個月每月業績。"""
    rep = session.get(AppUser, user.acts_as_user_id or user.id)
    if rep is None or rep.role != "sales":
        raise HTTPException(403, NO_ROUTE)
    return MeOut(**dataclasses.asdict(achievements.build(session, rep)))
```

- [ ] **Step 5: 點站的 API** `backend/app/api/itinerary.py`

import 加 `from app.api.me import MedalOut, medal_out` 與 `from app.services import achievements`。`TodayItinerary` 後面加：

```python
class ArriveResult(BaseModel):
    itinerary: TodayItinerary
    # 這次點了才解鎖的獎牌（通常是空的）：首頁跳一行「解鎖銀牌：跑過 3 家藥局」
    unlocked: list[MedalOut]
```

`set_leg` 後面加端點：

```python
@router.post("/today/stops/{customer_id}/arrive", response_model=ArriveResult)
def arrive(session: SessionDep, customer_id: str, user: CurrentUser):
    """首頁點了一站：記成到過，回新的行程與這次解鎖的獎牌。不比版本，點了一定成功。"""
    rep_id = _rep_id(user)
    before = achievements.medals(session, rep_id)
    try:
        itinerary = service.arrive(session, rep_id, customer_id)
    except service.VersionConflict:
        raise HTTPException(409, STALE) from None
    except service.NotOnItinerary:
        raise HTTPException(404, "這家不在今天的路線上") from None
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    unlocked = achievements.newly_unlocked(before, achievements.medals(session, rep_id))
    # 先提交、放掉列鎖再算畫面：算車程可能要等 Google
    session.commit()
    return ArriveResult(itinerary=_out(service.view(session, itinerary)), unlocked=[medal_out(m) for m in unlocked])
```

（`NotOnItinerary` 是 `LookupError` 的子類，一定要排在 `LookupError` 前面。）

- [ ] **Step 6: 掛上 router** `backend/app/main.py`：第 11 行那串 import 不動，另起一行 `from app.api import me  # 個人頁`，`app.include_router(vehicles.router)` 後面加 `app.include_router(me.router)`。

- [ ] **Step 7: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_tapride TEST_REDIS_URL=redis://127.0.0.1:6379/12 uv run --project backend pytest backend/tests/test_achievements.py backend/tests/test_stop_arrivals.py backend/tests/test_itinerary_api.py -q`
Expected: 全部 PASS。

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/achievements.py backend/app/api/me.py backend/app/api/itinerary.py backend/app/main.py backend/tests/test_achievements.py
git commit -m "Count medals from tapped stops and add the arrive and personal page APIs"
```

---

### Task 3: 後端：進門前三分鐘拿掉競品、競品備忘、小卡的 brief

**Files:**
- Modify: `backend/app/models.py:400-420`（`NOTE_KINDS`、`CustomerNote` docstring）
- Modify: `backend/app/services/customer_profile.py`（`MAX_HIGHLIGHTS` 註解與 `build_profile` 的競品那句）
- Modify: `backend/app/services/customer_notes.py`
- Modify: `backend/app/api/notes.py`
- Modify: `data/seed/catalog.py:722-731`（`NOTES`）
- Modify: `backend/tests/test_customer_profile.py:16-36`、`backend/tests/test_seed.py:724-731`
- Test: `backend/tests/test_customer_notes.py`、`backend/tests/test_notes_api.py`（加測試）

**Interfaces:**
- Produces: `models.NOTE_KINDS = ("bring", "told", "competitor")`；`customer_notes.CALENDAR_KINDS = ("bring", "told")`；`GET /api/customers/{customer_id}/brief` 回 `{highlights: string[], notes: NoteOut[]}`（notes 跟 `GET .../notes` 的 `next` 一樣、`kind` 可能是 `competitor`）。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_customer_notes.py` 檔尾加：

```python
def test_competitors_from_a_visit_become_notes(tx):
    v = visit(tx, notes=[{"kind": "bring", "text": "骨營 DM", "date": None}])
    v.fields_final = {**v.fields_final, "competitor": [
        {"name": "御松田", "detail": "這個月加碼上架費"},
        {"name": "康和", "detail": None},
        {"name": "長名", "detail": "很長" * 150},
    ]}
    made = customer_notes.notes_from_visit(tx, v)
    competitors = [(n.text, n.on_date) for n in made if n.kind == "competitor"]
    # 講過的一樣放拜訪日；沒有細節寫「提到」；超過 200 字截掉
    assert competitors[0] == ("御松田：這個月加碼上架費", dt.date(2026, 10, 20))
    assert competitors[1][0] == "提到康和"
    assert len(competitors[2][0]) == 200
    assert [n.kind for n in made][0] == "bring"


def test_the_calendar_leaves_out_competitor_notes(tx):
    hand_written(tx, "御松田降價", kind="competitor", on_date=dt.date(2026, 10, 21))
    hand_written(tx, "小口買 22 送 1", kind="told", on_date=dt.date(2026, 10, 21))
    found = customer_notes.month_notes(tx, "U01", dt.date(2026, 10, 21), dt.date(2026, 10, 21))
    assert [n.text for n, _ in found] == ["小口買 22 送 1"]
```

`backend/tests/test_notes_api.py` 檔尾加（照該檔已有的 client / auth fixture 寫法；如果那個檔的 client 是 `sign_in(TestClient(app), ...)` 就照它）：

```python
def test_the_stop_card_brief_has_highlights_and_notes(client, auth):
    found = client.get("/api/customers/C001/brief", headers=auth())
    assert found.status_code == 200, found.text
    data = found.json()
    assert data["highlights"][0] == "進貨間隔從 21 天拉長到 34 天，單次金額持平"
    assert not any("競品" in h for h in data["highlights"])
    # 示範備忘：C001 有一則競品（catalog.NOTES）
    assert "competitor" in {n["kind"] for n in data["notes"]}


def test_the_brief_is_only_for_the_owner_and_managers(client, auth):
    # C030 是北區另一位業務的客戶（test_customer_profile.py 開頭的註解）
    assert client.get("/api/customers/C030/brief", headers=auth()).status_code == 404
    assert client.get("/api/customers/C030/brief", headers=auth("M01")).status_code == 200
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_tapride TEST_REDIS_URL=redis://127.0.0.1:6379/12 uv run --project backend pytest backend/tests/test_customer_notes.py backend/tests/test_notes_api.py -q`
Expected: FAIL（`CheckConstraint` 擋下 kind 'competitor'、brief 404）。

- [ ] **Step 3: 備忘多一種** `backend/app/models.py`

```python
# 備忘的種類：bring 下次要帶的、told 跟客戶講過的促銷、competitor 業務講到的競品
# （docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md：進門前三分鐘不再寫競品那句）
NOTE_KINDS = ("bring", "told", "competitor")
```

`CustomerNote` 的 docstring 第一句改成「拜訪備忘：下次要帶的東西（bring）、跟客戶講過的促銷（told）與講到的競品（competitor）。」`told_has_date` 約束不用改（原本就是只有要帶的可以沒有日期），旁邊註解改成「講過的、競品一定是某一天講的；要帶的沒講日期就不放上日曆」。

- [ ] **Step 4: 確認拜訪時寫競品、日曆濾掉** `backend/app/services/customer_notes.py`

檔頭常數：

```python
# 確認過的拜訪：回寫成功與否都算，日曆上那天就是有去
CONFIRMED = ("confirmed", "synced")
# 日曆只放要帶的與講過的；競品備忘只在「下次去要記得」與首頁小卡
CALENDAR_KINDS = ("bring", "told")
# 資料表擋在 200 字（customer_note 的 text_length 約束）
TEXT_MAX = 200
```

`notes_from_visit` 在 `for item in fields.get("notes") or []:` 那個迴圈之後、`session.flush()` 之前加：

```python
    # 業務講到的競品記成備忘（進門前三分鐘不再自動寫「提到競品 X」）：有細節寫「名稱：細節」，沒有就「提到名稱」
    for item in fields.get("competitor") or []:
        detail = (item.get("detail") or "").strip()
        text = f"{item['name']}：{detail}" if detail else f"提到{item['name']}"
        note = CustomerNote(
            customer_id=visit.customer_id, user_id=visit.user_id, kind="competitor", text=text[:TEXT_MAX],
            on_date=local_date(visit.visited_at), visit_id=visit.id,
        )
        session.add(note)
        made.append(note)
```

docstring 第一行改成「確認拜訪時把 notes 與 competitor 欄位寫進備忘表。要帶的沒講日期就放追蹤日；講過的與競品放拜訪日。」

`month_notes` 的 `.where(...)` 加 `CustomerNote.kind.in_(CALENDAR_KINDS)`，docstring 加「（競品不放）」。

- [ ] **Step 5: 進門前三分鐘拿掉競品那句** `backend/app/services/customer_profile.py`

`MAX_HIGHLIGHTS` 上面的註解改成：

```python
# 摘要最多五句，進門前幾分鐘看得完。競品不寫成一句（業務講到的競品記成備忘，放在下次去要記得）
```

`build_profile` 裡這一段：

```python
    recent_competitor = next((v for v in visits if local_date(v.visited_at) >= recent_since and (v.fields_final or {}).get("competitor")), None)
    if recent_competitor:
        signals.add("competitor")
        names = "、".join(item["name"] for item in recent_competitor.fields_final["competitor"])
        highlights.append(f"{_md(local_date(recent_competitor.visited_at))} 拜訪提到競品{names}")
```

改成：

```python
    # 近 90 天提到競品：談判卡照樣用它找切入點，但不寫成一句（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md）
    if any(local_date(v.visited_at) >= recent_since and (v.fields_final or {}).get("competitor") for v in visits):
        signals.add("competitor")
```

- [ ] **Step 6: API** `backend/app/api/notes.py`

```python
Kind = Literal["bring", "told"]
# 讀出來的多一種：確認拜訪時寫的競品（手寫只能寫要帶的、講過的）
NoteKind = Literal["bring", "told", "competitor"]
```

`NoteOut.kind` 改成 `NoteKind`。`NextNotes` 後面加：

```python
class Brief(BaseModel):
    """首頁點站彈出的小卡：進門前三分鐘（最多五句）與下次去要記得，一次拿齊。"""

    highlights: list[str]
    notes: list[NoteOut]
```

`next_notes` 端點後面加：

```python
@router.get("/api/customers/{customer_id}/brief", response_model=Brief)
def brief(session: SessionDep, customer_id: str, user: CurrentUser):
    """首頁小卡要的提醒。權限跟客戶檔案一樣（負責人與他的主管），看不到跟不存在一樣回 404。"""
    customer, _ = _load(session, customer_id, user, SHARING_LEVEL["customer_profile"])
    profile = customer_profile.build_profile(session, customer)
    notes = [_out(n, customer.name) for n in customer_notes.next_notes(session, customer.id)]
    return Brief(highlights=profile.highlights, notes=notes)
```

- [ ] **Step 7: 示範資料** `data/seed/catalog.py` 的 `NOTES` 最後加兩則（註解跟著改成「(客戶, 種類, 內容, 日期離展示日幾天；None 是沒有日期)。都是手寫的（沒有 visit_id）……」不變；種類多了競品）：

```python
    # 競品：示範業務今天路線上的忠孝店、林口店。忠孝店 10/19 的拜訪提到御松田（catalog 的情境）
    ("C001", "competitor", "御松田：店長說對方這個月加碼上架費，想換到結帳櫃台旁的陳列位", -9),
    ("C089", "competitor", "提到御松田", -12),
```

- [ ] **Step 8: 改舊測試**

`backend/tests/test_customer_profile.py`：
- `test_profile_shows_the_lengthening_interval_and_open_items` 裡的 `assert "10/19 拜訪提到競品御松田" in profile["highlights"]` 改成 `assert not any("競品" in h for h in profile["highlights"])`，旁邊註解「競品不寫成一句，改記成備忘」。上面說明「10/19 拜訪提到御松田」那句註解留著（`competitors` 還是有御松田）。
- `test_the_complaint_still_makes_the_brief_when_there_are_five_sentences` 改名 `test_the_complaint_makes_the_brief`，註解改成「康泰忠孝店：間隔、上次訂的、過期承諾、客訴」，斷言改成 `assert "客訴：補貨延遲三天（10/19）" in highlights` 與 `assert len(highlights) <= 5`。

`backend/tests/test_seed.py` 的 `test_demo_notes_belong_to_the_demo_rep`：`{kind for kind, _, _ in notes} == {"bring", "told"}` 改成 `== {"bring", "told", "competitor"}`。

- [ ] **Step 9: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_tapride TEST_REDIS_URL=redis://127.0.0.1:6379/12 uv run --project backend pytest backend/tests/test_customer_notes.py backend/tests/test_notes_api.py backend/tests/test_customer_profile.py backend/tests/test_seed.py backend/tests/test_negotiation.py backend/tests/test_visits.py backend/tests/test_today_route.py -q`
Expected: 全部 PASS（談判卡仍靠 `signals` 的 `competitor` 找切入點；首頁需立即處理那張卡讀 highlights 的地方也要過）。

- [ ] **Step 10: Commit**

```bash
git add backend/app/models.py backend/app/services/customer_profile.py backend/app/services/customer_notes.py backend/app/api/notes.py data/seed/catalog.py backend/tests/test_customer_notes.py backend/tests/test_notes_api.py backend/tests/test_customer_profile.py backend/tests/test_seed.py
git commit -m "File competitors as notes instead of a brief sentence and add the stop card brief"
```

---

### Task 4: 前端：資料層

**Files:**
- Modify: `frontend/src/api/route.ts`
- Create: `frontend/src/api/me.ts`
- Modify: `frontend/src/api/notes.ts`
- Modify: `frontend/src/lib/rides.ts`、`frontend/src/lib/rides.test.ts`
- Modify: `frontend/src/lib/ride-memory.ts`、`frontend/src/lib/ride-memory.test.ts`
- Modify: `frontend/src/lib/format.ts`（如果有 `format.test.ts` 就加測試在那裡；沒有就新建）
- Create: `frontend/src/lib/medals.ts`、`frontend/src/lib/medals.test.ts`

**Interfaces:**
- Consumes: Task 1–3 的 API 形狀。
- Produces（後面的 Task 都用這些名字）：
  - `RouteStop.arrived_at: string | null`；`arriveAt(userId, customerId): Promise<{ route: TodayRoute; unlocked: Medal[] }>`
  - `type MedalKind = "stores" | "cities"`；`type Medal = { kind; tier: 1 | 2 | 3; need; have; unlocked_on: string | null }`；`type Me`；`getMe(signal?)`
  - `type NoteKind = "bring" | "told" | "competitor"`；`type WritableNoteKind = "bring" | "told"`；`type Brief = { highlights: string[]; notes: Note[] }`；`getBrief(customerId, signal?)`
  - `anchorId(from: string | null): string`；`hereOf(stops): string | null`；`legBetween(stops, from, to, startCity): Leg`；`lastLeg(stops, startCity): Leg | null`；保留 `RIDE_CITIES`、`SPECIALTY`、`rideCity`、`Leg`、`crossesCity`、`ridesOf`
  - `formatTaipeiTime(iso): string`（"14:05"）；`formatWan(amount, digits = 1): string`（"251.1 萬"）
  - `MEDAL_KIND_LABEL`、`MEDAL_UNIT`、`TIER_NAME`、`medalId(m)`、`medalStatus(m)`、`lockedHint(m)`、`medalBack(m)`、`unlockedText(medals)`、`readSeen(userId)`、`markSeen(userId, medals)`、`freshIds(medals, seen)`、`niceTicks(max)`

- [ ] **Step 1: 寫失敗的測試**

`frontend/src/lib/rides.test.ts`：刪掉 `legInto`、`legKey`、`parkedLeg`、`legToPlay` 的測試（`crossesCity`、`ridesOf`、`rideCity` 的留著，`legInto` 造 Leg 的地方改成直接寫物件），加：

```ts
import { anchorId, hereOf, lastLeg, legBetween } from "@/lib/rides"

// stop() 照這個檔原本的假資料寫法；arrived_at 預設 null
describe("熊熊滾停在哪、騎哪一段", () => {
  const stops = [
    stop("A", "done", { city: "新北市", arrived_at: "2026-10-28T02:00:00Z" }),
    stop("B", "done", { city: "台北市", arrived_at: "2026-10-28T03:00:00Z" }),
    stop("C", "next", { city: "新竹市", travel_mode: "scooter" }),
  ]

  it("anchorId：辦公室是 office", () => {
    expect(anchorId(null)).toBe("office")
    expect(anchorId("B")).toBe("B")
  })

  it("hereOf：最後點的那一站；沒點過是 null", () => {
    expect(hereOf(stops)).toBe("B")
    expect(hereOf([stop("A", "next")])).toBeNull()
  })

  it("legBetween：出發縣市是起點那一站（辦公室用 startCity），交通方式照到的那一站", () => {
    expect(legBetween(stops, "B", "C", "台北市")).toEqual({ from: "B", to: "C", fromCity: "台北市", toCity: "新竹市", mode: "scooter" })
    expect(legBetween(stops, null, "A", "台北市").fromCity).toBe("台北市")
    // 往回騎也可以
    expect(legBetween(stops, "C", "A", null)).toMatchObject({ from: "C", to: "A", fromCity: "新竹市", toCity: "新北市" })
  })

  it("lastLeg：倒數第二個點的（沒有就辦公室）→ 最後點的；沒點過是 null", () => {
    expect(lastLeg(stops, "台北市")).toMatchObject({ from: "A", to: "B" })
    expect(lastLeg([stops[0]], "台北市")).toMatchObject({ from: null, to: "A", fromCity: "台北市" })
    expect(lastLeg([stop("A", "next")], "台北市")).toBeNull()
  })
})
```

`frontend/src/lib/ride-memory.test.ts`：刪掉 `readPlayed`、`markPlayed`、`playedScope`、清舊記錄的測試，佇列的測試留著。

`frontend/src/lib/medals.test.ts`（新）：

```ts
import { afterEach, describe, expect, it, vi } from "vitest"

import type { Medal } from "@/api/me"
import { freshIds, lockedHint, markSeen, medalBack, medalId, medalStatus, niceTicks, readSeen, unlockedText } from "@/lib/medals"

const medal = (kind: Medal["kind"], tier: Medal["tier"], need: number, have: number, unlocked_on: string | null = null): Medal => ({
  kind, tier, need, have, unlocked_on,
})

describe("獎牌的字", () => {
  it("解鎖的寫日期，沒解鎖的寫還差多少", () => {
    expect(medalStatus(medal("stores", 2, 3, 3, "2026-10-28"))).toBe("10/28 解鎖")
    expect(medalStatus(medal("stores", 3, 5, 3))).toBe("還差 2 家")
    expect(medalStatus(medal("cities", 3, 3, 2))).toBe("還差 1 個縣市")
  })

  it("點了沒解鎖的：再跑幾家就拿到哪一級", () => {
    expect(lockedHint(medal("stores", 3, 5, 3))).toBe("再跑 2 家藥局就拿到金牌")
    expect(lockedHint(medal("cities", 2, 2, 1))).toBe("再跑 1 個縣市就拿到銀牌")
  })

  it("背面兩行：解鎖的是門檻與日期，沒解鎖的是差幾個", () => {
    expect(medalBack(medal("stores", 1, 1, 1, "2026-10-28"))).toEqual(["1 家", "10/28"])
    expect(medalBack(medal("cities", 3, 3, 2))).toEqual(["差 1", "還沒解鎖"])
  })

  it("首頁那一句：一面或兩面", () => {
    expect(unlockedText([medal("stores", 2, 3, 3, "2026-10-28")])).toBe("解鎖銀牌：跑過 3 家藥局")
    expect(unlockedText([medal("stores", 3, 5, 5, "2026-10-28"), medal("cities", 3, 3, 3, "2026-10-28")])).toBe(
      "解鎖兩面金牌：跑過 5 家藥局、跑過 3 個縣市"
    )
    // 第一次點站通常是這樣：兩面銅牌
    expect(unlockedText([medal("stores", 1, 1, 1, "2026-10-28"), medal("cities", 1, 1, 1, "2026-10-28")])).toBe(
      "解鎖兩面銅牌：跑過 1 家藥局、跑過 1 個縣市"
    )
    expect(unlockedText([medal("stores", 2, 3, 3, "2026-10-28"), medal("cities", 1, 1, 1, "2026-10-28")])).toBe(
      "解鎖銀牌：跑過 3 家藥局；銅牌：跑過 1 個縣市"
    )
  })
})

describe("新解鎖、這支手機還沒看過的", () => {
  afterEach(() => vi.unstubAllGlobals())

  function fakeStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial))
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    })
    return data
  }

  it("看過的記在 localStorage，鍵含解鎖日期", () => {
    fakeStorage()
    const open = medal("stores", 1, 1, 1, "2026-10-28")
    expect(freshIds([open, medal("stores", 2, 3, 1)], readSeen("U01"))).toEqual([medalId(open)])
    markSeen("U01", [open])
    expect(freshIds([open], readSeen("U01"))).toEqual([])
    // IT 重置後再解鎖（日期一樣也會換一次記錄：鍵含日期，這裡模擬不同日期）
    expect(freshIds([{ ...open, unlocked_on: "2026-10-29" }], readSeen("U01"))).toHaveLength(1)
  })

  it("壞掉的 JSON 或 localStorage 丟例外都當成沒看過，不會壞", () => {
    fakeStorage({ "meddemo:medals-seen:U01": "{壞" })
    expect(readSeen("U01").size).toBe(0)
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
    })
    expect(readSeen("U01").size).toBe(0)
    expect(() => markSeen("U01", [medal("stores", 1, 1, 1, "2026-10-28")])).not.toThrow()
  })
})

describe("niceTicks", () => {
  it("四條格線，最上面一條剛好蓋過最大值，間隔是整數的萬", () => {
    expect(niceTicks(2920623)).toEqual([0, 1000000, 2000000, 3000000])
    expect(niceTicks(450000)).toEqual([0, 200000, 400000, 600000])
    expect(niceTicks(0)).toEqual([0, 100000, 200000, 300000])
  })
})
```

（`format.ts` 的兩個新函式各一行測試：`formatTaipeiTime("2026-10-28T06:05:00Z") === "14:05"`、`formatWan(2511468) === "251.1 萬"`、`formatWan(31337833, 0) === "3,134 萬"`。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm --prefix frontend run test -- src/lib/rides.test.ts src/lib/medals.test.ts src/lib/ride-memory.test.ts`
Expected: FAIL（找不到 `hereOf`、`@/lib/medals`）。

- [ ] **Step 3: `frontend/src/api/route.ts`**

`RouteStop` 在 `city: string` 後面加：

```ts
  // 首頁點過這一站：這份行程裡最後一次點的時間（熊熊滾停在最後點的那一站）；沒點過是 null
  arrived_at: string | null
```

`normalizeRoute` 的 stop 補 `arrived_at: stop.arrived_at ?? null,`。檔頭加 `import type { Medal } from "@/api/me"`，`setLegMode` 後面加：

```ts
/** 首頁點了一站：記成到過（不比版本，點了一定成功），回新的行程與這次解鎖的獎牌 */
export async function arriveAt(userId: string, customerId: string) {
  const result = await request<{ itinerary: TodayRoute; unlocked: Medal[] }>(
    `/api/itinerary/today/stops/${encodeURIComponent(customerId)}/arrive`,
    { method: "POST" }
  )
  const route = normalizeRoute(result.itinerary)
  writeCache(routeKey(userId), route)
  return { route, unlocked: result.unlocked }
}
```

- [ ] **Step 4: `frontend/src/api/me.ts`**

```ts
import { request } from "@/api/client"

// 個人頁（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md）：後端 api/me.py

// stores：跑過的藥局；cities：跑過的縣市。各三級：1 銅、2 銀、3 金
export type MedalKind = "stores" | "cities"

export type Medal = { kind: MedalKind; tier: 1 | 2 | 3; need: number; have: number; unlocked_on: string | null }

export type Me = {
  name: string
  region: string
  stats: { visits_last_year: number; customers: number; sales_last_year: number }
  medals: Medal[]
  // 近一年進貨金額最多的五家
  top_customers: { customer_id: string; name: string; amount: number }[]
  // 含這個月的近六個月；這個月還沒過完時 through 是算到哪天（系統日）
  monthly: { month: string; amount: number; through: string | null }[]
}

export function getMe(signal?: AbortSignal) {
  return request<Me>("/api/me", { signal })
}
```

- [ ] **Step 5: `frontend/src/api/notes.ts`**

```ts
// 拜訪備忘：bring 是下次要帶的東西，told 是跟客戶講過的促銷（docs/superpowers/specs/2026-10-07-calendar-notes-design.md），
// competitor 是確認拜訪時業務講到的競品（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md），不能手寫
export type NoteKind = "bring" | "told" | "competitor"
export type WritableNoteKind = Exclude<NoteKind, "competitor">
```

`createNote`、`updateNote` 參數裡的 `kind: NoteKind` 改成 `WritableNoteKind`。檔尾加：

```ts
// 首頁點站彈出的小卡：進門前三分鐘與下次去要記得，一次拿齊
export type Brief = { highlights: string[]; notes: Note[] }

export function getBrief(customerId: string, signal?: AbortSignal) {
  return request<Brief>(`/api/customers/${encodeURIComponent(customerId)}/brief`, { signal })
}
```

`frontend/src/components/note-dialog.tsx`：`KINDS` 與 `useState<NoteKind>` 改用 `WritableNoteKind`；初始值 `note?.kind === "told" ? "told" : "bring"`（競品備忘不會開這個對話框，見 Task 6）。`frontend/src/lib/calendar.ts` 的 `NOTE_KIND_LABEL` 加 `competitor: "競品"`。

- [ ] **Step 6: `frontend/src/lib/rides.ts`**

刪掉 `legInto`、`legKey`、`firstOpen`、`parkedLeg`、`legToPlay` 與 `import { legFrom } ...`，`Leg` 型別的註解改成「一段路：from 是 null 代表從辦公室出發；fromCity 是出發那一站（或辦公室）的縣市；mode 照到的那一站排好的交通方式」，加：

```ts
/** 路線上可以停熊的點：每一站的圓鈕是客戶編號，辦公室是 office（components/route-path.tsx 的 data-ride-anchor） */
export function anchorId(from: string | null): string {
  return from ?? "office"
}

// 點過的站照點的先後排（arrived_at 由早到晚）
const byArrival = (stops: RouteStop[]) =>
  stops.filter((stop) => stop.arrived_at).sort((a, b) => (a.arrived_at! < b.arrived_at! ? -1 : 1))

/** 熊熊滾停在哪：最後點的那一站；沒點過是 null（辦公室，沒有辦公室起點時第 1 站） */
export function hereOf(stops: RouteStop[]): string | null {
  return byArrival(stops).at(-1)?.customer_id ?? null
}

/** 從 from（null 是辦公室）騎到 to 那一站：往回、跳站都可以。交通方式照原本排好到那一站的 */
export function legBetween(stops: RouteStop[], from: string | null, to: string, startCity: string | null): Leg {
  const target = stops.find((stop) => stop.customer_id === to)
  const origin = from === null ? null : stops.find((stop) => stop.customer_id === from)
  return {
    from,
    to,
    fromCity: from === null ? startCity : (origin?.city ?? null),
    toCity: target?.city ?? "",
    mode: target?.travel_mode ?? "drive",
  }
}

/** 停著的座騎是哪一段（點座騎重播）：倒數第二個點的（沒有就辦公室）→ 最後點的；沒點過是 null */
export function lastLeg(stops: RouteStop[], startCity: string | null): Leg | null {
  const order = byArrival(stops)
  const last = order.at(-1)
  if (!last) return null
  return legBetween(stops, order.at(-2)?.customer_id ?? null, last.customer_id, startCity)
}
```

- [ ] **Step 7: `frontend/src/lib/ride-memory.ts`** 刪掉 `PLAYED_PREFIX`、`PLAYED_KEEP`、`playedKey`、`playedScope`、`readPlayed`、`markPlayed`、`prunePlayed`；檔頭註解改成「還沒送出去的騎乘記錄記在 localStorage。瀏覽器不讓存或存的東西壞了，一律當作空的，不能讓首頁壞掉。」；`write` 的 catch 註解改成「存不進去就算了，頂多少記一台座騎」。

- [ ] **Step 8: `frontend/src/lib/format.ts`** 加：

```ts
/** 2026-10-28T06:05:00Z → 14:05，固定用台北時間；同 formatTaipeiDateTime，自己接時與分，不靠 ICU 的空白 */
export function formatTaipeiTime(iso: string) {
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ""
  return `${part("hour")}:${part("minute")}`
}

/** 2511468 → 251.1 萬；digits 是小數幾位，個人頁「近一年業績」那格用 0（3,134 萬） */
export function formatWan(amount: number, digits = 1) {
  const wan = (amount / 10000).toLocaleString("zh-TW", { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return `${wan} 萬`
}
```

- [ ] **Step 9: `frontend/src/lib/medals.ts`**

```ts
import type { Medal, MedalKind } from "@/api/me"
import { formatDate } from "@/lib/format"

/*
 * 個人頁的獎牌（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈獎牌牆〉）：
 * 兩類各三級，門檻在後端 achievements.MEDAL_TIERS。這裡只管字、看過的記錄與圖表的刻度。
 */

export const MEDAL_KIND_LABEL: Record<MedalKind, string> = { stores: "跑過的藥局", cities: "跑過的縣市" }
export const MEDAL_UNIT: Record<MedalKind, string> = { stores: "家", cities: "個縣市" }
const WHAT: Record<MedalKind, string> = { stores: "家藥局", cities: "個縣市" }
export const TIER_NAME = { 1: "銅牌", 2: "銀牌", 3: "金牌" } as const
const COUNT = ["", "一", "兩", "三", "四", "五", "六"]

export const medalId = (m: Medal) => `${m.kind}${m.tier}`

/** 牌子下面那一行：「10/28 解鎖」或「還差 2 家」 */
export function medalStatus(m: Medal): string {
  return m.unlocked_on ? `${formatDate(m.unlocked_on)} 解鎖` : `還差 ${m.need - m.have} ${MEDAL_UNIT[m.kind]}`
}

/** 點了沒解鎖的那面：「再跑 2 家藥局就拿到金牌」 */
export function lockedHint(m: Medal): string {
  return `再跑 ${m.need - m.have} ${WHAT[m.kind]}就拿到${TIER_NAME[m.tier]}`
}

/** 立體獎牌背面的兩行 */
export function medalBack(m: Medal): [string, string] {
  if (m.unlocked_on) return [`${m.need} ${m.kind === "stores" ? "家" : "縣市"}`, formatDate(m.unlocked_on)]
  return [`差 ${m.need - m.have}`, "還沒解鎖"]
}

const what = (m: Medal) => `跑過 ${m.need} ${WHAT[m.kind]}`

/** 首頁那一句：同一級寫「解鎖兩面金牌：…、…」，不同級逐面寫 */
export function unlockedText(medals: Medal[]): string {
  if (medals.length > 1 && medals.every((m) => m.tier === medals[0].tier))
    return `解鎖${COUNT[medals.length]}面${TIER_NAME[medals[0].tier]}：${medals.map(what).join("、")}`
  return `解鎖${medals.map((m) => `${TIER_NAME[m.tier]}：${what(m)}`).join("；")}`
}

const seenKey = (userId: string) => `meddemo:medals-seen:${userId}`
// 看過的記錄鍵含解鎖日期：IT 重置後再解鎖會再演一次
const seenTag = (m: Medal) => `${medalId(m)}@${m.unlocked_on}`

/** 這支手機看過哪幾面解鎖的；壞掉或不讓讀都當成沒看過 */
export function readSeen(userId: string): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(seenKey(userId)) ?? "[]")
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])
  } catch {
    return new Set()
  }
}

/** 把現在解鎖的都記成看過（只留解鎖的，鍵不會一直長） */
export function markSeen(userId: string, medals: Medal[]) {
  try {
    localStorage.setItem(seenKey(userId), JSON.stringify(medals.filter((m) => m.unlocked_on).map(seenTag)))
  } catch {
    // 存不進去就算了，頂多下次再演一次
  }
}

/** 新解鎖、還沒看過的那幾面（medalId） */
export function freshIds(medals: Medal[], seen: Set<string>): string[] {
  return medals.filter((m) => m.unlocked_on && !seen.has(seenTag(m))).map(medalId)
}

const STEPS = [100000, 200000, 500000, 1000000, 2000000, 5000000, 10000000]

/** 每月業績的格線：0 與三條，間隔取 10／20／50／100… 萬裡最小的、三格蓋得過最大值 */
export function niceTicks(max: number): number[] {
  const step = STEPS.find((s) => s * 3 >= max) ?? STEPS[STEPS.length - 1]
  return [0, step, step * 2, step * 3]
}
```

- [ ] **Step 10: 跑測試、typecheck**

Run: `npm --prefix frontend run test -- src/lib && npm --prefix frontend run typecheck`
Expected: lib 的測試 PASS；typecheck 會報 `route-path.tsx`、`today.tsx`、`ride-on-route.tsx` 用到已刪掉的函式——那是 Task 5、6 的範圍，這一步只確認 `src/lib`、`src/api` 沒有型別錯誤（看錯誤清單裡沒有這兩個資料夾的檔案）。

- [ ] **Step 11: Commit**

```bash
git add frontend/src/api frontend/src/lib frontend/src/components/note-dialog.tsx
git commit -m "Add the arrive and personal page clients and the ride, medal and money helpers"
```

---

### Task 5: 前端：點站就騎（路線、座騎、小卡）

**Files:**
- Modify: `frontend/src/lib/ride-on-route.ts`（`legPoints`）
- Modify: `frontend/src/components/rides/ride-on-route.tsx`
- Modify: `frontend/src/components/route-path.tsx`
- Test: `frontend/src/components/rides/ride-on-route.test.ts`、`frontend/src/components/route-path.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `anchorId`、`hereOf`、`legBetween`、`lastLeg`、`getBrief`、`Brief`、`formatTaipeiTime`。
- Produces: `RoutePath` 的新 props（Task 6 接）：

```ts
{
  stops: RouteStop[]
  dayMode?: TravelMode
  officeStart?: boolean
  startCity?: string | null
  onPickMode?: (from: string | null, to: string, mode: LegMode) => void
  /** 點了一站（熊騎過去或已經停在那裡但還沒記到過）：首頁送 arrive */
  onArrive?: (customerId: string) => void
  /** 送 arrive 失敗的站：小卡寫「沒連上，這一站還沒記到」 */
  unsaved?: ReadonlySet<string>
  /** 開始騎一段（點站、點座騎重播；不能動而直接停好也算）：送騎過的座騎 */
  onRide?: (leg: Leg) => void
  collected?: { ridden: number; total: number } | null
}
```

`autoRide` prop 拿掉。`RideOnRoute` 的新 props：`{ leg: Leg; offset: number; containerWidth: number; play?: number | null; canReplay?: boolean; onRide?: (leg: Leg) => void; onEnd?: () => void }`。

- [ ] **Step 1: 改測試**

`frontend/src/components/rides/ride-on-route.test.ts`：
- `legPoints` 的兩個測試換成下面兩個（`describe("legPoints")` 裡）：

```ts
  it("相鄰往下：起點是上一站停的地方，控制點在膠囊那一列正中間；都以終點（停著的著地點）為原點", () => {
    const node = { left: 151, right: 209, top: 200, bottom: 254 }
    const prevNode = { left: 111, right: 169, top: 60, bottom: 114 }
    const legRow = { top: 150, bottom: 194 }
    const end = { x: 300, y: 250 }
    const points = legPoints({ end, node, legRow, prev: { node: prevNode, offset: -40 }, offset: 0, containerWidth: 358 })
    expect(points.control).toEqual({ x: (140 + 180) / 2 - 300, y: 172 - 250 })
    expect(points.from.y).toBe(114 - 250)
    expect(points.to).toEqual({ x: 0, y: 0 })
  })

  it("往回或跳站（legRow 是 null）：控制點在兩顆圓鈕中心的正中間", () => {
    const node = { left: 151, right: 209, top: 60, bottom: 114 }
    const prevNode = { left: 111, right: 169, top: 400, bottom: 454 }
    const end = { x: 120, y: 110 }
    const points = legPoints({ end, node, legRow: null, prev: { node: prevNode, offset: -40 }, offset: 0, containerWidth: 358 })
    expect(points.control).toEqual({ x: 160 - 120, y: (87 + 427) / 2 - 110 })
    expect(points.from.y).toBe(454 - 110)
  })
```

- `describe("RideOnRoute")`：`render` 的 props 改成 `{ leg, offset, containerWidth: 358 }`（拿掉 `fromOffset`、`autoPlay`）；刪掉「要自動騎這一段時，開始騎之前先藏起來」那個測試；加：

```ts
  it("不能重播時（停在辦公室）沒有「點一下重播」", () => {
    const html = renderToStaticMarkup(createElement(RideOnRoute, { leg, offset: 0, containerWidth: 358, canReplay: false }))
    expect(html).not.toContain("重播")
  })
```

`frontend/src/components/route-path.test.ts`：
- `stop()` 的預設值加 `arrived_at: null`。
- 刪掉「要自動騎到下一站時，停著的座騎先藏起來…」。
- 「熊熊滾騎著到下一站那一段的座騎停在下一站旁邊…」「座騎停在下一站那一列」「改了到下一站那段的交通方式，停著的座騎跟著換」三個改成下面這組（`render` 的 `createElement(RoutePath, ...)` 照原本的方式傳 props）：

```ts
  it("最上面有辦公室圓鈕；沒點過站時熊熊滾停在辦公室，騎的是辦公室到第一站那段，不能重播", () => {
    const html = render([stop("A", "next", { city: "新北市" }), stop("B", "todo")])
    expect(html).toContain('data-ride-anchor="office"')
    const office = html.indexOf('data-ride-anchor="office"')
    const park = html.indexOf("data-ride-park")
    expect(park).toBeGreaterThan(office)
    expect(park).toBeLessThan(html.indexOf('data-ride-anchor="A"'))
    expect(html).toContain('data-city="新北市"')
    expect(html).not.toContain("重播")
  })

  it("點過的站：熊熊滾停在最後點的那一站，點了重播上一段", () => {
    const html = render([
      stop("A", "done", { arrived_at: "2026-10-28T02:00:00Z" }),
      stop("B", "done", { arrived_at: "2026-10-28T03:00:00Z", city: "新竹市", travel_mode: "scooter" }),
      stop("C", "next"),
    ])
    const park = html.indexOf("data-ride-park")
    expect(park).toBeGreaterThan(html.indexOf('data-ride-anchor="B"'))
    expect(park).toBeLessThan(html.indexOf('data-ride-anchor="C"'))
    expect(html).toContain('data-city="新竹市"')
    expect(html).toContain('data-mode="scooter"')
    expect(html).toContain("重播")
  })

  it("沒有辦公室起點：沒有辦公室圓鈕，熊熊滾停在第一站", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(RoutePath, { stops: [stop("A", "next"), stop("B", "todo")], officeStart: false }))
    )
    expect(html).not.toContain('data-ride-anchor="office"')
    expect(html.indexOf("data-ride-park")).toBeGreaterThan(html.indexOf('data-ride-anchor="A"'))
  })

  it("到過的站標籤寫到過的時間（台北時間）", () => {
    const html = render([stop("A", "done", { arrived_at: "2026-10-28T02:05:00Z" }), stop("B", "next")])
    expect(html).toContain("10:05 到過")
  })
```

- 「全部跑完時終點寫跑完幾站，熊熊滾跳起來，不騎座騎」保留（全部 `done`、沒有 `arrived_at` 時照舊沒有 `data-ride-park`）。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm --prefix frontend run test -- src/components/rides/ride-on-route.test.ts src/components/route-path.test.ts`
Expected: FAIL。

- [ ] **Step 3: `legPoints` 量任兩站** `frontend/src/lib/ride-on-route.ts`

整個 `legPoints`（含 docstring）換成：

```ts
/**
 * 從畫面上量到的位置算這一段怎麼走。end 是停著的座騎的著地點，node 是這一站的圓鈕，
 * prev 是熊原本停的那一站（或辦公室）的圓鈕與它離中線多少。起點是熊原本停的地方。
 * 相鄰往下（legRow 是兩站之間放膠囊的那一列）照蛇行的彎度，控制點在膠囊那一列正中間；
 * 往回或跳站（legRow 是 null）從起點直接彎到終點，控制點在兩顆圓鈕中心的正中間。
 */
export function legPoints({
  end,
  node,
  legRow,
  prev,
  offset,
  containerWidth,
}: {
  end: Point
  node: Box
  legRow: Pick<Box, "top" | "bottom"> | null
  prev: { node: Box; offset: number }
  offset: number
  containerWidth: number
}): LegPoints {
  const at = (x: number, y: number): Point => ({ x: x - end.x, y: y - end.y })
  const nodeX = (node.left + node.right) / 2
  const prevX = (prev.node.left + prev.node.right) / 2
  const middleY = legRow
    ? (legRow.top + legRow.bottom) / 2
    : (prev.node.top + prev.node.bottom + node.top + node.bottom) / 4
  return {
    from: at(prevX + parkCenterX(prev.offset, containerWidth), prev.node.bottom),
    control: at((prevX + nodeX) / 2, middleY),
    to: at(end.x, end.y),
    scale: parkWidth(prev.offset, containerWidth) / parkWidth(offset, containerWidth),
  }
}
```

（檔頭說明裡「從上一站騎過來那一段」改成「從熊原本停的那一站騎過來那一段」。）

- [ ] **Step 4: `RideOnRoute` 點了才騎** `frontend/src/components/rides/ride-on-route.tsx`

4a. import：拿掉 `ink`、`useEffect`；`@/lib/rides` 改成 `import { anchorId, crossesCity, rideCity, SPECIALTY, type Leg } from "@/lib/rides"`。刪掉 `SETTLE_MS`。

4b. `measure` 換成：

```ts
/**
 * 量這一段在畫面上怎麼走。靠 components/route-path.tsx 的結構：按鈕放在熊停的那一列（relative）裡，那一列有一顆
 * data-ride-anchor 的圓鈕；出發的那一站在同一條路線（<ol>）裡用 data-ride-anchor 找，離中線多少寫在它的 data-offset。
 * 出發那一站就在上一個 <li> 裡（相鄰往下）時，經過這一列前面放膠囊的那一列。量不到（還沒排版、被藏起來）回 null，不騎。
 */
function measure(button: HTMLElement, offset: number, leg: Leg, containerWidth: number): LegPoints | null {
  const row = button.parentElement
  const node = row?.querySelector("[data-ride-anchor]")
  const prevNode = button.closest("ol")?.querySelector(`[data-ride-anchor="${anchorId(leg.from)}"]`)
  if (!row || !node || !(prevNode instanceof HTMLElement)) return null
  const adjacent = row.closest("li")?.previousElementSibling?.contains(prevNode) ?? false
  const legRow = adjacent ? row.previousElementSibling : null
  const box = button.getBoundingClientRect()
  const nodeBox = node.getBoundingClientRect()
  const prevBox = prevNode.getBoundingClientRect()
  const legBox = legRow?.getBoundingClientRect() ?? null
  if ([box, nodeBox, prevBox, legBox].some((rect) => rect && (rect.width === 0 || rect.height === 0))) return null
  return legPoints({
    end: { x: box.left + box.width / 2, y: box.top + box.height * GROUND },
    node: nodeBox,
    legRow: legBox,
    prev: { node: prevBox, offset: Number(prevNode.dataset.offset ?? 0) },
    offset,
    containerWidth,
  })
}
```

4c. 元件的 docstring 與 props 換成：

```ts
/**
 * 熊熊滾騎著座騎（目的地縣市 × 那一段的交通方式）停在熊現在那一站（或辦公室）的圓鈕旁邊：沒有名字的那一側、面向圓鈕、
 * 離圓鈕 10px，地面線對齊圓鈕底邊，慢慢上下浮。放在那一列（relative）裡，offset 是那顆圓鈕離中線多少 px，
 * containerWidth 是整條路線的寬。
 *
 * 點站就騎（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈首頁〉）：首頁點了一站，熊換到那一列、
 * play 換一個新的值，畫出來之前就從原本停的那一站（leg.from）騎過來；點停著的座騎重播這一段（canReplay 時）。
 * 同一時間只播一段，播的時候再點不理。動的就是停著的這顆按鈕本身（Web Animations API，transform-origin 是著地點），
 * 播完回到原位，不會有兩隻熊；騎到一半熊換到別站，這一顆拆掉、動畫取消，新的那一顆從這一站騎出去。
 * 左右翻做在包住座騎的那一層、跨縣市換車是兩台疊著換 opacity，都不碰座騎的 SVG。
 * 一開始騎就呼叫 onRide（送騎過的座騎），騎完（或減少動態效果、量不到位置而直接停好）呼叫 onEnd。
 */
export function RideOnRoute({
  leg,
  offset,
  containerWidth,
  play = null,
  canReplay = true,
  onRide,
  onEnd,
}: {
  leg: Leg
  offset: number
  containerWidth: number
  /** 換一個新的值就騎一次這一段（首頁點站時給；null 是停著） */
  play?: number | null
  /** 停在辦公室時沒有「上一段」可以重播 */
  canReplay?: boolean
  onRide?: (leg: Leg) => void
  onEnd?: () => void
}) {
```

4d. 元件內：刪掉 `key`、`started`、`waiting`、`autoBegin` 與整個自動播的 `useEffect`。`begin` 換成：

```ts
  function begin() {
    if (playing.current) return
    onRide?.(leg)
    const button = buttonRef.current
    if (!button || reducedMotion()) return onEnd?.()
    const points = measure(button, offset, leg, containerWidth)
    if (!points) return onEnd?.()
    playing.current = true
    setRiding({ ...points, turn: shouldFlip(points.from, points.to) !== flipped, cross: crossesCity(leg) })
  }

  // 首頁點了站：畫出來之前就開始騎（layout effect），不會先在終點閃一下
  const playNow = useEffectEvent(() => begin())
  useLayoutEffect(() => {
    if (play !== null) playNow()
  }, [play])
```

播完的 `animations[0].finished.then(() => { playing.current = false; setRiding(null) }, ...)` 改成 `() => { playing.current = false; setRiding(null); onEnd?.() }`（`onEnd` 用 `useEffectEvent` 包一個 `const ended = useEffectEvent(() => onEnd?.())` 在 then 裡叫 `ended()`，免得 effect 的依賴多一個）。

4e. 按鈕：`aria-label={canReplay ? \`${label}，點一下重播這一段\` : label}`、`onClick={canReplay ? begin : undefined}`；刪掉 `aria-hidden={waiting || undefined}`、`tabIndex={waiting ? -1 : undefined}` 與 className 裡 `waiting && "motion-safe:pointer-events-none motion-safe:opacity-0"`。`label` 那行的「熊熊滾正走去下一站」改成「熊熊滾走過去」。

- [ ] **Step 5: `RoutePath`** `frontend/src/components/route-path.tsx`

5a. import：`Building2` 加進 lucide 那行；`getNextNotes, type Note` 換成 `getBrief, type Brief`；`parkedLeg, type Leg` 換成 `hereOf, lastLeg, legBetween, type Leg`；加 `import { formatTaipeiTime } from "@/lib/format"`。

5b. 元件開頭的 docstring 換掉「熊熊滾騎著『到下一站那一段』…autoRide…」那兩句，改成：「點圓鈕：熊熊滾從停的那一站（或最上面的辦公室）騎到點的那一站，同時在底下彈出小卡（為什麼排這家、進門前三分鐘、下次去要記得），首頁送 arrive 記成到過（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md）。」props 換成 Task 的 Interfaces 那組。

5c. 元件內，`const parked = parkedLeg(...)` 那行換成：

```tsx
  // 熊熊滾在哪：最後點的那一站。點了馬上換，不等後端；後端的「最後點的」變了（別人點的、重新載入、IT 重置）就跟著換、不騎
  const serverHere = hereOf(stops)
  const [here, setHere] = useState(serverHere)
  const [seenHere, setSeenHere] = useState(serverHere)
  if (serverHere !== seenHere) {
    setSeenHere(serverHere)
    setHere(serverHere)
  }
  const onRoute = (id: string | null) => id !== null && stops.some((stop) => stop.customer_id === id)
  // 熊停的那一顆圓鈕：點過的站；沒點過是辦公室（null），沒有辦公室起點時是第 1 站
  const anchor = onRoute(here) ? here : officeStart ? null : (stops[0]?.customer_id ?? null)
  // 正在騎的那一段（點站時給）；token 換了 RideOnRoute 就騎一次
  const [ride, setRide] = useState<{ leg: Leg; token: number } | null>(null)
  const [riding, setRiding] = useState(false)
  // 停著的座騎：剛騎的那一段、最後點的那一段，或沒點過時辦公室到第一站那段（不能重播）
  const replay = ride?.leg.to === anchor ? ride.leg : here && anchor === here ? lastLeg(stops, startCity) : null
  const parked = replay ?? (stops[0] ? legBetween(stops, null, stops[0].customer_id, startCity) : null)
  // 全部到過：最後一段騎完，座騎淡出，熊熊滾在收工旗子旁跳
  const showParked = parked !== null && (!finished || riding)

  function tapStop(stop: RouteStop) {
    const isOpen = opened?.kind === "stop" && opened.id === stop.customer_id
    setOpened(isOpen ? null : { kind: "stop", id: stop.customer_id })
    if (isOpen) return
    if (stop.customer_id !== anchor) {
      setRide({ leg: legBetween(stops, anchor, stop.customer_id, startCity), token: Date.now() })
      setRiding(true)
      setHere(stop.customer_id)
    }
    if (stop.customer_id !== anchor || !stop.arrived_at) onArrive?.(stop.customer_id)
  }

  const bear = (offset: number) =>
    parked && (
      <RideOnRoute
        key={anchor ?? "office"}
        leg={parked}
        offset={offset}
        containerWidth={width}
        play={ride && ride.leg.to === anchor ? ride.token : null}
        canReplay={replay !== null}
        onRide={onRide}
        onEnd={() => setRiding(false)}
      />
    )
```

5d. `<ol>` 第一個子元素（在 `stops.map` 前）加辦公室那一列：

```tsx
      {officeStart && stops.length > 0 && (
        <li>
          <div className="relative h-[60px]">
            <OfficeNode />
            {showParked && anchor === null && bear(0)}
          </div>
        </li>
      )}
```

5e. 每一站那一列：`<StopNode ... onToggle={() => toggle("stop", stop.customer_id)} />` 改成 `onToggle={() => tapStop(stop)}`；`{parked?.to === stop.customer_id && (<RideOnRoute ... />)}` 換成 `{showParked && anchor === stop.customer_id && bear(offset)}`；`<StopPopover stop={stop} index={index} offset={offset} />` 加 `unsaved={unsaved?.has(stop.customer_id) ?? false}`。收工那一格的 `{finished && <FinishBear />}` 改成 `{finished && !riding && <FinishBear />}`。

5f. `StopNode` 的按鈕加 `data-ride-anchor={stop.customer_id}` 與 `data-offset={offset}`（`aria-label` 的狀態字照舊）。

5g. 新元件（放在 `StopNode` 前面）：

```tsx
/** 路線最上面的辦公室：熊熊滾今天還沒點過站時停在這裡，從這裡騎出去 */
function OfficeNode() {
  return (
    <>
      <span
        data-ride-anchor="office"
        data-offset={0}
        aria-hidden
        className="absolute top-0 flex h-[54px] w-[58px] items-center justify-center rounded-[50%] bg-primary text-primary-foreground shadow-lip-node"
        style={{ left: `calc(50% - ${HALF_NODE}px)` }}
      >
        <Building2 className="size-6" />
      </span>
      <p
        className="absolute top-3 text-[0.8125rem] font-semibold"
        style={{ left: `calc(50% + ${HALF_NODE + LABEL_GAP}px)` }}
      >
        辦公室
      </p>
    </>
  )
}
```

（辦公室在中線、熊停左邊，字放右邊，跟 `labelSide(0)` 一致；截圖時確認熊與字不打架，打架就把字改放左邊。）

5h. `StopLabel` 跑完那一行換成：

```tsx
        {done ? (
          stop.visit_id || !stop.arrived_at ? (
            `${stop.planned_time} 完成${stop.visit_id ? " · 已回寫" : ""}`
          ) : (
            `${formatTaipeiTime(stop.arrived_at)} 到過`
          )
        ) : stop.window_kind && stop.late_minutes > 0 ? (
          // 有約的時間又趕不上：時間與理由讓位給這一句
          <span className="font-semibold text-destructive">會晚到 {stop.late_minutes} 分</span>
        ) : (
          <>
            {stop.planned_time} · <SignalLabel signal={stop.signal} />
          </>
        )}
```

5i. 小卡：`StopPopover` 簽名加 `unsaved: boolean`；第二行 `{done && \` · 已完成${...}\`}` 改成 `{done && (stop.arrived_at && !stop.visit_id ? " · 已到過" : \` · 已完成${stop.visit_id ? " · 已回寫" : ""}\`)}`；`<StopNotes customerId={stop.customer_id} />` 換成 `<StopBrief customerId={stop.customer_id} />`；`<Link ...>` 前面加：

```tsx
      {unsaved && <p className="mt-3 text-xs font-semibold text-destructive">沒連上，這一站還沒記到</p>}
```

連結的字一律「開啟拜訪準備」（到過、跑完的也是）。`StopNotes` 換成：

```tsx
/**
 * 小卡打開時才去拿這家的提醒：進門前三分鐘（最多五句）與下次去要記得（最多三則，要帶的在前）。
 * 回來之前是灰色佔位條；拿不到就不顯示這兩區，不影響小卡其他內容。
 */
function StopBrief({ customerId }: { customerId: string }) {
  const [brief, setBrief] = useState<Brief | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    getBrief(customerId, controller.signal)
      .then(setBrief)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [customerId])
  if (failed) return null
  if (!brief)
    return (
      <div aria-hidden className="mt-3 flex flex-col gap-2">
        <span className="h-3 w-4/5 rounded bg-muted" />
        <span className="h-3 w-3/5 rounded bg-muted" />
      </div>
    )
  return (
    <>
      {brief.highlights.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-primary">進門前三分鐘</p>
          <ul className="mt-1 flex flex-col gap-1 text-sm leading-snug">
            {brief.highlights.map((line) => (
              <li key={line} className="flex gap-1.5">
                <span aria-hidden className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-primary" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
      {brief.notes.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-muted-foreground">下次去要記得</p>
          <ul className="mt-1 flex flex-col gap-1.5">
            {brief.notes.slice(0, STOP_NOTES_SHOWN).map((note) => (
              <li key={note.id}>
                <NoteRow note={note} showDate={false} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
```

（`StopNotes` 原本若有「下次去要記得」以外的標題或樣式，照它的樣式調整上面這段，讓小卡跟現在看起來一致。）

- [ ] **Step 6: 跑測試、typecheck、lint**

Run: `npm --prefix frontend run test -- src/components && npm --prefix frontend run lint`
Expected: PASS（typecheck 只剩 `today.tsx`，Task 6 處理）。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/ride-on-route.ts frontend/src/components/rides/ride-on-route.tsx frontend/src/components/route-path.tsx frontend/src/components/rides/ride-on-route.test.ts frontend/src/components/route-path.test.ts
git commit -m "Ride the bear to whichever stop is tapped and show the brief on the stop card"
```

---

### Task 6: 前端：首頁接上點站、解鎖提示、競品備忘

**Files:**
- Modify: `frontend/src/pages/today.tsx`
- Create: `frontend/src/components/route/unlock-toast.tsx`
- Modify: `frontend/src/components/note-row.tsx`、`frontend/src/components/next-notes.tsx`
- Test: `frontend/src/components/route/unlock-toast.test.ts`（新）、`frontend/src/components/note-row.test.ts`（新，或加在既有的備忘測試）

**Interfaces:**
- Consumes: Task 4 的 `arriveAt`、`unlockedText`、`Medal`；Task 5 的 `RoutePath` props。
- Produces: `UnlockToast({ medals, onDone })`。

- [ ] **Step 1: 寫失敗的測試**

`frontend/src/components/route/unlock-toast.test.ts`：

```ts
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import { UnlockToast } from "@/components/route/unlock-toast"

describe("UnlockToast", () => {
  it("寫解鎖了哪一面，點了進個人頁", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(UnlockToast, {
        medals: [{ kind: "stores", tier: 2, need: 3, have: 3, unlocked_on: "2026-10-28" }],
        onDone: () => {},
      }))
    )
    expect(html).toContain("解鎖銀牌：跑過 3 家藥局")
    expect(html).toContain('href="/me"')
    expect(html).toContain('role="status"')
  })
})
```

`frontend/src/components/note-row.test.ts`：

```ts
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { NoteRow } from "@/components/note-row"

describe("NoteRow", () => {
  it("競品備忘標「競品」", () => {
    const html = renderToStaticMarkup(
      createElement(NoteRow, { note: { kind: "competitor", text: "提到御松田", on_date: "2026-10-19", customer_name: "忠孝店" } })
    )
    expect(html).toContain('aria-label="競品"')
    expect(html).toContain("提到御松田")
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm --prefix frontend run test -- src/components/route/unlock-toast.test.ts src/components/note-row.test.ts`
Expected: FAIL。

- [ ] **Step 3: 解鎖提示** `frontend/src/components/route/unlock-toast.tsx`

```tsx
import { useEffect, useEffectEvent } from "react"
import { ChevronRight, Medal as MedalIcon } from "lucide-react"
import { Link } from "react-router"

import type { Medal } from "@/api/me"
import { unlockedText } from "@/lib/medals"

// 停幾秒自己收起來
const SHOW_MS = 4000

/** 首頁點站剛好解鎖獎牌時，底部跳一行「解鎖銀牌：跑過 3 家藥局」，點了進個人頁看那一面轉起來 */
export function UnlockToast({ medals, onDone }: { medals: Medal[]; onDone: () => void }) {
  const done = useEffectEvent(onDone)
  useEffect(() => {
    const timer = window.setTimeout(() => done(), SHOW_MS)
    return () => window.clearTimeout(timer)
  }, [medals])
  return (
    <Link
      to="/me"
      role="status"
      className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-20 flex min-h-12 items-center gap-3 rounded-2xl border-2 bg-card px-4 py-3 shadow-lip press animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
    >
      <MedalIcon aria-hidden className="size-6 shrink-0 text-amber-500" />
      <span className="flex-1 text-sm font-semibold">{unlockedText(medals)}</span>
      <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
    </Link>
  )
}
```

（截圖確認它在底部分頁上面、不壓到熊熊滾問答的輸入列；壓到就調 `bottom`。）

- [ ] **Step 4: 首頁** `frontend/src/pages/today.tsx`

- import：拿掉 `markPlayed, playedScope, readPlayed`（整行 `@/lib/ride-memory`）與 `legKey, legToPlay`；`@/lib/rides` 只留 `ridesOf, type Leg`；`@/api/route` 加 `arriveAt`；加 `import type { Medal } from "@/api/me"` 與 `import { UnlockToast } from "@/components/route/unlock-toast"`。
- 刪掉 `played` 的 state、`getTodayRoute(...).then` 裡設 `played` 的兩行、`autoRide` 整段與它的註解。
- 加 state：

```tsx
  // 送 arrive 失敗的站：小卡寫「沒連上，這一站還沒記到」，下次點成功就拿掉
  const [unsaved, setUnsaved] = useState<ReadonlySet<string>>(new Set())
  // 這次點站解鎖的獎牌：底部跳一行，點了進個人頁
  const [unlocked, setUnlocked] = useState<Medal[]>([])
```

- `recordRide` 換成：

```tsx
  // 開始騎一段（點站、點座騎重播；減少動態效果或量不到位置而直接停好也算）：送出騎過的座騎（每騎一次送一次）
  function recordRide(leg: Leg) {
    // 送完（含補送先前存起來的）重拿一次圖鑑的數字
    void sendRides(ridesOf(leg)).then(() => setCollectedTick((n) => n + 1))
  }

  // 點了一站：後端記成到過，回新的行程與這次解鎖的獎牌。熊已經在騎了，不等它
  async function arrive(customerId: string) {
    if (!user) return
    try {
      const { route: next, unlocked: fresh } = await arriveAt(user.id, customerId)
      setState({ status: "ready", route: next, cached: false })
      setUnsaved((now) => new Set([...now].filter((id) => id !== customerId)))
      if (fresh.length > 0) setUnlocked(fresh)
    } catch (error) {
      // 這家剛被別人從路線拿掉（404）、行程剛被重置（409）：重新載入最新的
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        reload()
        return
      }
      setUnsaved((now) => new Set([...now, customerId]))
    }
  }
```

- `<RoutePath ...>`：拿掉 `autoRide={autoRide}`，加 `onArrive={arrive}`、`unsaved={unsaved}`。
- `<BottomNav />` 前面加 `{unlocked.length > 0 && <UnlockToast medals={unlocked} onDone={() => setUnlocked([])} />}`。

- [ ] **Step 5: 競品備忘的樣子**

`frontend/src/components/note-row.tsx`：

```tsx
import { MessageSquareQuote, Package, Swords } from "lucide-react"
...
// 要帶的是箱子、講過的是引號、競品是交叉的劍
const ICON = { bring: Package, told: MessageSquareQuote, competitor: Swords } as const
const TONE = { bring: "text-primary", told: "text-amber-600 dark:text-amber-400", competitor: "text-destructive" } as const
```

元件裡 `const Icon = note.kind === "bring" ? Package : MessageSquareQuote` 改成 `const Icon = ICON[note.kind]`，className 的顏色改成 `TONE[note.kind]`；docstring 改成「一則備忘：要帶的是箱子、講過的是引號、競品是劍，後面是內容與日期」。

`frontend/src/components/next-notes.tsx`：列每一則的地方，`note.kind === "competitor"` 的不包成可點的按鈕（不開編輯對話框，手寫只能寫要帶的、講過的），直接放 `<NoteRow note={note} />`，外層留同樣的間距；旁邊註解「競品是確認拜訪時記的，不在這裡改」。

- [ ] **Step 6: 跑全部前端檢查**

Run: `npm --prefix frontend run test && npm --prefix frontend run typecheck && npm --prefix frontend run lint`
Expected: 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/today.tsx frontend/src/components/route/unlock-toast.tsx frontend/src/components/route/unlock-toast.test.ts frontend/src/components/note-row.tsx frontend/src/components/note-row.test.ts frontend/src/components/next-notes.tsx
git commit -m "Send arrivals from the home page, announce unlocked medals and show competitor notes"
```

---

### Task 7: 前端：個人頁（事蹟、立體獎牌牆、圖表）

**Files:**
- Modify: `frontend/package.json`（`three`、`@types/three`）
- Create: `frontend/src/components/me/flat-medal.tsx`
- Create: `frontend/src/components/me/medal-scene.ts`
- Create: `frontend/src/components/me/medal-wall.tsx`
- Create: `frontend/src/components/me/sales-charts.tsx`
- Create: `frontend/src/pages/me.tsx`
- Modify: `frontend/src/App.tsx`（`/me`）
- Modify: `frontend/src/pages/today.tsx`（名字連到 `/me`）
- Test: `frontend/src/components/me/medal-wall.test.ts`、`frontend/src/components/me/sales-charts.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `getMe`、`Me`、`Medal`、`medals.ts` 全部、`formatWan`。
- Produces: `MePage`；`MedalWall({ medals, userId })`；`FlatMedal({ medal })`；`createMedalScene(options): MedalScene`；`TopCustomers({ items })`、`MonthlySales({ months })`。

- [ ] **Step 1: 裝 three**

Run: `npm --prefix frontend install three && npm --prefix frontend install -D @types/three`
Expected: `package.json` 的 dependencies 多 `three`、devDependencies 多 `@types/three`（兩個的 minor 版本要一樣，不一樣就把 `@types/three` 裝成跟 `three` 同一個 minor），`package-lock.json` 跟著變。

- [ ] **Step 2: 寫失敗的測試**

`frontend/src/components/me/medal-wall.test.ts`：

```ts
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { Medal } from "@/api/me"
import { FlatMedal } from "@/components/me/flat-medal"
import { MedalWall } from "@/components/me/medal-wall"

const medals: Medal[] = [
  { kind: "stores", tier: 1, need: 1, have: 3, unlocked_on: "2026-10-28" },
  { kind: "stores", tier: 2, need: 3, have: 3, unlocked_on: "2026-10-28" },
  { kind: "stores", tier: 3, need: 5, have: 3, unlocked_on: null },
  { kind: "cities", tier: 1, need: 1, have: 2, unlocked_on: "2026-10-28" },
  { kind: "cities", tier: 2, need: 2, have: 2, unlocked_on: "2026-10-28" },
  { kind: "cities", tier: 3, need: 3, have: 2, unlocked_on: null },
]

describe("MedalWall", () => {
  const html = renderToStaticMarkup(createElement(MedalWall, { medals, userId: "U01" }))

  it("兩列各三面，右上角寫解鎖幾面", () => {
    expect(html).toContain("跑過的藥局 · 3 家")
    expect(html).toContain("跑過的縣市 · 2 個縣市")
    expect(html).toContain("4 / 6")
    expect(html.match(/data-medal-id=/g)).toHaveLength(6)
  })

  it("每面下面寫門檻與狀態", () => {
    expect(html).toContain("5 家")
    expect(html).toContain("還差 2 家")
    expect(html).toContain("10/28 解鎖")
    expect(html).toContain("還差 1 個縣市")
  })

  it("3D 載好之前先畫平塗的獎牌（跑不動 WebGL 時就一直是它）", () => {
    expect(html.match(/data-flat-medal/g)).toHaveLength(6)
  })
})

describe("FlatMedal", () => {
  it("解鎖的有那一級的顏色與圖示，沒解鎖的是灰色加鎖", () => {
    const gold = renderToStaticMarkup(createElement(FlatMedal, { medal: { ...medals[2], have: 5, unlocked_on: "2026-10-28" } }))
    expect(gold).toContain("#FFC93C")
    const locked = renderToStaticMarkup(createElement(FlatMedal, { medal: medals[2] }))
    expect(locked).not.toContain("#FFC93C")
    expect(locked).toContain("data-lock")
  })
})
```

`frontend/src/components/me/sales-charts.test.ts`：

```ts
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { MonthlySales, TopCustomers } from "@/components/me/sales-charts"

describe("TopCustomers", () => {
  it("五列，長條照第一名的比例，數字寫萬", () => {
    const html = renderToStaticMarkup(
      createElement(TopCustomers, {
        items: [
          { customer_id: "C1", name: "康泰連鎖藥局 · 內湖店", amount: 2511468 },
          { customer_id: "C2", name: "康泰連鎖藥局 · 忠孝店", amount: 1255734 },
        ],
      })
    )
    expect(html).toContain("康泰連鎖藥局 · 內湖店")
    expect(html).toContain("251.1 萬")
    expect(html).toContain("--w:100%")
    expect(html).toContain("--w:50%")
  })
})

describe("MonthlySales", () => {
  const months = [
    { month: "2026-05", amount: 2920623, through: null },
    { month: "2026-06", amount: 2788825, through: null },
    { month: "2026-10", amount: 1865839, through: "2026-10-28" },
  ]
  const html = renderToStaticMarkup(createElement(MonthlySales, { months }))

  it("月份在下面，只標最高的那個月與這個月的數字", () => {
    expect(html).toContain("5 月")
    expect(html).toContain("292.1")
    expect(html).toContain("186.6")
    expect(html).not.toContain("278.9")
  })

  it("這個月畫淡色並註明算到哪天", () => {
    expect(html).toContain("10 月只算到 10/28")
    expect(html).toContain("data-partial")
  })
})
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `npm --prefix frontend run test -- src/components/me`
Expected: FAIL（找不到模組）。

- [ ] **Step 4: 平塗獎牌** `frontend/src/components/me/flat-medal.tsx`

```tsx
import type { Medal, MedalKind } from "@/api/me"

// 獎牌的顏色（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈獎牌牆〉）：外圈、面、內圈、圖示。
// 立體的（medal-scene.ts）用同一組，3D 載不起來時退回的平塗獎牌看起來才是同一面
export const TIER_COLORS = {
  1: { rim: "#A0622D", face: "#CD8A4B", inner: "#E7B07C", icon: "#6B3E17", metal: 0xb87333 },
  2: { rim: "#8E95A3", face: "#BCC2CC", inner: "#DDE1E7", icon: "#4B5260", metal: 0xc4cad3 },
  3: { rim: "#E0A100", face: "#FFC93C", inner: "#FFE08A", icon: "#8A5A00", metal: 0xe0a100 },
} as const
export const LOCKED_COLORS = { rim: "#B9B4C4", face: "#CFCBD8", inner: "#DEDBE5", icon: "#8E889C" } as const

// lucide 的 cross（藥局）與 map-pin（縣市），24×24；縣市的中間挖空用 evenodd
export const MEDAL_ICON: Record<MedalKind, string> = {
  stores:
    "M4 9a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h4a1 1 0 0 1 1 1v4a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-4a1 1 0 0 1 1-1h4a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-4a1 1 0 0 1-1-1V4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4a1 1 0 0 1-1 1z",
  cities:
    "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0Z M15 10a3 3 0 1 0-6 0a3 3 0 1 0 6 0Z",
}
export const LOCK_SHACKLE = "M7 11V7a5 5 0 0 1 10 0v4"

/** 平塗的獎牌：3D 載好之前、或跑不動 WebGL 時放在每一格 */
export function FlatMedal({ medal }: { medal: Medal }) {
  const open = medal.unlocked_on !== null
  const c = open ? TIER_COLORS[medal.tier] : LOCKED_COLORS
  return (
    <svg data-flat-medal viewBox="0 0 100 100" aria-hidden className="size-full">
      <circle cx="50" cy="50" r="46" fill={c.rim} />
      <circle cx="50" cy="50" r="39" fill={c.face} />
      <circle cx="50" cy="50" r="31" fill={c.inner} />
      {open ? (
        <g transform="translate(50 50) scale(1.55) translate(-12 -12)">
          <path d={MEDAL_ICON[medal.kind]} fill={c.icon} fillRule="evenodd" />
        </g>
      ) : (
        <g data-lock transform="translate(50 50) scale(1.4) translate(-12 -12)">
          <rect x="3" y="11" width="18" height="11" rx="2" fill={c.icon} />
          <path d={LOCK_SHACKLE} fill="none" stroke={c.icon} strokeWidth="2.4" strokeLinecap="round" />
        </g>
      )}
    </svg>
  )
}
```

- [ ] **Step 5: 立體獎牌** `frontend/src/components/me/medal-scene.ts`（從 demo 的 `personal-page-v3` 那段 three.js 搬過來，改成 TypeScript 與這個介面）

```ts
import * as THREE from "three"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"

import type { MedalKind } from "@/api/me"
import { LOCK_SHACKLE, LOCKED_COLORS, MEDAL_ICON, TIER_COLORS } from "@/components/me/flat-medal"

/*
 * 個人頁的立體獎牌（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈獎牌牆〉）。
 * 一張 canvas 蓋在整張獎牌牆的卡片上，每一面畫在自己那一格（scissor），只開一個 WebGL。
 * 平常輕輕左右擺；拖著轉（左右繞直立的軸、上下繞水平的軸），放手保留轉速慢慢減，慢下來回到擺動；
 * 幾乎沒動就放開算點一下：解鎖的翻一圈，沒解鎖的抖一下並呼叫 onLockedTap。
 * 這個檔只在個人頁 import()，three.js 跟著拆成自己的檔，首頁不多載。
 */

export type SlotMedal = { id: string; kind: MedalKind; tier: 1 | 2 | 3; open: boolean; back: [string, string]; fresh: boolean }

export type MedalScene = { sync(medals: SlotMedal[]): void; destroy(): void }

type State = { obj: THREE.Group; key: string; vel: THREE.Vector2; phase: number; dragging: boolean; wiggle: number }

// 拖一個 px 轉多少；點一下翻一圈的轉速；新解鎖快轉的轉速
const DRAG = 0.02
const FLICK = 14
const FRESH_SPIN = 16
// 放開時移動不到幾 px 算點一下
const TAP_PX = 6

function faceTexture(m: SlotMedal, back: boolean): THREE.CanvasTexture {
  const c = m.open ? TIER_COLORS[m.tier] : LOCKED_COLORS
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 256
  const g = canvas.getContext("2d")!
  g.fillStyle = c.face
  g.beginPath()
  g.arc(128, 128, 128, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = c.inner
  g.beginPath()
  g.arc(128, 128, 103, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = c.icon
  g.strokeStyle = c.icon
  g.textAlign = "center"
  const font = getComputedStyle(document.body).fontFamily
  if (back) {
    g.font = `44px ${font}`
    g.fillText(m.back[0], 128, 128)
    g.font = `24px ${font}`
    g.fillText(m.back[1], 128, 168)
  } else if (m.open) {
    g.save()
    g.translate(128 - 72, 128 - 72)
    g.scale(6, 6)
    g.fill(new Path2D(MEDAL_ICON[m.kind]), "evenodd")
    g.restore()
  } else {
    g.save()
    g.translate(128 - 60, 128 - 66)
    g.scale(5, 5)
    g.beginPath()
    g.roundRect(3, 11, 18, 11, 2)
    g.fill()
    g.lineWidth = 2.4
    g.lineCap = "round"
    g.stroke(new Path2D(LOCK_SHACKLE))
    g.restore()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

const ridgeGeometry = new THREE.BoxGeometry(0.02, 0.05, 0.2)

function buildMedal(m: SlotMedal): THREE.Group {
  const metal = m.open
    ? new THREE.MeshStandardMaterial({ color: TIER_COLORS[m.tier].metal, metalness: 0.92, roughness: 0.26 })
    : new THREE.MeshStandardMaterial({ color: 0x9c97a8, metalness: 0.35, roughness: 0.6 })
  const group = new THREE.Group()
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.14, 96), metal)
  disc.rotation.x = Math.PI / 2
  group.add(disc, new THREE.Mesh(new THREE.TorusGeometry(1, 0.075, 20, 96), metal))
  // 邊緣一圈壓紋：轉到側面看得出厚度
  const ridges = new THREE.InstancedMesh(ridgeGeometry, metal, 96)
  const dummy = new THREE.Object3D()
  for (let k = 0; k < 96; k++) {
    const a = (k / 96) * Math.PI * 2
    dummy.position.set(Math.cos(a) * 1.07, Math.sin(a) * 1.07, 0)
    dummy.rotation.set(0, 0, a)
    dummy.updateMatrix()
    ridges.setMatrixAt(k, dummy.matrix)
  }
  group.add(ridges)
  for (const back of [false, true]) {
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(0.93, 96),
      new THREE.MeshStandardMaterial({ map: faceTexture(m, back), metalness: m.open ? 0.5 : 0.1, roughness: m.open ? 0.38 : 0.8 })
    )
    face.position.z = back ? -0.071 : 0.071
    if (back) face.rotation.y = Math.PI
    group.add(face)
  }
  group.visible = false
  return group
}

function dispose(group: THREE.Group) {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      if (obj.geometry !== ridgeGeometry) obj.geometry.dispose()
      const material = obj.material as THREE.MeshStandardMaterial
      material.map?.dispose()
      material.dispose()
    }
  })
}

/** 建不起 WebGL 會丟例外：呼叫端退回平塗的獎牌 */
export function createMedalScene({
  canvas,
  card,
  wall,
  still,
  onLockedTap,
}: {
  canvas: HTMLCanvasElement
  card: HTMLElement
  wall: HTMLElement
  still: boolean
  onLockedTap: (id: string) => void
}): MedalScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  const key = new THREE.DirectionalLight(0xffffff, 1.1)
  key.position.set(3, 4, 5)
  scene.add(key)
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50)
  camera.position.set(0, 0, 4.6)

  const states = new Map<string, State>()
  const opened = new Map<string, boolean>()
  const Y = new THREE.Vector3(0, 1, 0)
  const X = new THREE.Vector3(1, 0, 0)
  const Z = new THREE.Vector3(0, 0, 1)
  const turn = (s: State, axis: THREE.Vector3, a: number) =>
    s.obj.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, a))

  let drag: { id: string; x: number; y: number; t: number; moved: number } | null = null
  const onDown = (e: PointerEvent) => {
    const slot = (e.target as Element).closest<HTMLElement>("[data-medal-id]")
    const state = slot && states.get(slot.dataset.medalId!)
    if (!slot || !state) return
    slot.setPointerCapture(e.pointerId)
    drag = { id: slot.dataset.medalId!, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 }
    state.dragging = true
    state.vel.set(0, 0)
  }
  const onMove = (e: PointerEvent) => {
    const state = drag && states.get(drag.id)
    if (!drag || !state) return
    const now = performance.now()
    const dx = (e.clientX - drag.x) * DRAG
    const dy = (e.clientY - drag.y) * DRAG
    drag.moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y)
    turn(state, Y, dx)
    turn(state, X, dy)
    const dt = Math.max((now - drag.t) / 1000, 0.008)
    state.vel.set(dx / dt, dy / dt)
    drag = { ...drag, x: e.clientX, y: e.clientY, t: now }
  }
  const onUp = () => {
    const state = drag && states.get(drag.id)
    if (drag && state) {
      if (drag.moved < TAP_PX) {
        if (opened.get(drag.id)) state.vel.set(FLICK, 0)
        else {
          state.wiggle = 0.6
          onLockedTap(drag.id)
        }
      }
      state.dragging = false
    }
    drag = null
  }
  wall.addEventListener("pointerdown", onDown)
  wall.addEventListener("pointermove", onMove)
  wall.addEventListener("pointerup", onUp)
  wall.addEventListener("pointercancel", onUp)

  const target = new THREE.Quaternion()
  const euler = new THREE.Euler()
  let prev = performance.now()
  renderer.setAnimationLoop((t) => {
    const dt = Math.min((t - prev) / 1000, 0.05)
    prev = t
    const w = card.clientWidth
    const h = card.clientHeight
    const ratio = renderer.getPixelRatio()
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) renderer.setSize(w, h, false)
    renderer.setScissorTest(false)
    renderer.setClearColor(0x000000, 0)
    renderer.clear()
    renderer.setScissorTest(true)
    const box = canvas.getBoundingClientRect()
    for (const slot of wall.querySelectorAll<HTMLElement>("[data-medal-id]")) {
      const state = states.get(slot.dataset.medalId!)
      if (!state) continue
      if (!state.dragging) {
        // 甩出去的轉速慢慢減；慢下來之後跟著「平常輕輕左右擺」的姿勢走（減少動態效果時停在正面）
        state.vel.multiplyScalar(Math.exp(-dt * 1.6))
        turn(state, Y, state.vel.x * dt)
        turn(state, X, state.vel.y * dt)
        const calm = Math.max(0, 1 - state.vel.length() / 3)
        if (calm > 0) {
          const sway = still ? 0 : 1
          target.setFromEuler(euler.set(0.08 * sway * Math.sin(t / 1300 + state.phase), 0.45 * sway * Math.sin(t / 1100 + state.phase), 0))
          state.obj.quaternion.slerp(target, Math.min(dt * 2.4 * calm, 1))
        }
        if (state.wiggle > 0) {
          state.wiggle -= dt
          turn(state, Z, Math.sin(state.wiggle * 40) * 0.05)
        }
      }
      const r = slot.getBoundingClientRect()
      if (r.bottom < box.top || r.top > box.bottom) continue
      const left = r.left - box.left
      const bottom = box.bottom - r.bottom
      state.obj.visible = true
      renderer.setViewport(left, bottom, r.width, r.height)
      renderer.setScissor(left, bottom, r.width, r.height)
      renderer.render(scene, camera)
      state.obj.visible = false
    }
  })

  return {
    sync(medals) {
      medals.forEach((m, index) => {
        const key = `${m.open}:${m.back.join("|")}`
        const old = states.get(m.id)
        opened.set(m.id, m.open)
        if (old?.key === key) return
        const obj = buildMedal(m)
        scene.add(obj)
        if (old) {
          obj.quaternion.copy(old.obj.quaternion)
          scene.remove(old.obj)
          dispose(old.obj)
        }
        const vel = new THREE.Vector2(m.fresh && !still ? FRESH_SPIN : 0, 0)
        states.set(m.id, { obj, key, vel, phase: index * 1.3, dragging: false, wiggle: 0 })
      })
    },
    destroy() {
      renderer.setAnimationLoop(null)
      wall.removeEventListener("pointerdown", onDown)
      wall.removeEventListener("pointermove", onMove)
      wall.removeEventListener("pointerup", onUp)
      wall.removeEventListener("pointercancel", onUp)
      for (const state of states.values()) dispose(state.obj)
      pmrem.dispose()
      renderer.dispose()
    },
  }
}
```

- [ ] **Step 6: 獎牌牆** `frontend/src/components/me/medal-wall.tsx`

```tsx
import { useEffect, useRef, useState } from "react"

import type { Medal } from "@/api/me"
import { FlatMedal } from "@/components/me/flat-medal"
import type { MedalScene } from "@/components/me/medal-scene"
import {
  freshIds, lockedHint, markSeen, MEDAL_KIND_LABEL, MEDAL_UNIT, medalBack, medalId, medalStatus, readSeen, TIER_NAME,
} from "@/lib/medals"
import { cn } from "@/lib/utils"

const KINDS = ["stores", "cities"] as const

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * 獎牌牆（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈獎牌牆〉）：兩列各三面。
 * 先畫平塗的，three.js（medal-scene.ts）載好、建得起 WebGL 才換成立體的、可以拖著轉；建不起來就一直是平塗的。
 * 新解鎖、這支手機還沒看過的那幾面外圈亮一圈、快轉幾圈，演過就記成看過（lib/medals.ts）。
 */
export function MedalWall({ medals, userId }: { medals: Medal[]; userId: string }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const wallRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  // 進頁面那一刻算一次：新解鎖、還沒看過的
  const [fresh] = useState(() => new Set(typeof window === "undefined" ? [] : freshIds(medals, readSeen(userId))))
  const got = medals.filter((m) => m.unlocked_on).length

  // 3D 裡點了沒解鎖的那面：說還差多少（scene 建好之後才換 medals，所以用 ref 拿最新的）
  const medalsRef = useRef(medals)
  medalsRef.current = medals
  const sceneRef = useRef<MedalScene | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const card = cardRef.current
    const wall = wallRef.current
    if (!canvas || !card || !wall) return
    let cancelled = false
    import("@/components/me/medal-scene")
      .then(({ createMedalScene }) => {
        if (cancelled) return
        try {
          sceneRef.current = createMedalScene({
            canvas,
            card,
            wall,
            still: reducedMotion(),
            onLockedTap: (id) => {
              const medal = medalsRef.current.find((m) => medalId(m) === id)
              if (medal) setHint(lockedHint(medal))
            },
          })
          setReady(true)
        } catch {
          // 建不起 WebGL：留著平塗的獎牌
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      sceneRef.current?.destroy()
      sceneRef.current = null
    }
  }, [])

  // 立體獎牌照現在的資料畫（建好的那一刻、重新載入資料時）
  useEffect(() => {
    sceneRef.current?.sync(
      medals.map((m) => ({
        id: medalId(m),
        kind: m.kind,
        tier: m.tier,
        open: m.unlocked_on !== null,
        back: medalBack(m),
        fresh: fresh.has(medalId(m)),
      }))
    )
  }, [ready, medals, fresh])

  // 演過新解鎖的就記成看過
  useEffect(() => {
    markSeen(userId, medals)
  }, [medals, userId])

  // 提示 2.2 秒後收起來
  useEffect(() => {
    if (!hint) return
    const timer = window.setTimeout(() => setHint(null), 2200)
    return () => window.clearTimeout(timer)
  }, [hint])

  return (
    <section ref={cardRef} className="relative rounded-3xl border-2 bg-card p-4 shadow-lip">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">獎牌</h2>
        <span className="text-sm text-muted-foreground">
          {got} / {medals.length}
        </span>
      </div>
      <div ref={wallRef}>
        {KINDS.map((kind) => {
          const row = medals.filter((m) => m.kind === kind)
          return (
            <div key={kind}>
              <p className="mt-3.5 mb-1.5 text-sm text-muted-foreground">
                {MEDAL_KIND_LABEL[kind]} · {row[0]?.have ?? 0} {MEDAL_UNIT[kind]}
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {row.map((m) => (
                  <div key={medalId(m)} className="flex flex-col items-center gap-1">
                    <button
                      type="button"
                      data-medal-id={medalId(m)}
                      aria-label={`${TIER_NAME[m.tier]}：${MEDAL_KIND_LABEL[m.kind]} ${m.need} ${MEDAL_UNIT[m.kind]}，${medalStatus(m)}`}
                      onClick={() => !ready && !m.unlocked_on && setHint(lockedHint(m))}
                      className={cn(
                        "relative size-[92px] touch-none rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        ready && "cursor-grab active:cursor-grabbing",
                        fresh.has(medalId(m)) && "medal-glow"
                      )}
                    >
                      <span className={cn("block size-full", ready && "invisible")}>
                        <FlatMedal medal={m} />
                      </span>
                    </button>
                    <span className="text-sm">
                      {m.need} {MEDAL_UNIT[m.kind]}
                    </span>
                    <span className="text-xs text-muted-foreground">{medalStatus(m)}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">在首頁點路線上的站、熊熊滾騎過去就算跑過。</p>
      {hint && (
        <p role="status" className="mt-2 rounded-xl bg-muted px-3 py-2 text-sm">
          {hint}
        </p>
      )}
      <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 z-[1] size-full" />
    </section>
  )
}
```

`medal-glow` 加在 `frontend/src/index.css`（或旁邊新建 `medal-wall.css` 並在元件 import，照 `ride-on-route.css` 的做法）：

```css
/* 新解鎖的獎牌外圈亮一圈（個人頁）；減少動態效果時不亮 */
.medal-glow::after {
  content: "";
  position: absolute;
  inset: -6px;
  border-radius: 9999px;
  border: 3px solid #ffc93c;
  animation: medal-glow 1.2s ease-out forwards;
}
@keyframes medal-glow {
  from { opacity: 1; transform: scale(0.8); }
  to { opacity: 0; transform: scale(1.35); }
}
@media (prefers-reduced-motion: reduce) {
  .medal-glow::after { animation: none; opacity: 0; }
}
```


- [ ] **Step 7: 圖表** `frontend/src/components/me/sales-charts.tsx`

```tsx
import { useEffect, useRef, useState } from "react"

import type { Me } from "@/api/me"
import { formatDate, formatWan } from "@/lib/format"
import { niceTicks } from "@/lib/medals"
import { cn } from "@/lib/utils"

/*
 * 個人頁的兩張圖（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈圖表〉）：單一系列用主色、不放圖例，
 * 文字一律用文字色。捲進畫面才播（每次打開頁面一次）：一根接一根長出來、稍微衝過頭再彈回，數字從 0 跳到實際的值；
 * 減少動態效果時直接畫好。
 */

const STAGGER_MS = 100
const GROW_MS = 900
// 稍微衝過頭再彈回
const SPRING = "cubic-bezier(.34,1.4,.64,1)"

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** 捲進畫面（露出三成以上）就變成 true，之後不再變回去；伺服器 render 與減少動態效果時一開始就是 true */
function useShown<T extends Element>() {
  const ref = useRef<T>(null)
  const [shown, setShown] = useState(() => typeof IntersectionObserver === "undefined" || reducedMotion())
  useEffect(() => {
    const node = ref.current
    if (shown || !node) return
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setShown(true), { threshold: 0.3 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [shown])
  return [ref, shown] as const
}

/** 數字從 0 跳到 value（三次方減速），shown 之前是 0；減少動態效果時直接是 value */
function CountUp({ value, shown, delay }: { value: number; shown: boolean; delay: number }) {
  const [current, setCurrent] = useState(() => (reducedMotion() || typeof window === "undefined" ? value : 0))
  useEffect(() => {
    if (!shown || reducedMotion()) return setCurrent(value)
    let frame = 0
    const start = performance.now() + delay
    const step = (now: number) => {
      const k = Math.min(Math.max((now - start) / GROW_MS, 0), 1)
      setCurrent(value * (1 - (1 - k) ** 3))
      if (k < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [shown, value, delay])
  return <>{formatWan(current)}</>
}

/** 賣最多的藥局：每列上面店名、下面長條（尾端圓角），數字在長條尖端跟著走 */
export function TopCustomers({ items }: { items: Me["top_customers"] }) {
  const [ref, shown] = useShown<HTMLOListElement>()
  const top = items[0]?.amount || 1
  return (
    <ol ref={ref} className="mt-1 flex flex-col">
      {items.map((item, i) => (
        <li key={item.customer_id} className="mt-2.5">
          <p className="text-sm">{item.name}</p>
          <div className="mt-1 flex items-center gap-2" title={`${item.name}：${formatWan(item.amount)}`}>
            <span
              className="h-3.5 rounded-r bg-primary"
              style={{
                ["--w" as string]: `${Math.round((item.amount / top) * 100)}%`,
                width: shown ? "calc(var(--w) * 0.68)" : 0,
                transition: `width ${GROW_MS}ms ${SPRING} ${i * STAGGER_MS}ms`,
              }}
            />
            <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              <CountUp value={item.amount} shown={shown} delay={i * STAGGER_MS} />
            </span>
          </div>
        </li>
      ))}
    </ol>
  )
}
```

（長條最長占這一列的 68%，右邊留給數字；這一列寬約 320px，最長約 220px，跟 demo 一樣。）

```tsx
const W = 326
const H = 190
const LEFT = 44
const BASE = 160
const TOP = 14
const BAR = 22

/** 每月業績：六根直條（頂端圓角），只標最高的那個月與這個月；這個月還沒過完畫淡色並註明算到哪天 */
export function MonthlySales({ months }: { months: Me["monthly"] }) {
  const [ref, shown] = useShown<SVGSVGElement>()
  const ticks = niceTicks(Math.max(0, ...months.map((m) => m.amount)))
  const max = ticks[ticks.length - 1]
  const y = (v: number) => BASE - (v / max) * (BASE - TOP)
  const band = (W - LEFT) / months.length
  const peak = months.reduce((best, m, i) => (m.amount > months[best].amount ? i : best), 0)
  const current = months.at(-1)
  return (
    <>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="mt-2.5 block h-auto w-full overflow-visible" role="img" aria-label="近六個月每月業績">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={LEFT} x2={W} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={LEFT - 8} y={y(t) + 4} textAnchor="end" fontSize={11} className="fill-muted-foreground">
              {t ? `${t / 10000} 萬` : 0}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const x = LEFT + band * i + band / 2 - BAR / 2
          const label = `${Number(m.month.slice(5))} 月`
          const top = y(m.amount)
          return (
            <g key={m.month}>
              <title>{`${label}：${formatWan(m.amount)}${m.through ? `（到 ${formatDate(m.through)}）` : ""}`}</title>
              <path
                data-partial={m.through ? "" : undefined}
                d={`M${x} ${BASE} V${top + 4} a4 4 0 0 1 4 -4 h${BAR - 8} a4 4 0 0 1 4 4 V${BASE} Z`}
                className={m.through ? "fill-primary/40" : "fill-primary"}
                style={{
                  transformBox: "fill-box",
                  transformOrigin: "50% 100%",
                  transform: shown ? "scaleY(1)" : "scaleY(0)",
                  transition: `transform ${GROW_MS}ms ${SPRING} ${i * STAGGER_MS}ms`,
                }}
              />
              <text x={x + BAR / 2} y={BASE + 18} textAnchor="middle" fontSize={12} className="fill-muted-foreground">
                {label}
              </text>
              {(i === peak || i === months.length - 1) && (
                <text
                  x={x + BAR / 2}
                  y={top - 6}
                  textAnchor="middle"
                  fontSize={11}
                  className="fill-foreground"
                  style={{ opacity: shown ? 1 : 0, transition: `opacity 300ms ease ${i * STAGGER_MS + 600}ms` }}
                >
                  {(m.amount / 10000).toFixed(1)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {current?.through && (
        <p className="mt-2 text-xs text-muted-foreground">
          {Number(current.month.slice(5))} 月只算到 {formatDate(current.through)}，顏色淡一點。
        </p>
      )}
    </>
  )
}
```

（`renderToStaticMarkup` 時 `useShown` 一開始是 true——`IntersectionObserver` 不存在——所以測試看得到最後的樣子；`CountUp` 在伺服器 render 時直接是 value。）

- [ ] **Step 8: 個人頁** `frontend/src/pages/me.tsx`

```tsx
import { useEffect, useState } from "react"
import { Settings } from "lucide-react"
import { Link, Navigate } from "react-router"

import { getMe, type Me } from "@/api/me"
import { Mascot } from "@/components/mascot"
import { MedalWall } from "@/components/me/medal-wall"
import { MonthlySales, TopCustomers } from "@/components/me/sales-charts"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { useAuth } from "@/lib/auth"
import { formatWan } from "@/lib/format"

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; me: Me }

/**
 * 個人頁（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈個人頁〉）：從首頁左上角的名字進來。
 * 三格事蹟數字、可以在牆上轉的獎牌、賣最多的藥局與每月業績。只有業務有；代理示範業務的帳號看示範業務的。
 */
export function MePage() {
  const user = useAuth()?.user
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getMe(controller.signal)
      .then((me) => setState({ status: "ready", me }))
      .catch(() => {
        // 主管、IT 在下面就轉去帳號設定了，業務拿不到只會是連不上或伺服器出錯
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => controller.abort()
  }, [attempt])

  if (user && user.role !== "sales") return <Navigate to="/settings" replace />

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title="個人頁"
        backTo="/"
        trailing={
          <Link to="/settings" aria-label="帳號設定" className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
            <Settings className="size-5" />
          </Link>
        }
      />
      <main className="flex flex-1 flex-col gap-4 px-4 pt-3 pb-10">
        {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入個人頁中…</p>}
        {state.status === "error" && (
          <Notice
            text="個人頁暫時載入不了"
            action={{
              label: "再試一次",
              onClick: () => {
                setState({ status: "loading" })
                setAttempt((n) => n + 1)
              },
            }}
          />
        )}
        {state.status === "ready" && user && (
          <>
            <div className="flex items-center gap-3.5">
              <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-accent">
                <Mascot bust size={56} />
              </span>
              <div className="min-w-0">
                <p className="text-xl font-semibold">{state.me.name}</p>
                <p className="text-sm text-muted-foreground">
                  {state.me.region} · 業務 · 名下 {state.me.stats.customers} 家客戶
                </p>
                {user.acting_as && <p className="text-xs text-muted-foreground">示範業務的個人頁</p>}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Stat value={state.me.stats.visits_last_year.toLocaleString("zh-TW")} label="近一年拜訪" />
              <Stat value={String(state.me.stats.customers)} label="名下客戶" />
              <Stat value={formatWan(state.me.stats.sales_last_year, 0)} label="近一年業績" />
            </div>
            <MedalWall medals={state.me.medals} userId={user.acting_as?.id ?? user.id} />
            <section className="rounded-3xl border-2 bg-card p-4 shadow-lip">
              <div className="flex items-baseline justify-between">
                <h2 className="text-base font-semibold">賣最多的藥局</h2>
                <span className="text-sm text-muted-foreground">近一年進貨</span>
              </div>
              <TopCustomers items={state.me.top_customers} />
            </section>
            <section className="rounded-3xl border-2 bg-card p-4 shadow-lip">
              <div className="flex items-baseline justify-between">
                <h2 className="text-base font-semibold">每月業績</h2>
                <span className="text-sm text-muted-foreground">近六個月</span>
              </div>
              <MonthlySales months={state.me.monthly} />
            </section>
          </>
        )}
      </main>
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border-2 bg-card px-2 py-2.5 text-center shadow-lip">
      <p className="text-xl font-semibold">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}
```


- [ ] **Step 9: 路由與入口**

`frontend/src/App.tsx`：import `MePage`，在 `<Route path="/rides" ... />` 下面加 `<Route path="/me" element={<MePage />} />`。

`frontend/src/pages/today.tsx`：頁首名字那個 `<Link to="/settings" ...>` 改成 `to="/me"`，上面的註解「點名字進帳號設定：改密碼、登出、使用說明」改成「點名字進個人頁（右上角齒輪再進帳號設定）」。

- [ ] **Step 10: 跑全部前端檢查與 build**

Run: `npm --prefix frontend run test && npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend run build`
Expected: 全部 PASS；build 的輸出裡 three.js 是另外一個 chunk（`medal-scene-*.js`），不在首頁的主 chunk 裡。

- [ ] **Step 11: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/components/me frontend/src/pages/me.tsx frontend/src/App.tsx frontend/src/pages/today.tsx frontend/src/index.css
git commit -m "Add the personal page with spinning medals and growing sales charts"
```

---

### Task 8: 收尾：README、全部測試、實際打開看、壓力測試

**Files:**
- Modify: `README.md`
- Create: `backend/scripts/stress_arrivals.py`

- [ ] **Step 1: README**

- 〈今日路線（首頁）〉：熊熊滾那一條改寫成「點站就騎」：點圓鈕熊熊滾從停的那一站（或最上面的辦公室）騎過去並彈出小卡（進門前三分鐘、下次去要記得），那一站記成到過（`stop_arrival`，打勾、位置與時間不動），不用錄音；拿掉「回到首頁時自動騎一次」。小卡那一條加進門前三分鐘。
- 〈客戶檔案與談判卡〉：「進門前三分鐘」會提的狀況拿掉「近期提到的競品」；「下次去要記得」加「確認拜訪時業務講到的競品也記成一則（標競品）」。
- 新的一節〈個人頁〉：入口、三格數字、獎牌（門檻、只算點過的站、解鎖日期是系統日、IT 重置清掉）、立體獎牌與平塗退路、兩張圖與動畫。
- 檔案清單加 `backend/app/services/achievements.py`、`backend/app/api/me.py`、`backend/scripts/stress_arrivals.py`、`frontend/src/pages/me.tsx`、`frontend/src/components/me/`。
- IT 重置那一條加「點過的站與獎牌也一併清掉」。

- [ ] **Step 2: 壓力測試腳本** `backend/scripts/stress_arrivals.py`

```python
"""點站的壓力測試（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈測試〉）：
展示時 20 位評審同時代理林昱辰，一直點站、開小卡、開個人頁。

    JWT_SECRET=… DATABASE_URL=… REDIS_URL=… uv run --project backend python backend/scripts/stress_arrivals.py \
        --base-url http://127.0.0.1:8013

API 與這支腳本要用同一把 JWT_SECRET（理由見 stress_channels.py）。只打本機（--base-url 不是 localhost 就拒絕）。
帳號直接寫進 DATABASE_URL 那個資料庫，跟 stress_channels.py 同一批（stress-NN@stress.local）。
開始前由 IT 重置示範業務今天的行程，所以結束後示範業務的行程停在壓測點過的樣子。

通過條件：沒有 5xx、每個請求都 200、點站的 p95 在 1 秒內、主管頁最後的進度（done）等於點過的不同站數。
不通過時 exit code 1。
"""

import argparse
import asyncio
import random
import statistics
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

# macOS 上 .venv 會被標成隱藏，Python 就略過可編輯安裝的 .pth、找不到 app；直接把 backend 加進搜尋路徑
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.api.auth import _new_sales_account  # noqa: E402
from app.db import session_factory  # noqa: E402
from app.models import AppUser  # noqa: E402
from app.services import auth  # noqa: E402

P95_LIMIT_SECONDS = 1.0


def tokens(count: int) -> tuple[str, str, list[str]]:
    """(IT, 主管 M01, count 個代理示範業務的帳號) 的 token；帳號沿用上次建的。"""
    judges = []
    with session_factory()() as session:
        for n in range(1, count + 1):
            email = f"stress-{n:02d}@stress.local"
            user = session.scalar(select(AppUser).where(AppUser.email == email))
            if user is None:
                user = _new_sales_account(session, f"壓測{n:02d}", email=email, password_hash=None)
            judges.append(auth.create_token(user))
        it, manager = auth.create_token(session.get(AppUser, "A01")), auth.create_token(session.get(AppUser, "M01"))
        session.commit()
    return it, manager, judges


async def judge(
    client: httpx.AsyncClient, token: str, stops: list[str], rounds: int, log: list[tuple[str, int, float]], hits: list[str]
):
    headers = {"Authorization": f"Bearer {token}"}

    async def hit(kind: str, method: str, path: str):
        started = time.perf_counter()
        try:
            response = await client.request(method, path, headers=headers)
            log.append((kind, response.status_code, time.perf_counter() - started))
        except httpx.HTTPError:
            log.append((kind, 0, time.perf_counter() - started))

    for n in range(rounds):
        customer_id = random.choice(stops)
        hits.append(f"/api/itinerary/today/stops/{customer_id}/arrive")
        await hit("arrive", "POST", f"/api/itinerary/today/stops/{customer_id}/arrive")
        await hit("brief", "GET", f"/api/customers/{customer_id}/brief")
        if n % 3 == 0:
            await hit("me", "GET", "/api/me")


async def main(args) -> int:
    if urlparse(args.base_url).hostname not in ("127.0.0.1", "localhost"):
        print("只打本機")
        return 1
    it, manager, judges = tokens(args.judges)
    async with httpx.AsyncClient(base_url=args.base_url, timeout=30) as client:
        reset = await client.post("/api/admin/demo-itinerary/reset", headers={"Authorization": f"Bearer {it}"})
        reset.raise_for_status()
        route = (await client.get("/api/itinerary/today", headers={"Authorization": f"Bearer {judges[0]}"})).json()
        stops = [s["customer_id"] for s in route["stops"]]
        log: list[tuple[str, int, float]] = []
        hits: list[str] = []
        await asyncio.gather(*(judge(client, token, stops, args.rounds, log, hits) for token in judges))
        rep = (await client.get("/api/manager/itineraries/U01", headers={"Authorization": f"Bearer {manager}"})).json()
    # 每位評審隨機點，20 人 × 15 輪幾乎一定每站都點過；沒點到的站照實印出
    tapped = {path.rsplit("/", 2)[-2] for path in hits}
    bad = [(kind, code) for kind, code, _ in log if code != 200]
    arrive_times = sorted(seconds for kind, _, seconds in log if kind == "arrive")
    p95 = arrive_times[int(len(arrive_times) * 0.95) - 1] if arrive_times else float("inf")
    print(f"請求 {len(log)}、不是 200 的 {len(bad)}、點站中位數 {statistics.median(arrive_times):.3f}s、p95 {p95:.3f}s")
    print(f"主管頁的進度 done={rep['done']}／total={rep['total']}（點過 {len(tapped)} 站；沒點到的：{sorted(set(stops) - tapped)}）")
    passed = not bad and p95 <= P95_LIMIT_SECONDS and rep["done"] == len(tapped)
    if bad:
        print("失敗的請求：", sorted(set(bad)))
    print("通過" if passed else "不通過")
    return 0 if passed else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8013")
    parser.add_argument("--judges", type=int, default=20)
    parser.add_argument("--rounds", type=int, default=15)
    sys.exit(asyncio.run(main(parser.parse_args())))
```


- [ ] **Step 3: 全部後端與前端測試**

Run: `TEST_DB_NAME=meddemo_test_tapride TEST_REDIS_URL=redis://127.0.0.1:6379/12 uv run --project backend pytest backend/tests -q` 與 `npm --prefix frontend run test && npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend run build`
Expected: 全部 PASS。

- [ ] **Step 4: 起一套隔離環境實際打開看**（照記憶〈Run the stack from a worktree〉與〈Headless Chrome quits after 30 s〉）

1. 建資料庫 `meddemo_tapride_dev` 並灌資料：`DATABASE_URL=…/meddemo_tapride_dev uv run --project backend python data/seed/seed.py --database-url …/meddemo_tapride_dev`。
2. API：把主 checkout 的 `backend/.env` 複製到 worktree 的 `backend/.env`，`JWT_SECRET=tapride-check DATABASE_URL=…/meddemo_tapride_dev REDIS_URL=redis://127.0.0.1:6379/11 uv run --project backend uvicorn app.main:app --port 8013`（背景跑）。
3. 前端：`npm --prefix frontend run build`，用靜態伺服器開 `frontend/dist`（不要用 `vite preview`），API 代理到 8013（照記憶裡的做法寫一個暫時的設定）。
4. headless Chrome（每段 < 20 秒、新開 Chrome、390 寬，淺色與深色——深色靠 localStorage 的 `meddemo:skin`），截這些圖並逐張看：
   - 首頁：辦公室圓鈕與熊熊滾停在辦公室；點第 1 站騎到一半；小卡（進門前三分鐘、下次去要記得、開啟拜訪準備）；
   - 往回點、跳站點；騎進新竹那一段半路換車；首頁底部的解鎖提示；
   - 到過的站打勾與「HH:MM 到過」；全部到過之後熊熊滾在收工旗子旁；
   - 個人頁上半部、獎牌轉到一半、新解鎖那面亮一圈、兩張圖長到一半與長完；
   - 客戶檔案的進門前三分鐘沒有競品那句、下次去要記得有競品備忘。
   看到怪的就修、再截。
5. 收掉背景程式、刪掉暫時的檔案、`backend/.env` 與 `meddemo_tapride_dev`。

- [ ] **Step 5: 壓力測試**

用 Step 4 的 API（8013）跑：`JWT_SECRET=tapride-check DATABASE_URL=…/meddemo_tapride_dev REDIS_URL=redis://127.0.0.1:6379/11 uv run --project backend python backend/scripts/stress_arrivals.py --base-url http://127.0.0.1:8013`
Expected: 印出「通過」、exit 0。不通過就看 API 的 log 找原因修好再跑。

- [ ] **Step 6: Commit**

```bash
git add README.md backend/scripts/stress_arrivals.py
git commit -m "Describe tap-to-ride and the personal page and add the arrival stress test"
```
