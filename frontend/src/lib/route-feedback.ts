import type { RouteFeedback, RouteSignal } from "@/api/route"

/*
 * 業務對路線的調整（插入下一站、暫緩、誤判）只存在這支手機裡，不上伺服器：
 * 後端沒有存這份回饋的地方，每次要路線時一起送出去重排。
 * key 帶登入的使用者 id，同一支手機換人登入不會撈到上一個人的調整。
 */
const KEY_PREFIX = "meddemo:route-feedback:"
// 暫緩跳過三天：足夠跳過這一趟和隔天的路線，又不會整個週期看不到這家
const SNOOZE_DAYS = 3

const EMPTY: RouteFeedback = { snoozed: [], pinned: [], signal_weights: {} }

function storageKey(userId: string) {
  return `${KEY_PREFIX}${userId}`
}

/*
 * 日期一律用後端回傳的路線日期（系統的「今天」固定在決賽日 2026-10-28），不用手機的日期。
 * 用手機的日期算出來的暫緩期限會落在今年九月，一送到後端就已經過期，按了等於沒按。
 */
function addDays(isoDay: string, days: number) {
  const date = new Date(`${isoDay}T00:00:00`)
  date.setDate(date.getDate() + days)
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

/** 這支手機記著的調整。today 有給就順手清掉過期的暫緩，不必等後端判斷 */
export function readFeedback(userId: string, today?: string): RouteFeedback {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return EMPTY
    const saved = JSON.parse(raw) as Partial<RouteFeedback>
    return {
      snoozed: (saved.snoozed ?? []).filter((item) => !today || item.until > today),
      pinned: saved.pinned ?? [],
      signal_weights: saved.signal_weights ?? {},
    }
  } catch {
    return EMPTY // 讀不到就照後端原本的順序排，不影響今天跑店
  }
}

function write(userId: string, feedback: RouteFeedback) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(feedback))
  } catch {
    // 存不進去，這次的調整只在重新排一次時生效，下次打開會回到原本的順序
  }
}

function adjust(weights: RouteFeedback["signal_weights"], signal: RouteSignal, delta: number) {
  return { ...weights, [signal]: (weights[signal] ?? 0) + delta }
}

/** 插入下一站：這家排到最前面，同一類訊號之後也排前面一點 */
export function pinCustomer(userId: string, customerId: string, signal: RouteSignal) {
  const current = readFeedback(userId)
  write(userId, {
    ...current,
    pinned: current.pinned.includes(customerId) ? current.pinned : [...current.pinned, customerId],
    signal_weights: adjust(current.signal_weights, signal, 1),
  })
}

/** 暫緩：三天內不再排這家；之前按過插入下一站就一併取消，免得兩個指示打架 */
export function snoozeCustomer(userId: string, customerId: string, today: string) {
  const current = readFeedback(userId, today)
  const until = addDays(today, SNOOZE_DAYS)
  write(userId, {
    ...current,
    snoozed: [...current.snoozed.filter((item) => item.customer_id !== customerId), { customer_id: customerId, until }],
    pinned: current.pinned.filter((id) => id !== customerId),
  })
}

/** 誤判：這類訊號之後少排一點，這家也先暫緩，免得明天又排在最前面 */
export function markMisjudged(userId: string, customerId: string, signal: RouteSignal, today: string) {
  snoozeCustomer(userId, customerId, today)
  const current = readFeedback(userId, today)
  write(userId, { ...current, signal_weights: adjust(current.signal_weights, signal, -1) })
}
