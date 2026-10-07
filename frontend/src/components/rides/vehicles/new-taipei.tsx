import "./new-taipei.css"

import type { ReactNode } from "react"

import { INK, PROP, STAR } from "@/components/rides/vehicles/colors"
import { Ground, Wheel } from "@/components/rides/vehicles/parts"
import type { CityVehicles, VehicleProps } from "@/components/rides/vehicles/types"

/**
 * 新北市（平溪天燈）的四種座騎（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md〈座騎〉）：
 * 天燈當車身、天燈當機車的車身、一串天燈吊在纜線上當空中纜車、坐在天燈上飄過去。
 * 天燈是上寬下窄、肩膀圓圓的梯形，底下一圈火光與一朵火苗；燈面上的字用一個斗方（菱形）代替，不放文字。
 */

// 天燈的三個顏色：紅紙、竹框與花紋、被火照亮的下半截
const PAPER = "#EE5B3E"
const PAPER_DARK = "#C2412D"
const PAPER_LIT = "#FF9E57"

/** 火苗：往上尖的水滴，底邊中心 (0, base)、寬 2r、高 tall；外黃內白 */
function flamePath(base: number, r: number, tall: number) {
  const tip = base - tall
  return `M0 ${tip} C${r * 0.4} ${tip + tall * 0.3} ${r} ${base - r * 1.9} ${r} ${base - r} A${r} ${r} 0 0 1 ${-r} ${base - r} C${-r} ${base - r * 1.9} ${-r * 0.4} ${tip + tall * 0.3} 0 ${tip} Z`
}

/**
 * 一盞天燈：頂邊中心 (cx, top)，頂寬 w、高 h，底寬是頂寬的七成，頂上微微拱起、肩膀圓。
 * 由下往上疊：紅紙、被火照亮的下半截、兩道竹框、斗方、底下一圈火光、火苗（會閃，動畫在 new-taipei.css）。
 */
function Lantern({ cx, top, w, h }: { cx: number; top: number; w: number; h: number }) {
  const a = w / 2
  const b = a * 0.7
  const rt = w * 0.3
  const rb = w * 0.06
  // 側邊在高度 y 時的半寬
  const side = (y: number) => a - ((a - b) * (y - rt)) / (h - rb - rt)
  const lit = h * 0.72
  const d = w * 0.13
  const mark = h * 0.46
  return (
    <g transform={`translate(${cx} ${top})`}>
      <path
        d={`M${-a + rt} 0 Q0 ${-h * 0.06} ${a - rt} 0 Q${a} 0 ${a} ${rt} L${b} ${h - rb} Q${b} ${h} ${b - rb} ${h} H${-b + rb} Q${-b} ${h} ${-b} ${h - rb} L${-a} ${rt} Q${-a} 0 ${-a + rt} 0 Z`}
        fill={PAPER}
      />
      <path
        d={`M${-side(lit)} ${lit} H${side(lit)} L${b} ${h - rb} Q${b} ${h} ${b - rb} ${h} H${-b + rb} Q${-b} ${h} ${-b} ${h - rb} Z`}
        fill={PAPER_LIT}
      />
      {[-1, 1].map((k) => (
        <line
          key={k}
          x1={k * a * 0.58}
          y1={h * 0.08}
          x2={k * b * 0.58}
          y2={h * 0.94}
          stroke={PAPER_DARK}
          strokeWidth={w * 0.035}
          strokeLinecap="round"
        />
      ))}
      <rect x={-d} y={mark - d} width={d * 2} height={d * 2} rx={d * 0.35} fill={STAR} transform={`rotate(45 0 ${mark})`} />
      <rect
        x={-d * 0.4}
        y={mark - d * 0.4}
        width={d * 0.8}
        height={d * 0.8}
        rx={d * 0.15}
        fill={PAPER_DARK}
        transform={`rotate(45 0 ${mark})`}
      />
      <rect x={-b - 2} y={h - w * 0.045} width={b * 2 + 4} height={w * 0.09} rx={w * 0.045} fill={STAR} />
      <g className="ride-new-taipei-flame">
        <path d={flamePath(h + w * 0.08, w * 0.1, w * 0.32)} fill={STAR} />
        <path d={flamePath(h + w * 0.05, w * 0.05, w * 0.16)} fill="#fff" />
      </g>
    </g>
  )
}

/** 開車：一盞大天燈當車身，熊熊滾從燈頂探出來，底下兩個輪子，火苗在兩個輪子中間 */
function Drive({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <g className="ride-bob">
        {bear({ x: 96, y: 0, size: 108 })}
        <Lantern cx={150} top={70} w={122} h={96} />
      </g>
      <Wheel cx={104} cy={168} r={20} />
      <Wheel cx={196} cy={168} r={20} />
    </>
  )
}

/** 機車：天燈當車身（離地一點，火苗不碰地），熊坐在燈頂的座墊上，前面淺紫的踏板、龍頭與把手，底下兩個輪子 */
function Scooter({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <Wheel cx={78} cy={167} r={20} />
      <Wheel cx={228} cy={167} r={20} />
      <g className="ride-bob">
        {bear({ x: 74, y: -2, size: 100 })}
        <rect x="140" y="138" width="86" height="12" rx="6" fill={PROP} />
        <line x1="228" y1="150" x2="212" y2="74" stroke={PROP} strokeWidth="18" strokeLinecap="round" />
        <line x1="198" y1="72" x2="228" y2="66" className="ride-ink" stroke={INK} strokeWidth="7" strokeLinecap="round" />
        <circle cx="228" cy="98" r="6" fill={STAR} />
        <Lantern cx={124} top={84} w={86} h={70} />
        <rect x="90" y="76" width="68" height="13" rx="6.5" className="ride-ink" fill={INK} />
      </g>
    </>
  )
}

// 纜線：從左下斜到右上，兩端跟地面一樣寬
const CABLE: [number, number, number, number] = [10, 98, 290, 16]
const cableY = (x: number) => CABLE[1] + ((CABLE[3] - CABLE[1]) * (x - CABLE[0])) / (CABLE[2] - CABLE[0])

/** 一節纜車：纜線上的夾頭、兩條吊索拉到燈的肩膀，底下吊一盞天燈；有人坐時，熊畫在吊索與燈之間，從燈頂探出頭 */
function Gondola({ cx, top, w, h, rider }: { cx: number; top: number; w: number; h: number; rider?: ReactNode }) {
  const y = cableY(cx)
  return (
    <g className="ride-new-taipei-swing">
      <path
        d={`M${cx - w * 0.42} ${top + w * 0.07} L${cx} ${y} L${cx + w * 0.42} ${top + w * 0.07}`}
        fill="none"
        className="ride-ink" stroke={INK}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {rider}
      <Lantern cx={cx} top={top} w={w} h={h} />
      <circle cx={cx} cy={y} r="5" className="ride-ink" fill={INK} />
    </g>
  )
}

/** 大眾運輸：一條纜線斜過畫面，三盞天燈吊在上面當車廂，熊熊滾坐在最前面那盞，每盞輕輕晃 */
function Transit({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <line x1={CABLE[0]} y1={CABLE[1]} x2={CABLE[2]} y2={CABLE[3]} className="ride-ink" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <g>
        <Gondola cx={60} top={108} w={54} h={58} />
        <Gondola cx={142} top={86} w={54} h={58} />
        <Gondola cx={228} top={84} w={62} h={64} rider={bear({ x: 188, y: 34, size: 80 })} />
      </g>
    </>
  )
}

/** 走路：熊熊滾坐在一盞天燈頂上，整盞慢慢飄、輕輕擺，底下的火苗一閃一閃 */
function Walk({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <g className="ride-float">
        {bear({ x: 108, y: 5, size: 84 })}
        <Lantern cx={150} top={76} w={88} h={90} />
      </g>
    </>
  )
}

export const newTaipei: CityVehicles = { drive: Drive, scooter: Scooter, transit: Transit, walk: Walk }
