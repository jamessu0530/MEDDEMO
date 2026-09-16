import { jsonBody, request } from "@/api/client"

// 這次專案不做登入，業務自己選身分（lib/rep.ts），路線就照這個 id 排
export type Rep = { id: string; name: string; region: string }

// 每一站為什麼被排進來。後端 today_route.SIGNAL_LABEL 有同一組，改了要一起改
export type RouteSignal = "commitment" | "ar" | "interval" | "order" | "contract" | "visit" | "routine"

export const SIGNAL_LABEL: Record<RouteSignal, string> = {
  commitment: "承諾逾期",
  ar: "帳款",
  interval: "間隔拉長",
  order: "很久沒進貨",
  contract: "合約快到期",
  visit: "很久沒去",
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
}

export type TodayRoute = {
  date: string
  rep: { id: string; name: string }
  done: number
  total: number
  urgent: RouteUrgent | null
  stops: RouteStop[]
}

// 業務按「插入下一站」「暫緩」「誤判」累積的調整，存在手機裡（lib/route-feedback.ts），要路線時一起送出
export type RouteFeedback = {
  snoozed: { customer_id: string; until: string }[]
  pinned: string[]
  signal_weights: Partial<Record<RouteSignal, number>>
}

// 跟客戶清單一樣（FR-4.3）：載入成功就記在手機裡，路上沒訊號時至少看得到上次那份
const REPS_CACHE_KEY = "meddemo:reps"
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

/** 業務名單（選身分用，不含主管）；連不上時改用上次載入的名單 */
export async function listReps(signal?: AbortSignal) {
  try {
    const reps = await request<Rep[]>("/api/reps", { signal })
    writeCache(REPS_CACHE_KEY, reps)
    return reps
  } catch (error) {
    const cached = signal?.aborted ? null : readCache<Rep[]>(REPS_CACHE_KEY)
    if (cached) return cached
    throw error
  }
}

function routeKey(userId: string) {
  return `${ROUTE_CACHE_KEY}:${userId}`
}

/** 今日路線；連不上伺服器時改用上次拿到的那份（cached 為 true，畫面上要標明） */
export async function getTodayRoute(userId: string, feedback: RouteFeedback, signal?: AbortSignal) {
  try {
    const route = await request<TodayRoute>("/api/route/today", {
      ...jsonBody("POST", { user_id: userId, feedback }),
      signal,
    })
    writeCache(routeKey(userId), route)
    return { route, cached: false }
  } catch (error) {
    const cached = signal?.aborted ? null : readCache<TodayRoute>(routeKey(userId))
    if (cached) return { route: cached, cached: true }
    throw error
  }
}

/** 還沒跑的站數（不算剛回寫完的那一家）；回寫完成頁的「回今日路線 · 還有 N 站」用 */
export function remainingStops(userId: string, exceptCustomerId?: string) {
  const cached = readCache<TodayRoute>(routeKey(userId))
  if (!cached) return null
  return cached.stops.filter((stop) => stop.status !== "done" && stop.customer_id !== exceptCustomerId).length
}
