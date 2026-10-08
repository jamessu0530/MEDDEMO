import { ApiError, jsonBody, request } from "@/api/client"
import type { LegMode } from "@/api/route"
import { queueRides, takeQueuedRides, type QueuedRide } from "@/lib/ride-memory"
import type { RideCity } from "@/lib/rides"

export type RideCityName = RideCity

export type VehicleItem = { city: RideCityName; mode: LegMode; ridden_at: string | null }

export type Vehicles = { total: number; ridden: number; items: VehicleItem[] }

// 後端一次最多收 4 台
const BATCH = 4

/** 座騎圖鑑：七個縣市 × 四種交通方式，騎過的有時間 */
export function getVehicles(signal?: AbortSignal) {
  return request<Vehicles>("/api/vehicles", { signal })
}

/**
 * 送出騎過的座騎：先前送不出去的（localStorage）跟這次的併在一起，同縣市同交通方式只留一台，
 * 一次最多 4 台所以分批送。網路錯誤或 5xx 就把還沒確定送到的全部存回去，不丟例外，下次打開首頁再送；4xx 的那一批丟掉。
 */
export async function sendRides(rides: QueuedRide[]): Promise<void> {
  const seen = new Set<string>()
  const pending = [...takeQueuedRides(), ...rides].filter((ride) => {
    const key = `${ride.city}|${ride.mode}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  for (let i = 0; i < pending.length; i += BATCH) {
    try {
      await request<void>("/api/vehicles/rides", jsonBody("POST", { rides: pending.slice(i, i + BATCH) }))
    } catch (error) {
      // 4xx（422 有不合法的項目、403 不是業務）重送也一樣被退回：丟掉這一批，不要永遠留在佇列裡。
      // 401（登入過期，重新登入後還送得了）、408、429 是暫時的，跟網路錯誤、5xx 一樣存回去下次再送
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status)) continue
      queueRides(pending.slice(i))
      return
    }
  }
}
