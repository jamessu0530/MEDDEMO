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
