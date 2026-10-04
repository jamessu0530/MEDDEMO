import { request } from "@/api/client"

// 主管端的行程分頁（後端 api/manager.py 的 /api/manager/itineraries）：只能看、只看今天。
// 站的狀態與來源跟業務首頁同一套（後端 services/itinerary.py），這裡自己寫一份，不跟業務那邊的型別綁在一起
export type StopStatus = "done" | "next" | "todo"
// model：系統早上排的；rep：業務自己加的；ai：跟熊熊滾說加的；ask：問答頁「排入今天的路線」
export type StopSource = "model" | "rep" | "ai" | "ask"

export type LatLng = { lat: number; lng: number }

export type TeamStop = LatLng & {
  // 第幾站，1 起算，已完成的在前
  number: number
  customer_id: string
  customer_name: string
  area: string
  status: StopStatus
  // 已完成的是拜訪時間，其他是排出來的到達時間
  planned_time: string
  duration_minutes: number
  late_minutes: number
  source: StopSource
  signal: string
  reason: string
  // 約的時間：at 幾點到、before 幾點以前、after 幾點以後
  window_kind: "at" | "before" | "after" | null
  window_time: string | null
}

// 沿路的一段：polyline 是 Google 的編碼折線，沒有（沒設金鑰、Google 失敗）就畫直線；done 是開到的那一站跑完了
export type TeamLeg = { polyline: string | null; done: boolean }

// 系統早上排了、現在不在行程裡的站
export type RemovedStop = LatLng & {
  customer_id: string
  customer_name: string
  area: string
  // 系統排它的理由類別（「帳款逾期」）
  label: string
  reason: string
}

// 主管看到的位置（後端 services/locations.describe）：一句話，加上地圖上頭像畫在哪（沒有就不畫）；
// live 是分享中而且 5 分鐘內有更新，不然頭像是灰的
export type SeenLocation = { text: string; lat: number | null; lng: number | null; at: string | null; live: boolean }

export type RepRoute = {
  rep: { id: string; name: string; region: string }
  version: number
  done: number
  total: number
  travel_minutes: number
  travel_km: number
  finish_time: string | null
  // 車程是直線估算的
  estimated: boolean
  // 區處辦公室，路線從這裡畫起；還沒有位置的區是 null
  origin: LatLng | null
  stops: TeamStop[]
  legs: TeamLeg[]
  removed: RemovedStop[]
  // 自己加的（店名）
  added: string[]
  // 「德安藥局提到佑生藥局前面」
  moved: string[]
  untouched: boolean
  location: SeenLocation
}

export type TeamRoutes = {
  date: string
  // 台北時間 HH:MM
  updated_at: string
  // 主管是自己那一區（「北區」），IT 是「全公司」
  scope: string
  reps: RepRoute[]
}

export function getTeamRoutes(signal?: AbortSignal) {
  return request<TeamRoutes>("/api/manager/itineraries", { signal })
}

export function getRepRoute(userId: string, signal?: AbortSignal) {
  return request<RepRoute>(`/api/manager/itineraries/${encodeURIComponent(userId)}`, { signal })
}

export type TeamLocations = { updated_at: string; locations: Record<string, SeenLocation> }

/** 只拿位置：收到位置的通知時用，不重算行程、不問 Google */
export function getTeamLocations(signal?: AbortSignal) {
  return request<TeamLocations>("/api/manager/locations", { signal })
}
