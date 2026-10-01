# 首頁改成 Duolingo 那樣的路線，全站換成厚按鈕與粉圓體

2026-10-01

業務的首頁（今日路線）改成 Duolingo 主畫面那種一顆顆圓鈕蛇行往下的路；全站的按鈕、卡片、輸入框換成 Duolingo 那種
「厚」的樣子（2px 邊框加 4px 厚底，按下會陷下去）；字型換成粉圓體。

## 為什麼做

- 今日路線本來就是「照順序一站一站走完」的一條路，跟 Duolingo 的學習路徑是同一件事，現在卻是一般的清單。
- 首頁的頁首擠了七樣東西（名字、深淺色、使用說明、方法卡、申請單、主管回覆、登出），手機上名字常被截掉。
- 熊熊滾在首頁只是右下角的一顆浮鈕。

## 參考 Duolingo 什麼、不碰什麼

參考的是互動方式與版面概念：頂部的「圖示＋數字」狀態列、單元橫幅與指南按鈕、蛇行的厚圓鈕、目前那一站上面跳動的泡泡、
點了彈出的小卡、路旁站著的角色、單元終點、厚按鈕。

**不碰 Duolingo 自己的東西**：Duo 貓頭鷹、名字與標誌、Feather 字型、連勝火焰／寶石／愛心的圖示、招牌綠色、音效、插圖。
圖示一律用 lucide，顏色用我們自己的紫色配色。決賽簡報或 README 寫一句「首頁的路徑式設計參考 Duolingo」。

## 已定案的決定

1. **範圍**：業務首頁整頁照 Duolingo 改；全站的按鈕、卡片、輸入框、對話框換成厚的；字型換成粉圓體。
   **底部分頁維持現在的浮動膠囊，不改**。主管端與組織管理頁只跟著換厚樣式與字型，版面不動。
2. **路線是蛇行**，客戶名與時間標在圓鈕旁邊空的那一側。
3. **「需立即處理」是橫幅下面的一張厚紅卡**，三顆鈕照舊（插入下一站、暫緩、誤判）。
4. **點一站彈出小卡**，寫完整的理由，再按鈕進客戶檔案；下一站上面的「出發」泡泡直接進客戶檔案。
5. **全厚**：按鈕、卡片、輸入框、對話框都有 2px 邊框加 4px 厚底。只是看的資訊卡也是厚的（選了 Duolingo 原樣，
   接受它看起來也像能按），但只有能按的東西按下去會陷。
6. **字型是粉圓體（jf open 粉圓／Huninn）**，SIL OFL 1.1，可以商用。用 `@fontsource/huninn` 自己帶，不連 Google Fonts。
7. **後端不改**，全部用現有的今日路線 API、主管回覆未讀數。

## 首頁版面

由上往下：

### 頂部（往下捲時固定在最上面）

**狀態列**

| 位置 | 內容 | 點了 |
|---|---|---|
| 左 | 「北區 · 林昱辰 ›」；第三方登入的人第二行「示範：林昱辰的客戶」（跟現在一樣） | 帳號設定 |
| 右 1 | 🚩 `2/6`（今日完成幾站／共幾站），取代原本的進度條；路線還沒載入時不顯示 | 不能點，只是顯示 |
| 右 2 | 🔔 主管回覆未讀數；0 的時候只有圖示 | 轉給主管的提問 |
| 右 3 | 📄 | 我的申請單 |
| 右 4 | 🌙／☀️ 深淺色切換（`SkinToggle`，照舊） | 換配色 |

圖示有顏色，像 Duolingo 的狀態列：旗子是主色，鈴鐺在有未讀時是琥珀色（`warning`），其他是灰色。

**橫幅**：主色的厚圓角條（主色厚底）。左邊小字「10/1（三）· 6 站」、大字「今日路線」；右邊隔一條線是「方法卡」
按鈕（書本圖示＋「方法卡」兩個字），點了進方法卡。路線還沒載入時只寫「今日路線」。

**移出首頁**：登出（帳號設定本來就有）、使用說明（客戶清單頁首照舊有一顆；帳號設定新增一行「看使用說明」）。

### 頂部下面

1. 新人第一週的入口卡（`FirstWeekEntry`，照舊）。
2. 提示：連不上伺服器時顯示上次的路線、「已插到下一站…」、「重新排今天的順序…」，文字照舊。
3. 「需立即處理」厚紅卡：左上紅色小標「需立即處理 · 帳款」，客戶名（點了進客戶檔案）、說明、補充說明；
   三顆鈕：插入下一站（實心紅、厚）、暫緩、誤判（白底厚邊）。行為照舊。
4. 路線（下一節）。

### 路線

**排法**：每站一列，列高 92px。圓鈕依站的順序左右偏移，8 站一個來回：

```
偏移（px，正的往右）：0, 40, 64, 40, 0, -40, -64, -40, 0, 40, …
```

- 圓鈕偏右（偏移 > 0）時，名字標在左邊、靠右對齊；置中或偏左時，標在右邊。
- 標籤兩行：客戶名（最多兩行，超過截掉）、「時間 · 理由類別」。已完成的照現在寫「時間 完成」，有回寫的再加「 · 已回寫」。
  理由類別「商機」用綠色，其他警示類（承諾逾期、帳款…）用紅色，「例行」用灰色。
- 下一站那一列上面多留 32px，放「出發」泡泡。

**圓鈕**：58×54 的橢圓（跟 Duolingo 一樣略寬），6px 厚底，按下去陷下去。

| 狀態 | 樣子 |
|---|---|
| 已完成 | 主色底、白色勾；主色厚底 |
| 下一站 | 主色底、站號；外面一圈 5px 的淡主色環；上面「出發」泡泡上下輕輕跳 |
| 待拜訪 | 灰底（`input` 色）、灰字站號；灰色厚底。照樣點得到，灰色不代表鎖住 |

**「出發」泡泡**：白底、2px 邊框、主色字，下面一個小尖角指著圓鈕。它本身是連結，點了直接進客戶檔案。
系統開了「減少動態效果」時不跳。

**點圓鈕彈出的小卡**：浮在那一站下面、蓋住後面的路，全寬，上面的尖角對準那顆圓鈕。

- 內容：客戶名（大字）· 時間 · 第幾站；理由類別 · 完整的一句理由（`stop.reason`）。
- 一顆主色厚按鈕：還沒去的站「開啟拜訪準備」，已完成的站「看客戶檔案」。都是進 `/customers/:id`。
- 同一時間只開一張。點卡片以外的地方、再點同一顆圓鈕、按 Esc 都會收起來；開別站就換成別站的。
- 圓鈕是 `<button aria-expanded>`，小卡用 `aria-controls` 連起來。

**熊熊滾**：站在「下一站之後（含）第一個置中（偏移 0）的站」的左邊空位，72px 全身，`idle`。
找不到這樣的站（例如剩下的站都不在置中的位置），或今天全部跑完了，就站在終點旁邊。
點牠進問答（`aria-label="問熊熊滾（問答）"`）。原本右下角的浮鈕拿掉。

**終點**：最後一站下面置中一顆「收工」的厚圓鈕（旗子圖示），下面寫「收工」。

- 還沒跑完：灰色。
- 全部跑完：主色；熊熊滾站在旁邊、狀態 `yay`；終點下面寫「今天 N 站都跑完了」。

**其他狀態**

| 狀態 | 畫面 |
|---|---|
| 載入中 | 熊熊滾 `wait`（96px）＋「載入今日路線中…」 |
| 今天沒有排拜訪 | 熊熊滾 `think`（96px）＋「今天沒有排定的拜訪。」＋厚按鈕「自己挑一家」→ 客戶清單；沒有終點 |
| 連不上、主管帳號被擋 | 照舊用 `Notice`（按鈕跟著變厚） |

## 全站的厚樣式

### 顏色

`index.css` 新增四個顏色，淺色與深色各一組：

| 變數 | 用途 | 淺色 | 深色 |
|---|---|---|---|
| `--lip` | 卡片、白底按鈕、輸入框的厚底 | `#DCD6E4` | `#333332` |
| `--lip-strong` | 灰色圓鈕的厚底 | `#C9C3D3` | `#2A2A29` |
| `--primary-lip` | 主色按鈕、圓鈕、橫幅的厚底 | `#7A3BB8` | `#8A8A87` |
| `--destructive-lip` | 實心紅按鈕的厚底 | `#84301B` | `#A63E2C` |

淡色卡（`bg-primary/10`、`bg-destructive/10` 那種）的厚底用 `color-mix` 從主色或紅色調出來，跟邊框同一個色調。

### 寫法

在 `@theme inline` 定義幾個 `shadow-*`：`shadow-lip`、`shadow-lip-primary`、`shadow-lip-destructive`、
`shadow-lip-primary-soft`、`shadow-lip-destructive-soft`（都是 `0 4px 0 <顏色>`），再加一個 `press` 工具類：
按下時往下移 4px、厚底消失。用 `translate` 而不是改邊框寬度，按下時高度不變，下面的版面不會跳。
厚底走 Tailwind 的 shadow，跟 focus 的 ring 可以同時存在。

| 元件 | 改成 |
|---|---|
| `Button` default | 主色底、`shadow-lip-primary`、`press` |
| `Button` outline | 2px 邊框、卡片底、`shadow-lip`、`press` |
| `Button` secondary | 次要色底、`shadow-lip`、`press` |
| `Button` destructive | 淡紅底、2px 淡紅邊框、`shadow-lip-destructive-soft`、`press` |
| `Button` danger（新增） | 實心紅、白字、`shadow-lip-destructive`、`press`（「插入下一站」用） |
| `Button` ghost、link | 不變（平的） |
| `Button` 圓角 | `rounded-lg` → `rounded-xl` |
| `Input`、`Textarea`、`NativeSelect` | 2px 邊框、`shadow-lip`；不陷 |
| `Dialog` 內容 | 2px 邊框、`shadow-lip` |
| `Badge` | 不變（平的，它不是按鈕） |
| 底部分頁 | 不變 |

各頁手刻的東西：

- **卡片**（`rounded-xl/2xl border bg-card` 那種，約 58 處）：`border` → `border-2`，加 `shadow-lip`；
  本身是連結或按鈕的再加 `press`，原本 `active:bg-muted` 的按下效果拿掉。
- **淡色卡**（`border-primary/20 bg-primary/10`、`border-destructive/30 bg-destructive/10`）：`border-2`，
  厚底用對應的 `-soft`。
- **手刻的主色按鈕**（連結做成按鈕的樣子，約 10 處）：改用 `buttonVariants()`，跟 `Button` 長得一樣。
- 表格外框、附件縮圖、虛線框這類不是卡片的邊框不動。

### 字型

- 加 `@fontsource/huninn`（只有 400 一個字重），拿掉 `@fontsource/ibm-plex-sans`。
- `--font-sans: 'Huninn', 'PingFang TC', 'Noto Sans TC', 'Microsoft JhengHei', sans-serif`。英文與數字也用粉圓
  （它的英文是 Varela Round），整體一致都是圓的。
- 字型檔按字切成 111 塊（`unicode-range`），畫面用到哪些字才下載哪幾塊。下載前先用手機內建的黑體顯示
  （`font-display: swap`）；沒網路、還沒快取時就一直是黑體，不影響使用。
- `font-medium`、`font-semibold` 由瀏覽器把 400 加粗。實作時在手機尺寸截圖檢查；如果加粗後的中文糊掉，
  改成 `font-synthesis-weight: none`，標題靠字級分層級。

## 程式結構

```
src/lib/route-path.ts            路線的排法（純函式）：第幾站偏移多少、標籤在哪一邊、熊站在哪一站
src/lib/route-path.test.ts
src/components/route-path.tsx    路線：圓鈕、標籤、出發泡泡、彈出小卡、熊熊滾、終點
src/components/route-path.test.ts
src/pages/today.tsx              頂部狀態列、橫幅、提示、需立即處理、載入／空白狀態；路線交給 RoutePath
src/pages/settings.tsx           新增「看使用說明」
src/index.css                    顏色、shadow-lip-*、press、字型
src/components/ui/*.tsx          Button、Input、Textarea、NativeSelect、Dialog
其他頁面與元件                     手刻卡片、手刻按鈕換成厚樣式
```

`lib/route-path.ts`：

```ts
export const PATH_OFFSETS = [0, 40, 64, 40, 0, -40, -64, -40]
export function pathOffset(index: number): number          // PATH_OFFSETS[index % 8]
export function labelSide(offset: number): "left" | "right" // offset > 0 ? "left" : "right"
/** 熊站在哪一站的旁邊；null 是站在終點旁邊 */
export function bearStopIndex(stops: { status: "done" | "next" | "todo" }[]): number | null
```

`bearStopIndex`：從第一個 `next`（沒有 `next` 就從第一個 `todo`）開始往後找，第一個偏移是 0 的站；
全部完成或找不到就是 `null`。

`RoutePath` 只吃 `stops`，自己管「哪一張小卡開著」；完成數由 `stops` 算。

## 測試

vitest 是 node 環境：

- `route-path.test.ts`（lib）：偏移的循環、標籤的邊、熊的位置（下一站剛好置中、下一站之後才置中、找不到、全部完成、
  沒有 `next` 只有 `todo`）。
- `route-path.test.ts`（元件，`renderToStaticMarkup` 包在 `MemoryRouter` 裡）：三種狀態的圓鈕、只有下一站有「出發」、
  已完成有勾、熊的連結指向 `/ask`、全部完成時終點寫「今天 N 站都跑完了」且熊是 `mascot-yay`。
- 既有測試照樣要過。
- 在手機尺寸（375×812）用 headless Chrome 截圖檢查淺色、深色、首頁、客戶檔案、登入頁、問答頁、彈出小卡。

## 不在這次範圍

- 連勝、經驗值、排行榜這類遊戲化的東西（沒有對應的資料，也不是這次要的）。
- 音效。
- 底部分頁、熊熊滾的造型。
- 主管端、組織管理頁的版面（只換樣式）。
- 捲離目前那站時跳回去的浮鈕（路線一天 5～8 站，不需要）。
