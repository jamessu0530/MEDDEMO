import type { LegMode } from "@/api/route"
import { rideCity, type RideCity } from "@/lib/rides"
import { LEG_MODES } from "@/lib/travel-mode"

/*
 * 播過哪幾段、還沒送出去的騎乘記錄，都記在 localStorage。
 * 瀏覽器不讓存或存的東西壞了，一律當作空的，不能讓動畫或首頁壞掉。
 */

export type QueuedRide = { city: RideCity; mode: LegMode }

const PLAYED_PREFIX = "meddemo:rides-played:"
// 舊的播放記錄最多留幾份（每份是一個行程）
const PLAYED_KEEP = 3
const playedKey = (scope: string) => `${PLAYED_PREFIX}${scope}`

/** 播放記錄的範圍：日期加行程編號。重置示範行程會換編號，之前播過的就不再算數 */
export const playedScope = (date: string, id: number) => `${date}:${id}`
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

export function readPlayed(scope: string): Set<string> {
  return new Set(readList(playedKey(scope)).filter((item): item is string => typeof item === "string"))
}

export function markPlayed(scope: string, key: string) {
  const played = readPlayed(scope)
  played.add(key)
  write(playedKey(scope), [...played])
  prunePlayed(scope)
}

/** 別的行程留下的播放記錄只留最近幾份，免得 localStorage 一直長 */
function prunePlayed(current: string) {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(PLAYED_PREFIX) && key !== playedKey(current)) keys.push(key)
    }
    // 日期在前、編號在後：照字串排序，新的在後面（編號位數不同時差一點無妨，只是多留或少留舊的）
    keys.sort().slice(0, Math.max(keys.length - (PLAYED_KEEP - 1), 0)).forEach((key) => localStorage.removeItem(key))
  } catch {
    // 清不掉就算了
  }
}

/** 縣市在七個縣市裡、交通方式是四種之一才算（存的東西壞了或舊版留下的，丟掉，免得整批被後端退回） */
function isQueuedRide(item: unknown): item is QueuedRide {
  const ride = item as Partial<QueuedRide> | null
  return (
    typeof ride === "object" &&
    ride !== null &&
    typeof ride.city === "string" &&
    rideCity(ride.city) !== null &&
    typeof ride.mode === "string" &&
    (LEG_MODES as readonly string[]).includes(ride.mode)
  )
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
