# 電腦版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ≥1024px 的螢幕上換成電腦版：左側寬側邊欄、頻道四欄、主管端地圖與左清單右內容、客戶檔案與開報價兩欄，其他頁放在中間一欄；手機完全不變。

**Architecture:** 同一套元件。只差樣式的地方用 Tailwind 的 `lg:`；版面結構不同的地方用 `useIsDesktop()`（`matchMedia`）決定畫哪一種。外框（`AppShell`）照 `pageWidth(pathname)` 決定畫不畫側邊欄、內容放不放在中間一欄。後端不改。

**Tech Stack:** React 19、React Router 8、Tailwind 4、vitest（node 環境，`renderToStaticMarkup` 與純函式）。

**Spec:** `docs/superpowers/specs/2026-10-09-desktop-layout-design.md`

**不在這份計畫：** 今日路線（首頁）的電腦版。「點站就騎過去與個人頁」、「位置分享只問同意」兩件正在改 `pages/today.tsx` 與 `components/route/*`，等它們推上 main 之後另寫一份計畫。這份計畫完全不碰 `pages/today.tsx`、`components/route/*`、`components/rides/*`；首頁在電腦版暫時是「寬版、照手機的樣子靠左」，頁首那一列按鈕跟側邊欄重複，是已知的過渡狀態。

## Global Constraints

- 斷點：電腦版 `(min-width: 1024px)`（Tailwind `lg`）；頻道記憶看板那一欄 `(min-width: 1280px)`（`xl`）。
- 側邊欄寬 14rem（Tailwind `w-56`、內容區 `lg:pl-56`、固定元件 `lg:left-56`）。中間一欄 `lg:max-w-2xl`（42rem）。
- 手機（<1024px）的畫面一個像素都不改：每一個改動都要是 `lg:`／`xl:` 才生效，或只在 `useIsDesktop()` 為真時才走的分支。
- 畫面上不用 emoji，圖示用 lucide。註解、畫面文字用繁體中文；commit 訊息用英文祈使句（照 repo 的寫法），最後一行 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 前端程式約 120 欄寬，**不要**跑 `prettier --write`／`npm run format`。CI 跑的是 `npm run lint`、`npm run typecheck`、`npm test`（都在 `frontend/` 下）。
- repo 在 iCloud 同步的桌面：`git add` 前看一下 `git status` 有沒有 `* 2.*` 這種重複檔，有就刪掉、不要 commit。

## 工作環境

- [ ] 從 `origin/main` 開 worktree，把規格與這份計畫的 commit 帶過去：

```bash
cd /Users/jamessu/Desktop/computersciencehomework/MEDDEMO
git fetch origin
git worktree add .claude/worktrees/desktop-layout -b desktop-layout origin/main
cd .claude/worktrees/desktop-layout
git cherry-pick <規格的 commit> <計畫的 commit>   # git log main --oneline -- docs/superpowers/specs/2026-10-09-desktop-layout-design.md docs/superpowers/plans/2026-10-09-desktop-layout.md
cd frontend && npm install && npm test   # 先確認乾淨的狀態測試全過
```

以下所有路徑都相對於 worktree 的根目錄；`npm`、`npx` 指令都在 `frontend/` 下跑。

## 檔案

| 檔案 | 責任 |
|---|---|
| `frontend/src/lib/desktop-layout.ts`（新） | 斷點、`pageWidth`、`desktopSamePage`、`trimPath`、`FIXED_COLUMN` |
| `frontend/src/lib/use-media-query.ts`（新） | `useMediaQuery`、`useIsDesktop`、`useIsWide` |
| `frontend/src/lib/sidebar.ts`（新） | 各角色側邊欄的項目、`isActiveItem`、`SIDEBAR_ITEM` |
| `frontend/src/lib/manager-counts.ts`（新） | 風險通報未讀、待簽的 `CountPoller` |
| `frontend/src/components/sidebar-nav.tsx`（新） | 側邊欄的項目清單（純畫面，可測） |
| `frontend/src/components/app-sidebar.tsx`（新） | 側邊欄：頭像、名字、項目、深色模式、帳號設定 |
| `frontend/src/components/app-shell.tsx`（新） | 登入後的外框：側邊欄＋內容寬度 |
| `frontend/src/lib/master-detail.ts`（新） | `pickItem`、`nextAfter`、`itemParam` |
| `frontend/src/components/manager/master-detail.tsx`（新） | 左清單右內容的版面、清單的一列 |
| `frontend/src/components/oa-form-view.tsx`（新） | 申請單的內容（從 `pages/oa-form.tsx` 拆出來，不帶頁首） |
| `frontend/src/lib/channel-panes.ts`（新） | 頻道四欄：頻道列選誰、對話開誰 |
| `frontend/src/App.tsx` | 外框、沒登入的頁、頻道路由 |
| `frontend/src/components/bottom-nav.tsx`、`onboarding.tsx`、`ink-transition.tsx` | 電腦版不畫底部列、導覽變對話框、墨只蓋內容區、頻道換欄不播墨 |
| `frontend/src/pages/ask.tsx`、`negotiation.tsx` | 固定在底部的列對齊中間一欄 |
| `frontend/src/pages/admin.tsx`、`manager.tsx` | 頁首的按鈕在電腦版收起；主管端的版面 |
| `frontend/src/pages/customer.tsx`、`quote.tsx` | 兩欄 |
| `frontend/src/components/map-slot.tsx`、`manager/routes-panel.tsx` | 團隊行程地圖在左 |
| `frontend/src/pages/oa-form.tsx`、`lib/approval.ts` | 用 `OaFormView`；狀態文字搬到 `lib/approval.ts` |
| `frontend/src/lib/channel-rail.ts` | `railTarget` |
| `frontend/src/pages/channel.tsx`、`channels.tsx`、`components/channel-panel.tsx`、`channel-row.tsx` | 頻道四欄 |

---

### Task 1: 斷點與頁面寬度

**Files:**
- Create: `frontend/src/lib/desktop-layout.ts`
- Create: `frontend/src/lib/use-media-query.ts`
- Test: `frontend/src/lib/desktop-layout.test.ts`

**Interfaces:**
- Produces:
  - `DESKTOP_QUERY: string`、`WIDE_QUERY: string`
  - `type PageWidth = "wide" | "column" | "bare"`；`pageWidth(pathname: string): PageWidth`
  - `desktopSamePage(from: string, to: string): boolean`
  - `trimPath(pathname: string): string`
  - `FIXED_COLUMN: string`（固定在畫面上、要對齊中間一欄的 class）
  - `useMediaQuery(query: string): boolean`、`useIsDesktop(): boolean`、`useIsWide(): boolean`

- [ ] **Step 1: 寫會失敗的測試** `frontend/src/lib/desktop-layout.test.ts`

```ts
import { describe, expect, it } from "vitest"

import { desktopSamePage, pageWidth, trimPath } from "@/lib/desktop-layout"

describe("pageWidth", () => {
  it("自己排成兩欄以上的六種頁是寬版", () => {
    for (const path of ["/", "/channels", "/channels/12", "/manager", "/customers/C0123", "/customers/C0123/quote"]) {
      expect(pageWidth(path), path).toBe("wide")
    }
  })

  it("結尾多一個斜線也一樣", () => {
    expect(pageWidth("/channels/12/")).toBe("wide")
    expect(pageWidth("/manager/")).toBe("wide")
    expect(pageWidth("/ask/")).toBe("column")
  })

  it("沒登入的頁與錄音頁不畫側邊欄", () => {
    for (const path of ["/login", "/register", "/privacy", "/auth/github/callback", "/auth/google/callback", "/customers/C0123/record"]) {
      expect(pageWidth(path), path).toBe("bare")
    }
  })

  it("其他頁放在中間一欄", () => {
    for (const path of [
      "/ask",
      "/customers",
      "/channels/search",
      "/channels/12/threads",
      "/customers/C0123/negotiation",
      "/customers/C0123/contract",
      "/visits/5",
      "/oa/forms/3",
      "/admin",
      "/settings",
    ]) {
      expect(pageWidth(path), path).toBe("column")
    }
  })
})

describe("desktopSamePage", () => {
  it("頻道清單與各頻道的對話是電腦版的同一頁", () => {
    expect(desktopSamePage("/channels", "/channels/12")).toBe(true)
    expect(desktopSamePage("/channels/12", "/channels/21/")).toBe(true)
  })

  it("搜尋、討論串清單與別的頁不算", () => {
    expect(desktopSamePage("/channels/12", "/channels/search")).toBe(false)
    expect(desktopSamePage("/channels/12", "/channels/12/threads")).toBe(false)
    expect(desktopSamePage("/", "/channels")).toBe(false)
  })
})

describe("trimPath", () => {
  it("拿掉結尾的斜線，首頁照舊是 /", () => {
    expect(trimPath("/manager/")).toBe("/manager")
    expect(trimPath("/")).toBe("/")
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/desktop-layout.test.ts`
Expected: FAIL，找不到 `@/lib/desktop-layout`。

- [ ] **Step 3: 寫 `frontend/src/lib/desktop-layout.ts`**

```ts
/**
 * 電腦版（docs/superpowers/specs/2026-10-09-desktop-layout-design.md）：寬度到這裡以上換成側邊欄與寬版版面，以下照手機。
 * 側邊欄寬 14rem：用到的地方直接寫 Tailwind 的 w-56、lg:pl-56、lg:left-56
 */
export const DESKTOP_QUERY = "(min-width: 1024px)"
// 頻道的記憶看板另外一欄：1024 扣掉側邊欄、頻道列與頻道內容，對話只剩兩百多 px，到 1280 才放得下
export const WIDE_QUERY = "(min-width: 1280px)"

export type PageWidth = "wide" | "column" | "bare"

// 不畫側邊欄、照手機的寬度置中：沒登入的頁，和錄音（跟手機一樣，錄到一半不能誤點離開）
const BARE = [/^\/login$/, /^\/register$/, /^\/privacy$/, /^\/auth\//, /^\/customers\/[^/]+\/record$/]
// 自己排成兩欄以上的頁；其他頁放在中間一欄
const WIDE = [/^\/$/, /^\/channels$/, /^\/channels\/\d+$/, /^\/manager$/, /^\/customers\/[^/]+$/, /^\/customers\/[^/]+\/quote$/]
// 電腦版頻道四欄那一頁的網址：/channels 與 /channels/:id 換來換去只是換欄，不播換頁的墨
const CHANNEL_PANES = /^\/channels(\/\d+)?$/

/** 對齊中間一欄的固定元件（底部的輸入列、按鈕列）：手機照舊是置中的手機寬度 */
export const FIXED_COLUMN = "fixed inset-x-0 mx-auto max-w-md lg:left-56 lg:max-w-2xl"

export function trimPath(pathname: string) {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname
}

export function pageWidth(pathname: string): PageWidth {
  const path = trimPath(pathname)
  if (BARE.some((pattern) => pattern.test(path))) return "bare"
  if (WIDE.some((pattern) => pattern.test(path))) return "wide"
  return "column"
}

export function desktopSamePage(from: string, to: string) {
  return CHANNEL_PANES.test(trimPath(from)) && CHANNEL_PANES.test(trimPath(to))
}
```

- [ ] **Step 4: 寫 `frontend/src/lib/use-media-query.ts`**

```ts
import { useCallback, useSyncExternalStore } from "react"

import { DESKTOP_QUERY, WIDE_QUERY } from "@/lib/desktop-layout"

/** 視窗符不符合某個 media query，跟著視窗大小變。第一次畫就是當下的值，不會先畫手機版再跳 */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener("change", onChange)
      return () => list.removeEventListener("change", onChange)
    },
    [query]
  )
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
}

/** 電腦版（≥1024px）：側邊欄、寬版版面 */
export function useIsDesktop() {
  return useMediaQuery(DESKTOP_QUERY)
}

/** ≥1280px：頻道的記憶看板另外一欄 */
export function useIsWide() {
  return useMediaQuery(WIDE_QUERY)
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run src/lib/desktop-layout.test.ts && npm run typecheck`
Expected: PASS，typecheck 沒有錯。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/desktop-layout.ts frontend/src/lib/desktop-layout.test.ts frontend/src/lib/use-media-query.ts
git commit -m "Decide which pages are wide, in the middle column or bare on desktop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 側邊欄的項目

**Files:**
- Create: `frontend/src/lib/sidebar.ts`
- Test: `frontend/src/lib/sidebar.test.ts`

**Interfaces:**
- Consumes: `trimPath`（Task 1）、`Role`（`@/lib/auth`）
- Produces:
  - `type SidebarBadge = "uploads" | "channels" | "replies" | "notices" | "oa"`
  - `type SidebarItem = { to: string; label: string; icon: LucideIcon; badge?: SidebarBadge }`
  - `type SidebarGroups = { main: SidebarItem[]; more: SidebarItem[] }`
  - `sidebarItems(role: Role): SidebarGroups`
  - `isActiveItem(item: SidebarItem, pathname: string, search: string): boolean`
  - `SIDEBAR_ITEM: string`（側邊欄一列的共用 class）

- [ ] **Step 1: 寫會失敗的測試** `frontend/src/lib/sidebar.test.ts`

```ts
import { describe, expect, it } from "vitest"

import type { Role } from "@/lib/auth"
import { isActiveItem, sidebarItems, type SidebarItem } from "@/lib/sidebar"

const labels = (role: Role) => {
  const { main, more } = sidebarItems(role)
  return { main: main.map((item) => item.label), more: more.map((item) => item.label) }
}
const item = (role: Role, label: string): SidebarItem => {
  const { main, more } = sidebarItems(role)
  const found = [...main, ...more].find((i) => i.label === label)
  if (!found) throw new Error(`沒有 ${label}`)
  return found
}

describe("sidebarItems", () => {
  it("業務：底部那五個分頁，加上日曆、方法卡、申請單、主管回覆", () => {
    expect(labels("sales")).toEqual({
      main: ["今日", "客戶", "頻道", "問答", "促銷"],
      more: ["日曆", "方法卡", "我的申請單", "主管回覆"],
    })
  })

  it("主管：主管端的五個分頁，加上頻道", () => {
    expect(labels("manager")).toEqual({ main: ["團隊行程", "提問", "風險通報", "簽核", "方法卡"], more: ["頻道"] })
  })

  it("IT：組織管理在最前面，接著是主管端", () => {
    expect(labels("it")).toEqual({ main: ["組織管理", "團隊行程", "提問", "風險通報", "簽核", "方法卡"], more: ["頻道"] })
  })

  it("數字掛在對的項目上", () => {
    expect(item("sales", "客戶").badge).toBe("uploads")
    expect(item("sales", "頻道").badge).toBe("channels")
    expect(item("sales", "主管回覆").badge).toBe("replies")
    expect(item("manager", "風險通報").badge).toBe("notices")
    expect(item("manager", "簽核").badge).toBe("oa")
    expect(item("it", "頻道").badge).toBe("channels")
  })

  it("主管端的項目連到各自的分頁", () => {
    expect(item("manager", "團隊行程").to).toBe("/manager")
    expect(item("manager", "簽核").to).toBe("/manager?view=oa")
    expect(item("sales", "主管回覆").to).toBe("/escalations")
  })
})

describe("isActiveItem", () => {
  it("首頁只算 /", () => {
    expect(isActiveItem(item("sales", "今日"), "/", "")).toBe(true)
    expect(isActiveItem(item("sales", "今日"), "/customers", "")).toBe(false)
  })

  it("其他項目連它底下的頁都算（客戶檔案算客戶、搜尋算頻道）", () => {
    expect(isActiveItem(item("sales", "客戶"), "/customers/C0123/quote", "")).toBe(true)
    expect(isActiveItem(item("sales", "頻道"), "/channels/search", "")).toBe(true)
    expect(isActiveItem(item("sales", "我的申請單"), "/oa/forms/3/", "")).toBe(true)
    expect(isActiveItem(item("sales", "促銷"), "/promotions-old", "")).toBe(false)
  })

  it("主管端照 view 判斷，沒帶或不認得的 view 是團隊行程", () => {
    expect(isActiveItem(item("manager", "團隊行程"), "/manager", "")).toBe(true)
    expect(isActiveItem(item("manager", "團隊行程"), "/manager", "?view=routes&rep=U01")).toBe(true)
    expect(isActiveItem(item("manager", "團隊行程"), "/manager", "?view=xyz")).toBe(true)
    expect(isActiveItem(item("manager", "簽核"), "/manager", "?view=oa&item=4")).toBe(true)
    expect(isActiveItem(item("manager", "簽核"), "/manager", "?view=notices")).toBe(false)
    expect(isActiveItem(item("manager", "簽核"), "/oa/forms/4", "")).toBe(false)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/sidebar.test.ts`
Expected: FAIL，找不到 `@/lib/sidebar`。

- [ ] **Step 3: 寫 `frontend/src/lib/sidebar.ts`**

```ts
import {
  BadgePercent,
  Bell,
  BookOpenText,
  Calendar,
  CalendarDays,
  ClipboardCheck,
  FileText,
  MessageCircleQuestion,
  MessagesSquare,
  Network,
  Route,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react"

import type { Role } from "@/lib/auth"
import { trimPath } from "@/lib/desktop-layout"

/** 項目旁的數字：待送出的錄音、頻道未讀、主管回覆、風險通報未讀、待簽 */
export type SidebarBadge = "uploads" | "channels" | "replies" | "notices" | "oa"
export type SidebarItem = { to: string; label: string; icon: LucideIcon; badge?: SidebarBadge }
export type SidebarGroups = { main: SidebarItem[]; more: SidebarItem[] }

/** 側邊欄一列的樣子：跟底部分頁列一樣，目前這一列墊主色膠囊 */
export const SIDEBAR_ITEM = "flex min-h-11 w-full items-center gap-3 rounded-full px-4 text-left text-sm font-semibold transition-colors"

// 業務：上面是底部分頁列那五格，下面是手機上擠在首頁頁首的入口
const SALES: SidebarGroups = {
  main: [
    { to: "/", label: "今日", icon: CalendarDays },
    { to: "/customers", label: "客戶", icon: Users, badge: "uploads" },
    { to: "/channels", label: "頻道", icon: MessagesSquare, badge: "channels" },
    { to: "/ask", label: "問答", icon: MessageCircleQuestion },
    { to: "/promotions", label: "促銷", icon: BadgePercent },
  ],
  more: [
    { to: "/calendar", label: "日曆", icon: Calendar },
    { to: "/methods", label: "方法卡", icon: BookOpenText },
    { to: "/oa/forms", label: "我的申請單", icon: FileText },
    { to: "/escalations", label: "主管回覆", icon: Bell, badge: "replies" },
  ],
}

// 主管端的五個分頁（pages/manager.tsx 的 VIEWS），主管與 IT 共用
const MANAGER: SidebarItem[] = [
  { to: "/manager", label: "團隊行程", icon: Route },
  { to: "/manager?view=asks", label: "提問", icon: MessageCircleQuestion },
  { to: "/manager?view=notices", label: "風險通報", icon: TriangleAlert, badge: "notices" },
  { to: "/manager?view=oa", label: "簽核", icon: ClipboardCheck, badge: "oa" },
  { to: "/manager?view=methods", label: "方法卡", icon: BookOpenText },
]
const CHANNELS: SidebarItem = { to: "/channels", label: "頻道", icon: MessagesSquare, badge: "channels" }
const ADMIN: SidebarItem = { to: "/admin", label: "組織管理", icon: Network }
const MANAGER_VIEWS = ["asks", "notices", "oa", "methods"]

export function sidebarItems(role: Role): SidebarGroups {
  if (role === "sales") return SALES
  return { main: role === "it" ? [ADMIN, ...MANAGER] : MANAGER, more: [CHANNELS] }
}

function managerView(query: string) {
  const view = new URLSearchParams(query).get("view") ?? ""
  return MANAGER_VIEWS.includes(view) ? view : "routes"
}

/** 側邊欄哪一列是目前這頁：主管端照 view 判斷（不認得的 view 跟主管端一樣當成團隊行程）；首頁只算 /；
 * 其他是那個網址或它底下的頁（客戶檔案算「客戶」） */
export function isActiveItem(item: SidebarItem, pathname: string, search: string) {
  const path = trimPath(pathname)
  const [itemPath, itemQuery = ""] = item.to.split("?")
  if (itemPath === "/manager") return path === "/manager" && managerView(search) === managerView(itemQuery)
  if (itemPath === "/") return path === "/"
  return path === itemPath || path.startsWith(`${itemPath}/`)
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/sidebar.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/sidebar.ts frontend/src/lib/sidebar.test.ts
git commit -m "List each role's sidebar items and which one is active

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 側邊欄元件與主管端的數字

**Files:**
- Create: `frontend/src/lib/manager-counts.ts`
- Create: `frontend/src/components/sidebar-nav.tsx`
- Create: `frontend/src/components/app-sidebar.tsx`
- Modify: `frontend/src/pages/manager.tsx`（分頁列上的兩個數字改讀 `lib/manager-counts.ts`）
- Test: `frontend/src/components/sidebar-nav.test.ts`

**Interfaces:**
- Consumes: `sidebarItems`、`isActiveItem`、`SIDEBAR_ITEM`、`SidebarGroups`、`SidebarBadge`（Task 2）
- Produces:
  - `unseenNotices: CountPoller`、`pendingOa: CountPoller`、`useUnseenNotices(): number`、`usePendingOa(): number`
  - `SidebarNav({ groups, counts, pathname, search }: { groups: SidebarGroups; counts: Partial<Record<SidebarBadge, number>>; pathname: string; search: string })`
  - `AppSidebar({ user }: { user: AuthUser })`

- [ ] **Step 1: 寫會失敗的測試** `frontend/src/components/sidebar-nav.test.ts`

```ts
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import { SidebarNav } from "@/components/sidebar-nav"
import { sidebarItems, type SidebarBadge } from "@/lib/sidebar"

const render = (role: "sales" | "manager", counts: Partial<Record<SidebarBadge, number>>, pathname = "/", search = "") =>
  renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(SidebarNav, { groups: sidebarItems(role), counts, pathname, search }))
  )
// 標了 aria-current 的那一個連結裡面的字
const activeText = (html: string) => html.match(/<a[^>]*aria-current="page"[^>]*>(.*?)<\/a>/)?.[1] ?? ""

describe("SidebarNav", () => {
  it("每一項連到自己的網址，目前這一項標 aria-current", () => {
    const html = render("sales", {}, "/ask")
    expect(html).toContain('href="/calendar"')
    expect(activeText(html)).toContain("問答")
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  })

  it("有數字才顯示，超過 99 寫 99+", () => {
    const html = render("sales", { uploads: 2, channels: 120, replies: 0 })
    expect(html).toContain(">2<")
    expect(html).toContain(">99+<")
    expect(html).not.toContain(">0<")
  })

  it("拿不到數字（沒給）就不顯示", () => {
    expect(render("manager", {}, "/manager", "?view=oa")).not.toMatch(/rounded-full bg-destructive/)
  })

  it("主管端的分頁照 view 標目前這一項", () => {
    const html = render("manager", { notices: 3 }, "/manager", "?view=notices")
    expect(activeText(html)).toContain("風險通報")
    expect(html).toContain(">3<")
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/components/sidebar-nav.test.ts`
Expected: FAIL，找不到 `@/components/sidebar-nav`。

- [ ] **Step 3: 寫 `frontend/src/components/sidebar-nav.tsx`**

```tsx
import { Link } from "react-router"

import { UnreadDot } from "@/components/channels-link"
import { isActiveItem, SIDEBAR_ITEM, type SidebarBadge, type SidebarGroups, type SidebarItem } from "@/lib/sidebar"
import { cn } from "@/lib/utils"

/** 側邊欄的項目：上面一組是主要的頁，分隔線下面是次要的入口。目前這一列墊主色膠囊，有數字的在右邊放紅點 */
export function SidebarNav({
  groups,
  counts,
  pathname,
  search,
}: {
  groups: SidebarGroups
  counts: Partial<Record<SidebarBadge, number>>
  pathname: string
  search: string
}) {
  const row = (item: SidebarItem) => {
    const active = isActiveItem(item, pathname, search)
    const count = item.badge ? (counts[item.badge] ?? 0) : 0
    const Icon = item.icon
    return (
      <Link
        key={item.to}
        to={item.to}
        aria-current={active ? "page" : undefined}
        className={cn(
          SIDEBAR_ITEM,
          active ? "bg-primary text-primary-foreground shadow-lip-primary" : "text-muted-foreground hover:bg-muted"
        )}
      >
        <Icon className="size-5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {count > 0 && <UnreadDot count={count} />}
      </Link>
    )
  }
  return (
    <nav aria-label="主選單" className="flex flex-col gap-1">
      {groups.main.map(row)}
      <hr className="mx-3 my-2 border-t-2" />
      {groups.more.map(row)}
    </nav>
  )
}
```

如果 Step 4 跑測試時 `@/components/channels-link` 在 node 裡載入失敗（`window`、`WebSocket` 未定義之類），把 `UnreadDot` 搬到新檔 `frontend/src/components/unread-dot.tsx`，`channels-link.tsx` 改成 `export { UnreadDot } from "@/components/unread-dot"` 並從那裡 import，`sidebar-nav.tsx` 直接 import `@/components/unread-dot`。

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/components/sidebar-nav.test.ts`
Expected: PASS。

- [ ] **Step 5: 寫 `frontend/src/lib/manager-counts.ts`**

```ts
import { useSyncExternalStore } from "react"

import { getUnseenNoticeCount } from "@/api/notices"
import { listOaInbox } from "@/api/oa"
import { CountPoller } from "@/lib/count-poller"

/** 主管端的兩個數字：還沒看的風險通報、等自己簽的申請單。電腦版的側邊欄和手機的分頁列讀同一份，有畫面在看就每分鐘問一次；
 * 切換分頁、按「知道了」、簽完一張時呼叫 refresh() 馬上重問。業務沒有主管端，不要讓業務的畫面訂閱（後端會擋） */
export const unseenNotices = new CountPoller(() => getUnseenNoticeCount())
export const pendingOa = new CountPoller(() => listOaInbox().then((data) => ({ count: data.counts.pending ?? data.items.length })))

export function useUnseenNotices() {
  return useSyncExternalStore(unseenNotices.subscribe, unseenNotices.getSnapshot)
}

export function usePendingOa() {
  return useSyncExternalStore(pendingOa.subscribe, pendingOa.getSnapshot)
}
```

- [ ] **Step 6: `pages/manager.tsx` 的分頁列改讀它**

在 `ManagerPage` 裡，把

```tsx
  const [unseenNotices, setUnseenNotices] = useState(0)
  const [pendingOa, setPendingOa] = useState(0)

  // 分頁上的未讀數：打開主管端、切換分頁時各問一次；主管在這頁按「知道了」會直接減一，不必重問
  useEffect(() => {
    const controller = new AbortController()
    getUnseenNoticeCount(controller.signal)
      .then(({ count }) => setUnseenNotices(count))
      .catch(() => {
        // 連不上就先不顯示數字，列表那邊會有自己的錯誤訊息
      })
    listOaInbox(controller.signal)
      .then((data) => setPendingOa(data.counts.pending ?? data.items.length))
      .catch(() => {
        // 連不上就先不顯示數字
      })
    return () => controller.abort()
  }, [view])
```

換成

```tsx
  // 分頁上的數字（lib/manager-counts.ts）：每分鐘問一次，切換分頁時馬上再問一次
  const noticeCount = useUnseenNotices()
  const oaCount = usePendingOa()
  useEffect(() => {
    void unseenNotices.refresh()
    void pendingOa.refresh()
  }, [view])
```

分頁列裡的 `unseenNotices` 換成 `noticeCount`、`pendingOa` 換成 `oaCount`（四個地方：兩個 `> 0` 判斷、`aria-label` 與數字）。`<NoticesPanel onSeen={() => setUnseenNotices((count) => Math.max(0, count - 1))} />` 改成 `<NoticesPanel onSeen={() => void unseenNotices.refresh()} />`。import 拿掉 `getUnseenNoticeCount`，加上：

```tsx
import { pendingOa, unseenNotices, usePendingOa, useUnseenNotices } from "@/lib/manager-counts"
```

- [ ] **Step 7: 寫 `frontend/src/components/app-sidebar.tsx`**

```tsx
import { Moon, Settings, Sun } from "lucide-react"
import { Link, useLocation } from "react-router"

import { MyStatusButton } from "@/components/my-status"
import { SidebarNav } from "@/components/sidebar-nav"
import { changeSkin } from "@/ink/ink"
import type { AuthUser } from "@/lib/auth"
import { useChannelUnread } from "@/lib/channel-unread"
import { usePendingOa, useUnseenNotices } from "@/lib/manager-counts"
import { useUnseenReplies } from "@/lib/manager-replies"
import { useUploadQueue } from "@/lib/offline-queue"
import { SIDEBAR_ITEM, sidebarItems, type SidebarBadge } from "@/lib/sidebar"
import { useSkin } from "@/lib/skin"
import { cn } from "@/lib/utils"

type Counts = Partial<Record<SidebarBadge, number>>

/**
 * 電腦版左邊的側邊欄（docs/superpowers/specs/2026-10-09-desktop-layout-design.md）：最上面是自己的頭像（點了換狀態）與名字，
 * 中間是這個角色的頁，最下面是深色模式與帳號設定。手機上不畫（lg:flex）。
 * 業務與主管、IT 各自只問自己用得到的數字：業務問主管端的數字會被後端擋
 */
export function AppSidebar({ user }: { user: AuthUser }) {
  return user.role === "sales" ? <SalesSidebar user={user} /> : <ManagerSidebar user={user} />
}

function SalesSidebar({ user }: { user: AuthUser }) {
  const { items } = useUploadQueue()
  const channels = useChannelUnread()
  const replies = useUnseenReplies()
  // FR-4.3：手機裡還有沒送出的錄音，跟底部分頁列一樣掛在「客戶」上
  const uploads = items.filter((item) => item.state === "pending").length
  return <Sidebar user={user} counts={{ uploads, channels, replies }} />
}

function ManagerSidebar({ user }: { user: AuthUser }) {
  const channels = useChannelUnread()
  const notices = useUnseenNotices()
  const oa = usePendingOa()
  return <Sidebar user={user} counts={{ channels, notices, oa }} />
}

function Sidebar({ user, counts }: { user: AuthUser; counts: Counts }) {
  // 外框在 <Routes> 裡面：換頁時墨還沒蓋滿，這裡拿到的還是舊的那一頁，選中的那一列跟著畫面一起換
  const { pathname, search } = useLocation()
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col gap-1 overflow-y-auto border-r bg-card px-3 pt-3 pb-4 lg:flex">
      <div className="mb-2 flex items-center gap-2 border-b px-1 pb-3">
        <MyStatusButton className="size-10" />
        {/* 跟首頁頁首的名字連到同一個地方 */}
        <Link to="/settings" className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-lg px-1 leading-tight hover:bg-muted">
          <span className="truncate text-sm font-semibold">{user.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {user.region}
            {user.acting_as && ` · 示範：${user.acting_as.name}的客戶`}
          </span>
        </Link>
      </div>
      <SidebarNav groups={sidebarItems(user.role)} counts={counts} pathname={pathname} search={search} />
      <div className="flex-1" />
      <SkinRow />
      <Link to="/settings" className={cn(SIDEBAR_ITEM, "text-muted-foreground hover:bg-muted")}>
        <Settings className="size-5 shrink-0" />
        帳號設定
      </Link>
    </aside>
  )
}

/** 深色、淺色切換：跟頁首的按鈕一樣，用噴漆從按的位置染過去（ink/ink.ts 的 changeSkin） */
function SkinRow() {
  const dark = useSkin() === "dark"
  return (
    <button
      type="button"
      onClick={() => changeSkin(dark ? "light" : "dark")}
      className={cn(SIDEBAR_ITEM, "text-muted-foreground hover:bg-muted")}
    >
      {dark ? <Sun className="size-5 shrink-0" /> : <Moon className="size-5 shrink-0" />}
      {dark ? "換成淺色" : "換成深色"}
    </button>
  )
}
```

寫之前先 `grep -n 'path="/me"' frontend/src/App.tsx`：如果個人頁已經上線（另一個 session 的「點站就騎過去與個人頁」），名字的 `Link` 改連 `/me`，註解照舊。

- [ ] **Step 8: 跑全部檢查**

Run: `npm test && npm run lint && npm run typecheck`
Expected: 全過。

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/manager-counts.ts frontend/src/components/sidebar-nav.tsx frontend/src/components/sidebar-nav.test.ts frontend/src/components/app-sidebar.tsx frontend/src/pages/manager.tsx
git commit -m "Add the desktop sidebar and share the manager counts it shows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 外框接上去

**Files:**
- Create: `frontend/src/components/app-shell.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/bottom-nav.tsx:71`
- Modify: `frontend/src/components/ink-transition.tsx`（`InkOverlay` 的 class）
- Modify: `frontend/src/components/onboarding.tsx`（電腦版是置中的對話框）
- Modify: `frontend/src/pages/ask.tsx:196`、`frontend/src/pages/negotiation.tsx:128`（`FIXED_COLUMN`）
- Modify: `frontend/src/pages/manager.tsx`、`frontend/src/pages/admin.tsx`（頁首按鈕在電腦版收起）

**Interfaces:**
- Consumes: `pageWidth`、`FIXED_COLUMN`（Task 1）、`AppSidebar`（Task 3）
- Produces: `AppShell({ user, children }: { user: AuthUser; children: ReactNode })`

- [ ] **Step 1: 寫 `frontend/src/components/app-shell.tsx`**

```tsx
import type { ReactNode } from "react"
import { useLocation } from "react-router"

import { AppSidebar } from "@/components/app-sidebar"
import type { AuthUser } from "@/lib/auth"
import { pageWidth } from "@/lib/desktop-layout"
import { cn } from "@/lib/utils"

/**
 * 登入之後的外框。手機上什麼都不加；電腦版左邊一條側邊欄，內容照 pageWidth 放：
 * 寬版的頁自己排、其他頁放在中間一欄；錄音頁不畫側邊欄，照手機的寬度置中。
 * 在 <Routes> 裡面，換頁時墨還沒蓋滿拿到的是舊的那一頁，寬度跟著畫面一起換
 */
export function AppShell({ user, children }: { user: AuthUser; children: ReactNode }) {
  const width = pageWidth(useLocation().pathname)
  if (width === "bare") return <div className="lg:mx-auto lg:max-w-md">{children}</div>
  return (
    <>
      <AppSidebar user={user} />
      <div className="lg:pl-56">
        <div className={cn(width === "column" && "lg:mx-auto lg:max-w-2xl")}>{children}</div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: `App.tsx`**

1. 外層的寬度在電腦版放開，沒登入的頁另外包一層照手機寬度置中。把

```tsx
      {/* 以手機為主：在寬螢幕上置中，維持手機的寬度 */}
      <div className="mx-auto min-h-svh max-w-md bg-background">
```

換成

```tsx
      {/* 以手機為主：手機與平板維持手機的寬度置中；電腦版（≥1024px）登入後的頁由 AppShell 排，沒登入的頁照舊置中 */}
      <div className="mx-auto min-h-svh max-w-md bg-background lg:max-w-none">
```

2. 沒登入的那幾條路由包進 `PhoneColumn`：

```tsx
          <Route element={<PhoneColumn />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            {/* 隱私權政策不用登入就要看得到：Google 與 Facebook 審核時會直接打開這個網址 */}
            <Route path="/privacy" element={<PrivacyPage />} />
            {/* Google、GitHub 授權完導回來的頁面：登入流程也會走到，所以不能放在要登入的那一層裡 */}
            <Route path="/auth/github/callback" element={<OAuthCallbackPage provider="github" />} />
            <Route path="/auth/google/callback" element={<OAuthCallbackPage provider="google" />} />
          </Route>
```

並在 `NotFound` 上面加：

```tsx
/** 沒登入的頁：電腦版也照手機的寬度置中 */
function PhoneColumn() {
  return (
    <div className="lg:mx-auto lg:max-w-md">
      <Outlet />
    </div>
  )
}
```

3. `RequireAuth` 最後的 return 改成：

```tsx
  return (
    <>
      <AppShell user={session.user}>
        <Outlet />
      </AppShell>
      {/* FR-11：第一次打開時說明三個主要操作，登入之後才顯示 */}
      <Onboarding />
    </>
  )
```

import 加 `import { AppShell } from "@/components/app-shell"`。

- [ ] **Step 3: 底部分頁列在電腦版不畫**

`components/bottom-nav.tsx` 外層那個 div 的 class 最前面加 `lg:hidden`：

```tsx
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md px-2.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] lg:hidden">
```

- [ ] **Step 4: 墨只蓋內容區**

`components/ink-transition.tsx` 的 `InkOverlay`：在 `const canvasRef = …` 下面加

```tsx
  // 電腦版有側邊欄的頁，墨只蓋內容區、側邊欄不動；沒登入的頁與錄音頁照手機的寬度置中
  const signedIn = Boolean(useAuth())
  const shell = signedIn && pageWidth(useLocation().pathname) !== "bare"
```

canvas 的 className 改成

```tsx
      className={cn(
        "fixed inset-y-0 left-1/2 z-60 h-full w-full max-w-md -translate-x-1/2",
        shell && "lg:right-0 lg:left-56 lg:w-auto lg:max-w-none lg:translate-x-0"
      )}
```

import 補上 `useLocation`（react-router，檔案裡已經有 `useLocation` 就沿用）、`import { useAuth } from "@/lib/auth"`、`import { pageWidth } from "@/lib/desktop-layout"`、`import { cn } from "@/lib/utils"`。`InkOverlay` 在 `<BrowserRouter>` 裡面，可以用 `useLocation`。

- [ ] **Step 5: 新手導覽在電腦版是置中的對話框**

`components/onboarding.tsx` 的 return 改成在原本那個 `role="dialog"` 的 div 前面多一層半透明底，並給它電腦版的 class：

```tsx
  return (
    <>
      {/* 電腦版是置中的對話框，後面墊一層半透明底；手機照舊鋪滿 */}
      <div aria-hidden className="fixed inset-0 z-50 hidden bg-black/40 lg:block" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
        className="fixed inset-0 z-50 mx-auto flex max-w-md flex-col bg-background px-6 pt-3 pb-[max(env(safe-area-inset-bottom),1.5rem)] lg:inset-auto lg:top-1/2 lg:left-1/2 lg:h-[min(40rem,calc(100svh-4rem))] lg:w-full lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-3xl lg:border-2 lg:shadow-lip"
      >
        {/* 原本 dialog 裡面的內容，一字不改 */}
      </div>
    </>
  )
```

- [ ] **Step 6: 固定在底部的列對齊中間一欄**

`pages/ask.tsx:196`：

```tsx
      <div className={cn(FIXED_COLUMN, "bottom-0 z-10 flex flex-col gap-1.5 border-t bg-background px-3 pt-2 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-3")}>
```

（電腦版沒有底部分頁列，不用替它留 4.5rem。）`pages/negotiation.tsx:128`：

```tsx
      <div className={cn(FIXED_COLUMN, "bottom-0 z-10 flex gap-2 border-t bg-card px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]")}>
```

兩個檔案都加 `import { FIXED_COLUMN } from "@/lib/desktop-layout"`，沒有 import `cn` 的補上 `import { cn } from "@/lib/utils"`。

- [ ] **Step 7: 頁首按鈕在電腦版收起**

`pages/manager.tsx` 的 `PageHeader trailing`：把 `<>…</>` 換成 `<div className="flex lg:hidden">…</div>`（裡面五個按鈕不動），上面加註解 `{/* 電腦版這些都在側邊欄 */}`。`pages/admin.tsx` 的 `PageHeader trailing` 同樣處理。

- [ ] **Step 8: 跑檢查**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: 全過。

- [ ] **Step 9: 用瀏覽器看一眼**

照「Task 10：實際打開 App」的〈起一套隔離環境〉起好 API 與前端（後面幾個 task 共用同一套，可以先起好留著），用 headless Chrome 截 1440×900：業務 `/ask`、主管 `/manager`、IT `/admin`；390×844：業務 `/ask`。確認：

- 電腦版左邊有側邊欄、內容在中間一欄、問答的輸入列在中間一欄底部、沒有底部分頁列。
- 手機版跟改之前一樣。

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/app-shell.tsx frontend/src/App.tsx frontend/src/components/bottom-nav.tsx frontend/src/components/ink-transition.tsx frontend/src/components/onboarding.tsx frontend/src/pages/ask.tsx frontend/src/pages/negotiation.tsx frontend/src/pages/manager.tsx frontend/src/pages/admin.tsx
git commit -m "Put the sidebar and the middle column around signed-in pages on desktop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 客戶檔案兩欄

**Files:**
- Modify: `frontend/src/pages/customer.tsx`

**Interfaces:**
- Consumes: `useIsDesktop`（Task 1）

- [ ] **Step 1: 加 hook**

`CustomerPage` 最上面那排 hook（`const navigate = useNavigate()` 下面）加：

```tsx
  // 電腦版左邊看狀況、右邊做事（docs/superpowers/specs/2026-10-09-desktop-layout-design.md）
  const desktop = useIsDesktop()
```

import 加 `import { useIsDesktop } from "@/lib/use-media-query"`。hook 一定要在 `if (state.status !== "ready") return …` 之前。

- [ ] **Step 2: 把各區塊拆成變數，兩種版面各自排**

把 ready 那一段 `return (` 開始、到 `<Dialog …>` 之前的 `<main …>…</main>`，以及最後那個 `fixed` 的按鈕列，改成下面這樣（`PageHeader`、`Dialog` 原封不動）：

```tsx
  const { profile } = state
  const { customer, stats } = profile
  const toRecord = () => navigate(`/customers/${customer.id}/record`)
  const toQuote = () => navigate(`/customers/${customer.id}/quote`)
  const toNegotiation = () => navigate(`/customers/${customer.id}/negotiation`)

  const alerts = (
    <>
      {flash && <p className="rounded-xl bg-primary/10 px-3 py-2 text-sm text-primary">{flash}</p>}
      {notice && <p className="rounded-xl bg-primary/10 px-3 py-2 text-sm text-primary">{notice}</p>}
      {threadError && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{threadError}</p>}
      {/* IT 可以把這家交給別的業務；換完重新載入，負責人就是新的那位 */}
      {user?.role === "it" && <ReassignOwner customer={customer} onDone={() => setAttempt((n) => n + 1)} />}
    </>
  )
  const brief = (
    <section className="rounded-2xl border-2 border-primary/20 bg-primary/10 p-4 shadow-lip-primary-soft">
      <p className="text-xs font-semibold tracking-wide text-primary">進門前三分鐘</p>
      <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4 text-sm leading-relaxed">
        {profile.highlights.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  )
  const nextNotes = <NextNotes customerId={customer.id} customerName={customer.name} today={profile.today} />
  // 跟著整頁重新載入：成交之後「上次」就是剛成交的那張
  const lastOrderSection = <LastOrderSection key={attempt} customerId={customer.id} />
  const numbers = (
    <>
      <section className="grid grid-cols-3 gap-2">
        {/* 原本的三張 StatCard，一字不改 */}
      </section>
      <IntervalChart intervals={profile.intervals} alert={stats.interval_alert} />
    </>
  )
  const contractRow = contract?.customerId === customer.id && <ContractRow customerId={customer.id} contract={contract.data} />
  const pendingItems = (
    <PendingItems
      profile={profile}
      onOrder={(quote) => {
        setOrderError(null)
        setOrdering(quote)
      }}
    />
  )
  const competitorList = <Competitors competitors={profile.competitors} />
```

`return` 裡 `PageHeader` 下面改成：

```tsx
      {desktop ? (
        <main className="flex flex-1 items-start gap-6 px-6 pt-4 pb-10">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {alerts}
            {brief}
            {numbers}
            {pendingItems}
            {competitorList}
          </div>
          {/* 要動手的放右邊，捲動時固定在頁首下面；太高時自己捲 */}
          <aside className="sticky top-[4.5rem] flex max-h-[calc(100svh-5.5rem)] w-80 shrink-0 flex-col gap-4 overflow-y-auto px-1 pb-2">
            <div className="flex flex-col gap-2">
              <Button className="h-12 gap-1.5" onClick={toRecord}>
                <Mic className="size-4" />
                語音記錄
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" className="h-12 flex-1 gap-1.5" onClick={toQuote}>
                  <FileText className="size-4" />
                  開報價
                </Button>
                <Button variant="outline" className="h-12 flex-1 gap-1.5" onClick={toNegotiation}>
                  <Handshake className="size-4" />
                  談判卡
                </Button>
              </div>
            </div>
            {nextNotes}
            {lastOrderSection}
            {contractRow}
          </aside>
        </main>
      ) : (
        <main className="flex flex-1 flex-col gap-4 px-4 pt-4 pb-28">
          {alerts}
          {brief}
          {nextNotes}
          {lastOrderSection}
          {numbers}
          {contractRow}
          {pendingItems}
          {competitorList}
        </main>
      )}
```

原本底部的按鈕列包成 `{!desktop && ( … )}`，裡面三顆按鈕的 `onClick` 換成 `toNegotiation`、`toQuote`、`toRecord`，註解保留。手機的順序必須跟原本一模一樣：提示、換負責人、進門前三分鐘、下次去要記得、上次訂的、三格數字、進貨間隔圖、合約、待處理、競品。

- [ ] **Step 3: 跑檢查**

Run: `npm test && npm run lint && npm run typecheck`
Expected: 全過。

- [ ] **Step 4: 用瀏覽器看**

截 1440×900 與 390×844 的業務客戶檔案（隔離環境裡林昱辰的任一家，例如今日路線第一站）：電腦版兩欄、右欄最上面三顆按鈕、沒有底部按鈕列，捲到底右欄還在；手機跟改之前一樣。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/customer.tsx
git commit -m "Lay out the customer profile in two columns on desktop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 開報價兩欄

**Files:**
- Modify: `frontend/src/pages/quote.tsx`（ready 的 `<main>` 與底部那一塊）

這頁的 DOM 順序本來就是「清單、合計」，只用 `lg:` 就能排成兩欄，不必 `useIsDesktop`。

- [ ] **Step 1: 包一層 grid**

`PageHeader` 下面，把 `<main …>…</main>` 和 `{hasLines && (<div className="fixed …">…</div>)}` 一起包進：

```tsx
      {/* 電腦版左邊品項、右邊合計與送出（固定在頁首下面）；手機照舊，合計固定在底部 */}
      <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6 lg:px-6">
        {/* 原本的 <main> */}
        {/* 原本的 {hasLines && (…)} */}
      </div>
```

- [ ] **Step 2: 改兩個 class**

`<main>`：

```tsx
      <main className={cn("flex flex-1 flex-col gap-3 px-4 pt-4 lg:px-0 lg:pb-10", needsApproval ? "pb-80" : "pb-56")}>
```

（`lg:pb-10` 要蓋過 `pb-80`／`pb-56`：Tailwind 的 `lg:` 一定排在後面，放在同一個字串即可。）

底部那一塊：

```tsx
        <div className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md flex-col gap-2 border-t bg-card px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] lg:sticky lg:inset-x-auto lg:top-[4.5rem] lg:bottom-auto lg:mt-4 lg:max-w-none lg:rounded-2xl lg:border-2 lg:p-4 lg:shadow-lip">
```

- [ ] **Step 3: 跑檢查**

Run: `npm run lint && npm run typecheck`
Expected: 全過。

- [ ] **Step 4: 用瀏覽器看**

截 1440×900 與 390×844 的 `/customers/<id>/quote`：電腦版右邊一塊折扣、合計、送出，捲到底還在頁首下面；填一個超過 3% 的折扣，理由框出現在右邊那塊裡；手機跟改之前一樣。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/quote.tsx
git commit -m "Keep the quote total beside the items on desktop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 主管端：側邊欄切換與團隊行程

**Files:**
- Modify: `frontend/src/pages/manager.tsx`（分頁列、`<main>`）
- Modify: `frontend/src/components/map-slot.tsx`（`MapSlot` 可以給高度）
- Modify: `frontend/src/components/manager/routes-panel.tsx`（`TeamOverview`、`RepDetail`）

**Interfaces:**
- Consumes: `useIsDesktop`（Task 1）
- Produces: `MapSlot({ routes, removed, className }: { routes: RepRoute[]; removed?: RemovedStop[]; className?: string })`

- [ ] **Step 1: 分頁列與 main**

`pages/manager.tsx`：分頁列 `<div className="flex border-b bg-background px-2" role="tablist">` 改成 `className="flex border-b bg-background px-2 lg:hidden"`（電腦版由側邊欄切換）。`<main>` 改成：

```tsx
      <main
        className={cn(
          "flex flex-1 flex-col gap-3 px-4 pt-3 pb-10 lg:px-6",
          // 方法卡沒有另外排，電腦版放在中間一欄
          view === "methods" && "lg:mx-auto lg:w-full lg:max-w-2xl"
        )}
      >
```

- [ ] **Step 2: `MapSlot` 可以給高度**

`components/map-slot.tsx`：

```tsx
/** 主管頁的地圖區塊：團隊或一位業務的路線。className 是地圖的高度，手機是 h-64 */
export function MapSlot({ routes, removed, className = "h-64" }: { routes: RepRoute[]; removed?: RemovedStop[]; className?: string }) {
  return (
    <MapGate className={className}>
      {(config, onFail) => <RouteMap config={config} routes={routes} removed={removed} onFail={onFail} />}
    </MapGate>
  )
}
```

- [ ] **Step 3: 團隊總覽：地圖在左、業務在右**

`components/manager/routes-panel.tsx` 加：

```tsx
import { useIsDesktop } from "@/lib/use-media-query"

// 電腦版團隊行程的地圖：在左邊、固定在頁首下面，高度是視窗扣掉頁首
const DESKTOP_MAP = "h-[calc(100svh-5.5rem)]"

/** 電腦版：地圖在左邊固定不動，右邊 26rem 是清單或一位業務的詳細 */
function BesideMap({ map, children }: { map: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_26rem] items-start gap-6">
      <div className="sticky top-[4.5rem]">{map}</div>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </div>
  )
}
```

（`ReactNode` 從 react import。）`TeamOverview` 第一行加 `const desktop = useIsDesktop()`（在 `useLiveLoad` 旁邊、early return 之前），最後的 return 改成：

```tsx
  const { data } = state
  const header = <p className="text-xs text-muted-foreground">{headerLine(data)}</p>
  if (data.reps.length === 0) {
    return (
      <>
        {header}
        <p className="py-10 text-center text-sm text-muted-foreground">目前沒有業務。</p>
      </>
    )
  }
  const cards = data.reps.map((route) => <RepRouteCard key={route.rep.id} route={route} />)
  if (desktop) {
    return (
      <BesideMap map={<MapSlot routes={data.reps} className={DESKTOP_MAP} />}>
        {header}
        {cards}
        <GoogleAttribution routes={data.reps} />
      </BesideMap>
    )
  }
  return (
    <>
      {header}
      <MapSlot routes={data.reps} />
      {cards}
      <GoogleAttribution routes={data.reps} />
    </>
  )
```

- [ ] **Step 4: 一位業務的詳細：同樣地圖在左**

`RepDetail` 第一行加 `const desktop = useIsDesktop()`。最後的 return 拆成變數：

```tsx
  const back = (
    <Link to="/manager" replace className="-ml-1 flex h-11 items-center gap-1 self-start text-sm text-muted-foreground">
      <ChevronLeft className="size-4" />
      團隊行程
    </Link>
  )
  const who = (
    <div className="flex items-center gap-2.5">
      <LiveAvatar id={route.rep.id} name={route.rep.name} size="lg" />
      <div className="min-w-0">
        <p className="text-base font-semibold">{route.rep.name}</p>
        <p className="text-xs text-muted-foreground tabular-nums">{progressLine(route)}</p>
      </div>
    </div>
  )
  const details = (
    <>
      <p className="text-xs tabular-nums">{totalsLine(route)}</p>
      <p className="flex items-start gap-1.5 text-xs text-primary">
        <MapPin className="mt-0.5 size-3.5 shrink-0" />
        {route.location.text}
      </p>
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
  if (desktop) {
    return (
      <BesideMap map={<MapSlot routes={[route]} removed={route.removed} className={DESKTOP_MAP} />}>
        {back}
        {who}
        {details}
      </BesideMap>
    )
  }
  return (
    <>
      {back}
      {who}
      <MapSlot routes={[route]} removed={route.removed} />
      {details}
    </>
  )
```

手機的順序跟原本一樣：返回、頭像、地圖、總計、位置、跟建議比、今天的行程、Google 標示。

- [ ] **Step 5: 跑檢查**

Run: `npm test && npm run lint && npm run typecheck`
Expected: 全過。

- [ ] **Step 6: 用瀏覽器看**

以主管 M01 截 1440×900 的 `/manager` 與 `/manager?view=routes&rep=U01`、390×844 的 `/manager`。電腦版地圖在左、填滿高度（隔離環境沒有 Google 地圖金鑰，左邊會是一行說明，寬度對就好）；側邊欄「團隊行程」是選中的；沒有分頁列；手機跟改之前一樣。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/manager.tsx frontend/src/components/map-slot.tsx frontend/src/components/manager/routes-panel.tsx
git commit -m "Show the team map beside the reps on the desktop manager page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 主管端：提問與風險通報的左清單右內容

**Files:**
- Create: `frontend/src/lib/master-detail.ts`
- Create: `frontend/src/components/manager/master-detail.tsx`
- Modify: `frontend/src/pages/manager.tsx`（`EscalationsPanel`、`NoticesPanel`）
- Test: `frontend/src/lib/master-detail.test.ts`

**Interfaces:**
- Consumes: `useIsDesktop`（Task 1）、`unseenNotices`（Task 3）
- Produces:
  - `pickItem<T extends { id: number }>(items: T[], requested: number | null): T | null`
  - `nextAfter<T extends { id: number }>(items: T[], id: number): number | null`
  - `itemParam(value: string | null): number | null`
  - `MasterDetail({ list, detail }: { list: ReactNode; detail: ReactNode })`
  - `ListRow({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: ReactNode })`
  - `useItemParam(): [number | null, (id: number | null) => void]`（`pages/manager.tsx` 裡，Task 9 也用）

- [ ] **Step 1: 寫會失敗的測試** `frontend/src/lib/master-detail.test.ts`

```ts
import { describe, expect, it } from "vitest"

import { itemParam, nextAfter, pickItem } from "@/lib/master-detail"

const items = [{ id: 4 }, { id: 7 }, { id: 9 }]

describe("pickItem", () => {
  it("網址上記的那一張還在清單裡就選它", () => {
    expect(pickItem(items, 7)).toEqual({ id: 7 })
  })
  it("沒記、或那一張已經不在清單裡，選第一張", () => {
    expect(pickItem(items, null)).toEqual({ id: 4 })
    expect(pickItem(items, 99)).toEqual({ id: 4 })
  })
  it("清單是空的就沒有", () => {
    expect(pickItem([], 4)).toBeNull()
  })
})

describe("nextAfter", () => {
  it("拿掉一張之後選它後面那張", () => {
    expect(nextAfter(items, 4)).toBe(7)
    expect(nextAfter(items, 7)).toBe(9)
  })
  it("拿掉的是最後一張就選前面那張", () => {
    expect(nextAfter(items, 9)).toBe(7)
  })
  it("只剩它、或它不在清單裡，就沒有", () => {
    expect(nextAfter([{ id: 4 }], 4)).toBeNull()
    expect(nextAfter(items, 99)).toBeNull()
  })
})

describe("itemParam", () => {
  it("正整數才算", () => {
    expect(itemParam("12")).toBe(12)
    expect(itemParam(null)).toBeNull()
    expect(itemParam("")).toBeNull()
    expect(itemParam("0")).toBeNull()
    expect(itemParam("-3")).toBeNull()
    expect(itemParam("1.5")).toBeNull()
    expect(itemParam("abc")).toBeNull()
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/master-detail.test.ts`
Expected: FAIL，找不到 `@/lib/master-detail`。

- [ ] **Step 3: 寫 `frontend/src/lib/master-detail.ts`**

```ts
/** 電腦版主管端的左清單、右內容（docs/superpowers/specs/2026-10-09-desktop-layout-design.md〈主管端〉） */

/** 網址上記的那一張還在清單裡就選它，不然選第一張（只是打開，不會改任何東西）；清單是空的就沒有 */
export function pickItem<T extends { id: number }>(items: T[], requested: number | null): T | null {
  return items.find((item) => item.id === requested) ?? items[0] ?? null
}

/** 這一張要從清單拿掉（回覆了、簽完了）：接著選它後面那張，它是最後一張就選前面那張，只剩它就沒有 */
export function nextAfter<T extends { id: number }>(items: T[], id: number): number | null {
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) return null
  return (items[index + 1] ?? items[index - 1])?.id ?? null
}

/** 網址上的 ?item=：不是正整數就當沒選 */
export function itemParam(value: string | null): number | null {
  if (!value) return null
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/master-detail.test.ts`
Expected: PASS。

- [ ] **Step 5: 寫 `frontend/src/components/manager/master-detail.tsx`**

```tsx
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/** 電腦版主管端的左清單、右內容：清單 22rem；右邊固定在頁首下面，太長自己捲 */
export function MasterDetail({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  return (
    <div className="grid grid-cols-[22rem_minmax(0,1fr)] items-start gap-6">
      <div className="flex min-w-0 flex-col gap-2">{list}</div>
      <div className="sticky top-[4.5rem] flex max-h-[calc(100svh-5.5rem)] min-w-0 flex-col gap-3 overflow-y-auto px-1 pb-2">
        {detail}
      </div>
    </div>
  )
}

/** 清單的一列：點了在右邊打開，選中的那列用主色框 */
export function ListRow({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-1 rounded-2xl border-2 bg-card px-4 py-3 text-left shadow-lip press",
        selected && "border-primary shadow-lip-primary"
      )}
    >
      {children}
    </button>
  )
}
```

- [ ] **Step 6: `pages/manager.tsx` 加 `useItemParam`**

放在 `whose` 函式下面：

```tsx
/** 電腦版右邊打開的是哪一張，記在網址的 ?item=：從客戶檔案、申請單回來還停在同一張。換分頁時 switchView 會清掉 */
function useItemParam(): [number | null, (id: number | null) => void] {
  const [params, setParams] = useSearchParams()
  const select = (id: number | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (id === null) next.delete("item")
        else next.set("item", String(id))
        return next
      },
      { replace: true }
    )
  return [itemParam(params.get("item")), select]
}
```

import 加：

```tsx
import { ListRow, MasterDetail } from "@/components/manager/master-detail"
import { itemParam, nextAfter, pickItem } from "@/lib/master-detail"
import { useIsDesktop } from "@/lib/use-media-query"
```

- [ ] **Step 7: 提問**

1. 把 `EscalationsPanel` 裡 `state.items.map((item) => (<article …>…</article>))` 那個 article 整段搬成一個元件（內容一字不改，`key` 留在呼叫的地方）：

```tsx
/** 一則提問：問題、附件、系統的回覆；待回覆的有回覆框，回覆過的寫誰、什麼時候回、業務看過沒 */
function EscalationArticle({ item, onReplied }: { item: Escalation; onReplied: (item: Escalation) => void }) {
  return (
    <article className="rounded-2xl border-2 bg-card p-4 shadow-lip">
      {/* 原本 article 裡面的內容，ReplyForm 的 onReplied 換成這裡的 onReplied */}
    </article>
  )
}
```

2. `EscalationsPanel` 開頭加：

```tsx
  const desktop = useIsDesktop()
  const [requested, select] = useItemParam()
```

3. `switchTab` 裡 `setTab(next)` 前面加 `select(null)`。

4. `replied` 改成：

```tsx
  function replied(item: Escalation) {
    // 電腦版接著打開下一張；要在拿掉之前算
    if (desktop && state.status === "ready") select(nextAfter(state.items, item.id))
    setState((current) =>
      current.status === "ready" ? { status: "ready", items: current.items.filter((i) => i.id !== item.id) } : current
    )
    setNotice(`已回覆「${item.question}」，業務的首頁會提醒他來看。`)
  }
```

5. 原本最後那段 `{state.status === "ready" && state.items.map(…)}` 換成：

```tsx
      {state.status === "ready" &&
        state.items.length > 0 &&
        (desktop ? (
          <EscalationSplit items={state.items} requested={requested} onSelect={select} onReplied={replied} />
        ) : (
          state.items.map((item) => <EscalationArticle key={item.id} item={item} onReplied={replied} />)
        ))}
```

並加：

```tsx
/** 電腦版：左邊一列一則提問，右邊打開選中的那則 */
function EscalationSplit({
  items,
  requested,
  onSelect,
  onReplied,
}: {
  items: Escalation[]
  requested: number | null
  onSelect: (id: number) => void
  onReplied: (item: Escalation) => void
}) {
  const selected = pickItem(items, requested)
  return (
    <MasterDetail
      list={items.map((item) => (
        <ListRow key={item.id} selected={item.id === selected?.id} onSelect={() => onSelect(item.id)}>
          <span className="text-[0.6875rem] text-muted-foreground">
            {formatDateTime(item.created_at)} · {item.kind === "data" ? "數字查詢" : "知識查詢"}
          </span>
          <span className="line-clamp-2 text-sm font-medium">{item.question}</span>
        </ListRow>
      ))}
      detail={selected && <EscalationArticle key={selected.id} item={selected} onReplied={onReplied} />}
    />
  )
}
```

- [ ] **Step 8: 風險通報**

1. `NoticesPanel` 開頭加 `const desktop = useIsDesktop()` 與 `const [requested, select] = useItemParam()`。
2. 最後那行 `{state.status === "ready" && state.items.map((item) => <NoticeCard key={item.id} item={item} onSeen={seen} />)}` 換成：

```tsx
      {state.status === "ready" &&
        state.items.length > 0 &&
        (desktop ? (
          <NoticeSplit items={state.items} requested={requested} onSelect={select} onSeen={seen} />
        ) : (
          state.items.map((item) => <NoticeCard key={item.id} item={item} onSeen={seen} />)
        ))}
```

並加：

```tsx
/** 電腦版：左邊一列一則通報（未讀的標「未讀」），右邊打開選中的那則；按「知道了」停在同一則 */
function NoticeSplit({
  items,
  requested,
  onSelect,
  onSeen,
}: {
  items: ManagerNotice[]
  requested: number | null
  onSelect: (id: number) => void
  onSeen: (item: ManagerNotice) => void
}) {
  const selected = pickItem(items, requested)
  return (
    <MasterDetail
      list={items.map((item) => (
        <ListRow key={item.id} selected={item.id === selected?.id} onSelect={() => onSelect(item.id)}>
          <span className="flex items-center justify-between gap-2 text-[0.6875rem] text-muted-foreground">
            <span className="min-w-0 truncate">
              {formatDateTime(item.created_at)} · 業務 {item.rep_name}
            </span>
            {item.seen_at === null && <span className="shrink-0 rounded-md bg-destructive/10 px-2 py-0.5 text-destructive">未讀</span>}
          </span>
          <span className="truncate text-sm font-medium">{item.customer_name}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {item.reason} · {item.score}/{item.max} 項風險
          </span>
        </ListRow>
      ))}
      detail={selected && <NoticeCard key={selected.id} item={selected} onSeen={onSeen} />}
    />
  )
}
```

- [ ] **Step 9: 跑檢查**

Run: `npm test && npm run lint && npm run typecheck`
Expected: 全過。

- [ ] **Step 10: 用瀏覽器看**

以主管 M01 截 1440×900：`/manager?view=asks`（右邊有回覆框）、`/manager?view=notices`。在隔離環境裡回覆一則提問，看清單少一則、右邊換成下一則、上面出現「已回覆…」；按一則通報的「知道了」，看「未讀」消失、側邊欄的數字少一。手機 390×844 的兩個分頁跟改之前一樣（卡片一張一張往下排）。

- [ ] **Step 11: Commit**

```bash
git add frontend/src/lib/master-detail.ts frontend/src/lib/master-detail.test.ts frontend/src/components/manager/master-detail.tsx frontend/src/pages/manager.tsx
git commit -m "Open manager questions and risk notices beside their list on desktop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 主管端：簽核的左清單右內容

**Files:**
- Create: `frontend/src/components/oa-form-view.tsx`
- Modify: `frontend/src/pages/oa-form.tsx`（只剩頁首與外框）
- Modify: `frontend/src/lib/approval.ts`（`OA_STATUS_LABEL`）
- Modify: `frontend/src/pages/manager.tsx`（`OaInboxPanel`、`OaInboxCard`）

**Interfaces:**
- Consumes: `MasterDetail`、`ListRow`、`useItemParam`、`pickItem`、`nextAfter`（Task 8）、`pendingOa`（Task 3）、`useIsDesktop`（Task 1）
- Produces:
  - `OA_STATUS_LABEL: Record<OaStatus, string>`（`lib/approval.ts`）
  - `OaFormView({ id, backTo, header, onDecided }: { id: number; backTo: string; header: (form: OaFormDetail | null) => ReactNode; onDecided?: (form: OaFormDetail) => void })`

- [ ] **Step 1: 狀態文字搬到 `lib/approval.ts`**

把 `pages/oa-form.tsx` 的 `STATUS_LABEL` 搬到 `lib/approval.ts` 並 export：

```ts
/** 申請單的狀態（OA 上的字） */
export const OA_STATUS_LABEL: Record<OaStatus, string> = {
  draft: "草稿",
  pending: "審核中",
  returned: "已退回",
  rejected: "已駁回",
  approved: "已批准",
}
```

（`OaStatus` 從 `@/api/oa` import type。）

- [ ] **Step 2: 拆出 `components/oa-form-view.tsx`**

把 `pages/oa-form.tsx` 整個檔案的內容搬過去，然後：

1. `OaFormPage` 改名成 `OaFormView`，參數改成 `{ id, backTo, header, onDecided }`（型別見上面 Interfaces），拿掉裡面的 `useParams`、`useAuth`、`backTo` 的計算；`useNavigate` 留著（錯誤訊息的「返回」要用）。
2. 最外層的 `<div className="flex min-h-svh flex-col">` 拿掉，換成 fragment；`<PageHeader … />` 換成 `{header(form)}`。
3. `DecideBar` 的 `onDecided` 改成：

```tsx
            onDecided={(next) => {
              setStale(null)
              setState({ status: "ready", form: next })
              onDecided?.(next)
            }}
```

4. `STATUS_LABEL[form.status]` 換成 `OA_STATUS_LABEL[form.status]`，import `OA_STATUS_LABEL` 與 `formatRate` 都從 `@/lib/approval`。拿掉用不到的 import（`PageHeader`、`useParams`、`canManage`、`useAuth`），加 `import type { ReactNode } from "react"`。
5. 註解改成：`/** 一張申請單（出差單、優惠、合約）的內容：表單、附件、意見、簽核流程、活動日誌。頁首由用的人給：單獨一頁是 PageHeader，電腦版主管端的右欄是一行標題 */`

- [ ] **Step 3: `pages/oa-form.tsx` 只剩頁首與外框**

```tsx
import { useParams } from "react-router"

import { OaFormView } from "@/components/oa-form-view"
import { PageHeader } from "@/components/page-header"
import { canManage, useAuth } from "@/lib/auth"

/** 一張申請單單獨一頁：業務看自己的申請單、手機的主管端點進來；電腦版的主管端在右欄打開同樣的內容 */
export function OaFormPage() {
  const { formId } = useParams()
  const user = useAuth()?.user
  const backTo = user && canManage(user.role) ? "/manager?view=oa" : "/oa/forms"
  return (
    <div className="flex min-h-svh flex-col">
      <OaFormView
        id={Number(formId)}
        backTo={backTo}
        header={(form) => <PageHeader title={form?.kind_label ?? "申請單"} subtitle={form?.form_no} backTo={backTo} />}
      />
    </div>
  )
}
```

- [ ] **Step 4: 跑檢查，確認單獨一頁沒有壞**

Run: `npm test && npm run lint && npm run typecheck`
Expected: 全過。

- [ ] **Step 5: 簽核匣：卡片內容拆出來**

`pages/manager.tsx` 的 `OaInboxCard` 拆成內容與外框：

```tsx
/** 簽核匣的一張單：種類標籤、一句摘要；優惠與合約多一塊模型的估計與理由 */
function OaInboxSummary({ item }: { item: OaFormItem }) {
  return (
    <>
      {/* 原本 OaInboxCard 的 <Link> 裡面的內容，一字不改 */}
    </>
  )
}

function OaInboxCard({ item }: { item: OaFormItem }) {
  return (
    <Link to={`/oa/forms/${item.id}`} className="rounded-2xl border-2 bg-card p-4 shadow-lip press">
      <OaInboxSummary item={item} />
    </Link>
  )
}
```

「系統已核准」那一區每一列的 `<Link>` 裡面同樣拆成 `AutoApprovedSummary({ item })`。

- [ ] **Step 6: 簽核匣：電腦版左清單右內容**

`OaInboxPanel` 開頭加：

```tsx
  const desktop = useIsDesktop()
  const [requested, select] = useItemParam()
  const [notice, setNotice] = useState<string | null>(null)
```

並加這個函式：

```tsx
  // 電腦版在右邊簽完：重拿清單與側邊欄的數字，接著打開下一張（簽完的那張通常就不在等簽的清單裡了）
  function decided(form: OaFormDetail) {
    void pendingOa.refresh()
    if (state.status === "ready") select(nextAfter([...state.items, ...automatic], form.id))
    setNotice(`${form.form_no} ${OA_STATUS_LABEL[form.status]}`)
    setAttempt((n) => n + 1)
  }
```

說明文字下面加 `{notice && <p className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">{notice}</p>}`。

把原本「清單」與「系統已核准」兩段：

```tsx
      {state.status === "ready" && state.items.map((item) => <OaInboxCard key={item.id} item={item} />)}
      {automatic.length > 0 && ( <section …>…</section> )}
```

包成：

```tsx
      {desktop ? (
        state.status === "ready" &&
        state.items.length + automatic.length > 0 && (
          <OaSplit items={state.items} automatic={automatic} requested={requested} onSelect={select} onDecided={decided} />
        )
      ) : (
        <>
          {/* 原本那兩段，一字不改 */}
        </>
      )}
```

並加：

```tsx
/** 電腦版：左邊是等簽的單，下面接系統已核准的單；右邊打開選中的那張，在這裡直接簽 */
function OaSplit({
  items,
  automatic,
  requested,
  onSelect,
  onDecided,
}: {
  items: OaFormItem[]
  automatic: OaFormItem[]
  requested: number | null
  onSelect: (id: number) => void
  onDecided: (form: OaFormDetail) => void
}) {
  const selected = pickItem([...items, ...automatic], requested)
  const row = (item: OaFormItem, summary: ReactNode) => (
    <ListRow key={item.id} selected={item.id === selected?.id} onSelect={() => onSelect(item.id)}>
      {summary}
    </ListRow>
  )
  return (
    <MasterDetail
      list={
        <>
          {items.map((item) => row(item, <OaInboxSummary item={item} />))}
          {automatic.length > 0 && <p className="mt-3 text-sm font-semibold">系統已核准</p>}
          {automatic.map((item) => row(item, <AutoApprovedSummary item={item} />))}
        </>
      }
      detail={
        selected && (
          <div className="flex flex-col overflow-hidden rounded-2xl border-2 bg-background shadow-lip">
            <OaFormView
              key={selected.id}
              id={selected.id}
              backTo="/manager?view=oa"
              header={(form) => (
                <div className="border-b px-4 py-3">
                  <p className="text-xs text-muted-foreground">{form?.form_no ?? selected.form_no}</p>
                  <h2 className="text-base font-semibold">{form?.kind_label ?? selected.kind_label}</h2>
                </div>
              )}
              onDecided={onDecided}
            />
          </div>
        )
      }
    />
  )
}
```

import 加 `OaFormView`（`@/components/oa-form-view`）、`OA_STATUS_LABEL`（`@/lib/approval`）、`type OaFormDetail`（`@/api/oa`）、`type ReactNode`（react）、`pendingOa`（`@/lib/manager-counts`，Task 3 已經 import 的那行加上）。

- [ ] **Step 7: 跑檢查**

Run: `npm test && npm run lint && npm run typecheck`
Expected: 全過。

- [ ] **Step 8: 用瀏覽器看**

以主管 M01 截 1440×900 的 `/manager?view=oa`：左邊等簽的單、右邊申請單的五個分頁與核准列。在隔離環境核准一張：清單重拿、右邊換成下一張、上面出現「OA-… 已批准」、側邊欄「簽核」的數字少一。打開 `/oa/forms/<id>`（主管與業務各一次）確認單獨一頁跟改之前一樣。手機 390×844 的簽核分頁跟改之前一樣。

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/oa-form-view.tsx frontend/src/pages/oa-form.tsx frontend/src/lib/approval.ts frontend/src/pages/manager.tsx
git commit -m "Sign OA forms beside the inbox on the desktop manager page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 頻道：網址對應到哪兩欄

**Files:**
- Modify: `frontend/src/lib/channel-rail.ts`（`railTarget`）
- Create: `frontend/src/lib/channel-panes.ts`
- Test: `frontend/src/lib/channel-rail.test.ts`（加 `railTarget`）、`frontend/src/lib/channel-panes.test.ts`

**Interfaces:**
- Produces:
  - `railTarget(channel: Pick<Channel, "id" | "kind" | "parent_id">): number`
  - `channelPanes(input: { channels: Channel[]; routeId: number | null; requested: number | null; remembered: number | null; role: Role; opened: Pick<Channel, "id" | "kind" | "parent_id"> | null }): { railId: number | null; openId: number | null }`

- [ ] **Step 1: 寫會失敗的測試**

`frontend/src/lib/channel-rail.test.ts` 的 import 加 `railTarget`，最後加：

```ts
describe("railTarget", () => {
  it("文字頻道與客戶討論串算上層，其他是自己", () => {
    expect(railTarget(news)).toBe(2)
    expect(railTarget(channel(300, "customer", "健安藥局", { parent_id: 9 }))).toBe(9)
    expect(railTarget(north)).toBe(2)
    expect(railTarget(daan)).toBe(9)
  })
})
```

新檔 `frontend/src/lib/channel-panes.test.ts`：

```ts
import { describe, expect, it } from "vitest"

import type { Channel } from "@/api/channels"
import { channelPanes } from "@/lib/channel-panes"

const channel = (id: number, kind: Channel["kind"], name: string, extra: Partial<Channel> = {}) =>
  ({ id, kind, name, region_id: null, parent_id: null, unread: 0, archived: false, can_manage: false, ...extra }) as Channel

const national = channel(1, "national", "全國")
const north = channel(2, "region", "北區", { parent_id: 1 })
const news = channel(21, "topic", "新品上市", { parent_id: 2 })
const team = channel(5, "team", "陳建宏小組", { parent_id: 2 })
const daan = channel(9, "place", "台北市・大安區", { parent_id: 2 })
const channels = [national, north, news, team, daan]
const thread = { id: 300, kind: "customer" as const, parent_id: 9 }

const panes = (input: Partial<Parameters<typeof channelPanes>[0]>) =>
  channelPanes({ channels, routeId: null, requested: null, remembered: null, role: "sales", opened: null, ...input })

describe("channelPanes", () => {
  it("/channels/:id 是文字頻道：對話開它，頻道列選上層", () => {
    expect(panes({ routeId: 21 })).toEqual({ railId: 2, openId: 21 })
  })

  it("/channels/:id 是頻道列上的頻道：兩邊都是它", () => {
    expect(panes({ routeId: 2 })).toEqual({ railId: 2, openId: 2 })
    expect(panes({ routeId: 9 })).toEqual({ railId: 9, openId: 9 })
  })

  it("客戶討論串不在清單裡：載入之前頻道列先不選，載入之後選它的地點", () => {
    expect(panes({ routeId: 300 })).toEqual({ railId: null, openId: 300 })
    expect(panes({ routeId: 300, opened: thread })).toEqual({ railId: 9, openId: 300 })
  })

  it("對話欄還留著上一個頻道的資料時不算", () => {
    expect(panes({ routeId: 300, opened: { id: 301, kind: "customer", parent_id: 2 } })).toEqual({ railId: null, openId: 300 })
  })

  it("/channels 沒帶 id：照 ?c=、記住的、預設的，對話開頻道列選中的那個", () => {
    expect(panes({ requested: 2 })).toEqual({ railId: 2, openId: 2 })
    expect(panes({ requested: 21 })).toEqual({ railId: 2, openId: 2 })
    expect(panes({ remembered: 9 })).toEqual({ railId: 9, openId: 9 })
    expect(panes({})).toEqual({ railId: 5, openId: 5 })
    expect(panes({ role: "it" })).toEqual({ railId: 1, openId: 1 })
  })

  it("一個頻道都看不到", () => {
    expect(panes({ channels: [] })).toEqual({ railId: null, openId: null })
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/channel-rail.test.ts src/lib/channel-panes.test.ts`
Expected: FAIL，`railTarget` 不存在、找不到 `@/lib/channel-panes`。

- [ ] **Step 3: `railTarget`**

`lib/channel-rail.ts` 的 `railPath` 換成：

```ts
/** 頻道列上代表這個頻道的那一塊：文字頻道與客戶討論串是它的上層，其他是自己 */
export function railTarget(channel: Pick<Channel, "id" | "kind" | "parent_id">): number {
  return (channel.kind === "topic" || channel.kind === "customer") && channel.parent_id !== null ? channel.parent_id : channel.id
}

export function railPath(channel: Pick<Channel, "id" | "kind" | "parent_id">): string {
  return `/channels?c=${railTarget(channel)}`
}
```

（`railPath` 原本上面的註解留著。）

- [ ] **Step 4: 寫 `frontend/src/lib/channel-panes.ts`**

```ts
import type { Channel } from "@/api/channels"
import type { Role } from "@/lib/auth"
import { pickSelected, railTarget } from "@/lib/channel-rail"

type Ref = Pick<Channel, "id" | "kind" | "parent_id">

/**
 * 電腦版頻道四欄（docs/superpowers/specs/2026-10-09-desktop-layout-design.md〈頻道〉）：網址決定對話欄開哪一個、頻道列選哪一個。
 * - /channels/:id（routeId）：對話開它，頻道列選它所屬的那一塊（railTarget）。客戶討論串不在頻道清單裡，
 *   要等對話欄載入、拿到它的上層（opened）才知道；在那之前頻道列先不選。
 * - /channels（routeId 是 null）：跟手機一樣照 ?c=、記住的、預設的挑頻道列（pickSelected），對話開那一個本身。
 */
export function channelPanes({
  channels,
  routeId,
  requested,
  remembered,
  role,
  opened,
}: {
  channels: Channel[]
  routeId: number | null
  requested: number | null
  remembered: number | null
  role: Role
  opened: Ref | null
}): { railId: number | null; openId: number | null } {
  if (routeId !== null) {
    const known: Ref | undefined = channels.find((c) => c.id === routeId) ?? (opened?.id === routeId ? opened : undefined)
    return { railId: known ? railTarget(known) : null, openId: routeId }
  }
  const selected = pickSelected(channels, requested, remembered, role)
  return { railId: selected?.id ?? null, openId: selected?.id ?? null }
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run src/lib/channel-rail.test.ts src/lib/channel-panes.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/channel-rail.ts frontend/src/lib/channel-rail.test.ts frontend/src/lib/channel-panes.ts frontend/src/lib/channel-panes.test.ts
git commit -m "Work out which channel the desktop rail selects and which one is open

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: 頻道四欄

**Files:**
- Modify: `frontend/src/pages/channel.tsx`（`ChannelView` → `ChannelConversation`，多一種 `pane` 版面）
- Modify: `frontend/src/pages/channels.tsx`（電腦版四欄）
- Modify: `frontend/src/components/channel-panel.tsx`、`frontend/src/components/channel-row.tsx`（選中的那列、電腦版不放看板入口）
- Modify: `frontend/src/components/ink-transition.tsx`（`InkRoutes`）
- Modify: `frontend/src/App.tsx`（頻道路由）

**Interfaces:**
- Consumes: `channelPanes`（Task 10）、`useIsDesktop`、`useIsWide`、`desktopSamePage`（Task 1）
- Produces:
  - `ChannelConversation({ id, layout, onLoaded }: { id: number; layout?: "page" | "pane"; onLoaded?: (channel: Channel) => void })`
  - `ChannelPanel` 多兩個選填的 props：`openId?: number | null`、`compact?: boolean`
  - `ChannelRow` 多一個選填的 prop：`selected?: boolean`
  - `ChannelsEntry()`（`App.tsx` 裡）

- [ ] **Step 1: `ChannelConversation`**

`pages/channel.tsx`：

1. `ChannelPage` 最後那行改成 `return <ChannelConversation key={id} id={id} />`。
2. `function ChannelView({ id }: { id: number })` 改成：

```tsx
/** 一個頻道的對話。layout 是 page：手機的對話頁（頁首、返回、對話與記憶看板切換）；
 * pane：電腦版頻道四欄的對話欄（自己一列標頭，≥1280px 時記憶看板放在右邊另一欄）。onLoaded 告訴四欄載入的是哪個頻道 */
export function ChannelConversation({
  id,
  layout = "page",
  onLoaded,
}: {
  id: number
  layout?: "page" | "pane"
  onLoaded?: (channel: Channel) => void
}) {
```

並在 state 那一排下面加：

```tsx
  // 電腦版夠寬時記憶看板另外一欄，不用切換
  const wide = useIsWide()
  const boardAside = layout === "pane" && wide
```

3. 載入之後告訴四欄，在現有的 effect 後面加一個：

```tsx
  // 電腦版四欄：客戶討論串不在頻道清單裡，載入之後才知道頻道列要選哪一個地點
  useEffect(() => {
    if (state.status === "ready") onLoaded?.(state.channel)
  }, [state, onLoaded])
```

4. 「從看板跳回原訊息」那個 effect 的第一行改成 `if (highlight === null || (tab !== "chat" && !boardAside)) return`，deps 加 `boardAside`。
5. `if (state.status !== "ready")` 那段改成：

```tsx
  if (state.status !== "ready") {
    const body = (
      <main className="flex-1 p-4">
        {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>}
        {state.status === "error" && (
          <Notice text={state.missing ? "找不到這個頻道，或是你看不到它。" : "連不上伺服器，頻道沒有載入。"} />
        )}
      </main>
    )
    if (layout === "pane") return <div className="flex min-w-0 flex-1 flex-col">{body}</div>
    return (
      <div className="flex min-h-svh flex-col">
        <PageHeader title="頻道" backTo={backTo} />
        {body}
      </div>
    )
  }
```

6. ready 的 return 改成先組好各塊再依版面包起來：

```tsx
  const { channel } = state
  const byId = new Map(messages.map((m) => [m.id, m]))
  const searchLink = (
    <Link
      to={`/channels/search?channel=${channel.id}`}
      aria-label="在這個頻道找照片與檔案"
      className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
    >
      <Search className="size-5" />
    </Link>
  )
  const members = !channel.archived && <ChannelMembers channelId={channel.id} selfId={selfId} />
  const head =
    layout === "page" ? (
      <>
        <PageHeader
          title={channel.name}
          subtitle={KIND_LABEL[channel.kind]}
          backTo={backTo}
          trailing={
            <>
              {searchLink}
              {members}
            </>
          }
        />
        {channel.kind === "place" && (
          <Link to={`/channels/${channel.id}/threads`} className="flex min-h-11 items-center gap-2 border-b px-4 text-sm text-primary">
            <Store className="size-4" />
            這裡的客戶討論串
          </Link>
        )}
      </>
    ) : (
      // 電腦版：地點的客戶討論串已經列在旁邊的頻道內容欄，不用另外連
      <header className="flex items-center gap-1 border-b py-1.5 pr-1 pl-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{channel.name}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {KIND_LABEL[channel.kind]}
            {channel.online > 0 && `・${channel.online} 人在線`}
          </p>
        </div>
        {searchLink}
        {members}
      </header>
    )
  const showChat = boardAside || tab === "chat"
  const column = (
    <>
      {head}
      {!boardAside && (
        <div className="grid grid-cols-2 gap-1 border-b bg-background px-4 py-2" role="tablist">
          {/* 原本的兩顆分頁按鈕，一字不改 */}
        </div>
      )}
      {!boardAside && tab === "board" && (
        <main className="flex-1 overflow-y-auto px-4 py-4">
          <ChannelBoard channel={channel} onJump={(messageId) => void jumpTo(messageId)} />
        </main>
      )}
      <main ref={main} onScroll={handleScroll} className={cn("flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4", !showChat && "hidden")}>
        {/* 原本對話 main 裡面的內容，一字不改 */}
      </main>
      <footer className={cn("border-t bg-card px-4 pt-2 pb-[max(env(safe-area-inset-bottom),0.75rem)]", !showChat && "hidden")}>
        {/* 原本 footer 裡面的內容，一字不改 */}
      </footer>
      {deleting && <DeleteDialog message={deleting} onConfirm={confirmDelete} onClose={() => setDeleting(null)} />}
    </>
  )
  if (layout === "page") return <div className="flex h-svh flex-col">{column}</div>
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">{column}</div>
      {boardAside && (
        <aside aria-label="記憶看板" className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l px-4 py-4">
          <h3 className="text-sm font-semibold">記憶看板</h3>
          <ChannelBoard channel={channel} onJump={(messageId) => void jumpTo(messageId)} />
        </aside>
      )}
    </div>
  )
```

import 加 `import { useIsWide } from "@/lib/use-media-query"`。

7. 跑 `npm run lint && npm run typecheck`，確認手機的對話頁照舊（`layout` 預設 `page`）。

- [ ] **Step 2: `ChannelRow` 與 `ChannelPanel` 標出打開的那一個**

`components/channel-row.tsx` 的 `ChannelRow` 多一個 `selected?: boolean`：

```tsx
export function ChannelRow({
  channel,
  indent = false,
  backTo,
  selected = false,
}: {
  channel: Channel
  indent?: boolean
  backTo?: string
  selected?: boolean
}) {
  const detail = channelDetail(channel)
  return (
    <Link
      to={`/channels/${channel.id}`}
      state={backTo ? { backTo } : undefined}
      aria-current={selected ? "page" : undefined}
      className={cn("flex min-h-12 items-center gap-3 border-t py-2 pr-4 first:border-t-0", indent ? "pl-10" : "pl-4", selected && "bg-muted")}
    >
```

（其餘不動。）

`components/channel-panel.tsx`：

1. `ChannelPanel` 的 props 加：

```tsx
  // 電腦版四欄：對話欄打開的是哪一個（那一列墊底色）；compact 時不放記憶看板入口（看板在對話欄裡）與成員（對話欄標頭有）
  openId = null,
  compact = false,
```

型別加 `openId?: number | null; compact?: boolean`。

2. 標頭的成員改成 `{!channel.archived && !compact && <ChannelMembers channelId={channel.id} selfId={selfId} />}`。
3. 三個 `PanelLink`：

```tsx
          <PanelLink to={`/channels/${channel.id}`} state={{ backTo: back }} icon={MessagesSquare} label="對話" unread={channel.unread} selected={openId === channel.id} />
          {!compact && (
            <PanelLink to={`/channels/${channel.id}`} state={{ backTo: back, tab: "board" }} icon={NotebookText} label="記憶看板" />
          )}
          <PanelLink to={`/channels/search?channel=${channel.id}`} state={{ backTo: back }} icon={Images} label="照片與檔案" />
```

4. `PanelLink` 加 `selected = false`（型別 `selected?: boolean`），`<Link>` 加 `aria-current={selected ? "page" : undefined}`，class 改成 `cn("flex min-h-12 items-center gap-3 border-t px-4 py-2 first:border-t-0", selected && "bg-muted")`。
5. `TopicSection` 加 `openId: number | null` prop（`ChannelPanel` 傳 `openId={openId}`），兩處 `<TopicRow … />` 都傳 `selected={topic.id === openId}`；`TopicRow` 加 `selected: boolean`，外層 div 的 class 加 `selected && "bg-muted"`，裡面的 `<Link>` 加 `aria-current={selected ? "page" : undefined}`。
6. `ThreadSection` 加 `openId: number | null` prop（`ChannelPanel` 傳），`<ChannelRow … selected={thread.id === openId} />`。

- [ ] **Step 3: `ChannelsPage` 電腦版四欄**

`pages/channels.tsx`：

1. import 改成／加上：

```tsx
import { Link, useNavigate, useParams, useSearchParams } from "react-router"
import { ChannelConversation } from "@/pages/channel"
import { channelPanes } from "@/lib/channel-panes"
import { useIsDesktop } from "@/lib/use-media-query"
```

（`pickSelected` 不再直接用，從 import 拿掉。）

2. 元件開頭加：

```tsx
  const desktop = useIsDesktop()
  const navigate = useNavigate()
  // 電腦版的 /channels/:id：對話欄開哪一個（App.tsx 的 ChannelsEntry 只在電腦版把這個網址交給這一頁）
  const { channelId } = useParams()
  const routeId = channelId === undefined ? null : Number(channelId)
  const badRoute = routeId !== null && !(Number.isInteger(routeId) && routeId > 0)
  // 對話欄載入的那個頻道：客戶討論串不在頻道清單裡，要等它載入才知道頻道列要選哪一個
  const [opened, setOpened] = useState<Channel | null>(null)
```

3. 原本算 `selected` 的那兩行換成：

```tsx
  const requested = Number(params.get("c")) || null
  const panes =
    state.status === "ready" && user && !badRoute
      ? channelPanes({ channels: state.channels, routeId, requested, remembered: rememberedChannel(), role: user.role, opened })
      : null
  const selected = state.status === "ready" && panes?.railId != null ? (state.channels.find((c) => c.id === panes.railId) ?? null) : null
  const selectedId = selected?.id ?? null
```

（`routeId` 是 null 時 `channelPanes` 就是原本的 `pickSelected`，手機的結果不變。）

4. `{state.status === "ready" && user && (` 那一段的條件改成 `state.status === "ready" && user && !desktop`，裡面不動。後面加電腦版：

```tsx
      {state.status === "ready" && user && desktop && (
        <div className="flex min-h-0 flex-1">
          <ChannelRail channels={state.channels} selectedId={selectedId} onSelect={(channel) => navigate(`/channels/${channel.id}`)} />
          <div className="flex w-60 shrink-0 border-r">
            {selected && (
              <ChannelPanel
                key={selected.id}
                channel={selected}
                channels={state.channels}
                selfId={user.id}
                refreshKey={state.loadedAt}
                onChanged={() => setAttempt((n) => n + 1)}
                openId={panes?.openId ?? null}
                compact
              />
            )}
          </div>
          {panes?.openId != null ? (
            <ChannelConversation key={panes.openId} id={panes.openId} layout="pane" onLoaded={setOpened} />
          ) : (
            <main className="flex-1 p-4">
              <Notice text={badRoute ? "找不到這個頻道，或是你看不到它。" : "還沒有看得到的頻道。"} />
            </main>
          )}
        </div>
      )}
```

5. 元件上面的註解補一句：`電腦版（≥1024px）是四欄：頻道列、頻道內容、對話、記憶看板（≥1280px），/channels/:id 也是這一頁（App.tsx 的 ChannelsEntry）。`

- [ ] **Step 4: 路由與換欄不播墨**

`App.tsx`：兩條頻道路由都用同一個元件，從清單點進對話時這一頁不會整個重來：

```tsx
            <Route path="/channels" element={<ChannelsEntry />} />
            <Route path="/channels/search" element={<ChannelSearchPage />} />
            <Route path="/channels/:channelId" element={<ChannelsEntry />} />
```

並加：

```tsx
/** 頻道：手機上 /channels 是兩欄、/channels/:id 是對話頁；電腦版兩個網址都是四欄那一頁。
 * 兩條路由用同一個元件，在電腦版從清單換到某個對話時四欄不會整個重新掛載 */
function ChannelsEntry() {
  const { channelId } = useParams()
  const desktop = useIsDesktop()
  return channelId === undefined || desktop ? <ChannelsPage /> : <ChannelPage />
}
```

import 加 `useParams`（react-router）與 `import { useIsDesktop } from "@/lib/use-media-query"`。

`components/ink-transition.tsx` 的 `InkRoutes`：在 `const type = useNavigationType()` 下面加 `const desktop = useIsDesktop()`，判斷要不要播的那行改成：

```tsx
    // 電腦版頻道四欄裡換對話（/channels ↔ /channels/:id）只是換一欄，不播
    const sameDesktopPage = desktop && desktopSamePage(seen.pathname, location.pathname)
    const effect = held || type === "REPLACE" || sameDesktopPage ? null : pickEffect(seen.pathname, location.pathname)
```

import 加 `desktopSamePage`（`@/lib/desktop-layout`，Task 4 已 import `pageWidth` 的那行）與 `useIsDesktop`。

- [ ] **Step 5: 跑檢查**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: 全過。

- [ ] **Step 6: 用瀏覽器看**

以業務 U01 截：

- 1440×900 的 `/channels`、點北區的文字頻道後的 `/channels/<topic>`：四欄，右邊有記憶看板，換頻道時頻道清單沒有閃「載入頻道中…」（閃了就表示四欄被重新掛載，回頭檢查 `ChannelsEntry`）、沒有播墨。
- 1440×900 打開一個地點底下的客戶討論串：頻道列選中那個地點。
- 1100×800 的 `/channels/<topic>`：沒有看板那一欄，對話欄上方有「對話／記憶看板」切換。
- 390×844 的 `/channels` 與 `/channels/<topic>`：跟改之前一樣（兩欄、對話頁有返回鍵）。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/channel.tsx frontend/src/pages/channels.tsx frontend/src/components/channel-panel.tsx frontend/src/components/channel-row.tsx frontend/src/components/ink-transition.tsx frontend/src/App.tsx
git commit -m "Show channels in four columns on desktop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: 實際打開 App、README、推上 main

**Files:**
- Modify: `README.md`（一小段電腦版）

#### 起一套隔離環境（Task 4 起就可以先起好）

- [ ] 資料庫與設定（在 worktree 根目錄）：

```bash
docker compose up -d --wait db redis
docker compose exec -T db createdb -U meddemo meddemo_desktop_dev
cp ../../../backend/.env backend/.env   # 主 checkout 的 .env；做完要刪
DATABASE_URL=postgresql+psycopg://meddemo:meddemo@127.0.0.1:5433/meddemo_desktop_dev uv run --project backend python data/seed/seed.py --database-url postgresql+psycopg://meddemo:meddemo@127.0.0.1:5433/meddemo_desktop_dev
```

- [ ] API（背景跑，port 8014、Redis 第 12 號庫、自己指定 `JWT_SECRET`，簽 token 的腳本才能用同一把）：

```bash
JWT_SECRET=desktop-check DATABASE_URL=postgresql+psycopg://meddemo:meddemo@127.0.0.1:5433/meddemo_desktop_dev REDIS_URL=redis://127.0.0.1:6379/12 uv run --project backend uvicorn app.main:app --app-dir backend --port 8014
```

- [ ] 前端（背景跑，port 5174）：在 `frontend/` 建暫時的 `vite.desktop.config.ts`（不 commit）：

```ts
import { mergeConfig } from "vite"

import base from "./vite.config"

export default mergeConfig(base, {
  server: {
    port: 5174,
    proxy: {
      "/api/ws": { target: "ws://127.0.0.1:8014", ws: true },
      "/api": "http://127.0.0.1:8014",
      "/health": "http://127.0.0.1:8014",
    },
  },
})
```

`npx vite --config vite.desktop.config.ts`

- [ ] 簽三個角色的 token：在 scratchpad 寫 `make_tokens.py`，用字面路徑跑（`JWT_SECRET=desktop-check DATABASE_URL=… uv run --project backend python <scratchpad>/make_tokens.py`）：

```python
"""印出業務 U01、主管 M01、IT A01 的 token 與使用者資料（JSON），給 headless Chrome 寫進 localStorage"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path("backend").resolve()))

from app.api.auth import _public  # noqa: E402  # /api/auth/me 回傳使用者用的那一個
from app.db import session_factory  # noqa: E402
from app.models import AppUser  # noqa: E402
from app.services import auth  # noqa: E402

with session_factory()() as session:
    out = {}
    for user_id in ("U01", "M01", "A01"):
        user = session.get(AppUser, user_id)
        out[user_id] = {"token": auth.create_token(user), "user": _public(session, user).model_dump(mode="json")}
print(json.dumps(out, ensure_ascii=False))
```

- [ ] 截圖：headless Chrome 在這台電腦上大約 30 秒會自己結束，每一段（一個角色、一兩個網址）開一個新的 Chrome、新的 `--user-data-dir` 與 port，20 秒內做完。每段先在 `about:blank` 的 origin 換成 `http://localhost:5174` 之後寫 localStorage：`meddemo:token`、`meddemo:user`、`meddemo:onboarded=1`（深色那一套再加 `meddemo:skin=dark`），再打開要看的網址；用 `Emulation.setDeviceMetricsOverride` 設寬高。DevTools 腳本放 scratchpad，用 Node 內建的 `WebSocket`，旁邊放一個 `setInterval` 讓程序不要提早結束。

#### 最後一輪檢查

- [ ] **Step 1: 電腦版 1440×900，淺色與深色各一套**

業務：客戶檔案、開報價、頻道四欄、問答（中間一欄）、新手導覽（拿掉 `meddemo:onboarded` 再開）、換頁的墨蓋到一半（點側邊欄換頁，200ms 後截）。主管：團隊行程總覽與某位業務、提問、風險通報、簽核。IT：組織管理（中間一欄、側邊欄最上面是組織管理）。看每一張：側邊欄選中的那一列對、數字有出來、沒有東西蓋到側邊欄、深色的字看得清楚。

- [ ] **Step 2: 1024×768**

頻道沒有看板那一欄、客戶檔案右欄沒有被擠壞、主管端左清單右內容還放得下。

- [ ] **Step 3: 手機 390×844 跟改之前比**

在 worktree 先 `git stash`（或另開一個 `origin/main` 的 worktree）截一套「改之前」：業務首頁、客戶清單、客戶檔案、開報價、頻道兩欄、頻道對話、問答、談判卡；主管的五個分頁；IT 的組織管理。改之後同樣的網址再截一套，兩兩比對，應該一樣（地圖、時間這種會動的除外）。

- [ ] **Step 4: README**

`README.md` 在「口述到回寫」那一節之前加一小段：

```markdown
## 電腦版

寬度 ≥1024px 換成電腦版（`docs/superpowers/specs/2026-10-09-desktop-layout-design.md`）：左邊一條側邊欄取代底部分頁列；頻道是四欄（≥1280px 才有記憶看板那一欄）、主管端團隊行程地圖在左、提問與風險通報與簽核是左清單右內容、客戶檔案與開報價兩欄，其他頁放在中間一欄。錄音頁與沒登入的頁照手機的寬度置中。首頁的電腦版另外做。手機與平板（<1024px）不變。
```

- [ ] **Step 5: 收拾**

刪掉 `backend/.env`、`frontend/vite.desktop.config.ts`、scratchpad 以外的暫存檔；`git status` 確認只有 README 的改動，沒有 `* 2.*` 這種重複檔。停掉 API 與 vite。資料庫 `meddemo_desktop_dev` 留著無妨（不影響別人），要刪就 `docker compose exec -T db dropdb -U meddemo meddemo_desktop_dev`。

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "Describe the desktop layout in the README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: 推上 main**

```bash
git fetch origin
git rebase origin/main          # 有衝突就解；解完再跑一次 npm test && npm run lint && npm run typecheck
cd frontend && npm test && npm run lint && npm run typecheck && cd ..
git push origin desktop-layout:main
```

推之前再確認 `origin/main` 沒有在這段時間又動（動了就再 fetch、rebase 一次）。推完用 `gh run watch` 看 `.github/workflows/ci-cd.yml` 那一輪跑到部署完成，回報結果。部署後用自己註冊的業務帳號在正式站開一次 1440 寬的客戶檔案確認（Cloudflare 擋 curl，要從 headless Chrome 註冊；建了帳號要跟使用者說）。
