# 座騎第二階段：28 種座騎與定案表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 熊熊滾能坐上「七個縣市 × 四種交通方式」共 28 種座騎（特產本身就是座騎），做成 React 元件 `<Ride city mode />`，再產生一張用瀏覽器打開就會動的定案表給使用者挑。

**Architecture:** `mascot.tsx` 把熊的身體抽成 `MascotFigure`（一個 `<g>`），多一個 `ride` 狀態。`components/rides/ride.tsx` 畫一張 `0 0 300 200` 的 SVG，交給該縣市、該交通方式的座騎元件；座騎元件自己決定圖層順序，在要放熊的地方呼叫 `bear({ x, y, size })`。共用的動畫 class 在 `ride.css`。定案表由 `npm run ride-sheet` 用 Vite 的 SSR 載入同一批元件產生，跟程式畫出來的一模一樣。

**Tech Stack:** React 19、TypeScript、SVG + CSS 動畫、vitest（`renderToStaticMarkup`）、Vite SSR（產生定案表）、headless Chrome（截圖檢查）。

**設計文件：** `docs/superpowers/specs/2026-10-07-ride-vehicles-design.md`〈座騎〉〈定案表〉（〈分階段做〉的第 2 階段）。熊熊滾的規格：`docs/superpowers/specs/2026-09-30-mascot-design.md`。

## Global Constraints

- 不碰後端。註解與畫面文字一律繁體中文；畫面不用表情符號。
- 畫法：跟熊熊滾一樣平塗、沒有漸層、只用圓與圓角形狀；**形狀不描邊**（竹籤、把手、風線、吸管這種「本身就是線」的東西可以用 stroke，線頭 `round`）。每個縣市的特產最多另外加 3 個顏色（亮面、暗面可以算同一色的深淺，但總共不超過 3 個新色碼）。
- 熊熊滾的顏色照舊：主色 `#9B51E0`、淺紫 `#EADBFD`、深色 `#2B1B47`、舌頭 `#FF8FB3`；道具淺紫 `#C9A2F5`、黃 `#FFC93C`；白 `#fff`。座騎的輪子、窗、車燈優先用這幾色。
- 畫布 `0 0 300 200`，座騎一律朝右；地面是一條淡色的線，`y` 約 187。熊用 `bear({ x, y, size })` 放（熊自己的畫布是 240×240，`size` 是邊長）。
- 要在 96px 寬（首頁路線上）還看得出是什麼：形狀要大、要少。
- 動畫：輪子轉、車身上下浮、各縣市走路的動法（滾、彈、飄、跳、游、滑）。只用 `transform` 與 `opacity`。系統設定「減少動態效果」或 `still` 時全部停住。
- 縣市名稱照資料庫：`台北市`、`新北市`、`新竹市`、`台中市`、`彰化縣`、`台南市`、`高雄市`（「台」不是「臺」）。交通方式：`drive`、`scooter`、`transit`、`walk`（`LegMode`，`lib/travel-mode.ts` 的 `LEG_MODES`）。
- 檔名用英文：`taipei`、`new-taipei`、`hsinchu`、`taichung`、`changhua`、`tainan`、`kaohsiung`。各縣市自己的 keyframes 與 class 用 `ride-<檔名>-` 開頭。
- 前端指令：`npm --prefix frontend run test -- <檔名>`；收尾跑 `npm --prefix frontend run typecheck`、`npm --prefix frontend run lint`、`npm --prefix frontend test`。
- 不要對動到的檔案跑 `prettier --write`（這個專案的前端不是照 .prettierrc 排的）。
- 每個 commit 訊息用英文祈使句，最後空一行再加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## 座騎的樣子（設計文件〈座騎〉）

| 縣市（特產） | 開車 | 機車 | 大眾運輸 | 走路 |
|---|---|---|---|---|
| 台北市（小籠包） | 小籠包當車身 | 輪子是兩個小籠包 | 蒸籠疊成的捷運車廂 | 在小籠包上一路彈過去 |
| 新北市（平溪天燈） | 天燈當車身 | 天燈當車身 | 一串天燈連成的空中纜車 | 坐在天燈上飄過去 |
| 新竹市（貢丸） | 貢丸當車身 | 輪子是兩顆貢丸 | 一串貢丸當列車 | 踩著貢丸滾，風城的風 |
| 台中市（珍珠奶茶） | 珍奶杯橫躺當車身，吸管當天線 | 輪子是兩顆珍珠 | 珍奶杯當公車，珍珠是乘客 | 踩著一顆顆珍珠跳過去 |
| 彰化縣（肉圓） | 肉圓當車身，Q 彈地彈 | 輪子是兩顆肉圓 | 一串肉圓當列車 | 在肉圓上彈跳，像跳跳床 |
| 台南市（虱目魚） | 虱目魚當車身 | 虱目魚當車身 | 一群虱目魚排成列車 | 騎在魚背上游過去 |
| 高雄市（旗山香蕉） | 香蕉當車身 | 香蕉當車身 | 一串香蕉當列車 | 踩到香蕉皮一路滑過去 |

使用者挑方向時看過的新竹四種草圖（方向 A，已選）在主目錄的
`.superpowers/brainstorm/32452-1791273434/content/vehicle-style.html`（第一組四張），座標與做法可以直接參考。

## 檢查畫出來的樣子

每個畫座騎的任務都要自己看過：

```bash
npm --prefix frontend run ride-sheet
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --force-prefers-reduced-motion --window-size=1400,2400 \
  --screenshot=/private/tmp/claude-501/-Users-jamessu-Desktop-computersciencehomework-MEDDEMO/2318253c-179a-4529-a7dc-c19415500f0b/scratchpad/sheet-<任務>.png \
  "file:///Users/jamessu/Desktop/computersciencehomework/MEDDEMO/.claude/worktrees/rides-vehicles/docs/superpowers/specs/assets/2026-10-07-ride-sheet.html"
```

用 Read 打開截圖看：認得出是哪個特產、熊坐得穩（不懸空、不被切掉一半臉）、在定案表最小的那一欄（96px）也看得懂。
動畫要另外開一次不帶 `--force-prefers-reduced-motion`、截兩張隔 0.5 秒的圖，或用 headless Chrome 的 DevTools 錄兩個時間點，確認有動、不會跑出畫布。

---

### Task 1: 熊熊滾可以疊到別的 SVG 裡，多一個「騎乘」表情

**Files:**
- Modify: `frontend/src/lib/mascot.ts`、`frontend/src/components/mascot.tsx`、`frontend/src/components/mascot.css`、`frontend/src/components/mascot.test.ts`
- Modify: `docs/superpowers/specs/2026-09-30-mascot-design.md`（〈狀態〉表多一列、〈元件〉提到 `MascotFigure`）

**Interfaces:**
- Produces:
  - `MascotState` 多 `"ride"`
  - `MascotFigure({ state = "idle", props = true })`：回一個 `<g className="mascot-all">`（身體、耳朵、臉；`props` 時加狀態的道具），畫布座標 `0 0 240 240`。**狀態的動畫靠外層 `.mascot-<state>`**，疊到別處時外面要包 `<g className={`mascot mascot-${state}`}>`。
  - `Mascot` 的用法與輸出不變（還是 `class="mascot mascot-<state>"` 在 `<svg>` 上）。

- [ ] **Step 1: 寫失敗的測試**

`mascot.test.ts`：「每個狀態有自己的表情和道具」的對照表加一筆 `ride: ["happy", "open"]`，`idle` 那行的「沒有道具」斷言旁加 `expect(render({ state: "ride" })).not.toMatch(/mascot-(wave|dot|load|star)/)`；顏色那個測試的 `states` 加 `"ride"`（顏色集合不變）。再加：

```ts
import { MascotFigure } from "@/components/mascot"

it("MascotFigure 只有熊本身，可以疊到別的 svg 裡", () => {
  const g = renderToStaticMarkup(createElement("svg", null, createElement(MascotFigure, { state: "ride", props: false })))
  expect(g).toContain('class="mascot-all"')
  expect(g).toContain('data-eyes="happy"')
  expect(g).toContain('data-mouth="open"')
  expect(g).not.toContain("mascot-shadow")
  expect(g).not.toContain("<svg viewBox")
})
```

Run: `npm --prefix frontend run test -- mascot`
Expected: FAIL（`ride` 不是 `MascotState`、`MascotFigure` 不存在）

- [ ] **Step 2: 實作**

`lib/mascot.ts`：

```ts
/** 熊熊滾的八個狀態（components/mascot.tsx 照這個畫，動畫在 components/mascot.css）。ride 是坐在座騎上（components/rides） */
export type MascotState = "idle" | "hi" | "listen" | "think" | "talk" | "wait" | "yay" | "ride"
```

`mascot.tsx`：`FACE` 加 `ride: ["happy", "open"]`；把 `<svg>` 裡 `<g className="mascot-all">…</g>` 整段搬進新的 `MascotFigure`，`Mascot` 改成：

```tsx
export function Mascot({ state = "idle", size = 96, bust = false, label, className }: MascotProps) {
  return (
    <svg
      className={cn("mascot", `mascot-${state}`, className)}
      viewBox={bust ? "24 16 192 192" : "0 0 240 240"}
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {!bust && <ellipse className="mascot-shadow" cx="120" cy="222" rx="60" ry="7" fill={INK} opacity=".13" />}
      <MascotFigure state={state} props={!bust} />
    </svg>
  )
}

/**
 * 熊熊滾本身：身體、耳朵、臉，加上這個狀態的道具（props），畫布座標 0 0 240 240，不含影子。
 * 座騎（components/rides/ride.tsx）把它疊進自己的 svg。狀態的動畫掛在外層的 .mascot-<state> 上，
 * 疊到別處時外面要包一層 <g className={`mascot mascot-${state}`}>。
 */
export function MascotFigure({ state = "idle", props = true }: { state?: MascotState; props?: boolean }) {
  const [eyes, mouth] = FACE[state]
  return (
    <g className="mascot-all">
      {/* 原本 <g className="mascot-all"> 裡面的內容照搬 */}
      {props && <Props state={state} />}
    </g>
  )
}
```

`mascot.css` 最後（減少動態效果那段之前）加：

```css
/* 騎乘：坐在座騎上，笑到瞇起來、張嘴；身體不另外動，由座騎晃（components/rides/ride.css） */
```

（`ride` 不需要任何 keyframes；只要確認沒有既有規則套到 `.mascot-ride`。）

`2026-09-30-mascot-design.md`：〈狀態〉表最後加一列 `| 騎乘 | ride | 坐在座騎上，身體不另外動（由座騎晃） | 笑到瞇起來／張嘴 |`；〈元件〉加一句「熊本身是 `MascotFigure`（一個 `<g>`），座騎把它疊進自己的 svg（2026-10-07 加）」。

- [ ] **Step 3: 跑測試確認通過，全部檢查**

Run: `npm --prefix frontend run test -- mascot && npm --prefix frontend run typecheck && npm --prefix frontend run lint`
Expected: PASS（其他用到 `Mascot` 的測試照舊）

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/mascot.ts frontend/src/components/mascot.tsx frontend/src/components/mascot.css frontend/src/components/mascot.test.ts docs/superpowers/specs/2026-09-30-mascot-design.md
git commit -m "Let the bear sit inside other drawings and give it a riding face

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 座騎的骨架、新竹的四種與定案表

**Files:**
- Create: `frontend/src/lib/rides.ts`、`frontend/src/lib/rides.test.ts`
- Create: `frontend/src/components/rides/ride.tsx`、`frontend/src/components/rides/ride.css`、`frontend/src/components/rides/ride.test.ts`
- Create: `frontend/src/components/rides/vehicles/types.ts`、`frontend/src/components/rides/vehicles/colors.ts`、`frontend/src/components/rides/vehicles/parts.tsx`、`frontend/src/components/rides/vehicles/index.ts`、`frontend/src/components/rides/vehicles/hsinchu.tsx`
- Create: `frontend/src/components/rides/sheet.tsx`、`frontend/scripts/ride-sheet.mjs`；Modify: `frontend/package.json`（`"ride-sheet": "node scripts/ride-sheet.mjs"`）
- Create（產生的）：`docs/superpowers/specs/assets/2026-10-07-ride-sheet.html`
- Modify: `docs/superpowers/specs/2026-10-07-ride-vehicles-design.md`（〈元件〉：`vehicleFor` 在 `components/rides/vehicles/index.ts`；`lib/rides.ts` 只放縣市；「這次該播哪一段」留到第三階段）

**Interfaces:**
- Consumes: Task 1 的 `MascotFigure`、`MascotState`；`LegMode`（`@/api/route`）、`LEG_MODES`（`@/lib/travel-mode`）
- Produces:
  - `lib/rides.ts`：`RIDE_CITIES`（七個，照圖鑑順序）、`type RideCity`、`SPECIALTY: Record<RideCity, string>`、`rideCity(city): RideCity | null`
  - `vehicles/types.ts`：`BearAt = { x; y; size }`、`VehicleProps = { bear: (at: BearAt) => ReactNode }`、`CityVehicles = Record<LegMode, ComponentType<VehicleProps>>`
  - `vehicles/colors.ts`：熊熊滾的顏色常數 `INK`、`BASE`、`LIGHT`、`PROP`、`STAR`（放在 .ts：react-refresh 的 lint 不准 .tsx 元件檔同時 export 常數）
  - `vehicles/parts.tsx`：共用的 `Ground`（地面那條線）、`Wheel`（會轉的輪子：`cx`、`cy`、`r`）
  - `vehicles/index.ts`：`VEHICLES: Partial<Record<RideCity, CityVehicles>>`（這個任務只有新竹市；Task 6 改成完整的 `Record`）、`vehicleFor(city: RideCity, mode: LegMode)`
  - `ride.tsx`：`<Ride city: string mode: LegMode size? = 96 flipped? still? label? className? />`
  - `sheet.tsx`：`renderRideSheet(css: string): string`（完整的 HTML 文件）
  - `scripts/ride-sheet.mjs`：用 Vite 的 `createServer` + `ssrLoadModule` 載入 `sheet.tsx`，讀 `mascot.css`、`ride.css`、各縣市的 css（如果有），寫出定案表

- [ ] **Step 1: 寫失敗的測試**

`lib/rides.test.ts`：

```ts
import { describe, expect, it } from "vitest"

import { RIDE_CITIES, rideCity, SPECIALTY } from "@/lib/rides"

describe("rides", () => {
  it("七個縣市照圖鑑的順序，各有一種特產", () => {
    expect(RIDE_CITIES).toEqual(["台北市", "新北市", "新竹市", "台中市", "彰化縣", "台南市", "高雄市"])
    expect(RIDE_CITIES.map((city) => SPECIALTY[city])).toEqual(["小籠包", "天燈", "貢丸", "珍珠奶茶", "肉圓", "虱目魚", "香蕉"])
  })

  it("不在七個縣市裡的是 null", () => {
    expect(rideCity("新竹市")).toBe("新竹市")
    expect(rideCity("桃園市")).toBeNull()
    expect(rideCity("")).toBeNull()
    expect(rideCity(null)).toBeNull()
  })
})
```

`components/rides/ride.test.ts`：

```ts
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Ride } from "@/components/rides/ride"
import { LEG_MODES } from "@/lib/travel-mode"

const render = (props: Parameters<typeof Ride>[0]) => renderToStaticMarkup(createElement(Ride, props))

describe("Ride", () => {
  it("新竹的四種座騎都畫得出來，熊坐在上面", () => {
    for (const mode of LEG_MODES) {
      const svg = render({ city: "新竹市", mode })
      expect(svg, mode).toContain('viewBox="0 0 300 200"')
      expect(svg, mode).toContain(`data-mode="${mode}"`)
      expect(svg, mode).toContain('data-city="新竹市"')
      expect(svg, mode).toContain("mascot mascot-ride")
    }
  })

  it("大小照寬度算，高度是寬的三分之二", () => {
    const svg = render({ city: "新竹市", mode: "drive", size: 150 })
    expect(svg).toContain('width="150"')
    expect(svg).toContain('height="100"')
  })

  it("往左走時整組翻過來；still 時停住", () => {
    expect(render({ city: "新竹市", mode: "drive", flipped: true })).toContain("matrix(-1 0 0 1 300 0)")
    expect(render({ city: "新竹市", mode: "drive", still: true })).toContain("ride-still")
  })

  it("沒有座騎的縣市：熊用等待的踏步自己走", () => {
    const svg = render({ city: "桃園市", mode: "scooter" })
    expect(svg).toContain('data-city="other"')
    expect(svg).toContain("mascot mascot-wait")
  })

  it("預設是裝飾；有 label 時讀屏唸得出來", () => {
    expect(render({ city: "新竹市", mode: "walk" })).toContain('aria-hidden="true"')
    const svg = render({ city: "新竹市", mode: "walk", label: "熊熊滾踩著貢丸走過去" })
    expect(svg).toContain('role="img"')
    expect(svg).toContain('aria-label="熊熊滾踩著貢丸走過去"')
  })
})
```

Run: `npm --prefix frontend run test -- rides ride`
Expected: FAIL（模組不存在）

- [ ] **Step 2: 實作 `lib/rides.ts`**

```ts
/**
 * 熊熊滾的座騎（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md〈座騎〉）：七個縣市各一種特產，
 * 四種交通方式各變成一種座騎。這裡只放縣市；座騎的圖在 components/rides。縣市名稱照資料庫的 customer.city。
 */
export const RIDE_CITIES = ["台北市", "新北市", "新竹市", "台中市", "彰化縣", "台南市", "高雄市"] as const

export type RideCity = (typeof RIDE_CITIES)[number]

/** 每個縣市的特產：座騎就是它變的 */
export const SPECIALTY: Record<RideCity, string> = {
  台北市: "小籠包",
  新北市: "天燈",
  新竹市: "貢丸",
  台中市: "珍珠奶茶",
  彰化縣: "肉圓",
  台南市: "虱目魚",
  高雄市: "香蕉",
}

/** 有座騎的縣市；其他（或沒有）是 null，熊熊滾就自己走過去 */
export function rideCity(city: string | null | undefined): RideCity | null {
  return (RIDE_CITIES as readonly string[]).includes(city ?? "") ? (city as RideCity) : null
}
```

- [ ] **Step 3: 實作 `vehicles/types.ts`、`parts.tsx`、`index.ts`**

```ts
// vehicles/types.ts
import type { ComponentType, ReactNode } from "react"

import type { LegMode } from "@/api/route"

/** 熊熊滾放在座騎的哪裡：在座騎畫布（0 0 300 200）上的左上角與邊長；熊自己的畫布是 240×240 */
export type BearAt = { x: number; y: number; size: number }

/** 一種座騎。自己決定圖層順序（擋住熊的腳的部分畫在 bear 之後），在要放熊的地方呼叫 bear(位置) */
export type VehicleProps = { bear: (at: BearAt) => ReactNode }

export type CityVehicles = Record<LegMode, ComponentType<VehicleProps>>
```

```tsx
// vehicles/colors.ts
/** 熊熊滾的顏色（components/mascot.tsx 同一組），座騎的輪子、窗、車燈優先用這幾色 */
export const BASE = "#9B51E0"
export const LIGHT = "#EADBFD"
export const INK = "#2B1B47"
export const PROP = "#C9A2F5"
export const STAR = "#FFC93C"
```

```tsx
// vehicles/parts.tsx
import { INK, LIGHT } from "@/components/rides/vehicles/colors"

/** 座騎共用的小零件 */

/** 地面：一條淡色的線，座騎與熊都站在上面 */
export function Ground() {
  return <rect x="10" y="187" width="280" height="3" rx="1.5" fill="#E6E2EC" />
}

/** 會轉的輪子：深色的胎、淺紫的軸心，軸心旁一個點，轉起來看得出來 */
export function Wheel({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g className="ride-spin">
      <circle cx={cx} cy={cy} r={r} fill={INK} />
      <circle cx={cx} cy={cy} r={r * 0.38} fill={LIGHT} />
      <circle cx={cx + r * 0.6} cy={cy} r={r * 0.15} fill={LIGHT} />
    </g>
  )
}
```

```ts
// vehicles/index.ts
import type { LegMode } from "@/api/route"
import type { CityVehicles } from "@/components/rides/vehicles/types"
import { hsinchu } from "@/components/rides/vehicles/hsinchu"
import type { RideCity } from "@/lib/rides"

/** 每個縣市的四種座騎。還沒畫的縣市不在這裡（Task 6 全部畫完後改成完整的 Record） */
export const VEHICLES: Partial<Record<RideCity, CityVehicles>> = { 新竹市: hsinchu }

export function vehicleFor(city: RideCity, mode: LegMode) {
  return VEHICLES[city]?.[mode]
}
```

- [ ] **Step 4: 實作 `ride.tsx` 與 `ride.css`**

```tsx
import "./ride.css"

import type { LegMode } from "@/api/route"
import { MascotFigure } from "@/components/mascot"
import { Ground } from "@/components/rides/vehicles/parts"
import { vehicleFor } from "@/components/rides/vehicles"
import type { BearAt } from "@/components/rides/vehicles/types"
import type { MascotState } from "@/lib/mascot"
import { rideCity } from "@/lib/rides"
import { cn } from "@/lib/utils"

/**
 * 熊熊滾騎著「這個縣市 × 這種交通方式」的座騎（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md〈座騎〉）。
 * 畫布 0 0 300 200、座騎朝右；flipped 時整組左右翻過來（往左走）。still 時動畫全停（圖鑑平常的樣子）。
 * 不在七個縣市裡的：沒有座騎，熊熊滾用等待的踏步自己走。
 */
export function Ride({
  city,
  mode,
  size = 96,
  flipped = false,
  still = false,
  label,
  className,
}: {
  city: string
  mode: LegMode
  /** 寬（px）；高是寬的三分之二 */
  size?: number
  flipped?: boolean
  still?: boolean
  label?: string
  className?: string
}) {
  const known = rideCity(city)
  const Vehicle = known ? vehicleFor(known, mode) : undefined
  return (
    <svg
      className={cn("ride", `ride-${mode}`, still && "ride-still", className)}
      viewBox="0 0 300 200"
      width={size}
      height={Math.round((size * 2) / 3)}
      xmlns="http://www.w3.org/2000/svg"
      data-city={known ?? "other"}
      data-mode={mode}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <g transform={flipped ? "matrix(-1 0 0 1 300 0)" : undefined}>
        {Vehicle ? (
          <Vehicle bear={(at) => <Bear at={at} />} />
        ) : (
          <>
            <Ground />
            <Bear at={{ x: 90, y: 70, size: 120 }} state="wait" />
          </>
        )}
      </g>
    </svg>
  )
}

/** 熊熊滾放在座騎畫布的 at；外層掛狀態的 class，mascot.css 的動畫才套得上 */
function Bear({ at, state = "ride" }: { at: BearAt; state?: MascotState }) {
  return (
    <g transform={`translate(${at.x} ${at.y}) scale(${at.size / 240})`}>
      <g className={`mascot mascot-${state}`}>
        <MascotFigure state={state} props={false} />
      </g>
    </g>
  )
}
```

`ride.css`：

```css
/*
 * 座騎的動畫（components/rides）。共用的 class 都在這裡；各縣市自己的寫在 vehicles/<縣市>.css，以 ride-<縣市>- 開頭。
 * 只用 transform 與 opacity；減少動態效果或 .ride-still 時全部停住。
 */
.ride { display: block; overflow: visible; }
.ride-spin, .ride-roll, .ride-bob, .ride-sway, .ride-bounce, .ride-float, .ride-hop, .ride-swim, .ride-slide, .ride-step {
  transform-box: fill-box;
}

/* 輪子轉、整顆特產滾 */
.ride-spin { transform-origin: center; animation: ride-spin 1s linear infinite; }
.ride-roll { transform-origin: center; animation: ride-spin 2.2s linear infinite; }
@keyframes ride-spin { to { transform: rotate(360deg); } }

/* 車身上下浮 */
.ride-bob { animation: ride-bob .45s ease-in-out infinite alternate; }
@keyframes ride-bob { to { transform: translateY(-3px); } }

/* 以底部為軸左右晃（站在東西上保持平衡） */
.ride-sway { transform-origin: 50% 100%; animation: ride-sway 1.1s ease-in-out infinite alternate; }
@keyframes ride-sway { from { transform: rotate(-7deg); } to { transform: rotate(7deg); } }

/* 走路踏步 */
.ride-step { transform-origin: 50% 100%; animation: ride-step .5s ease-in-out infinite alternate; }
@keyframes ride-step { from { transform: rotate(-5deg); } to { transform: rotate(5deg) translateY(-4px); } }

/* 彈：落地壓扁、彈起拉長 */
.ride-bounce { transform-origin: 50% 100%; animation: ride-bounce .7s cubic-bezier(.3, 0, .4, 1) infinite; }
@keyframes ride-bounce {
  0%, 100% { transform: translateY(0) scale(1.08, .92); }
  45% { transform: translateY(-22px) scale(.95, 1.05); }
}

/* 飄：慢慢上下、輕輕擺 */
.ride-float { transform-origin: 50% 50%; animation: ride-float 2.4s ease-in-out infinite alternate; }
@keyframes ride-float { from { transform: translateY(4px) rotate(-3deg); } to { transform: translateY(-8px) rotate(3deg); } }

/* 跳：一格一格往前跳（回到原位再跳，畫面上看起來在原地連跳） */
.ride-hop { transform-origin: 50% 100%; animation: ride-hop .6s ease-in-out infinite; }
@keyframes ride-hop { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-26px); } }

/* 游：上下起伏、頭尾擺 */
.ride-swim { transform-origin: 50% 50%; animation: ride-swim 1.2s ease-in-out infinite; }
@keyframes ride-swim {
  0%, 100% { transform: translateY(0) rotate(-4deg); }
  50% { transform: translateY(-6px) rotate(4deg); }
}

/* 滑：往前傾、身體拉長 */
.ride-slide { transform-origin: 30% 100%; animation: ride-slide .9s ease-in-out infinite alternate; }
@keyframes ride-slide { from { transform: rotate(-6deg) translateX(-4px); } to { transform: rotate(-12deg) translateX(6px); } }

/* 風：從右往左吹過去 */
.ride-wind { animation: ride-wind 1.3s linear infinite; }
.ride-wind:nth-of-type(2) { animation-delay: -.45s; }
.ride-wind:nth-of-type(3) { animation-delay: -.9s; }
@keyframes ride-wind { 0% { transform: translateX(30px); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateX(-30px); opacity: 0; } }

.ride-still, .ride-still * { animation: none !important; }
@media (prefers-reduced-motion: reduce) {
  .ride, .ride * { animation: none !important; }
}
```

- [ ] **Step 5: 畫新竹的四種（`vehicles/hsinchu.tsx`）**

照使用者選的草圖（主目錄 `.superpowers/brainstorm/32452-1791273434/content/vehicle-style.html` 方向 A 的四張）改寫成元件，熊改用 `bear({ x, y, size })`：

- `drive`：整顆貢丸（橫的橢圓）當車身，熊坐在裡面露出頭，底下兩個 `Wheel`，車頭一顆黃色車燈；整台 `ride-bob`。
- `scooter`：淺紫的機車車身與把手，**兩個輪子是貢丸**（`ride-roll`），熊坐在深色座墊上。
- `transit`：竹籤（線）串著三顆貢丸當列車，熊坐在最前面那顆，每顆底下兩個小 `Wheel`；整串 `ride-bob`。
- `walk`：熊站在一顆大貢丸上（貢丸 `ride-roll`、熊 `ride-step`），左邊三條淺紫的風線（`ride-wind`）。

貢丸的顏色（只用這 3 個新色）：`#B98256`（肉）、`#D6A77A`（亮面）、`#8E5D37`（肉粒）。貢丸可以寫成檔案裡的小元件 `Meatball({ cx, cy, r })`。
檔案最後 `export const hsinchu: CityVehicles = { drive: Drive, scooter: Scooter, transit: Transit, walk: Walk }`，四個元件不用 export。

- [ ] **Step 6: 定案表**

`sheet.tsx`：

```tsx
import { renderToStaticMarkup } from "react-dom/server"

import { Ride } from "@/components/rides/ride"
import { RIDE_CITIES, SPECIALTY } from "@/lib/rides"
import { LEG_MODES, TRAVEL_MODE_LABEL } from "@/lib/travel-mode"

/**
 * 座騎的定案表（docs/superpowers/specs/assets/2026-10-07-ride-sheet.html）：七個縣市 × 四種交通方式，
 * 每格一大一小（180 與首頁路線上的 96），最後一列示範往左走與停住的樣子。由 scripts/ride-sheet.mjs 產生，
 * css 是 mascot.css、ride.css 與各縣市的 css 接起來的內容。
 */
export function renderRideSheet(css: string): string {
  const body = renderToStaticMarkup(
    <main>
      <h1>熊熊滾的座騎</h1>
      <p>七個縣市 × 四種交通方式。每格左邊是 180px，右邊是首頁路線上的 96px。系統設定「減少動態效果」時全部停住。</p>
      <table>
        <thead>
          <tr>
            <th />
            {LEG_MODES.map((mode) => (
              <th key={mode}>{TRAVEL_MODE_LABEL[mode]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {RIDE_CITIES.map((city) => (
            <tr key={city}>
              <th>
                {city}
                <small>{SPECIALTY[city]}</small>
              </th>
              {LEG_MODES.map((mode) => (
                <td key={mode}>
                  <Ride city={city} mode={mode} size={180} />
                  <Ride city={city} mode={mode} size={96} />
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th>
              其他
              <small>往左走、停住、沒有座騎</small>
            </th>
            <td><Ride city="新竹市" mode="scooter" size={180} flipped /></td>
            <td><Ride city="新竹市" mode="walk" size={180} still /></td>
            <td><Ride city="桃園市" mode="drive" size={180} /></td>
            <td />
          </tr>
        </tbody>
      </table>
    </main>
  )
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>熊熊滾的座騎</title>
<style>
body { margin: 0; background: #F6F5F9; color: #1A1626; font-family: system-ui, "PingFang TC", sans-serif; }
main { padding: 24px; }
h1 { font-size: 22px; margin: 0 0 4px; }
p { margin: 0 0 16px; color: #6E6A78; font-size: 14px; }
table { border-collapse: separate; border-spacing: 8px; }
th { font-size: 14px; text-align: left; vertical-align: middle; }
th small { display: block; font-weight: 400; color: #6E6A78; }
td { background: #fff; border-radius: 16px; padding: 8px; vertical-align: bottom; }
td svg { display: inline-block; vertical-align: bottom; }
${css}
</style>
</head>
<body>${body}</body>
</html>
`
}
```

`scripts/ride-sheet.mjs`：

```js
// 產生座騎的定案表：npm run ride-sheet（在 frontend/ 底下跑）。
// 用 Vite 的 SSR 載入跟 App 同一批元件（含 @/ 別名），所以表上畫的就是程式畫的。
import fs from "node:fs"
import path from "node:path"
import { createServer } from "vite"

const root = process.cwd()
const out = path.resolve(root, "../docs/superpowers/specs/assets/2026-10-07-ride-sheet.html")
const server = await createServer({ root, logLevel: "warn", server: { middlewareMode: true, hmr: false }, appType: "custom" })
try {
  const { renderRideSheet } = await server.ssrLoadModule("/src/components/rides/sheet.tsx")
  const vehicles = path.join(root, "src/components/rides/vehicles")
  const cssFiles = [
    path.join(root, "src/components/mascot.css"),
    path.join(root, "src/components/rides/ride.css"),
    ...fs.readdirSync(vehicles).filter((name) => name.endsWith(".css")).sort().map((name) => path.join(vehicles, name)),
  ]
  const css = cssFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n")
  fs.writeFileSync(out, renderRideSheet(css))
  console.log(`寫好了：${path.relative(path.resolve(root, ".."), out)}`)
} finally {
  await server.close()
}
```

`frontend/package.json` 的 `scripts` 加 `"ride-sheet": "node scripts/ride-sheet.mjs"`。

Run: `npm --prefix frontend run ride-sheet`，然後照〈檢查畫出來的樣子〉截圖、用 Read 看。新竹那一列四種都要畫得出來、熊坐得穩、96px 也認得出貢丸；其他縣市那幾列這時只有熊自己踏步（還沒畫）。

- [ ] **Step 7: 跑測試、全部檢查**

Run: `npm --prefix frontend run test -- rides ride mascot && npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend test`
Expected: PASS

- [ ] **Step 8: 改設計文件一句、Commit**

`2026-10-07-ride-vehicles-design.md`〈座騎〉〈元件〉：`vehicleFor(city, mode)` 寫在 `components/rides/vehicles/index.ts`；`lib/rides.ts` 放七個縣市、特產、`rideCity`，「一段路跨不跨縣市」「這次該播哪一段」第三階段再加進去。

```bash
git add frontend docs/superpowers/specs
git commit -m "Seat the bear on Hsinchu's meatball vehicles and print a ride sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 台北市與新北市

**Files:**
- Create: `frontend/src/components/rides/vehicles/taipei.tsx`、`frontend/src/components/rides/vehicles/new-taipei.tsx`（需要自己的動畫時再加同名的 `.css`，在 `.tsx` 裡 `import "./taipei.css"`）
- Modify: `frontend/src/components/rides/vehicles/index.ts`、`frontend/src/components/rides/ride.test.ts`
- 產生：`docs/superpowers/specs/assets/2026-10-07-ride-sheet.html`

**Interfaces:**
- Consumes: Task 2 的 `CityVehicles`、`VehicleProps`、`BearAt`、`Ground`、`Wheel`、顏色常數、`ride.css` 的共用 class
- Produces: `export const taipei: CityVehicles`、`export const newTaipei: CityVehicles`，加進 `VEHICLES`

畫法照〈座騎的樣子〉那一列與 Global Constraints：

- **台北市（小籠包）**：小籠包是白色偏米的圓頂、頂上摺子集中成一小撮（用幾個小圓或圓角三角表現，不要描邊）；可以加一個蒸籠色。
  `drive` 小籠包當車身；`scooter` 兩個輪子是小籠包（輪子轉）；`transit` 蒸籠疊成的捷運車廂（兩三節圓角長方形車廂，側面是蒸籠的竹條紋，窗是淺紫，熊在第一節的窗裡）；
  `walk` 熊在小籠包上一路彈（`ride-bounce`）。
- **新北市（平溪天燈）**：天燈是上寬下窄的圓角梯形（紅或橘），底下一圈亮的火光（黃），可以有一兩個字樣用幾何紋路代替（不要放文字）。
  `drive` 天燈當車身（熊坐在燈籠開口處，底下兩個輪子）；`scooter` 天燈當車身（前面加把手、底下兩個輪子）；
  `transit` 一串天燈連成的空中纜車（一條纜線斜過畫面，兩三盞天燈吊在上面當車廂，熊坐在第一盞）；`walk` 熊坐在天燈上飄（`ride-float`，天燈底下火光閃）。

- [ ] **Step 1: 測試**：`ride.test.ts` 加一個測試，台北市、新北市的四種各自 `data-city` 是那個縣市、有 `mascot mascot-ride`、不是 `data-city="other"`。Run 確認 FAIL。
- [ ] **Step 2: 畫圖**，加進 `VEHICLES`。
- [ ] **Step 3: 產生定案表、截圖、用 Read 看**（〈檢查畫出來的樣子〉）。看不懂、熊懸空或被切掉、96px 看不出來就改，改到滿意。另外截一張不帶減少動態效果、隔 0.5 秒的兩張圖，確認有動、不會跑出畫布。
- [ ] **Step 4: 全部檢查**：`npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend test`
- [ ] **Step 5: Commit**

```bash
git add frontend docs/superpowers/specs/assets
git commit -m "Draw Taipei's xiaolongbao and New Taipei's sky lantern vehicles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 台中市與彰化縣

**Files:**
- Create: `frontend/src/components/rides/vehicles/taichung.tsx`、`frontend/src/components/rides/vehicles/changhua.tsx`（需要時加同名 `.css`）
- Modify: `vehicles/index.ts`、`ride.test.ts`；產生定案表

**Interfaces:** 同 Task 3；Produces `taichung`、`changhua`。

- **台中市（珍珠奶茶）**：奶茶色的杯身（圓角梯形）、透明感用淺一點的同色系表現、深色的珍珠、粗吸管（線）。
  `drive` 杯子橫躺當車身、吸管斜插當天線、熊坐在杯口；`scooter` 兩個輪子是大珍珠（深色，轉）；
  `transit` 直立的大珍珠奶茶杯當公車（側面開窗，窗裡是熊和幾顆珍珠當乘客），底下兩個 `Wheel`；`walk` 地上一排珍珠，熊一顆一顆跳（`ride-hop`）。
- **彰化縣（肉圓）**：半透明感的肉圓是扁圓、上面淋一圈紅褐色的醬（圓角的波浪形狀，不描邊）、中間一點香菜綠。
  `drive` 肉圓當車身、整台 Q 彈地彈（壓扁拉長，可以用 `ride-bounce` 或自己的 `ride-changhua-` keyframes）；`scooter` 兩個輪子是肉圓；
  `transit` 一串肉圓當列車（比照新竹的串法但改用肉圓的形狀與顏色）；`walk` 熊在肉圓上彈跳，像跳跳床（肉圓壓扁、熊彈高）。

步驟與檢查同 Task 3。Commit：`Draw Taichung's bubble tea and Changhua's ba-wan vehicles`。

---

### Task 5: 台南市與高雄市

**Files:**
- Create: `frontend/src/components/rides/vehicles/tainan.tsx`、`frontend/src/components/rides/vehicles/kaohsiung.tsx`（需要時加同名 `.css`）
- Modify: `vehicles/index.ts`、`ride.test.ts`；產生定案表

**Interfaces:** 同 Task 3；Produces `tainan`、`kaohsiung`。

- **台南市（虱目魚）**：銀灰帶藍的流線魚身（圓角的長橢圓加三角尾鰭、圓的眼睛），肚子淺色。
  `drive` 魚形的車身（熊坐在魚背的開口裡，底下兩個 `Wheel`）；`scooter` 魚當車身（前面把手、底下兩個輪子）；
  `transit` 一群虱目魚頭尾相接排成列車（三條，熊在第一條上）；`walk` 熊騎在魚背上游過去（`ride-swim`，旁邊幾顆淺紫的水泡）。
- **高雄市（旗山香蕉）**：黃色彎月形的香蕉、兩端深色的蒂。
  `drive` 香蕉橫放當長車身（熊坐中間，底下兩個 `Wheel`）；`scooter` 香蕉當車身（彎的那一面朝上當座位，前面把手）；
  `transit` 一串香蕉當列車（香蕉梳的根部當車頭，幾根香蕉當車廂，熊在第一根）；`walk` 熊踩到香蕉皮一路滑過去（香蕉皮攤開成星形的三瓣、熊 `ride-slide`）。

步驟與檢查同 Task 3。Commit：`Draw Tainan's milkfish and Kaohsiung's banana vehicles`。

---

### Task 6: 28 種到齊，定案表收尾

**Files:**
- Modify: `frontend/src/components/rides/vehicles/index.ts`（`VEHICLES` 改成完整的 `Record<RideCity, CityVehicles>`，`vehicleFor` 回傳型別不再是可能 undefined）
- Modify: `frontend/src/components/rides/ride.tsx`（`vehicleFor` 不會是 undefined 了，`Vehicle` 只在縣市不認得時沒有）
- Modify: `frontend/src/components/rides/ride.test.ts`
- 產生：`docs/superpowers/specs/assets/2026-10-07-ride-sheet.html`

- [ ] **Step 1: 測試**：把前面幾個「某縣市的四種都畫得出來」合併成一個：`RIDE_CITIES × LEG_MODES` 28 種都畫得出來、各自的 `data-city` 與 `data-mode` 對、有 `mascot mascot-ride`；再加一個「座騎只用自己縣市的顏色」：同一個縣市四種座騎用到的色碼，扣掉熊熊滾的顏色與 `#E6E2EC`（地面）之後，不超過 3 個。
- [ ] **Step 2: 改 `VEHICLES` 的型別與 `ride.tsx`**，跑測試確認通過。
- [ ] **Step 3: 產生定案表，整張截圖用 Read 看一遍**：七個縣市放在一起，風格要像同一套（線的粗細、熊的大小、地面的位置、輪子），差太多的就調。
- [ ] **Step 4: 全部檢查**：`npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend test`
- [ ] **Step 5: Commit**

```bash
git add frontend docs/superpowers/specs/assets
git commit -m "Complete the 28 ride vehicles and the ride sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**做完之後：** 把定案表給使用者看（用瀏覽器打開、或放上視覺輔助的分頁），照使用者的意見改完才進第三階段。
