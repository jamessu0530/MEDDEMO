import type { LegMode, RouteStop } from "@/api/route"
import { legFrom } from "@/lib/travel-mode"

/**
 * 熊熊滾的座騎（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md〈座騎〉）：七個縣市各一種特產，
 * 四種交通方式各變成一種座騎。這裡只放縣市；座騎的圖在 components/rides。縣市名稱照資料庫的 customer.city。
 */
export const RIDE_CITIES = ["台北市", "新北市", "新竹市", "台中市", "彰化縣", "台南市", "高雄市"] as const

export type RideCity = (typeof RIDE_CITIES)[number]

/** 每個縣市的特產：座騎就是它變的 */
export const SPECIALTY: Record<RideCity, string> = {
  台北市: "小籠包",
  新北市: "天燈",
  新竹市: "貢丸",
  台中市: "珍珠奶茶",
  彰化縣: "肉圓",
  台南市: "虱目魚",
  高雄市: "香蕉",
}

/** 有座騎的縣市；其他（或沒有）是 null，熊熊滾就自己走過去 */
export function rideCity(city: string | null | undefined): RideCity | null {
  return (RIDE_CITIES as readonly string[]).includes(city ?? "") ? (city as RideCity) : null
}

/** 一段路：from 是 null 代表從辦公室出發；fromCity 是出發那一站（或辦公室）的縣市 */
export type Leg = { from: string | null; to: string; fromCity: string | null; toCity: string; mode: LegMode }

/** 到第 index 站的那一段：從上一站出發，第一站從辦公室（縣市用 startCity） */
export function legInto(stops: RouteStop[], index: number, startCity: string | null): Leg {
  return {
    from: legFrom(stops, index),
    to: stops[index].customer_id,
    fromCity: index === 0 ? startCity : stops[index - 1].city,
    toCity: stops[index].city,
    mode: stops[index].travel_mode,
  }
}

/** 兩端都是七個縣市之一而且不一樣才算跨縣市；有一端不認得就不算 */
export function crossesCity(leg: Leg): boolean {
  const from = rideCity(leg.fromCity)
  const to = rideCity(leg.toCity)
  return from !== null && to !== null && from !== to
}

/** 播過哪幾段的記號 */
export function legKey(leg: Leg): string {
  return `${leg.from ?? "office"}>${leg.to}`
}

// 第一個還沒跑的站（跑完的站排在前面）；全部跑完是 -1
const firstOpen = (stops: RouteStop[]) => stops.findIndex((stop) => stop.status !== "done")

/** 停著的那台是哪一段：到「下一站」的那一段；全部跑完是 null */
export function parkedLeg(stops: RouteStop[], startCity: string | null): Leg | null {
  const index = firstOpen(stops)
  return index < 0 ? null : legInto(stops, index, startCity)
}

/** 現在該播哪一段：剛完成一站是「最後完成的站 → 下一站」，今天第一次打開是「辦公室 → 第 1 站」；播過了或沒得播是 null */
export function legToPlay(
  stops: RouteStop[],
  { played, officeStart, startCity }: { played: Set<string>; officeStart: boolean; startCity: string | null }
): Leg | null {
  const index = firstOpen(stops)
  if (index < 0 || (index === 0 && !officeStart)) return null
  const leg = legInto(stops, index, startCity)
  return played.has(legKey(leg)) ? null : leg
}

/** 這一段算騎過哪幾台：目的地縣市那一台，跨縣市再加出發縣市那一台；不在七個縣市裡的不算 */
export function ridesOf(leg: Leg): { city: RideCity; mode: LegMode }[] {
  const rides: { city: RideCity; mode: LegMode }[] = []
  const to = rideCity(leg.toCity)
  if (to) rides.push({ city: to, mode: leg.mode })
  const from = rideCity(leg.fromCity)
  if (from && crossesCity(leg)) rides.push({ city: from, mode: leg.mode })
  return rides
}
