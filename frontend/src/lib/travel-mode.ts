import type { TravelMode } from "@/api/route"

/*
 * 業務跑客戶的交通方式（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈交通方式〉）。
 * 行程的時間、排順路與地圖上的線都照它算；設定頁、首頁的地圖、主管頁都用這裡的字。
 */

export const TRAVEL_MODES: TravelMode[] = ["drive", "scooter", "transit"]

export const TRAVEL_MODE_LABEL: Record<TravelMode, string> = { drive: "開車", scooter: "機車", transit: "大眾運輸" }

// Google 地圖導航網址的 travelmode
export const NAVIGATION_MODE: Record<TravelMode, string> = { drive: "driving", scooter: "two-wheeler", transit: "transit" }

/** 車程從哪裡來：直線估算寫「（估計）」；Google 的機車路線還是測試版，Google 要求註明 */
export function routeSource(mode: TravelMode, estimated: boolean) {
  if (estimated) return "（估計）"
  return mode === "scooter" ? "（Google 機車路線測試版）" : "（Google 路線）"
}
