// 讀不到 CSS 變數時用主色
const FALLBACK_COLOR = "#9B51E0"

/** CSS 變數換成實際的顏色：Google 地圖的線畫在 canvas 上，不認 var(--primary) */
export function cssColor(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || FALLBACK_COLOR
}
