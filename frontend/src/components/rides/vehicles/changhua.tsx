import "./changhua.css"

import { INK, PROP, STAR } from "@/components/rides/vehicles/colors"
import { Ground, Wheel } from "@/components/rides/vehicles/parts"
import type { CityVehicles, VehicleProps } from "@/components/rides/vehicles/types"

/**
 * 彰化縣（肉圓）的四種座騎（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md〈座騎〉）：
 * 肉圓當車身、整台 Q 彈地彈；機車的兩個輪子是肉圓（從上面看的那一面）；一串肉圓當列車；在肉圓上彈跳，像跳跳床。
 * 肉圓是扁扁的圓頂，上面淋一圈紅褐色的醬（底邊是圓圓的波浪，像醬往下流），頂上一點香菜。
 * 半透明的外皮：底部一圈用醬色疊一層淡淡的（opacity），白底上也看得出邊。
 */

// 肉圓的三個顏色：外皮、醬、香菜
const SKIN = "#F1D5B5"
const SAUCE = "#B4472F"
const HERB = "#5BB462"

const r2 = (v: number) => Math.round(v * 100) / 100

/** 香菜：三片圓圓的葉子，中心 (x, y)，s 是大小（1 時葉子半徑 4） */
function Herb({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g>
      <circle cx={x} cy={y - 2.6 * s} r={3.8 * s} fill={HERB} />
      <circle cx={x - 3.8 * s} cy={y + 1.2 * s} r={3.2 * s} fill={HERB} />
      <circle cx={x + 3.8 * s} cy={y + 1.2 * s} r={3.2 * s} fill={HERB} />
    </g>
  )
}

/**
 * 一顆肉圓（側面）：底邊中心 (cx, by)，寬 w、外皮高 h（醬的頂再高一點）。照寬 100、高 46 的格子畫再換算。
 * 由下往上疊：外皮、底部一圈淡淡的醬色（半透明的邊）、醬（底邊是往下流的圓波浪）、醬上的反光、香菜（herb 是香菜離中心的格數，null 不放）。
 */
function Bawan({ cx, by, w, h, herb = 0 }: { cx: number; by: number; w: number; h: number; herb?: number | null }) {
  const kx = w / 100
  const ky = h / 46
  const p = (x: number, y: number) => `${r2(cx + x * kx)} ${r2(by + y * ky)}`
  const skin = `M${p(-38, 0)} C${p(-47, 0)} ${p(-52, -6)} ${p(-50, -14)} C${p(-46, -34)} ${p(-26, -46)} ${p(0, -46)} C${p(26, -46)} ${p(46, -34)} ${p(50, -14)} C${p(52, -6)} ${p(47, 0)} ${p(38, 0)} Z`
  const rim = `M${p(-50, -14)} C${p(-52, -6)} ${p(-47, 0)} ${p(-38, 0)} L${p(38, 0)} C${p(47, 0)} ${p(52, -6)} ${p(50, -14)} C${p(30, -5)} ${p(-30, -5)} ${p(-50, -14)} Z`
  const sauce = [
    `M${p(-47, -21)} C${p(-45, -38)} ${p(-26, -49.5)} ${p(0, -49.5)} C${p(26, -49.5)} ${p(45, -38)} ${p(47, -21)}`,
    // 往下流的醬：從右到左，一滴一滴圓圓的
    `C${p(47, -12)} ${p(37, -12)} ${p(37, -19)} Q${p(32, -23)} ${p(27, -19)}`,
    `C${p(27, -6)} ${p(15, -6)} ${p(15, -18)} Q${p(9, -23)} ${p(3, -19)}`,
    `C${p(3, -10)} ${p(-9, -10)} ${p(-9, -18)} Q${p(-15, -23)} ${p(-21, -19)}`,
    `C${p(-21, -5)} ${p(-33, -5)} ${p(-33, -17)} Q${p(-38, -22)} ${p(-42, -19)}`,
    `C${p(-42, -12)} ${p(-47, -13)} ${p(-47, -21)} Z`,
  ].join(" ")
  // 醬的頂在格子 x 的高度（兩段曲線跟這個半橢圓幾乎重合）
  const top = (x: number) => by + (-21 - 28.5 * Math.sqrt(Math.max(0, 1 - (x / 47) ** 2))) * ky
  return (
    <g>
      <path d={skin} fill={SKIN} />
      <path d={rim} fill={SAUCE} opacity=".3" />
      <path d={sauce} fill={SAUCE} />
      <ellipse
        cx={cx - 20 * kx}
        cy={by - 40 * ky}
        rx={9 * kx}
        ry={3 * ky}
        fill="#fff"
        opacity=".55"
        transform={`rotate(-14 ${r2(cx - 20 * kx)} ${r2(by - 40 * ky)})`}
      />
      {herb !== null && <Herb x={cx + herb * kx} y={top(herb) + 1.5 * ky} s={w / 100} />}
    </g>
  )
}

/** 從上面看的肉圓（機車的輪子）：一圈半透明的外皮，中間一攤圓波浪的醬、一點香菜；照半徑 50 畫再縮放，外面包 .ride-roll 就會滾 */
function BawanTop({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  // 醬的七個圓瓣：凹處半徑 26，每瓣往外鼓的控制點半徑不一樣，看起來是淋上去的
  const bulge = [42, 37, 44, 38, 43, 36, 41]
  const n = bulge.length
  const at = (deg: number, radius: number) => `${r2(radius * Math.cos((deg * Math.PI) / 180))} ${r2(radius * Math.sin((deg * Math.PI) / 180))}`
  const sauce = `M${at(0, 26)} ${bulge.map((b, i) => `Q${at(((i + 0.5) * 360) / n, b)} ${at(((i + 1) * 360) / n, 26)}`).join(" ")} Z`
  return (
    <g transform={`translate(${cx} ${cy}) scale(${r / 50})`}>
      <circle r="50" fill={SKIN} />
      <circle r="50" fill={SAUCE} opacity=".3" />
      <circle r="44" fill={SKIN} />
      <path d={sauce} fill={SAUCE} />
      <ellipse cx="-12" cy="-15" rx="9" ry="3.5" fill="#fff" opacity=".55" transform="rotate(-35 -12 -15)" />
      <Herb x={8} y={2} s={1.5} />
    </g>
  )
}

/** 開車：一顆大肉圓當車身，熊熊滾從醬裡探出頭，車頭一顆黃色車燈；整台 Q 彈地壓扁、拉長（changhua.css） */
function Drive({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <g className="ride-changhua-jiggle">
        {bear({ x: 84, y: 8, size: 112 })}
        <Bawan cx={150} by={172} w={212} h={84} herb={22} />
        <circle cx="244" cy="150" r="7" fill={STAR} />
      </g>
      <Wheel cx={102} cy={168} r={20} />
      <Wheel cx={198} cy={168} r={20} />
    </>
  )
}

/** 機車：淺紫的車身與把手，兩個輪子是從上面看的肉圓（整顆滾），熊坐在深色座墊上 */
function Scooter({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <g className="ride-roll">
        <BawanTop cx={85} cy={158} r={29} />
      </g>
      <g className="ride-roll">
        <BawanTop cx={229} cy={158} r={29} />
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

/** 大眾運輸：竹籤串著三顆肉圓當列車（照新竹的串法），熊熊滾坐在最前面那顆，每顆底下兩個小輪子 */
function Transit({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <g className="ride-bob">
        <line x1="12" y1="144" x2="288" y2="144" stroke={SAUCE} strokeWidth="6" strokeLinecap="round" />
        {bear({ x: 192, y: 62, size: 92 })}
        <Bawan cx={62} by={166} w={80} h={44} />
        <Bawan cx={150} by={166} w={80} h={44} />
        <Bawan cx={238} by={166} w={80} h={44} herb={36} />
        <circle cx="270" cy="154" r="5" fill={STAR} />
      </g>
      {/* 輪子不跟著浮，底部貼在地面（y 187） */}
      {[50, 74, 138, 162, 226, 250].map((cx) => (
        <Wheel key={cx} cx={cx} cy={175} r={12} />
      ))}
    </>
  )
}

/** 走路：熊熊滾在一顆大肉圓上彈跳，像跳跳床：熊落下時肉圓被壓扁、熊再彈高（changhua.css，兩個動畫同一個節拍） */
function Walk({ bear }: VehicleProps) {
  return (
    <>
      <Ground />
      <g className="ride-changhua-jump">{bear({ x: 102, y: 33, size: 96 })}</g>
      <g className="ride-changhua-squash">
        <Bawan cx={150} by={187} w={156} h={66} herb={30} />
      </g>
    </>
  )
}

export const changhua: CityVehicles = { drive: Drive, scooter: Scooter, transit: Transit, walk: Walk }
