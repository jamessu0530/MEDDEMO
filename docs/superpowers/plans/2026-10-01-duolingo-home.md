# 首頁 Duolingo 路線、厚按鈕與粉圓體 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 業務首頁改成 Duolingo 那樣的蛇行路線，全站的按鈕、卡片、輸入框換成厚的，字型換成粉圓體。

**Architecture:** 厚樣式集中在 `index.css`：四個顏色變數、幾個 `shadow-lip-*` 與一個 `press` 工具類；`ui/` 元件與各頁手刻的卡片改用它們。
路線的排法是 `lib/route-path.ts` 的純函式，畫面是 `components/route-path.tsx`，`pages/today.tsx` 只負責頂部、提示、需立即處理與載入狀態。

**Tech Stack:** React 19、TypeScript、Tailwind v4、lucide-react、vitest（node 環境，`renderToStaticMarkup`）、`@fontsource/huninn`。

**Spec:** [docs/superpowers/specs/2026-10-01-duolingo-home-design.md](../specs/2026-10-01-duolingo-home-design.md)

## Global Constraints

- 不用 Duolingo 自己的東西：Duo、名字與標誌、Feather 字型、火焰／寶石／愛心圖示、招牌綠色、音效、插圖。圖示一律 lucide。
- 底部分頁（`components/bottom-nav.tsx`）不改。`Badge` 不改。
- 厚底一律 4px（圓鈕 6px）；按下往下 4px、厚底消失；用 `transform`，不改高度。
- 顏色：`--lip` 淺 `#DCD6E4`／深 `#333332`；`--lip-strong` 淺 `#C9C3D3`／深 `#2A2A29`；`--primary-lip` 淺 `#7A3BB8`／深 `#8A8A87`；`--destructive-lip` 淺 `#84301B`／深 `#A63E2C`。
- 路線偏移 `0, 40, 64, 40, 0, -40, -64, -40`（px，8 站一循環）；偏移 > 0 標籤在左，否則在右。
- 後端不改。
- 使用者看得到的文字用繁體中文；註解照現有檔案的語氣（中文、說明「為什麼」）。
- 檢查指令在 `frontend/` 跑：`npm run typecheck && npm run lint && npm test && npm run build`。

## 檔案結構

| 檔案 | 動作 | 負責 |
|---|---|---|
| `frontend/package.json` | 改 | 加 `@fontsource/huninn`，拿掉 `@fontsource/ibm-plex-sans` |
| `frontend/src/index.css` | 改 | 字型、四個顏色、`shadow-lip-*`、`press`、出發泡泡的 `animate-bob` |
| `frontend/src/components/ui/button.tsx` | 改 | 厚的 variants、新增 `danger` |
| `frontend/src/components/ui/input.tsx`、`textarea.tsx`、`native-select.tsx`、`dialog.tsx` | 改 | 2px 邊框加厚底 |
| `frontend/src/lib/route-path.ts` | 新增 | `pathOffset`、`labelSide`、`bearStopIndex`、`signalTone` |
| `frontend/src/lib/route-path.test.ts` | 新增 | 上面四個的測試 |
| `frontend/src/lib/format.ts` | 改 | `formatDayLabel`（10/1（三）） |
| `frontend/src/lib/format.test.ts` | 新增 | `formatDayLabel` 的測試 |
| `frontend/src/components/route-path.tsx` | 新增 | `RoutePath`：圓鈕、標籤、出發泡泡、彈出小卡、熊熊滾、終點 |
| `frontend/src/components/route-path.test.ts` | 新增 | `RoutePath` 的輸出測試 |
| `frontend/src/pages/today.tsx` | 改 | 狀態列、橫幅、需立即處理、載入與空白狀態；路線交給 `RoutePath` |
| `frontend/src/pages/settings.tsx` | 改 | 「看使用說明」 |
| 其他手刻卡片、手刻主色按鈕所在的頁面與元件 | 改 | 換成厚樣式 |
| `README.md` | 改 | 首頁、使用說明與方法卡的位置、字型 |

---

### Task 1: 字型、顏色、厚樣式的工具類與 `ui/` 元件

**Files:**
- Modify: `frontend/package.json`、`frontend/src/index.css`、`frontend/src/components/ui/button.tsx`、`input.tsx`、`textarea.tsx`、`native-select.tsx`、`dialog.tsx`

**Interfaces:**
- Produces（Tailwind 類別，之後每個 task 都用）:
  - `shadow-lip`、`shadow-lip-primary`、`shadow-lip-destructive`、`shadow-lip-primary-soft`、`shadow-lip-destructive-soft`（`0 4px 0 <色>`）
  - `shadow-lip-node`（`0 6px 0 var(--primary-lip)`）、`shadow-lip-node-idle`（`0 6px 0 var(--lip-strong)`）
  - `press`：`:active` 時 `transform: translateY(4px)`、`--tw-shadow: 0 0 #0000`
  - `animate-bob`
  - `Button` 的 `variant="danger"`

- [ ] **Step 1: 換字型**

```bash
cd frontend && npm uninstall @fontsource/ibm-plex-sans && npm install @fontsource/huninn
```

`index.css` 開頭三行 IBM Plex 換成：

```css
/* 粉圓體（jf open 粉圓，SIL OFL 1.1）：只有 400 一個字重，按字切成 111 塊，用到哪些字才下載哪幾塊 */
@import "@fontsource/huninn/400.css";
```

`--font-sans` 改成：

```css
    /* 粉圓體：中英文都是圓的（英文是 Varela Round）。還沒下載完或沒網路時先用手機內建的黑體 */
    --font-sans: 'Huninn', 'PingFang TC', 'Noto Sans TC', 'Microsoft JhengHei', sans-serif;
```

- [ ] **Step 2: 顏色與工具類**

`@theme inline` 裡加：

```css
    /* Duolingo 那種「厚」的樣子：底下墊 4px 的厚底（圓鈕 6px）。走 shadow，跟 focus 的 ring 可以同時存在 */
    --shadow-lip: 0 4px 0 var(--lip);
    --shadow-lip-primary: 0 4px 0 var(--primary-lip);
    --shadow-lip-destructive: 0 4px 0 var(--destructive-lip);
    --shadow-lip-primary-soft: 0 4px 0 color-mix(in oklab, var(--primary) 30%, var(--background));
    --shadow-lip-destructive-soft: 0 4px 0 color-mix(in oklab, var(--destructive) 30%, var(--background));
    --shadow-lip-node: 0 6px 0 var(--primary-lip);
    --shadow-lip-node-idle: 0 6px 0 var(--lip-strong);
    --animate-bob: bob 1.4s ease-in-out infinite;
```

`:root` 加：

```css
    /* 厚底：卡片與白底按鈕、灰色圓鈕、主色、實心紅 */
    --lip: #DCD6E4;
    --lip-strong: #C9C3D3;
    --primary-lip: #7A3BB8;
    --destructive-lip: #84301B;
```

`:root[data-skin="dark"]` 加：

```css
    --lip: #333332;
    --lip-strong: #2A2A29;
    --primary-lip: #8A8A87;
    --destructive-lip: #A63E2C;
```

檔案最後加：

```css
/* 能按的厚東西按下去陷 4px、厚底消失。用 transform 不改高度，下面的版面不會跟著跳；
   跟 Tailwind 的 translate-* 是不同的屬性，置中用的 -translate-x-1/2 不受影響 */
@utility press {
    &:active {
        transform: translateY(4px);
        --tw-shadow: 0 0 #0000;
    }
}

/* 下一站上面的「出發」泡泡輕輕上下跳 */
@keyframes bob {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
}
```

- [ ] **Step 3: `Button`**

`buttonVariants` 的基本 class：`rounded-lg` → `rounded-xl`，拿掉 `active:not-aria-[haspopup]:translate-y-px`。variants 改成：

```ts
        default: "bg-primary text-primary-foreground shadow-lip-primary press hover:bg-primary/90",
        outline:
          "border-2 border-border bg-card shadow-lip press hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-lip press hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "border-2 border-destructive/30 bg-destructive/10 text-destructive shadow-lip-destructive-soft press hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        // 實心紅：今日路線「插入下一站」這種要馬上處理的動作
        danger: "bg-destructive text-white shadow-lip-destructive press hover:bg-destructive/90",
        link: "text-primary underline-offset-4 hover:underline",
```

- [ ] **Step 4: `Input`、`Textarea`、`NativeSelect`、`Dialog`**

- 三個輸入元件：`rounded-lg border border-input bg-transparent` → `rounded-xl border-2 border-input bg-card shadow-lip`；拿掉 `dark:bg-input/30`。
- `DialogContent`：`ring-1 ring-foreground/10` → `border-2 border-border shadow-lip`。

- [ ] **Step 5: 檢查並 commit**

Run: `cd frontend && npm run typecheck && npm run lint && npm test && npm run build`
Expected: 全部通過；build 的 CSS 裡有 `.shadow-lip`、`.press:active`、`Huninn`。

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/index.css frontend/src/components/ui
git commit -m "Switch to the Huninn font and give buttons, fields and dialogs a chunky lip"
```

---

### Task 2: 路線的排法（純函式）與日期標籤

**Files:**
- Create: `frontend/src/lib/route-path.ts`、`frontend/src/lib/route-path.test.ts`、`frontend/src/lib/format.test.ts`
- Modify: `frontend/src/lib/format.ts`

**Interfaces:**
- Produces:
  - `PATH_OFFSETS: readonly number[]`
  - `pathOffset(index: number): number`
  - `labelSide(offset: number): "left" | "right"`
  - `bearStopIndex(stops: { status: "done" | "next" | "todo" }[]): number | null`
  - `signalTone(signal: RouteSignal): "good" | "alert" | "plain"`
  - `formatDayLabel(iso: string): string`（`"2026-10-01"` → `"10/1（三）"`）

- [ ] **Step 1: 寫會失敗的測試**

`frontend/src/lib/route-path.test.ts`：

```ts
import { describe, expect, it } from "vitest"

import { bearStopIndex, labelSide, pathOffset, signalTone } from "@/lib/route-path"

const stops = (...statuses: ("done" | "next" | "todo")[]) => statuses.map((status) => ({ status }))

describe("pathOffset", () => {
  it("8 站一個來回，之後重複", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(pathOffset)).toEqual([0, 40, 64, 40, 0, -40, -64, -40])
    expect(pathOffset(8)).toBe(0)
    expect(pathOffset(10)).toBe(64)
  })
})

describe("labelSide", () => {
  it("圓鈕偏右時標籤在左，置中或偏左時在右", () => {
    expect(labelSide(40)).toBe("left")
    expect(labelSide(0)).toBe("right")
    expect(labelSide(-64)).toBe("right")
  })
})

describe("bearStopIndex", () => {
  it("下一站剛好置中就站在下一站旁邊", () => {
    expect(bearStopIndex(stops("next", "todo", "todo"))).toBe(0)
  })
  it("否則往後找第一個置中的站", () => {
    expect(bearStopIndex(stops("done", "done", "next", "todo", "todo", "todo"))).toBe(4)
  })
  it("後面沒有置中的站就站在終點", () => {
    expect(bearStopIndex(stops("done", "next", "todo"))).toBeNull()
  })
  it("全部完成就站在終點", () => {
    expect(bearStopIndex(stops("done", "done", "done", "done", "done"))).toBeNull()
  })
  it("沒有標下一站時從第一個還沒去的開始找", () => {
    expect(bearStopIndex(stops("done", "todo", "todo", "todo", "todo"))).toBe(4)
  })
  it("沒有站就站在終點", () => {
    expect(bearStopIndex([])).toBeNull()
  })
})

describe("signalTone", () => {
  it("商機是好消息、例行是平常、其他都是警示", () => {
    expect(signalTone("opportunity")).toBe("good")
    expect(signalTone("routine")).toBe("plain")
    expect(signalTone("ar")).toBe("alert")
    expect(signalTone("commitment")).toBe("alert")
  })
})
```

`frontend/src/lib/format.test.ts`：

```ts
import { describe, expect, it } from "vitest"

import { formatDayLabel } from "@/lib/format"

describe("formatDayLabel", () => {
  it("月/日加星期幾", () => {
    expect(formatDayLabel("2026-10-01")).toBe("10/1（三）")
    expect(formatDayLabel("2026-10-04")).toBe("10/4（日）")
  })
})
```

- [ ] **Step 2: 確認失敗**

Run: `cd frontend && npx vitest run src/lib/route-path.test.ts src/lib/format.test.ts`
Expected: FAIL（找不到模組／`formatDayLabel` 不存在）

- [ ] **Step 3: 實作**

`frontend/src/lib/route-path.ts`：

```ts
import type { RouteSignal } from "@/api/route"

/**
 * 今日路線像 Duolingo 的路一樣左右蛇行（components/route-path.tsx）。這裡只管排法：
 * 第幾站往左右偏多少、名字標在哪一邊、熊熊滾站在哪一站旁邊。
 */

// 圓鈕中心離畫面中線多少 px（正的往右），8 站一個來回
export const PATH_OFFSETS = [0, 40, 64, 40, 0, -40, -64, -40] as const

export function pathOffset(index: number): number {
  return PATH_OFFSETS[index % PATH_OFFSETS.length]
}

/** 名字標在圓鈕空出來的那一側：圓鈕偏右就標左邊，置中或偏左就標右邊 */
export function labelSide(offset: number): "left" | "right" {
  return offset > 0 ? "left" : "right"
}

/**
 * 熊熊滾站在哪一站的左邊：從下一站（沒標下一站就從第一個還沒去的）往後找第一個置中的站，
 * 置中的站名字標在右邊，左邊剛好空著。找不到、或全部跑完了，回 null，站在終點旁邊。
 */
export function bearStopIndex(stops: { status: "done" | "next" | "todo" }[]): number | null {
  let start = stops.findIndex((stop) => stop.status === "next")
  if (start < 0) start = stops.findIndex((stop) => stop.status === "todo")
  if (start < 0) return null
  for (let index = start; index < stops.length; index += 1) {
    if (pathOffset(index) === 0) return index
  }
  return null
}

/** 理由的顏色：商機是唯一的好消息（綠），例行是平常（灰），其他都是要注意的事（紅） */
export function signalTone(signal: RouteSignal): "good" | "alert" | "plain" {
  if (signal === "opportunity") return "good"
  if (signal === "routine") return "plain"
  return "alert"
}
```

`frontend/src/lib/format.ts` 在 `formatDate` 後面加：

```ts
const WEEKDAYS = "日一二三四五六"

/** 2026-10-01 → 10/1（三），首頁橫幅用。用當地時間的午夜算星期，免得時區把日期推到前一天 */
export function formatDayLabel(iso: string) {
  const weekday = WEEKDAYS[new Date(`${iso}T00:00:00`).getDay()]
  return `${formatDate(iso)}（${weekday}）`
}
```

- [ ] **Step 4: 確認通過**

Run: `cd frontend && npx vitest run src/lib/route-path.test.ts src/lib/format.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/route-path.ts frontend/src/lib/route-path.test.ts frontend/src/lib/format.ts frontend/src/lib/format.test.ts
git commit -m "Lay out the home route as a zigzag and label the day with its weekday"
```

---

### Task 3: `RoutePath` 元件

**Files:**
- Create: `frontend/src/components/route-path.tsx`、`frontend/src/components/route-path.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `shadow-lip-*`、`press`、`animate-bob`、`buttonVariants`；Task 2 的 `pathOffset`、`labelSide`、`bearStopIndex`、`signalTone`。
- Produces: `RoutePath({ stops }: { stops: RouteStop[] }): JSX.Element`。`stops` 是空陣列時呼叫端不畫它。

- [ ] **Step 1: 寫會失敗的測試**

`frontend/src/components/route-path.test.ts`：

```ts
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import type { RouteStop } from "@/api/route"
import { RoutePath } from "@/components/route-path"

function stop(id: string, status: RouteStop["status"], extra: Partial<RouteStop> = {}): RouteStop {
  return {
    customer_id: id,
    customer_name: `客戶${id}`,
    type: "independent",
    grade: "A",
    planned_time: "10:00",
    status,
    signal: "ar",
    reason: "帳款最久拖了 78 天",
    visit_id: null,
    ...extra,
  }
}

const render = (stops: RouteStop[]) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RoutePath, { stops })))

describe("RoutePath", () => {
  const day = [stop("a", "done", { visit_id: "v1" }), stop("b", "done"), stop("c", "next"), stop("d", "todo"), stop("e", "todo")]

  it("三種狀態的圓鈕，已完成的打勾、其他寫站號", () => {
    const html = render(day)
    expect(html.match(/data-stop-node="done"/g)).toHaveLength(2)
    expect(html.match(/data-stop-node="next"/g)).toHaveLength(1)
    expect(html.match(/data-stop-node="todo"/g)).toHaveLength(2)
    expect(html).toContain(">3<")
    expect(html).toContain("10:00 完成 · 已回寫")
  })

  it("只有下一站有「出發」，連到客戶檔案", () => {
    const html = render(day)
    expect(html.match(/>出發</g)).toHaveLength(1)
    expect(html).toContain('href="/customers/c"')
  })

  it("小卡一開始是收起來的", () => {
    const html = render(day)
    expect(html).not.toContain("data-stop-popover")
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(5)
  })

  it("熊熊滾站在路旁，點了進問答；還沒跑完是待機", () => {
    const html = render(day)
    expect(html).toContain('href="/ask"')
    expect(html).toContain('aria-label="問熊熊滾（問答）"')
    expect(html).toContain("mascot-idle")
    expect(html).toContain(">收工<")
  })

  it("全部跑完時終點寫跑完幾站，熊熊滾跳起來", () => {
    const html = render([stop("a", "done"), stop("b", "done"), stop("c", "done")])
    expect(html).toContain("今天 3 站都跑完了")
    expect(html).toContain("mascot-yay")
    expect(html).not.toContain(">出發<")
  })
})
```

- [ ] **Step 2: 確認失敗**

Run: `cd frontend && npx vitest run src/components/route-path.test.ts`
Expected: FAIL（找不到 `@/components/route-path`）

- [ ] **Step 3: 實作 `frontend/src/components/route-path.tsx`**

```tsx
import { useEffect, useState, type CSSProperties } from "react"
import { Check, Flag } from "lucide-react"
import { Link } from "react-router"

import { SIGNAL_LABEL, type RouteSignal, type RouteStop } from "@/api/route"
import { Mascot } from "@/components/mascot"
import { buttonVariants } from "@/components/ui/button"
import { bearStopIndex, labelSide, pathOffset, signalTone } from "@/lib/route-path"
import { cn } from "@/lib/utils"

// 圓鈕 58×54（跟 Duolingo 一樣略寬），名字離圓鈕 12px
const HALF_NODE = 29
const LABEL_GAP = 12

const STATUS_LABEL: Record<RouteStop["status"], string> = { done: "已完成", next: "下一站", todo: "待拜訪" }

const TONE_CLASS = { good: "text-success", alert: "text-destructive", plain: "text-muted-foreground" } as const

function popoverId(stop: RouteStop) {
  return `stop-popover-${stop.customer_id}`
}

/**
 * 今日路線畫成 Duolingo 那樣的路（docs/superpowers/specs/2026-10-01-duolingo-home-design.md）：
 * 一站一顆厚圓鈕左右蛇行往下，名字標在旁邊空的那一側，下一站上面跳著「出發」；
 * 點圓鈕在底下彈出一張小卡寫為什麼排這家。熊熊滾站在路旁，點了進問答；最後是終點「收工」。
 */
export function RoutePath({ stops }: { stops: RouteStop[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const finished = stops.length > 0 && stops.every((stop) => stop.status === "done")
  const bearAt = bearStopIndex(stops)

  // 小卡開著時：點小卡和圓鈕以外的地方、按 Esc 都收起來（點別顆圓鈕由圓鈕自己換）
  useEffect(() => {
    if (!openId) return
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest("[data-stop-popover], [data-stop-node]")) return
      setOpenId(null)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenId(null)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [openId])

  return (
    <ol aria-label="今日路線" className="flex flex-col pt-2">
      {stops.map((stop, index) => {
        const offset = pathOffset(index)
        const open = openId === stop.customer_id
        return (
          // 下一站上面多留一點高度給「出發」泡泡
          <li key={stop.customer_id} className={cn("relative h-[92px]", stop.status === "next" && "mt-9")}>
            <StopNode
              stop={stop}
              index={index}
              offset={offset}
              open={open}
              onToggle={() => setOpenId(open ? null : stop.customer_id)}
            />
            <StopLabel stop={stop} offset={offset} />
            {bearAt === index && <Bear finished={false} />}
            {open && <StopPopover stop={stop} index={index} offset={offset} />}
          </li>
        )
      })}
      <li className="relative flex flex-col items-center gap-2 pt-1 pb-2">
        <span
          aria-hidden
          className={cn(
            "flex h-[54px] w-[58px] items-center justify-center rounded-[50%]",
            finished
              ? "bg-primary text-primary-foreground shadow-lip-node"
              : "bg-input text-muted-foreground shadow-lip-node-idle"
          )}
        >
          <Flag className="size-6" />
        </span>
        <p className="mt-1 text-sm font-semibold">{finished ? `今天 ${stops.length} 站都跑完了` : "收工"}</p>
        {bearAt === null && <Bear finished={finished} />}
      </li>
    </ol>
  )
}

function StopNode({
  stop,
  index,
  offset,
  open,
  onToggle,
}: {
  stop: RouteStop
  index: number
  offset: number
  open: boolean
  onToggle: () => void
}) {
  const done = stop.status === "done"
  const next = stop.status === "next"
  return (
    <div className="absolute top-0 h-[54px] w-[58px]" style={{ left: `calc(50% + ${offset - HALF_NODE}px)` }}>
      {next && (
        <>
          <span aria-hidden className="pointer-events-none absolute -inset-[9px] rounded-[50%] border-[5px] border-primary/25" />
          <Link
            to={`/customers/${stop.customer_id}`}
            className="absolute bottom-[calc(100%+16px)] left-1/2 -translate-x-1/2"
          >
            {/* 跳的是裡面這一層：外層的 -translate-x-1/2 負責置中，兩個不能寫在同一個元素上 */}
            <span className="relative block animate-bob rounded-xl border-2 bg-card px-3 py-1 text-sm font-semibold whitespace-nowrap text-primary motion-reduce:animate-none after:absolute after:top-full after:left-1/2 after:size-2.5 after:-translate-x-1/2 after:-translate-y-1/2 after:rotate-45 after:border-r-2 after:border-b-2 after:bg-card after:content-['']">
              出發
            </span>
          </Link>
        </>
      )}
      <button
        type="button"
        data-stop-node={stop.status}
        aria-expanded={open}
        aria-controls={popoverId(stop)}
        aria-label={`第 ${index + 1} 站 ${stop.customer_name}，${STATUS_LABEL[stop.status]}`}
        onClick={onToggle}
        className={cn(
          "relative flex size-full items-center justify-center rounded-[50%] text-lg font-semibold outline-none press focus-visible:ring-3 focus-visible:ring-ring/50",
          done || next ? "bg-primary text-primary-foreground shadow-lip-node" : "bg-input text-muted-foreground shadow-lip-node-idle"
        )}
      >
        {done ? <Check className="size-6" strokeWidth={3.5} /> : index + 1}
      </button>
    </div>
  )
}

function StopLabel({ stop, offset }: { stop: RouteStop; offset: number }) {
  const done = stop.status === "done"
  const left = labelSide(offset) === "left"
  // 名字在圓鈕空出來的那一側：右邊就從圓鈕右緣再過去 12px 開始，左邊就在圓鈕左緣前 12px 結束、靠右對齊
  const style: CSSProperties = left
    ? { left: 0, right: `calc(50% - ${offset - HALF_NODE - LABEL_GAP}px)` }
    : { left: `calc(50% + ${offset + HALF_NODE + LABEL_GAP}px)`, right: 0 }
  return (
    <div aria-hidden className={cn("absolute top-1 text-xs leading-snug", left && "text-right")} style={style}>
      <p className={cn("line-clamp-2 text-[13px] font-semibold", done && "text-muted-foreground")}>{stop.customer_name}</p>
      <p className="mt-0.5 text-muted-foreground">
        {done ? (
          `${stop.planned_time} 完成${stop.visit_id ? " · 已回寫" : ""}`
        ) : (
          <>
            {stop.planned_time} · <SignalLabel signal={stop.signal} />
          </>
        )}
      </p>
    </div>
  )
}

function SignalLabel({ signal }: { signal: RouteSignal }) {
  return <span className={cn("font-semibold", TONE_CLASS[signalTone(signal)])}>{SIGNAL_LABEL[signal]}</span>
}

/** 點圓鈕彈出的小卡：蓋在後面的路上，上面的尖角對準那顆圓鈕 */
function StopPopover({ stop, index, offset }: { stop: RouteStop; index: number; offset: number }) {
  const done = stop.status === "done"
  return (
    <div
      id={popoverId(stop)}
      data-stop-popover
      role="group"
      aria-label={stop.customer_name}
      // z 比固定在上面的頁首（z-10）低，捲到頁首底下時被頁首蓋住
      className="absolute inset-x-0 top-[70px] z-[5] rounded-2xl border-2 bg-card p-4 shadow-lip"
    >
      <span
        aria-hidden
        className="absolute -top-[9px] size-3.5 rotate-45 border-t-2 border-l-2 bg-card"
        style={{ left: `calc(50% + ${offset - 7}px)` }}
      />
      <p className="text-base leading-snug font-semibold">{stop.customer_name}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {stop.planned_time} · 第 {index + 1} 站{done && ` · 已完成${stop.visit_id ? " · 已回寫" : ""}`}
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        <SignalLabel signal={stop.signal} /> · {stop.reason}
      </p>
      <Link to={`/customers/${stop.customer_id}`} className={cn(buttonVariants(), "mt-3 h-11 w-full text-sm")}>
        {done ? "看客戶檔案" : "開啟拜訪準備"}
      </Link>
    </div>
  )
}

/** 熊熊滾站在那一列圓鈕的左邊（那一站置中、名字在右，左邊空著）；終點那一列也一樣 */
function Bear({ finished }: { finished: boolean }) {
  return (
    <Link
      to="/ask"
      aria-label="問熊熊滾（問答）"
      className="absolute -top-3 rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      style={{ right: `calc(50% + ${HALF_NODE + 18}px)` }}
    >
      <Mascot state={finished ? "yay" : "idle"} size={72} />
    </Link>
  )
}
```

- [ ] **Step 4: 確認通過**

Run: `cd frontend && npx vitest run src/components/route-path.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/route-path.tsx frontend/src/components/route-path.test.ts
git commit -m "Draw the home route as chunky zigzag stops with a popover, the bear and a finish line"
```

---

### Task 4: 首頁：狀態列、橫幅、需立即處理；設定頁的「看使用說明」

**Files:**
- Modify: `frontend/src/pages/today.tsx`、`frontend/src/pages/settings.tsx`

**Interfaces:**
- Consumes: `RoutePath`、`formatDayLabel`、`Button variant="danger"`、`buttonVariants`、`shadow-lip-*`。

- [ ] **Step 1: 改 `today.tsx` 的頁首**

把 `<header>` 整段換成：

```tsx
      <header className="sticky top-0 z-10 bg-background/95 px-4 pt-2 pb-3 backdrop-blur">
        <div className="-mr-2 flex items-center justify-between gap-2">
          {/* 點自己的名字進帳號設定：改密碼、登出、使用說明 */}
          <Link to="/settings" className="flex h-11 min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate">
                {user.region} · {user.name}
              </span>
              {user.acting_as && <span className="truncate">示範：{user.acting_as.name}的客戶</span>}
            </span>
            <ChevronRight className="size-3.5 shrink-0" />
          </Link>
          {/* 像 Duolingo 的狀態列：圖示加數字。進度只是顯示，其他三顆可以按 */}
          <div className="flex shrink-0 items-center">
            {route && (
              <span className="flex h-10 items-center gap-1 px-1.5 text-sm font-semibold tabular-nums">
                <Flag className="size-5 fill-primary text-primary" />
                <span className="sr-only">今日進度</span>
                {route.done}/{route.total}
              </span>
            )}
            {/* FR-8.4：主管回覆了，顯示還沒看的則數 */}
            <Link
              to="/escalations"
              aria-label={unseen > 0 ? `主管回覆 ${unseen} 則，查看` : "轉給主管的提問"}
              className="flex h-10 min-w-10 items-center justify-center gap-1 rounded-lg px-1.5 hover:bg-muted"
            >
              <Bell className={cn("size-5", unseen > 0 ? "fill-warning text-warning" : "text-muted-foreground")} />
              {unseen > 0 && <span className="text-sm font-semibold text-warning tabular-nums">{unseen}</span>}
            </Link>
            <Link
              to="/oa/forms"
              aria-label="我的申請單"
              className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <FileText className="size-5" />
            </Link>
            <SkinToggle className="size-10" />
          </div>
        </div>
        {/* 像 Duolingo 的單元橫幅；右邊的「指南」換成方法卡：主管教的做法，出門前翻一下 */}
        <div className="mt-1 flex items-stretch overflow-hidden rounded-2xl bg-primary text-primary-foreground shadow-lip-primary">
          <div className="min-w-0 flex-1 px-4 py-2.5">
            {route && (
              <p className="text-xs font-semibold opacity-85">
                {formatDayLabel(route.date)} · {route.total} 站
              </p>
            )}
            <h1 className="text-lg leading-snug font-semibold">今日路線</h1>
          </div>
          <Link
            to="/methods"
            className="flex w-16 shrink-0 flex-col items-center justify-center gap-0.5 border-l-2 border-black/15 text-[11px] font-semibold active:bg-black/10"
          >
            <BookOpenText className="size-5" />
            方法卡
          </Link>
        </div>
      </header>
```

- [ ] **Step 2: 改 `<main>`：載入、需立即處理、路線、空白**

- `pb-40` → `pb-28`（右下角的熊拿掉了，只剩底部分頁要讓）。
- 載入中那行換成：

```tsx
        {state.status === "loading" && (
          <div className="flex flex-col items-center gap-2 py-10">
            <Mascot state="wait" size={96} />
            <p className="text-sm text-muted-foreground">載入今日路線中…</p>
          </div>
        )}
```

- 「需立即處理」的 `<section>` 換成：

```tsx
        {route && urgent && (
          <article className="mb-2 flex flex-col gap-2 rounded-2xl border-2 border-destructive/30 bg-destructive/10 p-4 shadow-lip-destructive-soft">
            <span className="flex items-center gap-1 self-start rounded-md bg-destructive px-2 py-1 text-[11px] font-semibold text-white">
              <TriangleAlert className="size-3" />
              需立即處理 · {urgent.headline}
            </span>
            <Link to={`/customers/${urgent.customer_id}`} className="flex min-h-11 items-center text-base leading-snug font-semibold">
              {urgent.customer_name}
            </Link>
            <p className="text-xs leading-relaxed">{urgent.detail}</p>
            {urgent.note && <p className="text-xs leading-relaxed text-muted-foreground">{urgent.note}</p>}
            <div className="mt-1 flex gap-2">
              <Button variant="danger" className="h-11 flex-1" disabled={busy} onClick={pin}>
                插入下一站
              </Button>
              <Button variant="outline" className="h-11 w-16 shrink-0" disabled={busy} onClick={snooze}>
                暫緩
              </Button>
              <Button variant="outline" className="h-11 w-16 shrink-0" disabled={busy} onClick={misjudge}>
                誤判
              </Button>
            </div>
          </article>
        )}
```

- 「今日順序」的 `<section>` 換成：

```tsx
        {route &&
          (route.stops.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Mascot state="think" size={96} />
              <p className="text-sm text-muted-foreground">今天沒有排定的拜訪。</p>
              <Link to="/customers" className={cn(buttonVariants(), "h-11 px-6")}>
                自己挑一家
              </Link>
            </div>
          ) : (
            <RoutePath stops={route.stops} />
          ))}
```

- 刪掉 `<AskMascot />`、`AskMascot`、`StopRow`、`SignalLabel`、`STATUS_LABEL`、`percent`，以及用不到的 import（`CircleHelp`、`Check`、`ListOrdered`、`signOutSession`、`openGuide`、`SIGNAL_LABEL`、`RouteSignal`、`RouteStop`、`formatDate` 若只剩快取提示在用就保留）。新增 import：`Flag`、`RoutePath`、`buttonVariants`、`formatDayLabel`。
- 檔頭的說明註解補一句「版面照 Duolingo 的主畫面（docs/superpowers/specs/2026-10-01-duolingo-home-design.md）」。

- [ ] **Step 3: 設定頁加「看使用說明」**

`settings.tsx` 在「新人第一週」那個連結後面、同一個 `user.role === "sales"` 條件裡（使用說明只講業務的操作，主管端也不顯示導覽）加：

```tsx
        {user.role === "sales" && (
          // 首頁的頁首放不下了，使用說明從這裡（和客戶清單的頁首）再打開
          <button
            type="button"
            onClick={openGuide}
            className="flex min-h-14 items-center justify-between rounded-2xl border-2 bg-card px-4 text-left shadow-lip press"
          >
            <span className="text-sm font-medium">看使用說明</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>
        )}
```

並 `import { openGuide } from "@/lib/onboarding"`。`lib/onboarding.ts` 開頭的註解改成「之後從帳號設定或客戶清單的「使用說明」再打開」。

- [ ] **Step 4: 檢查並 commit**

Run: `cd frontend && npm run typecheck && npm run lint && npm test && npm run build`
Expected: 全部通過

```bash
git add frontend/src/pages/today.tsx frontend/src/pages/settings.tsx frontend/src/lib/onboarding.ts
git commit -m "Give the home page a Duolingo-style status bar, route banner and chunky urgent card"
```

---

### Task 5: 全站手刻的卡片與按鈕換成厚的

**Files:**
- Modify: 下面清單裡的頁面與元件

**Interfaces:**
- Consumes: Task 1 的 `shadow-lip*`、`press`、`buttonVariants`。

規則（每一處都要照著改，改完逐一看 diff）：

1. **白底卡片**：class 同時有 `rounded-xl|2xl|3xl`、`border`、`bg-card` 的元素：`border` → `border-2`，加 `shadow-lip`。
   元素本身是 `<Link>`、`<a>`、`<button>` 的再加 `press`，並拿掉 `active:bg-muted` 這類按下時換底色的 class。
2. **淡色卡**：`border-primary/xx bg-primary/10` → `border-2` 加 `shadow-lip-primary-soft`；`border-destructive/xx bg-destructive/10` → `border-2` 加 `shadow-lip-destructive-soft`；能按的加 `press`、拿掉 `active:bg-primary/15`。
3. **手刻的主色按鈕**（`bg-primary text-primary-foreground` 做成按鈕的 `<Link>`／`<span>`）：改成 `cn(buttonVariants(), "<原本的尺寸與排版 class>")`；如果是包在 `<Link>` 裡的 `<span>`，把樣式移到 `<Link>` 上。
4. **不動**：表格外框（`ask-result.tsx` 的 `overflow-x-auto rounded-lg border`）、附件縮圖（`draft-files.tsx`）、虛線框（`channel.tsx` 的 `border-dashed`）、`Notice`（沒有邊框的淺色提示）、底部分頁、`Badge`。

清單（`grep` 出來的，改之前再 grep 一次確認沒漏）：

| 檔案 | 白底卡 | 淡色卡 | 手刻主色鈕 |
|---|---|---|---|
| `pages/first-week.tsx` | 7 | 1（入口卡，能按） | |
| `pages/negotiation.tsx` | 6 | 2 | |
| `pages/settings.tsx` | 5 | | |
| `pages/manager.tsx` | 5 | | |
| `pages/customer.tsx` | 5 | 1 | |
| `pages/oa-form.tsx` | 4 | | |
| `pages/admin.tsx` | 4 | | |
| `pages/record-visit.tsx` | 3 | | 1 |
| `pages/promotions.tsx` | 2 | | 1 |
| `pages/contract.tsx` | 2 | | |
| `components/visit/result-view.tsx` | 2 | 1（紅） | |
| `components/visit/confirm-view.tsx` | 2 | | |
| `components/visit/field-editor.tsx` | 2（`rounded-lg border p-3`，也算卡片） | | |
| `components/ask/entry-view.tsx` | 2 | | 1 |
| `pages/customer-picker.tsx` | 1 | 1 | |
| `pages/quote.tsx`、`oa-forms.tsx`、`escalations.tsx`、`channels.tsx`、`channel-threads.tsx`、`ask.tsx` | 各 1 | | |
| `components/reassign-owner.tsx`、`pending-uploads.tsx`、`method-card.tsx`、`attachments/attachment-gallery.tsx` | 各 1 | | |
| `components/method-card-form.tsx`、`onboarding.tsx`、`pages/channel.tsx`、`pages/methods.tsx` | | | 各 1 |

- [ ] **Step 1: 列出所有要改的地方**

```bash
cd frontend/src
grep -rnE 'rounded-(xl|2xl|3xl)[^"]*\bborder\b|\bborder\b[^"]*rounded-(xl|2xl|3xl)' --include='*.tsx' . | grep -v components/ui/ | grep -v bottom-nav
grep -rnE 'bg-primary[^/"]* [^"]*text-primary-foreground|text-primary-foreground[^"]* bg-primary[ "]' --include='*.tsx' . | grep -v components/ui/ | grep -v route-path
```

- [ ] **Step 2: 照規則逐檔改**

- [ ] **Step 3: 確認沒漏**

Run: `grep -rnE 'rounded-(xl|2xl|3xl) border bg-card|rounded-2xl border p' --include='*.tsx' frontend/src | grep -v components/ui/`
Expected: 沒有輸出（只剩規則 4 列的例外）

- [ ] **Step 4: 檢查並 commit**

Run: `cd frontend && npm run typecheck && npm run lint && npm test && npm run build`
Expected: 全部通過

```bash
git add frontend/src
git commit -m "Give every card and hand-made button in the app the same chunky lip"
```

---

### Task 6: 手機尺寸截圖檢查、README

**Files:**
- Modify: `README.md`；有問題就回頭改對應的檔案

- [ ] **Step 1: 截圖**

用 headless Chrome（每段不超過 20 秒、各自的 `--user-data-dir`；`window.fetch` 對 `/api/*` 回假資料；localStorage 先放 `meddemo:token`、`meddemo:user`、`meddemo:onboarded`），375×812 截：
首頁（淺色、深色）、點開一站的小卡、全部跑完、今天沒排拜訪、客戶檔案、登入頁、帳號設定。

檢查：粉圓有載入；`font-semibold` 的中文沒有糊掉（糊掉就在 `body` 加 `font-synthesis-weight: none`）；
名字標籤沒有跟圓鈕或熊重疊；出發泡泡沒有蓋到上一站；厚底沒有被下一個元素蓋住；深色看得清楚。

- [ ] **Step 2: 改 README**

- 「今日路線（首頁）」開頭加一段：版面參考 Duolingo 的學習路徑（蛇行的厚圓鈕、狀態列、單元橫幅、點了彈出的小卡、路旁的角色、終點），只參考互動方式，不用 Duolingo 的角色、字型、圖示與配色；設計見 spec。
- 第 387 行「之後從首頁右上的「使用說明」再打開」→「之後從帳號設定或客戶清單頁首的「使用說明」再打開」。
- 第 435 行「首頁標頭「使用說明」旁的「方法卡」進去」→「首頁紫色橫幅右邊的「方法卡」進去」。
- 「換頁動畫與配色」補一句：全站的按鈕、卡片、輸入框是 Duolingo 那種厚的（2px 邊框加 4px 厚底，按下會陷下去），厚底的顏色是 `index.css` 的 `--lip` 那四個；字型是粉圓體（jf open 粉圓，SIL OFL 1.1，`@fontsource/huninn`）。

- [ ] **Step 3: 全部檢查並 commit**

Run: `cd frontend && npm run typecheck && npm run lint && npm test && npm run build`
Expected: 全部通過

```bash
git add README.md frontend/src
git commit -m "Describe the Duolingo-style home, chunky buttons and the Huninn font in the README"
```
