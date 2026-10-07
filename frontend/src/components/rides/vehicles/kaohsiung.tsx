import "./kaohsiung.css"

import { INK, LIGHT, PROP, STAR } from "@/components/rides/vehicles/colors"
import { Ground, Wheel } from "@/components/rides/vehicles/parts"
import type { CityVehicles, VehicleProps } from "@/components/rides/vehicles/types"

/**
 * 高雄市（旗山香蕉）的四種座騎（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md〈座騎〉）：
 * 香蕉橫放當長車身、香蕉當機車的車身（彎的那一面朝上當座位）、一串香蕉當列車（香蕉梳的根部當車頭）、
 * 踩到香蕉皮一路滑過去。香蕉是黃色的彎月形，兩端收細，一端是深色的蒂、另一端一點深色的尖；
 * 底下一道深一點的黃，白底上看得出邊。
 */

// 香蕉的三個顏色：黃、底下的暗面與皮的稜、深色的蒂
const BANANA = "#FFD84A"
const BANANA_DARK = "#E2A72A"
const STEM = "#6B4A2E"

type Pt = [number, number]
const r1 = (v: number) => Math.round(v * 10) / 10
const pts = (list: Pt[]) => list.map(([x, y]) => `${r1(x)} ${r1(y)}`).join(" L")
const TS = Array.from({ length: 33 }, (_, i) => i / 32)

/**
 * 一根香蕉（側面，往下彎成彎月、兩端翹起）：兩端在 (x0, y)、(x1, y)，中間往下 sag，最粗 thick。
 * stem 是蒂在哪一端（另一端是深色的尖）。由下往上疊：蒂、黃色的香蕉、底下的暗面、上緣的反光、尖。
 */
function Banana({ x0, x1, y, sag, thick, stem = "left" }: { x0: number; x1: number; y: number; sag: number; thick: number; stem?: "left" | "right" }) {
  const w = x1 - x0
  // 中線是拋物線；法線朝下
  const mid = (t: number): Pt => [x0 + w * t, y + sag * 4 * t * (1 - t)]
  const normal = (t: number): Pt => {
    const dx = w
    const dy = sag * 4 * (1 - 2 * t)
    const len = Math.hypot(dx, dy)
    return [-dy / len, dx / len]
  }
  // 粗細：中間最粗，兩端收到兩成
  const th = (t: number) => thick * (0.22 + 0.78 * Math.sin(Math.PI * t) ** 0.8)
  // 離中線 k 個粗細的點（k 正的往下）
  const off = (t: number, k: number): Pt => {
    const [mx, my] = mid(t)
    const [nx, ny] = normal(t)
    return [mx + nx * th(t) * k, my + ny * th(t) * k]
  }
  const back = [...TS].reverse()
  const body = `M${pts([...TS.map((t) => off(t, -0.5)), ...back.map((t) => off(t, 0.5))])} Z`
  const shade = `M${pts([...TS.map((t) => off(t, 0.14)), ...back.map((t) => off(t, 0.5))])} Z`
  const shineTs = TS.filter((t) => t > 0.26 && t < 0.6)
  const shine = `M${pts([...shineTs.map((t) => off(t, -0.36)), ...[...shineTs].reverse().map((t) => off(t, -0.24))])} Z`
  // 蒂：從蒂那端順著香蕉的方向再伸出去一截
  const s = stem === "left" ? 0 : 1
  const tip = 1 - s
  const [sx, sy] = mid(s)
  const dir = stem === "left" ? -1 : 1
  const [nx, ny] = normal(s)
  // 切線 = 法線轉 90 度（朝右）：(ny, -nx)
  const ux = ny * dir
  const uy = -nx * dir
  const stemLen = thick * 0.36
  const [tx, ty] = mid(tip)
  const [tnx, tny] = normal(tip)
  const tux = -tny * dir
  const tuy = tnx * dir
  return (
    <g>
      <line
        x1={r1(sx - ux * 3)}
        y1={r1(sy - uy * 3)}
        x2={r1(sx + ux * stemLen)}
        y2={r1(sy + uy * stemLen)}
        stroke={STEM}
        strokeWidth={r1(thick * 0.24)}
        strokeLinecap="round"
      />
      <path d={body} fill={BANANA} />
      <path d={shade} fill={BANANA_DARK} />
      <path d={shine} fill="#fff" opacity=".6" />
      <circle cx={r1(tx + tux * 1.5)} cy={r1(ty + tuy * 1.5)} r={r1(thick * 0.13)} fill={STEM} />
    </g>
  )
}

/** 開車：一根大香蕉橫放當長車身，熊熊滾坐在中間彎下去的地方，底下兩個輪子 */
function Drive({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <g className="ride-bob">
        {bear({ x: 94, y: 36, size: 112 })}
        <Banana x0={34} x1={266} y={98} sag={42} thick={54} />
      </g>
      <Wheel cx={104} cy={168} r={20} />
      <Wheel cx={196} cy={168} r={20} />
    </>
  )
}

/** 機車：香蕉當車身，彎下去的那一面朝上當座位，熊熊滾坐在裡面；底下淺紫的車架連到前面的龍頭與把手，兩個輪子 */
function Scooter({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <Wheel cx={92} cy={167} r={20} />
      <Wheel cx={228} cy={167} r={20} />
      <g className="ride-bob">
        <rect x="80" y="142" width="146" height="12" rx="6" fill={PROP} />
        <line x1="228" y1="150" x2="212" y2="74" stroke={PROP} strokeWidth="16" strokeLinecap="round" />
        <line x1="198" y1="72" x2="228" y2="66" stroke={INK} strokeWidth="7" strokeLinecap="round" />
        <circle cx="228" cy="98" r="6" fill={STAR} />
        {bear({ x: 82, y: 52, size: 100 })}
        <Banana x0={56} x1={212} y={110} sag={30} thick={40} />
      </g>
    </>
  )
}

/**
 * 大眾運輸：一串香蕉當列車。最前面是香蕉梳的根部（深色的蒂頭當車頭，頂上一截切開的梗），
 * 後面三根香蕉當車廂，每根的蒂接在前一節的尾巴上串成一串；熊熊滾坐在第一根，每根底下一節淺紫的車台與兩個小輪子
 */
function Transit({ bear }: VehicleProps) {
  const cars = [20, 94, 168]
  return (
    <>
      <Ground />
      <g className="ride-bob">
        <line x1="262" y1="126" x2="270" y2="96" stroke={STEM} strokeWidth="18" strokeLinecap="round" />
        <ellipse cx="270" cy="94" rx="8" ry="4.5" fill={BANANA_DARK} transform="rotate(15 270 94)" />
        <path d="M240 158 C240 136 250 122 266 122 C280 122 288 136 288 158 Q288 166 280 166 H248 Q240 166 240 158 Z" fill={STEM} />
        <rect x="256" y="132" width="22" height="16" rx="5" fill={LIGHT} />
        <circle cx="281" cy="156" r="4.5" fill={STAR} />
        {bear({ x: 162, y: 74, size: 80 })}
        {cars.map((x) => (
          <g key={x}>
            <rect x={x + 6} y="156" width="56" height="9" rx="4.5" fill={PROP} />
            <Banana x0={x} x1={x + 68} y={124} sag={20} thick={34} stem="right" />
          </g>
        ))}
      </g>
      {/* 輪子不跟著浮，底部貼在地面（y 187） */}
      {[...cars.flatMap((x) => [x + 18, x + 50]), 264].map((cx) => (
        <Wheel key={cx} cx={cx} cy={176} r={11} />
      ))}
    </>
  )
}

/**
 * 香蕉皮的一瓣：沿著二次曲線 p0 → (控制點 p1) → p2 彎成拱形的帶子，根部寬 w0、尖端寬 w1，尖端是圓的。
 * 底下墊一層往下錯開的暗面，看起來是皮的厚度，白底上也看得出邊。
 */
function Petal({ p0, p1, p2, w0, w1 }: { p0: Pt; p1: Pt; p2: Pt; w0: number; w1: number }) {
  const at = (t: number): Pt => [
    (1 - t) ** 2 * p0[0] + 2 * t * (1 - t) * p1[0] + t * t * p2[0],
    (1 - t) ** 2 * p0[1] + 2 * t * (1 - t) * p1[1] + t * t * p2[1],
  ]
  const side = (t: number, k: number): Pt => {
    const dx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0])
    const dy = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1])
    const len = Math.hypot(dx, dy)
    const w = (w0 + (w1 - w0) * t) / 2
    const [x, y] = at(t)
    return [x - (dy / len) * w * k, y + (dx / len) * w * k]
  }
  const ts = Array.from({ length: 17 }, (_, i) => i / 16)
  const d = `M${pts([...ts.map((t) => side(t, 1)), ...[...ts].reverse().map((t) => side(t, -1))])} Z`
  return (
    <g>
      <g transform="translate(0 3.5)">
        <path d={d} fill={BANANA_DARK} />
        <circle cx={p2[0]} cy={p2[1]} r={w1 / 2} fill={BANANA_DARK} />
      </g>
      <path d={d} fill={BANANA} />
      <circle cx={p2[0]} cy={p2[1]} r={w1 / 2} fill={BANANA} />
    </g>
  )
}

/**
 * 香蕉皮：中間一截立著的根部，三瓣從根部頂上攤開成星形：左、右兩瓣往外彎成拱形、尖端落到地上（左邊那瓣的尖端連著蒂），
 * 前面一瓣直直垂下來蓋住根部（front 時只畫這瓣，要畫在熊前面擋住熊的腳）。底邊中心 (cx, by)，熊踩在根部頂上（約 by - 32）。
 */
function Peel({ cx, by, front = false }: { cx: number; by: number; front?: boolean }) {
  if (front) return <Petal p0={[cx, by - 32]} p1={[cx + 7, by - 22]} p2={[cx + 5, by - 11]} w0={28} w1={20} />
  return (
    <g>
      <line x1={cx - 82} y1={by - 8} x2={cx - 96} y2={by - 16} stroke={STEM} strokeWidth="7" strokeLinecap="round" />
      <Petal p0={[cx - 8, by - 30]} p1={[cx - 64, by - 56]} p2={[cx - 80, by - 8]} w0={22} w1={13} />
      <Petal p0={[cx + 8, by - 30]} p1={[cx + 64, by - 56]} p2={[cx + 80, by - 8]} w0={22} w1={13} />
      <path d={`M${cx - 12} ${by} V${by - 24} Q${cx - 12} ${by - 34} ${cx} ${by - 34} Q${cx + 12} ${by - 34} ${cx + 12} ${by - 24} V${by} Z`} fill={BANANA_DARK} />
    </g>
  )
}

/** 走路：熊熊滾踩到香蕉皮，整個人往後仰、一路滑過去（.ride-slide），香蕉皮跟著往前滑（kaohsiung.css），後面幾條風線 */
function Walk({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      {/* 三條風線放同一組：ride.css 用 nth-of-type 錯開時間；往左吹到盡頭也不出畫布 */}
      <g>
        <path className="ride-wind" d="M46 96 H80" fill="none" stroke={PROP} strokeWidth="5" strokeLinecap="round" />
        <path className="ride-wind" d="M40 122 H76" fill="none" stroke={PROP} strokeWidth="5" strokeLinecap="round" />
        <path className="ride-wind" d="M50 148 H80" fill="none" stroke={PROP} strokeWidth="5" strokeLinecap="round" />
      </g>
      <g className="ride-kaohsiung-skid">
        <Peel cx={150} by={186} />
        <g className="ride-slide">{bear({ x: 94, y: 54, size: 112 })}</g>
        <Peel cx={150} by={186} front />
      </g>
    </>
  )
}

export const kaohsiung: CityVehicles = { drive: Drive, scooter: Scooter, transit: Transit, walk: Walk }
