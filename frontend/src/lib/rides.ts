import type { LegMode, RouteStop } from "@/api/route"

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

/** 一段路：from 是 null 代表從辦公室出發；fromCity 是出發那一站（或辦公室）的縣市；mode 照到的那一站排好的交通方式 */
export type Leg = { from: string | null; to: string; fromCity: string | null; toCity: string; mode: LegMode }

/** 路線上可以停熊的點：每一站的圓鈕是客戶編號，辦公室是 office（components/route-path.tsx 的 data-ride-anchor） */
export function anchorId(from: string | null): string {
  return from ?? "office"
}

// 點過的站照點的先後排（arrived_at 由早到晚）。照時間比、不照字串：小數秒的位數、時區寫法不一樣時字串順序會錯
const byArrival = (stops: RouteStop[]) =>
  stops.filter((stop) => stop.arrived_at).sort((a, b) => Date.parse(a.arrived_at!) - Date.parse(b.arrived_at!))

/** 熊熊滾停在哪：最後點的那一站；沒點過是 null（辦公室，沒有辦公室起點時第 1 站） */
export function hereOf(stops: RouteStop[]): string | null {
  return byArrival(stops).at(-1)?.customer_id ?? null
}

/**
 * 後端的「最後點的」（serverHere）變了，熊要不要跟著換過去。here 是熊現在停的（點了馬上換、不等後端），taps 是這次點過的站
 * （照點的順序，含只送 arrive、沒騎的那一下）。
 * 這支手機點過站之後，熊只聽自己的：連點兩站、前一站的 arrive 才回來時後端的是比較早點的那一站；
 * arrive 存好之後另開交易讀行程，別的評審剛點的站也會在裡面、而且是最晚的。兩種都不換，熊不退回去、不瞬間移走，
 * 別人點的站照樣打勾。只有 IT 重置（null）才跟著回辦公室。還沒點過（剛打開、重新載入）就照後端的停。
 */
export function followsServer(serverHere: string | null, here: string | null, taps: readonly string[]): boolean {
  if (serverHere === null || taps.length === 0) return serverHere !== here
  return false
}

/** 從 from（null 是辦公室）騎到 to 那一站：往回、跳站都可以。交通方式照原本排好到那一站的 */
export function legBetween(stops: RouteStop[], from: string | null, to: string, startCity: string | null): Leg {
  const target = stops.find((stop) => stop.customer_id === to)
  const origin = from === null ? null : stops.find((stop) => stop.customer_id === from)
  return {
    from,
    to,
    fromCity: from === null ? startCity : (origin?.city ?? null),
    toCity: target?.city ?? "",
    mode: target?.travel_mode ?? "drive",
  }
}

/**
 * 還沒點過站、熊停在辦公室時的座騎：辦公室縣市（沒有就第 1 站的）× 辦公室到第 1 站的交通方式。
 * 點第 1 站出發時騎的就是這一台（跨縣市半路才冒煙換），不會一起步就先換一台；沒有站是 null。不能重播。
 */
export function officeLeg(stops: RouteStop[], startCity: string | null): Leg | null {
  const first = stops[0]
  if (!first) return null
  const city = startCity ?? first.city ?? ""
  return { from: null, to: first.customer_id, fromCity: city, toCity: city, mode: first.travel_mode ?? "drive" }
}

/** 停著的座騎是哪一段（點座騎重播）：倒數第二個點的（沒有就辦公室）→ 最後點的；沒點過是 null */
export function lastLeg(stops: RouteStop[], startCity: string | null): Leg | null {
  const order = byArrival(stops)
  const last = order.at(-1)
  if (!last) return null
  return legBetween(stops, order.at(-2)?.customer_id ?? null, last.customer_id, startCity)
}

/** 兩端都是七個縣市之一而且不一樣才算跨縣市；有一端不認得就不算 */
export function crossesCity(leg: Leg): boolean {
  const from = rideCity(leg.fromCity)
  const to = rideCity(leg.toCity)
  return from !== null && to !== null && from !== to
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
