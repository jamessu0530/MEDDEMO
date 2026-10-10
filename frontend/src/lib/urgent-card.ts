import type { RouteUrgent } from "@/api/route"

/**
 * 首頁最上面「需立即處理」那張卡要怎麼顯示（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈點站就騎〉）。
 * latest：行程上現在的急件；held：剛點了急件那一站、arrive 回來把它拿掉時留下的那一張；riding：熊還在騎。
 * 點的就是急件那一站時，卡片馬上不見的話整條路線會在熊騎到一半往上跳約 450px，看起來像熊從上面飛下來，
 * 所以騎的時候留著（stale：那一站已經到過，三顆鈕不能按），熊到了再收起來（closing）。
 * 行程上又有急件就照新的；三顆鈕、重新載入拿掉的不會有 held，跟以前一樣馬上不見。
 */
export function urgentCard(
  latest: RouteUrgent | null,
  held: RouteUrgent | null,
  riding: boolean
): { urgent: RouteUrgent; stale: boolean; closing: boolean } | null {
  if (latest) return { urgent: latest, stale: false, closing: false }
  if (!held) return null
  return { urgent: held, stale: true, closing: !riding }
}
