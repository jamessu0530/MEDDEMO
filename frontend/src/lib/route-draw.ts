import type { LatLng } from "@/api/team-routes"
import type { LegPiece } from "@/lib/team-routes"

/*
 * 首頁「地圖」的路線一段一段畫出來（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈業務首頁的地圖〉）：
 * 整條路線攤成一條長度，筆從 0 走到 total，每一小段只畫筆已經走過的部分；筆走到哪一站，那一站的圓點才冒出來。
 * 純函式，動畫的時間在 components/route/home-map.tsx。
 */

export type DrawPiece = LegPiece & {
  // 第幾段路（legPaths 的順序）
  leg: number
  done: boolean
  // 這一小段的每一點，離整條路線的起點多遠
  at: number[]
}

export type DrawPlan = {
  pieces: DrawPiece[]
  total: number
  // 第 n 段路畫完時筆在哪
  legEnds: number[]
}

// 兩點多遠：只拿來分配動畫的速度，平面近似就夠
function gap(a: LatLng, b: LatLng) {
  const x = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180))
  return Math.hypot(x, b.lat - a.lat)
}

export function drawPlan(legs: { done: boolean; pieces: LegPiece[] }[]): DrawPlan {
  let distance = 0
  const pieces: DrawPiece[] = []
  const legEnds: number[] = []
  legs.forEach((leg, n) => {
    for (const piece of leg.pieces) {
      const at = piece.path.map((point, i) => {
        if (i > 0) distance += gap(piece.path[i - 1], point)
        return distance
      })
      pieces.push({ ...piece, leg: n, done: leg.done, at })
    }
    legEnds.push(distance)
  })
  return { pieces, total: distance, legEnds }
}

/** 筆在 pen 的時候，這一小段畫得出來的點；走到一半的那一點用內插，線才會平順地長出來 */
export function revealed(piece: DrawPiece, pen: number): LatLng[] {
  const { path, at } = piece
  if (!path.length || pen <= at[0]) return []
  const shown = [path[0]]
  for (let i = 1; i < path.length; i += 1) {
    if (at[i] <= pen) {
      shown.push(path[i])
      continue
    }
    const t = (pen - at[i - 1]) / (at[i] - at[i - 1])
    shown.push({
      lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * t,
      lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * t,
    })
    break
  }
  return shown
}

/** 筆在 pen 的時候冒出來幾站。有出發點：第 n 段畫完到第 n 站；沒有出發點：第 1 站一開始就在，第 n 段畫完到第 n + 1 站 */
export function stopsShown(plan: DrawPlan, pen: number, fromOffice: boolean, stops: number) {
  const reached = plan.legEnds.filter((end) => end <= pen).length
  return Math.min(stops, fromOffice ? reached : reached + 1)
}
