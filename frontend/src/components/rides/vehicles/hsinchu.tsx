import { INK, PROP, STAR } from "@/components/rides/vehicles/colors"
import { Ground, Wheel } from "@/components/rides/vehicles/parts"
import type { CityVehicles, VehicleProps } from "@/components/rides/vehicles/types"

/**
 * 新竹市（貢丸）的四種座騎（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md〈座騎〉）：
 * 貢丸當車身、機車的兩個輪子是貢丸、竹籤串三顆貢丸當列車、踩著貢丸滾（風城的風）。照使用者選的草圖（方向 A）畫。
 */

// 貢丸的三個顏色：肉、左上的亮面（竹籤也用它）、肉粒
const MEAT = "#B98256"
const MEAT_LIGHT = "#D6A77A"
const MEAT_BIT = "#8E5D37"

// 半徑 50 的貢丸上，肉粒的 [x, y, 半徑]
const BITS: [number, number, number][] = [
  [-22, 8, 5], [12, -14, 4], [26, 12, 4.5], [-4, 28, 4],
  [32, -22, 3], [-34, -6, 3], [6, 8, 3], [18, 32, 3],
]

/** 一顆貢丸：咖啡色的圓、左上一道亮面、幾顆肉粒。照半徑 50 畫再縮放；要滾的話在外面包 .ride-roll */
function Meatball({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g transform={`translate(${cx} ${cy}) scale(${r / 50})`}>
      <circle r="50" fill={MEAT} />
      <ellipse cx="-17" cy="-24" rx="19" ry="8" fill={MEAT_LIGHT} transform="rotate(-28 -17 -24)" />
      {BITS.map(([x, y, size]) => (
        <circle key={`${x},${y}`} cx={x} cy={y} r={size} fill={MEAT_BIT} />
      ))}
    </g>
  )
}

/** 開車：整顆貢丸（橫的橢圓）當車身，熊坐在裡面露出頭，車頭一顆黃色車燈 */
function Drive({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <g className="ride-bob">
        {bear({ x: 92, y: -4, size: 116 })}
        <ellipse cx="150" cy="126" rx="92" ry="52" fill={MEAT} />
        <ellipse cx="112" cy="98" rx="26" ry="9" fill={MEAT_LIGHT} transform="rotate(-14 112 98)" />
        {[[96, 132, 5], [134, 146, 4], [176, 104, 4.5], [200, 138, 4.5], [152, 120, 3], [76, 112, 3], [222, 112, 3]].map(
          ([x, y, size]) => (
            <circle key={`${x},${y}`} cx={x} cy={y} r={size} fill={MEAT_BIT} />
          ),
        )}
        <circle cx="238" cy="126" r="7" fill={STAR} />
      </g>
      <Wheel cx={100} cy={168} r={20} />
      <Wheel cx={200} cy={168} r={20} />
    </>
  )
}

/** 機車：淺紫的車身與把手，兩個輪子是貢丸（整顆滾），熊坐在深色座墊上 */
function Scooter({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <g className="ride-roll">
        <Meatball cx={85} cy={158} r={29} />
      </g>
      <g className="ride-roll">
        <Meatball cx={229} cy={158} r={29} />
      </g>
      <g className="ride-bob">
        {bear({ x: 80, y: 20, size: 100 })}
        <path d="M58 150 C58 124 76 112 104 112 H170 C178 112 182 120 180 128 L174 150 Z" fill={PROP} />
        <rect x="160" y="140" width="64" height="12" rx="6" fill={PROP} />
        <line x1="226" y1="148" x2="212" y2="74" stroke={PROP} strokeWidth="18" strokeLinecap="round" />
        <line x1="198" y1="72" x2="228" y2="66" className="ride-ink" stroke={INK} strokeWidth="7" strokeLinecap="round" />
        <rect x="92" y="102" width="80" height="14" rx="7" className="ride-ink" fill={INK} />
        <circle cx="229" cy="96" r="6" fill={STAR} />
      </g>
    </>
  )
}

/** 大眾運輸：竹籤串著三顆貢丸當列車，熊坐在最前面那顆，每顆底下兩個小輪子 */
function Transit({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <g className="ride-bob">
        <line x1="18" y1="132" x2="286" y2="132" stroke={MEAT_LIGHT} strokeWidth="7" strokeLinecap="round" />
        {bear({ x: 190, y: 42, size: 84 })}
        <Meatball cx={72} cy={132} r={34} />
        <Meatball cx={150} cy={132} r={34} />
        <Meatball cx={228} cy={132} r={34} />
        <circle cx="262" cy="128" r="6" fill={STAR} />
      </g>
      {/* 輪子不跟著浮，底部貼在地面（y 187） */}
      {[61, 85, 139, 163, 217, 241].map((cx) => (
        <Wheel key={cx} cx={cx} cy={175} r={12} />
      ))}
    </>
  )
}

/** 走路：熊站在一顆大貢丸上踏步，貢丸往前滾；左邊三條風線吹過去（新竹是風城） */
function Walk({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      {/* 三條風線放同一組：ride.css 用 nth-of-type 錯開時間；往左吹到盡頭也不出畫布 */}
      <g>
        <path className="ride-wind" d="M40 58 Q62 50 84 58" fill="none" stroke={PROP} strokeWidth="5" strokeLinecap="round" />
        <path className="ride-wind" d="M34 86 Q60 78 86 86" fill="none" stroke={PROP} strokeWidth="5" strokeLinecap="round" />
        <path className="ride-wind" d="M44 114 Q64 107 84 114" fill="none" stroke={PROP} strokeWidth="5" strokeLinecap="round" />
      </g>
      <g className="ride-roll">
        <Meatball cx={150} cy={142} r={46} />
      </g>
      <g className="ride-step">{bear({ x: 102, y: 11, size: 96 })}</g>
    </>
  )
}

export const hsinchu: CityVehicles = { drive: Drive, scooter: Scooter, transit: Transit, walk: Walk }
