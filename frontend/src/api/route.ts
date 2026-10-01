import { ApiError, jsonBody, request } from "@/api/client"

// 每一站為什麼被排進來。後端 today_route.SIGNAL_LABEL 有同一組，改了要一起改
export type RouteSignal = "commitment" | "ar" | "interval" | "order" | "contract" | "visit" | "opportunity" | "routine"

export const SIGNAL_LABEL: Record<RouteSignal, string> = {
  commitment: "承諾逾期",
  ar: "帳款",
  interval: "間隔拉長",
  order: "很久沒進貨",
  contract: "合約快到期",
  visit: "很久沒去",
  // 唯一一個不是警示的理由：上次想進的貨報價還沒結、進貨金額變大，去了有機會多做生意
  opportunity: "商機",
  routine: "例行",
}

// 最上面「需立即處理」那一張；今天沒有夠急的事就是 null
export type RouteUrgent = {
  customer_id: string
  customer_name: string
  signal: RouteSignal
  headline: string
  detail: string
  note: string | null
}

export type RouteStop = {
  customer_id: string
  customer_name: string
  type: "chain" | "independent" | "clinic"
  grade: string
  planned_time: string
  status: "done" | "next" | "todo"
  signal: RouteSignal
  reason: string
  visit_id: string | null
  // model：系統早上排的；rep：業務自己加的；ai：跟熊熊滾說加的；ask：問答頁「排入今天的路線」
  source: "model" | "rep" | "ai" | "ask"
  duration_minutes: number
  // 約的時間趕不上會晚到幾分鐘（第二階段才能設約的時間）
  late_minutes: number
  // 從上一站開過來；已完成的站是 null
  travel_minutes: number | null
  travel_km: number | null
}

export type TodayRoute = {
  date: string
  rep: { id: string; name: string }
  // 每改一次加一；三顆鈕送出時帶著，行程剛被別人改過後端會回 409
  version: number
  done: number
  total: number
  urgent: RouteUrgent | null
  stops: RouteStop[]
  travel_minutes: number
  travel_km: number
  finish_time: string | null
  // 車程是直線估算的
  estimated: boolean
}

export type RouteAction = "pin" | "snooze" | "misjudge"

export type AddStopsResult = {
  itinerary: TodayRoute
  added: string[]
  skipped: { customer_id: string; customer_name: string; reason: string }[]
}

// 跟客戶清單一樣（FR-4.3）：載入成功就記在手機裡，路上沒訊號時至少看得到上次那份
const ROUTE_CACHE_KEY = "meddemo:route"

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null // 瀏覽器不讓存（例如部分無痕模式）就當作沒有
  }
}

function writeCache(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 存不進去就算了，下次沒網路時只是看不到上次那份
  }
}

function routeKey(userId: string) {
  return `${ROUTE_CACHE_KEY}:${userId}`
}

/**
 * 今天的行程（存在伺服器，當天第一次讀取時照系統的建議建好）；連不上伺服器時改用上次拿到的那份（cached 為 true，畫面上要標明）。
 * 是哪一位業務由後端看 token 認，不必送 user_id；這裡的 userId 只用來分開每個人在這支手機上的快取。
 */
export async function getTodayRoute(userId: string, signal?: AbortSignal) {
  try {
    const route = await request<TodayRoute>("/api/itinerary/today", { signal })
    writeCache(routeKey(userId), route)
    return { route, cached: false }
  } catch (error) {
    // 主管沒有自己的拜訪路線（403）：這不是連不上，不能拿舊的那份出來充數
    if (error instanceof ApiError && error.status === 403) throw error
    const cached = signal?.aborted ? null : readCache<TodayRoute>(routeKey(userId))
    if (cached) return { route: cached, cached: true }
    throw error
  }
}

/** 需立即處理的三顆鈕：後端直接改今天的行程，回傳改好的那一份 */
export async function sendRouteFeedback(userId: string, customerId: string, action: RouteAction, version: number) {
  const route = await request<TodayRoute>(
    "/api/itinerary/today/feedback",
    jsonBody("POST", { customer_id: customerId, action, version })
  )
  writeCache(routeKey(userId), route)
  return route
}

/** 問答答案提到的客戶加進今天的行程，後端各自插在多繞最少的位置 */
export async function addStopsToToday(userId: string, customerIds: string[]) {
  const result = await request<AddStopsResult>(
    "/api/itinerary/today/stops",
    jsonBody("POST", { customer_ids: customerIds })
  )
  writeCache(routeKey(userId), result.itinerary)
  return result
}

/** 還沒跑的站數（不算剛回寫完的那一家）；回寫完成頁的「回今日路線 · 還有 N 站」用 */
export function remainingStops(userId: string, exceptCustomerId?: string) {
  const cached = readCache<TodayRoute>(routeKey(userId))
  if (!cached) return null
  return cached.stops.filter((stop) => stop.status !== "done" && stop.customer_id !== exceptCustomerId).length
}
