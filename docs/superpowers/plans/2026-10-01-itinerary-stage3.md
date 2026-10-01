# 行程第三階段：跟熊熊滾說要怎麼排 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 業務在首頁與調整清單上用一句話（打字或講話）跟熊熊滾說要怎麼排，或按「幫我排順一點」；後端用一次 Gemini 把話翻成固定格式的操作，自己的排序程式算出新順序，回一張「現在 → 改成」的對照卡，按「套用」才照存下來的操作在最新的行程上再做一次、寫進去。

**Architecture:** `route_planner` 多 `rule_costs`（每條規則讓路線多繞多少）。新表 `itinerary_proposal` 存每次的操作與對照卡。`services/itinerary_ai.py` 組提示、呼叫 `llm.json`（JSON Schema 約束成操作清單，`schemas/itinerary_ops.schema.json`）、驗證（別人的客戶、不認得的習慣轉成「找不到」）、在行程的草稿複本上依序套用操作、算對照卡；`services/itinerary.py` 補幾支公開函式讓它用（目前行程的草稿、用正式車程插入、排順路、草稿照正式車程算的樣子），存檔沿用第二階段的 `save`（多帶習慣的來源與要停用的習慣）。API 多 `ask`／`optimize`／`apply` 三支；`ask` 算進 `usage.py` 的用量上限。前端多輸入列（打字＋錄拜訪的即時轉文字）、對照卡、「幫我排順一點」，首頁與調整清單共用一支 hook。

**Tech Stack:** FastAPI、SQLAlchemy 2（Postgres）、Gemini（`app/llm.py`）、pytest；React 19、TypeScript、vitest。

**設計文件：** `docs/superpowers/specs/2026-10-01-itinerary-planning-design.md`（〈分階段做〉第 3 階段；〈跟熊熊滾說要怎麼排〉〈跟熊熊滾說要怎麼排：後端〉〈AI 的提案〉）。第 2 階段的計畫：`docs/superpowers/plans/2026-10-01-itinerary-stage2.md`。

## Global Constraints

- 註解與畫面文字一律繁體中文，密度與口吻照周圍的程式；畫面不用表情符號，圖示一律 lucide；按鈕用既有的厚底樣式（`buttonVariants`、`shadow-lip`、`press`）。
- AI 只負責聽懂話，順序由程式算：Gemini 只回操作清單，排順序一律交給 `route_planner`；AI 不可能排出違反規則的順序。
- AI 的調整先給業務看再套用：回「現在 → 改成」的對照卡，按「套用」才寫進行程；`apply` 檢查 `base_version == itinerary.version`，相同就照存下來的 `operations` 在最新的行程上再做一次（不信前端傳來的內容），不同回 409。
- 客戶 id 必須是這位業務的客戶（`owner_user_id`），習慣 id 必須是他的；不合的轉成「找不到」。
- 有 `ask_which` 就只回「要選一個」；有 `answer` 而且沒有其他操作就只回答；有 `optimize` 就最後整條 `plan`，只有 `add` 就 `cheapest_insert`，其他只 `schedule`。
- 排不出來（規則互相矛盾）是提案的特例：寫出擋住的幾條規則，沒有「套用」。
- 套用時順序還違反的規則照第二階段存檔的規則處理：今天的先後拿掉、習慣記成今天不套用（`main` 2026-10-01 的決定，AI 的提案也一樣）。
- `ask` 算進 `usage.py` 的用量上限；Gemini 沒設定時回 503「熊熊滾現在沒辦法排行程」，拖移、新增等照常可用。
- 提案只留最近 7 天，由 `jobs/retention.py` 清。
- 車程：要由程式挑順序的地方（排順路、插入新的一站）用 `travel.matrix`；順序已經定了的時間與總車程走 `itinerary._timed`（另一條線合併時把它換成 Google 的 `travel.along`）。不動 `travel.py`。
- Google 的車程顯示在沒有地圖的畫面上要標「Google Maps」（`estimated` 是 false 時）；估算的寫「（估計）」（沿用 `components/route/drive-source.tsx`）。
- 版本對不上回 409；主管與 IT 打業務的 API 回 403「主管沒有自己的拜訪路線」；行程是誰的由 token 決定（`acts_as_user_id or id`）。
- 共用檔（`backend/app/models.py`、`backend/app/main.py`、`README.md`、設計文件、`frontend/src/pages/today.tsx`、`frontend/src/App.tsx`）只做局部、新增式的修改：新的 model 加在檔案最後、不重排、不改格式。不動 `travel.py`、`google_routes.py`、主管頁、presence／location 的程式。
- 每個 commit 訊息最後空一行接 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合併到 main。

## 執行環境

worktree `/Users/jamessu/Desktop/computersciencehomework/MEDDEMO/.worktrees/itinerary-edit`（分支 `itinerary-edit`，第 2 階段已經在上面）。後端測試：

```bash
TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests/<file> -q
```

前端：`cd frontend && npx vitest run && npm run typecheck && npm run lint && npm run build`。

## 檔案

| 檔案 | 動作 | 職責 |
|---|---|---|
| `backend/app/services/route_planner.py` | 改 | `RuleCost`、`rule_costs` |
| `backend/app/models.py` | 改 | 最後加 `ItineraryProposal` |
| `backend/app/services/itinerary_ai.py` | 新 | 提示、呼叫 Gemini、驗證操作、在草稿上套用、對照卡、提案的存取與套用、清舊提案 |
| `backend/app/schemas/itinerary_ops.schema.json` | 新 | AI 的輸出格式 |
| `backend/app/services/itinerary.py` | 改 | `Draft.new_source`／`disabled_habit_ids`、`draft_of`、`with_stop`、`optimized`、`shown`、`save` 多兩個參數 |
| `backend/app/jobs/retention.py` | 改 | 清 7 天前的提案 |
| `backend/app/api/itinerary.py` | 改 | `POST /today/ask`、`/today/optimize`、`/proposals/{id}/apply` |
| `backend/app/usage.py` | 改 | 「跟熊熊滾排行程」的上限 |
| `backend/scripts/eval_itinerary_ai.py` | 新 | 20 句話的實測 |
| `data/eval/itinerary_ai_questions.json` | 新 | 20 句話與預期的操作 |
| `backend/tests/test_route_planner.py`、`test_itinerary_ai.py`（新）、`test_itinerary_api.py`、`test_usage.py`、`test_privacy.py` 或 `test_itinerary_ai.py` | 改／新 | |
| `frontend/src/api/route.ts` | 改 | `RouteProposal`、`askRoute`、`optimizeRoute`、`applyProposal` |
| `frontend/src/api/transcription.ts`、`frontend/src/voice/live-transcription.ts` | 改 | 客戶 id 可以不給 |
| `frontend/src/lib/itinerary.ts` | 改 | `proposalMarks`（對照卡的換位標記） |
| `frontend/src/lib/use-proposal.ts` | 新 | 問、排順路、套用、選一家、重算的狀態（兩頁共用） |
| `frontend/src/components/route/ask-bar.tsx` | 新 | 輸入列（打字＋麥克風） |
| `frontend/src/components/route/proposal-sheet.tsx` | 新 | 對照卡（提案、排不出來、要選一個、只回答、行程改過了） |
| `frontend/src/pages/today.tsx` | 改 | 首頁底部的輸入列與對照卡 |
| `frontend/src/pages/route-edit.tsx` | 改 | 「幫我排順一點」、輸入列、對照卡、還沒存的改動；修 StrictMode 下回到清單時的 preview |
| `README.md`、設計文件 | 改 | |

---

### Task 1: 每條規則讓路線多繞多少（`rule_costs`）

**Files:**
- Modify: `backend/app/services/route_planner.py`（`Conflict` 之後加 `RuleCost`；`plan` 之後加 `rule_costs`）
- Test: `backend/tests/test_route_planner.py`

**Interfaces:**
- Produces: `route_planner.RuleCost(rule: Rule, travel_minutes: int, late_minutes: int, without: list[str])`；`route_planner.rule_costs(start, start_point, stops, rules, minutes) -> list[RuleCost]`：守住全部規則的最好排法跟「拿掉這條（同一個 id 一起拿掉）再排」比，只列拿掉之後真的更好的；守住全部規則就排不出來時回空的。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_route_planner.py` 最後加：

```python
def test_rule_costs_say_how_much_each_rule_adds():
    # 先 B 再 A：0 → B(2) → A(1) 開 20 + 10 = 30 分鐘；不守的話 0 → A → B 只要 20 分鐘
    before_a = rp.Rule(id="today:B>A", text="先 B 再 A", kind="precedence", customer_ids=("B", "A"))
    harmless = rp.Rule(id="today:A>C", text="先 A 再 C", kind="precedence", customer_ids=("A", "C"))
    stops = [stop("A", 1), stop("B", 2), stop("C", 3)]
    costs = rp.rule_costs(START, 0, stops, [before_a, harmless], LINE)
    assert [(c.rule.id, c.travel_minutes, c.late_minutes) for c in costs] == [("today:B>A", 20, 0)]
    assert costs[0].without == ["A", "B", "C"]


def test_rule_costs_count_a_split_rule_once_and_report_lateness():
    pairs = [
        rp.Rule(id="habit:7", text="C 排在 A、B 前面", kind="precedence", customer_ids=("C", "A")),
        rp.Rule(id="habit:7", text="C 排在 A、B 前面", kind="precedence", customer_ids=("C", "B")),
    ]
    # A 約 09:15 以前到：先跑 C（30 分鐘外）一定晚到
    stops = [stop("A", 1, window=("before", dt.time(9, 15))), stop("B", 2), stop("C", 3)]
    costs = rp.rule_costs(START, 0, stops, pairs, LINE)
    assert len(costs) == 1 and costs[0].rule.id == "habit:7"
    assert costs[0].late_minutes > 0


def test_rule_costs_are_empty_when_the_rules_cannot_be_kept():
    a_first = rp.Rule(id="today:A>B", text="先 A 再 B", kind="precedence", customer_ids=("A", "B"))
    b_first = rp.Rule(id="today:B>A", text="先 B 再 A", kind="precedence", customer_ids=("B", "A"))
    assert rp.rule_costs(START, 0, [stop("A", 1), stop("B", 2)], [a_first, b_first], LINE) == []
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests/test_route_planner.py -q`
Expected: 三個新測試 FAIL（`rule_costs` 不存在）。

- [ ] **Step 3: 實作**

`Conflict` 之後加：

```python
@dataclass(frozen=True)
class RuleCost:
    """守住這條規則讓路線多花多少：跟拿掉這條（同一個 id 一起拿掉）重排的最好排法比。"""

    rule: Rule
    travel_minutes: int  # 多開幾分鐘（晚到變少時可能是負的）
    late_minutes: int  # 多晚到幾分鐘
    without: list[str]  # 不守這條時最好的順序
```

`plan` 之後加：

```python
def rule_costs(
    start: dt.datetime, start_point: int, stops: list[PlanStop], rules: list[Rule], minutes: list[list[int]]
) -> list[RuleCost]:
    """每條規則讓路線多繞多少（對照卡上「守住『…』，比不守多繞 N 分鐘」）。只列拿掉之後真的排得更好的；
    守住全部規則就排不出來時回空的（那是 plan 的 Conflict 要講的事）。"""
    best = _search(start, start_point, stops, rules, minutes)
    if best is None:
        return []
    costs = []
    for rule_id in dict.fromkeys(rule.id for rule in rules):
        without = _search(start, start_point, stops, [r for r in rules if r.id != rule_id], minutes)
        if without is None or (without.late_minutes, without.travel_minutes) >= (best.late_minutes, best.travel_minutes):
            continue
        costs.append(RuleCost(
            rule=next(r for r in rules if r.id == rule_id),
            travel_minutes=best.travel_minutes - without.travel_minutes,
            late_minutes=best.late_minutes - without.late_minutes,
            without=[s.customer_id for s in without.slots],
        ))
    return costs
```

模組 docstring 最後一段補一句：「`rule_costs` 算每條規則讓路線多繞多少，對照卡用。」

- [ ] **Step 4: 跑測試，確認通過**

Run: 同 Step 2。Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/route_planner.py backend/tests/test_route_planner.py
git commit -m "$(cat <<'EOF'
Planner says how much each rule adds to the drive

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 提案的資料表，7 天後清掉

**Files:**
- Modify: `backend/app/models.py`（檔案最後加 `ItineraryProposal`）
- Create: `backend/app/services/itinerary_ai.py`（先只有保存期限與清理，Task 4 再補其他）
- Modify: `backend/app/jobs/retention.py`
- Test: `backend/tests/test_itinerary_ai.py`（新）

**Interfaces:**
- Produces: `models.ItineraryProposal`（`id`、`itinerary_id`、`base_version`、`question`、`operations: list[dict]`、`result: dict`、`created_at`）；`itinerary_ai.PROPOSAL_RETENTION = dt.timedelta(days=7)`；`itinerary_ai.purge_proposals(session, now=None) -> int`（刪掉的筆數）。

- [ ] **Step 1: 寫失敗的測試**

新檔 `backend/tests/test_itinerary_ai.py`：

```python
"""跟熊熊滾說要怎麼排：提示、操作的驗證與套用、對照卡、提案的存取與套用。Gemini 一律用假的。"""

import datetime as dt

from sqlalchemy import select

from app.models import ItineraryProposal
from app.services import itinerary as service
from app.services import itinerary_ai


def proposal(tx, itinerary, days_ago=0):
    row = ItineraryProposal(
        itinerary_id=itinerary.id, base_version=itinerary.version, question="測試", operations=[],
        result={"kind": "answer"},
        created_at=dt.datetime.now(dt.UTC) - dt.timedelta(days=days_ago),
    )
    tx.add(row)
    tx.flush()
    return row


def test_old_proposals_are_purged_after_seven_days(tx):
    itinerary = service.get_or_create(tx, "U01")
    fresh, old = proposal(tx, itinerary), proposal(tx, itinerary, days_ago=8)
    assert itinerary_ai.purge_proposals(tx) == 1
    left = set(tx.scalars(select(ItineraryProposal.id)))
    assert fresh.id in left and old.id not in left
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests/test_itinerary_ai.py -q`
Expected: ImportError（`ItineraryProposal` 不存在）。

- [ ] **Step 3: 資料表**

`backend/app/models.py` 最後（`RouteHabit` 之後）加：

```python


class ItineraryProposal(Base):
    """跟熊熊滾說要怎麼排、「幫我排順一點」算出來的提案（services/itinerary_ai.py）。

    按「套用」時照 operations 在最新的行程上再做一次，不信前端傳來的內容；base_version 對不上就擋下來。
    只留最近 7 天（jobs/retention.py）。行程刪掉（IT 重置示範業務）時一起刪。
    """

    __tablename__ = "itinerary_proposal"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    itinerary_id: Mapped[int] = mapped_column(ForeignKey("itinerary.id", ondelete="CASCADE"), index=True)
    # 算提案時的行程版本
    base_version: Mapped[int]
    # 業務說的那句話；按鈕觸發的排順路是 NULL
    question: Mapped[str | None] = mapped_column(Text)
    # 驗證過的操作清單（AI 的輸出換成這位業務自己的客戶與習慣，不合的已經轉成 not_found）
    operations: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    # 對照卡的內容（api/itinerary.py 的 ProposalOut 照這個欄位回傳）
    result: Mapped[dict[str, Any]]
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now(), index=True)
```

- [ ] **Step 4: 清理**

新檔 `backend/app/services/itinerary_ai.py`：

```python
"""跟熊熊滾說要怎麼排（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈跟熊熊滾說要怎麼排：後端〉）。

AI 只負責聽懂話：Gemini 把一句話翻成固定格式的操作，順序一律由排序程式算（route_planner），
AI 不可能排出違反規則的順序。算出來的是提案，業務看過按「套用」才寫進行程。
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.models import ItineraryProposal

# 提案只留最近 7 天：套用要看當天的行程，舊的只剩下查問題時有用
PROPOSAL_RETENTION = dt.timedelta(days=7)


def purge_proposals(session: Session, now: dt.datetime | None = None) -> int:
    """刪掉超過保存期限的提案，回傳刪了幾筆（jobs/retention.py 每天跑一次）。"""
    cutoff = (now or dt.datetime.now(dt.UTC)) - PROPOSAL_RETENTION
    return session.execute(delete(ItineraryProposal).where(ItineraryProposal.created_at < cutoff)).rowcount
```

`backend/app/jobs/retention.py`：import 區加 `from app.services.itinerary_ai import purge_proposals`；`main()` 裡 `result = purge(session)` 下面加 `proposals = purge_proposals(session)`；log 的那一行之後加：

```python
    log.info("跟熊熊滾說要怎麼排的提案：刪掉 %d 筆超過 7 天的", proposals)
```

（`log.info` 要放在 `with` 區塊外面、`main()` 裡；`proposals` 在 `with` 裡算好。）模組 docstring 第一句改成「保存期限清理（NFR-8）：每天跑一次，刪掉到期的錄音、逐字稿、沒送出的紀錄與 7 天前的行程提案，期限見 app/services/privacy.py 與 app/services/itinerary_ai.py。」

- [ ] **Step 5: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests/test_itinerary_ai.py backend/tests/test_privacy.py -q`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/services/itinerary_ai.py backend/app/jobs/retention.py backend/tests/test_itinerary_ai.py
git commit -m "$(cat <<'EOF'
Add the itinerary proposal table and purge proposals after seven days

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 3: 行程服務給提案用的幾支函式

**Files:**
- Modify: `backend/app/services/itinerary.py`
- Test: `backend/tests/test_itinerary.py`

**Interfaces:**
- Consumes: Task 1 的 `route_planner.rule_costs`、`RuleCost`。
- Produces（Task 4 用）：
  - `Draft` 多兩個欄位：`new_source: str = "rep"`（新加的站記成誰加的）、`disabled_habit_ids: list[int] = []`（要停用的習慣：算規則時不算，存檔時停用）
  - `Optimized(draft: Draft | None, conflict: list[str], costs: list[str])`
  - `draft_of(session, itinerary) -> Draft`：存著的行程換成草稿
  - `with_stop(session, itinerary, draft, customer_id) -> Draft`：用正式車程插入一家（不合丟 `InvalidDraft`）
  - `optimized(session, itinerary, draft) -> Optimized`：整條重排（`travel.matrix`；現在的順序已經守住規則而且一樣好就不動），排不出來時 `draft` 是 None、`conflict` 是擋住的規則那句話；`costs` 是「守住『…』，比不守多繞 N 公里、M 分鐘」
  - `shown(session, itinerary, draft) -> ItineraryView`：草稿照正式車程算的樣子（`_timed`），不存
  - `broken_rules(session, itinerary, draft) -> list[str]`：草稿的順序違反哪幾條規則（id），不算車程
  - `save(session, user_id, version, draft, habit_source="prompt")`：多一個參數；`draft.disabled_habit_ids` 裡這位業務的習慣存檔時停用

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_itinerary.py` 最後加（`draft_of`、`not_on_route`、`by_customer` 是這個檔案前面已經有的小工具；注意 `draft_of(view)` 是測試的工具，`service.draft_of(tx, itinerary)` 是這次要加的服務函式）：

```python
def test_the_saved_itinerary_as_a_draft(tx):
    itinerary = service.get_or_create(tx, "U01")
    assert service.draft_of(tx, itinerary) == draft_of(service.view(tx, itinerary))


def test_with_stop_uses_the_habit_defaults_and_marks_who_added_it(tx):
    itinerary = service.get_or_create(tx, "U01")
    draft = service.draft_of(tx, itinerary)
    draft.new_source = "ai"
    [mine] = not_on_route(tx, [s.customer_id for s in draft.stops])
    route_habits.create(tx, "U01", route_habits.HabitSpec("duration", by_customer(mine), duration_minutes=20), "manual")
    added = service.with_stop(tx, itinerary, draft, mine)
    assert len(added.stops) == 6 and next(s for s in added.stops if s.customer_id == mine).duration_minutes == 20
    shown = {s.customer_id: s for s in service.shown(tx, itinerary, added).stops}
    assert shown[mine].source == "ai"
    [theirs] = not_on_route(tx, [], owner="U02")
    with pytest.raises(service.InvalidDraft):
        service.with_stop(tx, itinerary, draft, theirs)


def test_optimized_keeps_the_rules_and_says_what_they_cost(tx):
    tx.execute(delete(RouteHabit).where(RouteHabit.user_id == "U01"))
    itinerary = service.get_or_create(tx, "U01")
    draft = service.draft_of(tx, itinerary)
    ids = [s.customer_id for s in draft.stops]
    names = {s.customer_id: s.customer_name for s in service.view(tx, itinerary).stops}
    draft.stops = [draft.stops[0], *reversed(draft.stops[1:])]
    draft.precedences = [(ids[4], ids[1])]
    result = service.optimized(tx, itinerary, draft)
    order = [s.customer_id for s in result.draft.stops]
    # 第一站是「需立即處理」那家，鎖著；今天的先後一定守
    assert order[0] == ids[0] and order.index(ids[4]) < order.index(ids[1]) and result.conflict == []
    assert any(line.startswith(f"守住『{names[ids[4]]} 排在 {names[ids[1]]} 前面』，比不守多") for line in result.costs)
    assert service.broken_rules(tx, itinerary, result.draft) == []
    # 要第三家排在鎖住的第一站前面：排不出來，講出是哪兩條
    draft.precedences = [(ids[2], ids[0])]
    stuck = service.optimized(tx, itinerary, draft)
    assert stuck.draft is None and len(stuck.conflict) == 2
    assert service.broken_rules(tx, itinerary, draft) == [f"today:{ids[2]}>{ids[0]}"]


def test_saving_an_ai_draft_records_new_habits_as_ai_and_disables_old_ones(tx):
    itinerary = service.get_or_create(tx, "U01")
    ids = [s.customer_id for s in service.view(tx, itinerary).stops]
    old = route_habits.create(
        tx, "U01", route_habits.HabitSpec("precedence", by_customer(ids[1]), by_customer(ids[2])), "manual",
    )
    draft = service.draft_of(tx, itinerary)
    draft.disabled_habit_ids = [old.id]
    assert f"habit:{old.id}" not in {r.id for r in service.shown(tx, itinerary, draft).rules}
    draft.habits = [service.PendingHabit(route_habits.HabitSpec("first", {"by": "area", "value": "板橋"}, weekday=0))]
    service.save(tx, "U01", itinerary.version, draft, habit_source="ai")
    habits = route_habits.mine(tx, "U01")
    assert not next(h for h in habits if h.id == old.id).active
    assert (habits[-1].source, habits[-1].text) == ("ai", "星期一先跑板橋")
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests/test_itinerary.py -q`
Expected: 四個新測試 FAIL（`draft_of` 等不存在）。

- [ ] **Step 3: 草稿多兩個欄位、`Optimized`**

`Draft` 換成：

```python
@dataclass
class Draft:
    """改到一半的行程（調整清單上的，或跟熊熊滾說的提案算出來的）：還沒跑的站照順序、今天的先後、
    今天不套用的習慣、這次答應要記的習慣、要停用的習慣。"""

    stops: list[DraftStop]
    precedences: list[tuple[str, str]] = field(default_factory=list)  # (前, 後)
    skipped_habit_ids: list[int] = field(default_factory=list)
    habits: list[PendingHabit] = field(default_factory=list)
    # 新加進來的站記成誰加的：調整清單是 rep，跟熊熊滾說的是 ai
    new_source: str = "rep"
    # 要停用的習慣（跟熊熊滾說「那條不要了」）：算規則時就不算，存檔時停用
    disabled_habit_ids: list[int] = field(default_factory=list)
```

`Candidates` 之後加：

```python
@dataclass
class Optimized:
    """整條重排的結果：新的草稿（排不出來時是 None）、擋住的規則（那句話）、每條規則讓路線多繞多少（對照卡的那一行）。"""

    draft: Draft | None
    conflict: list[str]
    costs: list[str]
```

- [ ] **Step 4: `_resolve`、`_inserted` 認得新欄位**

`_resolve` 裡：

1. 新加的站的來源 `("rep", *labels[stop.customer_id])` 改成 `(draft.new_source, *labels[stop.customer_id])`。
2. `skipped = {i for i in draft.skipped_habit_ids if i in mine}` 下面加：
   ```python
    # 要停用的習慣：今天的規則就不算它（存檔時才真的停用，見 save）
    disabled = {i for i in draft.disabled_habit_ids if i in mine}
    day.habits = [h for h in day.habits if h.id not in disabled]
   ```
3. docstring 最後補一句：「要停用的習慣從 day.habits 拿掉，之後算規則就不算它。」

`_inserted` 的參數最後加 `source: str = "rep", estimate: bool = True`；裡面 `new = _new_open(customer, row.source if row else "rep", label, day.habits)` 改成 `new = _new_open(customer, row.source if row else source, label, day.habits)`，`_cheapest_index(..., estimate=True)` 改成 `_cheapest_index(..., estimate=estimate)`。docstring 補：「source：新的一家記成誰加的；estimate：用直線估算（調整清單的「加一站」）還是正式的車程（跟熊熊滾說的提案）。」

- [ ] **Step 5: `save` 多兩件事**

簽名改成 `def save(session: Session, user_id: str, version: int, draft: Draft, habit_source: str = "prompt") -> Itinerary:`。

`open_, precedences, skipped, pending = _resolve(session, day, draft)` 下面加：

```python
    for habit in route_habits.mine(session, day.rep.id):
        if habit.id in draft.disabled_habit_ids:
            habit.active = False
```

`habit = route_habits.create(session, day.rep.id, item.spec, "prompt")` 改成 `habit = route_habits.create(session, day.rep.id, item.spec, habit_source)`。docstring 補一句：「habit_source：答應要記的習慣從哪裡來（調整清單是 prompt，跟熊熊滾說的是 ai）；draft.disabled_habit_ids 裡這位業務的習慣停用。」

- [ ] **Step 6: 公開函式**

加在 `today_skips` 之後：

```python
def draft_of(session: Session, itinerary: Itinerary) -> Draft:
    """存著的行程換成草稿（跟前端 lib/itinerary.ts 的 draftFrom 一樣）：還沒跑的站照存著的順序，先後與今天不套用的習慣照舊。"""
    day = _day(session, itinerary)
    return Draft(
        stops=[_draft_stop(o) for o in _saved_open(session, day)],
        precedences=_precedences(session, itinerary),
        skipped_habit_ids=sorted(itinerary.skipped_habit_ids),
    )


def with_stop(session: Session, itinerary: Itinerary, draft: Draft, customer_id: str) -> Draft:
    """草稿加一家，插在多繞最少、又不新增違反的位置；約的時間與停留照習慣給的預設值。
    用正式的車程（跟熊熊滾說的提案，順序由程式挑）。不合（不是自己的客戶、已經在行程裡、今天去過了、已經 8 站）丟 InvalidDraft。"""
    day = _day(session, itinerary)
    open_, precedences, skipped, pending = _resolve(session, day, draft)
    open_ = _inserted(
        session, day, open_, customer_id, precedences, skipped, pending, source=draft.new_source, estimate=False,
    )
    by_id = {s.customer_id: s for s in draft.stops}
    return dataclasses.replace(draft, stops=[by_id.get(o.customer.id) or _draft_stop(o) for o in open_])


def optimized(session: Session, itinerary: Itinerary, draft: Draft) -> Optimized:
    """草稿整條重排（「幫我排順一點」、跟熊熊滾說要排順路）：守住今天的先後、習慣與鎖住的位置，晚到最少、車程最短。
    順序由程式挑，用 travel.matrix。排不出來時回擋住的那幾條規則。現在的順序已經一樣好就不動。"""
    day = _day(session, itinerary)
    open_, precedences, skipped, pending = _resolve(session, day, draft)
    durations = day.durations() | {o.customer.id: o.duration_minutes for o in open_}
    start, points = _points(session, day.rep, itinerary.date, day.done, durations, [o.customer for o in open_])
    matrix = travel.matrix(points)
    stops = [o.plan_stop(n + 1) for n, o in enumerate(open_)]
    rules = _rules(open_, precedences, day.habits, skipped, pending) + _locks(open_, len(day.done))
    result = route_planner.plan(start, 0, stops, rules, matrix.minutes)
    if isinstance(result, route_planner.Conflict):
        return Optimized(None, [rule.text for rule in result.rules], [])
    order = [slot.customer_id for slot in result.slots]
    # 現在的順序已經守住規則、而且一樣好（同分的排法不只一種）：不要為了換而換
    current = [s.customer_id for s in stops]
    now = route_planner.schedule(start, 0, stops, matrix.minutes)
    if not route_planner.violations(current, rules) and (now.late_minutes, now.travel_minutes) <= (
        result.late_minutes, result.travel_minutes
    ):
        order = current
    index = {o.customer.id: n + 1 for n, o in enumerate(open_)}

    def km(ids: list[str]) -> float:
        path = [0, *(index[cid] for cid in ids)]
        return sum(matrix.km[a][b] for a, b in zip(path, path[1:]))

    costs = [
        _cost_line(cost, km(order) - km(cost.without))
        for cost in route_planner.rule_costs(start, 0, stops, rules, matrix.minutes)
    ]
    by_id = {o.customer.id: _draft_stop(o) for o in open_}
    return Optimized(dataclasses.replace(draft, stops=[by_id[cid] for cid in order]), [], costs)


def shown(session: Session, itinerary: Itinerary, draft: Draft) -> ItineraryView:
    """草稿照正式車程算的樣子（提案的「改成」）：時間、車程、規則與違反，不存。"""
    day = _day(session, itinerary)
    open_, precedences, skipped, pending = _resolve(session, day, draft)
    return _compose(session, day, open_, precedences, skipped, _reasons(itinerary, skipped), pending)


def broken_rules(session: Session, itinerary: Itinerary, draft: Draft) -> list[str]:
    """草稿的順序違反哪幾條規則（id），只看順序、不算車程。"""
    day = _day(session, itinerary)
    open_, precedences, skipped, pending = _resolve(session, day, draft)
    rules = _rules(open_, precedences, day.habits, skipped, pending)
    return [rule.id for rule in route_planner.violations([o.customer.id for o in open_], rules)]
```

私有函式區（`_estimated` 後面）加：

```python
def _draft_stop(stop: _Open) -> DraftStop:
    return DraftStop(
        stop.customer.id, stop.duration_minutes, stop.window_kind, stop.window_time, stop.note, stop.locked,
    )


def _cost_line(cost: route_planner.RuleCost, extra_km: float) -> str:
    """對照卡上一條規則的代價：「守住『德安藥局 · 板橋 排在 佑生藥局 · 大安 前面』，比不守多繞 6 公里、15 分鐘」。"""
    parts = []
    if cost.travel_minutes > 0:
        parts.append(f"多繞 {max(round(extra_km, 1), 0):g} 公里、{cost.travel_minutes} 分鐘")
    if cost.late_minutes > 0:
        parts.append(f"多晚到 {cost.late_minutes} 分")
    return f"守住『{cost.rule.text}』，比不守" + "，".join(parts)
```

- [ ] **Step 7: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests/test_itinerary.py backend/tests/test_itinerary_api.py backend/tests/test_route_habits_api.py -q`
Expected: 全部 PASS。

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/itinerary.py backend/tests/test_itinerary.py
git commit -m "$(cat <<'EOF'
Itinerary service can build, replan and show a draft for AI proposals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 4: 跟熊熊滾說：提示、操作、對照卡、套用

**Files:**
- Create: `backend/app/schemas/itinerary_ops.schema.json`
- Modify: `backend/app/services/itinerary_ai.py`（Task 2 建的檔案，補上其他部分）
- Create: `backend/tests/route_fakes.py`
- Test: `backend/tests/test_itinerary_ai.py`

**Interfaces:**
- Consumes: Task 2 的 `ItineraryProposal`；Task 3 的 `itinerary.draft_of`、`with_stop`、`optimized`、`shown`、`broken_rules`、`save(..., habit_source)`、`Draft.new_source`／`disabled_habit_ids`、`PendingHabit`、`InvalidDraft`、`VersionConflict`、`TOO_MANY`；`route_habits.HabitSpec`、`validate`、`targets`、`describe`、`mine`、`applies_on` 的規則、`RULE_KINDS`、`InvalidHabit`；`app.llm.get_llm`、`LLM`。
- Produces（Task 5 用）：
  - `itinerary_ai.ask(session, user_id, question, customer_id=None, llm=None) -> ItineraryProposal`（Gemini 沒設定丟 `app.config.NotConfigured`；模型輸出不能用丟 `app.llm.LLMOutputError`）
  - `itinerary_ai.optimize(session, user_id) -> ItineraryProposal`
  - `itinerary_ai.apply(session, user_id, proposal_id) -> Itinerary`（找不到或不是他的丟 `ProposalNotFound`；行程在問完之後改過了丟 `itinerary.VersionConflict`；不能套用丟 `NotApplicable`）
  - `itinerary_ai.ProposalNotFound(LookupError)`、`itinerary_ai.NotApplicable(ValueError)`
  - `ItineraryProposal.result` 的欄位（每一個都一定有）：`kind`（`proposal`／`conflict`／`ask_which`／`answer`）、`summary`、`changed`、`before`／`after`（`{"stops": [{customer_id, customer_name, planned_time, late_minutes}], "travel_minutes", "travel_km"}` 或 None）、`rule_costs`、`late`、`habits_added`、`habits_disabled`、`dropped`、`notes`、`conflict`（都是一行一行的字）、`mention`、`candidates`（`[{customer_id, customer_name}]`）、`text`、`estimated`
  - 給實測用：`itinerary_ai.interpret(session, itinerary, question, customer_id, llm) -> list[dict]`（驗證過的操作）、`itinerary_ai.SYSTEM`、`itinerary_ai.SCHEMA`
  - 測試用的假 Gemini：`backend/tests/route_fakes.py` 的 `FakeLLM(*replies)`（每次 `json()` 照順序回 `{"operations": replies[i]}`，`prompts` 記下收到的提示）

- [ ] **Step 1: 假的 Gemini**

新檔 `backend/tests/route_fakes.py`：

```python
"""跟熊熊滾說要怎麼排的測試共用：假的 Gemini。"""


class FakeLLM:
    """照順序回寫好的操作清單，記下收到的提示；不連網路、不花錢。"""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.prompts: list[str] = []

    def json(self, *, system, prompt, schema, effort="medium", media=()):
        self.prompts.append(prompt)
        return {"operations": self.replies.pop(0)}
```

- [ ] **Step 2: 寫失敗的測試**

`backend/tests/test_itinerary_ai.py`：import 區換成

```python
import datetime as dt

import pytest
from route_fakes import FakeLLM
from sqlalchemy import delete, select

from app.config import NotConfigured
from app.models import Customer, ItineraryProposal, RouteHabit
from app.services import itinerary as service
from app.services import itinerary_ai, route_habits
```

最後加：

```python
def route(tx):
    """U01 今天的行程（沒有排序習慣，順序就是模型的建議排順路）：(行程, 站的 id, 店名)。"""
    tx.execute(delete(RouteHabit).where(RouteHabit.user_id == "U01"))
    itinerary = service.get_or_create(tx, "U01")
    stops = service.view(tx, itinerary).stops
    return itinerary, [s.customer_id for s in stops], {s.customer_id: s.customer_name for s in stops}


def mine_not_on_route(tx, ids):
    return tx.scalars(
        select(Customer).where(Customer.owner_user_id == "U01", Customer.id.not_in(ids)).order_by(Customer.id)
    ).first()


def ask(tx, *ops, question="測試", customer_id=None):
    return itinerary_ai.ask(tx, "U01", question, customer_id, llm=FakeLLM(list(ops)))


def order(side):
    return [s["customer_id"] for s in side["stops"]]


def test_the_prompt_has_the_route_the_customers_and_the_habits(tx):
    itinerary, ids, names = route(tx)
    habit = route_habits.create(tx, "U01", route_habits.HabitSpec("first", {"by": "area", "value": "板橋"}), "manual")
    llm = FakeLLM([{"op": "answer", "text": "因為帳款逾期最久。"}])
    proposal = itinerary_ai.ask(tx, "U01", "為什麼第一站排這家？", llm=llm)
    prompt = llm.prompts[0]
    assert "星期三" in prompt and "為什麼第一站排這家？" in prompt
    assert f"1. {names[ids[0]]}（{ids[0]}）" in prompt and f"{habit.id}：{habit.text}" in prompt
    other = mine_not_on_route(tx, ids)
    assert f"{other.name}：{other.id}" in prompt
    theirs = tx.scalars(select(Customer).where(Customer.owner_user_id == "U02")).first()
    assert theirs.id not in prompt
    assert (proposal.result["kind"], proposal.result["text"]) == ("answer", "因為帳款逾期最久。")
    assert proposal.question == "為什麼第一站排這家？" and proposal.base_version == itinerary.version


def test_a_chosen_customer_is_passed_back_to_the_model(tx):
    _, ids, names = route(tx)
    llm = FakeLLM([{"op": "remove", "customer_id": ids[2]}])
    itinerary_ai.ask(tx, "U01", "康泰今天不去了", ids[2], llm=llm)
    assert f"他剛才選了：{names[ids[2]]}（{ids[2]}）" in llm.prompts[0]


def test_moving_a_stop_and_applying_it(tx):
    itinerary, ids, names = route(tx)
    proposal = ask(tx, {"op": "move", "customer_id": ids[4], "to_position": 2})
    result = proposal.result
    assert result["kind"] == "proposal" and result["changed"]
    assert result["summary"] == f"{names[ids[4]]} 移到第 2 站"
    assert order(result["before"]) == ids and order(result["after"]) == [ids[0], ids[4], *ids[1:4]]
    itinerary_ai.apply(tx, "U01", proposal.id)
    view = service.view(tx, itinerary)
    assert [s.customer_id for s in view.stops] == [ids[0], ids[4], *ids[1:4]] and view.version == 2


def test_adding_and_removing_stops(tx):
    itinerary, ids, names = route(tx)
    other = mine_not_on_route(tx, ids)
    proposal = ask(tx, {"op": "add", "customer_id": other.id}, {"op": "remove", "customer_id": ids[3]})
    result = proposal.result
    assert result["summary"] == f"加了 {other.name}，拿掉 {names[ids[3]]}"
    assert other.id in order(result["after"]) and ids[3] not in order(result["after"])
    itinerary_ai.apply(tx, "U01", proposal.id)
    stops = {s.customer_id: s for s in service.view(tx, itinerary).stops}
    assert stops[other.id].source == "ai" and ids[3] not in stops


def test_other_reps_customers_are_not_found(tx):
    _, ids, _ = route(tx)
    theirs = tx.scalars(select(Customer.id).where(Customer.owner_user_id == "U02")).first()
    proposal = ask(tx, {"op": "add", "customer_id": theirs}, {"op": "remove", "customer_id": "德安"})
    result = proposal.result
    assert result["notes"] == [f"找不到『{theirs}』", "找不到『德安』"]
    assert result["changed"] is False and result["summary"] == "沒有要改的"
    assert proposal.operations == [{"op": "not_found", "mention": theirs}, {"op": "not_found", "mention": "德安"}]


def test_times_stays_notes_and_locks(tx):
    itinerary, ids, names = route(tx)
    proposal = ask(
        tx,
        {"op": "set_window", "customer_id": ids[1], "kind": "before", "time": "09:40"},
        {"op": "set_duration", "customer_id": ids[2], "minutes": 90},
        {"op": "set_note", "customer_id": ids[3], "text": "找王藥師"},
        {"op": "lock", "customer_id": ids[4]},
        {"op": "unlock", "customer_id": ids[0]},
        {"op": "set_window", "customer_id": ids[3], "kind": "around", "time": "9 點"},
    )
    result = proposal.result
    assert result["summary"] == (
        f"{names[ids[1]]} 約 09:40 以前到，{names[ids[2]]} 停 90 分，{names[ids[3]]} 的備註改成『找王藥師』，"
        f"鎖住 {names[ids[4]]}，{names[ids[0]]} 解鎖"
    )
    assert any(line.startswith(names[ids[1]]) and "會晚到" in line for line in result["late"])
    itinerary_ai.apply(tx, "U01", proposal.id)
    stops = {s.customer_id: s for s in service.view(tx, itinerary).stops}
    assert (stops[ids[1]].window_kind, stops[ids[1]].window_time) == ("before", "09:40")
    assert stops[ids[2]].duration_minutes == 90 and stops[ids[3]].note == "找王藥師"
    assert stops[ids[4]].locked and not stops[ids[0]].locked


def test_a_new_precedence_replans_the_route(tx):
    _, ids, names = route(tx)
    # 沒叫排順路也一樣：新加的先後順序不合，不重排的話套用時就會被拿掉
    proposal = ask(tx, {"op": "add_precedence", "before": ids[4], "after": ids[1]})
    result = proposal.result
    assert result["summary"] == f"加了一條『{names[ids[4]]} 排在 {names[ids[1]]} 前面』，重新排了順序"
    after = order(result["after"])
    assert after[0] == ids[0] and after.index(ids[4]) < after.index(ids[1])
    assert any(line.startswith(f"守住『{names[ids[4]]} 排在 {names[ids[1]]} 前面』") for line in result["rule_costs"])
    assert result["dropped"] == []


def test_the_optimize_button_on_an_already_smooth_route(tx):
    route(tx)
    proposal = itinerary_ai.optimize(tx, "U01")
    result = proposal.result
    assert proposal.question is None and proposal.operations == [{"op": "optimize"}]
    assert result["changed"] is False and result["summary"] == "現在的順序已經是最順的了"
    with pytest.raises(itinerary_ai.NotApplicable):
        itinerary_ai.apply(tx, "U01", proposal.id)


def test_rules_that_cannot_be_kept_are_named_and_cannot_be_applied(tx):
    _, ids, names = route(tx)
    proposal = ask(tx, {"op": "add_precedence", "before": ids[2], "after": ids[0]}, {"op": "optimize"})
    result = proposal.result
    assert result["kind"] == "conflict" and len(result["conflict"]) == 2
    assert f"{names[ids[2]]} 排在 {names[ids[0]]} 前面" in result["conflict"]
    with pytest.raises(itinerary_ai.NotApplicable):
        itinerary_ai.apply(tx, "U01", proposal.id)


def test_adding_and_disabling_habits(tx):
    itinerary, ids, names = route(tx)
    old = route_habits.create(tx, "U01", route_habits.HabitSpec("last", {"by": "customer", "value": ids[1]}), "manual")
    theirs = tx.scalars(select(Customer.id).where(Customer.owner_user_id == "U02")).first()
    proposal = ask(
        tx,
        {"op": "add_habit", "habit": {"kind": "first", "subject": {"by": "area", "value": "板橋"}, "weekday": 0}},
        {"op": "add_habit", "habit": {"kind": "first", "subject": {"by": "customer", "value": theirs}}},
        {"op": "disable_habit", "habit_id": old.id},
        {"op": "disable_habit", "habit_id": 999999},
    )
    result = proposal.result
    assert result["habits_added"] == ["星期一先跑板橋"] and result["habits_disabled"] == [old.text]
    assert result["notes"] == ["記不起來這條習慣：找不到這個對象，只能選自己的客戶", "找不到『習慣 999999』"]
    itinerary_ai.apply(tx, "U01", proposal.id)
    habits = {h.text: h for h in route_habits.mine(tx, "U01")}
    assert habits["星期一先跑板橋"].source == "ai" and not habits[old.text].active


def test_an_ambiguous_name_asks_which_one(tx):
    _, ids, names = route(tx)
    theirs = tx.scalars(select(Customer.id).where(Customer.owner_user_id == "U02")).first()
    proposal = ask(
        tx, {"op": "ask_which", "mention": "康泰", "candidates": [ids[1], ids[2], theirs]}, {"op": "optimize"},
    )
    result = proposal.result
    assert result["kind"] == "ask_which" and result["mention"] == "康泰"
    assert result["candidates"] == [
        {"customer_id": ids[1], "customer_name": names[ids[1]]}, {"customer_id": ids[2], "customer_name": names[ids[2]]},
    ]


def test_applying_checks_the_version_owner_and_kind(tx):
    itinerary, ids, _ = route(tx)
    moved = ask(tx, {"op": "move", "customer_id": ids[4], "to_position": 2})
    answer = ask(tx, {"op": "answer", "text": "好"})
    with pytest.raises(itinerary_ai.NotApplicable):
        itinerary_ai.apply(tx, "U01", answer.id)
    with pytest.raises(itinerary_ai.ProposalNotFound):
        itinerary_ai.apply(tx, "U02", moved.id)
    with pytest.raises(itinerary_ai.ProposalNotFound):
        itinerary_ai.apply(tx, "U01", 999999)
    service.apply_feedback(tx, "U01", ids[3], "pin", itinerary.version)
    with pytest.raises(service.VersionConflict):
        itinerary_ai.apply(tx, "U01", moved.id)


def test_asking_without_gemini_configured(tx):
    route(tx)
    with pytest.raises(NotConfigured):
        itinerary_ai.ask(tx, "U01", "幫我排順一點")
```

- [ ] **Step 3: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests/test_itinerary_ai.py -q`
Expected: 新測試 FAIL（`itinerary_ai.ask` 不存在）。

- [ ] **Step 4: AI 的輸出格式**

新檔 `backend/app/schemas/itinerary_ops.schema.json`：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "跟熊熊滾說要怎麼排：操作清單",
  "type": "object",
  "additionalProperties": false,
  "required": ["operations"],
  "properties": {
    "operations": {
      "type": "array",
      "maxItems": 12,
      "description": "照業務說的順序列出要做的操作",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["op"],
        "properties": {
          "op": {
            "type": "string",
            "enum": [
              "move", "add", "remove", "set_window", "set_duration", "set_note", "lock", "unlock",
              "add_precedence", "remove_precedence", "optimize", "add_habit", "disable_habit",
              "ask_which", "not_found", "answer"
            ]
          },
          "customer_id": {"type": "string", "description": "要動的那一家的客戶 id"},
          "to_position": {"type": "integer", "minimum": 1, "maximum": 20, "description": "move：移到第幾站（行程上的站號，含已完成的站）"},
          "before": {"type": "string", "description": "move：移到這一家的前面；add_precedence／remove_precedence：排前面的那一家"},
          "after": {"type": "string", "description": "move：移到這一家的後面；add_precedence／remove_precedence：排後面的那一家"},
          "kind": {"type": "string", "enum": ["at", "before", "after", "none"], "description": "set_window：at 幾點到、before 幾點以前、after 幾點以後、none 不約了"},
          "time": {"type": "string", "description": "set_window：24 小時制 HH:MM"},
          "minutes": {"type": "integer", "minimum": 5, "maximum": 480, "description": "set_duration：停留幾分鐘"},
          "text": {"type": "string", "description": "set_note：備註；answer：回答的話"},
          "habit": {
            "type": "object",
            "additionalProperties": false,
            "required": ["kind", "subject"],
            "description": "add_habit：要記的習慣",
            "properties": {
              "kind": {"type": "string", "enum": ["precedence", "first", "last", "window", "duration"]},
              "subject": {
                "type": "object",
                "additionalProperties": false,
                "required": ["by", "value"],
                "properties": {
                  "by": {"type": "string", "enum": ["customer", "chain", "type", "area"]},
                  "value": {"type": "string"}
                }
              },
              "object": {
                "type": "object",
                "additionalProperties": false,
                "required": ["by", "value"],
                "properties": {
                  "by": {"type": "string", "enum": ["customer", "chain", "type", "area"]},
                  "value": {"type": "string"}
                }
              },
              "window_kind": {"type": "string", "enum": ["at", "before", "after"]},
              "window_time": {"type": "string", "description": "24 小時制 HH:MM"},
              "duration_minutes": {"type": "integer", "minimum": 5, "maximum": 480},
              "weekday": {"type": "integer", "minimum": 0, "maximum": 6, "description": "0 是星期一、6 是星期日；每天就不填"}
            }
          },
          "habit_id": {"type": "integer", "description": "disable_habit：要停用的習慣 id"},
          "mention": {"type": "string", "description": "ask_which／not_found：業務原話裡的名字"},
          "candidates": {"type": "array", "maxItems": 5, "items": {"type": "string"}, "description": "ask_which：可能是哪幾家的客戶 id"}
        }
      }
    }
  }
}
```

- [ ] **Step 5: 服務**

`backend/app/services/itinerary_ai.py` 整份換成（保留 Task 2 的 `PROPOSAL_RETENTION` 與 `purge_proposals`）：

```python
"""跟熊熊滾說要怎麼排（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈跟熊熊滾說要怎麼排：後端〉）。

AI 只負責聽懂話：Gemini 把一句話翻成固定格式的操作（schemas/itinerary_ops.schema.json），
順序一律由排序程式算（route_planner），AI 不可能排出違反規則的順序。
操作先驗證（只留這位業務自己的客戶與習慣，不合的轉成「找不到」），再在目前行程的草稿上依序做完，
算出「現在 → 改成」的對照卡，存成提案。業務按「套用」時，版本要跟算提案時一樣，
照存下來的操作在最新的行程上再做一次（不信前端傳來的內容），照調整清單存檔的規則寫進去。
"""

from __future__ import annotations

import datetime as dt
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.llm import LLM, get_llm
from app.models import Customer, Itinerary, ItineraryProposal, RouteHabit
from app.services import itinerary as itinerary_service
from app.services import route_habits, today_route

# 提案只留最近 7 天：套用要看當天的行程，舊的只剩下查問題時有用
PROPOSAL_RETENTION = dt.timedelta(days=7)
SCHEMA_FILE = Path(__file__).resolve().parents[1] / "schemas" / "itinerary_ops.schema.json"
SCHEMA: dict[str, Any] = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
WEEKDAY = "一二三四五六日"
WINDOW_WORD = {"at": "到", "before": "以前到", "after": "以後到"}
# 這幾種操作要動行程上的某一站
STOP_OPS = ("move", "remove", "set_window", "set_duration", "set_note", "lock", "unlock")
CUSTOMER_FIELDS = ("customer_id", "before", "after")

SYSTEM = """你是「熊熊滾」，幫醫藥業務調整今天的拜訪行程。你只負責聽懂業務說的話，把它翻成操作清單；順序由系統的排序程式算，你不用自己排。

規則：
- 客戶一律用下面清單裡的 id（customer_id、before、after、candidates）。清單裡沒有的店不要自己編 id，改用 not_found，mention 寫業務說的名字。
- 業務說的名字對到兩家以上（例如只說「康泰」），從上下文又看不出是哪一家：只回一個 ask_which，mention 寫他說的名字，candidates 列可能的客戶 id（最多 5 家），不要回其他操作。
- 「先去 A 再去 B」「A 要在 B 前面」：add_precedence（before 是 A、after 是 B），再加一個 optimize。
- 「幫我排順一點」「重排」「怎麼跑比較順」：optimize。
- 把某一家移到第幾站、移到某一家的前面或後面：move（to_position 是下面行程上的站號，從 1 起算、含已完成的站；或 before／after 寫另一家的 id）。
- 今天也要去、加一家：add；今天不去了：remove。
- 約時間：set_window（kind：at 幾點到、before 幾點以前、after 幾點以後、none 不約了；time 寫 24 小時制 HH:MM）。待多久：set_duration（minutes）。備註：set_note。鎖住、解鎖：lock、unlock。
- 業務說「以後」「每次」「每個星期幾」「記住」：add_habit。對象 by 是 customer（客戶 id）、chain（連鎖體系，例如「康泰連鎖藥局」）、type（chain 連鎖藥局、independent 獨立藥局、clinic 診所）、area（地區，例如「板橋」）。kind：precedence（subject 排在 object 前面）、first（先跑）、last（排最後）、window（約的時段，填 window_kind、window_time）、duration（停留，填 duration_minutes）。weekday 0 是星期一、6 是星期日，每天就不填。今天的行程也要照這條排的話，再加一個 optimize。
- 業務說某一條習慣不要了、先停掉：disable_habit（habit_id 用下面習慣清單的 id）。
- 只是問問題（例如「為什麼杏林排第一？」「今天幾點收工？」），不要改行程：只回一個 answer，text 用繁體中文、一到三句，照下面行程寫的時間與理由回答，不要編造。
- 一句話裡有好幾件事就回好幾個操作，照業務說的順序。不要回業務沒有要求的操作。"""


class ProposalNotFound(LookupError):
    """找不到這個提案，或不是這位業務的。"""


class NotApplicable(ValueError):
    """這個提案不能套用：只是回答、要選一個、排不出來，或沒有要改的。"""


@dataclass
class Built:
    """操作在目前行程的草稿上依序做完的結果（還沒排順路）。"""

    draft: itinerary_service.Draft
    optimize: bool = False
    phrases: list[str] = field(default_factory=list)  # 說明做了什麼，接成對照卡上的那一句
    notes: list[str] = field(default_factory=list)  # 做不到的部分
    habits_added: list[str] = field(default_factory=list)
    habits_disabled: list[str] = field(default_factory=list)


def ask(
    session: Session, user_id: str, question: str, customer_id: str | None = None, llm: LLM | None = None
) -> ItineraryProposal:
    """跟熊熊滾說一句話：呼叫一次 Gemini 把話翻成操作，算出對照卡存成提案。
    customer_id 是「要選一個」時業務按的那一家，跟原句一起再送一次。Gemini 沒設定丟 NotConfigured。"""
    itinerary = itinerary_service.get_or_create(session, user_id)
    llm = llm or get_llm()
    operations = interpret(session, itinerary, question, customer_id, llm)
    return _propose(session, itinerary, question, operations)


def optimize(session: Session, user_id: str) -> ItineraryProposal:
    """「幫我排順一點」：整條重排，回同一種對照卡。不呼叫 Gemini。"""
    itinerary = itinerary_service.get_or_create(session, user_id)
    return _propose(session, itinerary, None, [{"op": "optimize"}])


def apply(session: Session, user_id: str, proposal_id: int) -> Itinerary:
    """套用提案：版本要跟算提案時一樣，照存下來的操作在最新的行程上再做一次（不信前端傳來的內容），
    照調整清單存檔的規則寫進去（順序還違反的今天的先後拿掉、習慣今天不套用）。"""
    itinerary = itinerary_service.get_or_create(session, user_id)
    proposal = session.get(ItineraryProposal, proposal_id)
    owner = session.get(Itinerary, proposal.itinerary_id) if proposal else None
    if proposal is None or owner is None or owner.user_id != user_id:
        raise ProposalNotFound(proposal_id)
    if proposal.result["kind"] != "proposal" or not proposal.result["changed"]:
        raise NotApplicable(proposal_id)
    if proposal.itinerary_id != itinerary.id or proposal.base_version != itinerary.version:
        raise itinerary_service.VersionConflict
    try:
        built = _build(session, itinerary, proposal.operations)
        draft, _, _ = _settle(session, itinerary, built)
    except itinerary_service.InvalidDraft:
        raise itinerary_service.VersionConflict from None
    if draft is None:
        # 問完之後習慣改了（習慣頁不會改行程的版本），現在排不出來：當成行程改過了，請業務重算
        raise itinerary_service.VersionConflict
    return itinerary_service.save(session, user_id, proposal.base_version, draft, habit_source="ai")


def interpret(
    session: Session, itinerary: Itinerary, question: str, customer_id: str | None, llm: LLM
) -> list[dict[str, Any]]:
    """呼叫一次 Gemini，把業務的話翻成操作清單，再驗證成只有這位業務自己的客戶與習慣。"""
    customers = _customers(session, itinerary.user_id)
    habits = [h for h in route_habits.mine(session, itinerary.user_id) if h.active]
    prompt = _prompt(session, itinerary, question, customer_id, customers, habits)
    raw = llm.json(system=SYSTEM, prompt=prompt, schema=SCHEMA, effort="low")
    return normalize(raw.get("operations") or [], customers, {h.id for h in habits})


def normalize(
    operations: list[dict[str, Any]], customers: dict[str, Customer], habit_ids: set[int]
) -> list[dict[str, Any]]:
    """只留這位業務自己的客戶與習慣：提到不認得的客戶（別人的、編出來的、直接寫店名的）或不是他的習慣，
    整個操作換成 not_found（mention 是原本寫的）；欄位不合的（時間格式、分鐘數、少了必要的客戶）直接丟掉。"""
    out: list[dict[str, Any]] = []
    for op in operations:
        name = op.get("op")
        if name == "answer":
            if op.get("text"):
                out.append({"op": "answer", "text": str(op["text"])})
        elif name == "not_found":
            out.append({"op": "not_found", "mention": str(op.get("mention") or "")})
        elif name == "ask_which":
            mine = [cid for cid in op.get("candidates") or [] if cid in customers][:5]
            mention = str(op.get("mention") or "")
            out.append({"op": "ask_which", "mention": mention, "candidates": mine} if mine else {"op": "not_found", "mention": mention})
        elif name == "optimize":
            out.append({"op": "optimize"})
        elif name == "disable_habit":
            habit_id = op.get("habit_id")
            out.append({"op": name, "habit_id": habit_id} if habit_id in habit_ids else {"op": "not_found", "mention": f"習慣 {habit_id}"})
        elif name == "add_habit":
            if isinstance(op.get("habit"), dict):
                out.append({"op": name, "habit": op["habit"]})
        elif name in (*STOP_OPS, "add", "add_precedence", "remove_precedence"):
            refs = {key: op[key] for key in CUSTOMER_FIELDS if op.get(key)}
            unknown = next((value for value in refs.values() if value not in customers), None)
            if unknown is not None:
                out.append({"op": "not_found", "mention": str(unknown)})
                continue
            clean = _clean(name, op, refs)
            if clean is not None:
                out.append(clean)
    return out


def _clean(name: str, op: dict[str, Any], refs: dict[str, str]) -> dict[str, Any] | None:
    """一個提到客戶的操作只留要用的欄位；少了必要的、格式不合就是 None。"""
    if name in ("add_precedence", "remove_precedence"):
        before, after = refs.get("before"), refs.get("after")
        return {"op": name, "before": before, "after": after} if before and after and before != after else None
    if "customer_id" not in refs:
        return None
    clean: dict[str, Any] = {"op": name, "customer_id": refs["customer_id"]}
    if name == "move":
        position = op.get("to_position")
        if isinstance(position, int):
            clean["to_position"] = position
        elif refs.get("before") or refs.get("after"):
            clean.update({key: refs[key] for key in ("before", "after") if key in refs})
        else:
            return None
    elif name == "set_window":
        kind, time = op.get("kind"), str(op.get("time") or "")
        if kind == "none":
            clean["kind"] = "none"
        elif kind in ("at", "before", "after") and TIME.match(time):
            clean.update(kind=kind, time=time)
        else:
            return None
    elif name == "set_duration":
        minutes = op.get("minutes")
        if not isinstance(minutes, int) or not 5 <= minutes <= 480:
            return None
        clean["minutes"] = minutes
    elif name == "set_note":
        clean["text"] = str(op.get("text") or "").strip()[:200]
    return clean


def _propose(
    session: Session, itinerary: Itinerary, question: str | None, operations: list[dict[str, Any]]
) -> ItineraryProposal:
    proposal = ItineraryProposal(
        itinerary_id=itinerary.id, base_version=itinerary.version, question=question, operations=operations,
        result=_result(session, itinerary, operations),
    )
    session.add(proposal)
    session.flush()
    return proposal


def _result(session: Session, itinerary: Itinerary, operations: list[dict[str, Any]]) -> dict[str, Any]:
    """對照卡的內容。有 ask_which 就只回「要選一個」；只有 answer（加上找不到的）就只回答；
    其他照操作算出新的行程：排不出來是 conflict，排得出來是 proposal（changed 是 False 時沒有「套用」）。"""
    customers = _customers(session, itinerary.user_id)
    pick = next((op for op in operations if op["op"] == "ask_which"), None)
    if pick:
        return _card("ask_which", mention=pick["mention"], candidates=[
            {"customer_id": cid, "customer_name": customers[cid].name} for cid in pick["candidates"]
        ])
    acting = [op for op in operations if op["op"] not in ("answer", "not_found")]
    answers = [op["text"] for op in operations if op["op"] == "answer"]
    if answers and not acting:
        notes = [f"找不到『{op['mention']}』" for op in operations if op["op"] == "not_found" and op["mention"]]
        return _card("answer", text=answers[0], notes=notes)
    built = _build(session, itinerary, operations)
    before = itinerary_service.view(session, itinerary)
    draft, conflict, costs = _settle(session, itinerary, built)
    if draft is None:
        return _card(
            "conflict", summary="，".join(built.phrases), conflict=conflict, notes=built.notes, before=_side(before),
            estimated=before.estimated,
        )
    original = itinerary_service.draft_of(session, itinerary)
    phrases = list(built.phrases)
    if built.optimize:
        moved = [s.customer_id for s in draft.stops] != [s.customer_id for s in built.draft.stops]
        if moved:
            phrases.append("重新排了順序")
    changed = (
        (draft.stops, draft.precedences) != (original.stops, original.precedences)
        or bool(built.habits_added or built.habits_disabled)
    )
    if not changed:
        summary = "現在的順序已經是最順的了" if built.optimize and not built.phrases else "沒有要改的"
        return _card("proposal", summary=summary, notes=built.notes, before=_side(before), estimated=before.estimated)
    after = itinerary_service.shown(session, itinerary, draft)
    rules = {rule.id: rule for rule in after.rules}
    dropped = [
        f"拿掉今天的先後『{rules[rid].text}』，因為跟這個順序不合" if rid.startswith("today:")
        else f"今天不套用『{rules[rid].text}』，因為跟這個順序不合"
        for rid in after.violations
    ]
    late = [
        f"{stop.customer_name} 會晚到 {stop.late_minutes} 分"
        for stop in after.stops if stop.status != "done" and stop.late_minutes > 0
    ]
    return _card(
        "proposal", summary="，".join(phrases), changed=True, before=_side(before), after=_side(after),
        rule_costs=costs, late=late, habits_added=built.habits_added, habits_disabled=built.habits_disabled,
        dropped=dropped, notes=built.notes, estimated=before.estimated or after.estimated,
    )


def _card(kind: str, **values: Any) -> dict[str, Any]:
    """對照卡的每一個欄位都在，前端不用猜哪個有、哪個沒有。"""
    empty: dict[str, Any] = {
        "kind": kind, "summary": "", "changed": False, "before": None, "after": None, "rule_costs": [], "late": [],
        "habits_added": [], "habits_disabled": [], "dropped": [], "notes": [], "conflict": [], "mention": None,
        "candidates": [], "text": None, "estimated": True,
    }
    return empty | values


def _side(view: itinerary_service.ItineraryView) -> dict[str, Any]:
    """對照卡的一欄：還沒跑的站（幾點到、會晚到幾分）與總車程。"""
    return {
        "stops": [
            {
                "customer_id": s.customer_id, "customer_name": s.customer_name, "planned_time": s.planned_time,
                "late_minutes": s.late_minutes,
            }
            for s in view.stops if s.status != "done"
        ],
        "travel_minutes": view.travel_minutes,
        "travel_km": view.travel_km,
    }


def _settle(
    session: Session, itinerary: Itinerary, built: Built
) -> tuple[itinerary_service.Draft | None, list[str], list[str]]:
    """要排順路就整條重排。回 (最後的草稿, 擋住的規則, 每條規則讓路線多繞多少)；排不出來時草稿是 None。"""
    if not built.optimize:
        return built.draft, [], []
    result = itinerary_service.optimized(session, itinerary, built.draft)
    return result.draft, result.conflict, result.costs


def _build(session: Session, itinerary: Itinerary, operations: list[dict[str, Any]]) -> Built:
    """在目前行程的草稿上依序做完這些操作（不存）。做不到的寫進 notes。
    加了今天的先後或今天就套用的習慣、順序卻違反它，就當成也要排順路：不然套用時，新的規則會因為順序不合被拿掉。"""
    draft = itinerary_service.draft_of(session, itinerary)
    draft.new_source = "ai"
    built = Built(draft)
    customers = _customers(session, itinerary.user_id)
    names = {cid: c.name for cid, c in customers.items()}
    done = {c.id for _, c in today_route.done_visits(session, itinerary.user_id, itinerary.date)}
    habits = {h.id: h for h in route_habits.mine(session, itinerary.user_id)}
    options = route_habits.targets(session, itinerary.user_id)
    new_rules: set[str] = set()

    def stop_of(cid: str) -> itinerary_service.DraftStop | None:
        found = next((s for s in built.draft.stops if s.customer_id == cid), None)
        if found is None:
            built.notes.append(f"{names[cid]} 今天已經去過了" if cid in done else f"{names[cid]} 不在今天的行程裡")
        return found

    for op in operations:
        name = op["op"]
        if name == "not_found":
            if op["mention"]:
                built.notes.append(f"找不到『{op['mention']}』")
        elif name == "optimize":
            built.optimize = True
        elif name == "add":
            cid = op["customer_id"]
            try:
                built.draft = itinerary_service.with_stop(session, itinerary, built.draft, cid)
                built.phrases.append(f"加了 {names[cid]}")
            except itinerary_service.InvalidDraft as exc:
                built.notes.append(f"{names[cid]}：{exc}")
        elif name in STOP_OPS:
            stop = stop_of(op["customer_id"])
            if stop is not None:
                _change_stop(built, stop, op, names, len(done))
        elif name in ("add_precedence", "remove_precedence"):
            pair = (op["before"], op["after"])
            if stop_of(pair[0]) is None or stop_of(pair[1]) is None:
                continue
            text = f"{names[pair[0]]} 排在 {names[pair[1]]} 前面"
            if name == "add_precedence" and pair not in built.draft.precedences:
                built.draft.precedences.append(pair)
                built.phrases.append(f"加了一條『{text}』")
                new_rules.add(f"today:{pair[0]}>{pair[1]}")
            elif name == "remove_precedence" and pair in built.draft.precedences:
                built.draft.precedences.remove(pair)
                built.phrases.append(f"拿掉『{text}』")
        elif name == "add_habit":
            _add_habit(built, op["habit"], options, names, itinerary.date, new_rules)
        elif name == "disable_habit":
            habit = habits.get(op["habit_id"])
            if habit is None:
                # 問完之後在習慣頁刪掉了
                built.notes.append(f"找不到『習慣 {op['habit_id']}』")
                continue
            built.draft.disabled_habit_ids.append(habit.id)
            built.habits_disabled.append(habit.text)
            built.phrases.append(f"停用習慣『{habit.text}』")
    if not built.optimize and new_rules & set(itinerary_service.broken_rules(session, itinerary, built.draft)):
        built.optimize = True
    return built


def _change_stop(
    built: Built, stop: itinerary_service.DraftStop, op: dict[str, Any], names: dict[str, str], done: int
) -> None:
    """改行程上的一站：移動、拿掉、約的時間、停留、備註、鎖住。done 是跑完幾站，站號要扣掉。"""
    name, cid, stops = op["op"], op["customer_id"], built.draft.stops
    label = names[cid]
    if name == "remove":
        stops.remove(stop)
        built.draft.precedences = [p for p in built.draft.precedences if cid not in p]
        built.phrases.append(f"拿掉 {label}")
    elif name == "move":
        rest = [s for s in stops if s is not stop]
        if "to_position" in op:
            index = min(max(op["to_position"] - 1 - done, 0), len(rest))
            phrase = f"{label} 移到第 {op['to_position']} 站"
        else:
            other = op.get("before") or op.get("after")
            anchor = next((n for n, s in enumerate(rest) if s.customer_id == other), None)
            if anchor is None:
                built.notes.append(f"{names[other]} 不在今天的行程裡")
                return
            index = anchor if op.get("before") else anchor + 1
            phrase = f"{label} 移到 {names[other]} {'前面' if op.get('before') else '後面'}"
        built.draft.stops = [*rest[:index], stop, *rest[index:]]
        built.phrases.append(phrase)
    elif name == "set_window":
        if op["kind"] == "none":
            stop.window_kind, stop.window_time = None, None
            built.phrases.append(f"{label} 不約時間")
        else:
            stop.window_kind, stop.window_time = op["kind"], dt.time.fromisoformat(op["time"])
            built.phrases.append(f"{label} 約 {op['time']} {WINDOW_WORD[op['kind']]}")
    elif name == "set_duration":
        stop.duration_minutes = op["minutes"]
        built.phrases.append(f"{label} 停 {op['minutes']} 分")
    elif name == "set_note":
        stop.note = op["text"] or None
        built.phrases.append(f"{label} 的備註改成『{op['text']}』" if op["text"] else f"拿掉 {label} 的備註")
    elif name in ("lock", "unlock"):
        stop.locked = name == "lock"
        built.phrases.append(f"鎖住 {label}" if stop.locked else f"{label} 解鎖")


def _add_habit(
    built: Built, raw: dict[str, Any], options: dict[str, list[tuple[str, str]]], names: dict[str, str],
    today: dt.date, new_rules: set[str],
) -> None:
    """要記的習慣先驗證（對象要是這位業務自己的），套用時才建。今天就套用的先後、先跑、排最後算新的規則。"""
    try:
        time = raw.get("window_time")
        spec = route_habits.HabitSpec(
            kind=raw.get("kind", ""), subject=raw.get("subject") or {}, object=raw.get("object"),
            window_kind=raw.get("window_kind"), window_time=dt.time.fromisoformat(time) if time and TIME.match(time) else None,
            duration_minutes=raw.get("duration_minutes"), weekday=raw.get("weekday"),
        )
        route_habits.validate(spec, options)
    except route_habits.InvalidHabit as exc:
        built.notes.append(f"記不起來這條習慣：{exc}")
        return
    built.draft.habits.append(itinerary_service.PendingHabit(spec))
    text = route_habits.describe(spec, names)
    built.habits_added.append(text)
    built.phrases.append(f"記了一條習慣『{text}』")
    if spec.kind in route_habits.RULE_KINDS and (spec.weekday is None or spec.weekday == today.weekday()):
        new_rules.add(f"new:{len(built.draft.habits) - 1}")


def _prompt(
    session: Session, itinerary: Itinerary, question: str, customer_id: str | None,
    customers: dict[str, Customer], habits: list[RouteHabit],
) -> str:
    """給 Gemini 的提示：今天的行程、今天設的先後、他的習慣、他的客戶清單、今天星期幾，最後是業務說的話。"""
    view = itinerary_service.view(session, itinerary)
    names = {s.customer_id: s.customer_name for s in view.stops}
    lines = [
        f"今天：{itinerary.date:%Y-%m-%d}（星期{WEEKDAY[itinerary.date.weekday()]}）",
        "",
        "今天的行程（站號. 客戶（id）：幾點到、停多久、約的時間、鎖住、備註；為什麼排這家）：",
    ]
    for n, stop in enumerate(view.stops, start=1):
        if stop.status == "done":
            lines.append(f"{n}. {stop.customer_name}（{stop.customer_id}）：{stop.planned_time} 已完成")
            continue
        details = [f"{stop.planned_time} 到", f"停 {stop.duration_minutes} 分"]
        if stop.window_kind:
            details.append(f"約 {stop.window_time} {WINDOW_WORD[stop.window_kind]}")
        if stop.late_minutes:
            details.append(f"會晚到 {stop.late_minutes} 分")
        if stop.locked:
            details.append("鎖住")
        if stop.note:
            details.append(f"備註：{stop.note}")
        reason = f"{today_route.SIGNAL_LABEL.get(stop.signal, '')}：{stop.reason}"
        lines.append(f"{n}. {stop.customer_name}（{stop.customer_id}）：{'，'.join(details)}；{reason}")
    if view.precedences:
        lines += ["", "今天設的先後："]
        lines += [f"{names[p.before]}（{p.before}）要在 {names[p.after]}（{p.after}）前面" for p in view.precedences]
    lines += ["", "他的排序習慣（id：那句話）："]
    lines += [f"{h.id}：{h.text}" for h in habits] or ["（沒有）"]
    lines += ["", "他的客戶（名稱：id）："]
    lines += [f"{c.name}：{c.id}" for c in customers.values()]
    lines += ["", f"業務說：「{question}」"]
    if customer_id in customers:
        lines.append(f"（他剛才選了：{customers[customer_id].name}（{customer_id}））")
    return "\n".join(lines)


def _customers(session: Session, rep_id: str) -> dict[str, Customer]:
    """這位業務自己的客戶（照名稱排）：只有這些 id 是 AI 可以用的。"""
    return {
        c.id: c
        for c in session.scalars(select(Customer).where(Customer.owner_user_id == rep_id).order_by(Customer.name))
    }


def purge_proposals(session: Session, now: dt.datetime | None = None) -> int:
    """刪掉超過保存期限的提案，回傳刪了幾筆（jobs/retention.py 每天跑一次）。"""
    cutoff = (now or dt.datetime.now(dt.UTC)) - PROPOSAL_RETENTION
    return session.execute(delete(ItineraryProposal).where(ItineraryProposal.created_at < cutoff)).rowcount
```

說明：`normalize` 裡 `ask_which` 那一行太長的話照 black 的寫法拆成多行；`WINDOW_WORD` 的「以前到」「以後到」讓「約 09:40 以前到」讀得通。

- [ ] **Step 6: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests/test_itinerary_ai.py backend/tests/test_itinerary.py -q`
Expected: 全部 PASS。有測試因為假資料的位置或時間而跟預期的數字不同（例如 `late` 那一行），先確認程式照設計做、再看是不是測試的假設錯了；改測試要在報告裡講清楚為什麼。

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/itinerary_ops.schema.json backend/app/services/itinerary_ai.py backend/tests/route_fakes.py backend/tests/test_itinerary_ai.py
git commit -m "$(cat <<'EOF'
Turn a sentence into checked itinerary operations and a before-after proposal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 5: 提案的 API 與用量上限

**Files:**
- Modify: `backend/app/api/itinerary.py`
- Modify: `backend/app/usage.py`（`LIMITS`、`ROUTES` 各加一筆）
- Test: `backend/tests/test_itinerary_api.py`、`backend/tests/test_usage.py`

**Interfaces:**
- Consumes: Task 4 的 `itinerary_ai.ask`、`optimize`、`apply`、`ProposalNotFound`、`NotApplicable`、`ItineraryProposal.result` 的欄位；`backend/tests/route_fakes.py` 的 `FakeLLM`。
- Produces（前端用）：
  - `POST /api/itinerary/today/ask`：body `{"question": "...", "customer_id": null}` → `ProposalOut`；503「熊熊滾現在沒辦法排行程」（Gemini 沒設定）、502「熊熊滾這次沒聽懂，請換個說法再試一次」（模型輸出不能用、Gemini 回錯）、403、429（用量上限）
  - `POST /api/itinerary/today/optimize` → `ProposalOut`
  - `POST /api/itinerary/proposals/{id}/apply` → 行程（跟 `GET /today` 同一個格式）；404「找不到這個提案」、409「行程在你問完之後改過了」、422「這個提案不能套用」、403
  - `ProposalOut`：`id`、`question`，加上 `result` 的每一個欄位（見 Task 4）
  - 用量上限的一項：`usage.LIMITS["itinerary_ask"] = Limit("跟熊熊滾排行程", per_client_hour=30, per_day=200)`

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_itinerary_api.py`：import 區加

```python
from route_fakes import FakeLLM

from app.services import itinerary_ai
```

（`from route_fakes import FakeLLM` 跟 `import pytest` 那幾個第三方的放在一起；`app.services` 的那一行跟既有的 `from app.services import itinerary as service` 放在一起。）

檔案最後加：

```python
def test_asking_needs_gemini(client, auth):
    response = client.post("/api/itinerary/today/ask", json={"question": "幫我排順一點"}, headers=auth())
    assert response.status_code == 503 and response.json()["detail"] == "熊熊滾現在沒辦法排行程"


def test_ask_and_apply_a_proposal(client, auth, monkeypatch):
    ids = [s["customer_id"] for s in today(client, auth)["stops"]]
    llm = FakeLLM([{"op": "move", "customer_id": ids[4], "to_position": 2}])
    monkeypatch.setattr(itinerary_ai, "get_llm", lambda: llm)
    asked = client.post("/api/itinerary/today/ask", json={"question": "鶯歌店排第二站"}, headers=auth())
    assert asked.status_code == 200, asked.text
    proposal = asked.json()
    assert proposal["kind"] == "proposal" and proposal["changed"] is True and proposal["question"] == "鶯歌店排第二站"
    assert set(proposal) == {
        "id", "question", "kind", "summary", "changed", "before", "after", "rule_costs", "late", "habits_added",
        "habits_disabled", "dropped", "notes", "conflict", "mention", "candidates", "text", "estimated",
    }
    assert [s["customer_id"] for s in proposal["after"]["stops"]][:2] == [ids[0], ids[4]]
    applied = client.post(f"/api/itinerary/proposals/{proposal['id']}/apply", headers=auth())
    assert applied.status_code == 200, applied.text
    assert applied.json()["version"] == 2 and applied.json()["stops"][1]["customer_id"] == ids[4]
    again = client.post(f"/api/itinerary/proposals/{proposal['id']}/apply", headers=auth())
    assert again.status_code == 409 and again.json()["detail"] == "行程在你問完之後改過了"


def test_the_optimize_button_and_proposals_that_cannot_be_applied(client, auth):
    optimized = client.post("/api/itinerary/today/optimize", headers=auth())
    assert optimized.status_code == 200, optimized.text
    proposal = optimized.json()
    assert proposal["question"] is None and proposal["kind"] == "proposal"
    response = client.post(f"/api/itinerary/proposals/{proposal['id']}/apply", headers=auth())
    if proposal["changed"]:
        assert response.status_code == 200
    else:
        assert response.status_code == 422 and response.json()["detail"] == "這個提案不能套用"
    assert client.post("/api/itinerary/proposals/999999/apply", headers=auth()).status_code == 404


def test_managers_cannot_ask_or_apply(client, auth):
    for path in ("/api/itinerary/today/ask", "/api/itinerary/today/optimize", "/api/itinerary/proposals/1/apply"):
        response = client.post(path, json={"question": "幫我排順一點"}, headers=auth("M01"))
        assert response.status_code == 403, path
```

`backend/tests/test_usage.py` 的 `test_every_route_that_calls_gemini_is_counted` 參數表裡，`("POST", "/api/channels/search", ["attachment_search"]),` 後面加：

```python
        ("POST", "/api/itinerary/today/ask", ["itinerary_ask"]),
        ("POST", "/api/itinerary/today/optimize", []),
        ("POST", "/api/itinerary/proposals/1/apply", []),
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests/test_itinerary_api.py backend/tests/test_usage.py -q`
Expected: 新測試 FAIL（404 Not Found、`itinerary_ask` 不在 `buckets_for` 的結果裡）。

- [ ] **Step 3: 用量上限**

`backend/app/usage.py`：

`LIMITS` 裡 `"avatar": ...` 那一筆後面加：

```python
    # 跟熊熊滾說要怎麼排：一次 Flash 呼叫（約 5 千輸入、1 千輸出 token，約 US$0.006），每天用滿約 US$1.2。
    # 「幫我排順一點」不呼叫 Gemini，不算
    "itinerary_ask": Limit("跟熊熊滾排行程", per_client_hour=30, per_day=200),
```

`ROUTES` 最後（`/api/avatars/me` 那一筆後面）加：

```python
    ("POST", re.compile(r"/api/itinerary/today/ask"), "itinerary_ask", False),
```

- [ ] **Step 4: API**

`backend/app/api/itinerary.py`：

import 區加：

```python
import logging

from google.genai import errors

from app.config import NotConfigured
from app.llm import LLMOutputError
from app.services import itinerary_ai
```

（照既有的分組放：標準庫、第三方、`app`。）`router = ...` 上面加 `log = logging.getLogger(__name__)`；`STALE = ...` 下面加：

```python
NO_AI = "熊熊滾現在沒辦法排行程"
MISHEARD = "熊熊滾這次沒聽懂，請換個說法再試一次"
ASKED_STALE = "行程在你問完之後改過了"
```

`CandidateList` 之後加：

```python
class AskInput(BaseModel):
    question: str = Field(min_length=1, max_length=300)
    # 「要選一個」時業務按的那一家，跟原句一起再送一次
    customer_id: str | None = None


class ProposalStop(BaseModel):
    customer_id: str
    customer_name: str
    planned_time: str
    late_minutes: int


class ProposalSide(BaseModel):
    stops: list[ProposalStop]
    travel_minutes: int
    travel_km: float


class CustomerName(BaseModel):
    customer_id: str
    customer_name: str


class ProposalOut(BaseModel):
    """對照卡。kind：proposal 提案（changed 是 False 時沒有「套用」）、conflict 規則互相衝突排不出來、
    ask_which 名字對到好幾家要選一個、answer 只回答。一行一行的字都是後端寫好的。"""

    id: int
    question: str | None
    kind: Literal["proposal", "conflict", "ask_which", "answer"]
    summary: str
    changed: bool
    before: ProposalSide | None
    after: ProposalSide | None
    rule_costs: list[str]
    late: list[str]
    habits_added: list[str]
    habits_disabled: list[str]
    dropped: list[str]
    notes: list[str]
    conflict: list[str]
    mention: str | None
    candidates: list[CustomerName]
    text: str | None
    estimated: bool
```

`_out` 之後加：

```python
def _proposal(proposal) -> ProposalOut:
    return ProposalOut(id=proposal.id, question=proposal.question, **proposal.result)
```

檔案最後加：

```python
@router.post("/today/ask", response_model=ProposalOut)
def ask_route(session: SessionDep, body: AskInput, user: CurrentUser):
    """跟熊熊滾說要怎麼排：一次 Gemini 把話翻成操作，回對照卡（還沒套用）。算進用量上限（usage.py）。"""
    try:
        proposal = itinerary_ai.ask(session, _rep_id(user), body.question.strip(), body.customer_id)
    except NotConfigured:
        raise HTTPException(503, NO_AI) from None
    except (LLMOutputError, errors.APIError) as exc:
        log.warning("跟熊熊滾說要怎麼排：Gemini 沒有給可以用的回答：%s", exc)
        raise HTTPException(502, MISHEARD) from None
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    result = _proposal(proposal)
    session.commit()
    return result


@router.post("/today/optimize", response_model=ProposalOut)
def optimize_route(session: SessionDep, user: CurrentUser):
    """「幫我排順一點」：整條重排，回同一種對照卡。不呼叫 Gemini。"""
    try:
        proposal = itinerary_ai.optimize(session, _rep_id(user))
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    result = _proposal(proposal)
    session.commit()
    return result


@router.post("/proposals/{proposal_id}/apply", response_model=TodayItinerary)
def apply_proposal(session: SessionDep, proposal_id: int, user: CurrentUser):
    """套用提案：照存下來的操作在最新的行程上再做一次，版本對不上回 409。"""
    try:
        itinerary = itinerary_ai.apply(session, _rep_id(user), proposal_id)
    except itinerary_ai.ProposalNotFound:
        raise HTTPException(404, "找不到這個提案") from None
    except service.VersionConflict:
        raise HTTPException(409, ASKED_STALE) from None
    except itinerary_ai.NotApplicable:
        raise HTTPException(422, "這個提案不能套用") from None
    except LookupError:
        raise HTTPException(403, NO_ROUTE) from None
    # 先提交、放掉列鎖再算畫面：算車程可能要等 Google
    session.commit()
    return _out(service.view(session, itinerary))
```

注意：主管打 `/proposals/1/apply` 時，`itinerary_ai.apply` 一開始的 `get_or_create` 就丟 `LookupError`（不是 `ProposalNotFound`），所以回 403；`ProposalNotFound` 是 `LookupError` 的子類別，`except` 要排在前面。

- [ ] **Step 5: 跑測試，確認通過**

Run: `TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests -q`
Expected: 全部 PASS（整包跑一次）。

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/itinerary.py backend/app/usage.py backend/tests/test_itinerary_api.py backend/tests/test_usage.py
git commit -m "$(cat <<'EOF'
Serve ask, optimize and apply for itinerary proposals, with a usage limit on ask

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 6: 前端的資料層：提案的 API、換位標記、問與套用的狀態

**Files:**
- Modify: `frontend/src/api/route.ts`
- Modify: `frontend/src/api/transcription.ts`、`frontend/src/voice/live-transcription.ts`（客戶 id 可以不給）
- Modify: `frontend/src/lib/itinerary.ts`、`frontend/src/lib/itinerary.test.ts`
- Create: `frontend/src/lib/use-proposal.ts`

**Interfaces:**
- Consumes: Task 5 的三支 API 與 `ProposalOut`。
- Produces（Task 7、8 用）：
  - `api/route.ts`：`ProposalStop`、`ProposalSide`、`RouteProposal`、`askRoute(question, customerId?)`、`optimizeRoute()`、`applyProposal(userId, id): Promise<TodayRoute>`（成功就寫進手機的快取）
  - `startTranscriptionSession(customerId: string | null)`、`startLiveTranscription(context, stream, customerId: string | null, onText)`
  - `lib/itinerary.ts`：`proposalMarks(before: string[], after: string[]): Set<string>`、`whichQuestion(names: string[]): string`
  - `lib/use-proposal.ts`：`ProposalState`、`useProposal({ userId, onApplied })` → `{ state, error, ask(question, customerId?): Promise<boolean>, optimize(): Promise<boolean>, apply(), pick(customerId), retry(), close() }`

- [ ] **Step 1: 寫失敗的測試**

`frontend/src/lib/itinerary.test.ts`：import 的清單加 `proposalMarks`、`whichQuestion`；檔案最後加：

```ts
describe("對照卡", () => {
  it("只動了一站就只標那一站", () => {
    expect([...proposalMarks(["A", "B", "C", "D"], ["A", "D", "B", "C"])]).toEqual(["D"])
  })

  it("新加的站要標，拿掉的不用", () => {
    expect([...proposalMarks(["A", "B"], ["A", "X", "B"])]).toEqual(["X"])
    expect([...proposalMarks(["A", "B", "C"], ["A", "C"])]).toEqual([])
  })

  it("沒動就都不標；整條倒過來只留一站不標", () => {
    expect(proposalMarks(["A", "B", "C"], ["A", "B", "C"]).size).toBe(0)
    expect(proposalMarks(["A", "B", "C"], ["C", "B", "A"]).size).toBe(2)
  })

  it("要選一個的問句", () => {
    expect(whichQuestion(["康泰 · 忠孝店", "康泰 · 大安店"])).toBe("你是說康泰 · 忠孝店，還是康泰 · 大安店？")
    expect(whichQuestion(["甲", "乙", "丙"])).toBe("你是說甲、乙，還是丙？")
    expect(whichQuestion(["甲"])).toBe("你是說甲嗎？")
  })
})
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `cd frontend && npx vitest run src/lib/itinerary.test.ts`
Expected: FAIL（`proposalMarks` 不存在）。

- [ ] **Step 3: `lib/itinerary.ts`**

檔案最後加：

```ts
/**
 * 對照卡「改成」那一欄哪幾站標成換了位置（主色加粗）：新加的站，加上順序跟原本對不上的站。
 * 原本就照順序的那一長串（最長遞增子序列）不標，所以只動了一站時只標那一站。
 */
export function proposalMarks(before: string[], after: string[]): Set<string> {
  const was = new Map(before.map((id, index) => [id, index]))
  const kept = after.filter((id) => was.has(id))
  const ranks = kept.map((id) => was.get(id)!)
  // 一天最多 8 站，用 O(n²) 的寫法就好
  const length = ranks.map(() => 1)
  const previous = ranks.map(() => -1)
  for (let i = 0; i < ranks.length; i++) {
    for (let j = 0; j < i; j++) {
      if (ranks[j] < ranks[i] && length[j] + 1 > length[i]) {
        length[i] = length[j] + 1
        previous[i] = j
      }
    }
  }
  const steady = new Set<string>()
  for (let at = length.indexOf(Math.max(0, ...length)); at >= 0; at = previous[at]) steady.add(kept[at])
  return new Set(after.filter((id) => !steady.has(id)))
}

/** 名字對到好幾家時問的那一句：「你是說康泰 · 忠孝店，還是康泰 · 大安店？」 */
export function whichQuestion(names: string[]) {
  if (names.length <= 1) return `你是說${names[0] ?? ""}嗎？`
  return `你是說${names.slice(0, -1).join("、")}，還是${names[names.length - 1]}？`
}
```

- [ ] **Step 4: `api/route.ts`**

`RouteCandidates` 之後加：

```ts
export type ProposalStop = { customer_id: string; customer_name: string; planned_time: string; late_minutes: number }

export type ProposalSide = { stops: ProposalStop[]; travel_minutes: number; travel_km: number }

// 跟熊熊滾說要怎麼排、「幫我排順一點」回來的對照卡（後端 api/itinerary.py 的 ProposalOut）。
// 一行一行的字（規則的代價、會晚到、做不到的部分…）都是後端寫好的
export type RouteProposal = {
  id: number
  // 業務說的那句話；按「幫我排順一點」是 null
  question: string | null
  // proposal：提案（changed 是 false 時沒有「套用」）；conflict：規則互相衝突排不出來；ask_which：要選一個；answer：只回答
  kind: "proposal" | "conflict" | "ask_which" | "answer"
  summary: string
  changed: boolean
  before: ProposalSide | null
  after: ProposalSide | null
  rule_costs: string[]
  late: string[]
  habits_added: string[]
  habits_disabled: string[]
  dropped: string[]
  notes: string[]
  conflict: string[]
  mention: string | null
  candidates: { customer_id: string; customer_name: string }[]
  text: string | null
  estimated: boolean
}
```

檔案最後（`remainingStops` 前面）加：

```ts
/** 跟熊熊滾說要怎麼排（同步，通常 3～5 秒）：回對照卡，還沒套用。customerId 是「要選一個」時按的那一家 */
export function askRoute(question: string, customerId?: string) {
  return request<RouteProposal>(
    "/api/itinerary/today/ask",
    jsonBody("POST", { question, customer_id: customerId ?? null })
  )
}

/** 「幫我排順一點」：整條重排，回同一種對照卡 */
export function optimizeRoute() {
  return request<RouteProposal>("/api/itinerary/today/optimize", { method: "POST" })
}

/** 套用提案：後端照存下來的操作在最新的行程上再做一次；行程在問完之後改過了回 409 */
export async function applyProposal(userId: string, id: number) {
  const route = await request<TodayRoute>(`/api/itinerary/proposals/${id}/apply`, { method: "POST" })
  writeCache(routeKey(userId), route)
  return route
}
```

- [ ] **Step 5: 即時轉文字不一定有客戶**

`frontend/src/api/transcription.ts`：`startTranscriptionSession(customerId: string)` 改成 `startTranscriptionSession(customerId: string | null)`，上面的註解補一句「跟熊熊滾說要怎麼排時沒有特定客戶，傳 null」。

`frontend/src/voice/live-transcription.ts`：`startLiveTranscription` 的參數 `customerId: string` 改成 `customerId: string | null`；檔案開頭的說明第三句改成「錄音頁與跟熊熊滾說要怎麼排的輸入列用 import() 載入這支程式，Gemini SDK 不會算進首頁的下載量。」

- [ ] **Step 6: 問與套用的狀態**

新檔 `frontend/src/lib/use-proposal.ts`：

```ts
import { useState } from "react"

import { ApiError } from "@/api/client"
import { applyProposal, askRoute, optimizeRoute, type RouteProposal, type TodayRoute } from "@/api/route"

// idle：沒在問；asking：等熊熊滾（輸入列換成「熊熊滾想一下…」）；open：對照卡開著。
// stale：套用時行程已經在問完之後改過了（409），卡上改成「用現在的行程重算」
export type ProposalState =
  | { status: "idle" }
  | { status: "asking" }
  | { status: "open"; proposal: RouteProposal; applying: boolean; stale: boolean; error: string | null }

const OFFLINE = "連不上伺服器，請再試一次。"

/**
 * 跟熊熊滾說要怎麼排、「幫我排順一點」、套用（首頁與調整清單共用）。
 * 問的時候出錯（熊熊滾沒設定的 503、用量上限的 429、連不上）放在 error，由輸入列顯示；
 * 套用失敗留在卡上。ask、optimize 回傳有沒有拿到對照卡，輸入列拿到才清空。
 */
export function useProposal({ userId, onApplied }: { userId: string | null; onApplied: (route: TodayRoute) => void }) {
  const [state, setState] = useState<ProposalState>({ status: "idle" })
  const [error, setError] = useState<string | null>(null)

  async function run(send: () => Promise<RouteProposal>) {
    setError(null)
    setState({ status: "asking" })
    try {
      const proposal = await send()
      setState({ status: "open", proposal, applying: false, stale: false, error: null })
      return true
    } catch (reason) {
      setState({ status: "idle" })
      setError(reason instanceof ApiError ? reason.message : OFFLINE)
      return false
    }
  }

  const ask = (question: string, customerId?: string) => run(() => askRoute(question, customerId))
  const optimize = () => run(optimizeRoute)

  async function apply() {
    if (state.status !== "open" || !userId) return
    const { proposal } = state
    setState({ ...state, applying: true, error: null })
    try {
      const route = await applyProposal(userId, proposal.id)
      setState({ status: "idle" })
      onApplied(route)
    } catch (reason) {
      // 409：行程在問完之後改過了；404：提案已經不在（IT 重置了示範業務的行程）。兩種都請業務用現在的行程重算
      const stale = reason instanceof ApiError && (reason.status === 409 || reason.status === 404)
      const message = stale ? null : reason instanceof ApiError ? reason.message : "連不上伺服器，這次沒有套用，請再試一次。"
      setState({ status: "open", proposal, applying: false, stale, error: message })
    }
  }

  // 「要選一個」按了其中一家：原句加上那一家再問一次
  function pick(customerId: string) {
    if (state.status === "open" && state.proposal.question) void ask(state.proposal.question, customerId)
  }

  // 「用現在的行程重算」：同一句話再問一次；按鈕觸發的排順路就再排一次
  function retry() {
    if (state.status !== "open") return
    const question = state.proposal.question
    void (question ? ask(question) : optimize())
  }

  const close = () => setState({ status: "idle" })

  return { state, error, ask, optimize, apply, pick, retry, close }
}
```

- [ ] **Step 7: 跑測試、型別、lint**

Run: `cd frontend && npx vitest run && npm run typecheck && npm run lint`
Expected: 全部通過（`record-visit.tsx` 傳的是字串，`string | null` 照樣收）。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/route.ts frontend/src/api/transcription.ts frontend/src/voice/live-transcription.ts frontend/src/lib/itinerary.ts frontend/src/lib/itinerary.test.ts frontend/src/lib/use-proposal.ts
git commit -m "$(cat <<'EOF'
Add the proposal API, move marks and the ask-and-apply state on the frontend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 輸入列與對照卡

**Files:**
- Create: `frontend/src/components/route/ask-bar.tsx`
- Create: `frontend/src/components/route/proposal-sheet.tsx`、`frontend/src/components/route/proposal-sheet.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `RouteProposal`、`proposalMarks`、`whichQuestion`、`startLiveTranscription`；`formatMinutes`；`DriveSource`；`Mascot`。
- Produces（Task 8 用）：
  - `AskBar({ busy, error, onAsk, className? })`：`onAsk(question): Promise<boolean>`，回 true 才清空輸入框
  - `ProposalSheet({ proposal, applying, stale, error, onApply, onClose, onPick, onRetry })`

- [ ] **Step 1: 寫失敗的測試**

新檔 `frontend/src/components/route/proposal-sheet.test.ts`：

```ts
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { RouteProposal } from "@/api/route"
import { ProposalSheet } from "@/components/route/proposal-sheet"

function side(ids: string[], km = 30, minutes = 75) {
  return {
    stops: ids.map((id, n) => ({ customer_id: id, customer_name: `客戶${id}`, planned_time: `1${n}:00`, late_minutes: 0 })),
    travel_minutes: minutes,
    travel_km: km,
  }
}

function proposal(extra: Partial<RouteProposal> = {}): RouteProposal {
  return {
    id: 1, question: "先去德安再去佑生", kind: "proposal", summary: "加了一條『德安 排在 佑生 前面』，重新排了順序",
    changed: true, before: side(["A", "B", "C", "D"]), after: side(["A", "D", "B", "C"], 34, 90), rule_costs: [],
    late: [], habits_added: [], habits_disabled: [], dropped: [], notes: [], conflict: [], mention: null,
    candidates: [], text: null, estimated: true, ...extra,
  }
}

const noop = () => {}
const render = (p: RouteProposal, extra: { applying?: boolean; stale?: boolean; error?: string | null } = {}) =>
  renderToStaticMarkup(
    createElement(ProposalSheet, {
      proposal: p, applying: false, stale: false, error: null, onApply: noop, onClose: noop, onPick: noop,
      onRetry: noop, ...extra,
    })
  )

describe("ProposalSheet", () => {
  it("提案：一句話、現在與改成兩欄、換了位置的站加粗、各自的總里程與車程、套用與不用了", () => {
    const html = render(proposal({
      rule_costs: ["守住『德安 排在 佑生 前面』，比不守多繞 6 公里、15 分鐘"],
      late: ["客戶C 會晚到 25 分"],
      habits_added: ["星期一先跑板橋"],
      habits_disabled: ["康泰連鎖藥局的店排在診所前面"],
      dropped: ["今天不套用『診所排最後』，因為跟這個順序不合"],
      notes: ["找不到『長安』"],
    }))
    for (const text of [
      "加了一條『德安 排在 佑生 前面』，重新排了順序", "現在", "改成", "30 公里", "34 公里", "1 小時 30 分",
      "守住『德安 排在 佑生 前面』，比不守多繞 6 公里、15 分鐘", "客戶C 會晚到 25 分", "新增習慣：星期一先跑板橋",
      "停用習慣：康泰連鎖藥局的店排在診所前面", "今天不套用『診所排最後』，因為跟這個順序不合", "找不到『長安』", "套用", "不用了",
      "（估計）",
    ]) {
      expect(html).toContain(text)
    }
    expect(html.match(/data-moved="true"/g)).toHaveLength(1)
    expect(html).toMatch(/data-moved="true"[^>]*>.*客戶D/)
  })

  it("沒有要改的：沒有套用", () => {
    const html = render(proposal({ changed: false, summary: "現在的順序已經是最順的了", after: null }))
    expect(html).toContain("現在的順序已經是最順的了")
    expect(html).not.toContain("套用")
    expect(html).toContain("知道了")
  })

  it("排不出來：寫出擋住的規則，沒有套用", () => {
    const html = render(proposal({
      kind: "conflict", changed: false, after: null, conflict: ["德安 排在 板橋店 前面", "板橋店 鎖在第 1 站"],
    }))
    expect(html).toContain("這幾條規則互相衝突，拿掉其中一條才排得出來")
    expect(html).toContain("板橋店 鎖在第 1 站")
    expect(html).not.toContain("套用")
  })

  it("要選一個：問句與每家一顆鈕", () => {
    const html = render(proposal({
      kind: "ask_which", changed: false, before: null, after: null, mention: "康泰",
      candidates: [
        { customer_id: "C001", customer_name: "康泰 · 忠孝店" },
        { customer_id: "C081", customer_name: "康泰 · 大安店" },
      ],
    }))
    expect(html).toContain("你是說康泰 · 忠孝店，還是康泰 · 大安店？")
    expect(html.match(/data-candidate=/g)).toHaveLength(2)
  })

  it("只回答：一段話與知道了", () => {
    const html = render(proposal({ kind: "answer", changed: false, before: null, after: null, text: "因為帳款逾期最久。" }))
    expect(html).toContain("因為帳款逾期最久。")
    expect(html).toContain("知道了")
    expect(html).not.toContain("套用")
  })

  it("行程在問完之後改過了：用現在的行程重算", () => {
    const html = render(proposal(), { stale: true })
    expect(html).toContain("行程在你問完之後改過了")
    expect(html).toContain("用現在的行程重算")
    expect(html).not.toContain(">套用<")
  })

  it("Google 算的車程標 Google Maps", () => {
    expect(render(proposal({ estimated: false }))).toContain("Google Maps")
  })
})
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `cd frontend && npx vitest run src/components/route/proposal-sheet.test.ts`
Expected: FAIL（元件不存在）。

- [ ] **Step 3: 對照卡**

新檔 `frontend/src/components/route/proposal-sheet.tsx`：

```tsx
import { Loader2 } from "lucide-react"

import type { ProposalSide, RouteProposal } from "@/api/route"
import { DriveSource } from "@/components/route/drive-source"
import { Mascot } from "@/components/mascot"
import { Button } from "@/components/ui/button"
import { formatMinutes, proposalMarks, whichQuestion } from "@/lib/itinerary"
import { cn } from "@/lib/utils"

type ProposalSheetProps = {
  proposal: RouteProposal
  applying: boolean
  // 套用時行程已經在問完之後改過了（409）
  stale: boolean
  error: string | null
  onApply: () => void
  onClose: () => void
  // 「要選一個」按了其中一家
  onPick: (customerId: string) => void
  // 「用現在的行程重算」
  onRetry: () => void
}

/**
 * 熊熊滾回來的卡，從下面滑出來（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈跟熊熊滾說要怎麼排〉）：
 * 提案（「現在 → 改成」對照、規則的代價、會晚到、新增或停用的習慣、做不到的部分，按「套用」才寫進行程）、
 * 排不出來（擋住的規則，沒有套用）、要選一個（每家一顆鈕）、只回答（一段話）。
 */
export function ProposalSheet({ proposal, applying, stale, error, onApply, onClose, onPick, onRetry }: ProposalSheetProps) {
  const canApply = proposal.kind === "proposal" && proposal.changed && !stale
  return (
    <>
      <button
        type="button"
        aria-label="關掉熊熊滾的提案"
        className="fixed inset-0 z-30 bg-black/20"
        disabled={applying}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="熊熊滾的提案"
        className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-md animate-in px-2.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] duration-200 slide-in-from-bottom-4 motion-reduce:animate-none"
      >
        <div className="max-h-[80svh] overflow-y-auto rounded-2xl border-2 bg-card p-4 shadow-lip">
          {stale ? (
            <Stale onRetry={onRetry} onClose={onClose} />
          ) : (
            <>
              <Body proposal={proposal} onPick={onPick} />
              {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
              <div className="mt-4 flex gap-2">
                {canApply ? (
                  <>
                    <Button className="h-11 flex-1" disabled={applying} onClick={onApply}>
                      {applying && <Loader2 className="animate-spin" />}
                      套用
                    </Button>
                    <Button variant="outline" className="h-11 flex-1" disabled={applying} onClick={onClose}>
                      不用了
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" className="h-11 flex-1" onClick={onClose}>
                    {proposal.kind === "ask_which" ? "不用了" : "知道了"}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function Body({ proposal, onPick }: { proposal: RouteProposal; onPick: (customerId: string) => void }) {
  if (proposal.kind === "answer") {
    return <Said mascot="talk" text={proposal.text ?? ""} />
  }
  if (proposal.kind === "ask_which") {
    return (
      <>
        <Said mascot="think" text={whichQuestion(proposal.candidates.map((c) => c.customer_name))} />
        <div className="mt-3 flex flex-col gap-2">
          {proposal.candidates.map((candidate) => (
            <Button
              key={candidate.customer_id}
              data-candidate={candidate.customer_id}
              variant="outline"
              className="h-11 justify-start px-4 text-sm"
              onClick={() => onPick(candidate.customer_id)}
            >
              {candidate.customer_name}
            </Button>
          ))}
        </div>
      </>
    )
  }
  if (proposal.kind === "conflict") {
    return (
      <>
        <Said mascot="think" text="這幾條規則互相衝突，拿掉其中一條才排得出來" />
        <Lines lines={proposal.conflict} className="text-destructive" />
        <Lines lines={proposal.notes} />
      </>
    )
  }
  const marks =
    proposal.before && proposal.after
      ? proposalMarks(
          proposal.before.stops.map((s) => s.customer_id),
          proposal.after.stops.map((s) => s.customer_id)
        )
      : new Set<string>()
  return (
    <>
      <Said mascot={proposal.changed ? "yay" : "idle"} text={proposal.summary} />
      {proposal.changed && proposal.before && proposal.after && (
        <>
          <div className="mt-3 flex gap-3 rounded-xl bg-muted p-3">
            <Column title="現在" side={proposal.before} marks={new Set()} />
            <Column title="改成" side={proposal.after} marks={marks} />
          </div>
          <p className="mt-1 px-1 text-[0.6875rem] text-muted-foreground">
            車程
            <DriveSource estimated={proposal.estimated} />
          </p>
        </>
      )}
      <Lines lines={proposal.rule_costs} />
      <Lines lines={proposal.late} className="text-destructive" />
      <Lines lines={proposal.habits_added.map((text) => `新增習慣：${text}`)} className="text-success" />
      <Lines lines={proposal.habits_disabled.map((text) => `停用習慣：${text}`)} />
      <Lines lines={proposal.dropped} className="text-warning" />
      <Lines lines={proposal.notes} className="text-muted-foreground" />
    </>
  )
}

function Said({ mascot, text }: { mascot: "talk" | "think" | "yay" | "idle"; text: string }) {
  return (
    <div className="flex items-start gap-2">
      <Mascot state={mascot} size={44} bust className="shrink-0" />
      <p className="pt-1 text-sm leading-relaxed font-semibold">{text}</p>
    </div>
  )
}

function Column({ title, side, marks }: { title: string; side: ProposalSide; marks: Set<string> }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-xs font-semibold text-muted-foreground">{title}</p>
      <ol className="mt-1 flex flex-col gap-1">
        {side.stops.map((stop, index) => {
          const moved = marks.has(stop.customer_id)
          return (
            <li
              key={stop.customer_id}
              data-moved={moved || undefined}
              className={cn("flex gap-1 text-xs leading-snug", moved && "font-semibold text-primary")}
            >
              <span className="shrink-0 tabular-nums">{index + 1}.</span>
              <span className="min-w-0 break-words">{stop.customer_name}</span>
            </li>
          )
        })}
      </ol>
      <p className="mt-1.5 text-[0.6875rem] text-muted-foreground tabular-nums">
        {side.travel_km} 公里 · {formatMinutes(side.travel_minutes)}
      </p>
    </div>
  )
}

function Lines({ lines, className }: { lines: string[]; className?: string }) {
  if (lines.length === 0) return null
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {lines.map((line) => (
        <li key={line} className={cn("text-xs leading-relaxed", className)}>
          {line}
        </li>
      ))}
    </ul>
  )
}

function Stale({ onRetry, onClose }: { onRetry: () => void; onClose: () => void }) {
  return (
    <>
      <Said mascot="think" text="行程在你問完之後改過了" />
      <div className="mt-4 flex gap-2">
        <Button className="h-11 flex-1" onClick={onRetry}>
          用現在的行程重算
        </Button>
        <Button variant="outline" className="h-11 flex-1" onClick={onClose}>
          不用了
        </Button>
      </div>
    </>
  )
}
```

`Mascot` 的 `bust` 若不存在或型別不合，拿掉這個 prop（看 `components/mascot.tsx` 的 `MascotProps`）。`text-warning`、`text-success` 是 `index.css` 已有的顏色。

- [ ] **Step 4: 輸入列**

新檔 `frontend/src/components/route/ask-bar.tsx`：

```tsx
import { useEffect, useRef, useState, type FormEvent } from "react"
import { Mic, SendHorizontal, Square } from "lucide-react"

import { Mascot } from "@/components/mascot"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type AskBarProps = {
  // 等熊熊滾的時候：輸入列換成熊熊滾在想
  busy: boolean
  // 問的時候出錯（熊熊滾沒設定、用量上限、連不上）
  error: string | null
  // 回 true（拿到對照卡）才清空輸入框
  onAsk: (question: string) => Promise<boolean>
  className?: string
}

/**
 * 跟熊熊滾說要怎麼排的輸入列（首頁與調整清單的底部）。右邊麥克風用錄拜訪的即時轉文字（voice/live-transcription.ts），
 * 講完再按一次，文字留在輸入框裡，業務看過再按送出。只有業務看得到。
 */
export function AskBar({ busy, error, onAsk, className }: AskBarProps) {
  const [text, setText] = useState("")
  const [listening, setListening] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  // 離開頁面時一定要關掉麥克風
  useEffect(() => () => stopRef.current?.(), [])

  async function startListening() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError("瀏覽器不允許這個網址錄音，請改用打字。")
      return
    }
    setMicError(null)
    // iOS 只允許在使用者點擊的當下開啟聲音處理：AudioContext 要在點擊後立刻建立
    const context = new AudioContext()
    void context.resume()
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (reason) {
      void context.close()
      const denied = reason instanceof DOMException && reason.name === "NotAllowedError"
      setMicError(denied ? "沒有麥克風權限，請到瀏覽器設定允許，或改用打字。" : "麥克風開不起來，請改用打字。")
      return
    }
    let handle: { stop: () => void } | null = null
    let stopped = false
    const stop = () => {
      stopped = true
      handle?.stop()
      stream.getTracks().forEach((track) => track.stop())
      void context.close()
      stopRef.current = null
      setListening(false)
    }
    stopRef.current = stop
    setListening(true)
    const before = text.trim() ? `${text.trim()} ` : ""
    const { startLiveTranscription } = await import("@/voice/live-transcription")
    handle = await startLiveTranscription(context, stream, null, (confirmed, interim) => setText(before + confirmed + interim))
    if (stopped) {
      handle?.stop() // 連上之前就按了停
      return
    }
    if (!handle) {
      stop()
      setMicError("語音轉文字現在不能用，請改用打字。")
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const question = text.trim()
    if (!question || busy) return
    stopRef.current?.()
    if (await onAsk(question)) setText("")
  }

  const shown = error ?? micError
  return (
    <form onSubmit={submit} className={cn("flex flex-col gap-1", className)}>
      {busy ? (
        <div className="flex h-12 items-center gap-2 rounded-2xl border-2 bg-card px-3 shadow-lip" role="status">
          <Mascot state="think" size={40} bust />
          <span className="text-sm text-muted-foreground">熊熊滾想一下…</span>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            value={text}
            maxLength={300}
            onChange={(event) => setText(event.target.value)}
            placeholder="跟熊熊滾說要怎麼排…"
            aria-label="跟熊熊滾說要怎麼排"
            className="h-12 bg-card"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={cn("size-12 shrink-0", listening && "text-destructive")}
            aria-label={listening ? "講完了" : "用說的"}
            aria-pressed={listening}
            onClick={() => (listening ? stopRef.current?.() : void startListening())}
          >
            {listening ? <Square className="size-4 fill-current" /> : <Mic className="size-5" />}
          </Button>
          <Button type="submit" size="icon" className="size-12 shrink-0" disabled={!text.trim() || listening} aria-label="送出">
            <SendHorizontal className="size-5" />
          </Button>
        </div>
      )}
      {listening && <p className="px-1 text-xs text-primary">聽你說…講完再按一次麥克風</p>}
      {shown && <p className="px-1 text-xs text-destructive">{shown}</p>}
    </form>
  )
}
```

- [ ] **Step 5: 跑測試、型別、lint**

Run: `cd frontend && npx vitest run && npm run typecheck && npm run lint`
Expected: 全部通過。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/route/ask-bar.tsx frontend/src/components/route/proposal-sheet.tsx frontend/src/components/route/proposal-sheet.test.ts
git commit -m "$(cat <<'EOF'
Add the ask bar with the mic and the before-after proposal sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 8: 首頁與調整清單接上熊熊滾

**Files:**
- Create: `frontend/src/components/route/home-ask.tsx`
- Modify: `frontend/src/pages/today.tsx`（一行 import、`<main>` 的下方留白、`<BottomNav />` 前面一個元件）
- Modify: `frontend/src/pages/route-edit.tsx`

**Interfaces:**
- Consumes: Task 6 的 `useProposal`；Task 7 的 `AskBar`、`ProposalSheet`；第 2 階段的 `routeDraft`、`saveToday`。
- Produces: 首頁底部（分頁膠囊上面）固定一條輸入列；調整清單最下面「加一站」「幫我排順一點」兩顆鈕與輸入列；兩頁都會開對照卡、套用後就地更新。

- [ ] **Step 1: 首頁的輸入列**

新檔 `frontend/src/components/route/home-ask.tsx`：

```tsx
import type { TodayRoute } from "@/api/route"
import { AskBar } from "@/components/route/ask-bar"
import { ProposalSheet } from "@/components/route/proposal-sheet"
import { useProposal } from "@/lib/use-proposal"

/**
 * 首頁路線下面、底部分頁膠囊上面固定的「跟熊熊滾說要怎麼排…」，回來的對照卡從下面滑出來，
 * 按「套用」就把改好的行程交回首頁（onApplied），路線就地更新。
 */
export function HomeAsk({ userId, onApplied }: { userId: string; onApplied: (route: TodayRoute) => void }) {
  const flow = useProposal({ userId, onApplied })
  const { state } = flow
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-md px-2.5">
        <AskBar
          className="pointer-events-auto rounded-2xl bg-background/95 backdrop-blur"
          busy={state.status === "asking"}
          error={flow.error}
          onAsk={flow.ask}
        />
      </div>
      {state.status === "open" && (
        <ProposalSheet
          proposal={state.proposal}
          applying={state.applying}
          stale={state.stale}
          error={state.error}
          onApply={() => void flow.apply()}
          onClose={flow.close}
          onPick={flow.pick}
          onRetry={flow.retry}
        />
      )}
    </>
  )
}
```

`frontend/src/pages/today.tsx`：

1. `import { EditRouteLink, SkippedHabitsNote } from "@/components/route/home-extras"` 下面加一行：
   ```tsx
   import { HomeAsk } from "@/components/route/home-ask"
   ```
2. `<main className="flex-1 px-4 pt-3 pb-28">` 改成 `<main className="flex-1 px-4 pt-3 pb-48">`，上面那行註解「底部分頁列約 64px，最後的終點要露出來」改成「底部分頁列約 64px，上面再疊一條跟熊熊滾說的輸入列，最後的終點要露出來」。
3. `<BottomNav />` 前面加：
   ```tsx
      {/* 跟熊熊滾說要怎麼排：連不上、用的是手機上的舊行程時不給問 */}
      {state.status === "ready" && !state.cached && (
        <HomeAsk
          userId={user.id}
          onApplied={(next) => {
            setState({ status: "ready", route: next, cached: false })
            setHint("已套用熊熊滾的提案。")
          }}
        />
      )}
   ```

- [ ] **Step 2: 調整清單：preview 在 StrictMode 下也會補跑**

第 2 階段的 `immediateRef` 在開發模式（StrictMode 會把 effect 跑兩次）第一次就被用掉、第二次又被 abort，回到清單時的 preview 永遠跑不完。換成用 `useState` 記「這次進頁面時草稿就已經在」：

把

```tsx
  const draft = edit?.draft
  const changed = Boolean(edit && edit.history.length > 0)
  const immediateRef = useRef(Boolean(routeDraft.get()))
  useEffect(() => {
    if (!draft) return
    const immediate = immediateRef.current
    immediateRef.current = false
    if (!changed && !immediate) return
```

到這個 effect 結尾的 `}, [draft, changed])` 整段換成：

```tsx
  const draft = edit?.draft
  const changed = Boolean(edit && edit.history.length > 0)
  // 從加一站、習慣頁回來時草稿已經在：上面可能改了習慣，view 卻還是離開前那一份，這次進頁面就要照最新的草稿算
  const [returned] = useState(() => Boolean(routeDraft.get()))
  useEffect(() => {
    if (!draft || (!changed && !returned)) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      previewToday(draft, undefined, controller.signal)
        .then((view) => {
          routeDraft.showView(view, draft)
          setPreviewError(null)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setPreviewError(error instanceof ApiError ? error.message : "連不上伺服器，時間先不更新。")
        })
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [draft, changed, returned])
```

並更新上面那段註解：拿掉 `immediateRef` 的說法，改成「從加一站、習慣頁回來時（returned）也算一次」。`useRef` 若因此不再用到其他地方就保留（`promptCount` 還在用）。

- [ ] **Step 3: 調整清單：「幫我排順一點」、輸入列、對照卡、還沒存的改動**

`frontend/src/pages/route-edit.tsx`：

import 區：
- lucide 那一行加 `WandSparkles`。
- 加 `import { AskBar } from "@/components/route/ask-bar"`、`import { ProposalSheet } from "@/components/route/proposal-sheet"`、`import { useProposal } from "@/lib/use-proposal"`（照字母放）。
- `@/api/route` 那一行加 `type TodayRoute`。

在 `const [saving, setSaving] = useState(false)` 下面加：

```tsx
  // 還沒存的改動時按「幫我排順一點」或跟熊熊滾說：先問要不要存起來（提案是照存著的行程算的）
  const [unsavedAction, setUnsavedAction] = useState<(() => void) | null>(null)
  // 存完要接著做的事（先存再排）；違反規則的確認框按「照這樣存」時也接著做
  const [afterSave, setAfterSave] = useState<(() => void) | null>(null)
  const flow = useProposal({
    userId,
    onApplied: (route: TodayRoute) => {
      // 套用了：清單換成存好的那一份，從頭再改
      routeDraft.start(route)
      setExpanded(null)
      setPrompt(null)
      setHint("已套用熊熊滾的提案。")
    },
  })
```

（`useProposal` 是 hook，要放在所有 early return 之前，跟其他 `useState` 放一起。）

`save` 換成能接著做事的版本：

```tsx
  // then：存完不回首頁，清單換成存好的那一份，接著做（先存再請熊熊滾排）
  async function save(then?: () => void) {
    if (!userId || !edit) return
    setConfirming(false)
    setSaving(true)
    try {
      const saved = await saveToday(userId, base.version, current)
      if (then) {
        setSaving(false)
        setAfterSave(null)
        routeDraft.start(saved)
        then()
        return
      }
      routeDraft.clear()
      navigate("/", { replace: true })
    } catch (error) {
      setSaving(false)
      setAfterSave(null)
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
```

`finish` 後面加：

```tsx
  // 請熊熊滾排之前：沒有還沒存的改動就直接做；有的話先問要不要存
  function beforeAsking(action: () => void) {
    if (changed) setUnsavedAction(() => action)
    else action()
  }

  function saveThen(action: () => void) {
    setUnsavedAction(null)
    if (broken.length > 0) {
      // 違反的規則還沒處理：照「完成」一樣先問一次，按「照這樣存」才存、才接著做
      setAfterSave(() => action)
      setConfirming(true)
    } else void save(action)
  }

  function ask(question: string) {
    return new Promise<boolean>((resolve) => {
      if (!changed) {
        void flow.ask(question).then(resolve)
        return
      }
      setUnsavedAction(() => () => void flow.ask(question))
      resolve(false)
    })
  }
```

違反規則的確認框：`照這樣存` 那顆鈕的 `onClick={() => void save()}` 改成 `onClick={() => void save(afterSave ?? undefined)}`；`Dialog` 的 `onOpenChange` 關掉時也清掉：`onOpenChange={(visible) => { if (!visible) { setConfirming(false); setAfterSave(null) } }}`。

「加一站」那個 `<Link>` 換成兩顆並排，下面接輸入列：

```tsx
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link to="/route/edit/add" className={cn(buttonVariants({ variant: "outline" }), "h-12 text-sm")}>
            <Plus />
            加一站
          </Link>
          <Button
            variant="outline"
            className="h-12 text-sm"
            disabled={flow.state.status === "asking" || open.length < 2}
            onClick={() => beforeAsking(() => void flow.optimize())}
          >
            <WandSparkles />
            幫我排順一點
          </Button>
        </div>
        <AskBar className="mt-3" busy={flow.state.status === "asking"} error={flow.error} onAsk={ask} />
```

`{prompt && <HabitPrompt ... />}` 前面加對照卡與「還沒存」的確認框：

```tsx
      {flow.state.status === "open" && (
        <ProposalSheet
          proposal={flow.state.proposal}
          applying={flow.state.applying}
          stale={flow.state.stale}
          error={flow.state.error}
          onApply={() => void flow.apply()}
          onClose={flow.close}
          onPick={flow.pick}
          onRetry={flow.retry}
        />
      )}

      {unsavedAction && (
        <Dialog open onOpenChange={(visible) => !visible && setUnsavedAction(null)}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>剛才的調整還沒存，要先存起來再請熊熊滾排嗎？</DialogTitle>
              <DialogDescription>熊熊滾是照存著的行程排的；不先存的話，剛才的調整它看不到。</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" className="h-11" onClick={() => setUnsavedAction(null)}>
                取消
              </Button>
              <Button className="h-11" disabled={saving} onClick={() => saveThen(unsavedAction)}>
                先存再排
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
```

說明：
- `setUnsavedAction(() => action)`：React 的 setState 收到函式會當成 updater，所以要包一層。
- `ask` 有還沒存的改動時回 `false`，輸入框的字留著；存完之後 `flow.ask(question)` 照樣用同一句話問。
- 存完接著問、拿到對照卡、按「套用」：`onApplied` 把清單換成套用後的那一份。

- [ ] **Step 4: 檢查**

Run: `cd frontend && npx vitest run && npm run typecheck && npm run lint && npm run build`
Expected: 全部通過。不要開開發伺服器（實機檢查由 Task 9 在隔離的環境做）。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/route/home-ask.tsx frontend/src/pages/today.tsx frontend/src/pages/route-edit.tsx
git commit -m "$(cat <<'EOF'
Ask Bear or tap 幫我排順一點 from home and the edit list, and apply the proposal in place

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: AI 實測、文件

**Files:**
- Create: `backend/scripts/eval_itinerary_ai.py`
- Create: `data/eval/itinerary_ai_questions.json`
- Modify: `README.md`（〈今日路線（首頁）〉、〈用量上限〉、程式結構表、評測那一節）
- Modify: `docs/superpowers/specs/2026-10-01-itinerary-planning-design.md`

**Interfaces:**
- Consumes: Task 4 的 `itinerary_ai.interpret`；`itinerary.reset_today`、`get_or_create`；`route_habits.mine`。
- Produces: `uv run --project backend python backend/scripts/eval_itinerary_ai.py [--only R05]`，結果寫進 `data/eval/itinerary_ai_results.json`。

- [ ] **Step 1: 20 句話**

新檔 `data/eval/itinerary_ai_questions.json`（客戶寫店名、習慣寫那一句話，實測時查成 id；示範業務林昱辰今天的建議是 福安板橋店（需立即處理、鎖第一站）、康泰忠孝店、康泰內湖店、康泰林口店、福安鶯歌店）：

```json
{
  "說明": "跟熊熊滾說要怎麼排的實測（backend/scripts/eval_itinerary_ai.py）。系統的今天是 2026-10-28（星期三），示範業務林昱辰（U01）。每句在交易裡先重置他今天的行程與習慣、問完回滾。expect 的每一個操作都要出現（只比對有寫的欄位，客戶寫店名、習慣寫那一句話）；forbid 的操作不能出現；only 有寫的話，不能有清單以外的操作。",
  "items": [
    {"id": "R01", "question": "把鶯歌店排到第二站", "expect": [{"op": "move", "customer_id": "福安連鎖藥局 · 鶯歌店", "to_position": 2}]},
    {"id": "R02", "question": "林口店改到忠孝店前面", "expect": [{"op": "move", "customer_id": "康泰連鎖藥局 · 林口店"}]},
    {"id": "R03", "question": "今天也順便去一下德安藥局", "expect": [{"op": "add", "customer_id": "德安藥局 · 板橋"}]},
    {"id": "R04", "question": "內湖店今天不去了", "expect": [{"op": "remove", "customer_id": "康泰連鎖藥局 · 內湖店"}]},
    {"id": "R05", "question": "忠孝店約了十點半到", "expect": [{"op": "set_window", "customer_id": "康泰連鎖藥局 · 忠孝店", "kind": "at", "time": "10:30"}]},
    {"id": "R06", "question": "鶯歌店要在下午三點以前到", "expect": [{"op": "set_window", "customer_id": "福安連鎖藥局 · 鶯歌店", "kind": "before", "time": "15:00"}]},
    {"id": "R07", "question": "內湖店要待一個小時", "expect": [{"op": "set_duration", "customer_id": "康泰連鎖藥局 · 內湖店", "minutes": 60}]},
    {"id": "R08", "question": "林口店備註：找王店長拿簽收單", "expect": [{"op": "set_note", "customer_id": "康泰連鎖藥局 · 林口店"}]},
    {"id": "R09", "question": "把林口店鎖住", "expect": [{"op": "lock", "customer_id": "康泰連鎖藥局 · 林口店"}]},
    {"id": "R10", "question": "板橋店不用固定在第一站了", "expect": [{"op": "unlock", "customer_id": "福安連鎖藥局 · 板橋店"}]},
    {"id": "R11", "question": "先去內湖店再去忠孝店", "expect": [{"op": "add_precedence", "before": "康泰連鎖藥局 · 內湖店", "after": "康泰連鎖藥局 · 忠孝店"}]},
    {"id": "R12", "question": "幫我排順一點", "expect": [{"op": "optimize"}], "only": ["optimize"]},
    {"id": "R13", "question": "以後星期三都先跑板橋", "expect": [{"op": "add_habit", "habit": {"kind": "first", "subject": {"by": "area", "value": "板橋"}, "weekday": 2}}]},
    {"id": "R14", "question": "以後去杏林診所都待二十分鐘就好", "expect": [{"op": "add_habit", "habit": {"kind": "duration", "subject": {"by": "customer", "value": "杏林診所 · 大安"}, "duration_minutes": 20}}]},
    {"id": "R15", "question": "福安的店每次都排在康泰前面", "expect": [{"op": "add_habit", "habit": {"kind": "precedence", "subject": {"by": "chain", "value": "福安連鎖藥局"}, "object": {"by": "chain", "value": "康泰連鎖藥局"}}}]},
    {"id": "R16", "question": "康泰的店排在診所前面那條先不要了", "expect": [{"op": "disable_habit", "habit_id": "康泰連鎖藥局的店排在診所前面"}]},
    {"id": "R17", "question": "今天加去大樹藥局", "expect": [{"op": "not_found"}], "forbid": ["add"]},
    {"id": "R18", "question": "也去一下康泰", "expect": [{"op": "ask_which"}], "only": ["ask_which"]},
    {"id": "R19", "question": "為什麼板橋店排第一站？", "expect": [{"op": "answer"}], "only": ["answer"]},
    {"id": "R20", "question": "把王冠宇的三重店也加進來", "forbid": ["add"], "expect": []}
  ]
}
```

- [ ] **Step 2: 實測程式**

新檔 `backend/scripts/eval_itinerary_ai.py`：

```python
"""跟熊熊滾說要怎麼排的實測：20 句話，比對 Gemini 翻出來的操作（data/eval/itinerary_ai_questions.json）。

    uv run --project backend python backend/scripts/eval_itinerary_ai.py [--only R05]

會真的呼叫 Gemini（每句一次 Flash，約 US$0.006），要先在 backend/.env 設好 LLM_PROVIDER 與 LLM_API_KEY；
資料庫要是用這個分支灌過假資料的（data/seed/seed.py）。每一句都在交易裡先重置示範業務今天的行程與習慣、
問完就回滾，不會留下任何改動。結果寫進 data/eval/itinerary_ai_results.json。
"""

import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path
from typing import Any

# macOS 上 .venv 會被標成隱藏，Python 就略過可編輯安裝的 .pth、找不到 app；直接把 backend 加進搜尋路徑
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.config import NotConfigured, settings  # noqa: E402
from app.db import session_factory  # noqa: E402
from app.llm import DEFAULT_GEMINI_MODEL, get_llm  # noqa: E402
from app.models import Customer  # noqa: E402
from app.services import itinerary, itinerary_ai, route_habits  # noqa: E402
from app.services.auth import EXTERNAL_ACCOUNT_ACTS_AS  # noqa: E402

EVAL_DIR = Path(__file__).resolve().parents[2] / "data" / "eval"
REP = EXTERNAL_ACCOUNT_ACTS_AS


def resolve(value: Any, ids: dict[str, Any]) -> Any:
    """預期的操作裡，店名與習慣的那一句話換成 id；其他照舊。"""
    if isinstance(value, str):
        return ids.get(value, value)
    if isinstance(value, dict):
        return {key: resolve(item, ids) for key, item in value.items()}
    if isinstance(value, list):
        return [resolve(item, ids) for item in value]
    return value


def matches(expected: dict[str, Any], got: dict[str, Any]) -> bool:
    """有寫的欄位都要一樣；巢狀的（習慣）一樣只比對有寫的。"""
    for key, value in expected.items():
        if isinstance(value, dict):
            if not isinstance(got.get(key), dict) or not matches(value, got[key]):
                return False
        elif got.get(key) != value:
            return False
    return True


def score(item: dict[str, Any], operations: list[dict[str, Any]], ids: dict[str, Any]) -> list[str]:
    """沒達到的條件；空的代表對。"""
    misses = [
        f"少了 {json.dumps(expected, ensure_ascii=False)}"
        for expected in resolve(item.get("expect", []), ids)
        if not any(matches(expected, op) for op in operations)
    ]
    misses += [f"不該有 {op['op']}" for op in operations if op["op"] in item.get("forbid", [])]
    if item.get("only") and any(op["op"] not in item["only"] for op in operations):
        misses.append("多了 " + "、".join(op["op"] for op in operations if op["op"] not in item["only"]))
    return misses


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="只跑這一題（例如 R05）")
    only = parser.parse_args().only
    try:
        llm = get_llm()
    except NotConfigured as exc:
        print(f"沒辦法實測：{exc}。請先在 backend/.env 設定 LLM_PROVIDER 與 LLM_API_KEY。")
        return 1
    items = json.loads((EVAL_DIR / "itinerary_ai_questions.json").read_text(encoding="utf-8"))["items"]
    items = [item for item in items if only in (None, item["id"])]
    results, waits = [], []
    for item in items:
        with session_factory()() as session:
            # 每一句都從同一個起點問：示範業務今天的行程照模型的建議重建、習慣回到一開始那三條；問完回滾
            itinerary.reset_today(session, REP)
            today = itinerary.get_or_create(session, REP)
            ids: dict[str, Any] = {
                c.name: c.id for c in session.scalars(select(Customer).where(Customer.owner_user_id == REP))
            }
            ids |= {h.text: h.id for h in route_habits.mine(session, REP)}
            start = time.monotonic()
            try:
                operations, misses = itinerary_ai.interpret(session, today, item["question"], None, llm), []
            except Exception as exc:  # noqa: BLE001 — 實測要把每一題的結果都記下來，一題出錯不擋其他題
                operations, misses = [], [f"出錯：{exc}"]
            waits.append(time.monotonic() - start)
            misses = misses or score(item, operations, ids)
            session.rollback()
        print(f"{item['id']}  {waits[-1]:4.1f}s  {'對' if not misses else '錯：' + '；'.join(misses)}")
        results.append({
            "id": item["id"], "question": item["question"], "ok": not misses, "misses": misses,
            "operations": operations, "seconds": round(waits[-1], 1),
        })
    passed = sum(result["ok"] for result in results)
    print(f"\n通過 {passed}/{len(results)}")
    if waits:
        ordered = sorted(waits)
        print(f"使用者等待：中位數 {ordered[len(ordered) // 2]:.1f} 秒，最久 {ordered[-1]:.1f} 秒")
    out = {
        "run_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "model": settings().llm_model or DEFAULT_GEMINI_MODEL,
        "passed": passed,
        "total": len(results),
        "items": results,
    }
    (EVAL_DIR / "itinerary_ai_results.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

不要真的跑（會花 Gemini 的錢，由使用者用真的金鑰跑）。只確認語法與 import：

```bash
LLM_PROVIDER= uv run --project backend python backend/scripts/eval_itinerary_ai.py
```

Expected: 印出「沒辦法實測：AI 模型還沒設定。請先在 backend/.env 設定 LLM_PROVIDER 與 LLM_API_KEY。」並結束（exit 1）。

- [ ] **Step 3: README**

1. 〈今日路線（首頁）〉裡第 2 階段加的「**排序習慣**」那一點後面加：

```markdown
- **跟熊熊滾說要怎麼排**：首頁底部（分頁膠囊上面）與調整清單最下面有一條「跟熊熊滾說要怎麼排…」，可以打字，也可以按麥克風用錄拜訪的即時轉文字講，講完看過再送出。例如「先去德安再去佑生」「鶯歌店要在三點以前到」「以後星期三都先跑板橋」「為什麼杏林排第一？」。
  - **AI 只負責聽懂話，順序由程式算**（`backend/app/services/itinerary_ai.py`）：一次 Gemini（`app/llm.py` 的 `json`，用 `backend/app/schemas/itinerary_ops.schema.json` 約束）把話翻成操作清單（移動、加站、拿掉、約時間、停留、備註、鎖住、先後、排順路、記習慣、停用習慣、要選一個、找不到、只回答），客戶與習慣只能是這位業務自己的，其他的轉成「找不到」。排順序一律交給 `route_planner`，AI 不可能排出違反規則的順序；加了先後或習慣而順序不合時，自動整條重排。
  - 回來的是一張「現在 → 改成」的對照卡：一句話說明做了什麼、兩欄順序（換了位置的站加粗）、各自的總里程與車程、每條規則讓路線多繞多少（`route_planner.rule_costs`）、會晚到的站、新增或停用的習慣、做不到的部分。按「套用」才寫進行程：後端照存下來的操作在最新的行程上再做一次（不信前端傳來的內容），版本對不上就請業務用現在的行程重算。規則互相衝突排不出來時寫出是哪幾條，沒有「套用」。名字對到好幾家時先問「你是說 A，還是 B？」；只是問問題就只回答。
  - 調整清單上還有沒存的改動時，先問要不要存起來（熊熊滾是照存著的行程排的）。
  - 調整清單最下面的「幫我排順一點」不呼叫 Gemini，直接整條重排，回同一種對照卡。
  - 提案存在 `itinerary_proposal`，只留 7 天（`jobs/retention.py`）。Gemini 沒設定時回「熊熊滾現在沒辦法排行程」，拖移、加站照常可用。
  - 實測：`uv run --project backend python backend/scripts/eval_itinerary_ai.py`（20 句話，`data/eval/itinerary_ai_questions.json`；會真的呼叫 Gemini，結果寫進 `data/eval/itinerary_ai_results.json`）。
```

2. 〈用量上限〉第一個表格最後加一列：

```markdown
| 跟熊熊滾說要怎麼排 | `POST /api/itinerary/today/ask` | 30 | 200 |
```

   表格後面那一點「四項每天都被用滿時…」的下面加一點：

```markdown
- 跟熊熊滾說要怎麼排：每次一次 gemini-3.8-flash 呼叫（低推理，約 5 千輸入、1 千輸出 token，約 US$0.006），每天用滿約 US$1.2。「幫我排順一點」不呼叫 Gemini，不算。
```

3. 程式結構表 `backend/app/services/route_habits.py ...` 那一列後面加：

```
backend/app/services/itinerary_ai.py 跟熊熊滾說要怎麼排：提示、驗證操作、對照卡、套用
backend/scripts/eval_itinerary_ai.py 跟熊熊滾說要怎麼排的 20 句實測
```

- [ ] **Step 4: 設計文件**

`docs/superpowers/specs/2026-10-01-itinerary-planning-design.md`：

1. 〈排序程式〉的「`rule_costs`（每條規則多繞多少）第一階段還沒做，第三階段「跟熊熊滾說要怎麼排」才加。」換成：
   「`rule_costs(start, start_point, stops, rules, minutes) -> list[RuleCost]`：守住全部規則的最好排法，跟拿掉某一條（同一個 id 一起拿掉）重排的最好排法比，只列拿掉之後真的更好的（多開幾分鐘、多晚到幾分鐘、不守時的順序）。守住全部規則就排不出來時回空的。」
2. 〈跟熊熊滾說要怎麼排：後端〉第 5 點後面補一句：「加了今天的先後或今天就套用的習慣、順序卻不合時，當成也要排順路（不然套用時新的規則會因為順序不合被拿掉）。」第 6 點後面補：「對照卡的每一行（規則的代價、會晚到、新增或停用的習慣、做不到的部分、套用時會拿掉或今天不套用的規則）都由後端寫好。」
3. 〈跟熊熊滾說要怎麼排〉一節最後加一段：「調整清單上還有沒存的改動時按「幫我排順一點」或送出輸入列，先問「剛才的調整還沒存，要先存起來再請熊熊滾排嗎？」：「先存再排」照「完成」一樣存（違反規則時一樣先問一次），存完接著問；「取消」什麼都不做（`main` 2026-10-02 的決定）。」

- [ ] **Step 5: 全部重跑**

```bash
TEST_DB_NAME=meddemo_test_edit TEST_REDIS_URL=redis://127.0.0.1:6379/8 uv run --project backend pytest backend/tests -q
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
```
Expected: 全部成功；記下 pytest 最後一行與 vitest 的通過數。

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/eval_itinerary_ai.py data/eval/itinerary_ai_questions.json README.md docs/superpowers/specs/2026-10-01-itinerary-planning-design.md
git commit -m "$(cat <<'EOF'
Add the 20-sentence AI eval and describe asking Bear in the README and design doc

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: 實機看一次（控制端做）**

照第 2 階段的作法用隔離的環境（資料庫 `meddemo_edit_dev`、Redis 12、後端 8012、Vite 5182）重灌資料，Gemini 不設定（`LLM_PROVIDER=`）。無頭 Chrome 以 375×812、每段 20 秒內：

1. 首頁底部的輸入列（分頁膠囊上面）；送一句話 → 「熊熊滾現在沒辦法排行程」。
2. 調整清單最下面「加一站」「幫我排順一點」與輸入列；按「幫我排順一點」→ 對照卡（沒有要改的：「現在的順序已經是最順的了」）。
3. 在清單上下移一站之後按「幫我排順一點」→「剛才的調整還沒存…」→「先存再排」→ 對照卡（現在／改成兩欄、換位加粗、規則的代價）→「套用」→ 清單換成套用後的順序。
4. 從習慣頁回到清單：preview 有補跑（開發模式的 StrictMode 下）。

用假的 Gemini 看提案以外的三種卡（要選一個、只回答、排不出來）在畫面上的樣子：在 Chrome 裡用 `Page.addScriptToEvaluateOnNewDocument` 把 `/api/itinerary/today/ask` 的 `fetch` 換成回寫好的 JSON。截圖放 scratchpad，看完照第 2 階段的作法收掉環境。
