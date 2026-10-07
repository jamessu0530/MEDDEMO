import { Car, Footprints, Motorbike, TrainFront, type LucideIcon } from "lucide-react"

import type { LegMode, TravelMode } from "@/api/route"

/*
 * 業務跑客戶的交通方式（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈交通方式〉）。
 * 行程的時間、排順路與地圖上的線都照它算；設定頁、首頁的地圖、主管頁都用這裡的字。
 * 整天的預設只有前三種；單段路可以多選走路（順序跟後端 models.LEG_MODES 一樣，改了要一起改）。
 */

export const TRAVEL_MODES: TravelMode[] = ["drive", "scooter", "transit"]

export const LEG_MODES: LegMode[] = ["drive", "scooter", "transit", "walk"]

export const TRAVEL_MODE_LABEL: Record<LegMode, string> = { drive: "開車", scooter: "機車", transit: "大眾運輸", walk: "走路" }

// Google 地圖導航網址的 travelmode
export const NAVIGATION_MODE: Record<LegMode, string> = {
  drive: "driving",
  scooter: "two-wheeler",
  transit: "transit",
  walk: "walking",
}

export const MODE_ICON: Record<LegMode, LucideIcon> = { drive: Car, scooter: Motorbike, transit: TrainFront, walk: Footprints }

/** Google 規定機車、走路路線要提醒是測試版 */
export const BETA_NOTE = "機車、走路路線是 Google 測試版"

/** 車程從哪裡來：直線估算寫「（估計）」；Google 的機車、走路路線還是測試版，Google 要求註明 */
export function routeSource(mode: LegMode, estimated: boolean) {
  if (estimated) return "（估計）"
  if (mode === "scooter") return "（Google 機車路線測試版）"
  return mode === "walk" ? "（Google 走路路線測試版）" : "（Google 路線）"
}

/** 一段路的分鐘數：估算的前面加「約」 */
export function legMinutes(minutes: number, estimated: boolean) {
  return `${estimated ? "約 " : ""}${minutes} 分`
}

/** 到第 index 站的那一段從哪裡出發：第一站從辦公室（null），其他從上一站（跑完的站排在前面，照拜訪時間） */
export function legFrom(stops: { customer_id: string }[], index: number): string | null {
  return index === 0 ? null : stops[index - 1].customer_id
}
