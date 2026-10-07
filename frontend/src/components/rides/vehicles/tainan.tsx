import "./tainan.css"

import type { ReactNode } from "react"

import { INK, PROP, STAR } from "@/components/rides/vehicles/colors"
import { Ground, roundedPath, Wheel } from "@/components/rides/vehicles/parts"
import type { CityVehicles, VehicleProps } from "@/components/rides/vehicles/types"

/**
 * 台南市（虱目魚）的四種座騎（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md〈座騎〉）：
 * 虱目魚當車身（熊坐在魚背的開口裡）、虱目魚當機車的車身、三條虱目魚頭尾相接排成列車、騎在魚背上游過去。
 * 魚是流線的長橢圓：背是深一點的藍灰、身體銀灰帶藍、肚子淺色，尾巴是分岔很深的三角尾鰭，眼睛大大圓圓的。
 */

// 虱目魚的三個顏色：背與魚鰭、銀色的身體、淺色的肚子
const BACK = "#4F7598"
const SILVER = "#9DB7CD"
const BELLY = "#E3ECF3"

type Pt = [number, number]
const r1 = (v: number) => Math.round(v * 10) / 10
const pts = (list: Pt[]) => list.map(([x, y]) => `${r1(x)} ${r1(y)}`).join(" L")

// 魚身最高的地方（從尾柄 0 到嘴 1）
const PEAK = 0.56
/** 魚身在 t 處的半高（最高時是 1）：前段收成尖尖的嘴，後段收到尾柄剩兩成 */
function half(t: number) {
  if (t >= PEAK) {
    const u = (t - PEAK) / (1 - PEAK)
    return Math.max(0, 1 - u * u) ** 0.62
  }
  const u = (PEAK - t) / PEAK
  return 0.2 + 0.8 * (1 - u * u) ** 0.7
}
// 取樣點：兩頭密、中間疏
const TS = Array.from({ length: 41 }, (_, i) => (1 - Math.cos((Math.PI * i) / 40)) / 2)

/** 魚背上給熊坐的開口：在 t 處、半寬 rx、半高 ry（從側面斜斜看過去是一個扁橢圓） */
type Hole = { t: number; rx: number; ry: number }

/**
 * 一條虱目魚（朝右）：身體中心 (cx, cy)、身長 len（尾柄到嘴，不含尾巴）、半高 h。
 * 由後往前疊：尾鰭、背鰭、（開口的深色內側、坐在裡面的 rider）、銀色的身體、深色的背、淺色的肚子、胸鰭、鰓、眼睛。
 * 有 hole 時身體上緣在開口處順著橢圓的下半圈凹下去，熊的下半身被魚身擋住，看起來坐在魚背裡；
 * 沒有 hole 時 rider 畫在身體後面，魚背擋住熊的腳（騎在魚背上）。
 */
function Fish({ cx, cy, len, h, hole, rider, dorsal = 0.42 }: { cx: number; cy: number; len: number; h: number; hole?: Hole; rider?: ReactNode; dorsal?: number }) {
  const x0 = cx - len / 2
  const at = (t: number) => x0 + len * t
  const top = (t: number) => cy - half(t) * h
  const bottom = (t: number) => cy + half(t) * h

  // 上緣：從尾柄到嘴；有開口時中間換成橢圓的下半圈
  let topEdge: string
  let holeAt: Pt | null = null
  if (hole) {
    const tl = hole.t - hole.rx / len
    const tr = hole.t + hole.rx / len
    const left: Pt = [at(tl), top(tl)]
    const right: Pt = [at(tr), top(tr)]
    holeAt = [at(hole.t), (left[1] + right[1]) / 2]
    topEdge = `M${pts([...TS.filter((t) => t < tl).map((t): Pt => [at(t), top(t)]), left])} A${hole.rx} ${hole.ry} 0 0 0 ${pts([right, ...TS.filter((t) => t > tr).map((t): Pt => [at(t), top(t)])])}`
  } else {
    topEdge = `M${pts(TS.map((t): Pt => [at(t), top(t)]))}`
  }
  const back = [...TS].reverse()
  const body = `${topEdge} L${pts(back.map((t): Pt => [at(t), bottom(t)]))} Z`
  // 深色的背：上緣往下到魚身上半的四成
  const backBand = `${topEdge} L${pts(back.map((t): Pt => [at(t), cy - half(t) * h * 0.42]))} Z`
  // 淺色的肚子：中段從中線稍下到下緣，往頭尾兩端慢慢收到下緣（不留直直的切邊）
  const [b0, b1] = [0.04, 0.97]
  const bellyTs = TS.filter((t) => t > b0 && t < b1)
  const bellyTop = (t: number) => cy + half(t) * h * (1 - 0.76 * Math.sin((Math.PI * (t - b0)) / (b1 - b0)) ** 0.35)
  const belly = `M${pts([...bellyTs.map((t): Pt => [at(t), bellyTop(t)]), ...[...bellyTs].reverse().map((t): Pt => [at(t), bottom(t)])])} Z`

  // 分岔的尾鰭：根部藏在尾柄裡，兩片往後上、後下張開，中間一個深深的凹口
  const tail = roundedPath([
    [x0 + 4, cy - h * 0.2, 0],
    [x0 - h * 0.95, cy - h * 0.95, h * 0.16],
    [x0 - h * 0.5, cy, h * 0.1],
    [x0 - h * 0.95, cy + h * 0.95, h * 0.16],
    [x0 + 4, cy + h * 0.2, 0],
  ])
  // 背鰭：往後斜的圓角三角，底邊藏在身體裡
  const dx = at(dorsal)
  const fin = roundedPath([
    [dx - h * 0.3, top(dorsal - 0.3 * (h / len)) + 6, 0],
    [dx - h * 0.42, top(dorsal) - h * 0.5, h * 0.1],
    [dx + h * 0.32, top(dorsal + 0.32 * (h / len)) + 6, 0],
  ])
  const gill = 0.74
  const ex = at(0.85)
  const ey = cy - h * 0.14
  return (
    <g>
      <path d={tail} fill={BACK} />
      <path d={fin} fill={BACK} />
      {hole && holeAt && (
        <>
          <ellipse cx={holeAt[0]} cy={holeAt[1]} rx={hole.rx} ry={hole.ry} fill={BACK} />
          <ellipse cx={holeAt[0]} cy={holeAt[1] + 1} rx={hole.rx - 5} ry={hole.ry - 3} fill={INK} />
        </>
      )}
      {rider}
      <path d={body} fill={SILVER} />
      <path d={backBand} fill={BACK} />
      <path d={belly} fill={BELLY} />
      <ellipse
        cx={at(0.64)}
        cy={cy + h * 0.24}
        rx={h * 0.32}
        ry={h * 0.12}
        fill={BACK}
        transform={`rotate(-16 ${r1(at(0.64))} ${r1(cy + h * 0.24)})`}
      />
      <path
        d={`M${r1(at(gill))} ${r1(cy - half(gill) * h * 0.55)} Q${r1(at(gill) + h * 0.2)} ${cy} ${r1(at(gill))} ${r1(cy + half(gill) * h * 0.55)}`}
        fill="none"
        stroke={BACK}
        strokeWidth={h * 0.07}
        strokeLinecap="round"
      />
      <circle cx={ex} cy={ey} r={h * 0.18} fill="#fff" />
      <circle cx={ex + h * 0.03} cy={ey} r={h * 0.12} fill={INK} />
      <circle cx={ex - h * 0.01} cy={ey - h * 0.05} r={h * 0.045} fill="#fff" />
    </g>
  )
}

/** 開車：一條大虱目魚當車身，熊熊滾坐在魚背中間的開口裡，底下兩個輪子 */
function Drive({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <g className="ride-bob">
        <Fish cx={158} cy={126} len={204} h={44} dorsal={0.2} hole={{ t: 0.5, rx: 40, ry: 10 }} rider={bear({ x: 102, y: 21, size: 112 })} />
      </g>
      <Wheel cx={104} cy={168} r={20} />
      <Wheel cx={204} cy={168} r={20} />
    </>
  )
}

/** 機車：虱目魚當車身，熊坐在魚背的深色座墊上，前面淺紫的踏板、龍頭與把手，底下兩個輪子 */
function Scooter({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <Wheel cx={96} cy={167} r={20} />
      <Wheel cx={228} cy={167} r={20} />
      <g className="ride-bob">
        {bear({ x: 76, y: 14, size: 100 })}
        <rect x="160" y="140" width="66" height="12" rx="6" fill={PROP} />
        <line x1="228" y1="150" x2="212" y2="74" stroke={PROP} strokeWidth="16" strokeLinecap="round" />
        <line x1="198" y1="72" x2="228" y2="66" stroke={INK} strokeWidth="7" strokeLinecap="round" />
        <circle cx="228" cy="98" r="6" fill={STAR} />
        <Fish cx={146} cy={130} len={148} h={30} dorsal={0.2} />
        <rect x="96" y="96" width="62" height="13" rx="6.5" fill={INK} />
      </g>
    </>
  )
}

/** 大眾運輸：三條虱目魚頭尾相接排成列車（後一條的嘴碰著前一條的尾巴），熊熊滾坐在最前面那條的開口裡，每條底下兩個小輪子 */
function Transit({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <g className="ride-bob">
        <Fish cx={71} cy={146} len={74} h={23} dorsal={0.36} />
        <Fish cx={157} cy={146} len={74} h={23} dorsal={0.36} />
        <Fish cx={243} cy={146} len={74} h={23} dorsal={0.2} hole={{ t: 0.5, rx: 26, ry: 6 }} rider={bear({ x: 203, y: 76, size: 80 })} />
      </g>
      {/* 輪子不跟著浮，底部貼在地面（y 187） */}
      {[51, 91, 137, 177, 223, 263].map((cx) => (
        <Wheel key={cx} cx={cx} cy={176} r={11} />
      ))}
    </>
  )
}

/** 一顆水泡：淺紫的圓，左上一點反光；往上冒、淡掉（tainan.css） */
function Bubble({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g className="ride-tainan-bubble">
      <circle cx={cx} cy={cy} r={r} fill={PROP} />
      <circle cx={cx - r * 0.35} cy={cy - r * 0.35} r={r * 0.3} fill="#fff" />
    </g>
  )
}

/** 走路：熊熊滾騎在虱目魚背上，整條魚上下起伏、頭尾擺著游過去（.ride-swim），嘴前冒出幾顆淺紫的水泡 */
function Walk({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <g>
        <Bubble cx={252} cy={104} r={5} />
        <Bubble cx={266} cy={82} r={7} />
        <Bubble cx={254} cy={56} r={9} />
      </g>
      <g className="ride-swim">
        <Fish cx={150} cy={126} len={168} h={36} dorsal={0.24} rider={bear({ x: 94, y: 24, size: 96 })} />
      </g>
    </>
  )
}

export const tainan: CityVehicles = { drive: Drive, scooter: Scooter, transit: Transit, walk: Walk }
