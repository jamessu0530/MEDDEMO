import "./taichung.css"

import { INK, LIGHT, PROP, STAR, TONGUE } from "@/components/rides/vehicles/colors"
import { Ground, Wheel } from "@/components/rides/vehicles/parts"
import type { CityVehicles, VehicleProps } from "@/components/rides/vehicles/types"

/**
 * 台中市（珍珠奶茶）的四種座騎（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md〈座騎〉）：
 * 珍奶杯橫躺當車身、吸管斜插當天線；機車的兩個輪子是大珍珠；直立的大杯珍奶當公車，窗裡坐著熊和珍珠；
 * 踩著一顆顆珍珠跳過去。杯子是奶茶色的圓角梯形，沒裝到奶茶的透明杯身與反光用淺一點的奶茶色，吸管是粉紅的粗線。
 */

// 珍奶的三個顏色：奶茶、透明的杯身與反光、珍珠
const TEA = "#D29A66"
const CLEAR = "#F2DEC6"
const PEARL = "#4A2C20"

const r2 = (v: number) => Math.round(v * 100) / 100

/** 圓角多邊形：每個點 [x, y, 圓角半徑]，角用二次曲線修圓 */
function roundedPath(points: [number, number, number][]) {
  const n = points.length
  const corners = points.map(([x, y, r], i) => {
    const [px, py] = points[(i + n - 1) % n]
    const [nx, ny] = points[(i + 1) % n]
    const a = r / Math.hypot(px - x, py - y)
    const b = r / Math.hypot(nx - x, ny - y)
    const from = `${r2(x + (px - x) * a)} ${r2(y + (py - y) * a)}`
    const to = `${r2(x + (nx - x) * b)} ${r2(y + (ny - y) * b)}`
    return `${i === 0 ? "M" : "L"}${from} Q${x} ${y} ${to}`
  })
  return `${corners.join(" ")} Z`
}

/** 一顆珍珠：深色的圓，左上一點反光 */
function Pearl({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={PEARL} />
      <circle cx={cx - r * 0.36} cy={cy - r * 0.36} r={r * 0.26} fill={CLEAR} />
    </g>
  )
}

/** 機車輪子的大珍珠：照半徑 50 畫再縮放，一大一小兩道反光，外面包 .ride-roll 轉起來看得出來 */
function BigPearl({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g transform={`translate(${cx} ${cy}) scale(${r / 50})`}>
      <circle r="50" fill={PEARL} />
      <ellipse cx="-20" cy="-22" rx="15" ry="8" fill={CLEAR} transform="rotate(-42 -20 -22)" />
      <circle cx="-34" cy="-2" r="4.5" fill={CLEAR} />
      <ellipse cx="24" cy="28" rx="9" ry="4" fill={TEA} transform="rotate(-42 24 28)" />
    </g>
  )
}

/**
 * 一小杯直立的珍奶：底邊中心 (cx, by)，杯口寬 w、高 h。由後往前疊：吸管（插在杯子裡，從封膜斜斜伸出來）、
 * 奶茶色的杯身、上面一截透明的杯身、杯底的珍珠、杯口的封膜邊。
 */
function Cup({ cx, by, w, h }: { cx: number; by: number; w: number; h: number }) {
  const top = by - h
  const a = w / 2
  const b = w * 0.4
  const band = top + h * 0.24
  // 側邊在高度 y 時的半寬
  const side = (y: number) => a - ((a - b) * (y - top)) / h
  return (
    <g>
      <line
        x1={cx + w * 0.06}
        y1={top + h * 0.3}
        x2={cx + w * 0.36}
        y2={top - h * 0.42}
        stroke={TONGUE}
        strokeWidth={w * 0.16}
        strokeLinecap="round"
      />
      <path d={roundedPath([[cx - a, top, w * 0.05], [cx + a, top, w * 0.05], [cx + b, by, w * 0.14], [cx - b, by, w * 0.14]])} fill={TEA} />
      <path d={roundedPath([[cx - a, top, w * 0.05], [cx + a, top, w * 0.05], [cx + side(band), band, 0], [cx - side(band), band, 0]])} fill={CLEAR} />
      {[-0.2, 0, 0.2].map((k) => (
        <circle key={k} cx={cx + k * w} cy={by - w * 0.15} r={w * 0.11} fill={PEARL} />
      ))}
      <rect x={cx - a - w * 0.05} y={top - w * 0.06} width={w * 1.1} height={w * 0.12} rx={w * 0.06} fill={TEA} />
    </g>
  )
}

// 橫躺的杯子（開車）：就是公車那個直立的杯子轉九十度躺下來，杯口在左（後面），杯底在右（車頭）。
// 杯口的封膜邊比杯身高一點，緊接著一截透明的杯身，再來是奶茶；珍珠沉在下面
const LYING_TOP = (x: number) => 72 + (16 * (x - 56)) / 188
const LYING_CUP = roundedPath([[56, 72, 6], [244, 88, 22], [244, 156, 22], [56, 172, 6]])
const LYING_AIR = roundedPath([[56, 72, 6], [80, LYING_TOP(80), 0], [80, 244 - LYING_TOP(80), 0], [56, 172, 6]])
// 杯子裡的珍珠 [x, y, 半徑]：沉在下半截，避開兩個輪子
const LYING_PEARLS: [number, number, number][] = [
  [94, 150, 7], [122, 143, 7], [138, 156, 8], [157, 146, 8], [173, 155, 7], [190, 138, 7], [226, 142, 7], [214, 127, 6],
]

/** 開車：珍奶杯橫躺當車身，熊熊滾坐在靠杯口那頭、從杯子裡探出頭，吸管從杯口的封膜斜插出來當天線，杯底是車頭、一顆黃色車燈 */
function Drive({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <g className="ride-bob">
        <line x1="58" y1="116" x2="22" y2="48" stroke={TONGUE} strokeWidth="11" strokeLinecap="round" />
        {bear({ x: 74, y: 4, size: 112 })}
        <path d={LYING_CUP} fill={TEA} />
        <path d={LYING_AIR} fill={CLEAR} />
        <rect x="94" y="96" width="70" height="7" rx="3.5" fill={CLEAR} />
        <rect x="172" y="97" width="18" height="7" rx="3.5" fill={CLEAR} />
        {LYING_PEARLS.map(([x, y, r]) => (
          <Pearl key={`${x},${y}`} cx={x} cy={y} r={r} />
        ))}
        <rect x="44" y="66" width="16" height="112" rx="7" fill={TEA} />
        <circle cx="234" cy="122" r="7" fill={STAR} />
      </g>
      <Wheel cx={104} cy={168} r={20} />
      <Wheel cx={200} cy={168} r={20} />
    </>
  )
}

/** 機車：淺紫的車身與把手，兩個輪子是大珍珠（整顆滾），腳踏板上放著一杯珍奶，熊坐在深色座墊上 */
function Scooter({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <g className="ride-roll">
        <BigPearl cx={85} cy={158} r={29} />
      </g>
      <g className="ride-roll">
        <BigPearl cx={229} cy={158} r={29} />
      </g>
      <g className="ride-bob">
        {bear({ x: 80, y: 20, size: 100 })}
        <path d="M58 150 C58 124 76 112 104 112 H170 C178 112 182 120 180 128 L174 150 Z" fill={PROP} />
        <Cup cx={193} by={142} w={26} h={32} />
        <rect x="160" y="140" width="64" height="12" rx="6" fill={PROP} />
        <line x1="226" y1="148" x2="212" y2="74" stroke={PROP} strokeWidth="18" strokeLinecap="round" />
        <line x1="198" y1="72" x2="228" y2="66" stroke={INK} strokeWidth="7" strokeLinecap="round" />
        <rect x="92" y="102" width="80" height="14" rx="7" fill={INK} />
        <circle cx="229" cy="96" r="6" fill={STAR} />
      </g>
    </>
  )
}

// 直立的大杯（公車）：杯口寬 164、杯底寬 132，y 52～168；側面兩個窗
const BUS_TOP = 52
const BUS_BOTTOM = 168
const busSide = (y: number) => 82 - (16 * (y - BUS_TOP)) / (BUS_BOTTOM - BUS_TOP)
const BUS_CUP = roundedPath([[68, BUS_TOP, 8], [232, BUS_TOP, 8], [216, BUS_BOTTOM, 18], [84, BUS_BOTTOM, 18]])
const BUS_AIR = roundedPath([[68, BUS_TOP, 8], [232, BUS_TOP, 8], [150 + busSide(72), 72, 0], [150 - busSide(72), 72, 0]])
const BUS_WINDOWS = [roundedPath([[90, 82, 7], [142, 82, 7], [142, 130, 7], [90, 130, 7]]), roundedPath([[152, 82, 7], [210, 82, 7], [210, 130, 7], [152, 130, 7]])]
// 杯底的珍珠 [x, y, 半徑]
const BUS_PEARLS: [number, number, number][] = [[100, 151, 9], [123, 155, 9], [147, 150, 9], [171, 155, 9], [195, 150, 9], [112, 139, 7], [184, 139, 7]]

/** 大眾運輸：一大杯直立的珍奶當公車，前面的窗裡是熊熊滾，後面的窗裡坐著兩顆珍珠，杯底沉著珍珠，底下兩個輪子 */
function Transit({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <g className="ride-bob">
        <line x1="172" y1="64" x2="210" y2="16" stroke={TONGUE} strokeWidth="12" strokeLinecap="round" />
        {/* 窗是挖空的：窗底下的淺紫、乘客、熊都畫在杯身後面 */}
        <path d={BUS_WINDOWS.join(" ")} fill={LIGHT} />
        <Pearl cx={104} cy={121} r={12} />
        <Pearl cx={128} cy={121} r={12} />
        {bear({ x: 131, y: 67, size: 100 })}
        <path fillRule="evenodd" d={[BUS_CUP, ...BUS_WINDOWS].join(" ")} fill={TEA} />
        <path d={BUS_AIR} fill={CLEAR} />
        <rect x="74" y="80" width="7" height="58" rx="3.5" fill={CLEAR} transform="rotate(-8 77.5 109)" />
        {BUS_PEARLS.map(([x, y, r]) => (
          <Pearl key={`${x},${y}`} cx={x} cy={y} r={r} />
        ))}
        <rect x="62" y="44" width="176" height="12" rx="6" fill={TEA} />
        <circle cx="212" cy="150" r="6" fill={STAR} />
      </g>
      <Wheel cx={110} cy={174} r={13} />
      <Wheel cx={190} cy={174} r={13} />
    </>
  )
}

// 走路：地上一灘奶茶，珍珠一顆顆泡在裡面（下面一截藏在奶茶後面），間隔 54；熊站在中間那顆上
const STEP = 54
const ROW_Y = 158
const ROW_R = 24
// 奶茶的表面是一排圓圓的小波浪
const POOL = `M16 179 Q16 168 30 168 ${Array.from({ length: 10 }, () => "q12 -5 24 0").join(" ")} Q284 168 284 179 Q284 186 276 186 H24 Q16 186 16 179 Z`

/**
 * 走路：熊熊滾踩著泡在奶茶裡的一排珍珠一顆一顆跳過去（.ride-hop），後面插著一根吸管。熊在空中時珍珠一起往左移一格，
 * 最左邊那顆縮小不見、最右邊冒出一顆新的，落地時剛好又踩在下一顆上（taichung.css，跟 ride-hop 同一個節拍）。
 */
function Walk({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <line x1="38" y1="174" x2="18" y2="96" stroke={TONGUE} strokeWidth="12" strokeLinecap="round" />
      <g className="ride-hop">{bear({ x: 96, y: 46, size: 108 })}</g>
      <g className="ride-taichung-out">
        <Pearl cx={150 - 2 * STEP} cy={ROW_Y} r={ROW_R} />
      </g>
      <g className="ride-taichung-row">
        {[-1, 0, 1, 2].map((k) => (
          <Pearl key={k} cx={150 + k * STEP} cy={ROW_Y} r={ROW_R} />
        ))}
      </g>
      <g className="ride-taichung-in">
        <Pearl cx={150 + 2 * STEP} cy={ROW_Y} r={ROW_R} />
      </g>
      <path d={POOL} fill={TEA} />
      {[60, 118, 176, 232].map((x) => (
        <rect key={x} x={x} y="176" width="22" height="5" rx="2.5" fill={CLEAR} />
      ))}
    </>
  )
}

export const taichung: CityVehicles = { drive: Drive, scooter: Scooter, transit: Transit, walk: Walk }
