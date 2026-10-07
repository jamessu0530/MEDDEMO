import "./taipei.css"

import { INK, LIGHT, PROP, STAR } from "@/components/rides/vehicles/colors"
import { Ground, Wheel } from "@/components/rides/vehicles/parts"
import type { CityVehicles, VehicleProps } from "@/components/rides/vehicles/types"

/**
 * 台北市（小籠包）的四種座騎（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md〈座騎〉）：
 * 小籠包當車身、機車的兩個輪子是小籠包（從上面看的那一面，摺子轉成一圈漩渦）、蒸籠疊成的捷運車廂、
 * 在小籠包上一路彈過去。小籠包頂上的摺子收成一圈往上尖的小角，熊熊滾就從收口那裡探出來。
 */

// 小籠包的三個顏色：麵皮、摺子與底下的陰影、蒸籠的竹子
const DOUGH = "#F6E7CB"
const PLEAT = "#E3C79A"
const BAMBOO = "#D6A055"

/** 一縷蒸氣（S 形的線），往上飄、淡掉；動畫在 taipei.css */
function Steam({ x, y }: { x: number; y: number }) {
  return (
    <path
      className="ride-taipei-steam"
      d={`M${x} ${y} q-7 -9 0 -18 q7 -9 0 -18`}
      fill="none"
      stroke={PROP}
      strokeWidth="5"
      strokeLinecap="round"
    />
  )
}

/**
 * 小籠包頂上的收口：一排往上尖的圓角小角，底邊在 y、從 x0 排到 x1。
 * 後面一排用摺子的顏色、錯開半格，前面一排是麵皮，看起來一摺一摺。
 */
function Crimp({ x0, x1, y, n, h }: { x0: number; x1: number; y: number; n: number; h: number }) {
  const step = (x1 - x0) / (n - 1)
  const half = step * 0.72
  const tip = (x: number, height: number, fill: string) => (
    <path
      key={`${fill}${x}`}
      d={`M${x - half} ${y} C${x - half * 0.55} ${y - height * 0.55} ${x - half * 0.3} ${y - height} ${x} ${y - height} C${x + half * 0.3} ${y - height} ${x + half * 0.55} ${y - height * 0.55} ${x + half} ${y} Z`}
      fill={fill}
    />
  )
  return (
    <>
      {Array.from({ length: n - 1 }, (_, i) => tip(x0 + (i + 0.5) * step, h * 0.82, PLEAT))}
      {Array.from({ length: n }, (_, i) => tip(x0 + i * step, h, DOUGH))}
    </>
  )
}

/** 一道摺痕：從收口 (x0, y0) 往下彎到 (x1, y1)，中間最寬（w）、兩頭尖，用填色不用描邊 */
function Pleat({ x0, y0, x1, y1, w }: { x0: number; y0: number; x1: number; y1: number; w: number }) {
  // 往外彎：控制點放在兩端中點再往外推一點
  const mx = (x0 + x1) / 2 + (x1 - x0) * 0.18
  const my = (y0 + y1) / 2 - Math.abs(x1 - x0) * 0.12
  return <path d={`M${x0} ${y0} Q${mx - w} ${my} ${x1} ${y1} Q${mx + w} ${my} ${x0} ${y0} Z`} fill={PLEAT} />
}

/** 一顆小籠包（側面）：底邊中心 (cx, by)，照寬 100 畫再縮放 s；頂上一小撮收口 */
function Bun({ cx, by, s }: { cx: number; by: number; s: number }) {
  return (
    <g transform={`translate(${cx} ${by}) scale(${s})`}>
      <path
        d="M-36 0 C-48 0 -54 -8 -52 -20 C-48 -44 -26 -62 -8 -68 H8 C26 -62 48 -44 52 -20 C54 -8 48 0 36 0 Z"
        fill={DOUGH}
      />
      <path d="M-52 -18 C-48 -6 -42 0 -34 0 H34 C42 0 48 -6 52 -18 C30 -8 -30 -8 -52 -18 Z" fill={PLEAT} />
      <Pleat x0={-6} y0={-64} x1={-38} y1={-26} w={5} />
      <Pleat x0={-2} y0={-64} x1={-14} y1={-20} w={4} />
      <Pleat x0={2} y0={-64} x1={14} y1={-20} w={4} />
      <Pleat x0={6} y0={-64} x1={38} y1={-26} w={5} />
      <Crimp x0={-10} x1={10} y={-62} n={3} h={16} />
    </g>
  )
}

/** 從上面看的小籠包（機車的輪子）：一圈麵皮，摺子轉成漩渦收到中間一小撮；照半徑 50 畫再縮放，外面包 .ride-roll 就會滾 */
function BunTop({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g transform={`translate(${cx} ${cy}) scale(${r / 50})`}>
      <circle r="50" fill={PLEAT} />
      <circle r="45" fill={DOUGH} />
      {[0, 60, 120, 180, 240, 300].map((deg) => (
        <path key={deg} d="M0 -4 C14 -20 30 -26 46 -18 C30 -16 16 -10 0 -4 Z" fill={PLEAT} transform={`rotate(${deg})`} />
      ))}
      <circle r="10" fill={DOUGH} />
      <circle r="4" fill={PLEAT} />
    </g>
  )
}

/** 開車：一顆大小籠包當車身，熊熊滾從頂上的收口探出來，車頭一顆黃色車燈，背後冒蒸氣 */
function Drive({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <g className="ride-bob">
        <g>
          <Steam x={70} y={92} />
          <Steam x={52} y={104} />
        </g>
        {bear({ x: 92, y: 0, size: 116 })}
        <path
          d="M80 172 C58 172 48 162 50 148 C54 118 82 100 112 94 H188 C218 100 246 118 250 148 C252 162 242 172 220 172 Z"
          fill={DOUGH}
        />
        <path d="M50 150 C52 164 62 172 80 172 H220 C238 172 248 164 250 150 C216 162 84 162 50 150 Z" fill={PLEAT} />
        <Pleat x0={110} y0={98} x1={62} y1={140} w={7} />
        <Pleat x0={128} y0={100} x1={100} y1={156} w={6} />
        <Pleat x0={146} y0={100} x1={138} y1={162} w={5} />
        <Pleat x0={154} y0={100} x1={162} y1={162} w={5} />
        <Pleat x0={172} y0={100} x1={200} y1={156} w={6} />
        <Pleat x0={190} y0={98} x1={238} y1={140} w={7} />
        <Crimp x0={114} x1={186} y={100} n={5} h={24} />
        <circle cx="243" cy="144" r="7" fill={STAR} />
      </g>
      <Wheel cx={100} cy={168} r={20} />
      <Wheel cx={200} cy={168} r={20} />
    </>
  )
}

/** 機車：淺紫的車身與把手，兩個輪子是從上面看的小籠包（整顆滾），熊坐在深色座墊上 */
function Scooter({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <g className="ride-roll">
        <BunTop cx={85} cy={158} r={29} />
      </g>
      <g className="ride-roll">
        <BunTop cx={229} cy={158} r={29} />
      </g>
      <g className="ride-bob">
        {bear({ x: 80, y: 20, size: 100 })}
        <path d="M58 150 C58 124 76 112 104 112 H170 C178 112 182 120 180 128 L174 150 Z" fill={PROP} />
        <rect x="160" y="140" width="64" height="12" rx="6" fill={PROP} />
        <line x1="226" y1="148" x2="212" y2="74" stroke={PROP} strokeWidth="18" strokeLinecap="round" />
        <line x1="198" y1="72" x2="228" y2="66" stroke={INK} strokeWidth="7" strokeLinecap="round" />
        <rect x="92" y="102" width="80" height="14" rx="7" fill={INK} />
        <circle cx="229" cy="96" r="6" fill={STAR} />
      </g>
    </>
  )
}

/** 一節蒸籠車廂的竹條紋：上下兩層之間一道圈、下層一排直的竹條 */
function SteamerBands({ x0, x1 }: { x0: number; x1: number }) {
  const slats: number[] = []
  for (let x = x0 + 12; x <= x1 - 10; x += 12) slats.push(x)
  return (
    <>
      <rect x={x0} y="146" width={x1 - x0} height="5" fill={PLEAT} />
      {slats.map((x) => (
        <line key={x} x1={x} y1="156" x2={x} y2="162" stroke={PLEAT} strokeWidth="3" strokeLinecap="round" />
      ))}
    </>
  )
}

/** 蒸籠的蓋子：扁扁的圓頂，頂上一個小把手 */
function Lid({ x0, x1 }: { x0: number; x1: number }) {
  const mid = (x0 + x1) / 2
  return (
    <>
      <rect x={mid - 8} y="76" width="16" height="12" rx="5" fill={BAMBOO} />
      <path d={`M${x0} 98 C${x0 + 2} 88 ${x0 + 12} 84 ${x0 + 24} 84 H${x1 - 24} C${x1 - 12} 84 ${x1 - 2} 88 ${x1} 98 Z`} fill={BAMBOO} />
      <rect x={x0} y="96" width={x1 - x0} height="5" rx="2.5" fill={PLEAT} />
    </>
  )
}

/** 大眾運輸：兩節蒸籠疊成的捷運車廂，熊熊滾在第一節的窗裡，後面那節的窗裡坐著小籠包，蓋子上冒蒸氣 */
function Transit({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <g className="ride-bob">
        <g>
          <Steam x={46} y={74} />
          <Steam x={108} y={74} />
        </g>
        {/* 後面那節：兩個窗，各坐一顆小籠包 */}
        <rect x="16" y="98" width="122" height="68" rx="12" fill={BAMBOO} />
        <rect x="28" y="108" width="46" height="34" rx="6" fill={LIGHT} />
        <rect x="82" y="108" width="46" height="34" rx="6" fill={LIGHT} />
        <Bun cx={51} by={142} s={0.34} />
        <Bun cx={105} by={142} s={0.34} />
        <SteamerBands x0={16} x1={138} />
        <Lid x0={20} x1={134} />
        <rect x="134" y="148" width="22" height="9" rx="4.5" fill={INK} />
        {/* 第一節：熊熊滾從窗裡露出臉，車身在熊前面，窗是挖空的 */}
        <rect x="182" y="106" width="68" height="40" rx="6" fill={LIGHT} />
        {bear({ x: 176, y: 92, size: 80 })}
        <path
          fillRule="evenodd"
          d="M162 98 H250 C270 98 284 116 284 136 V154 Q284 166 272 166 H162 Q150 166 150 154 V110 Q150 98 162 98 Z M188 106 H244 Q250 106 250 112 V140 Q250 146 244 146 H188 Q182 146 182 140 V112 Q182 106 188 106 Z"
          fill={BAMBOO}
        />
        <path d="M258 106 C268 108 276 118 278 130 Q278 136 272 136 H262 Q258 136 258 132 Z" fill={LIGHT} />
        <SteamerBands x0={150} x1={284} />
        <Lid x0={154} x1={262} />
        <circle cx="278" cy="152" r="5" fill={STAR} />
      </g>
      {[40, 114, 178, 256].map((cx) => (
        <Wheel key={cx} cx={cx} cy={175} r={12} />
      ))}
    </>
  )
}

/** 走路：熊熊滾站在一顆小籠包頂上（腳踩在收口後面），整顆一路彈過去（落地壓扁、彈起拉長） */
function Walk({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <g className="ride-bounce">
        {bear({ x: 104, y: 26, size: 92 })}
        <Bun cx={150} by={186} s={1.25} />
      </g>
    </>
  )
}

export const taipei: CityVehicles = { drive: Drive, scooter: Scooter, transit: Transit, walk: Walk }
