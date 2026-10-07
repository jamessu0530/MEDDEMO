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
