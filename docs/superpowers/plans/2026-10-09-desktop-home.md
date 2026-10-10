# 電腦版首頁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 電腦版（≥1024px）的今日路線：路線在左欄、地圖在右邊固定不動，不用切換；問熊熊滾的輸入列與提案卡貼著左欄底部；頁首那排已經搬進側邊欄的按鈕收起來。手機完全不變。

**Architecture:** 照 `docs/superpowers/specs/2026-10-09-desktop-layout-design.md`〈今日路線〉。`pages/today.tsx` 只在電腦版多包一層兩欄、`onMap` 在電腦版恆為 false（路線一律畫在左欄，自動騎乘照舊），地圖另外畫在右欄。固定在底部的元件多一個「放在哪一欄」的設定。

**Tech Stack:** React 19、Tailwind 4。

**協調：** 「點站就騎過去與個人頁」（`.worktrees/tap-ride`）與「位置分享只問同意」（`.claude/worktrees/location-consent-only`）都還沒推，也在改 `pages/today.tsx`、`components/route/*`。使用者決定不等它們（2026-10-09）。這份計畫在 `today.tsx` 只動版面的幾個地方，不碰騎乘、小卡、位置分享的邏輯，讓那兩件之後 rebase 時好合。

## Global Constraints

- 斷點 `lg`（1024px）。側邊欄 14rem（`lg:left-56`）；寬版頁的 main 左右留 `lg:px-6`（1.5rem）；首頁左欄寬 27.5rem。
- 手機（<1024px）一個像素都不改：只用 `lg:` 或 `useIsDesktop()` 的分支。
- 畫面上不用 emoji；註解、畫面文字繁體中文；commit 英文祈使句加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 前端約 120 欄寬，不跑 `prettier --write`。CI：`npm run lint`、`npm run typecheck`、`npm test`。
- iCloud：`git add` 前看有沒有 `* 2.*` 重複檔；不要 commit `frontend/vite.desktop.config.ts`、`backend/.env`。

---

### Task 1: 首頁兩欄

**Files:**
- Modify: `frontend/src/lib/desktop-layout.ts`（左欄固定元件的 class）
- Modify: `frontend/src/components/route/home-ask.tsx`、`frontend/src/components/route/proposal-sheet.tsx`、`frontend/src/components/route/habit-prompt.tsx`
- Modify: `frontend/src/components/route/home-map-panel.tsx`（電腦版的高度）
- Modify: `frontend/src/pages/today.tsx`
- Test: `frontend/src/components/route/proposal-sheet.test.ts`（已存在，加一個 placement 的案例）

**Interfaces:**
- Produces: `HOME_LEFT_FIXED: string`、`FIXED_COLUMN` 不變；`ProposalSheet` 多一個選填的 `placement?: "column" | "home"`（預設 `"column"`）。

- [ ] **Step 1: 左欄固定元件的 class**

`lib/desktop-layout.ts` 的 `FIXED_COLUMN` 下面加：

```ts
/** 首頁電腦版左欄底部的固定元件（問熊熊滾的輸入列、提案卡）：對齊左欄（側邊欄 14rem ＋ main 的 1.5rem，寬 27.5rem）。
 * 跟手機的 class 寫在一起用：只蓋掉電腦版的位置與寬度 */
export const HOME_LEFT_FIXED = "lg:right-auto lg:left-[15.5rem] lg:mx-0 lg:w-[27.5rem] lg:max-w-none lg:px-0"
```

- [ ] **Step 2: 提案卡可以放在左欄或中間一欄**

`components/route/proposal-sheet.tsx`：`ProposalSheetProps` 加

```ts
  // 電腦版放哪裡：首頁貼著左欄底部（home），調整行程頁對齊中間一欄（column，預設）
  placement?: "column" | "home"
```

元件參數加 `placement = "column"`，dialog 那個 div 的 className 改成：

```tsx
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 mx-auto max-w-md animate-in px-2.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] duration-200 slide-in-from-bottom-4 motion-reduce:animate-none",
          placement === "home" ? cn(HOME_LEFT_FIXED, "lg:bottom-4 lg:pb-0") : "lg:left-56 lg:max-w-2xl"
        )}
```

（`cn`、`HOME_LEFT_FIXED` 補 import。）`proposal-sheet.test.ts` 加一個案例：`placement: "home"` 的輸出含 `lg:left-[15.5rem]`、不給 placement 的含 `lg:left-56`（照檔案裡現有的 render 寫法）。

- [ ] **Step 3: 問熊熊滾的輸入列與排序習慣的提示**

`components/route/home-ask.tsx`：外層 div 的 className 改成

```tsx
      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-md px-2.5",
          // 電腦版沒有底部分頁列：貼著左欄底部
          HOME_LEFT_FIXED,
          "lg:bottom-4"
        )}
      >
```

`<ProposalSheet … />` 加 `placement="home"`。註解第一行改成「首頁路線下面固定的『跟熊熊滾說要怎麼排…』（手機在底部分頁膠囊上面，電腦版貼著左欄底部）」。

`components/route/habit-prompt.tsx`（調整行程頁用的，中間一欄）：dialog 的 className 最後加 `lg:left-56 lg:max-w-2xl`。

- [ ] **Step 4: 地圖在電腦版填滿右欄的高度**

`components/route/home-map-panel.tsx` 的 `HEIGHT`：

```ts
// 地圖填滿固定的頁首與底部輸入列中間（切換捲到頁首正下面時）：一打開就看到整條路線和底下的卡。
// 頁首的高度由首頁量好放在 --home-header（有沒有位置分享列、字放多大都不一樣）；12rem 是切換本身加上底部的輸入列與分頁列。
// 電腦版地圖在右欄、固定在頁首下面：高度是視窗扣掉頁首，上下各留 0.75rem
const HEIGHT = "h-[calc(100svh-var(--home-header,12rem)-12rem)] min-h-72 lg:h-[calc(100svh-var(--home-header,8rem)-1.5rem)]"
```

- [ ] **Step 5: `pages/today.tsx`**

1. import `useIsDesktop`（`@/lib/use-media-query`）；`TodayPage` 開頭的 hook 那一排加 `const desktop = useIsDesktop()`（在 `if (!user) return null` 之前）。
2. `onMap` 改成電腦版恆為 false（電腦版路線一律在左欄，地圖另外畫在右欄；自動騎乘照 `!onMap` 判斷，所以電腦版照常騎）：

```tsx
  // 路線／地圖：沒有站、或用的是手機上的舊行程（連不上，地圖也載不到）就只有路線。電腦版兩個並排，不用切換
  const mappable = state.status === "ready" && !state.cached && state.route.stops.length > 0
  const onMap = !desktop && mappable && params.get("view") === "map"
```

3. 頁首第一列（頭像、名字、旗子、鈴鐺、申請單、深色）的那個 div 加 `lg:hidden`（電腦版這些都在側邊欄）：`className="-mr-2 flex items-center justify-between gap-2 lg:hidden"`；橫幅的 `mt-1` 改成 `mt-1 lg:mt-0`。
4. 今日進度的旗子在電腦版改放在橫幅上：在橫幅裡 `{state.status === "ready" && !state.cached && <EditRouteLink />}` 前面加

```tsx
          {/* 電腦版頁首第一列收起來了，今日進度放在橫幅右邊 */}
          {route && route.total > 0 && (
            <span className="hidden items-center gap-1 px-4 text-sm font-semibold tabular-nums lg:flex">
              <Flag className="size-5 fill-current" />
              <span className="sr-only">今日進度</span>
              {route.done}/{route.total}
            </span>
          )}
```

5. `<main>` 改成兩欄：className 加上電腦版

```tsx
      <main className="flex-1 overflow-x-clip px-4 pt-3 pb-48 lg:flex lg:items-start lg:gap-6 lg:px-6 lg:pb-24">
```

（電腦版沒有底部分頁列，`lg:pb-24` 只替左欄底部的輸入列留位置。）把 `<main>` 裡原本的全部內容包進 `<div className="lg:w-[27.5rem] lg:shrink-0">…</div>`（內容一字不改），並在這個 div 後面、`</main>` 前面加右欄：

```tsx
        {/* 電腦版：地圖在右欄，固定在頁首下面；沒有站或用的是舊行程就不畫 */}
        {desktop && mappable && route && (
          <div className="sticky top-[calc(var(--home-header,8rem)+0.75rem)] min-w-0 flex-1">
            <HomeMapPanel
              route={route}
              userId={user.id}
              onRoute={(next) => setState({ status: "ready", route: next, cached: false })}
            />
          </div>
        )}
```

6. 路線／地圖切換在電腦版不畫：`{mappable && <ViewSwitch … />}` 改成 `{mappable && !desktop && <ViewSwitch … />}`。

- [ ] **Step 6: 檢查**

Run: `cd frontend && npm test && npm run lint && npm run typecheck && npm run build`
Expected: 全過。

用隔離環境（scratchpad 的 ENV.md、`shot.mjs`）以 U01 截：

- 1440x900 `/`：左欄路線、右欄地圖（沒有 Google 金鑰會是一行說明，位置對就好）、沒有路線／地圖切換、橫幅右邊有旗子、頁首沒有頭像那一列、輸入列在左欄底部。深色一張。
- 1024x768 `/`：左欄沒被擠壞。
- 1440x900 `/route/edit`：提案卡、排序習慣的提示（如果點得出來）對齊中間一欄；點不出來就寫在報告裡。
- 390x844 `--full --wait=5000` 的 `/` 與 `/?view=map`，跟改之前（先在動程式前截一份 `shots/home/before-*.png`）比：一樣。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/desktop-layout.ts frontend/src/components/route/home-ask.tsx frontend/src/components/route/proposal-sheet.tsx frontend/src/components/route/proposal-sheet.test.ts frontend/src/components/route/habit-prompt.tsx frontend/src/components/route/home-map-panel.tsx frontend/src/pages/today.tsx
git commit -m "Lay out today's route beside its map on desktop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
