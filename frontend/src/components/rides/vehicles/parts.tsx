import { INK, LIGHT } from "@/components/rides/vehicles/colors"

/** 座騎共用的小零件 */

/** 地面：一條淡色的線，座騎與熊都站在上面 */
export function Ground() {
  return <rect x="10" y="187" width="280" height="3" rx="1.5" fill="#E6E2EC" />
}

/** 會轉的輪子：深色的胎、淺紫的軸心，軸心旁一個點，轉起來看得出來 */
export function Wheel({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g className="ride-spin">
      <circle cx={cx} cy={cy} r={r} fill={INK} />
      <circle cx={cx} cy={cy} r={r * 0.38} fill={LIGHT} />
      <circle cx={cx + r * 0.6} cy={cy} r={r * 0.15} fill={LIGHT} />
    </g>
  )
}

const r2 = (v: number) => Math.round(v * 100) / 100

/** 圓角多邊形的 path：每個點 [x, y, 圓角半徑]，角用二次曲線修圓（台中的杯子、台南的魚鰭） */
export function roundedPath(points: [number, number, number][]) {
  const n = points.length
  const corners = points.map(([x, y, r], i) => {
    const [px, py] = points[(i + n - 1) % n]
    const [nx, ny] = points[(i + 1) % n]
    const a = r / Math.hypot(px - x, py - y)
    const b = r / Math.hypot(nx - x, ny - y)
    const from = `${r2(x + (px - x) * a)} ${r2(y + (py - y) * a)}`
    const to = `${r2(x + (nx - x) * b)} ${r2(y + (ny - y) * b)}`
    return `${i === 0 ? "M" : "L"}${from} Q${r2(x)} ${r2(y)} ${to}`
  })
  return `${corners.join(" ")} Z`
}
