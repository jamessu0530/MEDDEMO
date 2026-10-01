# 行程第二階段：調整清單與習慣 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 業務能在首頁按「調整」進清單模式改今天的行程（拖移、上下移、展開編輯約的時間／停留／先後／備註／鎖住／拿掉、加一站），違反規則時紅框提示，拖完或改完問「以後也這樣排嗎？」記成排序習慣；有自己的「我的排序習慣」頁；習慣在每天的建議、加站與調整時自動套用。

**Architecture:** 後端多一張 `route_habit` 與 `services/route_habits.py`（比對、那句話、換成排序規則、預設值）。`services/itinerary.py` 把「還沒跑的站」整理成同一種內部資料（`_Open`），存著的與調整中的草稿都用同一支 `_compose` 算時間、車程、規則與違反；多 `preview`（不存）、`save`（版本檢查、一次存進去）、`candidates`（加一站的候選）。前端的調整清單把草稿放在一個小 store（`lib/route-draft.ts`），清單頁與加一站頁共用；每次改動 300ms 防抖打 preview，違反規則在手機上即時判斷（`lib/itinerary.ts`，跟後端同一套），按「完成」用 PUT 一次存。

**Tech Stack:** FastAPI、SQLAlchemy 2（Postgres）、pytest；React 19、TypeScript、vitest、`@dnd-kit/core`＋`@dnd-kit/sortable`。

**設計文件：** `docs/superpowers/specs/2026-10-01-itinerary-planning-design.md`（本計畫是〈分階段做〉的第 2 階段；問答「排入今天的路線」改接在第 1 階段已做完）。第 1 階段的計畫：`docs/superpowers/plans/2026-10-01-itinerary-stage1.md`。

## Global Constraints

- 註解與畫面文字一律繁體中文，密度與口吻照周圍的程式；畫面不用表情符號，圖示一律 lucide；按鈕用既有的厚底樣式（`buttonVariants`、`shadow-lip`、`press`）。
- 還沒跑的站最多 8 站（`route_planner.MAX_OPEN_STOPS`）；超過時的訊息是「今天已經排了 8 站，要先刪掉一站」。
- 每站預設停留 40 分鐘（`itinerary.DEFAULT_DURATION`）；停留的選項 20／40／60／90 分，也可以自己輸入（5～480 分）。
- 版本對不上回 409「行程剛被改過，已幫你重新整理」；主管與 IT 打業務的 API 回 403「主管沒有自己的拜訪路線」。
- 行程是誰的由 token 決定：`user.acts_as_user_id or user.id`。
- 習慣的星期幾：0 是星期一、6 是星期日（跟 Python 的 `date.weekday()` 一樣），NULL 是每天。
- 習慣是硬規則：先後、排第一、排最後一定要守；約的時段、停留只在新增一站（含每天的建議）時當預設值。
- 兩條習慣衝突時新的優先；每天建立建議時排不出來，從最舊的習慣開始一條一條記成今天不套用。
- 存檔時今天的順序還違反的習慣，以當天排的為準記成今天不套用（設計〈已定案的決定〉第 8 點）；還違反的今天的先後拿掉。
- 鎖住在清單上不會「違反」：清單上的位置就是業務排的；鎖只在排順路（`plan`）與插入（`cheapest_insert`）時有作用。
- 共用檔（`backend/app/models.py`、`backend/app/main.py`、`README.md`、設計文件、`frontend/src/pages/today.tsx`、`frontend/src/App.tsx`）只做局部、新增式的修改：新的 model 加在檔案最後、新的段落另起，不重排、不改格式。另一條線（Track B）同時在改 Google 地圖、主管頁、即時位置，不動 `travel.py`、`google_routes.py`、主管頁、presence／location 的程式。
- 每個 commit 訊息最後空一行接 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合併到 main。

## 執行環境

worktree 已經建好（分支 `itinerary-edit`，從 `itinerary` 開出來），`backend/.env` 已複製、`frontend` 已 `npm ci`。所有指令都在 `/Users/jamessu/Desktop/computersciencehomework/MEDDEMO/.worktrees/itinerary-edit` 下跑。後端測試（隔離的資料庫與 Redis，其他對話也在這台機器上跑測試）：

```bash
TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests/<file> -q
```

前端：`cd frontend && npm run typecheck && npm run lint && npm test && npm run build`。

## 檔案

| 檔案 | 動作 | 職責 |
|---|---|---|
| `backend/app/services/route_planner.py` | 改 | 鎖的判斷、多家的排第一／最後、同一條規則拆成好幾組先後時只算一條 |
| `backend/app/models.py` | 改 | `Itinerary.skip_reasons`；最後加 `RouteHabit` |
| `backend/app/services/route_habits.py` | 新 | 習慣的比對、那句話、換成規則、預設值、驗證與新增、示範業務的三條 |
| `backend/app/services/today_route.py` | 改 | `labels`（一次算好幾家的理由） |
| `backend/app/services/itinerary.py` | 改 | 建立時套習慣、`_Open`／`_compose`／`_points`／`_timed`、`preview`、`save`、`candidates`、鎖的例外、三顆鈕的分支 |
| `backend/app/api/itinerary.py` | 改 | 行程多欄位；`preview`、`PUT`、`candidates` |
| `backend/app/api/route_habits.py` | 新 | `GET/POST /api/route-habits`、`PATCH/DELETE /api/route-habits/{id}` |
| `backend/app/main.py` | 改 | 掛上習慣的 router |
| `data/seed/seed.py` | 改 | 灌示範業務的三條習慣 |
| `backend/tests/test_route_planner.py` | 改 | |
| `backend/tests/test_route_habits.py` | 新 | |
| `backend/tests/test_itinerary.py` | 改 | |
| `backend/tests/test_itinerary_api.py` | 改 | |
| `backend/tests/test_route_habits_api.py` | 新 | |
| `backend/tests/test_seed.py` | 改 | |
| `frontend/package.json` | 改 | `@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities` |
| `frontend/src/api/route.ts` | 改 | 新欄位與型別、`previewToday`、`saveToday`、`getCandidates` |
| `frontend/src/api/route-habits.ts` | 新 | 習慣的 API |
| `frontend/src/lib/itinerary.ts` | 新 | 草稿、換位置、拖完的習慣句子、違反的規則（純函式） |
| `frontend/src/lib/route-draft.ts` | 新 | 調整中的草稿 store（清單頁與加一站頁共用） |
| `frontend/src/components/route/stop-card.tsx` | 新 | 清單上的一站 |
| `frontend/src/components/route/stop-editor.tsx` | 新 | 展開編輯 |
| `frontend/src/components/route/habit-prompt.tsx` | 新 | 「以後也這樣排嗎？」 |
| `frontend/src/components/route/switch.tsx` | 新 | 開關（鎖住、習慣的啟用） |
| `frontend/src/pages/route-edit.tsx` | 新 | 調整行程（清單） |
| `frontend/src/pages/route-add.tsx` | 新 | 加一站 |
| `frontend/src/pages/route-habits.tsx` | 新 | 我的排序習慣 |
| `frontend/src/pages/today.tsx` | 改 | 橫幅的「調整」、沒套用的習慣提示 |
| `frontend/src/components/route-path.tsx` | 改 | 會晚到的紅字 |
| `frontend/src/pages/settings.tsx` | 改 | 「我的排序習慣」入口 |
| `frontend/src/App.tsx` | 改 | 三個新路由 |
| `README.md` | 改 | 今日路線那一節 |

---

### Task 1: 排序程式補強（鎖、多家的排第一／最後、拆開的規則）

**Files:**
- Modify: `backend/app/services/route_planner.py`（`violations`、`_locks`、`plan`）
- Test: `backend/tests/test_route_planner.py`

**Interfaces:**
- Produces: `violations(ordered, rules)` 同一個 `id` 只列一次（列違反的那一組）；`plan` 回 `Conflict` 時 `rules` 每個 `id` 只有一條，判斷「拿掉哪一條就排得出來」時同一個 `id` 的規則一起拿掉；`_locks` 允許同一家重複鎖在同一個位置。之後的習慣（Task 2）會把「康泰的店排在診所前面」拆成好幾組兩兩的先後，`id` 都是 `habit:17`。

- [ ] **Step 1: 寫失敗的測試**

加在 `backend/tests/test_route_planner.py` 最後：

```python
def test_a_first_rule_can_cover_several_customers():
    # 「先跑康泰的店」符合兩家：兩家都要排在其他站前面
    first = rp.Rule(id="habit:1", text="先跑康泰的店", kind="first", customer_ids=("B", "C"))
    order = order_of(rp.plan(START, 0, [stop("A", 1), stop("B", 2), stop("C", 3)], [first], LINE))
    assert set(order[:2]) == {"B", "C"} and order[2] == "A"
    assert rp.violations(["B", "A", "C"], [first]) == [first]


def test_a_last_rule_can_cover_several_customers():
    last = rp.Rule(id="habit:1", text="診所排最後", kind="last", customer_ids=("A", "B"))
    order = order_of(rp.plan(START, 0, [stop("A", 1), stop("B", 2), stop("C", 3)], [last], LINE))
    assert order[0] == "C"
    assert rp.violations(["A", "C", "B"], [last]) == [last]


def test_first_and_last_on_the_same_customer_conflict():
    first = rp.Rule(id="habit:1", text="A 排第一", kind="first", customer_ids=("A",))
    last = rp.Rule(id="habit:2", text="A 排最後", kind="last", customer_ids=("A",))
    result = rp.plan(START, 0, [stop("A", 1), stop("B", 2)], [first, last], LINE)
    assert isinstance(result, rp.Conflict)
    assert {r.id for r in result.rules} == {"habit:1", "habit:2"}


def test_two_first_rules_for_different_customers_conflict():
    a_first = rp.Rule(id="habit:1", text="A 排第一", kind="first", customer_ids=("A",))
    b_first = rp.Rule(id="habit:2", text="B 排第一", kind="first", customer_ids=("B",))
    result = rp.plan(START, 0, [stop("A", 1), stop("B", 2), stop("C", 3)], [a_first, b_first], LINE)
    assert isinstance(result, rp.Conflict)
    assert {r.id for r in result.rules} == {"habit:1", "habit:2"}


def test_a_lock_past_the_last_stop_is_a_conflict():
    lock = rp.Rule(id="lock:A", text="A 鎖在第 4 站", kind="lock", customer_ids=("A",), position=3)
    result = rp.plan(START, 0, [stop("A", 1), stop("B", 2)], [lock], LINE)
    assert isinstance(result, rp.Conflict) and result.rules == [lock]
    assert rp.violations(["A", "B"], [lock]) == [lock]


def test_locking_the_same_customer_twice_at_the_same_place_is_fine():
    # 「需立即處理」的鎖與業務自己按的鎖可能同時在：同一家、同一個位置，不算衝突
    lock = rp.Rule(id="lock:C", text="C 排第一站", kind="lock", customer_ids=("C",), position=0)
    again = rp.Rule(id="urgent:C", text="C 需立即處理", kind="lock", customer_ids=("C",), position=0)
    assert order_of(rp.plan(START, 0, [stop("A", 1), stop("B", 2), stop("C", 3)], [lock, again], LINE))[0] == "C"


def test_two_customers_locked_at_the_same_place_conflict():
    lock_a = rp.Rule(id="lock:A", text="A 鎖在第 1 站", kind="lock", customer_ids=("A",), position=0)
    lock_b = rp.Rule(id="lock:B", text="B 鎖在第 1 站", kind="lock", customer_ids=("B",), position=0)
    result = rp.plan(START, 0, [stop("A", 1), stop("B", 2)], [lock_a, lock_b], LINE)
    assert isinstance(result, rp.Conflict)
    assert {r.id for r in result.rules} == {"lock:A", "lock:B"}


def test_the_same_customer_locked_at_two_places_is_a_conflict():
    first = rp.Rule(id="lock:A", text="A 鎖在第 1 站", kind="lock", customer_ids=("A",), position=0)
    second = rp.Rule(id="urgent:A", text="A 鎖在第 2 站", kind="lock", customer_ids=("A",), position=1)
    assert isinstance(rp.plan(START, 0, [stop("A", 1), stop("B", 2)], [first, second], LINE), rp.Conflict)


def test_one_rule_split_into_pairs_is_reported_once():
    # 「B、C 排在 A 前面」這條習慣拆成兩組兩兩的先後，id 一樣；A 又鎖在第一站
    pairs = [
        rp.Rule(id="habit:7", text="B、C 排在 A 前面", kind="precedence", customer_ids=("B", "A")),
        rp.Rule(id="habit:7", text="B、C 排在 A 前面", kind="precedence", customer_ids=("C", "A")),
    ]
    lock = rp.Rule(id="lock:A", text="A 排第一站", kind="lock", customer_ids=("A",), position=0)
    result = rp.plan(START, 0, [stop("A", 1), stop("B", 2), stop("C", 3)], [*pairs, lock], LINE)
    assert isinstance(result, rp.Conflict)
    # 整條習慣拿掉就排得出來，所以它也是擋住的那幾條之一；只列一次
    assert sorted(r.id for r in result.rules) == ["habit:7", "lock:A"]
    assert [r.id for r in rp.violations(["A", "B", "C"], pairs)] == ["habit:7"]
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests/test_route_planner.py -q`
Expected: `test_locking_the_same_customer_twice_at_the_same_place_is_fine` 與 `test_one_rule_split_into_pairs_is_reported_once` FAIL；其他新測試是補測試覆蓋，可能已經通過。

- [ ] **Step 3: 改 `violations`**

整支換成：

```python
def violations(ordered: list[str], rules: list[Rule]) -> list[Rule]:
    """這個順序違反哪幾條規則。只看今天行程裡有的客戶；規則提到的客戶不在行程裡就不算違反。
    同一條規則（同一個 id）拆成好幾組兩兩的先後時（習慣「康泰的店排在診所前面」），只列違反的第一組。"""
    position = {cid: i for i, cid in enumerate(ordered)}
    broken: list[Rule] = []
    seen: set[str] = set()
    for rule in rules:
        if rule.id in seen:
            continue
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
            seen.add(rule.id)
    return broken
```

- [ ] **Step 4: 改 `_locks`**

```python
def _locks(stops: list[PlanStop], rules: list[Rule]) -> dict[int, str] | None:
    """鎖住的位置 → 那一家。同一家重複鎖在同一個位置不算衝突（「需立即處理」的鎖與業務按的鎖可能同時在）；
    兩家鎖在同一個位置、同一家鎖在兩個位置、或位置超出站數，就是排不出來（None）。"""
    present = {s.customer_id for s in stops}
    locks: dict[int, str] = {}
    for rule in rules:
        if rule.kind != "lock" or rule.customer_ids[0] not in present:
            continue
        cid = rule.customer_ids[0]
        if rule.position is None or not 0 <= rule.position < len(stops):
            return None
        if locks.get(rule.position, cid) != cid:
            return None
        if cid in locks.values() and locks.get(rule.position) != cid:
            return None
        locks[rule.position] = cid
    return locks
```

- [ ] **Step 5: 改 `plan` 的衝突分析**

`plan` 裡 `blocking = [...]` 到結尾換成：

```python
    # 一條一條拿掉再試；同一個 id 的規則（一條習慣拆成的好幾組先後）一起拿掉，算一條
    ids = list(dict.fromkeys(rule.id for rule in rules))
    first_of = {rule_id: next(r for r in rules if r.id == rule_id) for rule_id in ids}
    blocking = [
        first_of[rule_id] for rule_id in ids
        if _search(start, start_point, stops, [r for r in rules if r.id != rule_id], minutes) is not None
    ]
    return Conflict(blocking or list(first_of.values()))
```

`Conflict` 的 docstring 補一句：「同一個 id 的規則只列一條。」

- [ ] **Step 6: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests/test_route_planner.py backend/tests/test_itinerary.py -q`
Expected: 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/route_planner.py backend/tests/test_route_planner.py
git commit -m "$(cat <<'EOF'
Planner treats a rule split into pairs as one rule and allows a repeated lock

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 2: 排序習慣的資料表與服務

**Files:**
- Modify: `backend/app/models.py`（`Itinerary.skipped_habit_ids` 那兩行；檔案最後加 `RouteHabit`）
- Create: `backend/app/services/route_habits.py`
- Modify: `data/seed/seed.py`（import 與 `seed()` 裡方法卡之後）
- Test: `backend/tests/test_route_habits.py`（新）、`backend/tests/test_seed.py`

**Interfaces:**
- Consumes: Task 1 的 `route_planner.Rule`（同一個 `id` 可以有好幾條）。
- Produces:
  - `models.RouteHabit`（欄位見下）、`models.ROUTE_HABIT_KINDS`、`models.ROUTE_HABIT_SOURCES`；`Itinerary.skip_reasons: dict[str, str]`（習慣 id 的字串 → 今天為什麼不套用）。
  - `route_habits.HabitSpec(kind, subject, object=None, window_kind=None, window_time=None, duration_minutes=None, weekday=None)`（frozen dataclass；`subject`／`object` 是 `{"by": ..., "value": ...}`）
  - `route_habits.InvalidHabit(ValueError)`
  - `route_habits.RULE_KINDS = ("precedence", "first", "last")`、`TYPE_LABEL`、`WEEKDAY_LABEL = "一二三四五六日"`
  - `spec_of(habit) -> HabitSpec`、`matches(target, customer) -> bool`、`touches(spec, customer) -> bool`
  - `describe(spec, names: dict[str, str]) -> str`（names 是客戶 id → 店名）
  - `applies_on(habit, day) -> bool`、`mine(session, user_id) -> list[RouteHabit]`、`for_day(session, user_id, day) -> list[RouteHabit]`（舊的在前）
  - `rules(entries: Iterable[tuple[str, HabitSpec, str]], customers: list[Customer]) -> list[route_planner.Rule]`（entries 是 (規則 id, 習慣, 那句話)）
  - `defaults(habits, customer) -> tuple[tuple[str, dt.time] | None, int | None]`
  - `targets(session, user_id) -> dict[str, list[tuple[str, str]]]`、`validate(spec, options) -> None`
  - `create(session, user_id, spec, source, created_at=None) -> RouteHabit`、`find(session, user_id, habit_id) -> RouteHabit`（不是他的丟 LookupError）
  - `DEMO_HABITS`、`reset_demo(session, user_id) -> None`

- [ ] **Step 1: 寫失敗的測試**

新檔 `backend/tests/test_route_habits.py`：

```python
"""排序習慣：比對、那句話、換成排序規則、預設值、驗證、示範業務的三條。"""

import datetime as dt

import pytest
from sqlalchemy import select

from app.models import Customer, RouteHabit
from app.services import route_habits as rh

NAMES = {"C1": "德安藥局 · 板橋", "C2": "佑生藥局 · 大安"}


def customer(cid, type_="independent", chain=None, area="大安"):
    # 沒加進 session 的物件，只拿來比對
    return Customer(id=cid, name=NAMES.get(cid, cid), type=type_, chain_group=chain, area=area)


def habit(hid, kind, subject, object_=None, weekday=None, active=True, **extra):
    spec = rh.HabitSpec(kind, subject, object_, weekday=weekday, **extra)
    return RouteHabit(
        id=hid, user_id="U01", kind=kind, subject=subject, object=object_, weekday=weekday, active=active,
        text=rh.describe(spec, NAMES), source="manual", window_kind=extra.get("window_kind"),
        window_time=extra.get("window_time"), duration_minutes=extra.get("duration_minutes"),
    )


def entries(*habits):
    return [(f"habit:{h.id}", rh.spec_of(h), h.text) for h in habits]


KANGTAI = customer("C3", "chain", "康泰連鎖藥局", "中和")
CLINIC = customer("C4", "clinic", area="大安")
BANQIAO = customer("C1", area="板橋")


def test_targets_match_by_customer_chain_type_and_area():
    assert rh.matches({"by": "customer", "value": "C3"}, KANGTAI)
    assert rh.matches({"by": "chain", "value": "康泰連鎖藥局"}, KANGTAI)
    assert not rh.matches({"by": "chain", "value": "康泰連鎖藥局"}, CLINIC)
    assert rh.matches({"by": "type", "value": "clinic"}, CLINIC)
    assert rh.matches({"by": "area", "value": "板橋"}, BANQIAO)
    assert not rh.matches({"by": "area", "value": "板橋"}, CLINIC)


def test_the_sentence_is_written_from_the_fields():
    spec = rh.HabitSpec
    assert rh.describe(spec("precedence", {"by": "chain", "value": "康泰連鎖藥局"}, {"by": "type", "value": "clinic"}), NAMES) == "康泰連鎖藥局的店排在診所前面"
    # 店名有「 · 」，前後空一格，才不會讀成「大安排最後」
    assert rh.describe(spec("precedence", {"by": "customer", "value": "C1"}, {"by": "customer", "value": "C2"}), NAMES) == "德安藥局 · 板橋 排在 佑生藥局 · 大安 前面"
    assert rh.describe(spec("first", {"by": "area", "value": "板橋"}, weekday=0), NAMES) == "星期一先跑板橋"
    assert rh.describe(spec("last", {"by": "customer", "value": "C2"}, weekday=2), NAMES) == "星期三 佑生藥局 · 大安 排最後"
    assert rh.describe(spec("window", {"by": "customer", "value": "C2"}, window_kind="before", window_time=dt.time(11, 0)), NAMES) == "佑生藥局 · 大安 都 11:00 以前到"
    assert rh.describe(spec("window", {"by": "type", "value": "clinic"}, window_kind="at", window_time=dt.time(9, 30)), NAMES) == "診所都約 09:30 到"
    assert rh.describe(spec("duration", {"by": "customer", "value": "C1"}, duration_minutes=60), NAMES) == "去 德安藥局 · 板橋 都停 60 分"


def test_weekday_and_switch_decide_whether_a_habit_applies():
    wednesday = dt.date(2026, 10, 28)
    assert rh.applies_on(habit(1, "first", {"by": "area", "value": "板橋"}), wednesday)
    assert rh.applies_on(habit(2, "first", {"by": "area", "value": "板橋"}, weekday=2), wednesday)
    assert not rh.applies_on(habit(3, "first", {"by": "area", "value": "板橋"}, weekday=0), wednesday)
    assert not rh.applies_on(habit(4, "first", {"by": "area", "value": "板橋"}, active=False), wednesday)


def test_a_precedence_habit_becomes_pairs_under_one_id():
    other_kangtai = customer("C5", "chain", "康泰連鎖藥局", "大安")
    rule = habit(7, "precedence", {"by": "chain", "value": "康泰連鎖藥局"}, {"by": "area", "value": "大安"})
    out = rh.rules(entries(rule), [KANGTAI, other_kangtai, CLINIC, BANQIAO])
    # C5 是康泰、也在大安，兩邊都符合就不算；剩下康泰中和店（C3）要在大安的診所（C4）前面
    assert [(r.id, r.kind, r.customer_ids) for r in out] == [("habit:7", "precedence", ("C3", "C4"))]


def test_first_and_last_cover_every_matching_stop():
    first = habit(1, "first", {"by": "area", "value": "大安"})
    last = habit(2, "last", {"by": "chain", "value": "福安連鎖藥局"})
    out = rh.rules(entries(first, last), [KANGTAI, CLINIC, customer("C6", area="大安"), BANQIAO])
    # 今天沒有福安的店，「排最後」那條就沒有規則
    assert [(r.id, r.kind, r.customer_ids) for r in out] == [("habit:1", "first", ("C4", "C6"))]


def test_window_and_duration_are_only_defaults_and_the_newest_wins():
    older = habit(1, "duration", {"by": "type", "value": "clinic"}, duration_minutes=60)
    newer = habit(2, "duration", {"by": "customer", "value": "C4"}, duration_minutes=20)
    window = habit(3, "window", {"by": "type", "value": "clinic"}, window_kind="before", window_time=dt.time(11, 0))
    assert rh.rules(entries(older, newer, window), [CLINIC, BANQIAO]) == []
    assert rh.defaults([older, newer, window], CLINIC) == (("before", dt.time(11, 0)), 20)
    assert rh.defaults([older, newer, window], BANQIAO) == (None, None)


def test_create_writes_the_sentence_and_only_takes_own_customers(tx):
    mine = tx.scalars(select(Customer).where(Customer.owner_user_id == "U01").order_by(Customer.id)).first()
    theirs = tx.scalars(select(Customer).where(Customer.owner_user_id == "U02")).first()
    made = rh.create(tx, "U01", rh.HabitSpec("duration", {"by": "customer", "value": mine.id}, duration_minutes=60), "manual")
    assert made.id and made.text == f"去 {mine.name} 都停 60 分" and made.active and made.object is None
    with pytest.raises(rh.InvalidHabit, match="只能選自己的客戶"):
        rh.create(tx, "U01", rh.HabitSpec("first", {"by": "customer", "value": theirs.id}), "manual")
    with pytest.raises(rh.InvalidHabit, match="同一個對象"):
        rh.create(tx, "U01", rh.HabitSpec("precedence", {"by": "type", "value": "clinic"}, {"by": "type", "value": "clinic"}), "manual")
    with pytest.raises(rh.InvalidHabit, match="約的時間"):
        rh.create(tx, "U01", rh.HabitSpec("window", {"by": "type", "value": "clinic"}, window_kind="before"), "manual")
    with pytest.raises(LookupError):
        rh.find(tx, "U02", made.id)


def test_the_demo_rep_starts_with_three_habits(tx):
    habits = rh.mine(tx, "U01")
    assert [(h.text, h.weekday, h.source, h.active) for h in habits] == [
        ("康泰連鎖藥局的店排在診所前面", None, "ai", True),
        ("星期三 敦南內科診所 · 大安 排最後", 2, "manual", True),
        ("杏林診所 · 大安 都 11:00 以前到", None, "manual", True),
    ]
    assert rh.mine(tx, "U02") == []


def test_reset_demo_puts_the_three_back(tx):
    habits = rh.mine(tx, "U01")
    habits[0].active = False
    rh.create(tx, "U01", rh.HabitSpec("first", {"by": "area", "value": "板橋"}), "prompt")
    tx.flush()
    rh.reset_demo(tx, "U01")
    again = rh.mine(tx, "U01")
    assert len(again) == 3 and all(h.active for h in again)
    assert {h.id for h in again}.isdisjoint({h.id for h in habits})
```

`backend/tests/test_seed.py` 最後加：

```python
def test_the_demo_rep_has_three_route_habits(db):
    found = rows(db, "SELECT kind, weekday, source FROM route_habit WHERE user_id = 'U01' ORDER BY created_at")
    assert found == [("precedence", None, "ai"), ("last", 2, "manual"), ("window", None, "manual")]
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests/test_route_habits.py -q`
Expected: ImportError（`RouteHabit` 不存在）。

- [ ] **Step 3: 資料表**

`backend/app/models.py` 的 `Itinerary` 裡，把

```python
    # 今天不套用的排序習慣（第二階段才有習慣）
    skipped_habit_ids: Mapped[list[int]] = mapped_column(ARRAY(BigInteger), server_default="{}")
```

換成

```python
    # 今天不套用的排序習慣：每天建立建議時跟別的規則衝突、業務在調整清單上按了「今天不套用」，
    # 或存檔時今天的順序跟它不合（以當天排的為準）
    skipped_habit_ids: Mapped[list[int]] = mapped_column(ARRAY(BigInteger), server_default="{}")
    # 上面每一條為什麼今天不套用（習慣 id 的字串 → 一句話），行程與習慣頁上提示用
    skip_reasons: Mapped[dict[str, Any]] = mapped_column(server_default="{}")
```

檔案最後（`RouteSignalWeight` 之後）加：

```python


# 排序習慣的種類。precedence：A 排在 B 前面；first、last：排在其他站前面、後面；
# window：約的時段；duration：停留多久。前三種是一定要守的規則，後兩種是新增一站時的預設值
ROUTE_HABIT_KINDS = ("precedence", "first", "last", "window", "duration")
# 習慣從哪裡來。ai：在首頁跟熊熊滾說的；prompt：拖完或改完答應的；manual：在習慣頁自己新增的
ROUTE_HABIT_SOURCES = ("ai", "prompt", "manual")


class RouteHabit(Base):
    """業務自己的排序習慣，長期有效、可以限定星期幾（services/route_habits.py）。主管看不到。"""

    __tablename__ = "route_habit"
    __table_args__ = (
        one_of("kind", ROUTE_HABIT_KINDS, "kind"),
        one_of("source", ROUTE_HABIT_SOURCES, "source"),
        CheckConstraint("weekday IS NULL OR weekday BETWEEN 0 AND 6", name="weekday"),
        CheckConstraint("(kind = 'precedence') = (object IS NOT NULL)", name="object"),
        CheckConstraint("window_kind IS NULL OR window_kind IN ('at', 'before', 'after')", name="window_kind"),
        CheckConstraint("(kind = 'window') = (window_kind IS NOT NULL AND window_time IS NOT NULL)", name="window_pair"),
        CheckConstraint("(kind = 'duration') = (duration_minutes IS NOT NULL)", name="duration"),
        CheckConstraint("duration_minutes IS NULL OR duration_minutes > 0", name="duration_positive"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str]
    # {"by": "customer"／"chain"／"type"／"area", "value": ...}：客戶比 id、連鎖體系比 chain_group、類型比 type、地區比 area
    subject: Mapped[dict[str, Any]]
    # 只有 precedence 用：subject 那幾家要排在 object 那幾家前面
    object: Mapped[dict[str, Any] | None]
    window_kind: Mapped[str | None]
    window_time: Mapped[dt.time | None]
    duration_minutes: Mapped[int | None]
    # 0（星期一）～6（星期日），跟 Python 的 date.weekday() 一樣；NULL 是每天
    weekday: Mapped[int | None]
    # 給人看的一句話，由 route_habits.describe 依欄位產生，例如「康泰連鎖藥局的店排在診所前面」
    text: Mapped[str]
    source: Mapped[str]
    # 停用不刪
    active: Mapped[bool] = mapped_column(server_default=text("true"))
    # 兩條習慣衝突時新的優先
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())
```

`text: Mapped[str]` 只是型別註記、沒有賦值，所以類別裡的 `text("true")` 仍然是 `sqlalchemy.text`（不要為了 `true()` 去改檔案開頭的 import：那一段是兩條線共用的）。

- [ ] **Step 4: 習慣的服務**

新檔 `backend/app/services/route_habits.py`：

```python
"""排序習慣（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈排序習慣〉）。

每位業務自己的、長期有效的排法，可以只在星期幾套用。先後、排第一、排最後換成排序程式一定要守的規則
（route_planner.Rule）；約的時段、停留多久只在新增一站（含每天的建議）時當那一站的預設值，之後業務改了就以那一站的為準。
對象比對今天行程裡的站：客戶比 id、連鎖體系比 chain_group、客戶類型比 type、地區比 area。
"""

from __future__ import annotations

import dataclasses
import datetime as dt
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import CUSTOMER_TYPES, Customer, RouteHabit
from app.services import route_planner

TARGET_KINDS = ("customer", "chain", "type", "area")
# 換成排序規則的種類；window、duration 只當新增一站時的預設值
RULE_KINDS = ("precedence", "first", "last")
TYPE_LABEL = {"chain": "連鎖藥局", "independent": "獨立藥局", "clinic": "診所"}
# date.weekday() 的 0 是星期一
WEEKDAY_LABEL = "一二三四五六日"
WINDOW_TEXT = {"at": "都約 {} 到", "before": "都 {} 以前到", "after": "都 {} 以後到"}

Target = dict[str, Any]  # {"by": "customer"／"chain"／"type"／"area", "value": ...}


class InvalidHabit(ValueError):
    """習慣的欄位不合：對象不是這位業務的、種類缺欄位。訊息是寫給業務看的中文。"""


@dataclass(frozen=True)
class HabitSpec:
    """一條習慣的內容：還沒存的（習慣頁新增、拖完答應的、跟熊熊滾說的），或從存著的那一列取出來的。"""

    kind: str
    subject: Target
    object: Target | None = None
    window_kind: str | None = None
    window_time: dt.time | None = None
    duration_minutes: int | None = None
    weekday: int | None = None


@dataclass(frozen=True)
class DemoHabit:
    spec: HabitSpec
    source: str
    days_ago: int  # 幾天前記的：兩條衝突時新的優先，先後要固定


# 示範業務（林昱辰，U01）一開始就有的三條習慣，灌資料與 IT 重置示範業務的行程時都照這份重建。
# 客戶寫店名，建立時才查成 id（假資料的編號由產生程式決定）
DEMO_HABITS = [
    DemoHabit(HabitSpec("precedence", {"by": "chain", "value": "康泰連鎖藥局"}, {"by": "type", "value": "clinic"}), "ai", 20),
    DemoHabit(HabitSpec("last", {"by": "customer", "value": "敦南內科診所 · 大安"}, weekday=2), "manual", 12),
    DemoHabit(
        HabitSpec("window", {"by": "customer", "value": "杏林診所 · 大安"}, window_kind="before", window_time=dt.time(11, 0)),
        "manual", 5,
    ),
]


def spec_of(habit: RouteHabit) -> HabitSpec:
    return HabitSpec(
        kind=habit.kind, subject=habit.subject, object=habit.object, window_kind=habit.window_kind,
        window_time=habit.window_time, duration_minutes=habit.duration_minutes, weekday=habit.weekday,
    )


def matches(target: Target, customer: Customer) -> bool:
    field = {"customer": customer.id, "chain": customer.chain_group, "type": customer.type, "area": customer.area}
    return field.get(target["by"]) == target["value"]


def touches(spec: HabitSpec, customer: Customer) -> bool:
    """這條習慣有沒有提到這一家（先後的前後兩邊都算）。"""
    return matches(spec.subject, customer) or (spec.object is not None and matches(spec.object, customer))


def label(target: Target, names: dict[str, str]) -> str:
    """對象給人看的名字：客戶寫店名，連鎖體系寫「康泰連鎖藥局的店」，類型寫「診所」，地區寫「板橋」。"""
    by, value = target["by"], target["value"]
    if by == "customer":
        return names.get(value, value)
    if by == "chain":
        return f"{value}的店"
    if by == "type":
        return TYPE_LABEL.get(value, value)
    return value


def _part(target: Target, names: dict[str, str]) -> str:
    # 店名有「 · 」（「杏林診所 · 大安」），前後空一格，才不會跟後面的字黏在一起讀錯（「大安排最後」）
    text = label(target, names)
    return f" {text} " if target["by"] == "customer" else text


def describe(spec: HabitSpec, names: dict[str, str]) -> str:
    """給人看的那一句話，由欄位產生，例如「康泰連鎖藥局的店排在診所前面」「星期一先跑板橋」。
    names 是客戶 id → 店名，對象是客戶時用。"""
    who = _part(spec.subject, names)
    if spec.kind == "precedence":
        core = f"{who}排在{_part(spec.object, names)}前面"
    elif spec.kind == "first":
        core = f"先跑{who}"
    elif spec.kind == "last":
        core = f"{who}排最後"
    elif spec.kind == "window":
        core = who + WINDOW_TEXT[spec.window_kind].format(spec.window_time.strftime("%H:%M"))
    else:
        core = f"去{who}都停 {spec.duration_minutes} 分"
    if spec.weekday is not None:
        core = f"星期{WEEKDAY_LABEL[spec.weekday]}{core}"
    return " ".join(core.split())


def applies_on(habit: RouteHabit, day: dt.date) -> bool:
    return habit.active and (habit.weekday is None or habit.weekday == day.weekday())


def mine(session: Session, user_id: str) -> list[RouteHabit]:
    """這位業務所有的習慣（含停用的），舊的在前。"""
    return list(session.scalars(
        select(RouteHabit).where(RouteHabit.user_id == user_id).order_by(RouteHabit.created_at, RouteHabit.id)
    ))


def for_day(session: Session, user_id: str, day: dt.date) -> list[RouteHabit]:
    """這一天套用的習慣（啟用中、星期幾對得上），舊的在前：兩條衝突時新的優先。"""
    return [habit for habit in mine(session, user_id) if applies_on(habit, day)]


def find(session: Session, user_id: str, habit_id: int) -> RouteHabit:
    habit = session.get(RouteHabit, habit_id)
    if habit is None or habit.user_id != user_id:
        raise LookupError(habit_id)
    return habit


def rules(entries: Iterable[tuple[str, HabitSpec, str]], customers: list[Customer]) -> list[route_planner.Rule]:
    """先後、排第一、排最後換成排序程式的規則；entries 是 (規則 id, 習慣, 那句話)，customers 是還沒跑的站。
    先後是「符合 A 的每一站都在符合 B 的每一站前面」：拆成兩兩的先後，id 都是同一條習慣的；同時符合 A 和 B 的站不算。
    排第一、排最後是符合的那幾家一起排在其他站前面、後面。今天沒有符合的站就沒有規則。"""
    out: list[route_planner.Rule] = []
    for key, spec, text in entries:
        if spec.kind not in RULE_KINDS:
            continue
        chosen = [c.id for c in customers if matches(spec.subject, c)]
        if spec.kind == "precedence":
            then = [c.id for c in customers if matches(spec.object, c)]
            both = set(chosen) & set(then)
            out += [
                route_planner.Rule(id=key, text=text, kind="precedence", customer_ids=(first, second))
                for first in chosen if first not in both
                for second in then if second not in both
            ]
        elif chosen:
            out.append(route_planner.Rule(id=key, text=text, kind=spec.kind, customer_ids=tuple(chosen)))
    return out


def defaults(habits: list[RouteHabit], customer: Customer) -> tuple[tuple[str, dt.time] | None, int | None]:
    """新增一站時，習慣給這一家的 (約的時間, 停留分鐘數)；同一家有好幾條時新的優先（habits 照舊到新排）。"""
    window, duration = None, None
    for habit in habits:
        if not matches(habit.subject, customer):
            continue
        if habit.kind == "window":
            window = (habit.window_kind, habit.window_time)
        elif habit.kind == "duration":
            duration = habit.duration_minutes
    return window, duration


def targets(session: Session, user_id: str) -> dict[str, list[tuple[str, str]]]:
    """新增習慣能選的對象，(值, 給人看的名字)：自己的客戶、他們的連鎖體系、三種客戶類型、他們所在的地區。"""
    customers = list(session.scalars(select(Customer).where(Customer.owner_user_id == user_id).order_by(Customer.name)))
    return {
        "customer": [(c.id, c.name) for c in customers],
        "chain": [(g, g) for g in sorted({c.chain_group for c in customers if c.chain_group})],
        "type": [(t, TYPE_LABEL[t]) for t in CUSTOMER_TYPES],
        "area": [(a, a) for a in sorted({c.area for c in customers})],
    }


def validate(spec: HabitSpec, options: dict[str, list[tuple[str, str]]]) -> None:
    """欄位不合就丟 InvalidHabit：種類缺欄位、對象不在 options 裡（不是自己的客戶、客戶沒有的連鎖體系或地區）。"""
    if spec.kind not in (*RULE_KINDS, "window", "duration"):
        raise InvalidHabit("不知道這種習慣")
    if spec.kind == "precedence" and spec.object is None:
        raise InvalidHabit("先後要選前後兩個對象")
    allowed = {by: {value for value, _ in items} for by, items in options.items()}
    for target in [spec.subject] + ([spec.object] if spec.kind == "precedence" else []):
        if target.get("by") not in allowed or target.get("value") not in allowed[target["by"]]:
            raise InvalidHabit("找不到這個對象，只能選自己的客戶")
    if spec.kind == "precedence" and spec.subject == spec.object:
        raise InvalidHabit("前後不能是同一個對象")
    if spec.kind == "window" and (spec.window_kind not in ("at", "before", "after") or spec.window_time is None):
        raise InvalidHabit("約的時間要選幾點到、以前或以後，再填時間")
    if spec.kind == "duration" and not spec.duration_minutes:
        raise InvalidHabit("停留要填幾分鐘")
    if spec.weekday is not None and not 0 <= spec.weekday <= 6:
        raise InvalidHabit("星期幾只能是星期一到星期日")


def create(
    session: Session, user_id: str, spec: HabitSpec, source: str, created_at: dt.datetime | None = None
) -> RouteHabit:
    """新增一條習慣（先驗證）。不回頭改今天已存的行程：要套用的話，業務回去按「幫我排順一點」。"""
    options = targets(session, user_id)
    validate(spec, options)
    window = spec.kind == "window"
    habit = RouteHabit(
        user_id=user_id, kind=spec.kind, subject=dict(spec.subject),
        object=dict(spec.object) if spec.kind == "precedence" else None,
        window_kind=spec.window_kind if window else None, window_time=spec.window_time if window else None,
        duration_minutes=spec.duration_minutes if spec.kind == "duration" else None,
        weekday=spec.weekday, text=describe(spec, dict(options["customer"])), source=source,
    )
    if created_at is not None:
        habit.created_at = created_at
    session.add(habit)
    session.flush()
    return habit


def reset_demo(session: Session, user_id: str) -> None:
    """刪掉這位業務所有的習慣，照 DEMO_HABITS 重建。灌資料、IT 重置示範業務的行程時用：
    評審代理示範業務時加的、停用的習慣不會一直累積到下一批評審。找不到店名的那一條就跳過。"""
    session.execute(delete(RouteHabit).where(RouteHabit.user_id == user_id))
    ids = {name: cid for cid, name in targets(session, user_id)["customer"]}
    now = dt.datetime.now(dt.UTC)
    for demo in DEMO_HABITS:
        subject = demo.spec.subject
        if subject["by"] == "customer":
            if subject["value"] not in ids:
                continue
            subject = {"by": "customer", "value": ids[subject["value"]]}
        spec = dataclasses.replace(demo.spec, subject=subject)
        create(session, user_id, spec, demo.source, created_at=now - dt.timedelta(days=demo.days_ago))
```

- [ ] **Step 5: 灌示範業務的習慣**

`data/seed/seed.py`：import 那一行

```python
from app.services import approvals, attachment_processing, attachments, channel_memory
```

改成

```python
from app.services import approvals, attachment_processing, attachments, channel_memory, route_habits
```

`seed()` 裡 `method_cards, method_feedback = seed_method_cards(...)` 那一行之後加：

```python
        # 示範業務的三條排序習慣（services/route_habits.DEMO_HABITS），IT 重置示範業務的行程時也照這份重建
        route_habits.reset_demo(session, catalog.DEMO_USER_ID)
```

`return` 的字典裡 `"method_card_feedback": method_feedback,` 後面加 `"route_habit": len(route_habits.DEMO_HABITS),`。

- [ ] **Step 6: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests/test_route_habits.py backend/tests/test_seed.py backend/tests/test_itinerary.py backend/tests/test_itinerary_api.py -q`
Expected: 全部 PASS（測試資料庫會重建一次，灌資料時就有三條習慣）。

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/app/services/route_habits.py data/seed/seed.py backend/tests/test_route_habits.py backend/tests/test_seed.py
git commit -m "$(cat <<'EOF'
Add route habits: matching, the sentence, planner rules and the demo rep's three

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 3: 行程服務套上習慣（建立、讀取、加站），整理重複的程式，補兩個例外

**Files:**
- Modify: `backend/app/services/today_route.py`（`label` 那一段）
- Modify: `backend/app/services/itinerary.py`（整份換掉，內容見 Step 3）
- Modify: `backend/app/api/itinerary.py`（`add_stops` 多接 `VersionConflict`）
- Test: `backend/tests/test_itinerary.py`、`backend/tests/test_today_route.py`

**Interfaces:**
- Consumes: Task 2 的 `route_habits`（`for_day`、`rules`、`defaults`、`describe`、`spec_of`、`touches`、`HabitSpec`、`RULE_KINDS`）、`Itinerary.skip_reasons`；Task 1 的 `route_planner`。
- Produces（Task 4、5 用）：
  - `today_route.labels(session, owner_id, customer_ids) -> dict[str, tuple[str, str]]`
  - `itinerary.StopView` 多 `window_kind: str | None`、`window_time: str | None`（"HH:MM"）、`note: str | None`、`locked: bool`、`habit_ids: list[int]`
  - `itinerary.RuleView(id, text, kind, source, customer_ids: list[str])`，source 是 `today`／`habit`／`new`
  - `itinerary.SkippedHabit(id, text, reason, conflict: bool)`、`itinerary.Precedence(before, after)`
  - `itinerary.ItineraryView` 多 `rules: list[RuleView]`、`violations: list[str]`（違反的規則 id）、`precedences: list[Precedence]`、`skipped_habits: list[SkippedHabit]`
  - `itinerary.PendingHabit(spec: route_habits.HabitSpec, skip_today: bool = False)`
  - `itinerary.SKIP_BY_REP = "你選了今天不套用"`、`itinerary.SKIP_BY_ORDER = "跟今天排的順序不合"`
  - 內部（Task 4 用）：`_Open`、`_Day`、`_day`、`_saved_open`、`_precedences`、`_points`、`_timed`、`_rules`、`_locks`、`_new_open`、`_row`、`_cheapest_index`、`_write`、`_compose`、`_reasons`、`_lock`
  - `_lock` 遇到行程已經被刪掉（IT 重置）時丟 `VersionConflict`；`apply_feedback` 收到不認得的動作丟 `ValueError`

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_itinerary.py` 開頭的 import 改成：

```python
import datetime as dt
import itertools
import threading
import time

import catalog
import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    Customer, Itinerary, ItineraryPrecedence, ItineraryStop, RouteHabit, RouteSignalWeight, RouteSnooze, Visit,
)
from app.services import itinerary as service
from app.services import route_habits, route_planner, today_route, travel
from app.timeutil import TAIPEI
```

檔案最後加：

```python
def by_customer(cid):
    return {"by": "customer", "value": cid}


def rebuild(tx, user_id="U01"):
    """刪掉今天的行程再讀一次：照模型的建議與目前的習慣重新建。"""
    tx.execute(delete(Itinerary).where(Itinerary.user_id == user_id))
    tx.expire_all()
    return service.view(tx, service.get_or_create(tx, user_id))


def test_the_suggestion_follows_the_reps_habits(tx):
    tx.execute(delete(RouteHabit).where(RouteHabit.user_id == "U01"))
    ids = [s.customer_id for s in service.view(tx, service.get_or_create(tx, "U01")).stops]
    spec = route_habits.HabitSpec
    route_habits.create(tx, "U01", spec("precedence", by_customer(ids[-1]), by_customer(ids[1])), "manual")
    stay = route_habits.create(tx, "U01", spec("duration", by_customer(ids[2]), duration_minutes=90), "manual")
    route_habits.create(
        tx, "U01", spec("window", by_customer(ids[3]), window_kind="after", window_time=dt.time(14, 0)), "manual",
    )
    view = rebuild(tx)
    order = [s.customer_id for s in view.stops]
    # 需立即處理那家照樣鎖第一站；習慣的先後一定守
    assert order[0] == ids[0] and order.index(ids[-1]) < order.index(ids[1])
    stops = {s.customer_id: s for s in view.stops}
    assert stops[ids[2]].duration_minutes == 90 and stay.id in stops[ids[2]].habit_ids
    assert (stops[ids[3]].window_kind, stops[ids[3]].window_time) == ("after", "14:00")
    assert any(r.source == "habit" for r in view.rules) and view.violations == []
    assert view.skipped_habits == []


def test_habits_that_cannot_be_kept_are_skipped_today_with_the_reason(tx):
    tx.execute(delete(RouteHabit).where(RouteHabit.user_id == "U01"))
    plain = service.view(tx, service.get_or_create(tx, "U01"))
    ids = [s.customer_id for s in plain.stops]
    spec = route_habits.HabitSpec
    # 「第三家排第一」跟「需立即處理那家排第一站」的鎖打架；「第四家排最後」與較新的「第五家排最後」也打架
    first = route_habits.create(tx, "U01", spec("first", by_customer(ids[2])), "manual")
    older = route_habits.create(tx, "U01", spec("last", by_customer(ids[3])), "manual")
    newer = route_habits.create(tx, "U01", spec("last", by_customer(ids[4])), "manual")
    view = rebuild(tx)
    skipped = {h.id: h for h in view.skipped_habits}
    assert set(skipped) == {first.id, older.id}
    assert skipped[first.id].reason == f"跟『{plain.stops[0].customer_name} 排第一站』衝突"
    assert skipped[older.id].reason == f"跟『{newer.text}』衝突" and skipped[older.id].conflict
    assert view.stops[0].customer_id == ids[0] and view.stops[-1].customer_id == ids[4]
    assert view.violations == []


def test_the_view_lists_todays_rules_and_what_the_order_breaks(tx):
    itinerary = service.get_or_create(tx, "U01")
    view = service.view(tx, itinerary)
    ids = [s.customer_id for s in view.stops]
    names = {s.customer_id: s.customer_name for s in view.stops}
    tx.add(ItineraryPrecedence(itinerary_id=itinerary.id, before_customer_id=ids[3], after_customer_id=ids[1]))
    tx.flush()
    view = service.view(tx, itinerary)
    rule = next(r for r in view.rules if r.source == "today")
    assert (rule.id, rule.kind, rule.customer_ids) == (f"today:{ids[3]}>{ids[1]}", "precedence", [ids[3], ids[1]])
    assert rule.text == f"{names[ids[3]]} 排在 {names[ids[1]]} 前面"
    assert rule.id in view.violations
    assert [(p.before, p.after) for p in view.precedences] == [(ids[3], ids[1])]
    assert view.stops[0].locked and not view.stops[1].locked


def test_added_stops_get_the_habit_defaults_and_keep_the_habit_rules(tx):
    itinerary = service.get_or_create(tx, "U01")
    on_route = [s.customer_id for s in service.view(tx, itinerary).stops]
    mine = tx.scalars(
        select(Customer.id).where(Customer.owner_user_id == "U01", Customer.id.not_in(on_route)).order_by(Customer.id)
    ).first()
    spec = route_habits.HabitSpec
    route_habits.create(tx, "U01", spec("duration", by_customer(mine), duration_minutes=60), "manual")
    route_habits.create(tx, "U01", spec("last", by_customer(mine)), "manual")
    service.add_stops(tx, "U01", [mine])
    view = service.view(tx, itinerary)
    assert view.stops[-1].customer_id == mine and view.stops[-1].duration_minutes == 60


def test_reading_after_an_it_reset_is_a_version_conflict(tx):
    itinerary = service.get_or_create(tx, "U01")
    # 讀到之後、鎖住之前，IT 在另一條連線按了重置：這個 session 裡的物件還在，資料庫裡已經沒有了
    tx.execute(text("DELETE FROM itinerary WHERE id = :id"), {"id": itinerary.id})
    with pytest.raises(service.VersionConflict):
        service._lock(tx, itinerary)


def test_an_unknown_button_is_refused(tx):
    itinerary = service.get_or_create(tx, "U01")
    target = service.view(tx, itinerary).stops[1]
    with pytest.raises(ValueError):
        service.apply_feedback(tx, "U01", target.customer_id, "ignore", 1)
```

`backend/tests/test_today_route.py` 最後加：

```python
def test_labels_for_several_customers_at_once(tx):
    from sqlalchemy import select

    from app.models import Customer

    ids = tx.scalars(select(Customer.id).where(Customer.owner_user_id == "U01").order_by(Customer.id).limit(3)).all()
    found = today_route.labels(tx, "U01", list(ids))
    assert set(found) == set(ids)
    assert found[ids[0]] == today_route.label(tx, "U01", ids[0])
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests/test_itinerary.py backend/tests/test_today_route.py -q`
Expected: 新的七個測試 FAIL（`labels` 不存在、`view` 沒有 `rules`、建立時沒套習慣、`_lock` 丟的是 `ObjectDeletedError`、不認得的動作被當成暫緩）。

- [ ] **Step 3: `today_route.labels`**

`backend/app/services/today_route.py` 的 `label` 換成：

```python
def labels(session: Session, owner_id: str, customer_ids: list[str]) -> dict[str, tuple[str, str]]:
    """業務自己加進行程的幾家，用跟模型挑的同一套說法寫 (訊號, 理由)。只能問這位業務自己的客戶；
    一次算好幾家，客戶的特徵、承諾與商機各只查一次。"""
    today = customer_profile.app_today(session)
    wanted = set(customer_ids)
    overdue = _overdue_commitments(session, owner_id, today)
    opportunities = _opportunities(session, owner_id, today)
    found = {}
    for candidate in route_model.candidates(session, today, owner_id=owner_id):
        if candidate.customer_id in wanted:
            signal, reason, _ = _label(
                candidate, today, overdue.get(candidate.customer_id), opportunities.get(candidate.customer_id)
            )
            found[candidate.customer_id] = (signal, reason)
    return found


def label(session: Session, owner_id: str, customer_id: str) -> tuple[str, str]:
    """一家的 (訊號, 理由)，見 labels。"""
    return labels(session, owner_id, [customer_id])[customer_id]
```

- [ ] **Step 4: `itinerary.py` 整份換成下面這樣**

（跟第 1 階段比：`view` 多了規則、違反、先後、今天不套用的習慣；建立時套習慣；加站時守今天的先後與習慣；出發點與要算車程的點只在 `_points` 組一次；順序已經定了的車程走 `_timed`（Track B 接 Google 時把它換成 `travel.along`，只改這一支）；`_lock` 與 `apply_feedback` 補例外。）

```python
"""今天的行程（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md）。

當天第一次讀取時照模型的建議建一份存起來：模型挑哪幾家（today_route.pick），套上業務的排序習慣（route_habits），
順序交給 route_planner 排順路，「需立即處理」那家鎖在第一站。之後一律以存著的為準，模型不再重排；業務或主管誰先讀都一樣。
已完成與否不存：跟以前一樣看今天有沒有這家已確認的拜訪紀錄，跑完的站排在最前面。

還沒跑的站，不管是存著的（ItineraryStop）還是調整清單上改到一半的，都先整理成 _Open，
再用同一支 _compose 算時間、車程、要守的規則與違反了哪幾條。
"""

from __future__ import annotations

import dataclasses
import datetime as dt
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import ObjectDeletedError

from app.models import (
    AppUser, Customer, Itinerary, ItineraryPrecedence, ItineraryStop, OrgUnit, RouteHabit, RouteSignalWeight,
    RouteSnooze, Visit,
)
from app.services import customer_profile, route_habits, route_planner, today_route, travel
from app.timeutil import TAIPEI

# 每站預設停留多久。以前用「平均 70 分鐘一站」排時間，那包含了車程；現在車程另外算
DEFAULT_DURATION = 40
# 暫緩跳過三天：足夠跳過這一趟和隔天的路線，又不會整個週期看不到這家（跟原本手機上的一樣）
SNOOZE_DAYS = 3
# 今天不套用某條習慣的原因（Itinerary.skip_reasons）。每天建立建議時衝突的另外寫「跟『…』衝突」
SKIP_BY_REP = "你選了今天不套用"
SKIP_BY_ORDER = "跟今天排的順序不合"

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
    window_kind: str | None = None  # 約的時間：at 幾點到、before 以前、after 以後
    window_time: str | None = None  # "HH:MM"
    note: str | None = None
    locked: bool = False
    # 套用在這一站的習慣（存著的才算），調整清單的卡片上標綠色「習慣」
    habit_ids: list[int] = field(default_factory=list)


@dataclass
class RuleView:
    """調整清單要守的規則。鎖住的不列：清單上的位置就是業務排的，不會違反；鎖只在排順路與插入新的一站時有作用。"""

    id: str  # "today:C012>C034"、"habit:17"、"new:0"
    text: str
    kind: str  # precedence／first／last
    source: str  # today：今天設的先後；habit：習慣；new：這次答應要記、按「完成」才存的習慣
    customer_ids: list[str]  # precedence 是 [前, 後]；同一條習慣拆成好幾組時 id 相同


@dataclass
class SkippedHabit:
    id: int
    text: str
    reason: str
    # 每天建立建議時跟別的規則衝突：行程上要提示。業務自己選的、存檔時順序不合的不算
    conflict: bool


@dataclass
class Precedence:
    before: str
    after: str


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
    rules: list[RuleView] = field(default_factory=list)
    violations: list[str] = field(default_factory=list)  # 目前的順序違反的規則 id
    precedences: list[Precedence] = field(default_factory=list)  # 今天設的先後
    skipped_habits: list[SkippedHabit] = field(default_factory=list)  # 今天套用、但今天不套用的習慣


@dataclass
class Skipped:
    customer_id: str
    customer_name: str
    reason: str


@dataclass(frozen=True)
class PendingHabit:
    """調整清單上這次答應要記、按「完成」才存的習慣。skip_today：紅框上按了「今天不套用這條」，照樣記下來，只是今天不套用。"""

    spec: route_habits.HabitSpec
    skip_today: bool = False


@dataclass
class _Open:
    """還沒跑的一站。存著的（ItineraryStop）與調整清單上改到一半的都整理成這個樣子，再算時間與規則。"""

    customer: Customer
    source: str
    signal: str
    reason: str
    duration_minutes: int
    window_kind: str | None
    window_time: dt.time | None
    note: str | None
    locked: bool

    def plan_stop(self, point: int) -> route_planner.PlanStop:
        window = (self.window_kind, self.window_time) if self.window_kind and self.window_time else None
        return route_planner.PlanStop(
            customer_id=self.customer.id, point=point, duration=self.duration_minutes, window=window
        )


@dataclass
class _Day:
    """算一份行程要用的：這份行程、業務、今天跑完的站（照拜訪時間）、存著的每一站、今天套用的習慣。"""

    itinerary: Itinerary
    rep: AppUser
    done: list[tuple[Visit, Customer]]
    rows: list[ItineraryStop]
    habits: list[RouteHabit]

    @property
    def done_ids(self) -> set[str]:
        return {c.id for _, c in self.done}

    def durations(self) -> dict[str, int]:
        return {r.customer_id: r.duration_minutes for r in self.rows}


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
    """畫面要的樣子：跑完的站在前（照拜訪時間），還沒跑的照存著的順序；時間、車程、規則與違反現算。"""
    day = _day(session, itinerary)
    skipped = set(itinerary.skipped_habit_ids)
    return _compose(
        session, day, _saved_open(session, day), _precedences(session, itinerary), skipped,
        _reasons(itinerary, skipped), [],
    )


def apply_feedback(session: Session, user_id: str, customer_id: str, action: FeedbackAction, version: int) -> Itinerary:
    """需立即處理的三顆鈕。插入下一站：移到還沒跑的第一站，同類提醒之後排前面一點；
    暫緩：從今天拿掉，三天內的建議不排；誤判：暫緩，再加上同類提醒之後少排一點。"""
    if action not in ("pin", "snooze", "misjudge"):
        raise ValueError(action)
    itinerary = get_or_create(session, user_id)
    _lock(session, itinerary)
    if itinerary.version != version:
        raise VersionConflict
    day = _day(session, itinerary)
    row = next((r for r in day.rows if r.customer_id == customer_id and customer_id not in day.done_ids), None)
    if row is None:
        raise NotOnItinerary(customer_id)
    if action == "pin":
        finished = [r for r in day.rows if r.customer_id in day.done_ids]
        rest = [r for r in day.rows if r.customer_id not in day.done_ids and r is not row]
        _renumber([*finished, row, *rest])
        _adjust_weight(session, user_id, row.signal, 1)
    elif action in ("snooze", "misjudge"):
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
    """把幾家加進今天的行程，各自插在多繞最少、又不新增違反規則（鎖住的站、今天的先後、習慣）的位置，
    約的時間與停留照習慣給的預設值。回傳 (行程, 加進去的店名, 沒加的與原因)。
    加進來的那家一併取消暫緩，否則明天的建議照樣不排它。"""
    itinerary = get_or_create(session, user_id)
    _lock(session, itinerary)
    day = _day(session, itinerary)
    open_ = _saved_open(session, day)
    precedences = _precedences(session, itinerary)
    skipped_habits = set(itinerary.skipped_habit_ids)
    on_route = {r.customer_id for r in day.rows}
    wanted = list(dict.fromkeys(customer_ids))
    found = _customers(session, wanted)
    mine = [cid for cid in wanted if cid in found and found[cid].owner_user_id == user_id]
    labels = today_route.labels(session, user_id, mine) if mine else {}
    added: list[str] = []
    skipped: list[Skipped] = []
    for cid in wanted:
        customer = found.get(cid)
        if customer is None or customer.owner_user_id != user_id:
            skipped.append(Skipped(cid, customer.name if customer else cid, "不是你的客戶"))
            continue
        if cid in day.done_ids:
            skipped.append(Skipped(cid, customer.name, "今天已經去過了"))
            continue
        if cid in on_route:
            skipped.append(Skipped(cid, customer.name, "已經在今天的行程裡"))
            continue
        if len(open_) >= route_planner.MAX_OPEN_STOPS:
            skipped.append(Skipped(cid, customer.name, f"今天已經排了 {route_planner.MAX_OPEN_STOPS} 站"))
            continue
        new = _new_open(customer, source, labels[cid], day.habits)
        open_.insert(_cheapest_index(session, day, open_, new, precedences, skipped_habits), new)
        on_route.add(cid)
        added.append(customer.name)
        session.execute(delete(RouteSnooze).where(RouteSnooze.user_id == user_id, RouteSnooze.customer_id == cid))
    if added:
        _write(session, day, open_)
        _touch(itinerary)
    session.flush()
    return itinerary, added, skipped


def reset_today(session: Session, user_id: str) -> None:
    """IT 用：刪掉這位業務今天的行程（站與先後跟著 ON DELETE CASCADE 一起刪），
    以及所有的暫緩、訊號權重，下次讀取就照模型的建議重新建一份。

    示範業務的行程給所有用第三方登入的評審共用：系統日期固定在決賽日不會換天，行程第一次建好之後
    就一直是存著的那份，按過的暫緩、調整過的權重也會一直留著、累積影響之後的建議。換一批評審之前，
    IT 用這個清掉，回到當天早上模型原本的建議。
    """
    today = customer_profile.app_today(session)
    session.execute(delete(Itinerary).where(Itinerary.user_id == user_id, Itinerary.date == today))
    session.execute(delete(RouteSnooze).where(RouteSnooze.user_id == user_id))
    session.execute(delete(RouteSignalWeight).where(RouteSignalWeight.user_id == user_id))


def _find(session: Session, user_id: str, today: dt.date) -> Itinerary | None:
    return session.scalar(select(Itinerary).where(Itinerary.user_id == user_id, Itinerary.date == today))


def _lock(session: Session, itinerary: Itinerary) -> None:
    """鎖住這份行程、重新讀一次。兩個人同時改同一位業務的行程：後到的等前一個存完，再看到版本已經變了。
    讀到之後、鎖住之前行程被刪掉了（IT 重置示範業務的行程）：當成版本對不上，畫面重新載入就會照建議再建一份。"""
    try:
        session.refresh(itinerary, with_for_update=True)
    except ObjectDeletedError:
        raise VersionConflict from None


def _create(session: Session, rep: AppUser, today: dt.date) -> Itinerary:
    picked = today_route.pick(session, rep.id, today_route.load_feedback(session, rep.id, today))
    items = {item["candidate"].customer_id: item for item in picked.picked}
    customers = _customers(session, list(items))
    habits = route_habits.for_day(session, rep.id, today)
    urgent_id = picked.urgent.customer_id if picked.urgent else None
    open_ = [
        _new_open(customers[cid], "model", (item["signal"], item["reason"]), habits, locked=cid == urgent_id)
        for cid, item in items.items()
    ]
    start, points = _points(session, rep, today, picked.done, {}, [o.customer for o in open_])
    # 順序還要由程式挑：要整張車程矩陣
    minutes = travel.matrix(points).minutes
    stops = [o.plan_stop(n + 1) for n, o in enumerate(open_)]
    locks = []
    if picked.urgent:
        # 「需立即處理」那家鎖在第一站，其他照順路排；業務之後可以拖走或解鎖
        locks.append(route_planner.Rule(
            id=f"lock:{urgent_id}", text=f"{picked.urgent.customer_name} 排第一站",
            kind="lock", customer_ids=(urgent_id,), position=0,
        ))
    result, skipped, reasons = _fit_habits(start, stops, locks, habits, [o.customer for o in open_], minutes)
    # 只剩鎖也排不出來（不會發生）就照模型挑的順序
    order = [s.customer_id for s in result.slots] if isinstance(result, route_planner.Schedule) else list(items)
    by_id = {o.customer.id: o for o in open_}
    itinerary = Itinerary(
        user_id=rep.id, date=today,
        suggested=[{"customer_id": cid, "signal": items[cid]["signal"], "reason": items[cid]["reason"]} for cid in order],
        urgent=dataclasses.asdict(picked.urgent) if picked.urgent else None,
        skipped_habit_ids=skipped, skip_reasons=reasons,
    )
    session.add(itinerary)
    session.flush()
    session.add_all([_row(itinerary, n, by_id[cid]) for n, cid in enumerate(order)])
    session.flush()
    return itinerary


def _fit_habits(
    start: dt.datetime, stops: list[route_planner.PlanStop], locks: list[route_planner.Rule], habits: list[RouteHabit],
    customers: list[Customer], minutes: list[list[int]],
) -> tuple[route_planner.Schedule | route_planner.Conflict, list[int], dict[str, str]]:
    """每天建立建議：守住鎖與今天套用的習慣排順路。排不出來就從最舊的習慣開始，一條一條記成今天不套用，直到排得出來。
    原因寫它跟哪一條衝突：先找比它新的習慣（新的優先），再找鎖住的站。回傳 (排的結果, 今天不套用的習慣, 原因)。"""
    by_key = {f"habit:{h.id}": h for h in habits}
    groups: dict[str, list[route_planner.Rule]] = {}
    entries = [(key, route_habits.spec_of(h), h.text) for key, h in by_key.items()]
    for rule in [*locks, *route_habits.rules(entries, customers)]:
        groups.setdefault(rule.id, []).append(rule)

    def age(key: str) -> tuple[dt.datetime, int]:
        return by_key[key].created_at, by_key[key].id

    skipped: list[int] = []
    reasons: dict[str, str] = {}
    while True:
        live = {key: rules for key, rules in groups.items() if key not in by_key or by_key[key].id not in skipped}
        result = route_planner.plan(start, 0, stops, [r for rules in live.values() for r in rules], minutes)
        if isinstance(result, route_planner.Schedule):
            return result, skipped, reasons
        live_habits = [key for key in live if key in by_key]
        blocking = [r.id for r in result.rules if r.id in by_key] or live_habits
        if not blocking:
            return result, skipped, reasons
        oldest = min(blocking, key=age)
        others = sorted((k for k in live_habits if k != oldest), key=age, reverse=True)
        others += [k for k in live if k not in by_key]
        partner = next(
            (k for k in others
             if isinstance(route_planner.plan(start, 0, stops, live[oldest] + live[k], minutes), route_planner.Conflict)),
            None,
        )
        skipped.append(by_key[oldest].id)
        reasons[str(by_key[oldest].id)] = f"跟『{live[partner][0].text}』衝突" if partner else "跟其他幾條一起排不出來"


def _day(session: Session, itinerary: Itinerary) -> _Day:
    rep = session.get(AppUser, itinerary.user_id)
    return _Day(
        itinerary=itinerary, rep=rep, done=today_route.done_visits(session, rep.id, itinerary.date),
        rows=_rows(session, itinerary), habits=route_habits.for_day(session, rep.id, itinerary.date),
    )


def _saved_open(session: Session, day: _Day) -> list[_Open]:
    """存著的還沒跑的站，照存著的順序。"""
    rows = [r for r in day.rows if r.customer_id not in day.done_ids]
    customers = _customers(session, [r.customer_id for r in rows])
    return [
        _Open(customers[r.customer_id], r.source, r.signal, r.reason, r.duration_minutes, r.window_kind,
              r.window_time, r.note, r.locked)
        for r in rows
    ]


def _new_open(
    customer: Customer, source: str, label: tuple[str, str], habits: list[RouteHabit], locked: bool = False
) -> _Open:
    """新加進來的一站：約的時間與停留照習慣給的預設值，沒有就不約、停 40 分鐘。"""
    window, duration = route_habits.defaults(habits, customer)
    signal, reason = label
    return _Open(
        customer, source, signal, reason, duration or DEFAULT_DURATION, window[0] if window else None,
        window[1] if window else None, None, locked,
    )


def _row(itinerary: Itinerary, position: int, stop: _Open) -> ItineraryStop:
    return ItineraryStop(
        itinerary_id=itinerary.id, position=position, customer_id=stop.customer.id, source=stop.source,
        signal=stop.signal, reason=stop.reason, duration_minutes=stop.duration_minutes,
        window_kind=stop.window_kind, window_time=stop.window_time, note=stop.note, locked=stop.locked,
    )


def _precedences(session: Session, itinerary: Itinerary) -> list[tuple[str, str]]:
    """今天設的先後 (前, 後)。"""
    return [
        (before, after)
        for before, after in session.execute(
            select(ItineraryPrecedence.before_customer_id, ItineraryPrecedence.after_customer_id)
            .where(ItineraryPrecedence.itinerary_id == itinerary.id)
            .order_by(ItineraryPrecedence.before_customer_id, ItineraryPrecedence.after_customer_id)
        )
    ]


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


def _points(
    session: Session, rep: AppUser, today: dt.date, done: list[tuple[Visit, Customer]], durations: dict[str, int],
    customers: list[Customer],
) -> tuple[dt.datetime, list[travel.Point]]:
    """出發時間與要算車程的點：第 0 點是出發點，第 n + 1 點是 customers 的第 n 家。區處沒有位置時從第一家出發。"""
    start, origin = _start(session, rep, today, done, durations)
    points = [_point(c) for c in customers]
    return start, [origin or (points[0] if points else (0.0, 0.0)), *points]


def _timed(points: list[travel.Point]) -> travel.Matrix:
    """照這個順序跑的車程（順序已經定了：讀取、調整清單的 preview 與存檔）。只會用到相鄰兩點
    （第 n 點到第 n + 1 點）那幾格。順序還要由程式挑的地方（每天的建議、插入新的一站、排順路）直接用 travel.matrix。"""
    return travel.matrix(points)


def _rules(
    open_: list[_Open], precedences: list[tuple[str, str]], habits: list[RouteHabit], skipped: set[int],
    pending: Sequence[PendingHabit] = (),
) -> list[route_planner.Rule]:
    """還沒跑的站要守的規則：今天設的先後、今天套用的習慣（今天不套用的除外）、這次答應要記的習慣
    （id 是 new: 加上它在草稿裡的順序）。不含鎖住的位置（見 _locks）。"""
    customers = [o.customer for o in open_]
    names = {c.id: c.name for c in customers}
    today = [
        route_planner.Rule(
            id=f"today:{a}>{b}",
            text=route_habits.describe(
                route_habits.HabitSpec("precedence", {"by": "customer", "value": a}, {"by": "customer", "value": b}),
                names,
            ),
            kind="precedence", customer_ids=(a, b),
        )
        for a, b in precedences if a in names and b in names
    ]
    entries = [(f"habit:{h.id}", route_habits.spec_of(h), h.text) for h in habits if h.id not in skipped]
    entries += [
        (f"new:{i}", p.spec, route_habits.describe(p.spec, names)) for i, p in enumerate(pending) if not p.skip_today
    ]
    return today + route_habits.rules(entries, customers)


def _locks(open_: list[_Open], done: int) -> list[route_planner.Rule]:
    """鎖住的站在還沒跑的站裡的位置，排順路與插入新的一站時不動。done 是跑完幾站，寫那句話的站號用。"""
    return [
        route_planner.Rule(
            id=f"lock:{o.customer.id}", text=f"{o.customer.name} 鎖在第 {done + n + 1} 站",
            kind="lock", customer_ids=(o.customer.id,), position=n,
        )
        for n, o in enumerate(open_) if o.locked
    ]


def _cheapest_index(
    session: Session, day: _Day, open_: list[_Open], new: _Open, precedences: list[tuple[str, str]], skipped: set[int],
    pending: Sequence[PendingHabit] = (),
) -> int:
    """新的一站插在還沒跑的站的第幾個位置：多繞最少、又不新增違反（鎖、今天的先後、習慣）。"""
    customers = [o.customer for o in open_] + [new.customer]
    durations = day.durations() | {o.customer.id: o.duration_minutes for o in open_}
    start, points = _points(session, day.rep, day.itinerary.date, day.done, durations, customers)
    matrix = travel.matrix(points)
    ordered = [o.plan_stop(n + 1) for n, o in enumerate(open_)]
    rules = _rules([*open_, new], precedences, day.habits, skipped, pending) + _locks(open_, len(day.done))
    return route_planner.cheapest_insert(start, 0, ordered, new.plan_stop(len(open_) + 1), rules, matrix.minutes)


def _write(session: Session, day: _Day, open_: list[_Open]) -> None:
    """還沒跑的站照 open_ 寫回去：拿掉的刪（連今天的先後一起刪）、新的加、其他照 open_ 改欄位與順序；
    跑完的站排最前面、不動。拿掉的是「需立即處理」那家，紅卡跟著收起來。"""
    keep = {o.customer.id for o in open_}
    by_customer = {r.customer_id: r for r in day.rows}
    for row in day.rows:
        if row.customer_id not in keep and row.customer_id not in day.done_ids:
            _remove(session, day.itinerary, row)
    ordered = []
    for o in open_:
        row = by_customer.get(o.customer.id)
        if row is None:
            row = _row(day.itinerary, 0, o)
            session.add(row)
        else:
            row.duration_minutes, row.note, row.locked = o.duration_minutes, o.note, o.locked
            row.window_kind, row.window_time = o.window_kind, o.window_time
        ordered.append(row)
    _renumber([r for r in day.rows if r.customer_id in day.done_ids] + ordered)
    urgent = day.itinerary.urgent
    if urgent and urgent["customer_id"] not in keep and urgent["customer_id"] not in day.done_ids:
        day.itinerary.urgent = None


def _compose(
    session: Session, day: _Day, open_: list[_Open], precedences: list[tuple[str, str]], skipped: set[int],
    reasons: dict[str, str], pending: Sequence[PendingHabit],
) -> ItineraryView:
    itinerary, rep = day.itinerary, day.rep
    durations = day.durations() | {o.customer.id: o.duration_minutes for o in open_}
    start, points = _points(session, rep, itinerary.date, day.done, durations, [o.customer for o in open_])
    matrix = _timed(points)
    planned = route_planner.schedule(start, 0, [o.plan_stop(n + 1) for n, o in enumerate(open_)], matrix.minutes)
    rules = _rules(open_, precedences, day.habits, skipped, pending)
    order = [o.customer.id for o in open_]
    applied = [h for h in day.habits if h.id not in skipped]

    by_row = {r.customer_id: r for r in day.rows}
    stops = []
    for visit, customer in day.done:
        row = by_row.get(customer.id)
        stops.append(StopView(
            customer_id=customer.id, customer_name=customer.name, type=customer.type, grade=customer.grade,
            planned_time=visit.visited_at.astimezone(TAIPEI).strftime("%H:%M"), status="done",
            signal="routine", reason="已完成", visit_id=visit.id, source=row.source if row else "rep",
            duration_minutes=row.duration_minutes if row else DEFAULT_DURATION, late_minutes=0,
            travel_minutes=None, travel_km=None, note=row.note if row else None,
        ))
    total_km = 0.0
    for n, (o, slot) in enumerate(zip(open_, planned.slots, strict=True)):
        km = matrix.km[n][n + 1]
        total_km += km
        stops.append(StopView(
            customer_id=o.customer.id, customer_name=o.customer.name, type=o.customer.type, grade=o.customer.grade,
            planned_time=slot.arrive.strftime("%H:%M"), status="next" if n == 0 else "todo",
            signal=o.signal, reason=o.reason, visit_id=None, source=o.source,
            duration_minutes=o.duration_minutes, late_minutes=slot.late_minutes,
            travel_minutes=slot.travel_minutes, travel_km=km,
            window_kind=o.window_kind, window_time=o.window_time.strftime("%H:%M") if o.window_time else None,
            note=o.note, locked=o.locked, habit_ids=_habit_ids(applied, o),
        ))
    open_ids = set(order)
    urgent = itinerary.urgent if itinerary.urgent and itinerary.urgent["customer_id"] in open_ids else None
    return ItineraryView(
        date=itinerary.date, rep=rep, version=itinerary.version, done=len(day.done), total=len(stops), urgent=urgent,
        stops=stops, travel_minutes=planned.travel_minutes, travel_km=round(total_km, 1),
        finish_time=planned.slots[-1].leave.strftime("%H:%M") if planned.slots else None,
        estimated=matrix.estimated,
        rules=[RuleView(r.id, r.text, r.kind, r.id.split(":")[0], list(r.customer_ids)) for r in rules],
        violations=[r.id for r in route_planner.violations(order, rules)],
        precedences=[Precedence(a, b) for a, b in precedences if a in open_ids and b in open_ids],
        skipped_habits=[
            SkippedHabit(h.id, h.text, reasons[str(h.id)], reasons[str(h.id)] not in (SKIP_BY_REP, SKIP_BY_ORDER))
            for h in day.habits if h.id in skipped
        ],
    )


def _habit_ids(habits: list[RouteHabit], stop: _Open) -> list[int]:
    """這一站套用了哪幾條習慣：先後、排第一、排最後提到這一家，或約的時間、停留跟習慣給的一樣。"""
    found = []
    for habit in habits:
        if not route_habits.touches(route_habits.spec_of(habit), stop.customer):
            continue
        same_window = habit.kind == "window" and (stop.window_kind, stop.window_time) == (habit.window_kind, habit.window_time)
        same_stay = habit.kind == "duration" and stop.duration_minutes == habit.duration_minutes
        if habit.kind in route_habits.RULE_KINDS or same_window or same_stay:
            found.append(habit.id)
    return found


def _reasons(itinerary: Itinerary, skipped: set[int]) -> dict[str, str]:
    """今天不套用的每一條習慣為什麼不套用：記過原因的照舊，其他（這次在紅框上按了「今天不套用」）寫成業務選的。"""
    saved = itinerary.skip_reasons or {}
    return {str(i): saved.get(str(i), SKIP_BY_REP) for i in skipped}


def _rows(session: Session, itinerary: Itinerary) -> list[ItineraryStop]:
    return list(session.scalars(
        select(ItineraryStop).where(ItineraryStop.itinerary_id == itinerary.id)
        .order_by(ItineraryStop.position, ItineraryStop.id)
    ))


def _customers(session: Session, ids: list[str]) -> dict[str, Customer]:
    return {c.id: c for c in session.scalars(select(Customer).where(Customer.id.in_(ids)))} if ids else {}


def _point(customer: Customer) -> travel.Point:
    return customer.lat, customer.lng


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

說明：第 1 階段的 `_durations`、`_plan_stop`、`_cheapest_index` 舊寫法都由上面的 `_Day.durations`、`_Open.plan_stop`、新的 `_cheapest_index` 取代；三處重複的「出發點加各站的點、算車程矩陣」由 `_points` 取代；其他檔案沒有用到這幾支私有函式（`grep -rn "_plan_stop\|_durations" backend` 確認一次）。

- [ ] **Step 5: 加站 API 也接版本衝突**

`backend/app/api/itinerary.py` 的 `add_stops` 裡：

```python
    try:
        itinerary, added, skipped = service.add_stops(session, _rep_id(user), body.customer_ids)
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
```

換成

```python
    try:
        itinerary, added, skipped = service.add_stops(session, _rep_id(user), body.customer_ids)
    except service.VersionConflict:
        raise HTTPException(409, STALE) from None
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
```

並在 `NO_ROUTE = ...` 下面加 `STALE = "行程剛被改過，已幫你重新整理"`，`send_feedback` 裡的 409 也改用 `STALE`。

- [ ] **Step 6: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests/test_itinerary.py backend/tests/test_itinerary_api.py backend/tests/test_today_route.py backend/tests/test_route_planner.py backend/tests/test_route_habits.py backend/tests/test_oauth.py backend/tests/test_admin.py -q`
Expected: 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/itinerary.py backend/app/services/today_route.py backend/app/api/itinerary.py backend/tests/test_itinerary.py backend/tests/test_today_route.py
git commit -m "$(cat <<'EOF'
Apply route habits when building, reading and adding to the itinerary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 4: 調整清單的後端：preview、save、加一站的候選

**Files:**
- Modify: `backend/app/services/itinerary.py`（常數區、資料類別區、`reset_today` 之前加公開函式、私有函式區加 `_resolve`、`_inserted`、`_estimated`）
- Test: `backend/tests/test_itinerary.py`

**Interfaces:**
- Consumes: Task 3 的 `_Day`、`_Open`、`_compose`、`_points`、`_rules`、`_locks`、`_new_open`、`_cheapest_index`、`_write`、`_reasons`、`_lock`、`PendingHabit`、`SKIP_BY_REP`、`SKIP_BY_ORDER`；Task 2 的 `route_habits.validate`、`targets`、`create`、`applies_on`、`mine`。
- Produces（Task 5 用）：
  - `class InvalidDraft(ValueError)`（訊息寫給業務看）、`TOO_MANY = "今天已經排了 8 站，要先刪掉一站"`、`NEARBY = 5`
  - `DraftStop(customer_id, duration_minutes=40, window_kind=None, window_time: dt.time | None = None, note=None, locked=False)`
  - `Draft(stops: list[DraftStop], precedences: list[tuple[str, str]] = [], skipped_habit_ids: list[int] = [], habits: list[PendingHabit] = [])`
  - `preview(session, user_id, draft, insert: str | None = None) -> ItineraryView`（車程一律直線估算，`estimated` 是 True）
  - `_estimated(points) -> travel.Matrix`（直線估算的整張矩陣）；`_timed(points, estimate=False)`、`_compose(..., pending, estimate=False)`
  - `save(session, user_id, version, draft) -> Itinerary`（409 用 `VersionConflict`，內容不合用 `InvalidDraft`）
  - `Candidate(customer_id, customer_name, type, area, signal=None, after_stop=None, extra_minutes=None)`、`Candidates(nearby, others, full)`
  - `candidates(session, user_id, order: list[str] | None = None, locked: Sequence[str] = ()) -> Candidates`
  - `today_skips(session, user_id) -> dict[int, str]`（今天不套用的習慣與原因；今天還沒建行程就是空的）

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_itinerary.py` 最後加：

```python
def draft_of(view):
    """讀到的行程原封不動地換成草稿（跟前端 lib/itinerary.ts 的 draftFrom 一樣）。"""
    return service.Draft(
        stops=[
            service.DraftStop(
                s.customer_id, s.duration_minutes, s.window_kind,
                dt.time.fromisoformat(s.window_time) if s.window_time else None, s.note, s.locked,
            )
            for s in view.stops if s.status != "done"
        ],
        precedences=[(p.before, p.after) for p in view.precedences],
        skipped_habit_ids=[h.id for h in view.skipped_habits],
    )


def not_on_route(tx, on_route, owner="U01", limit=1):
    return tx.scalars(
        select(Customer.id).where(Customer.owner_user_id == owner, Customer.id.not_in(on_route))
        .order_by(Customer.id).limit(limit)
    ).all()


def test_preview_recomputes_times_without_saving(tx):
    itinerary = service.get_or_create(tx, "U01")
    before = service.view(tx, itinerary)
    draft = draft_of(before)
    draft.stops.reverse()
    draft.stops[0].duration_minutes = 90
    draft.stops[1].window_kind, draft.stops[1].window_time = "before", dt.time(9, 40)
    shown = service.preview(tx, "U01", draft)
    assert [s.customer_id for s in shown.stops] == [s.customer_id for s in draft.stops]
    assert shown.stops[0].duration_minutes == 90
    # 第一站停 90 分鐘，第二站 09:40 以前一定到不了
    assert shown.stops[1].late_minutes > 0 and shown.stops[1].window_time == "09:40"
    assert shown.estimated is True
    assert service.view(tx, itinerary) == before


def test_preview_inserts_a_new_stop_with_the_habit_defaults(tx):
    itinerary = service.get_or_create(tx, "U01")
    before = service.view(tx, itinerary)
    on_route = [s.customer_id for s in before.stops]
    [mine] = not_on_route(tx, on_route)
    route_habits.create(tx, "U01", route_habits.HabitSpec("duration", by_customer(mine), duration_minutes=20), "manual")
    shown = service.preview(tx, "U01", draft_of(before), insert=mine)
    added = next(s for s in shown.stops if s.customer_id == mine)
    assert added.source == "rep" and added.duration_minutes == 20 and added.reason
    assert len(shown.stops) == 6 and shown.stops[0].customer_id == on_route[0]
    assert shown.version == before.version


def test_the_draft_is_checked(tx):
    before = service.view(tx, service.get_or_create(tx, "U01"))
    on_route = [s.customer_id for s in before.stops]
    [theirs] = not_on_route(tx, on_route, owner="U02")
    with pytest.raises(service.InvalidDraft, match="只能排自己的客戶"):
        service.preview(tx, "U01", draft_of(before), insert=theirs)
    with pytest.raises(service.InvalidDraft, match="已經在今天的行程裡"):
        service.preview(tx, "U01", draft_of(before), insert=on_route[1])
    extra = not_on_route(tx, on_route, limit=4)
    draft = draft_of(before)
    draft.stops += [service.DraftStop(cid) for cid in extra]
    with pytest.raises(service.InvalidDraft, match="今天已經排了 8 站，要先刪掉一站"):
        service.preview(tx, "U01", draft)
    draft.stops = draft.stops[:8]
    with pytest.raises(service.InvalidDraft, match="今天已經排了 8 站"):
        service.preview(tx, "U01", draft, insert=extra[-1])
    twice = draft_of(before)
    twice.stops.append(twice.stops[0])
    with pytest.raises(service.InvalidDraft, match="同一家不能排兩次"):
        service.preview(tx, "U01", twice)


def test_saving_the_list_writes_order_fields_and_precedences(tx):
    itinerary = service.get_or_create(tx, "U01")
    before = service.view(tx, itinerary)
    draft = draft_of(before)
    first, *rest = draft.stops
    rest.reverse()
    rest[0].note, rest[0].locked = "找王藥師", True
    draft.stops = [first, *rest]
    removed = draft.stops.pop()
    draft.precedences = [(draft.stops[1].customer_id, draft.stops[2].customer_id)]
    service.save(tx, "U01", before.version, draft)
    after = service.view(tx, itinerary)
    assert after.version == before.version + 1
    assert [s.customer_id for s in after.stops] == [s.customer_id for s in draft.stops]
    assert after.stops[1].note == "找王藥師" and after.stops[1].locked
    assert removed.customer_id not in {s.customer_id for s in after.stops}
    assert [(p.before, p.after) for p in after.precedences] == draft.precedences
    assert after.violations == []


def test_saving_with_a_stale_version_is_refused(tx):
    before = service.view(tx, service.get_or_create(tx, "U01"))
    with pytest.raises(service.VersionConflict):
        service.save(tx, "U01", before.version + 1, draft_of(before))


def test_saving_does_not_trust_the_screen_about_finished_stops(tx):
    """確認拜訪不會改版本：讀到之後才跑完的那一站，畫面上不管是拿掉了還是當成還沒跑，都以伺服器為準。"""
    itinerary = service.get_or_create(tx, "U01")
    before = service.view(tx, itinerary)
    target = before.stops[1]
    at = dt.datetime(2026, 10, 28, 9, 40, tzinfo=TAIPEI)
    tx.add(Visit(id="VTEST2", customer_id=target.customer_id, user_id="U01", visited_at=at,
                 transcript="測試", status="synced", confirmed_at=at))
    tx.flush()
    removed = draft_of(before)
    removed.stops = [s for s in removed.stops if s.customer_id != target.customer_id]
    service.save(tx, "U01", before.version, removed)
    after = service.view(tx, itinerary)
    assert (after.stops[0].customer_id, after.stops[0].status, after.total) == (target.customer_id, "done", 5)
    service.save(tx, "U01", after.version, draft_of(before))
    again = service.view(tx, itinerary)
    assert (again.done, again.total) == (1, 5) and again.stops[0].customer_id == target.customer_id


def test_what_the_saved_order_still_breaks_gives_way_to_the_order(tx):
    tx.execute(delete(RouteHabit).where(RouteHabit.user_id == "U01"))
    itinerary = service.get_or_create(tx, "U01")
    ids = [s.customer_id for s in service.view(tx, itinerary).stops]
    habit = route_habits.create(
        tx, "U01", route_habits.HabitSpec("precedence", by_customer(ids[1]), by_customer(ids[2])), "manual",
    )
    before = service.view(tx, itinerary)
    draft = draft_of(before)
    # 拖成違反習慣的順序，今天的先後也設成跟順序相反，紅框都沒處理就按「完成」
    draft.stops[1], draft.stops[2] = draft.stops[2], draft.stops[1]
    draft.precedences = [(ids[4], ids[3])]
    service.save(tx, "U01", before.version, draft)
    after = service.view(tx, itinerary)
    assert [(h.id, h.reason, h.conflict) for h in after.skipped_habits] == [(habit.id, service.SKIP_BY_ORDER, False)]
    assert after.precedences == [] and after.violations == []


def test_skipping_a_habit_and_keeping_new_ones_when_saving(tx):
    tx.execute(delete(RouteHabit).where(RouteHabit.user_id == "U01"))
    itinerary = service.get_or_create(tx, "U01")
    ids = [s.customer_id for s in service.view(tx, itinerary).stops]
    spec = route_habits.HabitSpec
    old = route_habits.create(tx, "U01", spec("precedence", by_customer(ids[3]), by_customer(ids[1])), "manual")
    before = service.view(tx, itinerary)
    assert f"habit:{old.id}" in before.violations
    draft = draft_of(before)
    # 紅框上按了「今天不套用這條」；拖完答應「每個星期三都這樣」；另一條答應了、但今天不套用
    draft.skipped_habit_ids = [old.id]
    draft.habits = [
        service.PendingHabit(spec("precedence", by_customer(ids[2]), by_customer(ids[4]), weekday=2)),
        service.PendingHabit(spec("last", by_customer(ids[1])), skip_today=True),
    ]
    shown = service.preview(tx, "U01", draft)
    assert "new:0" in {r.id for r in shown.rules} and "new:1" not in {r.id for r in shown.rules}
    service.save(tx, "U01", before.version, draft)
    after = service.view(tx, itinerary)
    weekly, skipped_new = route_habits.mine(tx, "U01")[-2:]
    assert weekly.source == "prompt" and weekly.weekday == 2 and f"habit:{weekly.id}" in {r.id for r in after.rules}
    assert {(h.id, h.reason) for h in after.skipped_habits} == {(old.id, service.SKIP_BY_REP), (skipped_new.id, service.SKIP_BY_REP)}
    assert after.violations == []


def test_candidates_put_the_nearest_first(tx):
    itinerary = service.get_or_create(tx, "U01")
    before = service.view(tx, itinerary)
    on_route = [s.customer_id for s in before.stops]
    found = service.candidates(tx, "U01")
    listed = [c.customer_id for c in found.nearby + found.others]
    assert len(listed) == len(set(listed)) == 45 and not set(listed) & set(on_route)
    assert len(found.nearby) == service.NEARBY and not found.full
    assert [c.extra_minutes for c in found.nearby] == sorted(c.extra_minutes for c in found.nearby)
    assert all(c.signal and c.after_stop is not None for c in found.nearby)
    assert [c.customer_name for c in found.others] == sorted(c.customer_name for c in found.others)
    # 寫的「插在第 N 站後」跟真的加的時候一樣（測試環境的車程一律是直線估算）
    best = found.nearby[0]
    shown = service.preview(tx, "U01", draft_of(before), insert=best.customer_id)
    assert [s.customer_id for s in shown.stops].index(best.customer_id) == best.after_stop
    # 草稿上拿掉的那一站又能加回來；草稿已經 8 站就加不進去
    fewer = service.candidates(tx, "U01", order=on_route[:4], locked=[on_route[0]])
    assert on_route[4] in {c.customer_id for c in fewer.nearby + fewer.others}
    full = service.candidates(tx, "U01", order=on_route + not_on_route(tx, on_route, limit=3))
    assert full.full and full.nearby == []
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests/test_itinerary.py -q`
Expected: 新的九個測試 FAIL（`service.Draft` 不存在）。

- [ ] **Step 3: 常數與資料類別**

`backend/app/services/itinerary.py`：

在 `SKIP_BY_ORDER = ...` 下面加：

```python
TOO_MANY = f"今天已經排了 {route_planner.MAX_OPEN_STOPS} 站，要先刪掉一站"
# 加一站的候選裡「順路的」列幾家
NEARBY = 5
```

在 `class NotOnItinerary` 後面加：

```python
class InvalidDraft(ValueError):
    """調整清單送來的內容不合：不是自己的客戶、同一家排兩次、超過 8 站、習慣的欄位不對。訊息寫給業務看。"""
```

在 `class PendingHabit` 後面加：

```python
@dataclass
class DraftStop:
    """調整清單上的一站（還沒跑的）。"""

    customer_id: str
    duration_minutes: int = DEFAULT_DURATION
    window_kind: str | None = None
    window_time: dt.time | None = None
    note: str | None = None
    locked: bool = False


@dataclass
class Draft:
    """調整清單上改到一半的行程：還沒跑的站照畫面上的順序、今天的先後、今天不套用的習慣、這次答應要記的習慣。"""

    stops: list[DraftStop]
    precedences: list[tuple[str, str]] = field(default_factory=list)  # (前, 後)
    skipped_habit_ids: list[int] = field(default_factory=list)
    habits: list[PendingHabit] = field(default_factory=list)


@dataclass
class Candidate:
    customer_id: str
    customer_name: str
    type: str
    area: str
    signal: str | None = None  # 順路的才有：目前的理由類別
    after_stop: int | None = None  # 插在第幾站後（含跑完的站；0 是排第一站）
    extra_minutes: int | None = None  # 估算多繞幾分鐘


@dataclass
class Candidates:
    nearby: list[Candidate]  # 順路的前幾家，多繞最少的在前
    others: list[Candidate]  # 其他客戶，照名稱
    full: bool  # 還沒跑的站已經 8 站，加不進去
```

- [ ] **Step 4: 公開函式**

加在 `reset_today` 前面：

```python
def preview(session: Session, user_id: str, draft: Draft, insert: str | None = None) -> ItineraryView:
    """調整清單上的改動算時間、車程與違反的規則，不存。insert 是「加一站」點的那一家：
    插在多繞最少、又不新增違反的位置，約的時間與停留照習慣給的預設值。
    車程一律用直線估算（畫面寫「估計」）：拖一下就算一次，每次都打 Google 太貴；按「完成」存好之後讀到的才是正式的車程。"""
    itinerary = get_or_create(session, user_id)
    day = _day(session, itinerary)
    open_, precedences, skipped, pending = _resolve(session, day, draft)
    if insert is not None:
        open_ = _inserted(session, day, open_, insert, precedences, skipped, pending)
    return _compose(session, day, open_, precedences, skipped, _reasons(itinerary, skipped), pending, estimate=True)


def save(session: Session, user_id: str, version: int, draft: Draft) -> Itinerary:
    """調整清單按「完成」：整份還沒跑的站、今天的先後、今天不套用的習慣、這次答應要記的習慣一次存進去。
    存的時候順序還違反的規則以今天排的為準（設計〈已定案的決定〉第 8 點）：習慣記成今天不套用，今天的先後拿掉。"""
    itinerary = get_or_create(session, user_id)
    _lock(session, itinerary)
    if itinerary.version != version:
        raise VersionConflict
    day = _day(session, itinerary)
    open_, precedences, skipped, pending = _resolve(session, day, draft)
    reasons = _reasons(itinerary, skipped)
    for item in pending:
        habit = route_habits.create(session, day.rep.id, item.spec, "prompt")
        if route_habits.applies_on(habit, itinerary.date):
            day.habits.append(habit)
            if item.skip_today:
                skipped.add(habit.id)
                reasons[str(habit.id)] = SKIP_BY_REP
    order = [o.customer.id for o in open_]
    for rule in route_planner.violations(order, _rules(open_, precedences, day.habits, skipped)):
        kind, _, key = rule.id.partition(":")
        if kind == "habit":
            skipped.add(int(key))
            reasons[key] = SKIP_BY_ORDER
        elif kind == "today":
            precedences.remove(rule.customer_ids)
    _write(session, day, open_)
    session.execute(delete(ItineraryPrecedence).where(ItineraryPrecedence.itinerary_id == itinerary.id))
    if precedences:
        # 用 Core 寫：同一個 session 裡可能已經載入過舊的那幾列，ORM 物件會撞到 identity map
        session.execute(insert(ItineraryPrecedence).values([
            {"itinerary_id": itinerary.id, "before_customer_id": a, "after_customer_id": b} for a, b in precedences
        ]))
    itinerary.skipped_habit_ids = sorted(skipped)
    itinerary.skip_reasons = {str(i): reasons[str(i)] for i in sorted(skipped)}
    _touch(itinerary)
    session.flush()
    return itinerary


def candidates(
    session: Session, user_id: str, order: list[str] | None = None, locked: Sequence[str] = ()
) -> Candidates:
    """加一站的候選：自己的客戶，草稿上已經有的、今天跑過的不列。順路的前幾家照估算的多繞分鐘數排
    （插的位置跟真的加的時候一樣，用 cheapest_insert），其他照名稱排。order、locked 是調整清單上目前
    還沒跑的站與鎖住的站，沒給 order 就用存著的。車程一律用直線估算：一次要算約 50 家，加進去之後才用正式的車程重算。"""
    itinerary = get_or_create(session, user_id)
    day = _day(session, itinerary)
    saved = {o.customer.id: o for o in _saved_open(session, day)}
    mine = list(session.scalars(select(Customer).where(Customer.owner_user_id == day.rep.id).order_by(Customer.name)))
    own = {c.id: c for c in mine}
    ids = [
        cid for cid in dict.fromkeys(order if order is not None else list(saved))
        if cid not in day.done_ids and (cid in saved or cid in own)
    ]
    held = set(locked)
    open_ = [
        dataclasses.replace(saved[cid], locked=cid in held) if cid in saved
        else _new_open(own[cid], "rep", ("routine", ""), day.habits, locked=cid in held)
        for cid in ids
    ]
    pool = [c for c in mine if c.id not in ids and c.id not in day.done_ids]
    full = len(open_) >= route_planner.MAX_OPEN_STOPS
    nearby: list[Candidate] = []
    if pool and not full:
        start, points = _points(
            session, day.rep, itinerary.date, day.done, day.durations(), [*(o.customer for o in open_), *pool]
        )
        minutes = _estimated(points).minutes
        ordered = [o.plan_stop(n + 1) for n, o in enumerate(open_)]
        base = route_planner.schedule(start, 0, ordered, minutes).travel_minutes
        precedences = [(a, b) for a, b in _precedences(session, itinerary) if a in ids and b in ids]
        skipped = set(itinerary.skipped_habit_ids)
        locks = _locks(open_, len(day.done))
        scored = []
        for k, customer in enumerate(pool):
            new = _new_open(customer, "rep", ("routine", ""), day.habits)
            stop = new.plan_stop(len(open_) + 1 + k)
            rules = _rules([*open_, new], precedences, day.habits, skipped) + locks
            index = route_planner.cheapest_insert(start, 0, ordered, stop, rules, minutes)
            trial = [*ordered[:index], stop, *ordered[index:]]
            extra = route_planner.schedule(start, 0, trial, minutes).travel_minutes - base
            scored.append((extra, customer.name, customer, len(day.done) + index))
        scored.sort(key=lambda item: (item[0], item[1]))
        best = scored[:NEARBY]
        labels = today_route.labels(session, day.rep.id, [c.id for _, _, c, _ in best])
        nearby = [
            Candidate(c.id, c.name, c.type, c.area, labels.get(c.id, ("routine", ""))[0], after, extra)
            for extra, _, c, after in best
        ]
    near = {c.customer_id for c in nearby}
    others = [Candidate(c.id, c.name, c.type, c.area) for c in pool if c.id not in near]
    return Candidates(nearby, others, full)


def today_skips(session: Session, user_id: str) -> dict[int, str]:
    """今天的行程裡今天不套用的習慣與原因（習慣頁用）。今天還沒建行程就是沒有，也不為了這個去建。"""
    found = _find(session, user_id, customer_profile.app_today(session))
    if found is None:
        return {}
    return {int(key): reason for key, reason in _reasons(found, set(found.skipped_habit_ids)).items()}
```

- [ ] **Step 5: 私有函式**

加在 `_day` 前面：

```python
def _resolve(
    session: Session, day: _Day, draft: Draft
) -> tuple[list[_Open], list[tuple[str, str]], set[int], list[PendingHabit]]:
    """草稿換成 _Open 並檢查。剛跑完的站以伺服器為準：確認拜訪不會改版本，畫面上可能還把它當成還沒跑的站，
    送來的就略過；畫面上拿掉了也不刪（見 _write）。新加的站要是自己的客戶；先後只留兩家都在的；
    今天不套用的只留這位業務自己的習慣。"""
    by_row = {r.customer_id: r for r in day.rows}
    stops = [s for s in draft.stops if s.customer_id not in day.done_ids]
    ids = [s.customer_id for s in stops]
    if len(set(ids)) != len(ids):
        raise InvalidDraft("同一家不能排兩次")
    if len(ids) > route_planner.MAX_OPEN_STOPS:
        raise InvalidDraft(TOO_MANY)
    if any((s.window_kind is None) != (s.window_time is None) for s in stops):
        raise InvalidDraft("約的時間要選幾點到、以前或以後，再填時間")
    customers = _customers(session, ids)
    new_ids = [cid for cid in ids if cid not in by_row]
    if any(cid not in customers or customers[cid].owner_user_id != day.rep.id for cid in new_ids):
        raise InvalidDraft("只能排自己的客戶")
    labels = today_route.labels(session, day.rep.id, new_ids) if new_ids else {}
    open_ = []
    for stop in stops:
        row = by_row.get(stop.customer_id)
        source, signal, reason = (row.source, row.signal, row.reason) if row else ("rep", *labels[stop.customer_id])
        open_.append(_Open(
            customers[stop.customer_id], source, signal, reason, stop.duration_minutes, stop.window_kind,
            stop.window_time, (stop.note or "").strip() or None, stop.locked,
        ))
    present = set(ids)
    precedences = list(dict.fromkeys(
        (a, b) for a, b in draft.precedences if a != b and a in present and b in present
    ))
    mine = {habit.id for habit in route_habits.mine(session, day.rep.id)}
    skipped = {i for i in draft.skipped_habit_ids if i in mine}
    if draft.habits:
        options = route_habits.targets(session, day.rep.id)
        for item in draft.habits:
            try:
                route_habits.validate(item.spec, options)
            except route_habits.InvalidHabit as exc:
                raise InvalidDraft(str(exc)) from None
    return open_, precedences, skipped, list(draft.habits)


def _inserted(
    session: Session, day: _Day, open_: list[_Open], customer_id: str, precedences: list[tuple[str, str]],
    skipped: set[int], pending: Sequence[PendingHabit],
) -> list[_Open]:
    """「加一站」點的那一家插進草稿：多繞最少、又不新增違反的位置。"""
    if any(o.customer.id == customer_id for o in open_):
        raise InvalidDraft("已經在今天的行程裡")
    if customer_id in day.done_ids:
        raise InvalidDraft("今天已經去過了")
    if len(open_) >= route_planner.MAX_OPEN_STOPS:
        raise InvalidDraft(TOO_MANY)
    customer = session.get(Customer, customer_id)
    if customer is None or customer.owner_user_id != day.rep.id:
        raise InvalidDraft("只能排自己的客戶")
    # 草稿上拿掉、又加回來的那一家：來源與理由照存著的
    row = next((r for r in day.rows if r.customer_id == customer_id), None)
    label = (row.signal, row.reason) if row else today_route.labels(session, day.rep.id, [customer_id])[customer_id]
    new = _new_open(customer, row.source if row else "rep", label, day.habits)
    index = _cheapest_index(session, day, open_, new, precedences, skipped, pending)
    return [*open_[:index], new, *open_[index:]]


def _estimated(points: list[travel.Point]) -> travel.Matrix:
    """直線估算的車程矩陣。調整清單的 preview（拖一下就算一次）與加一站的候選（一次約 50 家）只用估算，不打 Google。"""
    pairs = [[travel.estimate(a, b) for b in points] for a in points]
    return travel.Matrix(
        minutes=[[m for m, _ in row] for row in pairs], km=[[k for _, k in row] for row in pairs], estimated=True,
    )
```

`_timed` 多一個參數，`_compose` 跟著多一個參數傳下去（其他呼叫端不用改）：

```python
def _timed(points: list[travel.Point], estimate: bool = False) -> travel.Matrix:
    """照這個順序跑的車程（順序已經定了：讀取、調整清單的 preview 與存檔）。只會用到相鄰兩點
    （第 n 點到第 n + 1 點）那幾格。順序還要由程式挑的地方（每天的建議、插入新的一站、排順路）直接用 travel.matrix。
    estimate：只要直線估算（調整清單的 preview）。"""
    return _estimated(points) if estimate else travel.matrix(points)
```

`_compose` 的參數最後加 `estimate: bool = False`，裡面的 `matrix = _timed(points)` 改成 `matrix = _timed(points, estimate)`。

- [ ] **Step 6: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests/test_itinerary.py -q`
Expected: 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/itinerary.py backend/tests/test_itinerary.py
git commit -m "$(cat <<'EOF'
Preview and save the edited itinerary, and list stops to add by detour

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 行程與習慣的 API

**Files:**
- Create: `backend/app/api/route_habits.py`
- Modify: `backend/app/api/itinerary.py`
- Modify: `backend/app/main.py`（只加兩行：import 與 `include_router`，放在 itinerary 那一行旁邊）
- Test: `backend/tests/test_itinerary_api.py`、`backend/tests/test_route_habits_api.py`（新）

**Interfaces:**
- Consumes: Task 4 的 `service.preview`、`save`、`candidates`、`today_skips`、`Draft`、`DraftStop`、`PendingHabit`、`InvalidDraft`；Task 2 的 `route_habits`。
- Produces（前端用）：
  - `GET /api/itinerary/today`（以及 feedback、stops、preview、PUT 的回應）多：每站 `window_kind`、`window_time`（"HH:MM"）、`note`、`locked`、`habit_ids`；整份 `rules: [{id, text, kind, source, customer_ids}]`、`violations: [rule id]`、`precedences: [{before, after}]`、`skipped_habits: [{id, text, reason, conflict}]`。
  - `POST /api/itinerary/today/preview`：body `{stops: [{customer_id, duration_minutes, window_kind, window_time, note, locked}], precedences: [{before, after}], skipped_habit_ids: [int], habits: [habit + skip_today], insert: str | null}` → 行程；422 `{"detail": "..."}`。
  - `PUT /api/itinerary/today`：同上（沒有 `insert`）加 `version` → 行程；409、422。
  - `GET /api/itinerary/today/candidates?order=C1,C2&locked=C1` → `{nearby: [{customer_id, customer_name, type, area, signal, after_stop, extra_minutes}], others: [...], full: bool}`。
  - 習慣的欄位（新增與 PUT 的 `habits` 共用）：`{kind, subject: {by, value}, object: {by, value} | null, window_kind, window_time: "HH:MM" | null, duration_minutes, weekday: 0-6 | null}`。
  - `GET /api/route-habits` → `{weekday, habits: [habit + id, text, source, active, created_at, today: applied|skipped|off|other_day, skip_reason], targets: {customer|chain|type|area: [{value, label}]}}`；`POST /api/route-habits`（201）、`PATCH /api/route-habits/{id}` `{active}`、`DELETE /api/route-habits/{id}`（204）；主管 403、別人的 404、欄位不合 422。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_itinerary_api.py`：import 改成

```python
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.main import app
from app.models import Customer, Itinerary, RouteSignalWeight, RouteSnooze
from app.services import itinerary as service
```

`test_today_has_the_fields_the_home_page_needs` 裡的欄位集合換成：

```python
    assert set(first) == {
        "customer_id", "customer_name", "type", "grade", "planned_time", "status", "signal", "reason", "visit_id",
        "source", "duration_minutes", "late_minutes", "travel_minutes", "travel_km",
        "window_kind", "window_time", "note", "locked", "habit_ids",
    }
    assert {"rules", "violations", "precedences", "skipped_habits"} <= set(data)
```

檔案最後加：

```python
def draft_body(data):
    """讀到的行程原封不動地換成草稿（跟前端 lib/itinerary.ts 的 draftFrom 一樣）。"""
    fields = ("customer_id", "duration_minutes", "window_kind", "window_time", "note", "locked")
    return {
        "stops": [{key: s[key] for key in fields} for s in data["stops"] if s["status"] != "done"],
        "precedences": data["precedences"],
        "skipped_habit_ids": [h["id"] for h in data["skipped_habits"]],
        "habits": [],
    }


def test_preview_and_save_the_list(client, auth):
    data = today(client, auth)
    body = draft_body(data)
    body["stops"][1].update(window_kind="before", window_time="09:40")
    body["stops"][2]["duration_minutes"] = 90
    later, earlier = body["stops"][4]["customer_id"], body["stops"][3]["customer_id"]
    body["precedences"] = [{"before": later, "after": earlier}]
    preview = client.post("/api/itinerary/today/preview", json=body, headers=auth())
    assert preview.status_code == 200, preview.text
    shown = preview.json()
    assert shown["stops"][1]["late_minutes"] > 0 and shown["stops"][1]["window_time"] == "09:40"
    assert shown["violations"] == [f"today:{later}>{earlier}"]
    assert today(client, auth)["version"] == data["version"]
    # 照先後換過來再存
    body["stops"][3], body["stops"][4] = body["stops"][4], body["stops"][3]
    saved = client.put("/api/itinerary/today", json={**body, "version": data["version"]}, headers=auth())
    assert saved.status_code == 200, saved.text
    after = saved.json()
    assert after["version"] == data["version"] + 1 and after["violations"] == []
    assert [s["customer_id"] for s in after["stops"]] == [s["customer_id"] for s in body["stops"]]
    assert after["precedences"] == body["precedences"]
    stale = client.put("/api/itinerary/today", json={**body, "version": data["version"]}, headers=auth())
    assert stale.status_code == 409 and stale.json()["detail"] == "行程剛被改過，已幫你重新整理"


def test_a_bad_draft_is_refused(client, auth, tx):
    body = draft_body(today(client, auth))
    theirs = tx.scalars(select(Customer.id).where(Customer.owner_user_id == "U02")).first()
    bad = client.post("/api/itinerary/today/preview", json={**body, "insert": theirs}, headers=auth())
    assert bad.status_code == 422 and bad.json()["detail"] == "只能排自己的客戶"
    half = {**body, "stops": [{**body["stops"][0], "window_kind": "at"}]}
    assert client.post("/api/itinerary/today/preview", json=half, headers=auth()).status_code == 422
    assert client.post("/api/itinerary/today/preview", json=body, headers=auth("M01")).status_code == 403
    assert client.put("/api/itinerary/today", json={**body, "version": 1}, headers=auth("M01")).status_code == 403


def test_candidates_through_the_api(client, auth):
    ids = [s["customer_id"] for s in today(client, auth)["stops"]]
    response = client.get(
        "/api/itinerary/today/candidates", params={"order": ",".join(ids[:4]), "locked": ids[0]}, headers=auth(),
    )
    assert response.status_code == 200, response.text
    found = response.json()
    assert len(found["nearby"]) == 5 and found["full"] is False
    assert set(found["nearby"][0]) == {
        "customer_id", "customer_name", "type", "area", "signal", "after_stop", "extra_minutes",
    }
    assert ids[4] in {c["customer_id"] for c in found["nearby"] + found["others"]}
    assert client.get("/api/itinerary/today/candidates", headers=auth("M01")).status_code == 403


def test_an_it_reset_between_reading_and_saving_is_a_409(client, auth, monkeypatch):
    first = today(client, auth)["stops"][0]["customer_id"]
    real = service.get_or_create

    def reset_meanwhile(session, user_id):
        itinerary = real(session, user_id)
        session.execute(text("DELETE FROM itinerary WHERE id = :id"), {"id": itinerary.id})
        return itinerary

    monkeypatch.setattr(service, "get_or_create", reset_meanwhile)
    response = client.post(
        "/api/itinerary/today/feedback", json={"customer_id": first, "action": "pin", "version": 1}, headers=auth(),
    )
    assert response.status_code == 409 and response.json()["detail"] == "行程剛被改過，已幫你重新整理"
```

新檔 `backend/tests/test_route_habits_api.py`：

```python
"""我的排序習慣 API：列表、新增、停用、刪除；別人的動不了，主管沒有。"""

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client(tx):
    return TestClient(app)


def habits(client, auth, user_id="U01"):
    response = client.get("/api/route-habits", headers=auth(user_id))
    assert response.status_code == 200, response.text
    return response.json()


def test_the_list_has_today_state_and_the_form_options(client, auth):
    data = habits(client, auth)
    assert data["weekday"] == 2  # 10/28 是星期三
    assert [(h["text"], h["today"]) for h in data["habits"]] == [
        ("康泰連鎖藥局的店排在診所前面", "applied"),
        ("星期三 敦南內科診所 · 大安 排最後", "applied"),
        ("杏林診所 · 大安 都 11:00 以前到", "applied"),
    ]
    first = data["habits"][0]
    assert first["subject"] == {"by": "chain", "value": "康泰連鎖藥局"}
    assert first["object"] == {"by": "type", "value": "clinic"} and first["source"] == "ai"
    assert data["habits"][2]["window_time"] == "11:00"
    assert [o["label"] for o in data["targets"]["type"]] == ["連鎖藥局", "獨立藥局", "診所"]
    assert len(data["targets"]["customer"]) == 50


def test_add_switch_off_and_delete(client, auth):
    made = client.post(
        "/api/route-habits", json={"kind": "first", "subject": {"by": "area", "value": "板橋"}, "weekday": 0},
        headers=auth(),
    )
    assert made.status_code == 201, made.text
    habit = made.json()
    assert (habit["text"], habit["source"], habit["today"]) == ("星期一先跑板橋", "manual", "other_day")
    off = client.patch(f"/api/route-habits/{habit['id']}", json={"active": False}, headers=auth())
    assert off.status_code == 200 and off.json()["today"] == "off"
    assert client.delete(f"/api/route-habits/{habit['id']}", headers=auth()).status_code == 204
    assert habit["id"] not in {h["id"] for h in habits(client, auth)["habits"]}


def test_bad_habits_and_other_peoples_habits(client, auth):
    bad = client.post(
        "/api/route-habits", json={"kind": "precedence", "subject": {"by": "type", "value": "clinic"}}, headers=auth(),
    )
    assert bad.status_code == 422 and bad.json()["detail"] == "先後要選前後兩個對象"
    mine = habits(client, auth)["habits"][0]["id"]
    assert client.patch(f"/api/route-habits/{mine}", json={"active": False}, headers=auth("U02")).status_code == 404
    assert client.delete(f"/api/route-habits/{mine}", headers=auth("U02")).status_code == 404
    assert client.get("/api/route-habits", headers=auth("M01")).status_code == 403
    assert client.get("/api/route-habits").status_code == 401


def test_a_habit_skipped_today_says_why(client, auth):
    data = client.get("/api/itinerary/today", headers=auth()).json()
    first = habits(client, auth)["habits"][0]["id"]
    body = {
        "stops": [
            {k: s[k] for k in ("customer_id", "duration_minutes", "window_kind", "window_time", "note", "locked")}
            for s in data["stops"] if s["status"] != "done"
        ],
        "precedences": data["precedences"], "skipped_habit_ids": [first], "habits": [], "version": data["version"],
    }
    assert client.put("/api/itinerary/today", json=body, headers=auth()).status_code == 200
    listed = habits(client, auth)["habits"][0]
    assert (listed["today"], listed["skip_reason"]) == ("skipped", "你選了今天不套用")
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests/test_itinerary_api.py backend/tests/test_route_habits_api.py -q`
Expected: 新測試 FAIL（404 Not Found、欄位不齊）。

- [ ] **Step 3: 習慣的 API**

新檔 `backend/app/api/route_habits.py`：

```python
"""我的排序習慣（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈我的排序習慣〉）。

只有業務自己看得到、改得了，習慣是誰的跟行程一樣由 token 決定（第三方登入代理示範業務時是示範業務的）。
主管看不到業務的習慣，自己也沒有。新增或改了習慣不回頭改今天已存的行程。
"""

import datetime as dt
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.db import get_session
from app.models import AppUser, RouteHabit
from app.services import customer_profile, itinerary, route_habits

router = APIRouter(prefix="/api/route-habits", tags=["route-habits"])
SessionDep = Annotated[Session, Depends(get_session)]
NO_ROUTE = "主管沒有自己的拜訪路線"
WindowKind = Literal["at", "before", "after"]


class Target(BaseModel):
    by: Literal["customer", "chain", "type", "area"]
    value: str = Field(min_length=1, max_length=50)


class HabitInput(BaseModel):
    """一條習慣。object 只有先後用（subject 那幾家排在 object 那幾家前面）；window_* 只有約的時段用；
    duration_minutes 只有停留用。種類缺欄位、對象不是自己的由服務層檢查，錯誤訊息才講得出是哪裡不對。"""

    model_config = ConfigDict(populate_by_name=True)

    kind: Literal["precedence", "first", "last", "window", "duration"]
    subject: Target
    then: Target | None = Field(default=None, alias="object")
    window_kind: WindowKind | None = None
    window_time: dt.time | None = None
    duration_minutes: int | None = Field(default=None, ge=5, le=480)
    weekday: int | None = Field(default=None, ge=0, le=6)

    def spec(self) -> route_habits.HabitSpec:
        return route_habits.HabitSpec(
            kind=self.kind, subject=self.subject.model_dump(), object=self.then.model_dump() if self.then else None,
            window_kind=self.window_kind, window_time=self.window_time, duration_minutes=self.duration_minutes,
            weekday=self.weekday,
        )


class HabitOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: int
    kind: str
    subject: Target
    then: Target | None = Field(default=None, alias="object")
    window_kind: str | None
    window_time: str | None  # "HH:MM"
    duration_minutes: int | None
    weekday: int | None
    text: str
    source: str
    active: bool
    created_at: dt.datetime
    # 今天的狀態。applied：套用中；skipped：今天不套用（原因在 skip_reason）；off：停用；other_day：不是今天
    today: Literal["applied", "skipped", "off", "other_day"]
    skip_reason: str | None


class TargetOption(BaseModel):
    value: str
    label: str


class HabitList(BaseModel):
    weekday: int  # 今天星期幾（0 是星期一），「今天（星期三）套用中」那一組用
    habits: list[HabitOut]
    targets: dict[str, list[TargetOption]]  # 新增習慣能選的對象


class HabitChanges(BaseModel):
    active: bool


def _rep(session: Session, user: AppUser) -> str:
    rep_id = user.acts_as_user_id or user.id
    rep = session.get(AppUser, rep_id)
    if rep is None or rep.role != "sales":
        raise HTTPException(403, NO_ROUTE)
    return rep_id


def _find(session: Session, rep_id: str, habit_id: int) -> RouteHabit:
    try:
        return route_habits.find(session, rep_id, habit_id)
    except LookupError:
        raise HTTPException(404, "找不到這條習慣") from None


def _out(habit: RouteHabit, today: dt.date, skips: dict[int, str]) -> HabitOut:
    if not habit.active:
        state = "off"
    elif habit.weekday is not None and habit.weekday != today.weekday():
        state = "other_day"
    elif habit.id in skips:
        state = "skipped"
    else:
        state = "applied"
    return HabitOut(
        id=habit.id, kind=habit.kind, subject=Target(**habit.subject),
        then=Target(**habit.object) if habit.object else None, window_kind=habit.window_kind,
        window_time=habit.window_time.strftime("%H:%M") if habit.window_time else None,
        duration_minutes=habit.duration_minutes, weekday=habit.weekday, text=habit.text, source=habit.source,
        active=habit.active, created_at=habit.created_at, today=state,
        skip_reason=skips[habit.id] if state == "skipped" else None,
    )


@router.get("", response_model=HabitList)
def list_habits(session: SessionDep, user: CurrentUser):
    """我的排序習慣，舊的在前；含今天哪幾條沒套用、為什麼，以及新增表單能選的對象。"""
    rep_id = _rep(session, user)
    today = customer_profile.app_today(session)
    skips = itinerary.today_skips(session, rep_id)
    options = route_habits.targets(session, rep_id)
    return HabitList(
        weekday=today.weekday(),
        habits=[_out(habit, today, skips) for habit in route_habits.mine(session, rep_id)],
        targets={by: [TargetOption(value=v, label=label) for v, label in items] for by, items in options.items()},
    )


@router.post("", response_model=HabitOut, status_code=status.HTTP_201_CREATED)
def create_habit(session: SessionDep, body: HabitInput, user: CurrentUser):
    """在習慣頁自己新增一條。"""
    rep_id = _rep(session, user)
    try:
        habit = route_habits.create(session, rep_id, body.spec(), "manual")
    except route_habits.InvalidHabit as exc:
        raise HTTPException(422, str(exc)) from None
    result = _out(habit, customer_profile.app_today(session), {})
    session.commit()
    return result


@router.patch("/{habit_id}", response_model=HabitOut)
def change_habit(session: SessionDep, habit_id: int, body: HabitChanges, user: CurrentUser):
    """停用或重新啟用（停用不刪）。"""
    rep_id = _rep(session, user)
    habit = _find(session, rep_id, habit_id)
    habit.active = body.active
    session.flush()
    result = _out(habit, customer_profile.app_today(session), itinerary.today_skips(session, rep_id))
    session.commit()
    return result


@router.delete("/{habit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_habit(session: SessionDep, habit_id: int, user: CurrentUser):
    rep_id = _rep(session, user)
    session.delete(_find(session, rep_id, habit_id))
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 4: 行程 API**

`backend/app/api/itinerary.py`：

import 區改成：

```python
import dataclasses
from datetime import date, time
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.api.auth import CurrentUser
from app.api.route_habits import HabitInput
from app.db import get_session
from app.models import AppUser
from app.services import itinerary as service
```

`Stop` 的最後（`travel_km` 之後）加：

```python
    window_kind: str | None
    window_time: str | None
    note: str | None
    locked: bool
    habit_ids: list[int]
```

`Stop` 與 `TodayItinerary` 之間加：

```python
class Rule(BaseModel):
    id: str
    text: str
    kind: str
    source: str
    customer_ids: list[str]


class PrecedenceOut(BaseModel):
    before: str
    after: str


class SkippedHabit(BaseModel):
    id: int
    text: str
    reason: str
    conflict: bool
```

`TodayItinerary` 最後（`estimated` 之後）加：

```python
    rules: list[Rule]
    violations: list[str]
    precedences: list[PrecedenceOut]
    skipped_habits: list[SkippedHabit]
```

`StopsResult` 之後加：

```python
class DraftStopInput(BaseModel):
    customer_id: str
    duration_minutes: int = Field(default=40, ge=5, le=480)
    window_kind: Literal["at", "before", "after"] | None = None
    window_time: time | None = None
    note: str | None = Field(default=None, max_length=200)
    locked: bool = False

    @model_validator(mode="after")
    def window_needs_both(self):
        if (self.window_kind is None) != (self.window_time is None):
            raise ValueError("約的時間要選幾點到、以前或以後，再填時間")
        return self


class PrecedenceInput(BaseModel):
    before: str
    after: str


class PendingHabitInput(HabitInput):
    # 紅框上按了「今天不套用這條」：照樣記下來，只是今天不套用
    skip_today: bool = False


class DraftInput(BaseModel):
    """調整清單上的草稿：還沒跑的站照畫面上的順序。"""

    stops: list[DraftStopInput] = Field(max_length=20)
    precedences: list[PrecedenceInput] = Field(default_factory=list, max_length=50)
    skipped_habit_ids: list[int] = Field(default_factory=list, max_length=100)
    habits: list[PendingHabitInput] = Field(default_factory=list, max_length=10)

    def draft(self) -> service.Draft:
        return service.Draft(
            stops=[
                service.DraftStop(s.customer_id, s.duration_minutes, s.window_kind, s.window_time, s.note, s.locked)
                for s in self.stops
            ],
            precedences=[(p.before, p.after) for p in self.precedences],
            skipped_habit_ids=list(self.skipped_habit_ids),
            habits=[service.PendingHabit(h.spec(), h.skip_today) for h in self.habits],
        )


class PreviewInput(DraftInput):
    insert: str | None = None  # 「加一站」點的那一家


class SaveInput(DraftInput):
    version: int


class CandidateOut(BaseModel):
    customer_id: str
    customer_name: str
    type: str
    area: str
    signal: str | None
    after_stop: int | None
    extra_minutes: int | None


class CandidateList(BaseModel):
    nearby: list[CandidateOut]
    others: list[CandidateOut]
    full: bool
```

`_out` 的 `TodayItinerary(...)` 最後（`estimated=view.estimated,` 之後）加：

```python
        rules=[Rule(**dataclasses.asdict(r)) for r in view.rules], violations=view.violations,
        precedences=[PrecedenceOut(**dataclasses.asdict(p)) for p in view.precedences],
        skipped_habits=[SkippedHabit(**dataclasses.asdict(h)) for h in view.skipped_habits],
```

檔案最後加：

```python
@router.post("/today/preview", response_model=TodayItinerary)
def preview_today(session: SessionDep, body: PreviewInput, user: CurrentUser):
    """調整清單上的改動算時間、車程與違反的規則，不存；insert 是「加一站」點的那一家。"""
    try:
        view = service.preview(session, _rep_id(user), body.draft(), body.insert)
    except service.InvalidDraft as exc:
        raise HTTPException(422, str(exc)) from None
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    result = _out(view)
    # 不存任何改動；當天第一次讀就是這一支時，建好的行程要留下來
    session.commit()
    return result


@router.put("/today", response_model=TodayItinerary)
def save_today(session: SessionDep, body: SaveInput, user: CurrentUser):
    """調整清單按「完成」：整份還沒跑的站、今天的先後、今天不套用的習慣、要新增的習慣一次存進去。"""
    try:
        itinerary = service.save(session, _rep_id(user), body.version, body.draft())
    except service.VersionConflict:
        raise HTTPException(409, STALE) from None
    except service.InvalidDraft as exc:
        raise HTTPException(422, str(exc)) from None
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    session.commit()
    return _out(service.view(session, itinerary))


@router.get("/today/candidates", response_model=CandidateList)
def list_candidates(session: SessionDep, user: CurrentUser, order: str | None = None, locked: str = ""):
    """加一站的候選。order、locked 是調整清單上目前還沒跑的站與鎖住的站（逗號分隔）；沒給 order 就用存著的。"""
    ids = [cid for cid in order.split(",") if cid] if order is not None else None
    try:
        found = service.candidates(session, _rep_id(user), ids, [cid for cid in locked.split(",") if cid])
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    result = CandidateList(
        nearby=[CandidateOut(**dataclasses.asdict(c)) for c in found.nearby],
        others=[CandidateOut(**dataclasses.asdict(c)) for c in found.others], full=found.full,
    )
    session.commit()
    return result
```

- [ ] **Step 5: 先提交再算畫面**

接上 Google 之後（另一條線），`view()` 算車程最多要等 Google 5 秒。改了行程的 API 要先 commit（放掉 `_lock` 的列鎖），再算畫面，不要鎖著這份行程等 Google。`get_today`、`send_feedback`、`add_stops` 都改成這個順序（上面的 `save_today` 已經是）：

```python
@router.get("/today", response_model=TodayItinerary)
def get_today(session: SessionDep, user: CurrentUser):
    """今天的行程；當天第一次讀取時照模型的建議建好。"""
    try:
        itinerary = service.get_or_create(session, _rep_id(user))
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    # 先提交再算畫面：算車程可能要等 Google，不要讓剛建好的那一列一直卡著同時第一次讀的人
    session.commit()
    return _out(service.view(session, itinerary))
```

`send_feedback`：`except` 區塊之後換成

```python
    # 先提交、放掉列鎖再算畫面：算車程可能要等 Google
    session.commit()
    return _out(service.view(session, itinerary))
```

`add_stops`：`except` 區塊之後換成

```python
    session.commit()
    return StopsResult(
        itinerary=_out(service.view(session, itinerary)), added=added,
        skipped=[SkippedStop(**dataclasses.asdict(item)) for item in skipped],
    )
```

commit 之後 `itinerary` 的欄位會過期，`view()` 讀的時候自動重新載入，不用另外處理。

- [ ] **Step 6: 掛上習慣的 router**

`backend/app/main.py`：在 `from app.api import admin, asks, ...` 那一長行**下面另起一行**（不要改那一長行，另一條線也會在那裡加東西）：

```python
from app.api import route_habits as route_habits_api
```

`app.include_router(itinerary.router)` 下面加一行：

```python
app.include_router(route_habits_api.router)
```

- [ ] **Step 7: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests -q`
Expected: 全部 PASS（整包跑一次，確認 OAuth、組織管理、問答「排入今天的路線」都沒被影響）。

- [ ] **Step 8: Commit**

```bash
git add backend/app/api/route_habits.py backend/app/api/itinerary.py backend/app/main.py backend/tests/test_itinerary_api.py backend/tests/test_route_habits_api.py
git commit -m "$(cat <<'EOF'
Serve preview, save and candidates for the edit list, and the route habits API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 6: 前端的資料層：型別、API、草稿與規則的純函式

**Files:**
- Modify: `frontend/package.json`、`frontend/package-lock.json`（`npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`）
- Modify: `frontend/src/api/route.ts`
- Create: `frontend/src/api/route-habits.ts`
- Create: `frontend/src/lib/itinerary.ts`、`frontend/src/lib/itinerary.test.ts`
- Create: `frontend/src/lib/route-draft.ts`、`frontend/src/lib/route-draft.test.ts`
- Modify: `frontend/src/components/route-path.test.ts`（測試資料補新欄位）

**Interfaces:**
- Consumes: Task 5 的 API。
- Produces（Task 7～9 用）：
  - `api/route.ts`：`WindowKind`、`RouteStop` 多 `window_kind`、`window_time`、`note`、`locked`、`habit_ids`；`RouteRule`、`Precedence`、`SkippedHabit`；`TodayRoute` 多 `rules`、`violations`、`precedences`、`skipped_habits`；`HabitTarget`、`HabitKind`、`HabitDraft`、`DraftStop`、`RouteDraft`、`RouteCandidate`、`RouteCandidates`；`previewToday(draft, insert?, signal?)`、`saveToday(userId, version, draft)`、`getCandidates(order, locked, signal?)`
  - `api/route-habits.ts`：`RouteHabit`、`HabitOption`、`HabitList`、`listHabits(signal?)`、`createHabit(habit)`、`setHabitActive(id, active)`、`deleteHabit(id)`
  - `lib/itinerary.ts`：`WEEKDAY_LABEL`、`WINDOW_WORD`、`weekdayOf(iso)`、`openStops(route)`、`toDraftStop(stop)`、`draftFrom(route)`、`moveItem(items, from, to)`、`withoutStop(draft, id)`、`samePrecedence(a, b)`、`HabitSuggestion`、`dragHabit(order, from, to, names)`、`durationHabit(id, name, minutes)`、`windowHabit(id, name, kind, time)`、`windowLabel(kind, time)`、`formatMinutes(minutes)`、`draftRules(draft, fromServer, names)`、`brokenRules(order, rules)`、`RuleNote`、`ruleNotes(order, broken, names, moved)`、`undoTarget(history, ruleIds, fromServer, names)`、`draftAfterInsert(draft, view)`、`shownStops(draft, view, base)`
  - `lib/route-draft.ts`：`EditState`、`routeDraft.{get, start, change, revert, showView, clear}`、`useRouteDraft()`

- [ ] **Step 1: 裝拖移套件**

```bash
cd frontend && npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

確認 `package.json` 的 `dependencies` 多了這三個（版本照 npm 給的）。

- [ ] **Step 2: 寫失敗的測試**

新檔 `frontend/src/lib/itinerary.test.ts`：

```ts
import { describe, expect, it } from "vitest"

import type { RouteDraft, RouteRule, RouteStop, TodayRoute } from "@/api/route"
import {
  brokenRules,
  draftAfterInsert,
  draftFrom,
  draftRules,
  dragHabit,
  durationHabit,
  formatMinutes,
  moveItem,
  ruleNotes,
  shownStops,
  undoTarget,
  weekdayOf,
  windowHabit,
  windowLabel,
  withoutStop,
} from "@/lib/itinerary"

const NAMES: Record<string, string> = { A: "德安藥局", B: "佑生藥局", C: "杏林診所", D: "康泰忠孝店" }

function stop(id: string, status: RouteStop["status"] = "todo", extra: Partial<RouteStop> = {}): RouteStop {
  return {
    customer_id: id,
    customer_name: NAMES[id] ?? id,
    type: "independent",
    grade: "A",
    planned_time: "10:00",
    status,
    signal: "ar",
    reason: "帳款最久拖了 78 天",
    visit_id: null,
    source: "model",
    duration_minutes: 40,
    late_minutes: 0,
    travel_minutes: 10,
    travel_km: 3.2,
    window_kind: null,
    window_time: null,
    note: null,
    locked: false,
    habit_ids: [],
    ...extra,
  }
}

function route(stops: RouteStop[], extra: Partial<TodayRoute> = {}): TodayRoute {
  return {
    date: "2026-10-28",
    rep: { id: "U01", name: "林昱辰" },
    version: 3,
    done: stops.filter((s) => s.status === "done").length,
    total: stops.length,
    urgent: null,
    stops,
    travel_minutes: 60,
    travel_km: 20,
    finish_time: "15:00",
    estimated: true,
    rules: [],
    violations: [],
    precedences: [],
    skipped_habits: [],
    ...extra,
  }
}

function draft(ids: string[], extra: Partial<RouteDraft> = {}): RouteDraft {
  return {
    stops: ids.map((id) => ({ customer_id: id, duration_minutes: 40, window_kind: null, window_time: null, note: null, locked: false })),
    precedences: [],
    skipped_habit_ids: [],
    habits: [],
    ...extra,
  }
}

function rule(id: string, kind: RouteRule["kind"], ids: string[], source: RouteRule["source"] = "habit"): RouteRule {
  return { id, text: `規則${id}`, kind, source, customer_ids: ids }
}

describe("草稿", () => {
  it("只拿還沒跑的站，先後與今天不套用的習慣照舊", () => {
    const today = route([stop("A", "done"), stop("B", "next", { locked: true }), stop("C")], {
      precedences: [{ before: "C", after: "B" }],
      skipped_habits: [{ id: 7, text: "x", reason: "你選了今天不套用", conflict: false }],
    })
    const result = draftFrom(today)
    expect(result.stops.map((s) => s.customer_id)).toEqual(["B", "C"])
    expect(result.stops[0].locked).toBe(true)
    expect(result.precedences).toEqual([{ before: "C", after: "B" }])
    expect(result.skipped_habit_ids).toEqual([7])
    expect(result.habits).toEqual([])
  })

  it("上移、下移", () => {
    expect(moveItem(["A", "B", "C", "D"], 3, 1)).toEqual(["A", "D", "B", "C"])
    expect(moveItem(["A", "B", "C", "D"], 0, 2)).toEqual(["B", "C", "A", "D"])
  })

  it("拿掉一站，跟它有關的先後一起拿掉", () => {
    const before = draft(["A", "B", "C"], { precedences: [{ before: "A", after: "B" }, { before: "C", after: "A" }, { before: "B", after: "C" }] })
    const after = withoutStop(before, "A")
    expect(after.stops.map((s) => s.customer_id)).toEqual(["B", "C"])
    expect(after.precedences).toEqual([{ before: "B", after: "C" }])
  })

  it("加一站回來照後端排的順序，原本的站保留草稿上的欄位", () => {
    const before = draft(["A", "B"])
    before.stops[0].note = "找王藥師"
    const view = route([stop("A"), stop("D", "todo", { duration_minutes: 60, window_kind: "before", window_time: "11:00" }), stop("B")])
    const after = draftAfterInsert(before, view)
    expect(after.stops.map((s) => s.customer_id)).toEqual(["A", "D", "B"])
    expect(after.stops[0].note).toBe("找王藥師")
    expect(after.stops[1]).toMatchObject({ duration_minutes: 60, window_kind: "before", window_time: "11:00" })
  })

  it("卡片的欄位用草稿的，時間用 preview 回來的", () => {
    const base = route([stop("A"), stop("B")])
    const view = route([stop("A", "todo", { planned_time: "10:05" }), stop("B")])
    const current = draft(["B", "A"])
    current.stops[1].duration_minutes = 90
    const shown = shownStops(current, view, base)
    expect(shown.map((s) => s.customer_id)).toEqual(["B", "A"])
    expect(shown[1]).toMatchObject({ planned_time: "10:05", duration_minutes: 90 })
  })
})

describe("拖完要不要記成習慣", () => {
  it("往上拖過 Y：X 排在 Y 前面", () => {
    const suggestion = dragHabit(["A", "B", "C", "D"], 3, 1, NAMES)
    expect(suggestion?.text).toBe("康泰忠孝店 排在 佑生藥局 前面")
    expect(suggestion?.habit).toMatchObject({
      kind: "precedence",
      subject: { by: "customer", value: "D" },
      object: { by: "customer", value: "B" },
      weekday: null,
    })
  })

  it("往下拖過 Y：Y 排在 X 前面", () => {
    const suggestion = dragHabit(["A", "B", "C", "D"], 0, 2, NAMES)
    expect(suggestion?.text).toBe("杏林診所 排在 德安藥局 前面")
    expect(suggestion?.habit).toMatchObject({ subject: { value: "C" }, object: { value: "A" } })
  })

  it("沒有動就不問", () => {
    expect(dragHabit(["A", "B"], 1, 1, NAMES)).toBeNull()
  })

  it("改停留、改約的時間", () => {
    expect(durationHabit("A", "德安藥局", 60)).toMatchObject({
      text: "以後去 德安藥局 都停 60 分",
      habit: { kind: "duration", duration_minutes: 60, subject: { by: "customer", value: "A" } },
    })
    expect(windowHabit("C", "杏林診所", "before", "11:00").text).toBe("以後 杏林診所 都約 11:00 以前")
    expect(windowHabit("C", "杏林診所", "at", "09:30").habit).toMatchObject({ kind: "window", window_kind: "at", window_time: "09:30" })
  })
})

describe("違反的規則", () => {
  it("今天的先後照草稿現算，習慣用 preview 回來的", () => {
    const fromServer = [rule("today:X>Y", "precedence", ["X", "Y"], "today"), rule("habit:1", "first", ["C"])]
    const rules = draftRules(draft(["A", "B", "C"], { precedences: [{ before: "B", after: "A" }] }), fromServer, NAMES)
    expect(rules.map((r) => r.id)).toEqual(["today:B>A", "habit:1"])
    expect(rules[0]).toMatchObject({ source: "today", text: "佑生藥局 排在 德安藥局 前面", customer_ids: ["B", "A"] })
  })

  it("先後、排第一、排最後；同一條習慣拆成好幾組只算一次", () => {
    const pairs = [rule("habit:7", "precedence", ["C", "A"]), rule("habit:7", "precedence", ["D", "A"])]
    const first = rule("habit:8", "first", ["B", "C"])
    const last = rule("habit:9", "last", ["A"])
    expect(brokenRules(["A", "B", "C", "D"], [...pairs, first, last]).map((r) => r.id)).toEqual(["habit:7", "habit:8", "habit:9"])
    expect(brokenRules(["B", "C", "D", "A"], [...pairs, first, last])).toEqual([])
    // 規則提到的客戶不在今天的行程裡就不算
    expect(brokenRules(["A", "B"], [rule("habit:3", "precedence", ["X", "A"])])).toEqual([])
  })

  it("先後寫在剛拖的那一站；不是它就寫在後面那一站", () => {
    const today = rule("today:B>A", "precedence", ["B", "A"], "today")
    expect(ruleNotes(["A", "B"], [today], NAMES, "B").get("B")?.[0].text).toBe("要在 德安藥局 之前")
    expect(ruleNotes(["A", "B"], [today], NAMES, null).get("A")?.[0].text).toBe("要在 佑生藥局 之後")
    const habit = rule("habit:8", "first", ["B", "C"])
    expect(ruleNotes(["A", "B", "C"], [habit], NAMES, "C").get("C")?.[0].text).toBe("規則habit:8")
    expect(ruleNotes(["A", "B", "C"], [habit], NAMES, "A").get("B")?.[0].text).toBe("規則habit:8")
  })

  it("復原回到最近一份不違反的草稿", () => {
    const fromServer = [rule("habit:1", "first", ["C"])]
    const history = [draft(["C", "A", "B"]), draft(["C", "B", "A"]), draft(["A", "C", "B"])]
    expect(undoTarget(history, ["habit:1"], fromServer, NAMES)).toBe(1)
    expect(undoTarget([draft(["A", "C"])], ["habit:1"], fromServer, NAMES)).toBeNull()
  })
})

describe("寫法", () => {
  it("星期幾、分鐘、約的時間", () => {
    expect(weekdayOf("2026-10-28")).toBe(2)
    expect(weekdayOf("2026-11-01")).toBe(6)
    expect(formatMinutes(75)).toBe("1 小時 15 分")
    expect(formatMinutes(120)).toBe("2 小時")
    expect(formatMinutes(50)).toBe("50 分")
    expect(windowLabel("at", "10:30")).toBe("約 10:30 到")
    expect(windowLabel("before", "11:00")).toBe("11:00 以前")
  })
})
```

新檔 `frontend/src/lib/route-draft.test.ts`：

```ts
import { afterEach, describe, expect, it } from "vitest"

import type { RouteStop, TodayRoute } from "@/api/route"
import { routeDraft } from "@/lib/route-draft"

function stop(id: string): RouteStop {
  return {
    customer_id: id, customer_name: id, type: "independent", grade: "A", planned_time: "10:00", status: "todo",
    signal: "ar", reason: "", visit_id: null, source: "model", duration_minutes: 40, late_minutes: 0,
    travel_minutes: 10, travel_km: 3, window_kind: null, window_time: null, note: null, locked: false, habit_ids: [],
  }
}

const today: TodayRoute = {
  date: "2026-10-28", rep: { id: "U01", name: "林昱辰" }, version: 1, done: 0, total: 2, urgent: null,
  stops: [stop("A"), stop("B")], travel_minutes: 20, travel_km: 6, finish_time: "11:00", estimated: true,
  rules: [], violations: [], precedences: [], skipped_habits: [],
}

describe("調整中的草稿", () => {
  afterEach(() => routeDraft.clear())

  it("開始、改、復原、清掉", () => {
    routeDraft.start(today)
    const first = routeDraft.get()!.draft
    expect(first.stops.map((s) => s.customer_id)).toEqual(["A", "B"])
    routeDraft.change({ ...first, stops: [...first.stops].reverse() }, "B")
    expect(routeDraft.get()!.history).toEqual([first])
    expect(routeDraft.get()!.moved).toBe("B")
    routeDraft.showView({ ...today, version: 5 }, routeDraft.get()!.draft)
    routeDraft.revert(0)
    expect(routeDraft.get()!.draft).toBe(first)
    expect(routeDraft.get()!.history).toEqual([])
    expect(routeDraft.get()!.view).toBe(today)
    routeDraft.clear()
    expect(routeDraft.get()).toBeNull()
  })

  it("preview 回來時草稿已經又改了，就不用那一份", () => {
    routeDraft.start(today)
    const asked = routeDraft.get()!.draft
    routeDraft.change({ ...asked, stops: asked.stops.slice(0, 1) })
    routeDraft.showView({ ...today, version: 99 }, asked)
    expect(routeDraft.get()!.view.version).toBe(1)
    const now = routeDraft.get()!.draft
    routeDraft.showView({ ...today, version: 2 }, now)
    expect(routeDraft.get()!.view.version).toBe(2)
  })
})
```

`frontend/src/components/route-path.test.ts` 的 `stop()` 裡 `travel_km: 3.2,` 後面加：

```ts
    window_kind: null,
    window_time: null,
    note: null,
    locked: false,
    habit_ids: [],
```

- [ ] **Step 3: 跑測試，確認失敗**

Run: `cd frontend && npx vitest run src/lib/itinerary.test.ts src/lib/route-draft.test.ts`
Expected: FAIL（找不到 `@/lib/itinerary`、`@/lib/route-draft`）。

- [ ] **Step 4: `api/route.ts`**

`RouteStop` 的 `travel_km: number | null` 後面加：

```ts
  // 約的時間：at 幾點到、before 以前、after 以後；沒約是 null
  window_kind: WindowKind | null
  window_time: string | null
  note: string | null
  // 排順路時位置不動
  locked: boolean
  // 套用在這一站的習慣，調整清單的卡片上標綠色「習慣」
  habit_ids: number[]
```

`RouteStop` 前面加：

```ts
export type WindowKind = "at" | "before" | "after"
```

`TodayRoute` 的 `estimated: boolean` 後面加：

```ts
  // 調整清單要守的規則（今天的先後與習慣；鎖住的不列）與目前的順序違反了哪幾條
  rules: RouteRule[]
  violations: string[]
  precedences: Precedence[]
  // 今天不套用的習慣；conflict 是每天建立建議時跟別的規則衝突，行程上要提示
  skipped_habits: SkippedHabit[]
```

`TodayRoute` 前面加：

```ts
export type RouteRule = {
  id: string
  text: string
  kind: "precedence" | "first" | "last"
  // today：今天設的先後；habit：習慣；new：這次答應要記、按「完成」才存的習慣
  source: "today" | "habit" | "new"
  // precedence 是 [前, 後]；同一條習慣拆成好幾組時 id 相同
  customer_ids: string[]
}

export type Precedence = { before: string; after: string }

export type SkippedHabit = { id: number; text: string; reason: string; conflict: boolean }
```

`AddStopsResult` 後面加：

```ts
export type HabitTarget = { by: "customer" | "chain" | "type" | "area"; value: string }

export type HabitKind = "precedence" | "first" | "last" | "window" | "duration"

// 一條習慣的欄位（新增習慣、調整清單上答應要記的都是這個樣子）。object 只有先後用
export type HabitDraft = {
  kind: HabitKind
  subject: HabitTarget
  object: HabitTarget | null
  window_kind: WindowKind | null
  window_time: string | null
  duration_minutes: number | null
  // 0 是星期一；null 是每天
  weekday: number | null
  // 紅框上按了「今天不套用這條」：照樣記下來，只是今天不套用
  skip_today?: boolean
}

export type DraftStop = Pick<RouteStop, "customer_id" | "duration_minutes" | "window_kind" | "window_time" | "note" | "locked">

// 調整清單上改到一半的行程：還沒跑的站照畫面上的順序
export type RouteDraft = {
  stops: DraftStop[]
  precedences: Precedence[]
  skipped_habit_ids: number[]
  habits: HabitDraft[]
}

export type RouteCandidate = {
  customer_id: string
  customer_name: string
  type: "chain" | "independent" | "clinic"
  area: string
  // 順路的才有：目前的理由類別、插在第幾站後（0 是排第一站）、估算多繞幾分鐘
  signal: RouteSignal | null
  after_stop: number | null
  extra_minutes: number | null
}

export type RouteCandidates = { nearby: RouteCandidate[]; others: RouteCandidate[]; full: boolean }
```

檔案最後（`remainingStops` 前面）加：

```ts
/** 調整清單上的草稿算時間、車程與違反的規則，不存；insert 是「加一站」點的那一家 */
export function previewToday(draft: RouteDraft, insert?: string, signal?: AbortSignal) {
  return request<TodayRoute>("/api/itinerary/today/preview", {
    ...jsonBody("POST", { ...draft, insert: insert ?? null }),
    signal,
  })
}

/** 調整清單按「完成」：一次存進去；行程剛被改過回 409 */
export async function saveToday(userId: string, version: number, draft: RouteDraft) {
  const route = await request<TodayRoute>("/api/itinerary/today", jsonBody("PUT", { ...draft, version }))
  writeCache(routeKey(userId), route)
  return route
}

/** 加一站的候選：順路的前幾家（估算多繞幾分鐘）與其他客戶。order、locked 是草稿上還沒跑的站與鎖住的站 */
export function getCandidates(order: string[], locked: string[], signal?: AbortSignal) {
  const query = new URLSearchParams({ order: order.join(","), locked: locked.join(",") })
  return request<RouteCandidates>(`/api/itinerary/today/candidates?${query}`, { signal })
}
```

- [ ] **Step 5: `api/route-habits.ts`**

```ts
import { jsonBody, request } from "@/api/client"
import type { HabitDraft, HabitTarget } from "@/api/route"

export type RouteHabit = HabitDraft & {
  id: number
  // 給人看的一句話，後端依欄位產生
  text: string
  // ai：在首頁跟熊熊滾說的；prompt：拖完答應的；manual：自己新增的
  source: "ai" | "prompt" | "manual"
  active: boolean
  created_at: string
  // applied 套用中；skipped 今天不套用（原因在 skip_reason）；off 停用；other_day 不是今天
  today: "applied" | "skipped" | "off" | "other_day"
  skip_reason: string | null
}

export type HabitOption = { value: string; label: string }

export type HabitList = {
  // 今天星期幾，0 是星期一
  weekday: number
  habits: RouteHabit[]
  // 新增習慣能選的對象：自己的客戶、他們的連鎖體系、三種客戶類型、地區
  targets: Record<HabitTarget["by"], HabitOption[]>
}

export function listHabits(signal?: AbortSignal) {
  return request<HabitList>("/api/route-habits", { signal })
}

export function createHabit(habit: HabitDraft) {
  return request<RouteHabit>("/api/route-habits", jsonBody("POST", habit))
}

export function setHabitActive(id: number, active: boolean) {
  return request<RouteHabit>(`/api/route-habits/${id}`, jsonBody("PATCH", { active }))
}

export function deleteHabit(id: number) {
  return request<void>(`/api/route-habits/${id}`, { method: "DELETE" })
}
```

- [ ] **Step 6: `lib/itinerary.ts`**

```ts
import type {
  DraftStop,
  HabitDraft,
  HabitKind,
  Precedence,
  RouteDraft,
  RouteRule,
  RouteStop,
  TodayRoute,
  WindowKind,
} from "@/api/route"

/**
 * 調整行程的純函式（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈調整行程（清單）〉）：
 * 草稿、換位置、拖完或改完要不要記成習慣的那一句、這個順序違反哪幾條規則、復原回到哪一份。
 */

/** 星期幾的寫法，0 是星期一（跟後端 date.weekday() 一樣） */
export const WEEKDAY_LABEL = "一二三四五六日"

export const WINDOW_WORD: Record<WindowKind, string> = { at: "到", before: "以前", after: "以後" }

/** 2026-10-28 → 2（星期三）。用當地時間的午夜算，免得時區把日期推到前一天 */
export function weekdayOf(iso: string) {
  return (new Date(`${iso}T00:00:00`).getDay() + 6) % 7
}

/** 還沒跑的站 */
export function openStops(route: TodayRoute) {
  return route.stops.filter((stop) => stop.status !== "done")
}

export function toDraftStop(stop: RouteStop): DraftStop {
  return {
    customer_id: stop.customer_id,
    duration_minutes: stop.duration_minutes,
    window_kind: stop.window_kind,
    window_time: stop.window_time,
    note: stop.note,
    locked: stop.locked,
  }
}

/** 存著的行程換成調整清單的草稿：還沒跑的站照目前的順序，先後與今天不套用的習慣照舊 */
export function draftFrom(route: TodayRoute): RouteDraft {
  return {
    stops: openStops(route).map(toDraftStop),
    precedences: route.precedences.map((p) => ({ ...p })),
    skipped_habit_ids: route.skipped_habits.map((habit) => habit.id),
    habits: [],
  }
}

/** 第 from 個移到第 to 個 */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/** 拿掉一站，跟它有關的先後一起拿掉（後端存檔時也一樣） */
export function withoutStop(draft: RouteDraft, customerId: string): RouteDraft {
  return {
    ...draft,
    stops: draft.stops.filter((stop) => stop.customer_id !== customerId),
    precedences: draft.precedences.filter((p) => p.before !== customerId && p.after !== customerId),
  }
}

export function samePrecedence(a: Precedence, b: Precedence) {
  return a.before === b.before && a.after === b.after
}

/** 要不要記成習慣的那一句，和答應了要記的習慣（星期幾由呼叫端照業務選的填） */
export type HabitSuggestion = { text: string; habit: HabitDraft }

function habitFor(kind: HabitKind, customerId: string, extra: Partial<HabitDraft> = {}): HabitDraft {
  return {
    kind,
    subject: { by: "customer", value: customerId },
    object: null,
    window_kind: null,
    window_time: null,
    duration_minutes: null,
    weekday: null,
    ...extra,
  }
}

/**
 * 拖完（或上移、下移）之後問的那一句。order 是拖之前的順序：
 * 往上拖過 Y（新位置的下一站是 Y）是「X 排在 Y 前面」；往下拖過 Y（新位置的上一站是 Y）是「Y 排在 X 前面」
 */
export function dragHabit(order: string[], from: number, to: number, names: Record<string, string>): HabitSuggestion | null {
  if (from === to) return null
  const moved = order[from]
  const after = moveItem(order, from, to)
  const [first, then] = to < from ? [moved, after[to + 1]] : [after[to - 1], moved]
  if (!first || !then) return null
  return {
    text: `${names[first]} 排在 ${names[then]} 前面`,
    habit: habitFor("precedence", first, { object: { by: "customer", value: then } }),
  }
}

/** 改停留之後問的那一句：「以後去 X 都停 N 分」 */
export function durationHabit(customerId: string, name: string, minutes: number): HabitSuggestion {
  return { text: `以後去 ${name} 都停 ${minutes} 分`, habit: habitFor("duration", customerId, { duration_minutes: minutes }) }
}

/** 改約的時間之後問的那一句：「以後 X 都約 11:00 以前」 */
export function windowHabit(customerId: string, name: string, kind: WindowKind, time: string): HabitSuggestion {
  return {
    text: `以後 ${name} 都約 ${time} ${WINDOW_WORD[kind]}`,
    habit: habitFor("window", customerId, { window_kind: kind, window_time: time }),
  }
}

/** 約的時間的小標籤：「約 10:30 到」「11:00 以前」「14:00 以後」 */
export function windowLabel(kind: WindowKind, time: string) {
  return kind === "at" ? `約 ${time} 到` : `${time} ${WINDOW_WORD[kind]}`
}

/** 75 → 「1 小時 15 分」；120 → 「2 小時」；50 → 「50 分」 */
export function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest} 分`
  return rest ? `${hours} 小時 ${rest} 分` : `${hours} 小時`
}

/** 草稿要守的規則：今天的先後照草稿現算（剛加、剛拿掉的馬上算數），習慣用最近一次 preview 回來的 */
export function draftRules(draft: RouteDraft, fromServer: RouteRule[], names: Record<string, string>): RouteRule[] {
  const today: RouteRule[] = draft.precedences.map((p) => ({
    id: `today:${p.before}>${p.after}`,
    text: `${names[p.before] ?? p.before} 排在 ${names[p.after] ?? p.after} 前面`,
    kind: "precedence",
    source: "today",
    customer_ids: [p.before, p.after],
  }))
  return [...today, ...fromServer.filter((rule) => rule.source !== "today")]
}

/** 這個順序違反哪幾條規則（同一條習慣拆成好幾組先後時只算一次）。跟後端 route_planner.violations 同一套判斷 */
export function brokenRules(order: string[], rules: RouteRule[]): RouteRule[] {
  const position = new Map(order.map((id, index) => [id, index]))
  const seen = new Set<string>()
  const broken: RouteRule[] = []
  for (const rule of rules) {
    if (seen.has(rule.id)) continue
    let ok = true
    if (rule.kind === "precedence") {
      const [first, then] = rule.customer_ids.map((id) => position.get(id))
      ok = first === undefined || then === undefined || first < then
    } else {
      const chosen = rule.customer_ids.flatMap((id) => position.get(id) ?? [])
      const others = order.filter((id) => !rule.customer_ids.includes(id)).map((id) => position.get(id)!)
      if (chosen.length > 0 && others.length > 0) {
        ok = rule.kind === "first" ? Math.max(...chosen) < Math.min(...others) : Math.min(...chosen) > Math.max(...others)
      }
    }
    if (!ok) {
      broken.push(rule)
      seen.add(rule.id)
    }
  }
  return broken
}

export type RuleNote = { rule: RouteRule; text: string }

/**
 * 違反的規則寫在哪一張卡上、寫什麼。今天的先後寫在剛拖的那一站（它是前面那家就寫「要在 Y 之前」），
 * 不然寫在後面那家（「要在 X 之後」）；習慣寫那一句，放在剛拖的那一站（習慣有提到它的話），不然放在習慣提到的一家。
 */
export function ruleNotes(order: string[], broken: RouteRule[], names: Record<string, string>, moved: string | null) {
  const notes = new Map<string, RuleNote[]>()
  const add = (id: string, note: RuleNote) => notes.set(id, [...(notes.get(id) ?? []), note])
  for (const rule of broken) {
    if (rule.kind === "precedence" && rule.source === "today") {
      const [first, then] = rule.customer_ids
      if (moved === first) add(first, { rule, text: `要在 ${names[then] ?? then} 之前` })
      else add(then, { rule, text: `要在 ${names[first] ?? first} 之後` })
      continue
    }
    const involved = rule.customer_ids.filter((id) => order.includes(id))
    const target = moved && involved.includes(moved) ? moved : rule.kind === "precedence" ? involved[1] : involved[0]
    if (target) add(target, { rule, text: rule.text })
  }
  return notes
}

/** 「復原」回到哪一份草稿：history（由舊到新）裡最近一份不違反這幾條規則的；找不到就是 null */
export function undoTarget(history: RouteDraft[], ruleIds: string[], fromServer: RouteRule[], names: Record<string, string>) {
  for (let index = history.length - 1; index >= 0; index--) {
    const draft = history[index]
    const broken = brokenRules(draft.stops.map((stop) => stop.customer_id), draftRules(draft, fromServer, names))
    if (!broken.some((rule) => ruleIds.includes(rule.id))) return index
  }
  return null
}

/** 「加一站」回來的 preview 換成新的草稿：還沒跑的站照後端排的順序（新的那一家插在順路的位置，
 * 約的時間與停留是習慣給的預設值；剛跑完的站後端已經拿掉），原本的站保留草稿上的欄位 */
export function draftAfterInsert(draft: RouteDraft, view: TodayRoute): RouteDraft {
  const mine = new Map(draft.stops.map((stop) => [stop.customer_id, stop]))
  return { ...draft, stops: openStops(view).map((stop) => mine.get(stop.customer_id) ?? toDraftStop(stop)) }
}

/** 卡片上的一站：時間、車程、理由用最近一次 preview 回來的，可以改的欄位用草稿的（preview 還沒回來也跟得上） */
export function shownStops(draft: RouteDraft, view: TodayRoute, base: TodayRoute): RouteStop[] {
  const known = new Map([...base.stops, ...view.stops].map((stop) => [stop.customer_id, stop]))
  return draft.stops.flatMap((stop) => {
    const shown = known.get(stop.customer_id)
    return shown ? [{ ...shown, ...stop }] : []
  })
}
```

- [ ] **Step 7: `lib/route-draft.ts`**

```ts
import { useSyncExternalStore } from "react"

import type { RouteDraft, TodayRoute } from "@/api/route"
import { draftFrom } from "@/lib/itinerary"

/**
 * 調整中的行程：清單頁（/route/edit）、加一站頁（/route/edit/add）與習慣頁來回切換時都在，
 * 按「完成」或「取消」才清掉。只存在這個分頁的記憶體裡，重新整理就沒了（設計：取消就是全部丟掉）。
 */
export type EditState = {
  // 進來時讀到的那一份：存檔時帶它的 version
  base: TodayRoute
  // 最近一次 preview 回來的：時間、車程、規則
  view: TodayRoute
  draft: RouteDraft
  // 每一次改動之前的草稿，由舊到新，「復原」用
  history: RouteDraft[]
  // 最近拖動的那一站：違反的規則寫在它的卡上
  moved: string | null
}

let state: EditState | null = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const routeDraft = {
  get: () => state,
  start(route: TodayRoute) {
    state = { base: route, view: route, draft: draftFrom(route), history: [], moved: null }
    emit()
  },
  change(draft: RouteDraft, moved: string | null = null) {
    if (!state) return
    state = { ...state, draft, history: [...state.history, state.draft], moved }
    emit()
  },
  // 回到第 index 份草稿；回到最一開始就連畫面也回到進來時讀到的那一份（那一份的車程是正式的，不是 preview 的估計）
  revert(index: number) {
    if (!state || !state.history[index]) return
    const view = index === 0 ? state.base : state.view
    state = { ...state, draft: state.history[index], history: state.history.slice(0, index), view, moved: null }
    emit()
  },
  // preview 回來時草稿已經又改了，那一份就不用：下一次 preview 會算新的
  showView(view: TodayRoute, forDraft: RouteDraft) {
    if (!state || state.draft !== forDraft) return
    state = { ...state, view }
    emit()
  },
  clear() {
    state = null
    emit()
  },
}

export function useRouteDraft() {
  return useSyncExternalStore(subscribe, routeDraft.get, routeDraft.get)
}
```

- [ ] **Step 8: 跑測試、型別檢查**

Run: `cd frontend && npx vitest run && npm run typecheck && npm run lint`
Expected: 全部通過。`typecheck` 若有其他地方建 `RouteStop`／`TodayRoute` 的物件（測試資料）缺新欄位，照上面的欄位補上。

- [ ] **Step 9: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/api/route.ts frontend/src/api/route-habits.ts frontend/src/lib/itinerary.ts frontend/src/lib/itinerary.test.ts frontend/src/lib/route-draft.ts frontend/src/lib/route-draft.test.ts frontend/src/components/route-path.test.ts
git commit -m "$(cat <<'EOF'
Add the edit-list draft, rule checks and route habits API on the frontend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 清單上的一站、展開編輯、要不要記成習慣

**Files:**
- Create: `frontend/src/components/route/switch.tsx`
- Create: `frontend/src/components/route/stop-card.tsx`、`frontend/src/components/route/stop-card.test.ts`
- Create: `frontend/src/components/route/stop-editor.tsx`
- Create: `frontend/src/components/route/habit-prompt.tsx`、`frontend/src/components/route/habit-prompt.test.ts`
- Modify: `frontend/src/lib/route-path.ts`（匯出 `TONE_CLASS`）、`frontend/src/components/route-path.tsx`（改用它）

**Interfaces:**
- Consumes: Task 6 的型別與 `lib/itinerary.ts`。
- Produces（Task 8、9 用）：
  - `Switch({ checked, onChange, label, disabled? })`
  - `StopHandle = { ref: (element: HTMLElement | null) => void; attributes: DraggableAttributes; listeners: SyntheticListenerMap | undefined }`
  - `StopCard(props: StopCardProps)`：`stop`、`number`、`names`、`precedences`、`notes?`、`undoable?`、`expanded?`、`canMoveUp?`、`canMoveDown?`、`dragging?`、`handle?`、`onToggle?`、`onMoveUp?`、`onMoveDown?`、`onDropRule?(note)`、`onSkipHabit?(note)`、`onUndo?(note)`、`children?`
  - `StopEditor(props)`：`stop: DraftStop`、`name`、`arrive`、`others: {id, name}[]`、`precedences`、`onChange(patch, ask?)`、`onAddPrecedence(p)`、`onRemovePrecedence(p)`、`onRemove()`
  - `HabitChoice = "today" | "weekday" | "always"`、`HabitPrompt({ text, weekday, onDone(choice) })`
  - `lib/route-path.ts` 的 `TONE_CLASS`

- [ ] **Step 1: 寫失敗的測試**

新檔 `frontend/src/components/route/stop-card.test.ts`：

```ts
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { RouteRule, RouteStop } from "@/api/route"
import { StopCard, type StopCardProps } from "@/components/route/stop-card"

function stop(extra: Partial<RouteStop> = {}): RouteStop {
  return {
    customer_id: "A", customer_name: "德安藥局 · 板橋", type: "independent", grade: "A", planned_time: "10:30",
    status: "todo", signal: "ar", reason: "帳款最久拖了 78 天", visit_id: null, source: "model", duration_minutes: 40,
    late_minutes: 0, travel_minutes: 12, travel_km: 4.1, window_kind: null, window_time: null, note: null,
    locked: false, habit_ids: [], ...extra,
  }
}

const NAMES = { A: "德安藥局 · 板橋", B: "佑生藥局 · 大安" }
const render = (props: Partial<StopCardProps>) =>
  renderToStaticMarkup(createElement(StopCard, { stop: stop(), number: 2, names: NAMES, precedences: [], ...props }))

describe("StopCard", () => {
  it("站號、店名、幾點到、停多久，可以拖也可以上移下移", () => {
    const html = render({ canMoveUp: true, canMoveDown: false })
    expect(html).toContain(">2<")
    expect(html).toContain("10:30 到 · 停 40 分")
    expect(html).toContain('aria-label="拖移 德安藥局 · 板橋"')
    expect(html).toContain('aria-label="上移 德安藥局 · 板橋"')
    expect(html).toMatch(/aria-label="下移 德安藥局 · 板橋"[^>]*disabled/)
  })

  it("小標籤：約的時間、鎖住、先後、備註、習慣、理由類別；會晚到寫紅字", () => {
    const html = render({
      stop: stop({ window_kind: "before", window_time: "11:00", locked: true, note: "找王藥師", habit_ids: [3], late_minutes: 25 }),
      precedences: [{ before: "B", after: "A" }],
    })
    for (const text of ["11:00 以前", "鎖住", "在 佑生藥局 · 大安 之後", "找王藥師", "習慣", "帳款", "會晚到 25 分"]) {
      expect(html).toContain(text)
    }
  })

  it("違反規則：紅框、寫哪一條，今天的先後可以拿掉，習慣可以今天不套用，回得去才有復原", () => {
    const today: RouteRule = { id: "today:B>A", text: "x", kind: "precedence", source: "today", customer_ids: ["B", "A"] }
    const habit: RouteRule = { id: "habit:3", text: "康泰連鎖藥局的店排在診所前面", kind: "precedence", source: "habit", customer_ids: ["A", "B"] }
    const html = render({
      notes: [{ rule: today, text: "要在 佑生藥局 · 大安 之後" }, { rule: habit, text: habit.text }],
      undoable: true,
    })
    expect(html).toContain('data-broken="true"')
    expect(html).toContain("違反：要在 佑生藥局 · 大安 之後")
    expect(html).toContain("拿掉這條限制")
    expect(html).toContain("違反：康泰連鎖藥局的店排在診所前面")
    expect(html).toContain("今天不套用這條")
    expect(html.match(/復原/g)).toHaveLength(2)
    expect(render({ notes: [{ rule: today, text: "要在 佑生藥局 · 大安 之後" }] })).not.toContain("復原")
  })

  it("已完成的站淡色、沒有把手，不能動", () => {
    const html = render({ stop: stop({ status: "done", planned_time: "09:50" }) })
    expect(html).toContain("09:50 完成")
    expect(html).not.toContain("拖移")
    expect(html).not.toContain("上移")
    expect(html).toContain("opacity-60")
  })
})
```

新檔 `frontend/src/components/route/habit-prompt.test.ts`：

```ts
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { HabitPrompt } from "@/components/route/habit-prompt"

describe("HabitPrompt", () => {
  it("問以後也這樣排嗎，三個選項，預設只有今天", () => {
    const html = renderToStaticMarkup(
      createElement(HabitPrompt, { text: "康泰忠孝店 排在 佑生藥局 前面", weekday: 2, onDone: () => {} })
    )
    expect(html).toContain("以後也這樣排嗎？")
    expect(html).toContain("康泰忠孝店 排在 佑生藥局 前面")
    expect(html).toMatch(/aria-checked="true"[^>]*>.*只有今天/)
    expect(html).toContain("每個星期三都這樣")
    expect(html).toContain("每次都這樣")
  })
})
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `cd frontend && npx vitest run src/components/route`
Expected: FAIL（元件還不存在）。

- [ ] **Step 3: 共用的語氣顏色**

`frontend/src/lib/route-path.ts` 最後加：

```ts
/** 理由類別的字色：商機綠、警示紅、例行灰 */
export const TONE_CLASS = { good: "text-success", alert: "text-destructive", plain: "text-muted-foreground" } as const
```

`frontend/src/components/route-path.tsx` 刪掉自己的 `const TONE_CLASS = ...` 那一行，改從 `@/lib/route-path` import（加進原本那一行 `import { bearStopIndex, labelSide, pathOffset, signalTone } from "@/lib/route-path"`）。

- [ ] **Step 4: 開關**

新檔 `frontend/src/components/route/switch.tsx`：

```tsx
import { cn } from "@/lib/utils"

/** 開關（鎖住、習慣的啟用）。整顆 44px 高好按；旁邊的說明文字由呼叫端放，label 給讀螢幕的人 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group flex h-11 w-14 shrink-0 items-center justify-center outline-none disabled:opacity-50"
    >
      <span
        className={cn(
          "relative h-7 w-12 rounded-full transition-colors group-focus-visible:ring-3 group-focus-visible:ring-ring/50",
          checked ? "bg-primary" : "bg-input"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform motion-reduce:transition-none",
            checked && "translate-x-5"
          )}
        />
      </span>
    </button>
  )
}
```

- [ ] **Step 5: 清單上的一站**

新檔 `frontend/src/components/route/stop-card.tsx`：

```tsx
import type { ReactNode } from "react"
import type { DraggableAttributes } from "@dnd-kit/core"
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities"
import {
  ArrowDownUp,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  GripVertical,
  Lock,
  Repeat,
  StickyNote,
  Undo2,
  type LucideIcon,
} from "lucide-react"

import { SIGNAL_LABEL, type Precedence, type RouteStop } from "@/api/route"
import { Button } from "@/components/ui/button"
import { windowLabel, type RuleNote } from "@/lib/itinerary"
import { signalTone, TONE_CLASS } from "@/lib/route-path"
import { cn } from "@/lib/utils"

// 拖移把手：dnd-kit 的 useSortable 給的，只有把手按著才拖得動，其他地方照樣可以捲動
export type StopHandle = {
  ref: (element: HTMLElement | null) => void
  attributes: DraggableAttributes
  listeners: SyntheticListenerMap | undefined
}

export type StopCardProps = {
  // 可以改的欄位已經是草稿上的，時間、車程、理由是最近一次 preview 回來的
  stop: RouteStop
  // 站號，含跑完的站
  number: number
  names: Record<string, string>
  // 跟這一站有關的今天的先後
  precedences: Precedence[]
  // 違反的規則
  notes?: RuleNote[]
  // 「復原」回得去（有一份不違反這幾條的草稿）
  undoable?: boolean
  expanded?: boolean
  canMoveUp?: boolean
  canMoveDown?: boolean
  dragging?: boolean
  handle?: StopHandle
  onToggle?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  // 今天的先後：「拿掉這條限制」
  onDropRule?: (note: RuleNote) => void
  // 習慣：「今天不套用這條」
  onSkipHabit?: (note: RuleNote) => void
  onUndo?: (note: RuleNote) => void
  // 展開時的編輯區（StopEditor）
  children?: ReactNode
}

/**
 * 調整清單上的一站：拖移把手、站號、客戶名、「HH:MM 到 · 停 N 分」，下面一排小標籤，右邊上移下移給不方便拖的人。
 * 點卡片就地展開編輯；違反規則時整張卡變紅框，寫是哪一條、怎麼處理。已完成的站淡色、沒有把手，不能動。
 */
export function StopCard({
  stop,
  number,
  names,
  precedences,
  notes = [],
  undoable,
  expanded,
  canMoveUp,
  canMoveDown,
  dragging,
  handle,
  onToggle,
  onMoveUp,
  onMoveDown,
  onDropRule,
  onSkipHabit,
  onUndo,
  children,
}: StopCardProps) {
  const done = stop.status === "done"
  const broken = notes.length > 0
  return (
    <article
      data-broken={broken || undefined}
      className={cn(
        "rounded-2xl border-2 bg-card shadow-lip",
        broken && "border-destructive",
        done && "opacity-60",
        dragging && "shadow-lg ring-3 ring-ring/30"
      )}
    >
      <div className="flex items-stretch gap-0.5 p-1.5">
        {done ? (
          <span className="w-9 shrink-0" />
        ) : (
          <button
            type="button"
            ref={handle?.ref}
            {...handle?.attributes}
            {...handle?.listeners}
            aria-label={`拖移 ${stop.customer_name}`}
            className="flex w-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
          >
            <GripVertical className="size-5" />
          </button>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={done ? undefined : Boolean(expanded)}
          disabled={done}
          className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg py-1.5 pr-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
              done ? "bg-primary text-primary-foreground" : "bg-input"
            )}
          >
            {done ? <Check className="size-4" strokeWidth={3} /> : number}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{stop.customer_name}</span>
            <span className="block text-xs text-muted-foreground tabular-nums">
              {done ? `${stop.planned_time} 完成` : `${stop.planned_time} 到 · 停 ${stop.duration_minutes} 分`}
            </span>
            {!done && stop.late_minutes > 0 && (
              <span className="block text-xs font-semibold text-destructive">會晚到 {stop.late_minutes} 分</span>
            )}
            {!done && <Tags stop={stop} names={names} precedences={precedences} />}
          </span>
        </button>
        {!done && (
          <div className="flex shrink-0 flex-col justify-center">
            <button
              type="button"
              aria-label={`上移 ${stop.customer_name}`}
              disabled={!canMoveUp}
              onClick={onMoveUp}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30"
            >
              <ChevronUp className="size-5" />
            </button>
            <button
              type="button"
              aria-label={`下移 ${stop.customer_name}`}
              disabled={!canMoveDown}
              onClick={onMoveDown}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30"
            >
              <ChevronDown className="size-5" />
            </button>
          </div>
        )}
      </div>
      {broken && (
        <div className="flex flex-col gap-2.5 border-t-2 border-destructive/30 px-3 py-2.5">
          {notes.map((note) => (
            <div key={note.rule.id} className="flex flex-col gap-1.5">
              <p className="text-xs leading-snug font-semibold text-destructive">違反：{note.text}</p>
              <div className="flex gap-2">
                {note.rule.source === "today" ? (
                  <Button variant="outline" className="h-10 flex-1 text-xs" onClick={() => onDropRule?.(note)}>
                    拿掉這條限制
                  </Button>
                ) : (
                  <Button variant="outline" className="h-10 flex-1 text-xs" onClick={() => onSkipHabit?.(note)}>
                    今天不套用這條
                  </Button>
                )}
                {undoable && (
                  <Button variant="outline" className="h-10 w-20 shrink-0 text-xs" onClick={() => onUndo?.(note)}>
                    <Undo2 />
                    復原
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {expanded && !done && children && <div className="border-t-2 px-3 py-3">{children}</div>}
    </article>
  )
}

type Tag = { key: string; text: string; icon?: LucideIcon; className?: string }

function Tags({ stop, names, precedences }: { stop: RouteStop; names: Record<string, string>; precedences: Precedence[] }) {
  const tags: Tag[] = []
  if (stop.window_kind && stop.window_time) {
    tags.push({ key: "window", icon: Clock, text: windowLabel(stop.window_kind, stop.window_time) })
  }
  if (stop.locked) tags.push({ key: "lock", icon: Lock, text: "鎖住" })
  for (const p of precedences) {
    if (p.after === stop.customer_id) {
      tags.push({ key: `after:${p.before}`, icon: ArrowDownUp, text: `在 ${names[p.before] ?? p.before} 之後` })
    } else if (p.before === stop.customer_id) {
      tags.push({ key: `before:${p.after}`, icon: ArrowDownUp, text: `在 ${names[p.after] ?? p.after} 之前` })
    }
  }
  if (stop.note) tags.push({ key: "note", icon: StickyNote, text: stop.note })
  if (stop.habit_ids.length > 0) tags.push({ key: "habit", icon: Repeat, text: "習慣", className: "bg-success/15 text-success" })
  tags.push({
    key: "signal",
    text: SIGNAL_LABEL[stop.signal],
    className: cn("font-semibold", TONE_CLASS[signalTone(stop.signal)]),
  })
  return (
    <span className="mt-1.5 flex flex-wrap gap-1">
      {tags.map(({ key, text, icon: Icon, className }) => (
        <span
          key={key}
          className={cn(
            "flex max-w-full items-center gap-0.5 rounded-md bg-muted px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground",
            className
          )}
        >
          {Icon && <Icon className="size-3 shrink-0" />}
          <span className="truncate">{text}</span>
        </span>
      ))}
    </span>
  )
}
```

`SyntheticListenerMap` 的路徑若 typecheck 找不到，改成 `ReturnType<typeof useSortable>["listeners"]`（`import type { useSortable } from "@dnd-kit/sortable"`）。

- [ ] **Step 6: 展開編輯**

新檔 `frontend/src/components/route/stop-editor.tsx`：

```tsx
import { useState } from "react"
import { Trash2, X } from "lucide-react"

import type { DraftStop, Precedence, WindowKind } from "@/api/route"
import { Switch } from "@/components/route/switch"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { durationHabit, windowHabit, type HabitSuggestion } from "@/lib/itinerary"
import { cn } from "@/lib/utils"

const STAYS = [20, 40, 60, 90]
const WINDOWS: { kind: WindowKind | null; label: string }[] = [
  { kind: null, label: "不限" },
  { kind: "at", label: "幾點到" },
  { kind: "before", label: "以前" },
  { kind: "after", label: "以後" },
]

type StopEditorProps = {
  stop: DraftStop
  name: string
  // 目前排出來的到達時間：選了約的時間、還沒填幾點時先用它
  arrive: string
  // 其他還沒跑的站（先後的選項）
  others: { id: string; name: string }[]
  // 跟這一站有關的今天的先後
  precedences: Precedence[]
  // ask：改完要不要問「以後也這樣排嗎？」
  onChange: (patch: Partial<DraftStop>, ask?: HabitSuggestion) => void
  onAddPrecedence: (precedence: Precedence) => void
  onRemovePrecedence: (precedence: Precedence) => void
  onRemove: () => void
}

/** 點卡片就地展開的編輯區：約的時間、停留、先後、備註、鎖住、從今天的行程拿掉 */
export function StopEditor({
  stop,
  name,
  arrive,
  others,
  precedences,
  onChange,
  onAddPrecedence,
  onRemovePrecedence,
  onRemove,
}: StopEditorProps) {
  const [custom, setCustom] = useState(STAYS.includes(stop.duration_minutes) ? "" : String(stop.duration_minutes))
  const [relation, setRelation] = useState<"after" | "before">("after")
  const [other, setOther] = useState(others[0]?.id ?? "")

  function setWindow(kind: WindowKind | null, time = stop.window_time ?? arrive) {
    if (!kind) {
      onChange({ window_kind: null, window_time: null })
      return
    }
    onChange({ window_kind: kind, window_time: time }, windowHabit(stop.customer_id, name, kind, time))
  }

  function setStay(minutes: number) {
    if (minutes === stop.duration_minutes) return
    onChange({ duration_minutes: minutes }, durationHabit(stop.customer_id, name, minutes))
  }

  function commitCustom() {
    const minutes = Number(custom)
    if (Number.isInteger(minutes) && minutes >= 5 && minutes <= 480) setStay(minutes)
  }

  function addPrecedence() {
    if (!other) return
    onAddPrecedence(relation === "after" ? { before: other, after: stop.customer_id } : { before: stop.customer_id, after: other })
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">約的時間</h3>
        <div role="radiogroup" aria-label="約的時間" className="grid grid-cols-4 gap-1 rounded-xl bg-muted p-1">
          {WINDOWS.map(({ kind, label }) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={stop.window_kind === kind}
              onClick={() => setWindow(kind)}
              className={cn("h-9 rounded-lg text-sm", stop.window_kind === kind ? "bg-card font-semibold shadow-sm" : "text-muted-foreground")}
            >
              {label}
            </button>
          ))}
        </div>
        {stop.window_kind && (
          <Input
            type="time"
            aria-label="幾點"
            value={stop.window_time ?? ""}
            onChange={(event) => event.target.value && setWindow(stop.window_kind, event.target.value)}
            className="h-11 w-36"
          />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">停留</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {STAYS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              aria-pressed={stop.duration_minutes === minutes}
              onClick={() => {
                setCustom("")
                setStay(minutes)
              }}
              className={cn(
                "h-10 rounded-xl border-2 px-3 text-sm",
                stop.duration_minutes === minutes ? "border-primary bg-primary/10 font-semibold text-primary" : "bg-card"
              )}
            >
              {minutes} 分
            </button>
          ))}
          <Input
            inputMode="numeric"
            placeholder="自己輸入"
            aria-label="停留幾分鐘"
            value={custom}
            onChange={(event) => setCustom(event.target.value.replace(/\D/g, ""))}
            onBlur={commitCustom}
            onKeyDown={(event) => event.key === "Enter" && commitCustom()}
            className="h-10 w-24"
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">先後</h3>
        {precedences.length > 0 && (
          <ul className="flex flex-col gap-1">
            {precedences.map((p) => {
              const after = p.after === stop.customer_id
              const otherName = others.find((o) => o.id === (after ? p.before : p.after))?.name ?? (after ? p.before : p.after)
              return (
                <li key={`${p.before}>${p.after}`} className="flex items-center justify-between rounded-xl bg-muted px-3 py-1.5 text-sm">
                  <span>{after ? `要在 ${otherName} 之後` : `要在 ${otherName} 之前`}</span>
                  <button
                    type="button"
                    aria-label="拿掉這條先後"
                    onClick={() => onRemovePrecedence(p)}
                    className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-card"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {others.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 text-sm">
              <span className="shrink-0">要在</span>
              <NativeSelect aria-label="哪一站" value={other} onChange={(event) => setOther(event.target.value)}>
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex gap-1.5">
              <NativeSelect
                aria-label="之前或之後"
                value={relation}
                onChange={(event) => setRelation(event.target.value as "after" | "before")}
                className="flex-1"
              >
                <option value="after">之後</option>
                <option value="before">之前</option>
              </NativeSelect>
              <Button variant="outline" className="h-11 shrink-0 px-4" onClick={addPrecedence}>
                加一條
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">備註</h3>
        <Textarea
          rows={2}
          maxLength={200}
          aria-label="備註"
          value={stop.note ?? ""}
          onChange={(event) => onChange({ note: event.target.value || null })}
        />
      </section>

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">
          鎖住
          <span className="block text-xs text-muted-foreground">排順路時位置不動</span>
        </span>
        <Switch label="鎖住" checked={stop.locked} onChange={(locked) => onChange({ locked })} />
      </div>

      <Button variant="destructive" className="h-11" onClick={onRemove}>
        <Trash2 />
        從今天的行程拿掉
      </Button>
    </div>
  )
}
```

- [ ] **Step 7: 要不要記成習慣**

新檔 `frontend/src/components/route/habit-prompt.tsx`：

```tsx
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { WEEKDAY_LABEL } from "@/lib/itinerary"
import { cn } from "@/lib/utils"

export type HabitChoice = "today" | "weekday" | "always"

/**
 * 拖完、改完從下面滑出來問「以後也這樣排嗎？」，預設「只有今天」。
 * 星期幾是今天（系統日期）是星期幾。答應的習慣先放在草稿裡，按「完成」才跟行程一起存。
 */
export function HabitPrompt({ text, weekday, onDone }: { text: string; weekday: number; onDone: (choice: HabitChoice) => void }) {
  const [choice, setChoice] = useState<HabitChoice>("today")
  const options: [HabitChoice, string][] = [
    ["today", "只有今天"],
    ["weekday", `每個星期${WEEKDAY_LABEL[weekday]}都這樣`],
    ["always", "每次都這樣"],
  ]
  return (
    <div
      role="dialog"
      aria-label="以後也這樣排嗎？"
      className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-md animate-in px-2.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] duration-200 slide-in-from-bottom-4 motion-reduce:animate-none"
    >
      <div className="rounded-2xl border-2 bg-card p-4 shadow-lip">
        <p className="text-xs font-semibold text-muted-foreground">以後也這樣排嗎？</p>
        <p className="mt-1 text-base leading-snug font-semibold">{text}</p>
        <div role="radiogroup" aria-label="要不要記成習慣" className="mt-3 flex flex-col gap-1.5">
          {options.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={choice === value}
              onClick={() => setChoice(value)}
              className={cn(
                "flex h-11 items-center gap-2.5 rounded-xl border-2 px-3 text-left text-sm",
                choice === value ? "border-primary bg-primary/10 font-semibold text-primary" : "bg-card"
              )}
            >
              <span className={cn("size-4 shrink-0 rounded-full border-2", choice === value ? "border-[5px] border-primary" : "border-input")} />
              {label}
            </button>
          ))}
        </div>
        <Button className="mt-3 h-11 w-full" onClick={() => onDone(choice)}>
          好
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 8: 跑測試、型別、lint**

Run: `cd frontend && npx vitest run && npm run typecheck && npm run lint`
Expected: 全部通過。

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/route frontend/src/lib/route-path.ts frontend/src/components/route-path.tsx
git commit -m "$(cat <<'EOF'
Add the edit-list stop card, its editor and the keep-as-habit prompt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 8: 調整行程（清單）頁與首頁的「調整」

**Files:**
- Create: `frontend/src/pages/route-edit.tsx`
- Create: `frontend/src/components/route/home-extras.tsx`、`frontend/src/components/route/drive-source.tsx`
- Modify: `frontend/src/pages/today.tsx`（一行 import、橫幅加 `<EditRouteLink />`、提示區加 `<SkippedHabitsNote />`）
- Modify: `frontend/src/components/route-path.tsx`（會晚到的紅字）、`frontend/src/components/route-path.test.ts`
- Modify: `frontend/src/App.tsx`（一行 import、一個路由）

**Interfaces:**
- Consumes: Task 6 的 `previewToday`、`saveToday`、`getTodayRoute`、`lib/itinerary.ts`、`routeDraft`；Task 7 的 `StopCard`、`StopEditor`、`HabitPrompt`。
- Produces: 路由 `/route/edit`（`RouteEditPage`）；`EditRouteLink()`、`SkippedHabitsNote({ route })`。Task 9 的加一站頁靠 `routeDraft` 把草稿帶回這一頁；習慣頁從這一頁進去時帶 `state={{ from: "/route/edit" }}`。

- [ ] **Step 1: 寫失敗的測試**

`frontend/src/components/route-path.test.ts` 的 `describe("RoutePath", ...)` 裡加：

```ts
  it("有約的時間又趕不上，標籤第二行改成紅字會晚到幾分", () => {
    const html = render([stop("a", "next", { window_kind: "before", window_time: "10:00", late_minutes: 25 }), stop("b", "todo")])
    expect(html).toContain("會晚到 25 分")
    expect(html.match(/會晚到/g)).toHaveLength(1)
  })
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `cd frontend && npx vitest run src/components/route-path.test.ts`
Expected: FAIL（找不到「會晚到 25 分」）。

- [ ] **Step 3: 首頁路線的會晚到**

`frontend/src/components/route-path.tsx` 的 `StopLabel` 裡，第二行的

```tsx
        {done ? (
          `${stop.planned_time} 完成${stop.visit_id ? " · 已回寫" : ""}`
        ) : (
          <>
            {stop.planned_time} · <SignalLabel signal={stop.signal} />
          </>
        )}
```

換成

```tsx
        {done ? (
          `${stop.planned_time} 完成${stop.visit_id ? " · 已回寫" : ""}`
        ) : stop.window_kind && stop.late_minutes > 0 ? (
          // 有約的時間又趕不上：時間與理由讓位給這一句
          <span className="font-semibold text-destructive">會晚到 {stop.late_minutes} 分</span>
        ) : (
          <>
            {stop.planned_time} · <SignalLabel signal={stop.signal} />
          </>
        )}
```

- [ ] **Step 4: 首頁的「調整」與沒套用的習慣**

新檔 `frontend/src/components/route/home-extras.tsx`：

```tsx
import { Pencil } from "lucide-react"
import { Link } from "react-router"

import type { TodayRoute } from "@/api/route"

/** 首頁橫幅上的「調整」：切成清單拖移、展開編輯，按「完成」一次存起來（pages/route-edit.tsx） */
export function EditRouteLink() {
  return (
    <Link
      to="/route/edit"
      className="flex w-16 shrink-0 flex-col items-center justify-center gap-0.5 border-l-2 border-black/15 text-[0.6875rem] font-semibold active:bg-black/10"
    >
      <Pencil className="size-5" />
      調整
    </Link>
  )
}

/** 每天建立建議時跟別的規則衝突、今天沒套用的習慣，行程上提示原因。手機上存的舊行程沒有這個欄位 */
export function SkippedHabitsNote({ route }: { route: TodayRoute }) {
  const skipped = (route.skipped_habits ?? []).filter((habit) => habit.conflict)
  if (skipped.length === 0) return null
  return (
    <ul className="mb-3 flex flex-col gap-1 rounded-xl bg-muted px-3 py-2">
      {skipped.map((habit) => (
        <li key={habit.id} className="text-xs leading-relaxed text-muted-foreground">
          今天沒套用『{habit.text}』，因為{habit.reason}
        </li>
      ))}
    </ul>
  )
}
```

`frontend/src/pages/today.tsx`：

1. import 區在 `import { RoutePath } from "@/components/route-path"` 下面加一行：
   ```tsx
   import { EditRouteLink, SkippedHabitsNote } from "@/components/route/home-extras"
   ```
2. 橫幅裡 `<Link to="/methods" ...>` 的**前面**加（連不上、用的是手機上的舊行程時不給改）：
   ```tsx
          {state.status === "ready" && !state.cached && <EditRouteLink />}
   ```
3. `{hint && <p ...>{hint}</p>}` 那一行下面加：
   ```tsx
        {route && <SkippedHabitsNote route={route} />}
   ```

- [ ] **Step 5: 車程的出處**

接上 Google 之後（另一條線），沒有 Google 地圖的畫面上顯示 Google 算的車程與里程，要照 Google 的使用條款標「Google Maps」（不翻譯）；直線估算的照舊寫「估計」。新檔 `frontend/src/components/route/drive-source.tsx`：

```tsx
/** 車程從哪裡來：Google 算的標「Google Maps」（Google 的使用條款，不翻譯），直線估算的寫「（估計）」 */
export function DriveSource({ estimated }: { estimated: boolean }) {
  return estimated ? <span>（估計）</span> : <span className="font-[Roboto,sans-serif]"> · Google Maps</span>
}
```

- [ ] **Step 6: 調整行程頁**

新檔 `frontend/src/pages/route-edit.tsx`：

```tsx
import { useEffect, useState, type ReactNode } from "react"
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Loader2, Plus, Repeat } from "lucide-react"
import { Link, useNavigate } from "react-router"

import { ApiError } from "@/api/client"
import { getTodayRoute, previewToday, saveToday, type DraftStop, type Precedence, type RouteDraft } from "@/api/route"
import { Mascot } from "@/components/mascot"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { DriveSource } from "@/components/route/drive-source"
import { HabitPrompt, type HabitChoice } from "@/components/route/habit-prompt"
import { StopCard, type StopHandle } from "@/components/route/stop-card"
import { StopEditor } from "@/components/route/stop-editor"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAuth } from "@/lib/auth"
import {
  brokenRules,
  dragHabit,
  draftRules,
  formatMinutes,
  moveItem,
  ruleNotes,
  samePrecedence,
  shownStops,
  undoTarget,
  weekdayOf,
  withoutStop,
  type HabitSuggestion,
  type RuleNote,
} from "@/lib/itinerary"
import { routeDraft, useRouteDraft } from "@/lib/route-draft"
import { cn } from "@/lib/utils"

type Prompt = HabitSuggestion & { id: number }

// 每一張「以後也這樣排嗎？」的編號：換一句就換一張，選項回到「只有今天」
let promptCount = 0

/**
 * 調整行程（清單）：首頁橫幅按「調整」進來（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈調整行程（清單）〉）。
 * 每站一張卡，拖移把手或上移下移換順序，點卡片展開編輯約的時間、停留、先後、備註、鎖住、拿掉。
 * 改動先留在畫面上（lib/route-draft.ts），每次改完停 300ms 用 preview 算時間與車程（不存）；違反規則在手機上
 * 即時判斷（lib/itinerary.ts，跟後端同一套）。按「完成」用 PUT 一次存進去，按「取消」全部丟掉。
 */
export function RouteEditPage() {
  const navigate = useNavigate()
  const userId = useAuth()?.user.id ?? null
  const edit = useRouteDraft()
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [hint, setHint] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // 從首頁進來時讀最新的行程；從加一站、習慣頁回來時草稿還在，接著改
  useEffect(() => {
    if (!userId || routeDraft.get()) return
    const controller = new AbortController()
    getTodayRoute(userId, controller.signal)
      .then(({ route, cached }) => {
        if (cached) setLoadError("連不上伺服器，現在不能調整行程。")
        else routeDraft.start(route)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(error instanceof ApiError ? error.message : "連不上伺服器，今天的行程沒有載入。")
      })
    return () => controller.abort()
  }, [userId, attempt])

  // 每次改動停 300ms 再算時間、車程與違反的規則；算好之前畫面先用上一次的時間。
  // 還沒改過就不算：畫面用進來時讀到的那一份（正式的車程），preview 一律是直線估算
  const draft = edit?.draft
  const changed = Boolean(edit && edit.history.length > 0)
  useEffect(() => {
    if (!draft || !changed) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      previewToday(draft, undefined, controller.signal)
        .then((view) => routeDraft.showView(view, draft))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setHint(error instanceof ApiError ? error.message : "連不上伺服器，時間先不更新。")
        })
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [draft, changed])

  function cancel() {
    routeDraft.clear()
    navigate("/")
  }

  const cancelButton = (
    <button
      type="button"
      onClick={cancel}
      className="flex h-11 shrink-0 items-center rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-muted"
    >
      取消
    </button>
  )

  if (!userId) return null

  if (!edit) {
    return (
      <div className="flex min-h-svh flex-col">
        <PageHeader title="調整行程" leading={cancelButton} />
        <main className="px-4 pt-10">
          {loadError ? (
            <Notice
              text={loadError}
              action={{
                label: "重新載入",
                onClick: () => {
                  setLoadError(null)
                  setAttempt((n) => n + 1)
                },
              }}
              secondary={{ label: "回今日路線", onClick: cancel }}
            />
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Mascot state="wait" size={96} />
              <p className="text-sm text-muted-foreground">載入今天的行程…</p>
            </div>
          )}
        </main>
      </div>
    )
  }

  const { base, view, history, moved } = edit
  const current = edit.draft
  const names: Record<string, string> = Object.fromEntries(
    [...base.stops, ...view.stops].map((stop) => [stop.customer_id, stop.customer_name])
  )
  const finished = view.stops.filter((stop) => stop.status === "done")
  const open = shownStops(current, view, base)
  const order = current.stops.map((stop) => stop.customer_id)
  const broken = brokenRules(order, draftRules(current, view.rules, names))
  const notes = ruleNotes(order, broken, names, moved)
  const weekday = weekdayOf(base.date)
  const conflicts = view.skipped_habits.filter((habit) => habit.conflict)
  const undoable = (ids: string[]) => undoTarget(history, ids, view.rules, names) !== null
  const related = (id: string) => current.precedences.filter((p) => p.before === id || p.after === id)

  function change(next: RouteDraft, movedId: string | null = null) {
    routeDraft.change(next, movedId)
    // 又改了別的：上一張「以後也這樣排嗎？」當作只有今天
    setPrompt(null)
  }

  function ask(suggestion: HabitSuggestion) {
    promptCount += 1
    setPrompt({ ...suggestion, id: promptCount })
  }

  function move(from: number, to: number) {
    if (from < 0 || to < 0 || to >= order.length || from === to) return
    const next = { ...current, stops: moveItem(current.stops, from, to) }
    change(next, order[from])
    // 拖完的順序新違反了規則就不問要不要記成習慣，改走紅框
    const before = new Set(broken.map((rule) => rule.id))
    const after = brokenRules(next.stops.map((stop) => stop.customer_id), draftRules(next, view.rules, names))
    if (after.some((rule) => !before.has(rule.id))) return
    const suggestion = dragHabit(order, from, to, names)
    if (suggestion) ask(suggestion)
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    move(order.indexOf(String(active.id)), order.indexOf(String(over.id)))
  }

  function patch(customerId: string, values: Partial<DraftStop>, suggestion?: HabitSuggestion) {
    change({ ...current, stops: current.stops.map((stop) => (stop.customer_id === customerId ? { ...stop, ...values } : stop)) })
    if (suggestion) ask(suggestion)
  }

  function addPrecedence(precedence: Precedence) {
    if (precedence.before === precedence.after || current.precedences.some((p) => samePrecedence(p, precedence))) return
    change({ ...current, precedences: [...current.precedences, precedence] })
  }

  function removePrecedence(precedence: Precedence) {
    change({ ...current, precedences: current.precedences.filter((p) => !samePrecedence(p, precedence)) })
  }

  function removeStop(customerId: string) {
    setExpanded(null)
    change(withoutStop(current, customerId))
  }

  // 紅框上的「今天不套用這條」：存著的習慣記進今天不套用；這次才答應的照樣記下來，只是今天不套用
  function skipHabit(note: RuleNote) {
    const [kind, key] = note.rule.id.split(":")
    if (kind === "habit") change({ ...current, skipped_habit_ids: [...current.skipped_habit_ids, Number(key)] })
    if (kind === "new") {
      change({ ...current, habits: current.habits.map((habit, i) => (i === Number(key) ? { ...habit, skip_today: true } : habit)) })
    }
  }

  function undo(ruleIds: string[]) {
    const index = undoTarget(history, ruleIds, view.rules, names)
    if (index === null) return
    routeDraft.revert(index)
    setPrompt(null)
  }

  function answer(choice: HabitChoice) {
    if (prompt && choice !== "today") {
      const habit = { ...prompt.habit, weekday: choice === "weekday" ? weekday : null }
      routeDraft.change({ ...current, habits: [...current.habits, habit] }, moved)
    }
    setPrompt(null)
  }

  async function save() {
    if (!userId || !edit) return
    setConfirming(false)
    setSaving(true)
    try {
      await saveToday(userId, base.version, current)
      routeDraft.clear()
      navigate("/", { replace: true })
    } catch (error) {
      setSaving(false)
      if (error instanceof ApiError && error.status === 409) {
        // 行程剛被改過：剛才的改動不保留，載入最新的
        routeDraft.clear()
        setPrompt(null)
        setExpanded(null)
        setHint(error.message)
        setAttempt((n) => n + 1)
        return
      }
      setHint(error instanceof ApiError ? error.message : "連不上伺服器，這次沒有存到，請再試一次。")
    }
  }

  // 還有規則沒處理：「完成」按得下去，但先問一次要不要復原
  function finish() {
    if (broken.length > 0) setConfirming(true)
    else void save()
  }

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title="調整行程"
        leading={cancelButton}
        trailing={
          <div className="flex shrink-0 items-center gap-0.5 pr-2">
            <Link
              to="/route/habits"
              state={{ from: "/route/edit" }}
              className="flex h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted"
            >
              <Repeat className="size-4" />
              習慣
            </Link>
            <Button className="h-10 px-4" disabled={saving} onClick={finish}>
              {saving && <Loader2 className="animate-spin" />}
              完成
            </Button>
          </div>
        }
      />
      <main className="flex flex-1 flex-col px-4 pt-3 pb-10">
        <p className="text-xs text-muted-foreground tabular-nums">
          共 {view.travel_km} 公里 · 車程 {formatMinutes(view.travel_minutes)}
          {view.finish_time && ` · 約 ${view.finish_time} 收工`}
          <DriveSource estimated={view.estimated} />
        </p>
        {hint && <p className="mt-2 rounded-xl bg-primary/10 px-3 py-2 text-xs text-primary">{hint}</p>}
        {conflicts.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 rounded-xl bg-muted px-3 py-2">
            {conflicts.map((habit) => (
              <li key={habit.id} className="text-xs leading-relaxed text-muted-foreground">
                今天沒套用『{habit.text}』，因為{habit.reason}
              </li>
            ))}
          </ul>
        )}

        {finished.length > 0 && (
          <ol aria-label="已完成的站" className="mt-3 flex flex-col gap-2">
            {finished.map((stop, index) => (
              <li key={stop.customer_id}>
                <StopCard stop={stop} number={index + 1} names={names} precedences={[]} />
              </li>
            ))}
          </ol>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <ol aria-label="還沒跑的站" className="flex flex-col">
              {open.map((stop, index) => {
                const draftStop = current.stops.find((s) => s.customer_id === stop.customer_id)!
                const cardNotes = notes.get(stop.customer_id) ?? []
                return (
                  <Sortable key={stop.customer_id} id={stop.customer_id}>
                    {(handle, dragging) => (
                      <>
                        {stop.travel_minutes !== null && (
                          <p className="py-1.5 pl-11 text-xs text-muted-foreground tabular-nums">
                            車程 {stop.travel_minutes} 分 · {stop.travel_km} 公里
                          </p>
                        )}
                        <StopCard
                          stop={stop}
                          number={finished.length + index + 1}
                          names={names}
                          precedences={related(stop.customer_id)}
                          notes={cardNotes}
                          undoable={cardNotes.length > 0 && undoable(cardNotes.map((note) => note.rule.id))}
                          expanded={expanded === stop.customer_id}
                          canMoveUp={index > 0}
                          canMoveDown={index < open.length - 1}
                          dragging={dragging}
                          handle={handle}
                          onToggle={() => setExpanded(expanded === stop.customer_id ? null : stop.customer_id)}
                          onMoveUp={() => move(index, index - 1)}
                          onMoveDown={() => move(index, index + 1)}
                          onDropRule={(note) => removePrecedence({ before: note.rule.customer_ids[0], after: note.rule.customer_ids[1] })}
                          onSkipHabit={skipHabit}
                          onUndo={(note) => undo([note.rule.id])}
                        >
                          <StopEditor
                            stop={draftStop}
                            name={stop.customer_name}
                            arrive={stop.planned_time}
                            others={open
                              .filter((o) => o.customer_id !== stop.customer_id)
                              .map((o) => ({ id: o.customer_id, name: o.customer_name }))}
                            precedences={related(stop.customer_id)}
                            onChange={(values, suggestion) => patch(stop.customer_id, values, suggestion)}
                            onAddPrecedence={addPrecedence}
                            onRemovePrecedence={removePrecedence}
                            onRemove={() => removeStop(stop.customer_id)}
                          />
                        </StopCard>
                      </>
                    )}
                  </Sortable>
                )
              })}
            </ol>
          </SortableContext>
        </DndContext>
        {open.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">今天還沒有要跑的站。</p>}

        <Link to="/route/edit/add" className={cn(buttonVariants({ variant: "outline" }), "mt-4 h-12 text-sm")}>
          <Plus />
          加一站
        </Link>
      </main>

      {prompt && <HabitPrompt key={prompt.id} text={prompt.text} weekday={weekday} onDone={answer} />}

      {confirming && (
        <Dialog open onOpenChange={(visible) => !visible && setConfirming(false)}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>還有 {broken.length} 條規則沒處理，要復原嗎？</DialogTitle>
              <DialogDescription>照這樣存的話，違反的習慣今天不套用，違反的先後會拿掉。</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              {undoable(broken.map((rule) => rule.id)) && (
                <Button
                  variant="outline"
                  className="h-11"
                  onClick={() => {
                    setConfirming(false)
                    undo(broken.map((rule) => rule.id))
                  }}
                >
                  復原
                </Button>
              )}
              <Button className="h-11" onClick={() => void save()}>
                照這樣存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

/** 一張可以拖的卡：dnd-kit 的 useSortable 給位移與把手 */
function Sortable({ id, children }: { id: string; children: (handle: StopHandle, dragging: boolean) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative", isDragging && "z-10")}
    >
      {children({ ref: setActivatorNodeRef, attributes, listeners }, isDragging)}
    </li>
  )
}
```

- [ ] **Step 7: 路由**

`frontend/src/App.tsx`：

1. `import { RecordVisit } from "@/pages/record-visit"` 下面加：
   ```tsx
   import { RouteEditPage } from "@/pages/route-edit"
   ```
2. `<Route path="/customers" element={<CustomerPicker />} />` 下面加：
   ```tsx
            {/* 調整今天的行程（清單）：只有業務有自己的行程，主管打開會看到後端的說明 */}
            <Route path="/route/edit" element={<RouteEditPage />} />
   ```

- [ ] **Step 8: 檢查**

Run: `cd frontend && npx vitest run && npm run typecheck && npm run lint && npm run build`
Expected: 全部通過。`react-hooks` 的規則若對「在 render 期間改 module 變數」報錯，`promptCount` 只在事件處理函式裡改，不在 render 裡，應該不會；真的報錯就改成 `useRef`。

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/route-edit.tsx frontend/src/components/route/drive-source.tsx frontend/src/components/route/home-extras.tsx frontend/src/pages/today.tsx frontend/src/components/route-path.tsx frontend/src/components/route-path.test.ts frontend/src/App.tsx
git commit -m "$(cat <<'EOF'
Edit today's itinerary as a list: drag, expand, rule warnings and keep-as-habit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: 加一站、我的排序習慣、帳號設定的入口

**Files:**
- Create: `frontend/src/pages/route-add.tsx`
- Create: `frontend/src/pages/route-habits.tsx`
- Modify: `frontend/src/pages/settings.tsx`（「新人第一週」那一塊下面加一個入口）
- Modify: `frontend/src/App.tsx`（兩行 import、兩個路由）

**Interfaces:**
- Consumes: Task 6 的 `getCandidates`、`previewToday`、`draftAfterInsert`、`routeDraft`、`api/route-habits.ts`、`WEEKDAY_LABEL`、`CUSTOMER_TYPE_LABEL`（`api/customers.ts`）；Task 7 的 `Switch`、`TONE_CLASS`。
- Produces: 路由 `/route/edit/add`（`RouteAddPage`）、`/route/habits`（`RouteHabitsPage`）。

- [ ] **Step 1: 加一站**

新檔 `frontend/src/pages/route-add.tsx`：

```tsx
import { useEffect, useState } from "react"
import { Loader2, Plus, Search } from "lucide-react"
import { useNavigate } from "react-router"

import { ApiError } from "@/api/client"
import { CUSTOMER_TYPE_LABEL } from "@/api/customers"
import { getCandidates, previewToday, SIGNAL_LABEL, type RouteCandidate, type RouteCandidates } from "@/api/route"
import { Mascot } from "@/components/mascot"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { draftAfterInsert } from "@/lib/itinerary"
import { routeDraft, useRouteDraft } from "@/lib/route-draft"
import { signalTone, TONE_CLASS } from "@/lib/route-path"
import { cn } from "@/lib/utils"

/**
 * 加一站（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈加一站〉）：只有自己的客戶，
 * 已在調整中的行程裡的不列。順路的照估算的多繞分鐘數排前 5 家，其他照名稱。點「＋」插在多繞最少的位置，回到清單；
 * 加進去的那一站跟其他改動一樣，按「完成」才存。
 */
export function RouteAddPage() {
  const navigate = useNavigate()
  const edit = useRouteDraft()
  const [list, setList] = useState<RouteCandidates | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [adding, setAdding] = useState<string | null>(null)
  const missing = !edit

  // 直接打開這一頁（重新整理、書籤）時沒有調整中的草稿：回清單從頭來
  useEffect(() => {
    if (missing) navigate("/route/edit", { replace: true })
  }, [missing, navigate])

  useEffect(() => {
    const current = routeDraft.get()
    if (!current) return
    const controller = new AbortController()
    const stops = current.draft.stops
    getCandidates(
      stops.map((stop) => stop.customer_id),
      stops.filter((stop) => stop.locked).map((stop) => stop.customer_id),
      controller.signal
    )
      .then(setList)
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof ApiError ? reason.message : "連不上伺服器，候選的客戶沒有載入。")
      })
    return () => controller.abort()
  }, [])

  async function add(customerId: string) {
    const current = routeDraft.get()
    if (!current) return
    setAdding(customerId)
    setError(null)
    try {
      const view = await previewToday(current.draft, customerId)
      const next = draftAfterInsert(current.draft, view)
      routeDraft.change(next)
      routeDraft.showView(view, next)
      navigate("/route/edit")
    } catch (reason) {
      setAdding(null)
      setError(reason instanceof ApiError ? reason.message : "連不上伺服器，這次沒有加進去，請再試一次。")
    }
  }

  const keyword = query.trim()
  const matches = (candidate: RouteCandidate) => !keyword || candidate.customer_name.includes(keyword)
  const nearby = list?.nearby.filter(matches) ?? []
  const others = list?.others.filter(matches) ?? []
  const locked = Boolean(list?.full) || adding !== null

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader title="加一站" backTo="/route/edit" />
      <main className="flex flex-1 flex-col gap-4 px-4 pt-3 pb-10">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋客戶"
            aria-label="搜尋客戶"
            className="h-11 pl-9"
          />
        </div>
        {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
        {list?.full && (
          <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">今天已經排了 8 站，要先刪掉一站</p>
        )}
        {!list && !error && (
          <div className="flex flex-col items-center gap-2 py-8">
            <Mascot state="wait" size={80} />
            <p className="text-sm text-muted-foreground">找順路的客戶…</p>
          </div>
        )}
        {nearby.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">順路的</h2>
            <ul className="flex flex-col gap-2">
              {nearby.map((candidate) => (
                <CandidateRow
                  key={candidate.customer_id}
                  candidate={candidate}
                  disabled={locked}
                  busy={adding === candidate.customer_id}
                  onAdd={() => void add(candidate.customer_id)}
                />
              ))}
            </ul>
          </section>
        )}
        {others.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">其他客戶</h2>
            <ul className="flex flex-col gap-2">
              {others.map((candidate) => (
                <CandidateRow
                  key={candidate.customer_id}
                  candidate={candidate}
                  disabled={locked}
                  busy={adding === candidate.customer_id}
                  onAdd={() => void add(candidate.customer_id)}
                />
              ))}
            </ul>
          </section>
        )}
        {list && keyword && nearby.length + others.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">找不到「{keyword}」。</p>
        )}
      </main>
    </div>
  )
}

function CandidateRow({
  candidate,
  disabled,
  busy,
  onAdd,
}: {
  candidate: RouteCandidate
  disabled: boolean
  busy: boolean
  onAdd: () => void
}) {
  const place = candidate.after_stop === 0 ? "排第一站" : `插在第 ${candidate.after_stop} 站後`
  return (
    <li className="flex items-center gap-3 rounded-2xl border-2 bg-card py-2.5 pr-2.5 pl-3.5 shadow-lip">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{candidate.customer_name}</p>
        {candidate.after_stop !== null ? (
          <p className="text-xs text-muted-foreground">
            {place} · 多約 {candidate.extra_minutes} 分鐘
            {candidate.signal && (
              <>
                {" · "}
                <span className={cn("font-semibold", TONE_CLASS[signalTone(candidate.signal)])}>{SIGNAL_LABEL[candidate.signal]}</span>
              </>
            )}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {CUSTOMER_TYPE_LABEL[candidate.type]} · {candidate.area}
          </p>
        )}
      </div>
      <Button
        variant="outline"
        className="size-11 shrink-0 p-0"
        aria-label={`加進今天的行程：${candidate.customer_name}`}
        disabled={disabled}
        onClick={onAdd}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Plus className="size-5" />}
      </Button>
    </li>
  )
}
```

- [ ] **Step 2: 我的排序習慣**

新檔 `frontend/src/pages/route-habits.tsx`：

```tsx
import { useEffect, useState, type ReactNode } from "react"
import { Ellipsis, Plus, Trash2 } from "lucide-react"
import { useLocation } from "react-router"

import { ApiError } from "@/api/client"
import type { HabitDraft, HabitKind, HabitTarget, WindowKind } from "@/api/route"
import { createHabit, deleteHabit, listHabits, setHabitActive, type HabitList, type HabitOption, type RouteHabit } from "@/api/route-habits"
import { Mascot } from "@/components/mascot"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Switch } from "@/components/route/switch"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { WEEKDAY_LABEL } from "@/lib/itinerary"
import { cn } from "@/lib/utils"

const SOURCE_LABEL: Record<RouteHabit["source"], string> = {
  ai: "在首頁跟熊熊滾說的",
  prompt: "拖完答應的",
  manual: "自己新增的",
}
// 新增或改了習慣不回頭改今天已存的行程
const APPLY_HINT = "今天的行程要套用的話，回去按『幫我排順一點』"

/**
 * 我的排序習慣（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈我的排序習慣〉）：
 * 從調整行程的頁首與帳號設定進來。分「今天（星期三）套用中」與「其他日子」兩組，每條可以停用、刪除；
 * 最下面自己新增一條。
 */
export function RouteHabitsPage() {
  const location = useLocation()
  const back = (location.state as { from?: string } | null)?.from ?? "/settings"
  const [data, setData] = useState<HabitList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<RouteHabit | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listHabits(controller.signal)
      .then((found) => {
        setData(found)
        setError(null)
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof ApiError ? reason.message : "連不上伺服器，排序習慣沒有載入。")
      })
    return () => controller.abort()
  }, [attempt])

  function replace(habit: RouteHabit) {
    setData((found) => found && { ...found, habits: found.habits.map((h) => (h.id === habit.id ? habit : h)) })
  }

  async function toggle(habit: RouteHabit, active: boolean) {
    try {
      replace(await setHabitActive(habit.id, active))
      setHint(APPLY_HINT)
    } catch (reason) {
      setHint(reason instanceof ApiError ? reason.message : "連不上伺服器，這次沒有改到。")
    }
  }

  async function remove(habit: RouteHabit) {
    try {
      await deleteHabit(habit.id)
      setData((found) => found && { ...found, habits: found.habits.filter((h) => h.id !== habit.id) })
      setHint(APPLY_HINT)
    } catch (reason) {
      setHint(reason instanceof ApiError ? reason.message : "連不上伺服器，這次沒有刪掉。")
    } finally {
      setDeleting(null)
    }
  }

  async function add(habit: HabitDraft) {
    const made = await createHabit(habit)
    setData((found) => found && { ...found, habits: [...found.habits, made] })
    setHint(APPLY_HINT)
  }

  const today = data ? data.habits.filter((h) => h.weekday === null || h.weekday === data.weekday) : []
  const others = data ? data.habits.filter((h) => h.weekday !== null && h.weekday !== data.weekday) : []

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader title="我的排序習慣" backTo={back} />
      <main className="flex flex-1 flex-col gap-5 px-4 pt-4 pb-10">
        {error && (
          <Notice text={error} action={{ label: "重新載入", onClick: () => setAttempt((n) => n + 1) }} />
        )}
        {!data && !error && (
          <div className="flex flex-col items-center gap-2 py-10">
            <Mascot state="wait" size={96} />
            <p className="text-sm text-muted-foreground">載入排序習慣…</p>
          </div>
        )}
        {hint && <p className="rounded-xl bg-primary/10 px-3 py-2 text-xs text-primary">{hint}</p>}
        {data && (
          <>
            <Group title={`今天（星期${WEEKDAY_LABEL[data.weekday]}）套用中`} empty="今天沒有要套用的習慣。">
              {today.map((habit) => (
                <HabitRow key={habit.id} habit={habit} onToggle={(active) => void toggle(habit, active)} onDelete={() => setDeleting(habit)} />
              ))}
            </Group>
            <Group title="其他日子" empty="沒有只在其他日子套用的習慣。">
              {others.map((habit) => (
                <HabitRow key={habit.id} habit={habit} onToggle={(active) => void toggle(habit, active)} onDelete={() => setDeleting(habit)} />
              ))}
            </Group>
            <HabitForm targets={data.targets} onCreate={add} />
          </>
        )}
      </main>

      {deleting && (
        <Dialog open onOpenChange={(open) => !open && setDeleting(null)}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>刪除這條習慣？</DialogTitle>
              <DialogDescription>「{deleting.text}」刪掉之後不能復原；只想暫時不用的話，關掉開關就好。</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" className="h-11" onClick={() => setDeleting(null)}>
                取消
              </Button>
              <Button variant="destructive" className="h-11" onClick={() => void remove(deleting)}>
                刪除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function Group({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children.length > 0 ? (
        <ul className="flex flex-col gap-2">{children}</ul>
      ) : (
        <p className="rounded-xl bg-muted px-3 py-3 text-xs text-muted-foreground">{empty}</p>
      )}
    </section>
  )
}

function HabitRow({ habit, onToggle, onDelete }: { habit: RouteHabit; onToggle: (active: boolean) => void; onDelete: () => void }) {
  const [menu, setMenu] = useState(false)
  const when = habit.weekday === null ? "每天" : `每個星期${WEEKDAY_LABEL[habit.weekday]}`
  return (
    <li className="relative rounded-2xl border-2 bg-card py-3 pr-1.5 pl-4 shadow-lip">
      <div className="flex items-start gap-1">
        <p className={cn("min-w-0 flex-1 pt-2 text-base leading-snug font-semibold", !habit.active && "text-muted-foreground")}>
          {habit.text}
        </p>
        <button
          type="button"
          aria-label="更多"
          aria-expanded={menu}
          onClick={() => setMenu((open) => !open)}
          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
        >
          <Ellipsis className="size-5" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            {when} · {SOURCE_LABEL[habit.source]}
          </p>
          {habit.today === "skipped" && habit.skip_reason && (
            <p className="mt-0.5 text-xs text-muted-foreground">今天沒套用：{habit.skip_reason}</p>
          )}
        </div>
        <Switch label={`啟用「${habit.text}」`} checked={habit.active} onChange={onToggle} />
      </div>
      {menu && (
        <div className="absolute top-12 right-2 z-10 rounded-xl border-2 bg-card p-1 shadow-lip">
          <button
            type="button"
            onClick={() => {
              setMenu(false)
              onDelete()
            }}
            className="flex h-11 items-center gap-2 rounded-lg px-3 text-sm text-destructive hover:bg-muted"
          >
            <Trash2 className="size-4" />
            刪除
          </button>
        </div>
      )}
    </li>
  )
}

const KINDS: [HabitKind, string][] = [
  ["precedence", "先後（誰排在誰前面）"],
  ["first", "先跑"],
  ["last", "排最後"],
  ["window", "約的時間"],
  ["duration", "停留多久"],
]
const BYS: [HabitTarget["by"], string][] = [
  ["customer", "客戶"],
  ["chain", "連鎖體系"],
  ["type", "客戶類型"],
  ["area", "地區"],
]
const WINDOW_KINDS: [WindowKind, string][] = [
  ["at", "幾點到"],
  ["before", "以前"],
  ["after", "以後"],
]

function HabitForm({ targets, onCreate }: { targets: Record<HabitTarget["by"], HabitOption[]>; onCreate: (habit: HabitDraft) => Promise<void> }) {
  const first = (by: HabitTarget["by"]) => targets[by][0]?.value ?? ""
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<HabitKind>("first")
  const [subject, setSubject] = useState<HabitTarget>({ by: "customer", value: first("customer") })
  const [object, setObject] = useState<HabitTarget>({ by: "type", value: first("type") })
  const [weekday, setWeekday] = useState("")
  const [windowKind, setWindowKind] = useState<WindowKind>("before")
  const [time, setTime] = useState("11:00")
  const [minutes, setMinutes] = useState("60")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <Button variant="outline" className="h-12 w-full text-sm" onClick={() => setOpen(true)}>
        <Plus />
        新增一條習慣
      </Button>
    )
  }

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await onCreate({
        kind,
        subject,
        object: kind === "precedence" ? object : null,
        window_kind: kind === "window" ? windowKind : null,
        window_time: kind === "window" ? time : null,
        duration_minutes: kind === "duration" ? Number(minutes) : null,
        weekday: weekday === "" ? null : Number(weekday),
      })
      setOpen(false)
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "連不上伺服器，這次沒有新增。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border-2 bg-card p-4 shadow-lip">
      <h2 className="text-sm font-semibold">新增一條習慣</h2>
      <Field label="種類">
        <NativeSelect value={kind} onChange={(event) => setKind(event.target.value as HabitKind)}>
          {KINDS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <TargetPicker label={kind === "precedence" ? "誰排前面" : "對象"} target={subject} targets={targets} onChange={setSubject} />
      {kind === "precedence" && <TargetPicker label="排在誰前面" target={object} targets={targets} onChange={setObject} />}
      {kind === "window" && (
        <Field label="約的時間">
          <div className="flex gap-2">
            <NativeSelect value={windowKind} onChange={(event) => setWindowKind(event.target.value as WindowKind)} className="flex-1">
              {WINDOW_KINDS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
            <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="h-11 w-32" aria-label="幾點" />
          </div>
        </Field>
      )}
      {kind === "duration" && (
        <Field label="停留幾分鐘">
          <Input inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value.replace(/\D/g, ""))} className="h-11" />
        </Field>
      )}
      <Field label="星期幾">
        <NativeSelect value={weekday} onChange={(event) => setWeekday(event.target.value)}>
          <option value="">每天</option>
          {[...WEEKDAY_LABEL].map((day, index) => (
            <option key={day} value={index}>
              星期{day}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button variant="outline" className="h-11 flex-1" disabled={busy} onClick={() => setOpen(false)}>
          取消
        </Button>
        <Button className="h-11 flex-1" disabled={busy || !subject.value} onClick={() => void submit()}>
          新增
        </Button>
      </div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
      {label}
      {children}
    </label>
  )
}

function TargetPicker({
  label,
  target,
  targets,
  onChange,
}: {
  label: string
  target: HabitTarget
  targets: Record<HabitTarget["by"], HabitOption[]>
  onChange: (target: HabitTarget) => void
}) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <NativeSelect
          aria-label={`${label}：哪一種對象`}
          value={target.by}
          onChange={(event) => {
            const by = event.target.value as HabitTarget["by"]
            onChange({ by, value: targets[by][0]?.value ?? "" })
          }}
          className="w-28 shrink-0"
        >
          {BYS.map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label={label} value={target.value} onChange={(event) => onChange({ ...target, value: event.target.value })}>
          {targets[target.by].map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </div>
    </Field>
  )
}
```

`Group` 的 `children` 是 `ReactNode[]`（`map` 出來的陣列）；typecheck 若抱怨，改成 `items: ReactNode[]` 參數。

- [ ] **Step 3: 帳號設定的入口**

`frontend/src/pages/settings.tsx`：「新人第一週」那個 `{user.role === "sales" && (<Link to="/first-week" ...>...)}` 區塊後面加：

```tsx
        {/* 業務自己的排序習慣；調整行程的頁首也進得去 */}
        {user.role === "sales" && (
          <Link
            to="/route/habits"
            state={{ from: "/settings" }}
            className="flex min-h-14 items-center justify-between rounded-2xl border-2 bg-card px-4 shadow-lip press"
          >
            <span className="text-sm font-medium">我的排序習慣</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        )}
```

- [ ] **Step 4: 路由**

`frontend/src/App.tsx`：`import { RouteEditPage } from "@/pages/route-edit"` 的上下各加一行，讓三行照字母排：

```tsx
import { RouteAddPage } from "@/pages/route-add"
import { RouteEditPage } from "@/pages/route-edit"
import { RouteHabitsPage } from "@/pages/route-habits"
```

`<Route path="/route/edit" element={<RouteEditPage />} />` 下面加：

```tsx
            <Route path="/route/edit/add" element={<RouteAddPage />} />
            <Route path="/route/habits" element={<RouteHabitsPage />} />
```

並把上面那行註解改成「調整今天的行程（清單）、加一站、我的排序習慣：只有業務有自己的行程，主管打開會看到後端的說明」。

- [ ] **Step 5: 檢查**

Run: `cd frontend && npx vitest run && npm run typecheck && npm run lint && npm run build`
Expected: 全部通過。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/route-add.tsx frontend/src/pages/route-habits.tsx frontend/src/pages/settings.tsx frontend/src/App.tsx
git commit -m "$(cat <<'EOF'
Add a stop by detour, and the route habits page reachable from settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 10: 文件、整體驗證、實機截圖

**Files:**
- Modify: `README.md`（〈今日路線（首頁）〉「問答答案的『排入今天的路線』」那一點之前加一段；程式結構表 `itinerary.py` 那一列之後加兩列）
- Modify: `docs/superpowers/specs/2026-10-01-itinerary-planning-design.md`（〈今天的行程〉`itinerary` 表格、〈示範資料〉第一點）

- [ ] **Step 1: README**

〈今日路線（首頁）〉裡 `- 問答答案的「排入今天的路線」也是直接加進今天的行程…` 那一行的**前面**加：

```markdown
- **調整行程**：首頁橫幅按「調整」切成一張張卡片的清單（`frontend/src/pages/route-edit.tsx`）。拖移把手或上移下移換順序；點卡片展開，改約的時間（幾點到／以前／以後）、停留（20／40／60／90 分或自己輸入）、先後（要在某一站之前或之後）、備註、鎖住（排順路時位置不動），或從今天拿掉。「加一站」列順路的前 5 家（直線估算多繞幾分鐘）與其他客戶。
  - 改動先留在畫面上，每次改完停 0.3 秒用 `POST /api/itinerary/today/preview` 算時間與車程（不存），按「完成」用 `PUT /api/itinerary/today` 一次存進去，按「取消」全部丟掉。
  - 違反今天的先後或某條習慣時那張卡變紅框，可以拿掉那條限制（今天的先後）、今天不套用（習慣）或復原。沒處理也存得進去：以今天排的為準，違反的習慣記成今天不套用，違反的先後拿掉。
  - 拖完或改了停留、約的時間，從下面問「以後也這樣排嗎？」：只有今天／每個星期 N 都這樣／每次都這樣。答應了就記成排序習慣。
- **排序習慣**（`backend/app/services/route_habits.py`，`route_habit` 表）：每位業務自己的、可以只在星期幾套用。對象可以是一家客戶、連鎖體系、客戶類型或地區。先後、先跑、排最後是一定要守的規則；約的時間、停留只在新增一站（含每天的建議）時當預設值。
  - 每天建立建議時排不出來，從最舊的習慣開始一條一條記成今天不套用，行程上寫「今天沒套用『…』，因為跟『…』衝突」。
  - 「我的排序習慣」頁（`/route/habits`，調整行程的頁首與帳號設定都進得去）分今天套用中與其他日子，可以停用、刪除、自己新增。新增或改了習慣不回頭改今天已存的行程。
  - 示範業務林昱辰一開始有三條（康泰連鎖藥局的店排在診所前面、星期三 敦南內科診所 · 大安 排最後、杏林診所 · 大安 都 11:00 以前到）。
```

（若 `main` 對「IT 重置也要重建習慣」回答「要」，〈行程存在伺服器〉那一點裡「IT 在組織管理頁按『重置示範業務今天的行程』，回到系統早上的建議」後面補「，示範業務的排序習慣也回到一開始那三條」。）

程式結構表 `backend/app/services/itinerary.py   今天的行程：存檔、版本、三顆鈕、加站` 換成並加一列：

```
backend/app/services/itinerary.py   今天的行程：存檔、版本、三顆鈕、加站、調整清單的 preview 與存檔、加一站的候選
backend/app/services/route_habits.py 排序習慣：比對、那句話、換成排序規則、預設值
```

前端的程式結構若有列 `pages/today.tsx`，在它附近加：

```
frontend/src/pages/route-edit.tsx   調整行程（清單）、加一站（route-add.tsx）、我的排序習慣（route-habits.tsx）
frontend/src/lib/itinerary.ts       調整清單的純函式：草稿、換位置、拖完的習慣句子、違反的規則
```

- [ ] **Step 2: 設計文件**

`docs/superpowers/specs/2026-10-01-itinerary-planning-design.md`：

1. 〈今天的行程〉`itinerary` 表格裡 `skipped_habit_ids` 那一列下面加一列：
   ```
   | `skip_reasons` | JSONB：今天不套用的每一條習慣為什麼（習慣 id → 一句話）：每天建議時跟別的規則衝突、業務選了今天不套用、存檔時順序跟它不合 |
   ```
2. 〈示範資料〉第一點的「`安和內科 · 信義 排最後`（每個星期三，自己新增的）」改成「`敦南內科診所 · 大安 排最後`（每個星期三，自己新增的；安和內科診所 · 信義是王冠宇的客戶）」。
3. 〈違反規則〉一節最後加一句：「沒處理就按『照這樣存』：以今天排的為準，違反的習慣記成今天不套用，違反的今天的先後拿掉。」

- [ ] **Step 3: 全部重跑**

```bash
TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests -q
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
```
Expected: 全部成功；記下 pytest 最後一行與 vitest 的通過數。

- [ ] **Step 4: 實機看一次（375×812）**

起一套獨立的開發環境（別碰使用者自己的 8000／5173）：

```bash
# 資料庫與資料
PGPASSWORD=meddemo psql -h 127.0.0.1 -p 5433 -U meddemo -d postgres -c "DROP DATABASE IF EXISTS meddemo_edit_dev WITH (FORCE)" -c "CREATE DATABASE meddemo_edit_dev"
uv run --project backend python data/seed/seed.py --database-url postgresql+psycopg://meddemo:meddemo@127.0.0.1:5433/meddemo_edit_dev
# 後端（背景）
DATABASE_URL=postgresql+psycopg://meddemo:meddemo@127.0.0.1:5433/meddemo_edit_dev REDIS_URL=redis://127.0.0.1:6379/12 LLM_PROVIDER= uv run --project backend uvicorn app.main:app --app-dir backend --port 8012
```

前端用暫時的 `frontend/vite.edit.config.ts`（**不要 commit**）：

```ts
import { mergeConfig } from "vite"
import base from "./vite.config"

export default mergeConfig(base, {
  server: {
    port: 5182,
    strictPort: true,
    proxy: {
      "/api/ws": { target: "ws://127.0.0.1:8012", ws: true },
      "/api": "http://127.0.0.1:8012",
      "/health": "http://127.0.0.1:8012",
    },
  },
})
```

`cd frontend && npx vite --config vite.edit.config.ts`（背景）。

用無頭 Chrome（每段 20 秒內、每段各自的 port 與 `--user-data-dir`，Node 腳本裡留一個 `setInterval` 不讓它提早結束）以 U01 登入：先用 `POST http://127.0.0.1:8012/api/auth/login` 拿 token 與使用者，在 localStorage 放 `meddemo:onboarded`="1"、`meddemo:token`、`meddemo:user`（格式見 `frontend/src/lib/auth.ts`）。截圖放 scratchpad：

1. 首頁：橫幅有「調整」。
2. 調整清單：五張卡、站與站之間的車程、頁首「取消／調整行程／習慣／完成」。
3. 展開一張卡的編輯區。
4. 下移一站之後的「以後也這樣排嗎？」。
5. 加一條先後再把順序拖成違反：紅框「違反：要在 … 之後」與「拿掉這條限制」「復原」。
6. 加一站頁：順路的 5 家寫「插在第 N 站後 · 多約 M 分鐘」。
7. 我的排序習慣：三條示範習慣、兩組、新增表單。
8. 按「完成」回首頁，順序是剛才存的（重新整理也一樣）。

看完停掉 uvicorn 與 vite、刪掉 `vite.edit.config.ts`、`DROP DATABASE meddemo_edit_dev`、`redis-cli -n 12 flushdb`。

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/specs/2026-10-01-itinerary-planning-design.md
git commit -m "$(cat <<'EOF'
Describe the edit list and route habits in the README and design doc

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```
