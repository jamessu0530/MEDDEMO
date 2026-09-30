# 會議意見補做的四項 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 補上會議意見裡系統完全沒有的四項：方法卡、優惠與合約簽核、依節慶的談判卡、SAP 人員主檔與新人第一週。

**Architecture:** 四項各自獨立，一位 worker 一項、各在自己的 worktree 與分支上從頭做到尾（資料表、假資料、服務、API、畫面、測試、README），
做完依序合併回 `meeting-gaps`，再做第二輪把方法卡接進談判卡與新人頁。每項的設計在 `docs/superpowers/specs/2026-09-30-*-design.md`，
這份計畫只定任務的切法、檔案、跨任務要對得上的名稱，以及每個任務要寫哪些測試；每個任務裡的步驟照 TDD 走（先寫會失敗的測試、看它失敗、
寫最少的程式讓它過、跑整套、提交），程式碼由負責的 worker 對著現有的寫法寫。

**Tech Stack:** FastAPI、SQLAlchemy 2.0、Postgres 16（pgvector、ltree）、Redis／RQ、pytest；React、Vite、Tailwind、shadcn/ui、vitest。

## Global Constraints

- 既有的假資料一筆都不變：新資料在 `generate()` 的最後產生，用自己的亂數 `random.Random(seed + n)`（方法卡 n=101、簽核 n=102、人員主檔不需要亂數）。
- 假資料不新增任何 `sap_quotation_draft`（會影響今日路線的商機）。
- 畫面上的內容不讓 AI 生成。
- 權限一律走 `backend/app/services/scope.py`，新的資料種類在 `SHARING_LEVEL` 加一列。
- 不新增角色；不新增前後端套件。
- 跟業務資料比的日期用系統日 `app_today()`；`created_at` 用真實時間。
- 不動 `schema_version` 的檔案清單（`backend/app/db.py` 與 `.github/workflows/ci-cd.yml`）。
- 程式的註解、測試名稱、提交訊息照現有的寫法：註解用繁體中文寫「為什麼」，測試名稱用英文整句，提交訊息用英文祈使句。
- 不推送、不合併到 main，不對開發用的資料庫跑 `data/seed/seed.py`。

## 環境

| 項目 | 分支／worktree | `TEST_DB_NAME` | `TEST_REDIS_URL` |
|---|---|---|---|
| 合併用 | `meeting-gaps`／`.worktrees/meeting-gaps` | `meddemo_test_mg` | `redis://127.0.0.1:6379/10` |
| A 方法卡 | `mg-methods`／`.worktrees/mg-methods` | `meddemo_test_methods` | `redis://127.0.0.1:6379/11` |
| B 簽核 | `mg-approvals`／`.worktrees/mg-approvals` | `meddemo_test_approvals` | `redis://127.0.0.1:6379/12` |
| C 談判卡 | `mg-negotiation`／`.worktrees/mg-negotiation` | `meddemo_test_negotiation` | `redis://127.0.0.1:6379/13` |
| D 新人頁 | `mg-first-week`／`.worktrees/mg-first-week` | `meddemo_test_firstweek` | `redis://127.0.0.1:6379/14` |

每個 worktree 都從自己的根目錄執行：

```bash
# 後端（整套；單一檔案就把路徑換掉）
TEST_DB_NAME=<上表> TEST_REDIS_URL=<上表> uv run --project backend pytest backend/tests -q
# 前端（第一次先 npm ci）
cd frontend && npm ci && npm run typecheck && npm test && npm run lint
```

資料庫與 Redis 已經用 Docker 跑著（Postgres 在 5433、Redis 在 6379）。測試會自己建、自己灌測試資料庫。

**每個任務結束的條件**：這個任務新增的測試通過、後端整套通過、（有動前端時）typecheck、vitest、lint 通過，然後提交。

---

## A. 方法卡（`mg-methods`）

設計：`docs/superpowers/specs/2026-09-30-method-cards-design.md`。第一輪做到「測試」那一節為止；「第二輪」那一節不做。

### Task A1: 資料表與示範資料

**Files:**
- Modify: `backend/app/models.py`（檔尾加 `METHOD_TAGS`、`METHOD_CARD_STATUSES`、`MethodCard`、`MethodCardFeedback`）
- Modify: `data/seed/catalog.py`（檔尾加 `METHOD_CARDS`）、`data/seed/generate.py`（`build_method_cards`，在 `generate()` 最後呼叫）、`data/seed/seed.py`
- Test: `backend/tests/test_seed.py`

**Interfaces:**
- Produces: `models.METHOD_TAGS = ("competitor", "interval_up", "contract_ending", "ar_overdue", "festival", "cost", "newcomer")`；
  `MethodCard`（`id`、`title`、`situation`、`approach`、`customer_type`、`tags`、`author_id`、`status`、`created_at`、`updated_at`）；
  `MethodCardFeedback`（`id`、`card_id`、`user_id`、`customer_id`、`helped`、`created_at`；唯一限制 `(card_id, user_id, customer_id)` 加 `postgresql_nulls_not_distinct=True`）。

- [ ] 測試先行（`test_seed.py`）：每個標籤至少一張上架的卡；`newcomer` 至少三張；作者都是主管；回饋的人都是業務、客戶都是那位業務名下的；
  同一個 `(card, user, customer)` 沒有重複；既有的 `test_generation_is_deterministic` 照過。
- [ ] 資料表。`tags` 用 `list[str]`（ARRAY），加 CHECK `cardinality(tags) > 0`；標籤值的檢查放服務層（陣列不好寫 CHECK）。
- [ ] `catalog.METHOD_CARDS`：十張手寫的卡（標題、情況、做法、適用類型、標籤、作者工號、目標採用次數、沒幫上次數）。內容照設計文件「示範資料」列的情境。
- [ ] `generate.build_method_cards(as_of, seed)`：用 `random.Random(seed + 101)` 把每張卡的回饋分散到五位業務與各自名下的客戶上。
  `method_card.id` 是 `GENERATED ALWAYS`，灌資料時不能指定：卡片與回饋照 `seed.seed_conversations` 的做法在 `seed.py` 寫入——先寫卡片，
  再用標題查回 id 寫回饋；`created_at` 從灌資料那一刻往前推。
- [ ] 驗證既有資料不變：跑下面的指令，印出來的筆數與指紋要跟底下這份（`meeting-gaps` 開工前的產出）一模一樣。

```bash
uv run --project backend python - <<'EOF'
import hashlib, json, sys
sys.path.insert(0, "data/seed")
from datetime import date
import generate
data = generate.generate(date(2026, 10, 28))
keys = ["org_unit", "place", "app_user", "product", "promotion", "promotion_item", "customer",
        "sales_transaction", "receivable", "visit", "crm_visit_record", "sap_quotation_draft", "writeback_log"]
for key in keys:
    rows = [{k: v for k, v in row.items() if k != "password_hash"} for row in data[key]]
    print(key, len(rows), hashlib.sha256(json.dumps(rows, default=str, sort_keys=True).encode()).hexdigest()[:12])
EOF
```

```
org_unit 4 b3f60cfbecff
place 17 f1ed0f83376b
app_user 10 6b2a5303dda0
product 60 cf5383f0423e
promotion 3 a4ada0e4dccc
promotion_item 111 ac9d3495cee9
customer 250 0b4d28d878a3
sales_transaction 45923 0fd1ca59a51f
receivable 3456 0a9486f188b5
visit 5223 484bbb2a6589
crm_visit_record 5223 c726055c73f4
sap_quotation_draft 295 c2716746b795
writeback_log 15669 09fafc564144
```

（`oa_expense_form` 開工前是 5,223 列出差單；簽核那一項會幫每列加新欄位並加新的列，所以不在清單裡。）

- [ ] 提交。

### Task A2: 服務與 API

**Files:**
- Create: `backend/app/services/method_cards.py`、`backend/app/api/methods.py`、`backend/tests/test_methods.py`
- Modify: `backend/app/services/scope.py`（`SHARING_LEVEL["method_card"] = ROOT`）、`backend/app/main.py`

**Interfaces:**
- Produces（第二輪會用）：
  `method_cards.card_out(session, card, user, customer_id=None) -> dict`，鍵是 `id`、`title`、`situation`、`approach`、`customer_type`、`tags`、
  `author_name`、`status`、`adopted`、`not_helped`、`my_feedback`、`updated_at`；
  `method_cards.list_published(session, user, *, tag=None, customer_type=None, q=None, customer_id=None) -> list[dict]`。
- API：`GET /api/methods`、`GET /api/methods/mine`、`POST /api/methods`、`PATCH /api/methods/{id}`、`POST /api/methods/{id}/feedback`。

- [ ] 測試先行（`test_methods.py`，登入與 client 的寫法照 `test_escalations.py`）：
  業務新增 403；主管新增成功、改別人寫的 403、改自己的成功；IT 改誰的都行；下架的卡業務清單看不到、`/mine` 看得到；
  三種篩選；排序照採用次數；同一人同一家再按是改答案、次數不重複；不同客戶各算一筆；自建帳號按的記在自己名下；
  `my_feedback` 跟著請求帶的 `customer_id` 變；標籤不認得 422；對下架的卡回饋 404；不存在的客戶 404；沒登入 401。
- [ ] 服務、路由、掛上 `main.py`。
- [ ] 提交。

### Task A3: 方法卡頁

**Files:**
- Create: `frontend/src/api/methods.ts`、`frontend/src/lib/methods.ts`、`frontend/src/lib/methods.test.ts`、
  `frontend/src/components/method-card.tsx`、`frontend/src/pages/methods.tsx`
- Modify: `frontend/src/App.tsx`（`/methods`）、`frontend/src/pages/today.tsx`（標頭「使用說明」旁加入口）

**Interfaces:**
- Produces（第二輪會用）：`MethodCard` 型別（`api/methods.ts`，欄位同 `card_out`）；
  `<MethodCardItem card={...} customerId={...} onChanged={(card) => ...} />`，自己處理兩顆回饋鈕與送出；
  `TAG_LABELS: Record<string, string>`（`lib/methods.ts`）。

- [ ] vitest 先行：標籤與適用類型的篩選、標籤名稱對照。
- [ ] API 用戶端、共用元件、方法卡頁（搜尋框、可橫向捲動的標籤列、卡片清單、載入與錯誤狀態照 `pages/promotions.tsx`）。
- [ ] 路由與首頁入口。
- [ ] 提交。

### Task A4: 主管端的方法卡分頁與 README

**Files:**
- Modify: `frontend/src/pages/manager.tsx`（第四個分頁 `methods`）、`README.md`
- Create: `frontend/src/components/method-card-form.tsx`

- [ ] 分頁列出 `/api/methods/mine`，每張附採用與沒幫上的次數；新增、修改用同一個表單（`components/ui/dialog.tsx`）；下架、重新上架。
- [ ] README 加一節「方法卡」，並更新「客戶檔案與談判卡」那一節最後一句（原本寫方法卡片這次不做）與「目錄」。
- [ ] 提交。

---

## B. 優惠與合約簽核（`mg-approvals`）

設計：`docs/superpowers/specs/2026-09-30-approvals-design.md`。

### Task B1: 把 logistic regression 抽成共用

**Files:**
- Create: `backend/app/services/logreg.py`、`backend/tests/test_logreg.py`
- Modify: `backend/scripts/train_route_model.py`

**Interfaces:**
- Produces: `logreg.fit(rows: list[tuple[dict[str, float], int]], names: list[str], *, epochs=600, learning_rate=0.3, l2=0.001) -> dict`
  （回 `mean`、`sd`、`weights`、`bias`）；`logreg.predict(features, model, names) -> float`；`logreg.auc(scored: list[tuple[float, int]]) -> float`。

- [ ] 測試先行：一組人造資料（一個特徵越大越容易是 1）學得到正的權重、AUC 大於 0.8；`auc` 在全對、全錯、同分時的值。
- [ ] 搬 `fit`、`auc`；`train_route_model.py` 改用它，超參數不變。
- [ ] 驗證今日路線的權重不變：另建一個資料庫灌資料、重新訓練，`git diff backend/app/resources/route_model.json` 要是空的。

```bash
uv run --project backend python - <<'EOF'
from sqlalchemy import create_engine
admin = create_engine("postgresql+psycopg://meddemo:meddemo@127.0.0.1:5433/postgres", isolation_level="AUTOCOMMIT")
with admin.connect() as conn:
    conn.exec_driver_sql("DROP DATABASE IF EXISTS meddemo_mg_approvals WITH (FORCE)")
    conn.exec_driver_sql("CREATE DATABASE meddemo_mg_approvals")
EOF
URL=postgresql+psycopg://meddemo:meddemo@127.0.0.1:5433/meddemo_mg_approvals
uv run --project backend python data/seed/seed.py --database-url "$URL"
DATABASE_URL="$URL" uv run --project backend python backend/scripts/train_route_model.py
git diff --stat backend/app/resources/route_model.json
```

- [ ] 提交。

### Task B2: 申請單變成三種

**Files:**
- Modify: `backend/app/models.py`（`OA_FORM_KINDS`、`OA_REQUIRED_LEVELS`、`QUOTE_STATUSES`、`OaExpenseForm` 新欄位與 CHECK、
  `OaApprovalStep.user_id` 與 `OaActivity.actor_id` 可為 NULL、`OA_ACTIVITY_ACTIONS` 加 `auto_approved`、`SapQuotationDraft.discount_pct` 與 `status` 的 CHECK）
- Modify: `backend/app/services/oa.py`、`data/seed/generate.py`（既有出差單的列補上 `kind`、`required_level`）
- Test: `backend/tests/test_oa.py`

**Interfaces:**
- Produces: `OaExpenseForm.kind`、`.request_date`、`.payload`、`.required_level`、`.model_probability`、`.model_features`、`.auto_approved`；
  `oa.next_form_no(session, prefix: str, day: date) -> str`（`prefix` 是 `OA`、`DC`、`CT`）；
  `oa._item` 與 `oa.detail` 的回傳多 `kind`、`summary`、`model`，`detail` 再多 `payload`；沒有簽核人的關卡與日誌顯示「系統（模型）」。

- [ ] 測試先行：既有的出差單測試全部照過；出差單的 `kind` 是 `trip`、`summary` 是客戶名稱與日期；`user_id` 是 NULL 的關卡名字顯示「系統（模型）」。
- [ ] 資料表與 CHECK（`trip` 有 `visit_id`、`trip_date`、沒有 `payload`；另兩種相反且有 `request_date`）。
- [ ] `oa.py` 對 NULL 與三種 `kind` 的處理；逐關推進（核准後把下一個 `waiting` 的關卡改成 `pending`，沒有下一關才把整張單標成已核准）。
- [ ] 提交。

### Task B3: 規則、特徵與系統核准

**Files:**
- Create: `backend/app/services/approvals.py`、`backend/tests/test_approvals.py`

**Interfaces:**
- Produces:
  - `approvals.DISCOUNT_FREE = 3.0`、`DISCOUNT_MANAGER = 8.0`、`DISCOUNT_DIRECTOR = 12.0`、`DISCOUNT_MAX = 20.0`
  - `approvals.discount_level(pct: float) -> str | None`（`None`、`manager`、`director`、`gm`）
  - `approvals.contract_level(listing_from, listing_to, reward_from, reward_to) -> str`
  - `approvals.customer_state(session, customer, as_of) -> dict`（`sales_90d`、`net_margin`、`interval_change`、`ar_age_days`、`competitor_recent`、`grade_weight`）
  - `approvals.discount_features(state, payload) -> dict`、`approvals.contract_features(state, payload) -> dict`
  - `approvals.load_model() -> dict | None`（讀 `resources/approval_model.json`）
  - `approvals.submit(session, *, kind, applicant, customer, payload) -> OaExpenseForm`：建單、建關卡、算特徵與機率、決定系統核准或送人、系統核准時套用效果
  - `approvals.apply_outcome(session, form)`：最後一關核准、駁回、退回之後的效果（`oa.decide` 呼叫它）
  - `approvals.reasons(form) -> list[str]`：簽核頁上的理由

- [ ] 測試先行：每一級折扣與兩種合約各自建出對的關卡與指派的人（主管是申請人的直屬主管、處長與總經理是 IT 帳號）；
  用 monkeypatch 換掉 `load_model`——機率過門檻且沒有逾期帳款會系統核准（第二關沒有簽核人、`auto_approved`、日誌有 `auto_approved`）；
  機率不夠、帳款超過 60 天、規則要到處長、沒有模型、門檻是 null、模型少一個特徵，都送人；
  主管核准後換處長等簽、處長核准才生效；中途駁回報價變 `rejected`；合約核准後到期日照設計延長。
- [ ] 規則、客戶狀態（重用 `route_model.candidates` 與 `customer_profile` 的時間窗與門檻）、特徵、模型判斷、效果。
- [ ] 提交。

### Task B4: 歷史申請單與訓練

**Files:**
- Modify: `data/seed/generate.py`（`build_approval_history`，`random.Random(seed + 102)`）、`data/seed/seed.py`（新單的關卡與活動日誌）
- Create: `backend/scripts/train_approval_model.py`、`backend/app/resources/approval_model.json`
- Test: `backend/tests/test_seed.py`、`backend/tests/test_approvals.py`

**Interfaces:**
- Consumes: B1 的 `logreg`、B3 的特徵定義。
- Produces: `approval_model.json`：`{"discount": {...}, "contract": {...}}`，每個有 `features`、`mean`、`sd`、`weights`、`bias`、`threshold`、
  `metrics`（`auc`、`precision_at_threshold`、`auto_share`、`train_rows`、`test_rows`）。

- [ ] 測試先行：歷史的優惠約 900 張、合約約 300 張，兩種結果都有；每張的 `model_features` 齊全；歷史優惠單的 `quote_no` 是 null、
  `sap_quotation_draft` 的筆數跟原本一樣；抽十張歷史單，用 `approvals.customer_state` 在那一天算出來的特徵跟單上存的一致（誤差 1e-6 內）；
  陳建宏的簽核匣有設計文件列的三張待簽、林昱辰名下有兩張系統核准的。既有測試裡寫死簽核匣筆數的地方跟著改。
- [ ] 產生器：簽核結果照設計文件寫的關聯加雜訊；特徵照 B3 的定義在產生器裡算。
- [ ] 訓練程式：照時間切、挑門檻、印成績、寫 JSON。在 B1 建的那個資料庫重灌後訓練，把產出的 JSON 提交進來。
- [ ] 跑 A1 那段指紋指令，確認既有各表不變（`oa_expense_form` 不在清單裡，另外確認出差單的筆數不變）。
- [ ] 提交。

### Task B5: API

**Files:**
- Modify: `backend/app/api/customers.py`（報價收折扣；合約兩個端點）、`backend/app/api/oa.py`（`/auto-approved`）、
  `backend/app/services/customer_profile.py`（待處理事項列出等簽核的報價並標狀態）
- Test: `backend/tests/test_quotes.py`、`backend/tests/test_oa.py`、`backend/tests/test_approvals.py`

**Interfaces:**
- Produces：`POST /api/customers/{id}/quotes` 多收 `discount_pct`、`reason`，回應多 `discount_pct`、`status`、`approval`；
  `GET /api/customers/{id}/contract`（`contract_end_date`、`days_left`、`listing_fee_rate`、`channel_reward_rate`、`pending_form_id`）；
  `POST /api/customers/{id}/contract-requests`（`term_months`、`listing_fee_rate`、`channel_reward_rate`、`reason`）；
  `GET /api/oa/auto-approved`。`approval`：`form_id`、`form_no`、`status`、`auto_approved`、`probability`、`waiting_for`。
  客戶檔案的 `open_quotes` 每筆多 `status`。

- [ ] 測試先行：3% 以內不開單、報價是 `draft`；超過 3% 沒理由 422；不是 0.5 的倍數或超過 20 是 422；
  模擬 OA 停機時超過 3% 回 503 且報價沒有寫入；合約不是連鎖 409、同時第二張 409；別的業務看不到這張單、主管只看得到自己底下的、
  IT 都看得到也能代簽；自建帳號開的單申請人是代理的那位。
- [ ] 實作。
- [ ] 提交。

### Task B6: 畫面

**Files:**
- Create: `frontend/src/lib/approval.ts`、`frontend/src/lib/approval.test.ts`、`frontend/src/pages/contract.tsx`
- Modify: `frontend/src/api/customers.ts`、`frontend/src/api/oa.ts`、`frontend/src/pages/quote.tsx`、`frontend/src/pages/customer.tsx`、
  `frontend/src/pages/oa-forms.tsx`、`frontend/src/pages/oa-form.tsx`、`frontend/src/pages/manager.tsx`、`frontend/src/App.tsx`

- [ ] vitest 先行：`discountSteps(pct)` 回傳要經過哪幾關與畫面上那句話。
- [ ] 報價頁的折扣與理由、送出後的提示；客戶檔案頁的合約列與「申請續約」、待處理事項的「待簽核」；續約頁；
  申請單清單與單張頁依種類顯示、模型估計與理由、「系統核准」那一關；主管簽核匣的種類標籤、模型那一行、下面的「系統已核准」。
- [ ] 提交。

### Task B7: 內部文件與 README

**Files:**
- Modify: `data/documents/05-上架費與通路獎勵.md`、`README.md`

- [ ] 文件補一句「照原費率續約由區處主管在 OA 核准」，重跑 `test_customer_profile.py`、`test_eval_corpus.py`、`test_eval_questions.py`、`test_knowledge_docs.py`。
- [ ] README 加一節「優惠與合約簽核」：規則表、什麼時候系統核准、模型成績（訓練程式印出來的數字）、哪裡沒做；更新「目錄」。
- [ ] 提交。

---

## C. 談判卡改版（`mg-negotiation`）

設計：`docs/superpowers/specs/2026-09-30-negotiation-festival-design.md`。

### Task C1: 節慶行事曆

**Files:**
- Create: `backend/app/resources/festivals.json`、`backend/app/services/festivals.py`、`backend/tests/test_festivals.py`

**Interfaces:**
- Produces: `festivals.Festival`（`id`、`name`、`date`、`lead_days`、`categories`、`customer_note`、`cost_note`，以及算出來的
  `sell_start`＝`date - lead_days`、`apply_by`＝`sell_start - 21 天`）；`festivals.load() -> list[Festival]`（讀不到或格式不對回空清單並記 log）；
  `festivals.upcoming(today) -> list[Festival]`（節日在今天或之後，由近到遠）。

- [ ] 測試先行：節日前、當天、隔天各挑到哪一個；日期由早到晚；品類都在 `catalog.PRODUCTS` 的類別裡；涵蓋 2026-10-28 之後至少 12 個月；
  決賽日的第一個是雙 11、`apply_by` 已過，第二個是過年、`apply_by` 是 2026-12-19；檔案壞掉回空清單。
- [ ] 行事曆內容（日期照設計文件）與讀取。
- [ ] 提交。

### Task C2: 談判卡搬到自己的檔案

**Files:**
- Create: `backend/app/services/negotiation.py`
- Modify: `backend/app/services/customer_profile.py`、`backend/app/api/customers.py`、`backend/tests/test_customer_profile.py`（只改 import）

- [ ] 把 `Turnover`、`Margin`、`Tip`、`NegotiationCard`、`_turnover`、`_margin`、`_best_section`、`_tips`、`negotiation_card` 與相關常數搬過去，行為不變；整套測試照過。
- [ ] 提交。

### Task C3: 連鎖的顧客導向卡

**Files:**
- Modify: `backend/app/services/negotiation.py`、`backend/app/api/customers.py`
- Test: `backend/tests/test_negotiation.py`（新檔；談判卡的測試從 `test_customer_profile.py` 搬過來）

**Interfaces:**
- Produces（回應的形狀，C5 的前端照這個）：`orientation`、`festival`（`name`、`date`、`days_left`、`categories`、`note`）、
  `campaign`（`festival_name`、`festival_date`、`apply_by`、`days_to_apply`、`fee_cap`、`missed: list[str]`）、
  `shelf`（`items`：`sku`、`name`、`orders_per_month`、`region_orders_per_month`；`scoped`）、
  `gaps`（`sku`、`name`、`peers_with`、`peers_total`）、`margin`、`deals`、`terms`、`tips`。

- [ ] 測試先行：檔期那一區在決賽日列過年與 12/19、`missed` 有雙 11、費用上限等於近 90 天進貨 ÷ 3 × 15%；架上只有主推品類的品項、
  主推品類沒有品項時退回全部且 `scoped` 是 false；缺口只列同區連鎖超過一半近 90 天有進、這家近 180 天沒進的，最多三個；沒有節慶時 `festival`、`campaign` 是 null 其餘照常。
- [ ] 實作。
- [ ] 提交。

### Task C4: 獨立藥局與診所的成本導向卡、切入點

**Files:**
- Modify: `backend/app/services/negotiation.py`、`backend/app/api/customers.py`、`backend/app/resources/negotiation_topics.json`
- Test: `backend/tests/test_negotiation.py`

**Interfaces:**
- Produces：`deals`（`items`：`sku`、`name`、`group_name`、`deal`、`deal_price`、`unit_deal_price`、`list_price`、`unit_profit`、
  `profit_rate`、`smallest_deal_price`；`scoped`；`promotion_name`）、`terms`（`supply_rate`、`channel_reward_rate`、`payment_days`、
  `ar_max_age_days`、`free_discount_pct`、`amount_last_90d`、`avg_order_amount`）。

- [ ] 測試先行：獨立藥局與診所都回 200、`orientation` 是 `cost`（原本「只有連鎖有談判卡」的測試改掉）；促銷品項只來自進行中那一期、一個料號一列、
  `unit_deal_price` 跟 `v_promotion_item` 一樣、照毛利率由高到低、最多五個；主推品類沒有促銷品項時 `scoped` 是 false；
  條件依類型不同（獨立藥局 0.95 與 0.02、診所 1.0 與 null）；`negotiation_topics.json` 七組各自找到想要的段落。
- [ ] 實作；拿掉 409。
- [ ] 提交。

### Task C5: 畫面與 README

**Files:**
- Modify: `frontend/src/api/customers.ts`、`frontend/src/pages/negotiation.tsx`、`frontend/src/pages/customer.tsx`、
  `frontend/src/components/onboarding.tsx`、`README.md`

- [ ] 型別照 C3、C4 的回應；談判卡頁最上面節慶區塊，下面依 `orientation` 顯示各區，副標寫「顧客導向」或「成本導向」。
- [ ] 客戶檔案頁「談判卡」按鈕每種客戶都有；首次使用引導的文字。
- [ ] README「客戶檔案與談判卡」那一節改寫談判卡的部分；更新「目錄」。
- [ ] 提交。

---

## D. SAP 人員主檔與新人第一週（`mg-first-week`）

設計：`docs/superpowers/specs/2026-09-30-first-week-design.md`。

### Task D1: 人員主檔

**Files:**
- Modify: `backend/app/models.py`（檔尾加 `SapEmployee`）、`data/seed/catalog.py`（`SAP_EMPLOYEES`）、`data/seed/generate.py`、
  `data/seed/seed.py`（`TABLES`）、`backend/app/services/org_admin.py`（新增業務帳號時建一列）
- Test: `backend/tests/test_seed.py`、`backend/tests/test_admin.py`

**Interfaces:**
- Produces: `SapEmployee`（`user_id`、`employee_no`、`hire_date`、`product_lines`）。

- [ ] 測試先行：五位業務與四位主管各一列、IT 沒有；到職日都早於 `as_of` 一年以上；業務的產品線是四個類別；
  IT 新增業務帳號後多一列，人員編號接著最大號、到職日是系統日、產品線是同組其他業務的聯集（同組沒有人就是全部類別）。
- [ ] 實作；跑 A1 那段指紋指令確認既有各表不變。
- [ ] 提交。

### Task D2: 新人第一週的資料

**Files:**
- Create: `backend/app/resources/first_week.json`、`backend/app/services/first_week.py`、`backend/app/api/first_week.py`、`backend/tests/test_first_week.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Produces: `GET /api/first-week`（`is_newcomer`、`day_no`、`employee`、`customers`、`product_lines`、`promotion`、`key_customers`、`days`、`documents`，
  細項照設計文件「API」）、`GET /api/first-week/status`（`is_newcomer`、`day_no`）；`first_week.NEWCOMER_DAYS = 30`。

- [ ] 測試先行：林昱辰不是新人；IT 新開的業務是新人、到職第 1 天、客戶兩區是空的且不出錯；自建帳號是新人、`day_no` 是 null、
  `proxy_of` 是林昱辰、客戶數是 50；主管問 `status` 是 false、開整頁 403；產品線的前三名都屬於那個類別、是同一區近 90 天進貨金額的排名；
  先認識的五家都是登入者名下的客戶；設定檔五天都有事情、`id` 不重複、`doc` 與 `documents` 列的檔名都在 `data/documents/` 裡。
- [ ] 設定檔（五天的內容照設計文件的主題，每天三件左右）、服務、路由。
- [ ] 提交。

### Task D3: 讀內部文件

**Files:**
- Create: `backend/app/api/documents.py`、`backend/tests/test_documents_api.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Produces: `GET /api/documents/{source_name}` → `title`、`source_name`、`sections`（`section`、`content`，照文件裡的順序）。

- [ ] 測試先行（用 `conftest.py` 的文件 fixture）：讀得到小節與標題；不存在的檔名 404；沒登入 401。
- [ ] 實作。
- [ ] 提交。

### Task D4: 畫面與 README

**Files:**
- Create: `frontend/src/api/first-week.ts`、`frontend/src/lib/first-week.ts`、`frontend/src/lib/first-week.test.ts`、
  `frontend/src/pages/first-week.tsx`、`frontend/src/pages/document.tsx`
- Modify: `frontend/src/App.tsx`（`/first-week`、`/documents/:sourceName`）、`frontend/src/pages/today.tsx`（新人的入口卡）、
  `frontend/src/pages/settings.tsx`（業務帳號多一列）、`README.md`

- [ ] vitest 先行：勾選進度的存取（localStorage 壞掉或滿了不出錯）、完成數、換了 `id` 的舊勾選不算。
- [ ] 新人第一週頁五區、文件頁、首頁的入口卡（問不到 `status` 就不顯示）、設定頁的入口。
- [ ] README 加一節「SAP 人員主檔與新人第一週」；更新「目錄」與「假資料」。
- [ ] 提交。

---

## 合併（四項都做完之後）

在 `.worktrees/meeting-gaps`，依序合併 `mg-methods`、`mg-approvals`、`mg-negotiation`、`mg-first-week`（`git merge --no-ff`）。
預期的衝突都是各加各的一段：`models.py` 檔尾、`main.py` 的 router、`catalog.py`／`generate.py`／`seed.py` 的結尾與 `TABLES`、
`App.tsx` 的路由、`README.md`、`scope.py` 的 `SHARING_LEVEL`；另外 `api/customers.py`、`pages/customer.tsx`、`pages/manager.tsx`、
`pages/today.tsx`、`test_seed.py` 兩邊都有改。每合併一支跑一次後端整套與前端三項檢查，通過再合下一支。
四支都合完，重新訓練簽核模型一次（人員主檔與方法卡不影響它的資料，數字應該不變；變了就查原因）。

## 第二輪：方法卡接進談判卡與新人頁

### Task E1

**Files:**
- Modify: `backend/app/services/method_cards.py`（`related`）、`backend/app/services/negotiation.py`、`backend/app/services/first_week.py`、
  `backend/app/api/customers.py`、`backend/app/api/first_week.py`
- Modify: `frontend/src/api/customers.ts`、`frontend/src/api/first-week.ts`、`frontend/src/pages/negotiation.tsx`、`frontend/src/pages/first-week.tsx`
- Test: `backend/tests/test_negotiation.py`、`backend/tests/test_first_week.py`、`backend/tests/test_methods.py`

**Interfaces:**
- Consumes: A2 的 `card_out`、A3 的 `MethodCardItem`。
- Produces: `method_cards.related(session, user, *, tags: set[str], customer_type: str | None, customer_id: str | None, limit: int) -> list[dict]`；
  談判卡回應多 `methods`（最多 2 張）；`/api/first-week` 多 `methods`（`newcomer` 標籤前 3 張）。

- [ ] 測試先行：`related` 只回上架的、標籤有交集、適用這個客戶類型的，照採用次數排；提到競品的連鎖客戶的談判卡帶出 `competitor` 的卡；
  成本導向的卡帶出 `cost` 的卡；新人頁帶出三張 `newcomer` 的卡；在談判卡上按的回饋記了那家客戶。
- [ ] 實作與畫面（談判卡在切入點下面加「主管教的做法」；新人頁加「主管教的做法」與「看全部方法卡」）。
- [ ] 整套驗證後提交。
