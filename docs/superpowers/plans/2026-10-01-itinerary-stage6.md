# 行程第六階段：即時位置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 業務上班時間打開 App 就分享最新位置（首頁一條分享列，可以暫停），主管的行程分頁看得到每位業務在哪（卡片的位置那一行、地圖上的頭像），收到 WebSocket 的位置與行程事件 3 秒後自動更新。

**Architecture:** 位置跟著在線狀態的心跳送（WebSocket 的 `ping` 與斷線時的 `POST /api/presence/ping` 多帶 `location` 或 `location_denied`）；後端 `services/locations.py` 檢查角色、上班時間、暫停與節流後覆寫 `user_location`（一人一列），並發 `{"type": "location"}` 事件；行程或拜訪有變時 `app/realtime.py` 的 SQLAlchemy 事件在 commit 之後發 `{"type": "itinerary"}`。WebSocket 只把這兩種事件轉給看得到那位業務的主管與 IT。主管頁收到位置事件只重拿 `GET /api/manager/locations`（不重算行程、不問 Google），收到行程事件才重拿整份。位置描述（`describe`）是純函式。前端 `lib/location-share.ts` 管同意、權限、`watchPosition` 與要不要帶位置，`components/route/share-bar.tsx` 是首頁的分享列。

**Tech Stack:** FastAPI、SQLAlchemy 事件、Redis pub/sub、pytest；React 19、TypeScript、Geolocation API、vitest。

**設計文件：** `docs/superpowers/specs/2026-10-01-itinerary-planning-design.md`〈即時位置〉、〈位置分享〉、〈主管端：行程分頁〉的即時更新（本計畫是〈分階段做〉的第 6 階段）。使用者決定：評審（第三方登入、代理示範業務）分享的是真的 GPS，不模擬。

## Global Constraints

- 一律用繁體中文寫註解與畫面文字；畫面文字照設計文件的用字。畫面不用表情符號，圖示一律 lucide；厚底樣式（`shadow-lip`、`press`、`buttonVariants`）。
- 只有業務分享位置：`role == "sales"`；代理示範業務的帳號（`acts_as_user_id` 有值）寫在示範業務名下，好幾位同時代理以最後一筆為準。主管與 IT 的心跳帶了位置也不寫；他們打暫停、繼續回 403「只有業務會分享位置」。
- 上班時間是台北的真實時間：設定 `LOCATION_SHARE_HOURS`，預設 `"1-5 08:30-18:30"`（星期一到五，08:30 起、18:30 前；星期 1＝一…7＝日，也可以寫 `1,3,5`；結束可寫 `24:00`）。後端寫入前再檢查一次。
- 節流：跟上一筆差不到 30 公尺而且不到 2 分鐘就不寫、不發事件（`MIN_MOVE_METERS = 30`、`MIN_INTERVAL = 2 分鐘`）。暫停中不寫。瀏覽器拒絕定位時記 `denied`，之後拿到位置就清掉。
- 一人一列覆寫，不留軌跡；下班時間不寫。`at` 不是今天（台北日期）就當作沒有位置。
- 位置描述依序：「下班時間」→「暫停分享位置」（有今天的位置加「 · 最後位置 HH:MM」）→「沒有開定位權限」→「今天還沒有位置」→ 超過 5 分鐘沒更新「最後位置 HH:MM」（3 公里內有自己的客戶加「，在{地區}」）→ 離某一站 200 公尺內「在{店名}附近」→ 還有沒跑的站「往第 N 站{店名}途中」→「今天跑完了」。5 分鐘內的後三種，1 分鐘以上加「 · N 分鐘前」。店名用 `team_itineraries.short_name`；地區直轄市加「區」（內湖 → 內湖區）。
- 分享列（業務首頁，橫幅下面）：分享中 綠點「位置分享中，{主管名}看得到你在哪（到 18:30）」＋「暫停」；暫停中 琥珀點「已暫停分享，{主管名}會看到『暫停分享』」＋「繼續」；沒有權限「沒有開定位權限，{主管名}看不到你在哪」＋「怎麼開」（說明對話框）；下班時間不顯示。第一次在上班時間打開首頁先跳對話框「上班時間主管看得到你的位置，只存最新的一筆，不留軌跡；可以隨時暫停」，按「知道了」才向瀏覽器要定位權限。
- 主管頁：卡片多一行紫色的位置；詳細頁在總公里那一行下面也有；地圖上業務的頭像在最新位置，暫停或超過 5 分鐘沒更新時變灰；下班時間或今天沒有位置就不畫頭像。
- 即時更新：收到看得到的業務的 `location` 事件，3 秒後只重拿位置（`GET /api/manager/locations`）；`itinerary` 事件（或重連的 `resync`）3 秒後重拿整份；WebSocket 沒連上時每 60 秒重拿整份（畫面在前景）。
- 事件只說誰變了、不帶內容：`{"type": "location", "user_id": "U01"}`、`{"type": "itinerary", "user_id": "U01"}`；WebSocket 只轉給看得到那位業務的主管與 IT（跟 `api/manager.py` 同一個範圍）。
- 這是給評審用的示範：可靠比省錢重要，即時功能要壓力測試（Task 9）。
- 測試在隔離的資料庫與 Redis 跑：`TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7`；前端 `cd frontend && npm run typecheck && npm run lint && npm test && npm run build`。測試不靠現在幾點：要在上班時間的測試用 `env(LOCATION_SHARE_HOURS="1-7 00:00-24:00")`，要下班的用 `"1-7 00:00-00:00"`。
- 跟 Track A 共用的檔案只做局部、加新的一段：`backend/app/models.py`（新表放在 `UserPresence` 後面，不放檔案最後，避開 Track A 在最後加的表）、`backend/app/main.py`（另起一行 import）、`frontend/src/pages/today.tsx`（一行 import、一個元件）、`README.md`（新的一節）。
- 每個 commit 訊息最後空一行再加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## 執行環境

worktree：`/Users/jamessu/Desktop/computersciencehomework/MEDDEMO/.worktrees/itinerary-maps`（分支 `itinerary-maps`，第 4、5 階段已在上面）。所有指令在這個目錄下跑。

## 檔案

| 檔案 | 動作 | 職責 |
|---|---|---|
| `backend/app/models.py` | 改 | `UserLocation`（放在 `UserPresence` 後面） |
| `backend/app/config.py` | 改 | `location_share_hours` |
| `backend/app/services/locations.py` | 新 | 上班時間、寫入與節流、暫停、分享狀態、位置描述 |
| `backend/app/realtime.py` | 改 | `location_changed`、`itinerary_changed`；commit 之後發行程事件的 SQLAlchemy 事件 |
| `backend/app/api/presence.py` | 改 | 心跳收位置；WebSocket 轉 `location`、`itinerary` 給看得到的人 |
| `backend/app/api/location.py` | 新 | `GET /api/location/me`、`POST /api/location/pause`、`/resume` |
| `backend/app/api/admin.py` | 改 | 重置示範業務的行程後發行程事件 |
| `backend/app/main.py` | 改 | 掛 location 的 router |
| `backend/app/services/team_itineraries.py` | 改 | 每位業務的位置；只拿位置的 `locations_now` |
| `backend/app/api/manager.py` | 改 | `RepRoute.location`、`GET /api/manager/locations` |
| `backend/tests/test_locations.py` | 新 | 寫入、上班時間、暫停、節流、代理帳號 |
| `backend/tests/test_location_text.py` | 新 | 位置描述的每一種情況 |
| `backend/tests/test_location_api.py` | 新 | 心跳、暫停、WebSocket 事件 |
| `backend/tests/test_itinerary_events.py` | 新 | 行程事件 |
| `backend/tests/test_team_itineraries.py`、`test_team_itineraries_api.py` | 改 | 位置 |
| `backend/scripts/stress_locations.py` | 新 | 壓力測試 |
| `frontend/src/api/location.ts` | 新 | 分享狀態、暫停、繼續 |
| `frontend/src/api/presence.ts` | 改 | HTTP 心跳多帶位置 |
| `frontend/src/lib/location-share.ts` | 新 | 上班時間、要不要帶位置、分享列狀態（純函式）與追蹤位置的 store |
| `frontend/src/lib/location-share.test.ts` | 新 | |
| `frontend/src/lib/realtime.ts`、`realtime.test.ts` | 改 | 心跳帶位置；轉發 `location`、`itinerary` 事件 |
| `frontend/src/lib/channel-unread.ts`、`frontend/src/pages/channels.tsx` | 改 | 只對訊息與重連反應（不被位置事件觸發） |
| `frontend/src/components/route/share-bar.tsx` | 新 | 分享列與兩個對話框 |
| `frontend/src/components/route/share-bar.test.ts` | 新 | |
| `frontend/src/pages/today.tsx` | 改 | 放分享列 |
| `frontend/src/api/team-routes.ts`、`frontend/src/lib/team-routes.ts`（含 fixtures、test） | 改 | 位置型別、`getTeamLocations`、`withLocations` |
| `frontend/src/components/manager/rep-route-card.tsx`（含 test）、`routes-panel.tsx`、`route-map.tsx` | 改 | 位置那一行、地圖上的頭像、即時更新 |
| `README.md` | 改 | 新的一節〈即時位置〉 |

---
### Task 1: 位置的資料表與寫入規則

**Files:**
- Modify: `backend/app/models.py`（`class UserPresence` 整段後面、`class UserAvatar` 前面）
- Modify: `backend/app/config.py`（`google_maps_map_id` 那一行後面）
- Create: `backend/app/services/locations.py`
- Modify: `backend/tests/conftest.py`（清空金鑰那一串後面）
- Test: `backend/tests/test_locations.py`

**Interfaces:**
- Produces:
  - `models.UserLocation`（`user_id` 主鍵、`lat`、`lng`、`accuracy_m`、`at`、`paused`、`paused_at`、`denied`、`denied_at`）
  - `Settings.location_share_hours: str = "1-5 08:30-18:30"`
  - `locations.ShareHours(weekdays: frozenset[int], start: int, end: int)`（分鐘）；`parse_hours(spec) -> ShareHours`；`share_hours() -> ShareHours`；`within(at, hours) -> bool`；`now() -> datetime`
  - `locations.sharer(user) -> AppUser | None`（位置寫在誰名下）
  - `locations.record(session, user, lat, lng, accuracy, at=None) -> str | None`、`deny(session, user, at=None) -> str | None`：回傳要發事件的業務 id，沒寫回 None
  - `locations.report(session, user, position: tuple[float, float, float | None] | None, denied: bool, at=None) -> str | None`（心跳用）
  - `locations.set_paused(session, user, paused: bool, at=None) -> str`（不是業務丟 `locations.NotSharing`）
  - `locations.ShareState(applies, paused, denied, manager_name, hours)`；`locations.state(session, user) -> ShareState`

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_locations.py`：

```python
"""即時位置的寫入：上班時間、暫停、節流、沒有權限、代理帳號寫在示範業務名下。描述在 test_location_text.py。"""

import datetime as dt

import pytest
from sqlalchemy import delete

from app.models import AppUser, UserLocation
from app.services import locations
from app.timeutil import TAIPEI

# 2026-10-01 是星期四
WORKING = dt.datetime(2026, 10, 1, 10, 0, tzinfo=TAIPEI)
TAIPEI_101 = (25.034, 121.5645)
WEEKDAYS = locations.parse_hours("1-5 08:30-18:30")


@pytest.fixture(autouse=True)
def no_locations(engine):
    """WebSocket 的測試會真的寫進資料庫（不在 tx 裡），前後都清掉。"""

    def clear():
        with engine.begin() as conn:
            conn.execute(delete(UserLocation))

    clear()
    yield
    clear()


def person(tx, user_id):
    return tx.get(AppUser, user_id)


def test_the_share_hours_setting():
    assert WEEKDAYS == locations.ShareHours(frozenset({1, 2, 3, 4, 5}), 8 * 60 + 30, 18 * 60 + 30)
    assert locations.parse_hours("1,3,6 00:00-24:00") == locations.ShareHours(frozenset({1, 3, 6}), 0, 1440)
    assert locations.share_hours() == WEEKDAYS


@pytest.mark.parametrize(
    ("when", "inside"),
    [
        (dt.datetime(2026, 10, 1, 8, 29, tzinfo=TAIPEI), False),
        (dt.datetime(2026, 10, 1, 8, 30, tzinfo=TAIPEI), True),
        (dt.datetime(2026, 10, 1, 18, 29, tzinfo=TAIPEI), True),
        (dt.datetime(2026, 10, 1, 18, 30, tzinfo=TAIPEI), False),
        # 星期六
        (dt.datetime(2026, 10, 3, 10, 0, tzinfo=TAIPEI), False),
        # 看的是台北時間：UTC 00:30 是台北 08:30
        (dt.datetime(2026, 10, 1, 0, 30, tzinfo=dt.UTC), True),
    ],
)
def test_work_hours_are_taipei_time(when, inside):
    assert locations.within(when, WEEKDAYS) is inside


def test_a_reps_location_is_saved(tx):
    assert locations.record(tx, person(tx, "U01"), *TAIPEI_101, 12.0, at=WORKING) == "U01"
    row = tx.get(UserLocation, "U01")
    assert (row.lat, row.lng, row.accuracy_m, row.at) == (25.034, 121.5645, 12.0, WORKING)


def test_nothing_is_written_outside_work_hours(tx):
    assert locations.record(tx, person(tx, "U01"), *TAIPEI_101, 12.0, at=WORKING.replace(hour=19)) is None
    assert locations.deny(tx, person(tx, "U01"), at=WORKING.replace(hour=19)) is None
    assert tx.get(UserLocation, "U01") is None


def test_managers_and_it_do_not_share(tx):
    assert locations.record(tx, person(tx, "M01"), *TAIPEI_101, 12.0, at=WORKING) is None
    assert tx.get(UserLocation, "M01") is None
    with pytest.raises(locations.NotSharing):
        locations.set_paused(tx, person(tx, "A01"), True)


def test_an_acting_account_writes_under_the_demo_rep(tx):
    tx.add(AppUser(id="JUDGE1", name="評審", role="sales", region="北區", acts_as_user_id="U01"))
    tx.flush()
    assert locations.record(tx, person(tx, "JUDGE1"), *TAIPEI_101, 12.0, at=WORKING) == "U01"
    assert tx.get(UserLocation, "JUDGE1") is None
    assert tx.get(UserLocation, "U01").lat == 25.034


def test_a_paused_rep_is_not_written_until_resumed(tx):
    rep = person(tx, "U01")
    assert locations.set_paused(tx, rep, True, at=WORKING) == "U01"
    assert tx.get(UserLocation, "U01").paused_at == WORKING
    assert locations.record(tx, rep, *TAIPEI_101, 12.0, at=WORKING) is None
    locations.set_paused(tx, rep, False)
    assert tx.get(UserLocation, "U01").paused_at is None
    assert locations.record(tx, rep, *TAIPEI_101, 12.0, at=WORKING) == "U01"


def test_small_quick_moves_are_skipped(tx):
    rep = person(tx, "U01")
    locations.record(tx, rep, *TAIPEI_101, 12.0, at=WORKING)
    later = WORKING + dt.timedelta(minutes=1)
    # 約 20 公尺、1 分鐘：不寫
    assert locations.record(tx, rep, 25.03418, 121.5645, 12.0, at=later) is None
    assert tx.get(UserLocation, "U01").at == WORKING
    # 約 50 公尺：寫
    assert locations.record(tx, rep, 25.03445, 121.5645, 12.0, at=later) == "U01"
    # 沒動，但離上一筆超過 2 分鐘：寫，主管才知道位置還是新的
    assert locations.record(tx, rep, 25.03445, 121.5645, 12.0, at=later + dt.timedelta(minutes=2, seconds=1)) == "U01"


def test_denied_is_recorded_once_and_cleared_by_the_next_position(tx):
    rep = person(tx, "U01")
    assert locations.deny(tx, rep, at=WORKING) == "U01"
    # 已經記過了，不再發事件
    assert locations.deny(tx, rep, at=WORKING) is None
    assert tx.get(UserLocation, "U01").denied is True
    assert locations.record(tx, rep, *TAIPEI_101, 12.0, at=WORKING) == "U01"
    row = tx.get(UserLocation, "U01")
    assert row.denied is False and row.denied_at is None


def test_report_takes_a_position_or_a_denial(tx):
    rep = person(tx, "U01")
    assert locations.report(tx, rep, None, False, at=WORKING) is None
    assert locations.report(tx, rep, (*TAIPEI_101, None), False, at=WORKING) == "U01"
    assert locations.report(tx, rep, None, True, at=WORKING + dt.timedelta(minutes=5)) == "U01"


def test_the_share_state_names_the_manager(tx):
    state = locations.state(tx, person(tx, "U01"))
    assert (state.applies, state.paused, state.denied, state.manager_name) == (True, False, False, "陳建宏")
    assert state.hours == WEEKDAYS
    assert locations.state(tx, person(tx, "M01")).applies is False
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_locations.py -q`
Expected: FAIL（`ImportError`：沒有 `UserLocation`、`locations`）

- [ ] **Step 3: 資料表與設定**

`backend/app/models.py`，在 `class UserPresence(Base):` 整段（最後一行是 `last_active_at: Mapped[dt.datetime | None]`）後面、`class UserAvatar(Base):` 前面加（不要加在檔案最後：另一個分支會在最後加表，兩邊都加在最後一定衝突）：

```python
class UserLocation(Base):
    """即時位置（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈即時位置〉）。一人一列、覆寫，不留軌跡。
    代理示範業務的帳號寫在示範業務名下；好幾位評審同時代理同一位時，以最後一筆為準。"""

    __tablename__ = "user_location"

    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), primary_key=True)
    # 最新的一筆；還沒拿到過位置（只按過暫停、或瀏覽器拒絕定位）是 NULL
    lat: Mapped[float | None]
    lng: Mapped[float | None]
    accuracy_m: Mapped[float | None]
    at: Mapped[dt.datetime | None]
    # 業務按了暫停：不寫位置，主管看到「暫停分享位置」
    paused: Mapped[bool] = mapped_column(server_default=false())
    paused_at: Mapped[dt.datetime | None]
    # 瀏覽器沒給定位權限；之後拿到位置就清掉
    denied: Mapped[bool] = mapped_column(server_default=false())
    denied_at: Mapped[dt.datetime | None]
```

（`false` 已經從 `sqlalchemy` import 了，`ItineraryStop.locked` 也用它。）

`backend/app/config.py`，`google_maps_map_id: str = ""` 後面加：

```python

    # 業務分享位置的上班時間（台北的真實時間，不是展示日）：「星期 起訖時間」，星期 1＝一…7＝日，可以寫範圍或用逗號分開；
    # 結束那一分鐘不算（18:30 起就是下班），也可以寫 24:00。測試用設定改成整天都算或都不算
    location_share_hours: str = "1-5 08:30-18:30"
```

`backend/tests/conftest.py`，在清空金鑰的 `for key in (...): os.environ[key] = ""` 那一段後面（`settings.cache_clear()` 前面）加：

```python
# 上班時間固定成預設值：backend/.env 改了也不影響測試；要整天都算或都不算的測試用 env fixture 改
os.environ["LOCATION_SHARE_HOURS"] = "1-5 08:30-18:30"
```

- [ ] **Step 4: 寫入規則**

`backend/app/services/locations.py`：

```python
"""即時位置（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈即時位置〉）。

業務打開 App 時，在線狀態的心跳（api/presence.py：WebSocket 每 20 秒、斷線時的 POST /api/presence/ping）多帶一筆位置。
只有業務、上班時間（台北的真實時間，LOCATION_SHARE_HOURS）、沒暫停才寫；一人一列覆寫、不留軌跡。
代理示範業務的帳號（第三方登入的評審）寫在示範業務名下，分享的是評審手機真的位置。
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AppUser, UserLocation
from app.services import travel
from app.timeutil import TAIPEI

# 跟上一筆差不到 30 公尺、又不到 2 分鐘就不寫、不發事件：人在店裡沒動時不必每 20 秒寫一次、通知主管一次
MIN_MOVE_METERS = 30
MIN_INTERVAL = dt.timedelta(minutes=2)


class NotSharing(Exception):
    """這個帳號不分享位置（主管、IT）。"""


@dataclass(frozen=True)
class ShareHours:
    weekdays: frozenset[int]  # 1（一）～7（日）
    start: int  # 一天的第幾分鐘
    end: int  # 不含這一分鐘；24:00 是 1440


def parse_hours(spec: str) -> ShareHours:
    """「1-5 08:30-18:30」：星期一到五，08:30 起、18:30 前。星期也可以寫成「1,3,5」。"""
    days, times = spec.split()
    if "-" in days:
        first, last = (int(day) for day in days.split("-"))
        weekdays = frozenset(range(first, last + 1))
    else:
        weekdays = frozenset(int(day) for day in days.split(","))
    start, end = (_minutes(clock) for clock in times.split("-"))
    return ShareHours(weekdays, start, end)


def _minutes(clock: str) -> int:
    hours, minutes = clock.split(":")
    return int(hours) * 60 + int(minutes)


def share_hours() -> ShareHours:
    return parse_hours(settings().location_share_hours)


def within(at: dt.datetime, hours: ShareHours) -> bool:
    """這個時刻在不在上班時間，看台北時間。"""
    local = at.astimezone(TAIPEI)
    minute = local.hour * 60 + local.minute
    return local.isoweekday() in hours.weekdays and hours.start <= minute < hours.end


def now() -> dt.datetime:
    # 位置是「現在」的事，用真實時間，不是展示日（as_of）
    return dt.datetime.now(dt.UTC)


def sharer(user: AppUser) -> AppUser | None:
    """位置寫在誰名下：業務是自己，代理示範業務的帳號是示範業務；主管、IT 不分享。"""
    if user.role != "sales":
        return None
    return user.acts_as or user


def _row(session: Session, user_id: str) -> UserLocation:
    # 兩條連線同時第一次送位置：ON CONFLICT DO NOTHING，不會撞主鍵；再鎖住那一列讀，兩個人同時寫以後到的為準
    session.execute(insert(UserLocation).values(user_id=user_id).on_conflict_do_nothing())
    return session.get(UserLocation, user_id, populate_existing=True, with_for_update=True)


def record(
    session: Session, user: AppUser, lat: float, lng: float, accuracy: float | None, at: dt.datetime | None = None
) -> str | None:
    """記一筆位置。回傳要發 location 事件的業務 id；沒寫（不是業務、下班時間、暫停中、差不多沒動）回 None。"""
    at = at or now()
    rep = sharer(user)
    if rep is None or not within(at, share_hours()):
        return None
    row = _row(session, rep.id)
    if row.paused:
        return None
    if (
        row.at is not None and row.lat is not None and row.lng is not None and not row.denied
        and at - row.at < MIN_INTERVAL
        and travel.straight_km((row.lat, row.lng), (lat, lng)) * 1000 < MIN_MOVE_METERS
    ):
        return None
    row.lat, row.lng, row.accuracy_m, row.at = lat, lng, accuracy, at
    row.denied, row.denied_at = False, None
    session.flush()
    return rep.id


def deny(session: Session, user: AppUser, at: dt.datetime | None = None) -> str | None:
    """瀏覽器沒給定位權限。已經記過就不再發事件。"""
    at = at or now()
    rep = sharer(user)
    if rep is None or not within(at, share_hours()):
        return None
    row = _row(session, rep.id)
    if row.denied:
        return None
    row.denied, row.denied_at = True, at
    session.flush()
    return rep.id


def report(
    session: Session, user: AppUser, position: tuple[float, float, float | None] | None, denied: bool,
    at: dt.datetime | None = None,
) -> str | None:
    """心跳帶來的位置 (緯度, 經度, 誤差公尺)，或「瀏覽器沒給權限」。回傳要發 location 事件的業務 id。"""
    if position is not None:
        return record(session, user, *position, at=at)
    if denied:
        return deny(session, user, at=at)
    return None


def set_paused(session: Session, user: AppUser, paused: bool, at: dt.datetime | None = None) -> str:
    """暫停或繼續分享。回傳業務 id（要發 location 事件，主管頁才會換成「暫停分享位置」）。"""
    rep = sharer(user)
    if rep is None:
        raise NotSharing
    row = _row(session, rep.id)
    row.paused = paused
    row.paused_at = (at or now()) if paused else None
    session.flush()
    return rep.id


@dataclass(frozen=True)
class ShareState:
    """業務首頁的分享列要的：會不會分享、暫停了沒、伺服器記的權限、主管是誰、上班時間。"""

    applies: bool
    paused: bool
    denied: bool
    manager_name: str | None
    hours: ShareHours


def state(session: Session, user: AppUser) -> ShareState:
    hours = share_hours()
    rep = sharer(user)
    if rep is None:
        return ShareState(False, False, False, None, hours)
    row = session.get(UserLocation, rep.id)
    manager = session.get(AppUser, rep.manager_id) if rep.manager_id else None
    return ShareState(True, bool(row and row.paused), bool(row and row.denied), manager.name if manager else None, hours)
```

- [ ] **Step 5: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_locations.py -q`
Expected: 全部通過。再跑一次全部 `backend/tests`，確認 `test_seed.py` 之類的沒有被新表影響。

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/config.py backend/app/services/locations.py backend/tests/conftest.py backend/tests/test_locations.py
git commit -m "Keep each rep's latest location during work hours, with pausing, a denied flag and a throttle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 位置描述

**Files:**
- Modify: `backend/app/services/locations.py`（最後）
- Test: `backend/tests/test_location_text.py`

**Interfaces:**
- Consumes: Task 1 的 `ShareHours`、`within`、`UserLocation`；`travel.straight_km`。
- Produces（Task 5 用）：`locations.StopPoint(number: int, name: str, lat: float, lng: float, done: bool)`；`locations.AreaPoint(lat: float, lng: float, label: str)`；`locations.Seen(text: str, lat: float | None = None, lng: float | None = None, at: datetime | None = None, live: bool = False)`；`locations.describe(now, hours, row: UserLocation | None, stops: list[StopPoint], areas: list[AreaPoint]) -> Seen`；`locations.area_label(area, city) -> str`；常數 `STALE_AFTER = 5 分鐘`、`NEAR_METERS = 200`、`AREA_WITHIN_KM = 3`。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_location_text.py`：

```python
"""主管頁那一行位置的每一種寫法（純函式，不碰資料庫）。"""

import datetime as dt

import pytest

from app.models import UserLocation
from app.services import locations
from app.services.locations import AreaPoint, StopPoint
from app.timeutil import TAIPEI

# 星期四 11:00
NOW = dt.datetime(2026, 10, 1, 11, 0, tzinfo=TAIPEI)
HOURS = locations.parse_hours("1-5 08:30-18:30")
STOPS = [
    StopPoint(1, "杏林診所", 25.0264, 121.5435, done=True),
    StopPoint(2, "康泰 · 忠孝店", 25.0410, 121.5440, done=False),
    StopPoint(3, "德安藥局", 25.0600, 121.5500, done=False),
]
AREAS = [AreaPoint(25.0689, 121.5889, "內湖區")]
# 台北 101：離每一站都超過 200 公尺
FAR = (25.0330, 121.5654)


def located(minutes_ago, lat=FAR[0], lng=FAR[1], paused=False, denied=False):
    return UserLocation(lat=lat, lng=lng, at=NOW - dt.timedelta(minutes=minutes_ago), paused=paused, denied=denied)


def say(row, stops=STOPS, now=NOW):
    return locations.describe(now, HOURS, row, stops, AREAS)


def test_after_work_hours_nothing_is_shown():
    seen = say(located(1), now=NOW.replace(hour=19))
    assert seen == locations.Seen("下班時間")


def test_paused_shows_the_last_place_greyed():
    seen = say(located(10, paused=True))
    assert seen.text == "暫停分享位置 · 最後位置 10:50"
    assert (seen.lat, seen.lng, seen.live) == (FAR[0], FAR[1], False)
    assert say(UserLocation(paused=True, denied=False)).text == "暫停分享位置"


def test_denied():
    assert say(UserLocation(paused=False, denied=True)).text == "沒有開定位權限"


def test_no_location_today():
    assert say(None) == locations.Seen("今天還沒有位置")
    yesterday = UserLocation(lat=FAR[0], lng=FAR[1], at=NOW - dt.timedelta(days=1), paused=False, denied=False)
    assert say(yesterday) == locations.Seen("今天還沒有位置")


def test_stale_shows_the_last_time_and_the_district_within_three_km():
    seen = say(located(10, lat=25.0700, lng=121.5900))
    assert seen.text == "最後位置 10:50，在內湖區" and seen.live is False and seen.lat == 25.07
    assert say(located(10, lat=24.0, lng=120.6)).text == "最後位置 10:50"


def test_near_a_stop():
    seen = say(located(0, lat=25.0265, lng=121.5436))
    assert seen.text == "在杏林診所附近" and seen.live is True


def test_on_the_way_to_the_next_stop():
    assert say(located(1)).text == "往第 2 站康泰 · 忠孝店途中 · 1 分鐘前"
    # 剛好 5 分鐘還不算太久
    assert say(located(5)).text == "往第 2 站康泰 · 忠孝店途中 · 5 分鐘前"


def test_all_done():
    finished = [StopPoint(s.number, s.name, s.lat, s.lng, done=True) for s in STOPS]
    assert say(located(2), stops=finished).text == "今天跑完了 · 2 分鐘前"


@pytest.mark.parametrize(
    ("area", "city", "label"),
    [("內湖", "台北市", "內湖區"), ("板橋", "新北市", "板橋區"), ("西區", "台中市", "西區"), ("員林", "彰化縣", "員林")],
)
def test_area_labels(area, city, label):
    assert locations.area_label(area, city) == label
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_location_text.py -q`
Expected: FAIL（`ImportError: cannot import name 'AreaPoint'`）

- [ ] **Step 3: 實作**

`backend/app/services/locations.py`：模組說明最後加一句「位置描述（describe）是純函式：主管頁卡片與詳細的那一行。」；`MIN_INTERVAL` 後面加：

```python
# 超過 5 分鐘沒更新：主管看到「最後位置 HH:MM」，頭像變灰
STALE_AFTER = dt.timedelta(minutes=5)
# 離某一站 200 公尺內算「在 X 附近」
NEAR_METERS = 200
# 最後位置 3 公里內有自己的客戶，才寫是哪一區
AREA_WITHIN_KM = 3
```

檔案最後加：

```python
@dataclass(frozen=True)
class StopPoint:
    """今天的一站，描述位置用：站號、店名（去掉地區）、座標、跑完了沒。"""

    number: int
    name: str
    lat: float
    lng: float
    done: bool


@dataclass(frozen=True)
class AreaPoint:
    """這位業務的一家客戶與它的地區（「內湖區」），寫「最後位置 10:41，在內湖區」用。"""

    lat: float
    lng: float
    label: str


@dataclass(frozen=True)
class Seen:
    """主管看到的位置：一句話，加上地圖上頭像畫在哪（沒有就不畫）、要不要上色。"""

    text: str
    lat: float | None = None
    lng: float | None = None
    at: dt.datetime | None = None
    live: bool = False  # 分享中而且 5 分鐘內有更新；暫停、沒權限、太久沒更新都是灰的


def describe(
    now: dt.datetime, hours: ShareHours, row: UserLocation | None, stops: list[StopPoint], areas: list[AreaPoint]
) -> Seen:
    """依序：下班時間 → 暫停 → 沒有權限 → 今天還沒有位置 → 太久沒更新 → 在某一站附近 → 往下一站途中 → 今天跑完了。
    位置的 at 不是今天（台北日期）就當作沒有。"""
    if not within(now, hours):
        return Seen("下班時間")
    today = (
        row is not None and row.at is not None and row.lat is not None and row.lng is not None
        and _date(row.at) == _date(now)
    )
    where = {"lat": row.lat, "lng": row.lng, "at": row.at} if today else {}
    if row is not None and row.paused:
        return Seen("暫停分享位置" + (f" · 最後位置 {_clock(row.at)}" if today else ""), **where)
    if row is not None and row.denied:
        return Seen("沒有開定位權限", **where)
    if not today:
        return Seen("今天還沒有位置")
    here = (row.lat, row.lng)
    age = now - row.at
    if age > STALE_AFTER:
        area = _nearest(here, areas, AREA_WITHIN_KM)
        return Seen(f"最後位置 {_clock(row.at)}" + (f"，在{area.label}" if area else ""), **where)
    ago = _ago(age)
    near = _nearest(here, stops, NEAR_METERS / 1000)
    if near:
        return Seen(f"在{near.name}附近{ago}", live=True, **where)
    upcoming = next((stop for stop in stops if not stop.done), None)
    if upcoming:
        return Seen(f"往第 {upcoming.number} 站{upcoming.name}途中{ago}", live=True, **where)
    return Seen(f"今天跑完了{ago}", live=True, **where)


def area_label(area: str, city: str) -> str:
    """地區給人看的寫法：直轄市的區加「區」（內湖 → 內湖區）；本來就有「區」的、縣裡的鄉鎮市不加。"""
    return area if area.endswith("區") or not city.endswith("市") else f"{area}區"


def _nearest[P: (StopPoint, AreaPoint)](here: travel.Point, points: list[P], within_km: float) -> P | None:
    best = min(points, key=lambda p: travel.straight_km(here, (p.lat, p.lng)), default=None)
    if best is None or travel.straight_km(here, (best.lat, best.lng)) > within_km:
        return None
    return best


def _ago(age: dt.timedelta) -> str:
    minutes = int(age.total_seconds() // 60)
    return f" · {minutes} 分鐘前" if minutes >= 1 else ""


def _clock(at: dt.datetime) -> str:
    return at.astimezone(TAIPEI).strftime("%H:%M")


def _date(at: dt.datetime) -> dt.date:
    return at.astimezone(TAIPEI).date()
```

- [ ] **Step 4: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_location_text.py backend/tests/test_locations.py -q`
Expected: 全部通過

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/locations.py backend/tests/test_location_text.py
git commit -m "Describe where a rep is in one line: off hours, paused, denied, near a stop, on the way, done

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 心跳帶位置、暫停與繼續、WebSocket 只轉給看得到的人

**Files:**
- Modify: `backend/app/realtime.py`
- Modify: `backend/app/api/presence.py`
- Create: `backend/app/api/location.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_location_api.py`

**Interfaces:**
- Consumes: Task 1 的 `locations.report`、`set_paused`、`state`、`NotSharing`、`ShareState`；`team_itineraries.find_rep(session, viewer, rep_id)`（第 5 階段）；`MANAGER_SIDE_ROLES`（`api/auth.py`）。
- Produces:
  - `realtime.location_changed(user_id)`、`realtime.itinerary_changed(user_id)`（Task 4 會用後者）
  - `POST /api/presence/ping` 的 body 多 `location: {lat, lng, accuracy?} | null`、`location_denied: bool`；WebSocket 的 `{"type": "ping"}` 也可以帶這兩個欄位
  - WebSocket 送給看得到那位業務的主管與 IT：`{"type": "location", "user_id": "U01"}`、`{"type": "itinerary", "user_id": "U01"}`
  - `GET /api/location/me`、`POST /api/location/pause`、`POST /api/location/resume` → `{"applies", "paused", "denied", "manager_name", "hours": {"weekdays": [1..], "start": "08:30", "end": "18:30"}}`

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_location_api.py`：

```python
"""位置的 API：心跳帶位置、暫停與繼續、分享狀態，以及 WebSocket 只把位置事件送給看得到的主管。"""

import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app import realtime
from app.main import app
from app.models import UserLocation, UserPresence

TAIPEI_101 = {"lat": 25.034, "lng": 121.5645, "accuracy": 15}


@pytest.fixture(autouse=True)
def clean(engine):
    """心跳與 WebSocket 不在 tx 裡，會真的寫進資料庫：前後清掉位置與在線狀態。"""

    def clear():
        with engine.begin() as conn:
            conn.execute(delete(UserLocation))
            conn.execute(delete(UserPresence))

    clear()
    yield
    clear()


@pytest.fixture
def always(env):
    """測試不看現在幾點：整個星期都算上班時間。"""
    env(LOCATION_SHARE_HOURS="1-7 00:00-24:00")


@pytest.fixture
def events(monkeypatch):
    sent = []
    monkeypatch.setattr(realtime, "publish", sent.append)
    return sent


@pytest.fixture
def client():
    return TestClient(app)


def ping(client, headers, **body):
    response = client.post("/api/presence/ping", json={"active": True, **body}, headers=headers)
    assert response.status_code == 200, response.text


def location_of(engine, user_id):
    with Session(engine) as session:
        return session.get(UserLocation, user_id)


def test_a_heartbeat_with_a_location_saves_it_and_tells_managers(client, auth, always, events, engine):
    ping(client, auth("U01"), location=TAIPEI_101)
    row = location_of(engine, "U01")
    assert (row.lat, row.lng, row.accuracy_m) == (25.034, 121.5645, 15)
    assert {"type": "location", "user_id": "U01"} in events


def test_heartbeats_outside_work_hours_are_not_saved(client, auth, env, events, engine):
    env(LOCATION_SHARE_HOURS="1-7 00:00-00:00")
    ping(client, auth("U01"), location=TAIPEI_101)
    assert location_of(engine, "U01") is None
    assert not [event for event in events if event["type"] == "location"]


def test_a_denied_browser_is_recorded(client, auth, always, engine):
    ping(client, auth("U01"), location_denied=True)
    assert location_of(engine, "U01").denied is True


def test_a_managers_heartbeat_never_saves_a_location(client, auth, always, engine):
    ping(client, auth("M01"), location=TAIPEI_101)
    assert location_of(engine, "M01") is None


def test_an_impossible_location_is_rejected(client, auth):
    response = client.post("/api/presence/ping", json={"active": True, "location": {"lat": 121.5, "lng": 25.0}}, headers=auth("U01"))
    assert response.status_code == 422


def test_pause_and_resume(client, auth, always, events, engine):
    paused = client.post("/api/location/pause", headers=auth("U01"))
    assert paused.status_code == 200 and paused.json()["paused"] is True
    assert {"type": "location", "user_id": "U01"} in events
    ping(client, auth("U01"), location=TAIPEI_101)
    assert location_of(engine, "U01").lat is None
    resumed = client.post("/api/location/resume", headers=auth("U01"))
    assert resumed.json()["paused"] is False
    ping(client, auth("U01"), location=TAIPEI_101)
    assert location_of(engine, "U01").lat == 25.034
    denied = client.post("/api/location/pause", headers=auth("M01"))
    assert denied.status_code == 403 and denied.json()["detail"] == "只有業務會分享位置"


def test_my_share_state(client, auth):
    assert client.get("/api/location/me", headers=auth("U01")).json() == {
        "applies": True,
        "paused": False,
        "denied": False,
        "manager_name": "陳建宏",
        "hours": {"weekdays": [1, 2, 3, 4, 5], "start": "08:30", "end": "18:30"},
    }
    assert client.get("/api/location/me", headers=auth("M01")).json()["applies"] is False
    assert client.get("/api/location/me").status_code == 401


# WebSocket


def connect(ws, engine, user_id: str) -> None:
    from conftest import token_for

    ws.send_json({"type": "auth", "token": token_for(engine, user_id), "active": True})
    assert ws.receive_json() == {"type": "ready", "user_id": user_id}
    assert ws.receive_json()["type"] == "presence"


def next_of(ws, kind: str) -> dict:
    """略過別種事件（例如狀態），拿下一則這一種的。"""
    while True:
        event = ws.receive_json()
        if event["type"] == kind:
            return event


def test_location_events_reach_only_managers_who_can_see_the_rep(client, engine, auth, always):
    with client.websocket_connect("/api/ws") as north, client.websocket_connect("/api/ws") as south:
        connect(north, engine, "M01")
        connect(south, engine, "M03")
        ping(client, auth("U01"), location=TAIPEI_101)
        ping(client, auth("U04"), location={"lat": 22.69, "lng": 120.29})
        assert next_of(north, "location") == {"type": "location", "user_id": "U01"}
        # 林昱辰的先發，南區的主管卻先收到吳承翰的：林昱辰那一則沒有送給他
        assert next_of(south, "location") == {"type": "location", "user_id": "U04"}


def test_a_websocket_heartbeat_can_carry_the_location(client, engine, always):
    with client.websocket_connect("/api/ws") as rep:
        connect(rep, engine, "U01")
        # active 跟連上時不一樣，伺服器才不會當成 5 秒內重複的心跳略過
        rep.send_json({"type": "ping", "active": False, "location": {"lat": 25.034, "lng": 121.5645, "accuracy": 8}})
        row = None
        for _ in range(60):
            row = location_of(engine, "U01")
            if row is not None and row.lat is not None:
                break
            time.sleep(0.05)
        assert (row.lat, row.lng, row.accuracy_m) == (25.034, 121.5645, 8)
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_location_api.py -q`
Expected: FAIL（位置沒寫、`/api/location/*` 404）

- [ ] **Step 3: 事件**

`backend/app/realtime.py`：模組說明的事件清單最後加兩行：

```
- {"type": "location", "user_id": "U01"}：這位業務的位置或分享狀態變了，只送給看得到他的主管與 IT
- {"type": "itinerary", "user_id": "U01"}：這位業務今天的行程變了（改了順序、跑完一站…），同上
```

檔案最後加：

```python
def location_changed(user_id: str) -> None:
    publish({"type": "location", "user_id": user_id})


def itinerary_changed(user_id: str) -> None:
    publish({"type": "itinerary", "user_id": user_id})
```

- [ ] **Step 4: 心跳收位置、WebSocket 轉事件**

`backend/app/api/presence.py`：

1. import 改成（只加需要的）：
   ```python
   from pydantic import BaseModel, Field, ValidationError
   ...
   from app.api.auth import MANAGER_SIDE_ROLES, CurrentUser
   ...
   from app.services import auth, channels, locations, presence, team_itineraries
   ```
2. 常數區（`MAX_CONNECTIONS` 後面）加：
   ```python
   # 每條連線記住看不看得到某位業務的位置與行程事件：位置事件很密，不必每一則都查資料庫。組織改了最慢 5 分鐘生效
   SEE_REP_CACHE_SECONDS = 300
   ```
3. `class PingInput` 改成（前面加 `LocationInput`）：
   ```python
   class LocationInput(BaseModel):
       lat: float = Field(ge=-90, le=90)
       lng: float = Field(ge=-180, le=180)
       # 誤差幾公尺（瀏覽器的 coords.accuracy）
       accuracy: float | None = Field(default=None, ge=0)


   class PingInput(BaseModel):
       active: bool
       # 業務的手機在上班時間多帶目前的位置；瀏覽器拒絕定位時改帶 location_denied（services/locations.py）
       location: LocationInput | None = None
       location_denied: bool = False
   ```
4. `ping` 改成：
   ```python
   @router.post("/api/presence/ping", response_model=Statuses)
   def ping(session: SessionDep, user: CurrentUser, body: PingInput):
       """WebSocket 連不上時的心跳，順便回全部的狀態。業務的心跳多帶位置。"""
       try:
           changed = presence.touch(session, user, body.active)
       except presence.SignedOut:
           raise HTTPException(status.HTTP_401_UNAUTHORIZED, "請重新登入") from None
       position = (body.location.lat, body.location.lng, body.location.accuracy) if body.location else None
       rep_id = locations.report(session, user, position, body.location_denied)
       session.commit()
       if changed:
           realtime.presence_changed()
       if rep_id:
           realtime.location_changed(rep_id)
       return Statuses(statuses=presence.statuses(session))
   ```
5. `_heartbeat` 改成：
   ```python
   def _heartbeat(
       token: str, active: bool, position: tuple[float, float, float | None] | None = None, denied: bool = False
   ) -> str | None:
       """驗 token 並記一次心跳（業務的心跳順便記位置），回傳帳號；token 不對（過期、登出、被別的裝置頂掉、停用）回 None。"""
       with session_factory()() as session:
           try:
               user = auth.user_from_token(session, token)
           except auth.AuthError:
               return None
           user_id = user.id
           try:
               changed = presence.touch(session, user, active)
           except presence.SignedOut:
               return None
           rep_id = locations.report(session, user, position, denied)
           session.commit()
       if changed:
           realtime.presence_changed()
       if rep_id:
           realtime.location_changed(rep_id)
       return user_id
   ```
6. `_can_see` 後面加：
   ```python
   def _can_see_rep(viewer_id: str, rep_id: str) -> bool:
       """這條連線的人看不看得到這位業務的位置與行程：主管看自己底下的人、IT 看全公司（跟主管端同一個範圍）。"""
       with session_factory()() as session:
           viewer = session.get(AppUser, viewer_id)
           if viewer is None or viewer.deactivated_at is not None or viewer.role not in MANAGER_SIDE_ROLES:
               return False
           return team_itineraries.find_rep(session, viewer, rep_id) is not None


   def _position(value: object) -> tuple[float, float, float | None] | None:
       """WebSocket 心跳帶來的位置；格式不對就當作沒帶（跟 HTTP 心跳用同一個 LocationInput 驗）。"""
       if not isinstance(value, dict):
           return None
       try:
           parsed = LocationInput.model_validate(value)
       except ValidationError:
           return None
       return parsed.lat, parsed.lng, parsed.accuracy
   ```
7. `_Connection.__init__` 最後加：
   ```python
           # 看不看得到某位業務：{業務 id: (看得到嗎, 查的時間)}
           self.reps_seen: dict[str, tuple[bool, float]] = {}
   ```
   並在 `send_presence` 前面加方法：
   ```python
       async def can_see_rep(self, rep_id: str) -> bool:
           cached = self.reps_seen.get(rep_id)
           if cached and time.monotonic() - cached[1] < SEE_REP_CACHE_SECONDS:
               return cached[0]
           allowed = await run_in_threadpool(_can_see_rep, self.user_id, rep_id)
           self.reps_seen[rep_id] = (allowed, time.monotonic())
           return allowed
   ```
8. `read()` 裡 `if await run_in_threadpool(_heartbeat, self.token, active) is None:` 改成：
   ```python
               position = _position(data.get("location"))
               denied = data.get("location_denied") is True
               if await run_in_threadpool(_heartbeat, self.token, active, position, denied) is None:
   ```
9. `listen()` 裡 `elif event.get("type") == "message":` 那一段後面加：
   ```python
               elif event.get("type") in ("location", "itinerary"):
                   rep_id = str(event.get("user_id"))
                   # 只送給看得到這位業務的人：別人的位置連「動了」都不能透露
                   if await self.can_see_rep(rep_id):
                       await self.send({"type": event["type"], "user_id": rep_id})
   ```

模組說明第一段「一條 WebSocket（/api/ws）同時送兩件事：有人的狀態變了、看得到的頻道有新訊息。」改成「一條 WebSocket（/api/ws）送幾件事：有人的狀態變了、看得到的頻道有新訊息，以及（主管與 IT）看得到的業務的位置或今天的行程變了。業務的心跳順便帶位置（services/locations.py）。」

- [ ] **Step 5: 暫停、繼續與分享狀態的 API**

`backend/app/api/location.py`：

```python
"""位置分享（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈即時位置〉）：業務首頁的分享列要的狀態、
暫停與繼續。位置本身跟著在線狀態的心跳送（api/presence.py）。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import realtime
from app.api.auth import CurrentUser
from app.db import get_session
from app.services import locations

router = APIRouter(prefix="/api/location", tags=["location"])
SessionDep = Annotated[Session, Depends(get_session)]
NOT_SHARING = "只有業務會分享位置"


class Hours(BaseModel):
    weekdays: list[int]  # 1（一）～7（日）
    start: str  # HH:MM
    end: str  # HH:MM，這一分鐘起就是下班


class ShareState(BaseModel):
    # 這個帳號會不會分享位置（業務與代理示範業務的帳號會，主管與 IT 不會）
    applies: bool
    paused: bool
    denied: bool
    # 分享列寫「{主管名}看得到你在哪」
    manager_name: str | None
    hours: Hours


def _clock(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _out(state: locations.ShareState) -> ShareState:
    hours = state.hours
    return ShareState(
        applies=state.applies, paused=state.paused, denied=state.denied, manager_name=state.manager_name,
        hours=Hours(weekdays=sorted(hours.weekdays), start=_clock(hours.start), end=_clock(hours.end)),
    )


@router.get("/me", response_model=ShareState)
def get_mine(session: SessionDep, user: CurrentUser):
    return _out(locations.state(session, user))


def _set(session: Session, user, paused: bool) -> ShareState:
    try:
        rep_id = locations.set_paused(session, user, paused)
    except locations.NotSharing:
        raise HTTPException(403, NOT_SHARING) from None
    session.commit()
    realtime.location_changed(rep_id)
    return _out(locations.state(session, user))


@router.post("/pause", response_model=ShareState)
def pause(session: SessionDep, user: CurrentUser):
    """暫停分享：不再寫位置，主管看到「暫停分享位置」。"""
    return _set(session, user, True)


@router.post("/resume", response_model=ShareState)
def resume(session: SessionDep, user: CurrentUser):
    return _set(session, user, False)
```

`backend/app/main.py`：在 `from app.api import maps  # 行程第 4 階段：主管頁的地圖金鑰` 下面加一行 `from app.api import location  # 行程第 6 階段：即時位置`，`app.include_router(maps.router)` 下面加 `app.include_router(location.router)`。

- [ ] **Step 6: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_location_api.py backend/tests/test_presence.py -q`
Expected: 全部通過（原本的在線狀態測試不受影響）

- [ ] **Step 7: Commit**

```bash
git add backend/app/realtime.py backend/app/api/presence.py backend/app/api/location.py backend/app/main.py backend/tests/test_location_api.py
git commit -m "Carry the rep's location on the presence heartbeat, let reps pause sharing, and tell only their managers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 行程變了就發事件

**Files:**
- Modify: `backend/app/realtime.py`
- Modify: `backend/app/api/admin.py`（`reset_demo_itinerary`）
- Test: `backend/tests/test_itinerary_events.py`

**Interfaces:**
- Consumes: `realtime.itinerary_changed`（Task 3）；`models.Itinerary`、`models.Visit`。
- Produces: 任何 commit 只要新增、修改或刪除了 `Itinerary`（行程的每一種改動都會加版本），或確認了一筆拜訪（`Visit.confirmed_at` 從空變成有值），commit 之後就對那位業務發一次 `itinerary` 事件；rollback 就不發。整批 DELETE（IT 重置示範業務的行程）看不到，由 admin 的 API 自己發。另一個分支之後新增的行程 API 不必各自記得發事件。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_itinerary_events.py`：

```python
"""行程變了就在 commit 之後發 itinerary 事件，主管頁收到 3 秒後重拿。"""

import datetime as dt

import pytest
from fastapi.testclient import TestClient

from app import realtime
from app.main import app
from app.models import Visit
from app.services import itinerary as itineraries
from app.timeutil import TAIPEI


@pytest.fixture
def events(monkeypatch):
    sent = []
    monkeypatch.setattr(realtime, "publish", sent.append)
    return sent


def changed(events):
    return [event["user_id"] for event in events if event["type"] == "itinerary"]


def test_a_saved_change_is_announced_after_commit(tx, events):
    itinerary = itineraries.get_or_create(tx, "U02")
    tx.commit()
    events.clear()
    last = itineraries.view(tx, itinerary).stops[-1]
    itineraries.apply_feedback(tx, "U02", last.customer_id, "pin", itinerary.version)
    tx.flush()
    # 還沒 commit：別人還看不到這個改動，不能先通知
    assert changed(events) == []
    tx.commit()
    assert changed(events) == ["U02"]


def test_a_rolled_back_change_is_not_announced(tx, events):
    itinerary = itineraries.get_or_create(tx, "U02")
    tx.commit()
    events.clear()
    last = itineraries.view(tx, itinerary).stops[-1]
    itineraries.apply_feedback(tx, "U02", last.customer_id, "pin", itinerary.version)
    tx.flush()
    tx.rollback()
    tx.commit()
    assert changed(events) == []


def test_confirming_a_visit_is_announced_but_editing_it_later_is_not(tx, events):
    at = dt.datetime(2026, 10, 28, 9, 40, tzinfo=TAIPEI)
    visit = Visit(id="VEVENT1", customer_id="C001", user_id="U01", visited_at=at, transcript="測試", status="draft")
    tx.add(visit)
    tx.commit()
    assert changed(events) == []
    visit.confirmed_at, visit.status = at, "synced"
    tx.commit()
    assert changed(events) == ["U01"]
    events.clear()
    visit.transcript = "改過逐字稿"
    tx.commit()
    assert changed(events) == []


def test_resetting_the_demo_reps_itinerary_is_announced(tx, events, auth):
    client = TestClient(app)
    assert client.get("/api/itinerary/today", headers=auth("U01")).status_code == 200
    events.clear()
    assert client.post("/api/admin/demo-itinerary/reset", headers=auth("A01")).status_code == 200
    assert changed(events) == ["U01"]
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_itinerary_events.py -q`
Expected: FAIL（沒有任何 itinerary 事件）

- [ ] **Step 3: commit 之後發事件**

`backend/app/realtime.py`：

1. import 區加：
   ```python
   from sqlalchemy import event, inspect
   from sqlalchemy.orm import Session

   from app.models import Itinerary, Visit
   ```
2. 檔案最後加：

```python
# 行程變了就通知主管頁（{"type": "itinerary"}）。行程的每一種改動都會改 Itinerary（加版本），所以看這張表就夠，
# 加上確認拜訪（跑完一站）；不必每一支 API 各自記得發。事件在 commit 之後才發：沒 commit 的改動別人讀不到，
# 先通知只會讓主管頁拿到舊的那份。整批 DELETE（IT 重置示範業務的行程）看不到，由那支 API 自己發
_PENDING = "realtime:itinerary_changed"


@event.listens_for(Session, "after_flush")
def _collect_itinerary_changes(session: Session, flush_context) -> None:
    reps = session.info.setdefault(_PENDING, set())
    for obj in (*session.new, *session.dirty, *session.deleted):
        if isinstance(obj, Itinerary) and (obj in session.new or obj in session.deleted or session.is_modified(obj)):
            reps.add(obj.user_id)
        elif (
            isinstance(obj, Visit) and obj.confirmed_at is not None
            and inspect(obj).attrs.confirmed_at.history.has_changes()
        ):
            reps.add(obj.user_id)


@event.listens_for(Session, "after_commit")
def _announce_itinerary_changes(session: Session) -> None:
    for user_id in session.info.pop(_PENDING, set()):
        itinerary_changed(user_id)


@event.listens_for(Session, "after_rollback")
def _forget_itinerary_changes(session: Session) -> None:
    session.info.pop(_PENDING, None)
```

如果 `after_commit` 在 `tx` fixture（`join_transaction_mode="create_savepoint"`）裡不會觸發，`test_a_saved_change_is_announced_after_commit` 會失敗：那就改用 `after_transaction_end`（`transaction.parent is None` 而且不是 rollback 時才發），並在報告裡寫清楚改了什麼、為什麼。

3. `backend/app/api/admin.py` 的 `reset_demo_itinerary`，`session.commit()` 後面加：
   ```python
       # 重置用整批 DELETE，不經過 ORM 物件，realtime 的 after_flush 看不到：主管頁要另外通知
       realtime.itinerary_changed(EXTERNAL_ACCOUNT_ACTS_AS)
   ```
   （檔案開頭沒有 import `realtime` 的話加 `from app import realtime`。）

- [ ] **Step 4: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests -q`
Expected: 全部通過

- [ ] **Step 5: Commit**

```bash
git add backend/app/realtime.py backend/app/api/admin.py backend/tests/test_itinerary_events.py
git commit -m "Announce an itinerary change to managers after it commits, including finished visits and the demo reset

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: 主管端看得到位置

**Files:**
- Modify: `backend/app/services/team_itineraries.py`
- Modify: `backend/app/api/manager.py`
- Test: `backend/tests/test_team_itineraries.py`、`backend/tests/test_team_itineraries_api.py`

**Interfaces:**
- Consumes: Task 2 的 `locations.describe`、`StopPoint`、`AreaPoint`、`Seen`、`area_label`、`now`、`share_hours`；`today_route.done_visits(session, user_id, today)`；`customer_profile.app_today(session)`。
- Produces:
  - `RepRoute.location: locations.Seen`；`team_itineraries.describe_location(session, rep, stops: list[StopPoint]) -> Seen`；`team_itineraries.locations_now(session, viewer) -> dict[str, Seen]`（只拿位置，不重算行程、不問 Google）
  - API：`RepRoute` JSON 多 `"location": {"text", "lat", "lng", "at", "live"}`；`GET /api/manager/locations` → `{"updated_at": "HH:MM", "locations": {"U01": {...}}}`

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_team_itineraries.py`：import 那幾行改成

```python
from app.models import AppUser, Customer, Itinerary, OrgUnit, UserLocation, Visit
from app.services import google_routes, locations, travel
```

（其餘 import 不動），檔案最後加：

```python
def test_the_route_says_where_the_rep_is(tx, env):
    env(LOCATION_SHARE_HOURS="1-7 00:00-24:00")
    first = team.route(tx, person(tx, "U01")).stops[0]
    tx.add(UserLocation(user_id="U01", lat=first.lat, lng=first.lng, at=locations.now(), paused=False, denied=False))
    tx.flush()
    seen = team.route(tx, person(tx, "U01")).location
    assert seen.text == f"在{team.short_name(tx.get(Customer, first.customer_id))}附近"
    assert seen.live is True and (seen.lat, seen.lng) == (first.lat, first.lng)


def test_off_hours_and_no_location_yet(tx, env):
    env(LOCATION_SHARE_HOURS="1-7 00:00-00:00")
    assert team.route(tx, person(tx, "U02")).location == locations.Seen("下班時間")
    env(LOCATION_SHARE_HOURS="1-7 00:00-24:00")
    assert team.route(tx, person(tx, "U02")).location == locations.Seen("今天還沒有位置")


def test_locations_alone_say_the_same_without_recomputing_the_route(tx, env, monkeypatch):
    env(LOCATION_SHARE_HOURS="1-7 00:00-24:00")
    team.route(tx, person(tx, "U01"))
    # 陽明山上：離每一站都遠，也不在任何客戶 3 公里內
    tx.add(UserLocation(
        user_id="U01", lat=25.16, lng=121.55, at=locations.now() - dt.timedelta(minutes=2), paused=False, denied=False,
    ))
    tx.flush()
    full = team.route(tx, person(tx, "U01")).location.text
    assert full.startswith("往第 1 站") and full.endswith("途中 · 2 分鐘前")

    def no_driving(*args, **kwargs):
        raise AssertionError("只拿位置不該重算車程")

    monkeypatch.setattr(travel, "along", no_driving)
    monkeypatch.setattr(travel, "matrix", no_driving)
    found = team.locations_now(tx, person(tx, "M01"))
    assert set(found) == {"U01", "U02"}
    assert found["U01"].text == full


def test_locations_alone_number_the_stops_like_the_route(tx, env):
    env(LOCATION_SHARE_HOURS="1-7 00:00-24:00")
    itinerary = itineraries.get_or_create(tx, "U01")
    target = itineraries.view(tx, itinerary).stops[2]
    at = dt.datetime(2026, 10, 28, 9, 40, tzinfo=TAIPEI)
    tx.add(Visit(id="VTEAM2", customer_id=target.customer_id, user_id="U01", visited_at=at,
                 transcript="測試", status="synced", confirmed_at=at))
    tx.add(UserLocation(user_id="U01", lat=25.16, lng=121.55, at=locations.now(), paused=False, denied=False))
    tx.flush()
    # 跑完的那一家排第 1 站，下一站是第 2 站
    full = team.route(tx, person(tx, "U01")).location.text
    assert full.startswith("往第 2 站")
    assert team.locations_now(tx, person(tx, "M01"))["U01"].text == full
```

`backend/tests/test_team_itineraries_api.py`：`ROUTE_FIELDS` 多一個 `"location"`，檔案最後加：

```python
def test_the_route_carries_the_location_line(client, auth):
    first = client.get("/api/manager/itineraries", headers=auth("M01")).json()["reps"][0]
    assert set(first["location"]) == {"text", "lat", "lng", "at", "live"}


def test_locations_alone_for_live_updates(client, auth):
    response = client.get("/api/manager/locations", headers=auth("M01"))
    assert response.status_code == 200, response.text
    data = response.json()
    assert re.fullmatch(r"\d\d:\d\d", data["updated_at"])
    assert set(data["locations"]) == {"U01", "U02"}
    assert set(data["locations"]["U01"]) == {"text", "lat", "lng", "at", "live"}
    assert client.get("/api/manager/locations", headers=auth("U01")).status_code == 403
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests/test_team_itineraries.py backend/tests/test_team_itineraries_api.py -q`
Expected: FAIL（`RepRoute` 沒有 `location`、`locations_now`；API 404）

- [ ] **Step 3: 服務**

`backend/app/services/team_itineraries.py`：

1. 模組說明最後加一句：「位置那一行（services/locations.describe）也在這裡組：今天的站與這位業務的客戶地區。」
2. import 改成：
   ```python
   import datetime as dt
   ...
   from app.models import AppUser, Customer, Itinerary, ItineraryStop, OrgUnit, UserLocation
   from app.services import customer_profile, locations, today_route, travel
   from app.services import itinerary as itineraries
   ```
   （`from app.services.scope ...`、`from app.services.today_route import SIGNAL_LABEL` 照舊）
3. `RepRoute` 的 `untouched: bool` 後面加 `location: locations.Seen  # 主管看到的位置那一行，加上地圖上頭像畫在哪`。
4. `route()` 的 `return RepRoute(...)` 前面加：
   ```python
       location = describe_location(session, rep, [
           locations.StopPoint(s.number, _short(s.customer_name, s.area), s.lat, s.lng, s.status == "done") for s in stops
       ])
   ```
   並在 `RepRoute(...)` 裡加 `location=location`。
5. `short_name` 改成兩個函式：
   ```python
   def short_name(customer: Customer) -> str:
       """店名去掉後面的地區（「杏林診所 · 大安」→「杏林診所」）；連鎖分店的「康泰 · 忠孝店」後面是分店，不去掉。"""
       return _short(customer.name, customer.area)


   def _short(name: str, area: str) -> str:
       return name.removesuffix(f" · {area}")
   ```
6. `moved_sentences` 後面加：

```python
def describe_location(session: Session, rep: AppUser, stops: list[locations.StopPoint]) -> locations.Seen:
    """這位業務現在在哪，一句話（卡片與詳細的那一行）。"""
    return locations.describe(
        locations.now(), locations.share_hours(), session.get(UserLocation, rep.id), stops, _areas(session, rep)
    )


def locations_now(session: Session, viewer: AppUser) -> dict[str, locations.Seen]:
    """看得到的每位業務現在在哪。主管頁收到位置事件時只拿這個：不重算行程的時間與車程，也不問 Google。"""
    today = customer_profile.app_today(session)
    return {rep.id: describe_location(session, rep, _stop_points(session, rep, today)) for rep in reps(session, viewer)}


def _stop_points(session: Session, rep: AppUser, today: dt.date) -> list[locations.StopPoint]:
    """今天的站，站號跟 itinerary.view 一樣：跑完的在前（照拜訪時間），其他照存著的順序。今天還沒有行程就是沒有站。"""
    itinerary = session.scalar(select(Itinerary).where(Itinerary.user_id == rep.id, Itinerary.date == today))
    if itinerary is None:
        return []
    done = today_route.done_visits(session, rep.id, today)
    done_ids = {customer.id for _, customer in done}
    rows = session.scalars(
        select(ItineraryStop).where(ItineraryStop.itinerary_id == itinerary.id)
        .order_by(ItineraryStop.position, ItineraryStop.id)
    )
    open_ids = [row.customer_id for row in rows if row.customer_id not in done_ids]
    customers = _customers(session, open_ids)
    ordered = [(customer, True) for _, customer in done] + [(customers[cid], False) for cid in open_ids]
    return [
        locations.StopPoint(n + 1, _short(customer.name, customer.area), customer.lat, customer.lng, finished)
        for n, (customer, finished) in enumerate(ordered)
    ]


def _areas(session: Session, rep: AppUser) -> list[locations.AreaPoint]:
    """這位業務每一家客戶的位置與地區：「最後位置 10:41，在內湖區」用。"""
    rows = session.execute(
        select(Customer.lat, Customer.lng, Customer.area, Customer.city).where(Customer.owner_user_id == rep.id)
    )
    return [locations.AreaPoint(lat, lng, locations.area_label(area, city)) for lat, lng, area, city in rows]
```

- [ ] **Step 4: API**

`backend/app/api/manager.py`：

1. `class TeamRemovedStop` 後面加：
   ```python
   class SeenLocation(BaseModel):
       # 主管看到的那一行（services/locations.describe）
       text: str
       # 地圖上頭像畫在哪；沒有（下班、今天還沒有位置）就不畫
       lat: float | None
       lng: float | None
       at: dt.datetime | None
       # 分享中而且 5 分鐘內有更新；暫停、沒權限、太久沒更新的頭像是灰的
       live: bool
   ```
2. `class RepRoute` 最後加 `location: SeenLocation`；`_route_out` 的 `RepRoute(...)` 加 `location=SeenLocation(**dataclasses.asdict(route.location))`。
3. 檔案最後加：

```python
class TeamLocations(BaseModel):
    updated_at: str  # 台北的真實時間 HH:MM
    locations: dict[str, SeenLocation]


@router.get("/locations", response_model=TeamLocations)
def team_locations(session: SessionDep, manager: ManagerUser):
    """看得到的業務現在在哪。主管頁收到位置事件時只重拿這個：不重算行程、不問 Google。"""
    found = team.locations_now(session, manager)
    return TeamLocations(
        updated_at=dt.datetime.now(TAIPEI).strftime("%H:%M"),
        locations={rep_id: SeenLocation(**dataclasses.asdict(seen)) for rep_id, seen in found.items()},
    )
```

- [ ] **Step 5: 跑測試確認通過**

Run: `TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests -q`
Expected: 全部通過

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/team_itineraries.py backend/app/api/manager.py backend/tests/test_team_itineraries.py backend/tests/test_team_itineraries_api.py
git commit -m "Show managers where each rep is, and serve locations alone for live updates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 手機端：追蹤位置、心跳帶上去

**Files:**
- Create: `frontend/src/api/location.ts`
- Modify: `frontend/src/api/presence.ts`（`pingPresence`）
- Create: `frontend/src/lib/location-share.ts`
- Test: `frontend/src/lib/location-share.test.ts`
- Modify: `frontend/src/lib/realtime.ts`、`frontend/src/lib/realtime.test.ts`
- Modify: `frontend/src/lib/channel-unread.ts`、`frontend/src/pages/channels.tsx`

**Interfaces:**
- Consumes: Task 3 的 `GET /api/location/me`、`POST /api/location/pause|resume`、心跳的 `location`／`location_denied`；`readUser`、`onAuthChange`（`lib/auth.ts`）。
- Produces:
  - `api/location.ts`：`ShareHours`、`ShareState`、`getShareState(signal?)`、`pauseSharing()`、`resumeSharing()`
  - `api/presence.ts`：`HeartbeatLocation`、`pingPresence(active, extra?)`
  - `lib/location-share.ts`：`withinHours(at, hours)`、`BarState`、`ShareSnapshot`、`Position`、`barState(snapshot, now)`、`heartbeatPayload(snapshot, now)`、`barText(state, managerName, hours)`、`GeoEnv`、`LocationShare`（`getSnapshot`、`subscribe`、`load()`、`consent()`、`setShare(share)`、`reset()`、`heartbeat()`）、`locationShare`、`useLocationShare()`
  - `lib/realtime.ts`：`RealtimeEnv.heartbeat()`、`RealtimeEnv.ping(active, extra)`；`RealtimeEvent` 多 `{ type: "location"; user_id: string }`、`{ type: "itinerary"; user_id: string }`

- [ ] **Step 1: API**

`frontend/src/api/location.ts`：

```ts
import { request } from "@/api/client"

// 上班時間（後端 LOCATION_SHARE_HOURS）：星期 1（一）～7（日），start 起、end 前，台北時間
export type ShareHours = { weekdays: number[]; start: string; end: string }

// 業務首頁分享列要的：這個帳號會不會分享（主管與 IT 不會）、暫停了沒、主管是誰、上班時間
export type ShareState = {
  applies: boolean
  paused: boolean
  denied: boolean
  manager_name: string | null
  hours: ShareHours
}

export function getShareState(signal?: AbortSignal) {
  return request<ShareState>("/api/location/me", { signal })
}

/** 暫停分享：不再送位置，主管看到「暫停分享位置」 */
export function pauseSharing() {
  return request<ShareState>("/api/location/pause", { method: "POST" })
}

export function resumeSharing() {
  return request<ShareState>("/api/location/resume", { method: "POST" })
}
```

`frontend/src/api/presence.ts`：`pingPresence` 改成

```ts
// 業務的心跳多帶的（lib/location-share.ts）：分享中帶最新的位置，瀏覽器拒絕定位時帶 location_denied，其他時候是空的
export type HeartbeatLocation = {
  location?: { lat: number; lng: number; accuracy: number | null }
  location_denied?: true
}

/** WebSocket 連不上時的心跳，回不是離線的人的狀態 */
export function pingPresence(active: boolean, extra: HeartbeatLocation = {}) {
  return request<{ statuses: Record<string, PresenceStatus> }>("/api/presence/ping", jsonBody("POST", { active, ...extra }))
}
```

- [ ] **Step 2: 寫失敗的測試**

`frontend/src/lib/location-share.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest"

import type { ShareState } from "@/api/location"
import {
  barState,
  barText,
  heartbeatPayload,
  LocationShare,
  withinHours,
  type GeoEnv,
  type Position,
  type ShareSnapshot,
} from "@/lib/location-share"

const HOURS = { weekdays: [1, 2, 3, 4, 5], start: "08:30", end: "18:30" }
const SHARE: ShareState = { applies: true, paused: false, denied: false, manager_name: "陳建宏", hours: HOURS }
// 2026-10-01 是星期四
const WORKING = new Date("2026-10-01T10:00:00+08:00")
const HERE: Position = { lat: 25.034, lng: 121.5645, accuracy: 12 }

const snapshot = (extra: Partial<ShareSnapshot> = {}): ShareSnapshot => ({
  share: SHARE,
  consented: true,
  denied: false,
  position: HERE,
  ...extra,
})

describe("上班時間", () => {
  it.each([
    ["2026-10-01T08:29:00+08:00", false],
    ["2026-10-01T08:30:00+08:00", true],
    ["2026-10-01T18:29:00+08:00", true],
    ["2026-10-01T18:30:00+08:00", false],
    // 星期六
    ["2026-10-03T10:00:00+08:00", false],
    // 看的是台北時間，不是手機的時區
    ["2026-10-01T00:30:00Z", true],
  ])("%s → %s", (iso, inside) => {
    expect(withinHours(new Date(iso), HOURS)).toBe(inside)
  })
})

describe("分享列與心跳", () => {
  it("不是業務、下班時間、還沒載入：不顯示也不帶", () => {
    for (const s of [snapshot({ share: { ...SHARE, applies: false } }), snapshot({ share: null })]) {
      expect(barState(s, WORKING)).toBe("hidden")
      expect(heartbeatPayload(s, WORKING)).toEqual({})
    }
    expect(barState(snapshot(), new Date("2026-10-01T19:00:00+08:00"))).toBe("hidden")
  })

  it("還沒同意：先說明，什麼都不帶", () => {
    expect(barState(snapshot({ consented: false }), WORKING)).toBe("consent")
    expect(heartbeatPayload(snapshot({ consented: false }), WORKING)).toEqual({})
  })

  it("分享中帶最新的位置；還沒拿到位置就先不帶", () => {
    expect(barState(snapshot(), WORKING)).toBe("sharing")
    expect(heartbeatPayload(snapshot(), WORKING)).toEqual({ location: HERE })
    expect(heartbeatPayload(snapshot({ position: null }), WORKING)).toEqual({})
  })

  it("暫停中不帶；暫停比沒有權限優先", () => {
    const paused = snapshot({ share: { ...SHARE, paused: true }, denied: true })
    expect(barState(paused, WORKING)).toBe("paused")
    expect(heartbeatPayload(paused, WORKING)).toEqual({})
  })

  it("沒有權限：帶 location_denied", () => {
    expect(barState(snapshot({ denied: true }), WORKING)).toBe("denied")
    expect(heartbeatPayload(snapshot({ denied: true }), WORKING)).toEqual({ location_denied: true })
  })

  it("分享列的句子", () => {
    expect(barText("sharing", "陳建宏", HOURS)).toBe("位置分享中，陳建宏看得到你在哪（到 18:30）")
    expect(barText("paused", "陳建宏", HOURS)).toBe("已暫停分享，陳建宏會看到「暫停分享」")
    expect(barText("denied", "陳建宏", HOURS)).toBe("沒有開定位權限，陳建宏看不到你在哪")
    expect(barText("denied", null, HOURS)).toBe("沒有開定位權限，主管看不到你在哪")
    expect(barText("hidden", "陳建宏", HOURS)).toBeNull()
  })
})

function setup() {
  const state = { now: WORKING, consent: false, permission: "prompt" as PermissionState, share: SHARE }
  const watchers: Array<{ onPosition: (p: Position) => void; onDenied: () => void; stopped: boolean }> = []
  const env: GeoEnv = {
    now: () => state.now,
    readConsent: () => state.consent,
    writeConsent: () => {
      state.consent = true
    },
    fetchState: vi.fn(async () => state.share),
    permission: async () => state.permission,
    watch: (onPosition, onDenied) => {
      const watcher = { onPosition, onDenied, stopped: false }
      watchers.push(watcher)
      return () => {
        watcher.stopped = true
      }
    },
  }
  return { env, state, watchers, store: new LocationShare(env) }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("LocationShare", () => {
  it("第一次心跳去問後端；還沒同意就不追蹤", async () => {
    const { store, watchers, env } = setup()
    expect(store.heartbeat()).toEqual({})
    await settle()
    expect(env.fetchState).toHaveBeenCalledTimes(1)
    expect(barState(store.getSnapshot(), WORKING)).toBe("consent")
    expect(watchers).toHaveLength(0)
  })

  it("同意之後才開始追蹤，拿到位置就帶在心跳裡", async () => {
    const { store, watchers } = setup()
    await store.load()
    store.consent()
    await settle()
    expect(watchers).toHaveLength(1)
    watchers[0].onPosition(HERE)
    expect(store.heartbeat()).toEqual({ location: HERE })
  })

  it("瀏覽器拒絕：停止追蹤，心跳改帶 location_denied，不再一直跳詢問；設定裡打開之後再開始", async () => {
    const { store, watchers, state } = setup()
    state.consent = true
    await store.load()
    watchers[0].onDenied()
    expect(watchers[0].stopped).toBe(true)
    expect(store.heartbeat()).toEqual({ location_denied: true })
    await settle()
    expect(watchers).toHaveLength(1)
    state.permission = "granted"
    store.heartbeat()
    await settle()
    expect(watchers).toHaveLength(2)
  })

  it("權限早就被拒：不呼叫 watch，免得一直跳要權限", async () => {
    const { store, watchers, state } = setup()
    state.consent = true
    state.permission = "denied"
    await store.load()
    expect(watchers).toHaveLength(0)
    expect(store.heartbeat()).toEqual({ location_denied: true })
  })

  it("暫停就停止追蹤，繼續再開", async () => {
    const { store, watchers, state } = setup()
    state.consent = true
    await store.load()
    store.setShare({ ...SHARE, paused: true })
    await settle()
    expect(watchers[0].stopped).toBe(true)
    expect(store.heartbeat()).toEqual({})
    store.setShare(SHARE)
    await settle()
    expect(watchers).toHaveLength(2)
    expect(watchers[1].stopped).toBe(false)
  })

  it("下班時間停止追蹤", async () => {
    const { store, watchers, state } = setup()
    state.consent = true
    await store.load()
    state.now = new Date("2026-10-01T18:31:00+08:00")
    expect(store.heartbeat()).toEqual({})
    await settle()
    expect(watchers[0].stopped).toBe(true)
  })

  it("換人就全部清掉", async () => {
    const { store, watchers, state } = setup()
    state.consent = true
    await store.load()
    store.reset()
    expect(watchers[0].stopped).toBe(true)
    expect(store.getSnapshot().share).toBeNull()
  })
})
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `cd frontend && npx vitest run src/lib/location-share.test.ts`
Expected: FAIL（找不到 `@/lib/location-share`）

- [ ] **Step 4: 實作**

`frontend/src/lib/location-share.ts`：

```ts
import { useSyncExternalStore } from "react"

import { getShareState, type ShareHours, type ShareState } from "@/api/location"
import type { HeartbeatLocation } from "@/api/presence"
import { onAuthChange, readUser } from "@/lib/auth"

/*
 * 即時位置（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈即時位置〉〈位置分享〉）：
 * 業務上班時間打開 App，在線狀態的心跳（lib/realtime.ts，每 20 秒）多帶最新的位置。只有業務、上班時間（台北時間）、
 * 沒暫停、同意過、瀏覽器給了權限才追蹤與帶；拒絕定位時改帶 location_denied。後端（services/locations.py）會再檢查一次。
 * 評審（第三方登入、代理示範業務）分享的是自己手機真的位置。
 */

// 同意過了沒，記在這支手機、分帳號
const CONSENT_KEY = "meddemo:location-consent"
// 多久重問一次後端的分享狀態：好幾位評審代理同一位示範業務時，別人按了暫停，這裡最慢 5 分鐘後跟上
const RELOAD_MS = 5 * 60_000

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
const TAIPEI_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Taipei",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

function minutesOf(clock: string) {
  const [hours, minutes] = clock.split(":").map(Number)
  return hours * 60 + minutes
}

/** 這個時刻在不在上班時間，看台北時間（後端 services/locations.within 同一個規則） */
export function withinHours(at: Date, hours: ShareHours) {
  const parts = Object.fromEntries(TAIPEI_CLOCK.formatToParts(at).map((part) => [part.type, part.value]))
  const minute = Number(parts.hour) * 60 + Number(parts.minute)
  return hours.weekdays.includes(WEEKDAY[parts.weekday]) && minutesOf(hours.start) <= minute && minute < minutesOf(hours.end)
}

export type Position = { lat: number; lng: number; accuracy: number | null }

export type ShareSnapshot = {
  // 後端說的分享狀態；還沒問到是 null
  share: ShareState | null
  consented: boolean
  // 這支手機的瀏覽器拒絕定位
  denied: boolean
  position: Position | null
}

// hidden：不顯示（不是業務、下班時間、還沒問到）；consent：第一次要先說明；其他三種是分享列的三種樣子
export type BarState = "hidden" | "consent" | "sharing" | "paused" | "denied"

export function barState(snapshot: ShareSnapshot, now: Date): BarState {
  const { share } = snapshot
  if (!share || !share.applies || !withinHours(now, share.hours)) return "hidden"
  if (!snapshot.consented) return "consent"
  if (share.paused) return "paused"
  if (snapshot.denied) return "denied"
  return "sharing"
}

/** 心跳要多帶的：分享中帶最新的位置，沒有權限帶 location_denied，其他什麼都不帶 */
export function heartbeatPayload(snapshot: ShareSnapshot, now: Date): HeartbeatLocation {
  const state = barState(snapshot, now)
  if (state === "denied") return { location_denied: true }
  if (state === "sharing" && snapshot.position) return { location: snapshot.position }
  return {}
}

/** 分享列的句子（設計文件〈位置分享〉的表） */
export function barText(state: BarState, managerName: string | null, hours: ShareHours) {
  const manager = managerName ?? "主管"
  if (state === "sharing") return `位置分享中，${manager}看得到你在哪（到 ${hours.end}）`
  if (state === "paused") return `已暫停分享，${manager}會看到「暫停分享」`
  if (state === "denied") return `沒有開定位權限，${manager}看不到你在哪`
  return null
}

/** 追蹤位置用到的瀏覽器功能，測試換成假的 */
export type GeoEnv = {
  now(): Date
  readConsent(): boolean
  writeConsent(): void
  fetchState(): Promise<ShareState>
  /** 瀏覽器的定位權限；查不到（沒有 Permissions API）當作 prompt */
  permission(): Promise<PermissionState>
  /** 開始追蹤，回傳停止的函式；使用者拒絕時呼叫 onDenied */
  watch(onPosition: (position: Position) => void, onDenied: () => void): () => void
}

const EMPTY: ShareSnapshot = { share: null, consented: false, denied: false, position: null }

export class LocationShare {
  private snapshot: ShareSnapshot = EMPTY
  private stopWatch: (() => void) | null = null
  private loading: Promise<void> | null = null
  private loadedAt = 0
  private readonly listeners = new Set<() => void>()
  private readonly env: GeoEnv

  constructor(env: GeoEnv) {
    this.env = env
  }

  getSnapshot = () => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 問後端這個帳號要不要分享、暫停了沒；同時只問一次。問不到就等下一次心跳再問 */
  load(): Promise<void> {
    this.loading ??= this.env
      .fetchState()
      .then((share) => {
        this.loadedAt = this.env.now().getTime()
        this.set({ share, consented: this.env.readConsent() })
        return this.sync()
      })
      .catch(() => {})
      .finally(() => {
        this.loading = null
      })
    return this.loading
  }

  /** 第一次的說明按了「知道了」：這時才向瀏覽器要權限、開始追蹤 */
  consent() {
    this.env.writeConsent()
    this.set({ consented: true })
    void this.sync()
  }

  /** 暫停、繼續之後換成後端回的狀態 */
  setShare(share: ShareState) {
    this.set({ share })
    void this.sync()
  }

  /** 登出、換人：停止追蹤，全部清掉 */
  reset() {
    this.stopWatching()
    this.loadedAt = 0
    this.snapshot = EMPTY
    this.emit()
  }

  /** 心跳要多帶的（lib/realtime.ts 每次送心跳時呼叫）。順便確認問過後端、追蹤該開還是該關 */
  heartbeat(): HeartbeatLocation {
    if (!this.snapshot.share || this.env.now().getTime() - this.loadedAt > RELOAD_MS) void this.load()
    else void this.sync()
    return heartbeatPayload(this.snapshot, this.env.now())
  }

  /** 分享中（或沒有權限、等使用者去開）才追蹤；下班、暫停、還沒同意就停掉，不在背景一直拿 GPS */
  private async sync() {
    const state = barState(this.snapshot, this.env.now())
    if (state !== "sharing" && state !== "denied") {
      this.stopWatching()
      return
    }
    if (this.stopWatch) return
    // 已經被拒絕就不再呼叫 watch：有的瀏覽器（沒有 Permissions API 的）每呼叫一次就跳一次詢問，每 20 秒跳一次會很煩。
    // 使用者去設定打開之後，查得到 granted，下一次心跳這裡就會開始追蹤
    const permission = await this.env.permission()
    if (permission === "denied" || (this.snapshot.denied && permission !== "granted")) {
      this.set({ denied: true })
      return
    }
    // 等權限的時候，另一次 sync 可能已經開了
    if (this.stopWatch) return
    this.stopWatch = this.env.watch(
      (position) => this.set({ position, denied: false }),
      () => {
        this.stopWatching()
        this.set({ denied: true })
      }
    )
  }

  private stopWatching() {
    this.stopWatch?.()
    this.stopWatch = null
  }

  private set(patch: Partial<ShareSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    this.emit()
  }

  private emit() {
    this.listeners.forEach((listener) => listener())
  }
}

function consentKey() {
  return `${CONSENT_KEY}:${readUser()?.id ?? ""}`
}

const browserEnv: GeoEnv = {
  now: () => new Date(),
  readConsent: () => {
    try {
      return localStorage.getItem(consentKey()) === "1"
    } catch {
      return false
    }
  },
  writeConsent: () => {
    try {
      localStorage.setItem(consentKey(), "1")
    } catch {
      // 存不進去：下次打開會再問一次，不影響這次分享
    }
  },
  fetchState: () => getShareState(),
  permission: async () => {
    try {
      return (await navigator.permissions.query({ name: "geolocation" })).state
    } catch {
      return "prompt"
    }
  },
  watch: (onPosition, onDenied) => {
    if (!("geolocation" in navigator)) {
      onDenied()
      return () => {}
    }
    const id = navigator.geolocation.watchPosition(
      ({ coords }) => onPosition({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy ?? null }),
      (error) => {
        // 拿不到位置（室內、逾時）不算拒絕，等下一筆
        if (error.code === error.PERMISSION_DENIED) onDenied()
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 60_000 }
    )
    return () => navigator.geolocation.clearWatch(id)
  },
}

export const locationShare = new LocationShare(browserEnv)

// 登出、換人就停止追蹤；只是改了名字（同一個人）不必
let signedInAs = readUser()?.id ?? null
onAuthChange(() => {
  const next = readUser()?.id ?? null
  if (next === signedInAs) return
  signedInAs = next
  locationShare.reset()
})

export function useLocationShare() {
  // 第三個參數給伺服器端 render（元件測試）用，同一份
  return useSyncExternalStore(locationShare.subscribe, locationShare.getSnapshot, locationShare.getSnapshot)
}
```

- [ ] **Step 5: 心跳帶位置、轉發新的事件**

`frontend/src/lib/realtime.ts`：

1. import 改成：
   ```ts
   import { pingPresence, type HeartbeatLocation, type PresenceStatus } from "@/api/presence"
   import { readToken } from "@/lib/auth"
   import { locationShare } from "@/lib/location-share"
   import { presence, type PresenceStore } from "@/lib/presence"
   ```
2. 模組說明第一句後面加：「業務的心跳順便帶位置（lib/location-share.ts）；主管與 IT 另外會收到看得到的業務位置變了、行程變了的通知。」
3. 型別：
   ```ts
   // avatars：有人換了或移除大頭貼（lib/avatars.ts 重拿一次網址）；location、itinerary：這位業務的位置或今天的行程變了（主管頁）
   export type RealtimeEvent =
     | { type: "message"; channel_id: number }
     | { type: "resync" }
     | { type: "avatars" }
     | { type: "location"; user_id: string }
     | { type: "itinerary"; user_id: string }
   ```
   `ServerEvent` 也加上 `| { type: "location"; user_id: string } | { type: "itinerary"; user_id: string }`。
4. `RealtimeEnv`：`ping(active: boolean): Promise<...>` 改成 `ping(active: boolean, extra: HeartbeatLocation): Promise<{ statuses: Record<string, PresenceStatus> }>`，並加一個欄位：
   ```ts
     /** 心跳要多帶的（業務的位置），沒有就是空的 */
     heartbeat(): HeartbeatLocation
   ```
5. `receive` 裡 `else if (event.type === "message" || event.type === "avatars") {` 改成 `else if (event.type === "message" || event.type === "avatars" || event.type === "location" || event.type === "itinerary") {`。
6. `sendPing` 裡 `this.socket.send(JSON.stringify({ type: "ping", active }))` 改成 `this.socket.send(JSON.stringify({ type: "ping", active, ...this.env.heartbeat() }))`。
7. `fallbackPing` 裡 `.ping(this.active())` 改成 `.ping(this.active(), this.env.heartbeat())`。
8. `browserEnv` 加 `heartbeat: () => locationShare.heartbeat(),`。

`frontend/src/lib/realtime.test.ts`：

1. `setup()` 的 `state` 加 `heartbeat: {} as HeartbeatLocation`（import `type HeartbeatLocation` from `@/api/presence`），`env` 加 `heartbeat: () => state.heartbeat,`。
2. 原本 `expect(env.ping).toHaveBeenCalledWith(true)` 改成 `expect(env.ping).toHaveBeenCalledWith(true, {})`。
3. `describe("RealtimeClient"` 裡加兩個測試：
   ```ts
     it("業務的心跳多帶位置，WebSocket 與 HTTP 心跳都是", async () => {
       const { client, env, latest, ready, state } = setup()
       state.heartbeat = { location: { lat: 25.034, lng: 121.5645, accuracy: 12 } }
       client.start()
       ready()
       vi.advanceTimersByTime(PING_MS)
       expect(latest().sent.at(-1)).toEqual({ type: "ping", active: true, location: { lat: 25.034, lng: 121.5645, accuracy: 12 } })
       latest().drop()
       expect(env.ping).toHaveBeenCalledWith(true, { location: { lat: 25.034, lng: 121.5645, accuracy: 12 } })
     })

     it("位置與行程的通知轉給訂閱的畫面", () => {
       const { client, latest, ready, events } = setup()
       client.start()
       ready()
       latest().push({ type: "location", user_id: "U01" })
       latest().push({ type: "itinerary", user_id: "U02" })
       expect(events.slice(-2)).toEqual([
         { type: "location", user_id: "U01" },
         { type: "itinerary", user_id: "U02" },
       ])
     })
   ```
   （HTTP 心跳在斷線時馬上送一次，跟原本「斷線就改用 HTTP 心跳」那個測試一樣；如果原本的測試斷線後要先 `await` 才看得到呼叫，照它的寫法。）

位置事件很密（主管頁開著時每位業務最快每 30 公尺一次），只該影響主管頁。原本「什麼事件都重拿」的兩個地方改成只看新訊息與重連：

- `frontend/src/lib/channel-unread.ts`：`if (event.type !== "avatars") void channelUnread.refresh()` 改成 `if (event.type === "message" || event.type === "resync") void channelUnread.refresh()`，上面的註解不動。
- `frontend/src/pages/channels.tsx`：`realtime.subscribe((event) => event.type !== "avatars" && soon())` 改成 `realtime.subscribe((event) => (event.type === "message" || event.type === "resync") && soon())`。

- [ ] **Step 6: 型別、lint、測試**

Run: `cd frontend && npm run typecheck && npm run lint && npm test`
Expected: 全部通過，沒有 lint 警告

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/location.ts frontend/src/api/presence.ts frontend/src/lib/location-share.ts frontend/src/lib/location-share.test.ts \
  frontend/src/lib/realtime.ts frontend/src/lib/realtime.test.ts frontend/src/lib/channel-unread.ts frontend/src/pages/channels.tsx
git commit -m "Track the rep's position during work hours after consent and carry it on the presence heartbeat

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 首頁的位置分享列

**Files:**
- Create: `frontend/src/components/route/share-bar.tsx`
- Test: `frontend/src/components/route/share-bar.test.ts`
- Modify: `frontend/src/pages/today.tsx`

**Interfaces:**
- Consumes: Task 6 的 `locationShare`、`useLocationShare`、`barState`、`barText`、`pauseSharing`、`resumeSharing`、`ShareHours`；`Dialog`（`components/ui/dialog.tsx`）。
- Produces: `ShareBar`（首頁用）、`ShareBarView`（測試用的純畫面）、`CONSENT_TEXT`。

- [ ] **Step 1: 寫失敗的測試**

`frontend/src/components/route/share-bar.test.ts`：

```ts
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ShareBarView } from "@/components/route/share-bar"
import type { BarState } from "@/lib/location-share"

const HOURS = { weekdays: [1, 2, 3, 4, 5], start: "08:30", end: "18:30" }
const noop = () => {}

const render = (state: BarState) =>
  renderToStaticMarkup(
    createElement(ShareBarView, {
      state,
      managerName: "陳建宏",
      hours: HOURS,
      busy: false,
      error: null,
      onPause: noop,
      onResume: noop,
      onHelp: noop,
    })
  )

describe("ShareBarView", () => {
  it("分享中：綠點、到幾點、暫停", () => {
    const html = render("sharing")
    expect(html).toContain("位置分享中，陳建宏看得到你在哪（到 18:30）")
    expect(html).toContain("bg-success")
    expect(html).toContain(">暫停<")
  })

  it("暫停中：琥珀點、繼續", () => {
    const html = render("paused")
    expect(html).toContain("已暫停分享，陳建宏會看到「暫停分享」")
    expect(html).toContain("bg-warning")
    expect(html).toContain(">繼續<")
  })

  it("沒有權限：怎麼開", () => {
    const html = render("denied")
    expect(html).toContain("沒有開定位權限，陳建宏看不到你在哪")
    expect(html).toContain(">怎麼開<")
  })

  it("下班時間與還沒同意都不顯示分享列", () => {
    expect(render("hidden")).toBe("")
    expect(render("consent")).toBe("")
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd frontend && npx vitest run src/components/route/share-bar.test.ts`
Expected: FAIL（找不到 `@/components/route/share-bar`）

- [ ] **Step 3: 實作**

`frontend/src/components/route/share-bar.tsx`：

```tsx
import { useEffect, useState } from "react"
import { MapPin } from "lucide-react"

import { ApiError } from "@/api/client"
import { pauseSharing, resumeSharing, type ShareHours } from "@/api/location"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { barState, barText, locationShare, useLocationShare, type BarState } from "@/lib/location-share"
import { cn } from "@/lib/utils"

// 第一次在上班時間打開首頁時的說明（設計文件〈位置分享〉）
export const CONSENT_TEXT = "上班時間主管看得到你的位置，只存最新的一筆，不留軌跡；可以隨時暫停。"

const DOT: Record<"sharing" | "paused" | "denied", string> = {
  sharing: "bg-success",
  paused: "bg-warning",
  denied: "bg-muted-foreground",
}

/** 每分鐘換一次的現在時間：18:30 一到分享列就收起來 */
function useMinute() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/**
 * 業務首頁橫幅下面的位置分享列（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈位置分享〉）。
 * 位置本身跟著在線狀態的心跳送（lib/location-share.ts、lib/realtime.ts），這裡只顯示狀態、暫停與繼續。
 */
export function ShareBar() {
  const snapshot = useLocationShare()
  const now = useMinute()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [help, setHelp] = useState(false)

  useEffect(() => {
    void locationShare.load()
  }, [])

  const state = barState(snapshot, now)

  async function toggle(pause: boolean) {
    setBusy(true)
    setError(null)
    try {
      locationShare.setShare(await (pause ? pauseSharing() : resumeSharing()))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "連不上伺服器，請再試一次")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ShareBarView
        state={state}
        managerName={snapshot.share?.manager_name ?? null}
        hours={snapshot.share?.hours ?? null}
        busy={busy}
        error={error}
        onPause={() => void toggle(true)}
        onResume={() => void toggle(false)}
        onHelp={() => setHelp(true)}
      />
      {/* 第一次：先說明，按「知道了」才向瀏覽器要定位權限。只能按「知道了」關掉 */}
      <Dialog open={state === "consent"}>
        <DialogContent showCloseButton={false} onEscapeKeyDown={(event) => event.preventDefault()} onPointerDownOutside={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <MapPin className="size-4 text-primary" />
              分享位置
            </DialogTitle>
            <DialogDescription className="leading-relaxed">{CONSENT_TEXT}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button className="h-11" onClick={() => locationShare.consent()}>
              知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>怎麼開定位權限</DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-col gap-2 text-left leading-relaxed">
                <p>iPhone：設定 → 隱私權與安全性 → 定位服務 → Safari 網站，選「使用 App 期間」。</p>
                <p>Android：點 Chrome 網址列左邊的圖示 → 權限 → 位置，選「允許」。</p>
                <p>開好之後回到這裡重新整理一次。</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setHelp(false)}>
              知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

type ViewProps = {
  state: BarState
  managerName: string | null
  hours: ShareHours | null
  busy: boolean
  error: string | null
  onPause: () => void
  onResume: () => void
  onHelp: () => void
}

/** 分享列本身（純畫面）：分享中、暫停中、沒有權限三種；下班時間與還沒同意不顯示 */
export function ShareBarView({ state, managerName, hours, busy, error, onPause, onResume, onHelp }: ViewProps) {
  if ((state !== "sharing" && state !== "paused" && state !== "denied") || !hours) return null
  return (
    <div data-share-bar={state} className="mt-2 rounded-xl border-2 bg-card px-3 py-1.5 shadow-lip">
      <div className="flex items-center gap-2">
        <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", DOT[state])} />
        <p className="min-w-0 flex-1 text-xs leading-snug">{barText(state, managerName, hours)}</p>
        {state === "sharing" && (
          <Button variant="outline" className="h-9 shrink-0 px-3" disabled={busy} onClick={onPause}>
            暫停
          </Button>
        )}
        {state === "paused" && (
          <Button variant="outline" className="h-9 shrink-0 px-3" disabled={busy} onClick={onResume}>
            繼續
          </Button>
        )}
        {state === "denied" && (
          <Button variant="outline" className="h-9 shrink-0 px-3" onClick={onHelp}>
            怎麼開
          </Button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}
```

`frontend/src/pages/today.tsx`（Track A 也在改這個檔案，只加下面兩處）：

1. import 區，`import { RoutePath } from "@/components/route-path"` 下面加 `import { ShareBar } from "@/components/route/share-bar"`。
2. `<header>` 裡，紫色橫幅那個 `<div className="mt-1 flex items-stretch ... shadow-lip-primary">…</div>` 結束之後、`</header>` 前面加：
   ```tsx
        {/* 位置分享列：上班時間主管看得到你在哪（components/route/share-bar.tsx） */}
        <ShareBar />
   ```

- [ ] **Step 4: 型別、lint、測試、建置**

Run: `cd frontend && npm run typecheck && npm run lint && npm test && npm run build`
Expected: 全部通過，沒有 lint 警告

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/route/share-bar.tsx frontend/src/components/route/share-bar.test.ts frontend/src/pages/today.tsx
git commit -m "Show the rep a location-sharing bar under the home banner, with a first-time explanation and pause

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 主管頁：位置那一行、地圖上的頭像、即時更新

**Files:**
- Modify: `frontend/src/api/team-routes.ts`
- Modify: `frontend/src/lib/team-routes.ts`、`frontend/src/lib/team-routes.fixtures.ts`、`frontend/src/lib/team-routes.test.ts`
- Modify: `frontend/src/components/manager/rep-route-card.tsx`、`rep-route-card.test.ts`
- Modify: `frontend/src/components/manager/routes-panel.tsx`
- Modify: `frontend/src/components/manager/route-map.tsx`

**Interfaces:**
- Consumes: Task 5 的 JSON（`RepRoute.location`、`GET /api/manager/locations`）；Task 6 的 `realtime.subscribe` 的 `location`、`itinerary`、`resync` 事件、`useRealtimeConnected()`。
- Produces: `SeenLocation`、`TeamLocations`、`getTeamLocations(signal?)`；`withLocations(data, update)`、`withLocation(route, update)`。

- [ ] **Step 1: 型別與 API**

`frontend/src/api/team-routes.ts`：

1. `RepRoute` 前面加：
   ```ts
   // 主管看到的位置（後端 services/locations.describe）：一句話，加上地圖上頭像畫在哪（沒有就不畫）；
   // live 是分享中而且 5 分鐘內有更新，不然頭像是灰的
   export type SeenLocation = { text: string; lat: number | null; lng: number | null; at: string | null; live: boolean }
   ```
2. `RepRoute` 的 `untouched: boolean` 後面加 `location: SeenLocation`。
3. 檔案最後加：
   ```ts
   export type TeamLocations = { updated_at: string; locations: Record<string, SeenLocation> }

   /** 只拿位置：收到位置的通知時用，不重算行程、不問 Google */
   export function getTeamLocations(signal?: AbortSignal) {
     return request<TeamLocations>("/api/manager/locations", { signal })
   }
   ```

`frontend/src/lib/team-routes.fixtures.ts` 的 `repRoute()` 預設值在 `untouched: true,` 後面加 `location: { text: "今天還沒有位置", lat: null, lng: null, at: null, live: false },`。

- [ ] **Step 2: 寫失敗的測試**

`frontend/src/lib/team-routes.test.ts`：import 加上 `withLocation, withLocations`，檔案最後加：

```ts
describe("即時位置", () => {
  const here = { text: "往第 2 站客戶2途中 · 1 分鐘前", lat: 25.04, lng: 121.55, at: "2026-10-01T03:00:00Z", live: true }

  it("只換掉位置與更新時間，行程不動", () => {
    const data = teamRoutes()
    const next = withLocations(data, { updated_at: "11:05", locations: { U01: here } })
    expect(next.updated_at).toBe("11:05")
    expect(next.reps[0].location).toEqual(here)
    expect(next.reps[0].stops).toBe(data.reps[0].stops)
    // 沒給的業務照舊
    expect(next.reps[1]).toBe(data.reps[1])
  })

  it("一位業務的詳細也一樣", () => {
    const route = repRoute()
    expect(withLocation(route, { updated_at: "11:05", locations: { U01: here } }).location).toEqual(here)
    expect(withLocation(route, { updated_at: "11:05", locations: {} })).toBe(route)
  })
})
```

`frontend/src/components/manager/rep-route-card.test.ts` 的 `describe` 最後加：

```ts
  it("位置是紫色的一行", () => {
    const html = render(repRoute({ location: { text: "在杏林診所附近", lat: 25.03, lng: 121.54, at: null, live: true } }))
    expect(html).toMatch(/text-primary[^>]*>(<svg[\s\S]*?<\/svg>)?在杏林診所附近/)
  })
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `cd frontend && npx vitest run src/lib/team-routes.test.ts src/components/manager/rep-route-card.test.ts`
Expected: FAIL（沒有 `withLocations`；卡片沒有位置那一行）

- [ ] **Step 4: 實作**

`frontend/src/lib/team-routes.ts`：import 的型別加上 `TeamLocations`，檔案最後加：

```ts
/** 收到位置的通知時只重拿位置：換掉每位業務的位置與頁首的更新時間，行程不動 */
export function withLocations(data: TeamRoutes, update: TeamLocations): TeamRoutes {
  return { ...data, updated_at: update.updated_at, reps: data.reps.map((route) => withLocation(route, update)) }
}

export function withLocation(route: RepRoute, update: TeamLocations): RepRoute {
  const location = update.locations[route.rep.id]
  return location ? { ...route, location } : route
}
```

`frontend/src/components/manager/rep-route-card.tsx`：lucide 的 import 加 `MapPin`，進度條那個 `</div>` 後面、`{next && ...}` 前面加：

```tsx
      <p className="flex items-start gap-1.5 text-xs text-primary">
        <MapPin className="mt-0.5 size-3.5 shrink-0" />
        {route.location.text}
      </p>
```

元件上面的說明改成「團隊總覽的一張卡：頭像、進度、現在在哪、下一站，以及要主管注意的事（拿掉系統排的站、會晚到、還沒動過）。點了進詳細」。

`frontend/src/components/manager/route-map.tsx`：

1. import 加 `import { UserAvatar } from "@/components/user-avatar"` 與 `import { cn } from "@/lib/utils"`。
2. `points` 的計算加上位置：
   ```tsx
     const points = [
       ...routes.flatMap((route) => [
         ...(route.origin ? [route.origin] : []),
         ...route.stops,
         ...(route.location.lat != null && route.location.lng != null ? [{ lat: route.location.lat, lng: route.location.lng }] : []),
       ]),
       ...removed,
     ]
   ```
3. `RouteLayer` 的 `</>` 前面（站點後面）加 `<RepMarker route={route} />`，並在 `RouteLayer` 後面加：

```tsx
/** 業務的頭像在他最新的位置；暫停、沒權限或超過 5 分鐘沒更新時變灰。下班時間或今天還沒有位置就不畫 */
function RepMarker({ route }: { route: RepRoute }) {
  const { location } = route
  if (location.lat == null || location.lng == null) return null
  return (
    <AdvancedMarker
      position={{ lat: location.lat, lng: location.lng }}
      title={`${route.rep.name}：${location.text}`}
      anchorLeft="-50%"
      anchorTop="-50%"
      zIndex={10}
    >
      <span
        className={cn("block rounded-full border-[3px] bg-background shadow-sm", !location.live && "opacity-70 grayscale")}
        style={{ borderColor: location.live ? `var(${routeColorVar(route.rep.id)})` : "var(--muted-foreground)" }}
      >
        <UserAvatar id={route.rep.id} name={route.rep.name} size="sm" />
      </span>
    </AdvancedMarker>
  )
}
```

`frontend/src/components/manager/routes-panel.tsx`：

1. import 改成（加上需要的）：
   ```tsx
   import { useEffect, useState } from "react"
   import { ChevronLeft, ChevronRight, MapPin } from "lucide-react"
   ...
   import {
     getRepRoute,
     getTeamLocations,
     getTeamRoutes,
     type RepRoute,
     type TeamLocations,
     type TeamRoutes,
     type TeamStop,
   } from "@/api/team-routes"
   ...
   import { headerLine, progressLine, SOURCE_LABEL, totalsLine, windowLabel, withLocation, withLocations } from "@/lib/team-routes"
   import { realtime, useRealtimeConnected } from "@/lib/realtime"
   ```
2. 常數換成：
   ```tsx
   // 收到位置或行程的通知之後等這麼久再重拿，一連串的變化併成一次（跟頻道列表一樣）
   const RELOAD_DELAY_MS = 3_000
   // WebSocket 沒連上時，畫面在前景每 60 秒整份重拿一次
   const POLL_MS = 60_000
   ```
3. `usePollTick` 刪掉，`useLoad` 換成：

```tsx
/**
 * 載入一份資料並跟著即時通知更新：看得到的業務位置變了，3 秒後只重拿位置（不重算行程、不問 Google）；
 * 行程變了或 WebSocket 重連，3 秒後整份重拿。WebSocket 沒連上時改成每 60 秒整份重拿。
 * 背景重拿失敗就留著上一份，不把畫面換成錯誤。watches 是這個畫面關心哪幾位業務的通知
 */
function useLiveLoad<T>(
  load: (signal: AbortSignal) => Promise<T>,
  mergeLocations: (data: T, update: TeamLocations) => T,
  watches: (userId: string) => boolean,
  key: string
) {
  const [state, setState] = useState<Load<T>>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const connected = useRealtimeConnected()
  useEffect(() => {
    const controller = new AbortController()
    const full = () =>
      load(controller.signal)
        .then((data) => setState({ status: "ready", data }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          const message = error instanceof ApiError && error.status === 404 ? error.message : LOAD_FAILED
          setState((current) => (current.status === "ready" ? current : { status: "error", message }))
        })
    const locationsOnly = () =>
      getTeamLocations(controller.signal)
        .then((update) =>
          setState((current) => (current.status === "ready" ? { status: "ready", data: mergeLocations(current.data, update) } : current))
        )
        .catch(() => {
          // 拿不到就等下一次通知或整份重拿
        })
    void full()

    let timer: ReturnType<typeof setTimeout> | undefined
    let wantFull = false
    const soon = (fullReload: boolean) => {
      wantFull ||= fullReload
      timer ??= setTimeout(() => {
        timer = undefined
        const reloadFull = wantFull
        wantFull = false
        void (reloadFull ? full() : locationsOnly())
      }, RELOAD_DELAY_MS)
    }
    const off = realtime.subscribe((event) => {
      if (event.type === "resync") soon(true)
      else if (event.type === "itinerary" && watches(event.user_id)) soon(true)
      else if (event.type === "location" && watches(event.user_id)) soon(false)
    })
    const poll = connected
      ? undefined
      : setInterval(() => {
          if (document.visibilityState === "visible") void full()
        }, POLL_MS)
    return () => {
      controller.abort()
      clearTimeout(timer)
      clearInterval(poll)
      off()
    }
    // load、mergeLocations、watches 每次 render 都是新的函式；要不要重拿只看 key、按了重新載入、連線狀態
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt, connected])
  const retry = () => {
    setState({ status: "loading" })
    setAttempt((n) => n + 1)
  }
  return { state, retry }
}
```

4. `TeamOverview` 裡 `useLoad<TeamRoutes>(getTeamRoutes, "team")` 改成 `useLiveLoad<TeamRoutes>(getTeamRoutes, withLocations, () => true, "team")`（後端只把看得到的業務的通知送來，總覽每一位都關心）。
5. `RepDetail` 裡 `useLoad<RepRoute>((signal) => getRepRoute(userId, signal), userId)` 改成 `useLiveLoad<RepRoute>((signal) => getRepRoute(userId, signal), withLocation, (id) => id === userId, userId)`；`<p className="text-xs tabular-nums">{totalsLine(route)}</p>` 後面加：
   ```tsx
      <p className="flex items-start gap-1.5 text-xs text-primary">
        <MapPin className="mt-0.5 size-3.5 shrink-0" />
        {route.location.text}
      </p>
   ```
6. 檔案開頭的元件說明（`RoutesPanel` 上面那段）最後加一句「位置與行程的變化跟著 WebSocket 的通知更新（useLiveLoad）。」

- [ ] **Step 5: 型別、lint、測試、建置**

Run: `cd frontend && npm run typecheck && npm run lint && npm test && npm run build`
Expected: 全部通過，沒有 lint 警告

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/team-routes.ts frontend/src/lib/team-routes.ts frontend/src/lib/team-routes.fixtures.ts frontend/src/lib/team-routes.test.ts \
  frontend/src/components/manager/rep-route-card.tsx frontend/src/components/manager/rep-route-card.test.ts \
  frontend/src/components/manager/routes-panel.tsx frontend/src/components/manager/route-map.tsx
git commit -m "Show managers each rep's location line and avatar on the map, refreshed live from WebSocket events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 壓力測試與文件

**Files:**
- Create: `backend/scripts/stress_locations.py`
- Modify: `README.md`

**Interfaces:**
- Consumes: 心跳 API、WebSocket、`GET /api/manager/locations`、`POST /api/auth/register`。

- [ ] **Step 1: 壓力測試的程式**

`backend/scripts/stress_locations.py`：

```python
"""即時位置的壓力測試（docs/superpowers/plans/2026-10-01-itinerary-stage6.md Task 9）。

決賽時好幾位評審用第三方登入，同時代理同一位示範業務送位置：位置全部寫在同一列（user_location 的 U01），
主管頁同時開著收通知。這支對一個跑著的後端模擬這個情況，看心跳會不會變慢、出錯，主管有沒有收到通知，
最後存的是不是最後送的那一筆。

後端要用 LOCATION_SHARE_HOURS="1-7 00:00-24:00" 啟動（不受現在幾點影響），主管的 token 由呼叫端給：

    STRESS_MANAGER_TOKEN=<M01 的 token> uv run --project backend python backend/scripts/stress_locations.py \\
        --base http://127.0.0.1:8013 --judges 20 --seconds 60

評審的帳號用 /api/auth/register 開（自己開的帳號跟第三方登入的一樣都代理示範業務），信箱帶這次的時間戳，不會撞。
"""

import argparse
import asyncio
import json
import os
import random
import statistics
import time

import httpx
from websockets.asyncio.client import connect

# 台北 101 附近 3 公里內亂走：大部分的位置都超過 30 公尺，會真的寫進資料庫、發通知
CENTRE = (25.034, 121.5645)
SPREAD = 0.03
PASSWORD = "stress-pass-1234"


async def register(http: httpx.AsyncClient, run: str, n: int) -> str:
    response = await http.post("/api/auth/register", json={
        "name": f"壓測評審{n}", "email": f"stress-{run}-{n}@example.test", "password": PASSWORD,
    })
    response.raise_for_status()
    return response.json()["token"]


def somewhere() -> dict:
    return {
        "lat": round(CENTRE[0] + random.uniform(-SPREAD, SPREAD), 6),
        "lng": round(CENTRE[1] + random.uniform(-SPREAD, SPREAD), 6),
        "accuracy": 10,
    }


async def judge(http: httpx.AsyncClient, token: str, until: float, latencies: list[float], errors: list[str]) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    while time.monotonic() < until:
        started = time.monotonic()
        try:
            response = await http.post(
                "/api/presence/ping", json={"active": True, "location": somewhere()}, headers=headers
            )
            if response.status_code != 200:
                errors.append(f"{response.status_code} {response.text[:120]}")
        except httpx.HTTPError as exc:
            errors.append(repr(exc))
        latencies.append(time.monotonic() - started)
        await asyncio.sleep(random.uniform(0.5, 1.5))


async def manager(ws_url: str, token: str, until: float, received: list[str]) -> None:
    async with connect(ws_url) as ws:
        await ws.send(json.dumps({"type": "auth", "token": token, "active": True}))
        last_ping = time.monotonic()
        while time.monotonic() < until:
            try:
                event = json.loads(await asyncio.wait_for(ws.recv(), timeout=1))
            except TimeoutError:
                event = None
            if event and event.get("type") == "location":
                received.append(event["user_id"])
            if time.monotonic() - last_ping > 15:
                await ws.send(json.dumps({"type": "ping", "active": True}))
                last_ping = time.monotonic()


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", default="http://127.0.0.1:8013")
    parser.add_argument("--judges", type=int, default=20)
    parser.add_argument("--seconds", type=int, default=60)
    parser.add_argument("--managers", type=int, default=3, help="主管同時開幾條 WebSocket（同一個帳號最多 5 條）")
    args = parser.parse_args()
    manager_token = os.environ["STRESS_MANAGER_TOKEN"]
    run = str(int(time.time()))
    ws_url = args.base.replace("http", "ws", 1) + "/api/ws"

    async with httpx.AsyncClient(base_url=args.base, timeout=10) as http:
        tokens = [await register(http, run, n) for n in range(args.judges)]
        latencies: list[float] = []
        errors: list[str] = []
        received: list[list[str]] = [[] for _ in range(args.managers)]
        until = time.monotonic() + args.seconds
        await asyncio.gather(
            *(judge(http, token, until, latencies, errors) for token in tokens),
            *(manager(ws_url, manager_token, until + 2, box) for box in received),
        )

        # 最後一筆：停下來之後再送一個確定的位置，主管看到的必須是它
        final = {"lat": 25.0478, "lng": 121.517, "accuracy": 5}
        await http.post("/api/presence/ping", json={"active": True, "location": final},
                        headers={"Authorization": f"Bearer {tokens[0]}"})
        await asyncio.sleep(1)
        seen = (await http.get("/api/manager/locations", headers={"Authorization": f"Bearer {manager_token}"})).json()
        u01 = seen["locations"]["U01"]

    ordered = sorted(latencies)
    print(f"心跳 {len(latencies)} 次，失敗 {len(errors)} 次")
    print(f"延遲 p50 {statistics.median(ordered) * 1000:.0f} ms、p95 {ordered[int(len(ordered) * 0.95)] * 1000:.0f} ms、"
          f"最大 {ordered[-1] * 1000:.0f} ms")
    print(f"主管的 WebSocket 收到的位置通知：{[len(box) for box in received]}（每條）")
    print(f"最後的位置：{u01['lat']}, {u01['lng']}（應該是 {final['lat']}, {final['lng']}）· {u01['text']}")
    for line in errors[:5]:
        print("  錯誤：", line)
    ok = not errors and (u01["lat"], u01["lng"]) == (final["lat"], final["lng"]) and all(received)
    print("通過" if ok else "沒通過")


if __name__ == "__main__":
    asyncio.run(main())
```

這支不進 CI（要一個跑著的後端），在 controller 的實機檢查裡跑。

- [ ] **Step 2: README**

在〈主管端的團隊行程〉那一節後面、〈方法卡〉前面加新的一節：

```markdown
## 即時位置

設計見 [docs/superpowers/specs/2026-10-01-itinerary-planning-design.md](docs/superpowers/specs/2026-10-01-itinerary-planning-design.md)〈即時位置〉。

- **上班時間（台北時間，預設週一到週五 08:30–18:30，`LOCATION_SHARE_HOURS`）業務打開 App 就分享最新位置**。第一次會先說明「上班時間主管看得到你的位置，只存最新的一筆，不留軌跡；可以隨時暫停」，按「知道了」才向瀏覽器要定位權限。
- 位置跟著在線狀態的心跳送（WebSocket 每 20 秒；連不上時的 HTTP 心跳也一樣），後端再檢查一次角色、上班時間與暫停，覆寫 `user_location`（一人一列，不留軌跡）。跟上一筆差不到 30 公尺而且不到 2 分鐘就不寫。
- 首頁橫幅下面一條分享列：分享中（可以暫停）、已暫停（可以繼續）、沒有開定位權限（說明怎麼開）；下班時間不顯示。
- 主管頁的卡片與詳細多一行紫色的位置：「在杏林診所附近」「往第 3 站德安藥局途中 · 1 分鐘前」「最後位置 10:41，在內湖區」「暫停分享位置」「下班時間」「沒有開定位權限」「今天還沒有位置」。地圖上業務的頭像在最新位置，暫停或超過 5 分鐘沒更新變灰。
- 位置變了只通知看得到那位業務的主管與 IT（WebSocket 的 `location` 事件），主管頁 3 秒後只重拿位置，不重算行程、不問 Google；行程變了（含跑完一站、IT 重置示範業務的行程）發 `itinerary` 事件，整份重拿。
- **評審（第三方登入、代理示範業務）分享的是自己手機真的位置，存在示範業務名下**；好幾位同時用時以最後一筆為準，主管頁上的位置會在評審之間跳動。壓力測試：`backend/scripts/stress_locations.py`（20 位評審同時送位置一分鐘，看延遲、錯誤、主管收到的通知與最後存的那一筆）。
- 網頁 App 只有畫面開著時拿得到位置；鎖螢幕或切到別的 App 就停了，主管看到「最後位置 HH:MM」。
```

- [ ] **Step 3: 全部測試**

```bash
TEST_DB_NAME=meddemo_test_maps TEST_REDIS_URL=redis://127.0.0.1:6379/7 uv run --project backend pytest backend/tests -q
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
```
Expected: 全部通過。

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/stress_locations.py README.md
git commit -m "Add a stress test for many judges sharing one demo rep's location, and describe live locations in the README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 實機檢查（controller 自己做，不派給 implementer）

照 [[run-stack-from-a-worktree]]：資料庫 `meddemo_maps_dev`（重新灌，`user_location` 是新表）、Redis 10 號庫、後端 port 8013（`LOCATION_SHARE_HOURS="1-7 00:00-24:00"`）、Vite port 5183。無頭 Chrome 每段 20 秒內，`Browser.grantPermissions` 加 `Emulation.setGeolocationOverride` 模擬 GPS。在 375×812 截圖：

1. U01 首頁第一次：說明對話框 → 按「知道了」→ 分享列「位置分享中，陳建宏看得到你在哪（到 24:00）」。
2. 等一次心跳（或縮短等待：斷線改走 HTTP 心跳）之後，M01 的總覽：林昱辰的卡片有位置那一行。
3. U01 按「暫停」→ 分享列變「已暫停分享…」；M01 的卡片 3 秒後變「暫停分享位置 · 最後位置 HH:MM」（不重新整理，靠 WebSocket 事件）。
4. 拒絕定位權限（不 grant）→ 分享列「沒有開定位權限…」與「怎麼開」對話框。
5. 下班時間（後端與前端都用 `1-7 00:00-00:00` 不容易在前端做到；改成看 `ShareBarView` 的測試即可）。
6. 跑壓力測試：`--judges 20 --seconds 60`，記下 p50、p95、錯誤數、最後位置。

截圖放 scratchpad；看完停掉服務、刪掉暫時的 vite 設定、刪掉 dev 資料庫並清空 Redis 10、刪掉複製進來的 `backend/.env`。
