import { HALF_NODE, labelSide, NODE_HEIGHT } from "@/lib/route-path"

/**
 * 熊熊滾的座騎停在蛇行路線的下一站旁邊（components/rides/ride-on-route.tsx）。這裡只管排法與算數：
 * 停在哪一側、多寬、翻不翻、多高（docs/superpowers/plans/2026-10-07-rides-stage3-animation.md Task 4），
 * 以及從上一站騎過來那一段的路徑與時間軸（Task 5）；量畫面、播 Web Animations 在元件裡。
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

/** 停著的座騎著地點（框的下緣正中間）離圓鈕中心多遠（x，往右是正的）：圓鈕半寬 + 10px + 座騎半寬 */
export function parkCenterX(offset: number, containerWidth: number): number {
  const reach = HALF_NODE + PARK_GAP + parkWidth(offset, containerWidth) / 2
  return parkSide(offset) === "left" ? -reach : reach
}

/* ---- 騎到下一站（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md〈動畫〉） ---- */

export type Point = { x: number; y: number }

/** 慢慢起步、慢慢停（三次方的 ease-in-out，對稱：時間走一半、路也正好走一半） */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
}

/** 二次貝茲曲線上取 n 點（含頭尾）。ease 把平均分的時間換成走到曲線的哪裡（預設等速） */
export function samplePath(from: Point, control: Point, to: Point, n: number, ease: (t: number) => number = (t) => t): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const t = ease(n > 1 ? i / (n - 1) : 1)
    const a = (1 - t) ** 2
    const b = 2 * (1 - t) * t
    const c = t ** 2
    return { x: a * from.x + b * control.x + c * to.x, y: a * from.y + b * control.y + c * to.y }
  })
}

/** 座騎畫的是朝右：往左走（終點在起點左邊）時翻過來 */
export function shouldFlip(from: Point, to: Point): boolean {
  return to.x < from.x
}

// 一段路的時間：冒出來、沿路走、到站壓扁回彈；跨縣市的煙與頭上的縣市名
const POP_MS = 300
const MOVE_MS = 2400
const LAND_MS = 300
const PUFF_MS = 400
const TAG_MS = 1000

/** 一段的時間軸（毫秒，從動畫開始算）。swap 是換成目的地縣市座騎的那一刻；不跨縣市就沒有煙、換車與縣市名 */
export type RideTimeline = {
  total: number
  popEnd: number
  moveEnd: number
  swap: number | null
  puff: { start: number; end: number } | null
  tag: { start: number; end: number } | null
}

/** 0–0.3 秒冒出來、0.3–2.7 秒沿路走、2.7–3 秒到站；跨縣市在路走到一半（ease-in-out 對稱，就是時間的一半）冒煙換車 */
export function timeline(cross: boolean): RideTimeline {
  const popEnd = POP_MS
  const moveEnd = POP_MS + MOVE_MS
  const swap = cross ? popEnd + MOVE_MS / 2 : null
  return {
    total: moveEnd + LAND_MS,
    popEnd,
    moveEnd,
    swap,
    // 煙最濃（正中間）的那一刻剛好換車
    puff: swap === null ? null : { start: swap - PUFF_MS / 2, end: swap + PUFF_MS / 2 },
    tag: swap === null ? null : { start: swap, end: swap + TAG_MS },
  }
}

type Box = { left: number; top: number; right: number; bottom: number }

/** 一段路在畫面上的起點、控制點、終點，都以終點（停著的座騎的著地點）為原點；scale 是起點那一站停的寬度比這一站的 */
export type LegPoints = { from: Point; control: Point; to: Point; scale: number }

/**
 * 從畫面上量到的位置算這一段怎麼走。end 是停著的座騎的著地點，node 是這一站的圓鈕，legRow 是兩站之間放膠囊的那一列，
 * prev 是上一站的圓鈕與它離中線多少（從辦公室出發是 null）。
 * 起點是上一站停的地方；控制點在兩顆圓鈕正中間、膠囊那一列的正中間（膠囊就在那裡），彎度跟蛇行的路一樣。
 * 從辦公室出發：從這一站正上方、膠囊那一列底下冒出來，控制點在停的那一側，先往旁邊再往下，不壓過圓鈕。
 */
export function legPoints({
  end,
  node,
  legRow,
  prev,
  offset,
  containerWidth,
}: {
  end: Point
  node: Box
  legRow: Pick<Box, "top" | "bottom">
  prev: { node: Box; offset: number } | null
  offset: number
  containerWidth: number
}): LegPoints {
  const at = (x: number, y: number): Point => ({ x: x - end.x, y: y - end.y })
  const nodeX = (node.left + node.right) / 2
  if (!prev) {
    return { from: at(nodeX, legRow.bottom), control: at(end.x, legRow.bottom), to: at(end.x, end.y), scale: 1 }
  }
  const prevX = (prev.node.left + prev.node.right) / 2
  return {
    from: at(prevX + parkCenterX(prev.offset, containerWidth), prev.node.bottom),
    control: at((prevX + nodeX) / 2, (legRow.top + legRow.bottom) / 2),
    to: at(end.x, end.y),
    scale: parkWidth(prev.offset, containerWidth) / parkWidth(offset, containerWidth),
  }
}

// 沿路取幾點做關鍵影格
const SAMPLES = 16

// 小數點後兩位就夠；-0 寫成 0
function num(n: number): number {
  const rounded = Math.round(n * 100) / 100
  return rounded === 0 ? 0 : rounded
}

function place(at: Point, sx: number, sy = sx): string {
  return `translate(${num(at.x)}px, ${num(at.y)}px) scale(${num(sx)}, ${num(sy)})`
}

/**
 * 外層（停著的那顆按鈕）的關鍵影格。transform-origin 是著地點，所以 translate 就是著地點要移到哪、scale 不會讓它偏掉。
 * 在起點從 0.6 倍彈到 1.1 倍再回來；沿路 16 點（ease-in-out），大小從上一站停的寬度慢慢變成這一站的；到站壓扁（1.1, 0.9）再回彈。
 */
export function rideKeyframes({ from, control, to, scale }: LegPoints, t: RideTimeline): Keyframe[] {
  const offset = (ms: number) => ms / t.total
  const path = samplePath(from, control, to, SAMPLES, easeInOut)
  return [
    { offset: 0, transform: place(from, 0.6 * scale), opacity: 0 },
    { offset: offset(t.popEnd * 0.6), transform: place(from, 1.1 * scale), opacity: 1 },
    ...path.map((at, i) => {
      const u = i / (SAMPLES - 1)
      return {
        offset: offset(t.popEnd + (t.moveEnd - t.popEnd) * u),
        transform: place(at, scale + (1 - scale) * easeInOut(u)),
        opacity: 1,
      }
    }),
    { offset: offset(t.moveEnd + (t.total - t.moveEnd) * 0.3), transform: place(to, 1.1, 0.9), opacity: 1 },
    { offset: 1, transform: place(to, 1), opacity: 1 },
  ]
}
