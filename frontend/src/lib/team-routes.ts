import type { LatLng, RemovedStop, RepRoute, StopSource, TeamRoutes, TeamStop } from "@/api/team-routes"
import { formatDayLabel } from "@/lib/format"
import { avatarTone } from "@/lib/presence"

/*
 * 主管端行程分頁的文字與地圖資料（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈主管端：行程分頁〉）。
 * 純函式，畫面（components/manager/）只負責排版。
 */

// 路線的顏色跟頭像底色同一套、同一個順序（components/user-avatar.tsx 的 TONES）：地圖上的線一看就知道是誰。
// 寫成 CSS 變數，深色配色下跟著換；Google 地圖的線畫在 canvas 上，要用時再換成實際的顏色
export const ROUTE_COLOR_VARS = ["--primary", "--chart-4", "--chart-5", "--warning", "--muted-foreground"] as const

export function routeColorVar(userId: string) {
  return ROUTE_COLOR_VARS[avatarTone(userId, ROUTE_COLOR_VARS.length)]
}

/** 總覽的頁首：「10/28（三）· 北區 2 位業務 · 11:02 更新」 */
export function headerLine(data: TeamRoutes) {
  // 全形括號後面本來就有空白，「·」前面不再空一格（設計文件的寫法）
  return `${formatDayLabel(data.date)}· ${data.scope} ${data.reps.length} 位業務 · ${data.updated_at} 更新`
}

/** 「1/3 站 · 共 18.2 公里 · 約 16:40 收工」。公里數跟業務自己看到的總里程同一個數字；跑完了就沒有收工時間 */
export function progressLine(route: RepRoute) {
  const parts = [`${route.done}/${route.total} 站`, `共 ${route.travel_km} 公里`]
  if (route.finish_time) parts.push(`約 ${route.finish_time} 收工`)
  return parts.join(" · ")
}

/** 「下一站：第 2 站 德安藥局 · 大安 · 10:40 到」；都跑完了是 null */
export function nextStopLine(stops: TeamStop[]) {
  const next = stops.find((stop) => stop.status === "next")
  return next ? `下一站：第 ${next.number} 站 ${next.customer_name} · ${next.planned_time} 到` : null
}

/** 紅字：「拿掉系統排的 1 站：和康藥局 · 松山（帳款逾期）」 */
export function removedLine(removed: RemovedStop[]) {
  if (!removed.length) return null
  return `拿掉系統排的 ${removed.length} 站：${removed.map((stop) => `${stop.customer_name}（${stop.label}）`).join("、")}`
}

/** 琥珀色：還沒跑、約的時間趕不上的站。「1 站會晚到 25 分鐘」；兩站以上「2 站會晚到，最多 25 分鐘」 */
export function lateLine(stops: TeamStop[]) {
  const late = stops.filter((stop) => stop.status !== "done" && stop.late_minutes > 0)
  if (!late.length) return null
  const most = Math.max(...late.map((stop) => stop.late_minutes))
  return late.length === 1 ? `1 站會晚到 ${most} 分鐘` : `${late.length} 站會晚到，最多 ${most} 分鐘`
}

/** 85 → 「1 小時 25 分」 */
export function formatDriveTime(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest} 分`
  return rest ? `${hours} 小時 ${rest} 分` : `${hours} 小時`
}

/** 詳細頁地圖下面那一行：「共 18.2 公里 · 車程 1 小時 25 分（Google 道路車程）」或「（估計）」 */
export function totalsLine(route: RepRoute) {
  const source = route.estimated ? "（估計）" : "（Google 道路車程）"
  return `共 ${route.travel_km} 公里 · 車程 ${formatDriveTime(route.travel_minutes)}${source}`
}

/** 約的時間：「約 11:00 到」「11:00 以前到」「14:00 以後到」 */
export function windowLabel(stop: TeamStop) {
  if (!stop.window_kind || !stop.window_time) return null
  if (stop.window_kind === "at") return `約 ${stop.window_time} 到`
  return `${stop.window_time} ${stop.window_kind === "before" ? "以前" : "以後"}到`
}

// 這一站是誰排進來的；系統排的不另外標
export const SOURCE_LABEL: Record<StopSource, string> = {
  model: "系統排的",
  rep: "自己加的",
  ai: "跟熊熊滾說加的",
  ask: "問答加的",
}

/** Google 的編碼折線（Encoded Polyline Algorithm Format）解成經緯度 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    const deltas: number[] = []
    for (let axis = 0; axis < 2; axis += 1) {
      let result = 0
      let shift = 0
      let byte: number
      do {
        byte = encoded.charCodeAt(index) - 63
        index += 1
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      deltas.push(result & 1 ? ~(result >> 1) : result >> 1)
    }
    lat += deltas[0]
    lng += deltas[1]
    points.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }
  return points
}

/** 地圖要框住的範圍；沒有任何點是 null */
export function boundsOf(points: LatLng[]) {
  if (!points.length) return null
  const lats = points.map((point) => point.lat)
  const lngs = points.map((point) => point.lng)
  return { north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lngs), west: Math.min(...lngs) }
}

/** 一位業務沿路的每一段要畫的點：有折線用折線，沒有就從上一點直接連到這一站。
 *  第 n 段從「出發點加各站」的第 n 點開到第 n + 1 點（後端 services/team_itineraries.py 同一個規則） */
export function legPaths(route: RepRoute) {
  const points: LatLng[] = [
    ...(route.origin ? [route.origin] : []),
    ...route.stops.map(({ lat, lng }) => ({ lat, lng })),
  ]
  return route.legs.map((leg, n) => ({
    done: leg.done,
    path: leg.polyline ? decodePolyline(leg.polyline) : [points[n], points[n + 1]],
  }))
}
