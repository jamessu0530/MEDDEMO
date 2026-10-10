import type { RouteProgress, TodayRoute } from "@/api/route"

/**
 * 點站回來的進度套到畫面上那份行程（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈API〉）：
 * 換掉每站的狀態與到過的時間、跑了幾站、需立即處理那張卡，其他（時間、車程、交通方式、版本）照原本的。
 * 進度跟手上這份對不上（同一份行程、同樣的站、同樣的順序）就回 null：別的評審剛改過路線、IT 重置了，
 * 呼叫端重新讀一次，不把狀態套錯站。
 */
export function applyProgress(route: TodayRoute, progress: RouteProgress): TodayRoute | null {
  if (progress.itinerary_id !== route.id || progress.stops.length !== route.stops.length) return null
  if (progress.stops.some((stop, n) => stop.customer_id !== route.stops[n].customer_id)) return null
  return {
    ...route,
    done: progress.done,
    total: progress.total,
    urgent: progress.urgent,
    stops: route.stops.map((stop, n) => ({
      ...stop,
      status: progress.stops[n].status,
      arrived_at: progress.stops[n].arrived_at,
    })),
  }
}
