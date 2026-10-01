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

export type WindowKind = "at" | "before" | "after"

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
  // 約的時間：at 幾點到、before 以前、after 以後；沒約是 null
  window_kind: WindowKind | null
  window_time: string | null
  note: string | null
  // 排順路時位置不動
  locked: boolean
  // 套用在這一站的習慣，調整清單的卡片上標綠色「習慣」
  habit_ids: number[]
}

export type RouteRule = {
  id: string
  text: string
  kind: "precedence" | "first" | "last"
  // today：今天設的先後；habit：習慣；new：這次答應要記、按「完成」才存的習慣
  source: "today" | "habit" | "new"
  // precedence 是 [前, 後]；同一條習慣拆成好幾組時 id 相同
  customer_ids: string[]
}

export type Precedence = { before: string; after: string }

export type SkippedHabit = { id: number; text: string; reason: string; conflict: boolean }

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
  // 調整清單要守的規則（今天的先後與習慣；鎖住的不列）與目前的順序違反了哪幾條
  rules: RouteRule[]
  violations: string[]
  precedences: Precedence[]
  // 今天不套用的習慣；conflict 是每天建立建議時跟別的規則衝突，行程上要提示
  skipped_habits: SkippedHabit[]
}

export type RouteAction = "pin" | "snooze" | "misjudge"

export type AddStopsResult = {
  itinerary: TodayRoute
  added: string[]
  skipped: { customer_id: string; customer_name: string; reason: string }[]
}

export type HabitTarget = { by: "customer" | "chain" | "type" | "area"; value: string }

export type HabitKind = "precedence" | "first" | "last" | "window" | "duration"

// 一條習慣的欄位（新增習慣、調整清單上答應要記的都是這個樣子）。object 只有先後用
export type HabitDraft = {
  kind: HabitKind
  subject: HabitTarget
  object: HabitTarget | null
  window_kind: WindowKind | null
  window_time: string | null
  duration_minutes: number | null
  // 0 是星期一；null 是每天
  weekday: number | null
  // 紅框上按了「今天不套用這條」：照樣記下來，只是今天不套用
  skip_today?: boolean
}

export type DraftStop = Pick<RouteStop, "customer_id" | "duration_minutes" | "window_kind" | "window_time" | "note" | "locked">

// 調整清單上改到一半的行程：還沒跑的站照畫面上的順序
export type RouteDraft = {
  stops: DraftStop[]
  precedences: Precedence[]
  skipped_habit_ids: number[]
  habits: HabitDraft[]
}

export type RouteCandidate = {
  customer_id: string
  customer_name: string
  type: "chain" | "independent" | "clinic"
  area: string
  // 順路的才有：目前的理由類別、插在第幾站後（0 是排第一站）、估算多繞幾分鐘
  signal: RouteSignal | null
  after_stop: number | null
  extra_minutes: number | null
}

export type RouteCandidates = { nearby: RouteCandidate[]; others: RouteCandidate[]; full: boolean }

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

/** 調整清單上的草稿算時間、車程與違反的規則，不存；insert 是「加一站」點的那一家 */
export function previewToday(draft: RouteDraft, insert?: string, signal?: AbortSignal) {
  return request<TodayRoute>("/api/itinerary/today/preview", {
    ...jsonBody("POST", { ...draft, insert: insert ?? null }),
    signal,
  })
}

/** 調整清單按「完成」：一次存進去；行程剛被改過回 409 */
export async function saveToday(userId: string, version: number, draft: RouteDraft) {
  const route = await request<TodayRoute>("/api/itinerary/today", jsonBody("PUT", { ...draft, version }))
  writeCache(routeKey(userId), route)
  return route
}

/** 加一站的候選：順路的前幾家（估算多繞幾分鐘）與其他客戶。order、locked 是草稿上還沒跑的站與鎖住的站 */
export function getCandidates(order: string[], locked: string[], signal?: AbortSignal) {
  const query = new URLSearchParams({ order: order.join(","), locked: locked.join(",") })
  return request<RouteCandidates>(`/api/itinerary/today/candidates?${query}`, { signal })
}

/** 還沒跑的站數（不算剛回寫完的那一家）；回寫完成頁的「回今日路線 · 還有 N 站」用 */
export function remainingStops(userId: string, exceptCustomerId?: string) {
  const cached = readCache<TodayRoute>(routeKey(userId))
  if (!cached) return null
  return cached.stops.filter((stop) => stop.status !== "done" && stop.customer_id !== exceptCustomerId).length
}
