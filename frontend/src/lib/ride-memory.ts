import type { LegMode } from "@/api/route"
import type { RideCity } from "@/lib/rides"

/*
 * 播過哪幾段、還沒送出去的騎乘記錄，都記在 localStorage。
 * 瀏覽器不讓存或存的東西壞了，一律當作空的，不能讓動畫或首頁壞掉。
 */

export type QueuedRide = { city: RideCity; mode: LegMode }

const playedKey = (date: string) => `meddemo:rides-played:${date}`
const QUEUE_KEY = "meddemo:rides-queue"

function readList(key: string): unknown[] {
  try {
    const raw = localStorage.getItem(key)
    const value: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 存不進去就算了，頂多下次再播一次
  }
}

export function readPlayed(date: string): Set<string> {
  return new Set(readList(playedKey(date)).filter((item): item is string => typeof item === "string"))
}

export function markPlayed(date: string, key: string) {
  const played = readPlayed(date)
  played.add(key)
  write(playedKey(date), [...played])
}

function isQueuedRide(item: unknown): item is QueuedRide {
  const ride = item as Partial<QueuedRide> | null
  return typeof ride === "object" && ride !== null && typeof ride.city === "string" && typeof ride.mode === "string"
}

/** 送不出去的騎乘記錄先存起來，跟已經存的併在一起 */
export function queueRides(rides: QueuedRide[]) {
  if (rides.length === 0) return
  write(QUEUE_KEY, [...readList(QUEUE_KEY).filter(isQueuedRide), ...rides])
}

/** 取出所有還沒送出去的記錄，同時清掉 */
export function takeQueuedRides(): QueuedRide[] {
  const rides = readList(QUEUE_KEY).filter(isQueuedRide)
  try {
    localStorage.removeItem(QUEUE_KEY)
  } catch {
    // 清不掉就算了
  }
  return rides
}
