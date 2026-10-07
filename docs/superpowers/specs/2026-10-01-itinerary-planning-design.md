# 業務自己排行程、AI 幫忙排順路、主管看得到團隊路線

2026-10-01

業務的今日路線從「每次打開都由模型重排」改成「存起來、業務自己能改」：可以拖移順序、新增、刪除、改約的時間與停留時間、
寫備註、鎖住某一站；跟熊熊滾說一句話也能改（「先去德安再去佑生」「幫我排順一點」）。排順路時一定守住先後限制與約的時間，
就算因此比較繞，也會講清楚多繞了多少、是哪條規則造成的。每位業務有自己的「排序習慣」（例如「星期一先跑板橋」），
系統記住並自動套用，業務看得到、改得了。主管端多一個「行程」分頁，在 Google 地圖上看團隊今天的路線、
跟系統建議比改了什麼，以及業務現在在哪裡。

## 為什麼做

- 業務最清楚哪家店幾點有人、哪兩家要先後跑，模型排的順序只看急不急，不看順不順路，也不知道這些限制。
- 現在業務能做的只有三顆鈕（插入下一站／暫緩／誤判），調整存在手機上，換手機就沒了，主管也看不到。
- 主管想知道底下的人今天怎麼跑、有沒有把該去的急件拿掉、現在在哪裡。

## 已定案的決定

1. **限制有兩種**：約的時間（幾點到／幾點以前／幾點以後）與先後（A 要在 B 之前），兩種都要能設。
2. **每一站能改的**：約的時間、先後、停留多久、備註、鎖住（重排時位置不動）。
3. **行程存在伺服器**。兩人同時改同一位業務的行程時，用 `version` 擋住後存的那一個，不默默蓋掉。
4. **動過就固定**：每天第一次讀取時用模型排一份建議存起來；之後一律以存著的為準，模型不再重排。
5. **排序習慣**：每位業務自己的、長期有效、可設星期幾。來源有三種：在首頁跟熊熊滾說、在習慣頁自己新增、
   拖移或改時間後系統問「以後也這樣排嗎？」而業務選了「每個星期 X」或「每次」。業務看得到每一條、能停用或刪除。
6. **AI 只負責聽懂話，順序由程式算**：Gemini 把一句話翻成固定格式的操作，後端自己的排序程式把每種排法都試過，
   找出守住所有規則下最好的那條。AI 不可能排出違反規則的順序。
7. **AI 的調整先給業務看再套用**：回一張「現在 → 改成」的對照卡，按「套用」才寫進行程。
8. **習慣是硬規則**：跟今天設的先後一樣一定要守；當天拖移違反時，以當天拖的為準，記成「今天不套用這條」。
9. **約的時間是軟規則**：趕不上照樣排，標出「會晚到 N 分鐘」。先後、習慣、鎖住守不住就不排，講出是哪幾條打架。
10. **「需立即處理」那家在每天的建議裡鎖在第一站**，其他照順路排。業務可以拖走它或解鎖。
11. **首頁的調整用清單模式**：首頁平常照舊是蛇行路線；按橫幅的「調整」切成一張張卡片的清單，拖移、展開編輯，
    按「完成」一次存起來。
12. **跟熊熊滾說要怎麼排的輸入列放在首頁**（蛇行路線與調整清單底部都有）。問答頁不加分頁、語音問答不加工具；
    查數字答案的「排入今天的路線」保留，改成直接加進行程。
13. **主管端多一個「行程」分頁，放在最前面**：只能看、不能改，只看今天，看不到業務的排序習慣。
14. **串 Google 地圖**：Maps JavaScript API 畫地圖，Routes API 算道路車程與沿路的路線。排序仍由我們的程式做
    （Google 的路線最佳化不支援先後限制）。Google 連不上或沒設金鑰時退回直線估算。
15. **即時位置**：上班時間（週一到週五 08:30–18:30）打開 app 才分享，首頁一直顯示「位置分享中」；業務可以暫停，
    主管會看到「暫停分享」。只存最新位置，不留軌跡。
16. **示範帳號也用真的 GPS**：用第三方登入、代理示範業務的評審，分享的是評審手機的位置，存在示範業務名下。
17. **IT 能重置示範業務今天的行程**：系統日期固定在決賽日不會換天，示範業務的行程給所有評審共用、第一次建好之後只會累積改動（暫緩、插入下一站、加站）。組織管理頁加一顆「重置示範業務今天的行程」，IT 按下去刪掉這份行程與所有暫緩、訊號權重，示範業務的排序習慣也回到一開始那三條，下次讀取照模型的建議重新建一份，換一批評審前用。
18. **業務首頁也有地圖，但平常不顯示**（2026-10-04 加）：路線上方多一個「路線｜地圖」切換，預設是路線；
    切到地圖才載入 Google 地圖，畫自己今天的路線與位置，底下一張卡寫下一站，按「導航」打開手機上的 Google 地圖。
    比較過的另外兩種：路線上方常駐一張小地圖（每次開首頁都載入、把路線往下擠）、只在每站加導航鈕（看不到整條路），
    見〈業務首頁的地圖〉。
19. **交通方式：開車、機車、大眾運輸，整天的行程都照它排**（2026-10-04 加）：每位業務選一次（帳號設定或首頁地圖的左上角），
    每天的建議、加一站、排順路、到達時間、主管頁與首頁地圖上的線都照它算。只畫地圖上的線、行程照開車排的做法比較過，
    沒有選：機車與大眾運輸的時間跟開車差很多，到達時間會不對。見〈交通方式〉。

## 資料

`models.py` 改了，`schema_version` 的指紋跟著變，部署時重建資料庫（跟以往一樣）。

### 客戶與辦公室的位置

| 欄位 | 內容 |
|---|---|
| `customer.area` | 地區名（「板橋」「大安」）；連鎖分店是分店所在的行政區或鄉鎮（忠孝店 → 大安、三重店 → 三重）。原本只寫在店名「 · 」後面或分店對照表裡，拆成欄位 |
| `customer.lat`、`customer.lng` | 該地區中心點，再依客戶 id 的雜湊錯開最多約 400 公尺，同區的店不疊在同一點 |
| `org_unit.lat`、`org_unit.lng` | 區處辦公室的位置（北、中、南三區有值，其他節點 NULL），每天的出發點 |

各地區中心點與辦公室位置寫在 `data/seed/catalog.py`（`DISTRICT_COORDS`、`REGION_OFFICE`）。

### 今天的行程

**`itinerary`**：一位業務一天一份，唯一鍵 `(user_id, date)`。

| 欄位 | 內容 |
|---|---|
| `id`、`user_id`、`date` | 業務是 `acts_as_user_id or id` 的那一位；日期是系統的今天（`app_today`） |
| `version` | 每存一次加一 |
| `suggested` | JSONB：建立當下模型建議的站（客戶、訊號、理由、順序），主管頁比對用，之後不再改 |
| `skipped_habit_ids` | 今天不套用的習慣 |
| `skip_reasons` | JSONB：今天不套用的每一條習慣為什麼（習慣 id → 一句話）：每天建議時跟別的規則衝突、業務選了今天不套用、存檔時順序跟它不合 |
| `urgent` | JSONB：建立當下的「需立即處理」卡片內容（跟現在 `Urgent` 同欄位）。按了三顆鈕之一、那站拿掉或跑完之後清成 NULL，紅卡就不再出現 |
| `created_at`、`updated_at` | |

**`itinerary_stop`**：

| 欄位 | 內容 |
|---|---|
| `itinerary_id`、`position` | 第幾站（已完成的站也在裡面，排最前面） |
| `customer_id` | 同一份行程裡不重複 |
| `source` | `model`／`rep`（自己加）／`ai`（跟熊熊滾說加的）／`ask`（問答頁「排入今天的路線」） |
| `signal`、`reason` | 照現在的寫法；業務自己加的站用 `_signal_and_reason` 現算一句 |
| `window_kind`、`window_time` | `at`／`before`／`after` 或 NULL，加上時間 |
| `duration_minutes` | 預設 40；習慣有寫就用習慣的 |
| `note` | 自由文字 |
| `locked` | 重排時位置不動 |

已完成與否不存：跟現在一樣看今天有沒有這家已確認的拜訪紀錄（`_done_visits`）。已完成的站固定排在最前面，不能拖、不能刪。

**`itinerary_precedence`**：`(itinerary_id, before_customer_id, after_customer_id)`，今天設的先後。刪掉一站時一起刪。

### 排序習慣

**`route_habit`**：

| 欄位 | 內容 |
|---|---|
| `id`、`user_id` | |
| `kind` | `precedence`（A 在 B 前）／`first`／`last`／`window`（約的時段）／`duration`（停留） |
| `subject`、`object` | JSONB `{"by": "customer"／"chain"／"type"／"area", "value": ...}`；`object` 只有 `precedence` 用 |
| `window_kind`、`window_time`、`duration_minutes` | `window`、`duration` 才有 |
| `weekday` | 0（一）～6（日），NULL 是每天 |
| `text` | 給人看的一句話，例如「康泰的店排在診所前面」「星期一先跑板橋」，由程式依欄位產生 |
| `source` | `ai`／`prompt`（拖完或改完答應的）／`manual` |
| `active` | 停用不刪 |
| `created_at` | 兩條習慣打架時新的優先 |

**套用規則**

- 對象比對今天行程裡的站：`customer` 比 id、`chain` 比 `chain_group`、`type` 比 `type`、`area` 比 `area`。
- `precedence`：符合 A 的每一站都要在符合 B 的每一站前面；同時符合 A 和 B 的站不算。
- `first`／`last`：符合的站排在其他站的前面／後面（已完成的站之後）。
- `window`、`duration`：新增一站（含每天的建議）時當預設值寫進那一站；之後業務改了就以那一站的為準。
- 今天設的（先後、鎖住，含「需立即處理」那站的鎖）跟某條習慣衝突時，那條習慣記進 `skipped_habit_ids`；
  兩條習慣衝突時，舊的那條今天不套用，行程上提示「今天沒套用『舊的』，因為跟『新的』衝突」。
- 每天建立建議時排不出來，就從最舊的習慣開始一條一條記成今天不套用，直到排得出來，同樣在行程上提示原因。

### 原本存在手機上的回饋

**`route_snooze`**（`user_id`、`customer_id`、`until`）與 **`route_signal_weight`**（`user_id`、`signal`、`weight`）：「暫緩」「誤判」寫這裡，
排隔天的建議時用（照現在 `today_route.Feedback` 的規則）。`pinned` 不再需要：「插入下一站」與「排入今天的路線」
直接改今天的行程。手機上 `meddemo:route-feedback:*` 的舊紀錄不搬，`lib/route-feedback.ts` 拿掉。

### AI 的提案

**`itinerary_proposal`**：`id`、`itinerary_id`、`base_version`、`question`（按鈕觸發的排順路是 NULL）、
`operations`（JSONB）、`result`（JSONB，對照卡內容）、`created_at`。只留最近 7 天，由 `jobs/retention.py` 清。

### 位置

**`user_location`**：一人一列，覆寫。`user_id`（代理示範業務時是示範業務）、`lat`、`lng`、`accuracy_m`、`at`、
`paused`（業務按了暫停）、`paused_at`、`denied`（瀏覽器沒給定位權限）、`denied_at`。

## 車程與地圖（Google）

### 車程：`services/travel.py`

`travel_minutes(points) -> matrix`，兩種實作，介面一樣：

- **Google**：Routes API 的 `computeRouteMatrix`（開車、不看即時路況），一次送行程的所有點（出發點加最多 8 站，
  最多 81 格）。車程不快取：Google 的條款只允許快取經緯度（查證見 `docs/superpowers/plans/2026-10-01-itinerary-stage4.md`）。
  照存著的順序算時間（讀行程、存檔與套用提案之後回的行程，`itinerary._timed`）只要相鄰兩站，改用 `computeRoutes`
  一次拿到全部路段（`travel.along`，按請求計價）；要排順序（每天第一次建、加一站、排順路）才問整份矩陣
  （`travel.matrix`，按格計價）。調整清單的試算（`preview`）每改一次就算一次，一律用估算，不問 Google。
  Google 失敗後 60 秒內直接用估算。
- **估算**：直線距離 × 1.4 ÷ 時速 30 公里，加 5 分鐘停車。沒設 `GOOGLE_MAPS_SERVER_KEY`、Google 回錯或逾時（5 秒）
  時用這個，回應帶 `estimated: true`，畫面註明「車程為估計」。開發與測試一律走這條。

「加一站」的候選清單一次要算約 50 家客戶，只用估算排序（寫「多繞約 N 分鐘」），加進去之後才用 Google 重算。

### 交通方式

2026-10-04 加。每位業務一個 `app_user.travel_mode`：`drive`（開車，預設）、`scooter`（機車）、`transit`（大眾運輸）。
存在行程主人身上：代理示範業務的帳號看的是示範業務的行程，改的也是示範業務這一欄（評審之間共用，跟行程一樣）；
IT 重置示範業務今天的行程時一起回到開車。`travel` 的每個函式都帶交通方式；排順序（`matrix`）用整天的交通方式，到達時間與地圖上的線則照每一段自己的（`itinerary_leg`，沒有另外選就是整天的）。

| | Google | 估算（直線距離 × 繞路倍數 ÷ 時速 + 每到一站） | Google 的時間另外加 |
|---|---|---|---|
| 開車 | `DRIVE`，不看路況 | × 1.4 ÷ 30，+ 5 分（找車位） | 5 分 |
| 機車 | `TWO_WHEELER`，不看路況（測試版，畫面要註明） | × 1.3 ÷ 28，+ 2 分 | 2 分 |
| 大眾運輸 | `TRANSIT`，出發時間一律今天早上 10 點 | × 1.3 ÷ 20，+ 10 分（走到站、等車、轉乘） | 0（Google 算了走路與等車） |

- 大眾運輸：`computeRoutes` 不接受中間點，相鄰兩站一段一段問（同時最多 8 個請求）；搭不到車的那一段用估算、整份標成估計。
  矩陣一次最多 100 格（9 個點 81 格，夠用）。回來的每一段分成走路與搭車的幾小段，地圖上走路畫虛線。
- 換交通方式（`PUT /api/itinerary/travel-mode`）：今天的行程換一版，順序是存著的、不動，時間照新的方式重算；
  換版讓還沒套用的提案作廢、主管頁跟著更新。要照新的方式重排順路，按「幫我排順一點」。
- 沿路的線依「交通方式 + 這一串點」放 Redis（快取的鍵是 `route-lines:v3:`，依每一段的交通方式，舊格式不讀）。
- 2026-10-07 起這是整天的**預設**：首頁兩站之間的膠囊可以替單一段另外選（多一種走路），換預設時今天另外選的清掉。
  見 [熊熊滾騎座騎](2026-10-07-ride-vehicles-design.md)。

### 路線：沿路的線

主管頁要畫路線時，後端用 `computeRoutes`（出發點、終點、中間各站）拿編碼過的折線，依 `(itinerary_id, version)`
放 Redis。業務首頁切到「地圖」時用同一份（`team_itineraries.rep_map`）；首頁平常不畫地圖，不呼叫。

### 地圖

前端用 `@vis.gl/react-google-maps`，主管頁的行程分頁與首頁切到「地圖」時才用 `import()` 載入，不算進首頁的下載量。
瀏覽器用的金鑰由 `GET /api/maps/config` 給（`{"browser_key": "..."}` 或 `null`，登入的人都給），不寫進前端的建置。
沒有金鑰或載入失敗時，地圖區塊換成一行「地圖暫時載入不了」，頁面其他地方照常。

### 金鑰

| 設定 | 用途 | 限制 |
|---|---|---|
| `GOOGLE_MAPS_SERVER_KEY` | 後端呼叫 Routes API | 只開 Routes API |
| `GOOGLE_MAPS_BROWSER_KEY` | 前端畫地圖 | 只開 Maps JavaScript API，限我們的網域 |

兩把都放在 Helm 的 secret。Google Cloud 專案要開帳單；實作前查一次目前的價格與每月免費額度。

## 排序程式：`services/route_planner.py`

純函式，不碰資料庫、不呼叫 Google，輸入都由呼叫端備好。

```python
@dataclass(frozen=True)
class PlanStop:
    customer_id: str
    point: int   # 在車程矩陣裡是第幾點
    duration: int   # 停留幾分鐘
    window: tuple[Literal["at", "before", "after"], dt.time] | None = None   # 約的時間：幾點到／以前／以後

@dataclass(frozen=True)
class Rule:
    id: str                       # "today:C012>C034"、"habit:17"、"lock:C012"
    text: str                     # 給人看的一句話，排不出來時拿來講是哪幾條打架
    kind: Literal["precedence", "first", "last", "lock"]
    customer_ids: tuple[str, ...]  # precedence 是 (前, 後)；first、last 是符合的那幾家；lock 是一家
    position: int | None = None    # lock 專用：在還沒跑的站裡排第幾站（0 起算）

@dataclass(frozen=True)
class Slot:
    customer_id: str
    arrive: dt.datetime
    leave: dt.datetime
    travel_minutes: int   # 從上一站（或出發點）開過來
    late_minutes: int

@dataclass(frozen=True)
class Schedule:
    slots: list[Slot]
    late_minutes: int
    travel_minutes: int

@dataclass(frozen=True)
class Conflict:
    rules: list[Rule]   # 拿掉其中任何一條就排得出來的那幾條；找不到單獨一條擋住的，就是全部的規則

def plan(start: dt.datetime, start_point: int, stops: list[PlanStop], rules: list[Rule], minutes: list[list[int]]) -> Schedule | Conflict
def schedule(start: dt.datetime, start_point: int, ordered: list[PlanStop], minutes: list[list[int]]) -> Schedule   # 不改順序，只算時間
def violations(ordered: list[str], rules: list[Rule]) -> list[Rule]    # 這個順序違反哪幾條
def cheapest_insert(start: dt.datetime, start_point: int, ordered: list[PlanStop], new: PlanStop, rules: list[Rule], minutes: list[list[int]]) -> int   # 插在第幾站（0 起算）
```

`rule_costs(start, start_point, stops, rules, minutes) -> list[RuleCost]`：守住全部規則的最好排法，跟拿掉某一條（同一個 id 一起拿掉）重排的最好排法比，只列拿掉之後真的更好的（多開幾分鐘、多晚到幾分鐘、不守時的順序）。守住全部規則就排不出來時回空的。

- **出發**：今天還沒跑任何一站，從區處辦公室 09:30 出發；跑過了，從最後完成那一站、拜訪時間加停留時間出發。
  已完成的站不進排序。跑完不用回辦公室。
- **時間**：到達時間 = 出發 + 車程；`at`、`after` 早到就等；離開 = 到達（或等到的時間）+ 停留。
  `at`、`before` 晚到算晚到分鐘數。
- **硬規則**：先後、排第一、排最後、鎖住的位置。**軟規則**：約的時間。
- **挑法**：把所有排法用深度優先試過（違反先後就剪枝、已經比目前最好的差就剪枝），先比晚到分鐘數總和，
  一樣再比總車程。還沒跑的站最多 8 站（40,320 種排法），保證找到最好的。
- **排不出來**：一條一條拿掉規則再試，拿掉後排得出來的那幾條就是「擋住的」，回 `Conflict(rules=[...])`，
  畫面寫「這幾條規則互相衝突，拿掉其中一條才排得出來」。
- **插在哪裡**：`cheapest_insert` 只跳過比既有順序多新增規則違反的位置，不要求整段都不違反；
  留下的位置裡晚到與車程增加最少的那個勝出，插在哪裡都新增違反就放最後，讓業務自己調。
- **8 站上限**：還沒跑的站已經 8 站時，新增回「今天已經排了 8 站，要先刪掉一站」。

### 什麼時候用到

| 動作 | 做什麼 |
|---|---|
| 當天第一次讀取（業務或主管） | 模型照舊挑客戶（`today_route.build` 的挑選部分）→ 套習慣的預設值 → 「需立即處理」那家鎖第一站 → `plan` |
| 業務拖移、改時間、改停留 | `schedule` 重算時間、`violations` 檢查規則，不改順序 |
| 新增一站 | `cheapest_insert` |
| 刪除一站 | `schedule` |
| 「幫我排順一點」、AI 說要排順路 | `plan` 整條重排，出提案 |

## 業務首頁

### 平常：蛇行路線

跟現在一樣，資料改從 `GET /api/itinerary/today` 來。改動：

- 橫幅右邊在「方法卡」旁多一顆「調整」（鉛筆圖示），點了進調整行程。
- 每站標籤的時間是排程算出來的到達時間；有約的時間而且會晚到時，標籤第二行改成紅字「會晚到 N 分」。
- 橫幅下面一條位置分享列（見〈位置分享〉）。
- 路線下面、底部分頁膠囊上面固定一條「跟熊熊滾說要怎麼排…」的輸入列（見〈跟熊熊滾說要怎麼排〉）。
- 「需立即處理」紅卡照舊；三顆鈕改打 `POST /api/itinerary/today/feedback`。

### 業務首頁的地圖

2026-10-04 加。比較過三種擺法（示意圖：路線上方常駐一張小地圖、路線／地圖切換、不放地圖只在每站加導航），選了切換：
首頁平常照舊，要看地圖才載入，Google 載不到也不會讓首頁最顯眼的地方壞掉。

- 路線上方一個「路線｜地圖」切換，預設是路線。選了地圖記在網址上（`/?view=map`），從客戶檔案按返回還在地圖。
  今天沒有站、或用的是手機上的舊行程（連不上）時不顯示切換。
- 切到地圖才打 `GET /api/itinerary/today/map`（站號、座標、跑完了沒、沿路的線，跟主管頁同一套：
  `team_itineraries.rep_map`），不算時間與車程，不必再等一次 Google 的車程。首頁的行程換版了（三顆鈕、套用提案）就重拿。
- 地圖畫法跟主管頁一樣：沿路的線跑完的段深色、還沒去的淡色；站點跑完的打勾、下一站實心多一圈、還沒去的空心寫站號。
  線底下墊一層比較寬的底色（淺色是白、深色是黑），還沒去的段也不能太淡（55%）：一天剛開始整條都是還沒去的，
  以前 35% 加上 Google 底圖彩色的捷運線，看起來像只有站點、沒有路線。大眾運輸的走路畫虛線。
  自己的位置是藍點，位置分享中（手機正在追蹤）才有，右上角一顆鈕移回自己的位置。
- 左上角「開車｜機車｜大眾運輸」換交通方式（見〈交通方式〉），換好之前那一顆轉圈。
- 動畫：按切換時，換過去的那一邊從那一側滑進來（地圖從右、路線從左，0.3 秒）；一打開頁面不滑。
  地圖的底圖載好後，路線從出發點一段一段畫出來（1.6 秒，先快後慢），畫到哪一站那一站才彈出來；
  換了交通方式、行程換版也重畫一次。系統設定「減少動態效果」就不動，直接畫好。
- 底下一張卡寫下一站：「下一站 · 第 3 站 · 11:00 到」、店名、理由與時間（「機車約 12 分 · Google Maps」或「（估計）」）。
  點別的站換成那一站，點地圖空白處回到下一站；跑完的站寫「已完成」。還沒去的站有「導航」，
  打開 `https://www.google.com/maps/dir/?api=1&destination=緯度,經度&travelmode=driving`（機車 `two-wheeler`、
  大眾運輸 `transit`）：手機上有 Google 地圖就開 App，只是網址，不用金鑰。騎機車而且是 Google 的路線時，
  卡片上註明「Google 的機車路線是測試版」（Google 的規定）。
- 地圖載不到（沒金鑰、金鑰被拒、程式下載失敗、`/today/map` 失敗）就一行「地圖暫時載入不了」，切回路線照常。

### 調整行程（清單）

`/route/edit`。頁首「取消」「調整行程」「完成」；下面一行總里程、總車程、約幾點收工（`estimated` 時加「估計」）；
頁首右邊一個「習慣」連結進我的排序習慣。

- **每站一張卡**：拖移把手、站號、客戶名、「HH:MM 到 · 停 N 分」，下面小標籤：約的時間、鎖住、先後、備註、
  來自習慣（綠色「習慣」）、理由類別。右邊上移／下移鈕給不方便拖的人。
- **兩站之間**一行「車程 N 分 · M 公里」。
- **已完成的站**淡色、沒有把手，不能動。
- **點卡片就地展開**：約的時間（不限／幾點到／以前／以後＋時間）、停留（20／40／60／90 分，也可以自己輸入）、
  先後（「要在 ___ 之後」「要在 ___ 之前」，可以加多條）、備註、鎖住開關、「從今天的行程拿掉」。
- 最下面「加一站」與「幫我排順一點」，再下面是跟熊熊滾說的輸入列。
- 拖移用 `@dnd-kit/core` 與 `@dnd-kit/sortable`（支援觸控與鍵盤）。
- 編輯期間的改動先留在畫面上，每次改完用 `POST /api/itinerary/today/preview` 算時間、車程與違反的規則
  （300ms 防抖），不存。按「完成」用 `PUT /api/itinerary/today` 一次存進去（含這段期間答應要記的習慣）；
  按「取消」全部丟掉。`version` 對不上（409）時顯示「行程剛被改過，已幫你重新整理」，載入最新的，剛才的改動不保留。

### 拖完、改完：要不要記成習慣

從下面滑出一張卡，預設選「只有今天」：

| 觸發 | 卡上的句子 | 選項 |
|---|---|---|
| 把 X 往上拖過 Y（新位置的下一站是 Y） | 「X 排在 Y 前面」 | 只有今天／每個星期 N 都這樣／每次都這樣 |
| 把 X 往下拖過 Y（新位置的上一站是 Y） | 「Y 排在 X 前面」 | 同上 |
| 改停留時間 | 「以後去 X 都停 N 分」 | 同上 |
| 改約的時間 | 「以後 X 都約 HH:MM 以前」等 | 同上 |

星期 N 是今天（系統日期）是星期幾。選了「只有今天」，拖移就只是今天的順序，不另外記先後。
拖移違反規則時不跳這張卡，改走下一節。

### 違反規則

拖完的順序違反今天的先後或某條習慣時，那張卡變紅框，寫「違反：要在佑生之後」，下面兩顆鈕：

- 今天的先後：「拿掉這條限制」「復原」。
- 習慣：「今天不套用這條」「復原」。

沒處理之前「完成」按得下去，但會先問一次「還有 N 條規則沒處理，要復原嗎？」。
沒處理就按「照這樣存」：以今天排的為準，違反的習慣記成今天不套用，違反的今天的先後拿掉。

### 加一站

`/route/edit/add`，搜尋框加客戶清單（只有自己的客戶，已在今天行程裡的不列）：

- **順路的**：依估算的多繞分鐘數排前 5 家，每家寫「插在第 N 站後 · 多約 M 分鐘」與目前的理由類別。
- **其他客戶**：照名稱排。
- 點「＋」用 `cheapest_insert` 插入，回到清單。

### 跟熊熊滾說要怎麼排

輸入列：placeholder「跟熊熊滾說要怎麼排…」，右邊麥克風。麥克風用錄拜訪的即時轉文字
（`voice/live-transcription.ts`），講完把文字填進輸入框，業務看過再按送出。只有業務看得到。

送出後打 `POST /api/itinerary/today/ask`（同步，通常 3～5 秒；輸入列換成熊熊滾 `think` 與「熊熊滾想一下…」）。
回來的結果從下面滑出一張卡，三種：

1. **提案**（對照卡）：
   - 一句話說明做了什麼（「加了一條『德安在佑生之前』，重新排了順序」）。
   - 左「現在」、右「改成」兩欄順序，換了位置的站主色加粗；各自的總里程與總車程。
   - 每條影響順序的規則一行：「守住『德安在佑生之前』，比不守多繞 6 公里、15 分鐘」。
   - 會晚到的站紅字一行。
   - 新增或停用的習慣各一行（「新增習慣：星期一先跑板橋」）。
   - 做不到的部分一行（「找不到『德安』」）。
   - 「套用」與「不用了」。
2. **要選一個**：名字對到兩家以上時，「你是說康泰 · 忠孝店，還是康泰 · 大安店？」，每家一顆鈕；
   按了把原句加上選的客戶 id 再送一次。
3. **只回答**：「為什麼杏林排第一？」這類，回一段話，只有「知道了」。

規則互相矛盾、排不出來時是提案的特例：寫出擋住的幾條規則，沒有「套用」。

「套用」打 `POST /api/itinerary/proposals/{id}/apply`；成功就關卡、路線就地更新；409 時卡上改成
「行程在你問完之後改過了」與「用現在的行程重算」（把同一句話再送一次）。

首頁的「幫我排順一點」按鈕打 `POST /api/itinerary/today/optimize`，回同一種提案卡。

調整清單上還有沒存的改動時按「幫我排順一點」或送出輸入列，先問「剛才的調整還沒存，要先存起來再請熊熊滾排嗎？」：
「先存再排」照「完成」一樣存（違反規則時一樣先問一次），存完接著問；「取消」什麼都不做（這一點原本設計沒寫到，
第三階段先這樣做）。

### 我的排序習慣

`/route/habits`，從調整行程的頁首與帳號設定進來。

- 兩組：「今天（星期三）套用中」與「其他日子」；今天被衝突擋掉或「今天不套用」的也列在第一組，灰字註明原因。
- 每條：那句話（大字）、「每天／每個星期一 · 在首頁跟熊熊滾說的／拖完答應的／自己新增的」、啟用開關；
  右上角「⋯」選單裡有「刪除」（先確認一次）。
- 最下面「新增一條習慣」：表單選種類、對象（客戶／連鎖體系／客戶類型／地區）、星期幾、時間或分鐘數。
- 新增或改了習慣，不回頭改今天已存的行程；畫面提示「今天的行程要套用的話，回去按『幫我排順一點』」。

### 位置分享

橫幅下面一條：

| 狀態 | 文字 | 按鈕 |
|---|---|---|
| 上班時間、分享中 | 綠點「位置分享中，{主管名}看得到你在哪（到 18:30）」 | 暫停 |
| 暫停中 | 琥珀點「已暫停分享，{主管名}會看到『暫停分享』」 | 繼續 |
| 瀏覽器沒給定位權限 | 「沒有開定位權限，{主管名}看不到你在哪」 | 怎麼開（說明對話框） |
| 下班時間 | 不顯示 | |

第一次在上班時間打開首頁時，先跳一個對話框說明「上班時間主管看得到你的位置，只存最新的一筆，不留軌跡；
可以隨時暫停」，按「知道了」才向瀏覽器要定位權限。

## 跟熊熊滾說要怎麼排：後端

`POST /api/itinerary/today/ask {"question": "...", "customer_id": null}`：

1. 讀今天的行程（沒有就建），組提示：今天的行程（站號、客戶名與 id、到達時間、約的時間、停留、鎖住、先後）、
   這位業務的客戶清單（名稱與 id，約 50 家）、他的習慣（id 與那句話）、今天星期幾。
2. 呼叫 `llm.json`，輸出用 JSON Schema 約束成操作清單：

| 操作 | 參數 |
|---|---|
| `move` | `customer_id`，`to_position` 或 `before`／`after` 某客戶 |
| `add`、`remove` | `customer_id` |
| `set_window` | `customer_id`、`kind`（或 `none`）、`time` |
| `set_duration` | `customer_id`、`minutes` |
| `set_note` | `customer_id`、`text` |
| `lock`、`unlock` | `customer_id` |
| `add_precedence`、`remove_precedence` | `before`、`after` |
| `optimize` | |
| `add_habit` | 習慣的欄位 |
| `disable_habit` | `habit_id` |
| `ask_which` | `mention`（原話裡的名字）、`candidates`（客戶 id） |
| `not_found` | `mention` |
| `answer` | `text` |

3. 驗證：客戶 id 必須是這位業務的客戶（照 `Scope`），習慣 id 必須是他的；不合的轉成 `not_found`。
4. 有 `ask_which` 就只回「要選一個」；有 `answer` 而且沒有其他操作就只回答。
5. 在行程的複本上依序套用；有 `optimize` 就最後整條 `plan`，只有 `add` 就 `cheapest_insert`，其他只 `schedule`。
   加了今天的先後或今天就套用的習慣、順序卻不合時，當成也要排順路（不然套用時新的規則會因為順序不合被拿掉）。
6. 算對照卡，存 `itinerary_proposal`，回傳。對照卡的每一行（規則的代價、會晚到、新增或停用的習慣、做不到的部分、
   套用時會拿掉或今天不套用的規則）都由後端寫好。

`apply` 時檢查 `base_version == itinerary.version`，相同就照 `operations` 在最新的行程上再做一次（不信前端傳來的內容），
寫入、`version + 1`；不同回 409。

這支 API 算進 `usage.py` 的用量上限，跟問答一樣。Gemini 沒設定時回 503「熊熊滾現在沒辦法排行程」，
畫面上的拖移、新增等照常可用。

## 主管端：行程分頁

`/manager?view=routes`，分頁順序改成「行程、提問、風險通報、簽核、方法卡」，預設打開「行程」。主管看自己底下的業務，
IT 看全公司（照 `manager.py` 現在的範圍）。只能看。原本把 `/manager` 當提問頁的連結（例如「回提問」）改成
`/manager?view=asks`。

### 團隊總覽

- 「10/28（三）· 北區 2 位業務 · 11:02 更新」。
- **地圖**：每位業務一個顏色（從五色裡依帳號固定挑，跟頭像底色同一套）。路線沿道路畫：已跑完的段深色、
  還沒去的段淡色；站點是圓形編號（已完成實心、還沒去空心）；業務的頭像在他的最新位置，暫停或太久沒更新時頭像變灰。
  圖例列出每位業務的顏色。點站點彈出客戶名與到達時間。
- **每位業務一張卡**（點了進詳細）：
  - 頭像（帶在線狀態點）、名字、「N/M 站 · 共 X 公里 · 約 HH:MM 收工」、進度條。
  - 位置一行（紫色）：「在杏林診所附近」「往第 3 站德安藥局途中 · 1 分鐘前」「最後位置 10:41，在內湖區」
    「暫停分享位置」「下班時間」「沒有開定位權限」「今天還沒有位置」。
  - 拿掉系統排的站（紅色）：「拿掉系統排的 1 站：和康藥局 · 松山（帳款逾期）」。
  - 會晚到（琥珀色）：「1 站會晚到 25 分鐘」。
  - 沒動過（灰色）：「照系統建議，還沒動過」。
- 業務今天還沒打開首頁時，主管一讀就照第一次讀取的規則建好行程。

### 一位業務的詳細

- 地圖：只有這位業務的路線、他的位置、被拿掉的站（紅色虛線圈加「（拿掉）」）。
- 地圖下：「共 X 公里 · 車程 N 小時 M 分（Google 道路車程）」或「（估計）」；位置一行。
- **跟系統早上的建議比**：拿掉（含理由）、自己加的、順序改過的站（「德安提到佑生前面」），沒有差異就寫「照系統建議」。
- **行程清單**：跟業務看到的一樣（到達時間、停留、約的時間、會晚到、來源），點客戶進客戶檔案。

### 即時更新

收到 WebSocket 的 `{"type": "location", "user_id": "U01"}` 或 `{"type": "itinerary", "user_id": "U01"}`，
而且是自己看得到的人，3 秒後重拿一次（跟頻道列表同一套防抖）；沒有 WebSocket 時每 60 秒輪詢。

## 即時位置

- **手機送**：在線狀態的心跳（WebSocket 每 20 秒，斷線時的 `POST /api/presence/ping` 也一樣）多帶
  `location: {lat, lng, accuracy}`。用 `navigator.geolocation.watchPosition` 拿最新的一筆；只有業務、
  上班時間、沒暫停、有權限時才帶。瀏覽器拒絕定位時改帶 `location_denied: true`，後端記 `denied`，
  之後拿到位置就清掉。
- **後端存**：再檢查一次上班時間（台北真實時間，`LOCATION_SHARE_HOURS`，預設週一到週五 08:30–18:30，
  測試時可以用設定改）與暫停狀態，寫 `user_location`。跟上一筆差不到 30 公尺而且不到 2 分鐘就不寫、不發事件。
  代理示範業務的帳號寫在示範業務名下；同時有好幾位評審代理同一位，以最後一筆為準。
- **暫停**：`POST /api/location/pause`、`POST /api/location/resume`，發 `location` 事件。
- **位置描述**（`services/locations.py`，純函式），依序判斷：
  - 現在不是上班時間：「下班時間」。
  - 暫停中：「暫停分享位置」，有最後位置就加「· 最後位置 HH:MM」。
  - `denied`：「沒有開定位權限」。
  - 今天沒有位置：「今天還沒有位置」。
  - 超過 5 分鐘沒更新：「最後位置 HH:MM」，再加最近一家客戶的地區（3 公里內才寫）。
  - 離某一站 200 公尺內：「在 X 附近」。
  - 還有沒跑的站：「往第 N 站 X 途中」。
  - 全部跑完：「今天跑完了」。
- **不留軌跡**：每人只有一列，覆寫。下班時間不寫；隔天第一筆之前，主管看到的是「今天還沒有位置」
  （`at` 不是今天就不顯示）。

## API

| 方法與路徑 | 用途 |
|---|---|
| `GET /api/itinerary/today` | 今天的行程（沒有就建），含排程、規則、違反、`urgent`、`version`、`estimated` |
| `GET /api/itinerary/today/map` | 首頁切到「地圖」：各站的站號、座標、狀態，出發點與沿路的線（大眾運輸分走路與搭車），`version`、`travel_mode` |
| `GET/PUT /api/itinerary/travel-mode` | 行程主人的交通方式；換了回重算好的今天行程 |
| `POST /api/itinerary/today/preview` | 編輯中的行程算時間與違反的規則，不存 |
| `PUT /api/itinerary/today` | 調整清單按「完成」：整份站、先後、今天不套用的習慣、要新增的習慣，帶 `version` |
| `POST /api/itinerary/today/stops` | 加一站或多站（加一站頁、問答的「排入今天的路線」），`cheapest_insert` |
| `POST /api/itinerary/today/feedback` | 需立即處理的三顆鈕：`pin`（移到下一站）、`snooze`、`misjudge` |
| `GET /api/itinerary/today/candidates` | 加一站的候選清單與估算的多繞分鐘 |
| `POST /api/itinerary/today/optimize` | 幫我排順一點，回提案 |
| `POST /api/itinerary/today/ask` | 跟熊熊滾說，回提案／要選一個／只回答 |
| `POST /api/itinerary/proposals/{id}/apply` | 套用提案 |
| `GET/POST /api/route-habits`、`PATCH/DELETE /api/route-habits/{id}` | 我的排序習慣 |
| `POST /api/location/pause`、`/resume` | 暫停、繼續分享位置 |
| `GET /api/maps/config` | 瀏覽器用的 Google 地圖金鑰（主管頁與首頁的地圖都用，登入的人都給） |
| `GET /api/manager/itineraries` | 主管的團隊總覽（含路線折線、位置描述、差異摘要） |
| `GET /api/manager/itineraries/{user_id}` | 一位業務的詳細 |
| `POST /api/admin/demo-itinerary/reset` | IT 重置示範業務今天的行程（刪掉行程與所有暫緩、訊號權重、排序習慣回到一開始那三條） |

業務的路線一律由 token 決定（`acts_as_user_id or id`），不是前端說了算；主管與 IT 打業務的 API 回 403
「主管沒有自己的拜訪路線」（跟現在一樣）。`POST /api/route/today` 拿掉。

## 原本的功能怎麼接

| 原本 | 改成 |
|---|---|
| `POST /api/route/today`（手機送回饋、每次重排） | `GET /api/itinerary/today` |
| `lib/route-feedback.ts`（localStorage） | 拿掉；暫緩與誤判存 `route_snooze`、`route_signal_weight` |
| 插入下一站 | 把那家移到下一站的位置（不鎖），加權重照舊 |
| 暫緩 | 從今天的行程拿掉 + 三天內不排 |
| 誤判 | 暫緩 + 這類訊號權重減一 |
| 問答的「排入今天的路線」 | `POST /api/itinerary/today/stops`；超過 8 站時加得下的先加，其他列出「沒加進去」 |
| 卡片「已排入，今日路線會排在最前面」 | 「已加進今天的行程，插在順路的位置」 |
| 熊熊滾點了進問答 | 不變 |

`today_route.build` 拆成兩段：「挑哪幾家」（模型、承諾逾期、商機、暫緩，照舊）與「排順序」（交給 `route_planner`）。
`planned_time` 不再用固定的 70 分鐘間隔。

## 程式結構

```
backend/app/services/route_planner.py     排序（純函式）
backend/app/services/travel.py            車程：Google 路線矩陣與直線估算
backend/app/services/google_routes.py     Routes API 的呼叫（矩陣、折線），只有這支知道 Google 的格式
backend/app/services/itinerary.py         今天的行程：建立、套用操作、存檔、版本、習慣套用
backend/app/services/route_habits.py      習慣的比對、衝突、產生那句話
backend/app/services/itinerary_ai.py      跟熊熊滾說：組提示、呼叫 llm.json、驗證操作
backend/app/services/locations.py         位置的存取與描述
backend/app/services/today_route.py       只留「挑哪幾家」
backend/app/api/itinerary.py              業務的行程、提案、習慣、位置暫停、地圖金鑰
backend/app/api/manager.py                多兩支團隊行程
backend/app/api/presence.py               心跳多收位置
backend/app/schemas/itinerary_ops.schema.json   AI 的輸出格式
data/seed/catalog.py                      DISTRICT_COORDS、REGION_OFFICE、示範習慣
backend/scripts/eval_itinerary_ai.py      20 句話的實測

frontend/src/api/itinerary.ts
frontend/src/lib/itinerary.ts             清單換位置、拖移後的習慣句子、對照卡差異（純函式）
frontend/src/lib/location-share.ts        上班時間判斷、要不要帶位置（純函式）
frontend/src/pages/today.tsx              資料來源換掉、調整鈕、位置分享列、輸入列
frontend/src/pages/route-edit.tsx         調整行程（清單）
frontend/src/pages/route-add.tsx          加一站
frontend/src/pages/route-habits.tsx       我的排序習慣
frontend/src/components/route/stop-card.tsx、stop-editor.tsx、habit-prompt.tsx、proposal-sheet.tsx、ask-bar.tsx、share-bar.tsx
frontend/src/components/manager/routes-panel.tsx、route-map.tsx（import() 載入 Google 地圖）
frontend/src/components/map-slot.tsx      地圖的外框：問金鑰、金鑰被拒或載不下來時換成說明（主管頁與首頁共用）
frontend/src/components/route/home-map-panel.tsx、home-map.tsx（import() 載入）、map-stop-card.tsx   首頁的地圖
frontend/src/lib/home-map.ts              首頁地圖的卡片文字與導航網址（純函式）
frontend/src/lib/route-draw.ts            路線一段一段畫出來的幾何（純函式）
frontend/src/lib/travel-mode.ts           交通方式的字、導航用的 travelmode、車程來源
```

## 測試

**後端（pytest）**

- `route_planner`：先後一定守；`at`／`before` 晚到算對、`after` 早到會等；鎖住的位置不動；已完成的不進排序；
  排第一、排最後；挑晚到最少、再挑車程最短；排不出來時回擋住的那幾條；`rule_costs` 的差值；`cheapest_insert`
  不違反規則；8 站在 1 秒內。
- `travel`：估算的數字；Google 回應用假的；Google 失敗、逾時、沒金鑰時退回估算並標 `estimated`；讀行程只問相鄰兩站、
  不問整份矩陣；Google 失敗後 60 秒內不再問。
- `route_habits`：四種對象的比對；星期幾；`window`、`duration` 只當預設值；習慣之間衝突時新的優先；
  今天的先後蓋過習慣。
- `itinerary`：第一次讀才建、之後不重排；主管讀也會建；`suggested` 不變；`PUT` 的 `version` 409；
  刪一站連先後一起刪；三顆鈕；`stops` 超過 8 站；`urgent` 那家鎖第一站。
- `itinerary_ai`（`llm.json` 用假的）：每種操作；別人的客戶 id 轉成找不到；`ask_which`；只回答；
  `apply` 照存下來的操作重做；`base_version` 不同回 409；Gemini 沒設定回 503。
- 主管：只看得到自己底下的人；IT 看全公司；業務打主管的 API 403；差異摘要（拿掉、自己加、順序）。
- 位置：上班時間外不寫；暫停後不寫；不到 30 公尺又不到 2 分鐘不寫；代理帳號寫在示範業務名下；
  描述的每一種情況；`at` 不是今天不顯示。

**前端（vitest，node 環境）**

- `lib/itinerary.ts`：上移下移、拖移後的習慣句子（往上、往下）、對照卡的換位標記。
- `lib/location-share.ts`：上班時間的邊界（08:29、08:30、18:30、週六）、沒權限、暫停。
- 元件用 `renderToStaticMarkup`：提案卡三種結果、違反規則的紅框、位置分享列四種狀態、主管卡片的各種提示。

**AI 實測**：`scripts/eval_itinerary_ai.py` 20 句（移動、新增、刪除、約時間、停留、先後、排順路、記習慣、
停用習慣、對不到客戶、名字有兩家、只問不改），比對預期的操作，跟 `eval_ask.py` 一樣手動跑、結果寫進 `data/eval/`。

**實機**：手機尺寸用無頭 Chrome 分段操作（每段 30 秒內，API 用假的），截圖首頁、調整清單、展開編輯、
習慣提示、提案卡、習慣頁、主管兩頁（地圖用假的金鑰時顯示「地圖暫時載入不了」）。另外用真的金鑰在瀏覽器手動看一次地圖。

## 示範資料

- 系統的今天是 10/28（三）。林昱辰（U01）先放 3 條習慣：「康泰的店排在診所前面」（每天，在首頁說的）、
  「敦南內科診所 · 大安 排最後」（每個星期三，自己新增的；安和內科診所 · 信義是王冠宇的客戶）、「杏林診所 · 大安 都 11:00 以前到」（每天，自己新增的）。
- 王冠宇（U02）不放習慣，主管頁上是「照系統建議，還沒動過」。
- 位置照真的 GPS，不模擬。

## 已知限制

- 網頁 app 只有畫面開著時拿得到位置；鎖螢幕或切到別的 App 就停了，主管看到「最後位置 · N 分鐘前」。
- 好幾位評審同時代理同一位示範業務時：行程用 `version` 擋住互相覆蓋（後存的人會看到重新整理），
  但系統日期固定不換天，大家的改動（暫緩、插入下一站、加站）會一直累積，不會自動恢復；IT 要在組織管理頁按
  「重置示範業務今天的行程」才會清掉、回到模型原本的建議。位置以最後一筆為準，主管頁上那位業務的位置會在評審之間跳動；
  分享的是評審本人手機的位置。
- 客戶位置是地區中心點加錯開，不是真的地址；Google 的路線會從最近的道路出發，首頁地圖的「導航」也是開到這個點。
- 車程不看即時路況。

## 不在這次範圍

- 主管改業務的行程、留言給業務。
- 往前或往後翻其他日子的行程；排明天以後的行程。
- 位置軌跡、離開路線的警示、背景定位（原生 App）。
- 從拖移紀錄自動歸納習慣（只在業務點頭時記）。
- 問答頁與語音問答的行程調整。

## 分階段做

每階段做完都能上線，後面的階段不必回頭改前面的資料表。

1. **位置資料、排序程式、行程存檔**：客戶與辦公室座標、`route_planner`、`travel`（只有估算）、`itinerary` 系列資料表與
   `GET /api/itinerary/today`、三顆鈕、`route_snooze`、`route_signal_weight`；首頁換資料來源，看起來跟現在一樣，只是順序照順路排。
2. **調整清單與習慣**：調整行程、加一站、展開編輯、違反規則、拖完記習慣、我的排序習慣、`preview`／`PUT`、
   問答「排入今天的路線」改接。
3. **跟熊熊滾說要怎麼排**：輸入列、`ask`／`optimize`／`apply`、提案卡、AI 實測。
4. **Google**：`google_routes`、Routes API 矩陣取代估算、地圖金鑰設定。
5. **主管端行程分頁**：團隊總覽、詳細、差異摘要、地圖與折線。
6. **即時位置**：心跳帶位置、`user_location`、暫停、位置描述、分享列、主管頁的頭像與即時更新。
