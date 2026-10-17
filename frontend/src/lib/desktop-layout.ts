/**
 * 電腦版（docs/superpowers/specs/2026-10-09-desktop-layout-design.md）：寬度到這裡以上換成側邊欄與寬版版面，以下照手機。
 * 側邊欄展開 14rem、收合 4rem：用 --app-sidebar-width 對齊內容與固定元件。
 */
export const DESKTOP_QUERY = "(min-width: 1024px)"
// 頻道的記憶看板另外一欄：1024 扣掉側邊欄、頻道列與頻道內容，對話只剩兩百多 px，到 1280 才放得下
export const WIDE_QUERY = "(min-width: 1280px)"

export type PageWidth = "wide" | "column" | "bare"

// 不畫側邊欄、照手機的寬度置中：沒登入的頁，和錄音（跟手機一樣，錄到一半不能誤點離開）
const BARE = [/^\/login$/, /^\/register$/, /^\/privacy$/, /^\/auth\//, /^\/customers\/[^/]+\/record$/]
// 自己排成兩欄以上的頁；其他頁放在中間一欄
const WIDE = [/^\/$/, /^\/orders(\/[^/]+)?$/, /^\/route$/, /^\/calendar$/, /^\/channels$/, /^\/channels\/\d+$/, /^\/manager$/, /^\/reports$/, /^\/mascots$/, /^\/customers\/[^/]+$/, /^\/customers\/[^/]+\/quote$/]
// 電腦版頻道四欄那一頁的網址：/channels 與 /channels/:id 換來換去只是換欄，不播換頁的墨
const CHANNEL_PANES = /^\/channels(\/\d+)?$/

/** 對齊中間一欄的固定元件（底部的輸入列、按鈕列）：手機照舊是置中的手機寬度 */
export const FIXED_COLUMN = "fixed inset-x-0 mx-auto max-w-md lg:left-[var(--app-sidebar-width)] lg:max-w-2xl"

/** 首頁電腦版底部的固定元件（問熊熊滾的輸入列、提案卡）：對齊路線欄（側邊欄目前寬度 ＋ main 的 1.5rem）。
 * 並排時寬 27.5rem，空間不足時由首頁設定成整個內容欄。
 * 跟手機的 class 寫在一起用：只蓋掉電腦版的位置與寬度 */
export const HOME_LEFT_FIXED = "lg:right-auto lg:left-[calc(var(--app-sidebar-width)+1.5rem)] lg:mx-0 lg:w-[var(--home-route-width,27.5rem)] lg:max-w-none lg:px-0"

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
