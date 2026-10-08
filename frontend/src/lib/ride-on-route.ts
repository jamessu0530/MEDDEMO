import { HALF_NODE, labelSide, NODE_HEIGHT } from "@/lib/route-path"

/**
 * 熊熊滾的座騎停在蛇行路線的下一站旁邊（components/rides/ride-on-route.tsx）。這裡只管排法：
 * 停在哪一側、多寬、翻不翻、多高（docs/superpowers/plans/2026-10-07-rides-stage3-animation.md Task 4）。
 */

// 量不到路線寬度時（伺服器 render、還沒排版）照 390 寬的手機排：左右各留 16px
export const ROUTE_WIDTH = 358

// 座騎離圓鈕多遠、寬度的上下限、離路線邊留多少
export const PARK_GAP = 10
const PARK_MIN = 84
const PARK_MAX = 120
const EDGE_ROOM = 4

// 座騎畫布 300×200，地面在 y=187：著地點是框的 (50%, 93.5%)
export const GROUND = 0.935

/** 停在圓鈕沒有名字的那一側（名字在 labelSide）：置中或偏左停左邊，偏右停右邊 */
export function parkSide(offset: number): "left" | "right" {
  return labelSide(offset) === "left" ? "right" : "left"
}

/** 寬：那一側從圓鈕邊到路線邊的空間減 4px，夾在 84～120（390 寬時中線的站 120、偏 40 的 106、偏 64 的 84） */
export function parkWidth(offset: number, containerWidth: number): number {
  const half = containerWidth / 2
  const room = parkSide(offset) === "left" ? half + offset - HALF_NODE : half - offset - HALF_NODE
  return Math.round(Math.min(PARK_MAX, Math.max(PARK_MIN, room - EDGE_ROOM)))
}

/** 座騎畫的是朝右：停在圓鈕左邊不翻、停在右邊翻過來，都面向圓鈕 */
export function parkFlipped(offset: number): boolean {
  return parkSide(offset) === "right"
}

/** 座騎的高（跟 Ride 一樣是寬的三分之二、取整數） */
export function parkHeight(width: number): number {
  return Math.round((width * 2) / 3)
}

/** 座騎框的上緣離那一列上緣多少 px：地面線對齊圓鈕底邊（可能是負的，往上凸出那一列） */
export function parkTop(width: number): number {
  return NODE_HEIGHT - parkHeight(width) * GROUND
}
