import type { LatLng } from "@/api/team-routes"
import type { LegPiece } from "@/lib/team-routes"
import { finishWork, type Work } from "@/lib/background-work"

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

export function* drawPlanWork(
  legs: { done: boolean; pieces: LegPiece[] }[]
): Work<DrawPlan> {
  let distance = 0
  const pieces: DrawPiece[] = []
  const legEnds: number[] = []
  let work = 0
  for (let n = 0; n < legs.length; n++) {
    const leg = legs[n]
    for (const piece of leg.pieces) {
      const at: number[] = []
      for (let i = 0; i < piece.path.length; i++) {
        const point = piece.path[i]
        if (i > 0) distance += gap(piece.path[i - 1], point)
        at.push(distance)
        if (++work % 128 === 0) yield
      }
      pieces.push({ ...piece, leg: n, done: leg.done, at })
    }
    legEnds.push(distance)
  }
  return { pieces, total: distance, legEnds }
}
export function drawPlan(
  legs: { done: boolean; pieces: LegPiece[] }[]
): DrawPlan {
  return finishWork(drawPlanWork(legs))
}

/** 筆在 pen 的時候，這一小段畫得出來的點；走到一半的那一點用內插，線才會平順地長出來 */
export function revealed(piece: DrawPiece, pen: number): LatLng[] {
  const { path, at } = piece
  if (!path.length || pen <= at[0]) return []
  if (pen >= at[at.length - 1]) return path
  let low = 1,
    high = at.length - 1
  while (low < high) {
    const middle = (low + high) >>> 1
    if (at[middle] <= pen) low = middle + 1
    else high = middle
  }
  const i = low,
    t = (pen - at[i - 1]) / (at[i] - at[i - 1])
  const shown = path.slice(0, i)
  shown.push({
    lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * t,
    lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * t,
  })
  return shown
}

/** 筆在 pen 的時候冒出來幾站。有出發點：第 n 段畫完到第 n 站；沒有出發點：第 1 站一開始就在，第 n 段畫完到第 n + 1 站 */
export function stopsShown(
  plan: DrawPlan,
  pen: number,
  fromOffice: boolean,
  stops: number
) {
  const reached = plan.legEnds.filter((end) => end <= pen).length
  return Math.min(stops, fromOffice ? reached : reached + 1)
}
