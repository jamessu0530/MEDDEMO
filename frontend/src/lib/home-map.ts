import type { MapStop, RouteStop, TodayMap, TravelMode } from "@/api/route"
import type { LatLng } from "@/api/team-routes"
import { NAVIGATION_MODE } from "@/lib/travel-mode"

/*
 * 首頁「地圖」分頁的文字（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈業務首頁的地圖〉）。
 * 純函式，畫面（components/route/home-map.tsx、map-stop-card.tsx）只負責排版。
 */

/** 「導航」：照業務的交通方式打開 Google 地圖導航到這一站；手機上有裝 Google 地圖就直接開 App。只是一個網址，不用金鑰 */
export function navigationUrl({ lat, lng }: LatLng, mode: TravelMode) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=${NAVIGATION_MODE[mode]}`
}

/** 地圖下面那張卡寫哪一站：點過的那一站；沒點過、或點的那一站已經不在行程裡（換版了）就是下一站。
 *  都跑完了也沒點是 null，不放卡片 */
export function shownStop(map: TodayMap, pickedId: string | null): MapStop | null {
  return (
    map.stops.find((stop) => stop.customer_id === pickedId) ?? map.stops.find((stop) => stop.status === "next") ?? null
  )
}

/** 卡片第一行：「下一站 · 第 2 站 · 11:00 到」「第 3 站 · 13:30 到」「第 1 站 · 09:10 完成」。
 *  時間是首頁的行程裡那一站的；找不到（地圖跟行程差了一版）就只寫第幾站 */
export function stopHeading(stop: MapStop, detail: RouteStop | undefined) {
  const parts = [`第 ${stop.number} 站`]
  if (stop.status === "next") parts.unshift("下一站")
  if (detail) parts.push(`${detail.planned_time} ${stop.status === "done" ? "完成" : "到"}`)
  return parts.join(" · ")
}
