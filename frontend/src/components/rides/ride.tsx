import "./ride.css"

import type { LegMode } from "@/api/route"
import { MascotFigure } from "@/components/mascot"
import { Ground } from "@/components/rides/vehicles/parts"
import { VEHICLES } from "@/components/rides/vehicles"
import type { BearAt } from "@/components/rides/vehicles/types"
import type { MascotState } from "@/lib/mascot"
import { rideCity } from "@/lib/rides"
import { cn } from "@/lib/utils"

/**
 * 熊熊滾騎著「這個縣市 × 這種交通方式」的座騎（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md〈座騎〉）。
 * 畫布 0 0 300 200、座騎朝右；flipped 時整組左右翻過來（往左走）。still 時動畫全停（圖鑑平常的樣子）。
 * 不在七個縣市裡的：沒有座騎，熊熊滾用等待的踏步自己走。
 */
export function Ride({
  city,
  mode,
  size = 96,
  flipped = false,
  still = false,
  label,
  className,
}: {
  city: string
  mode: LegMode
  /** 寬（px）；高是寬的三分之二 */
  size?: number
  flipped?: boolean
  still?: boolean
  label?: string
  className?: string
}) {
  const known = rideCity(city)
  // 直接查模組層的表（跟 MODE_ICON[mode] 一樣）：react-hooks 的 lint 把函式回傳的元件當成每次 render 新做的。
  // 七個縣市的座騎都在，只有不認得的縣市沒有
  const Vehicle = known ? VEHICLES[known][mode] : undefined
  return (
    <svg
      className={cn("ride", `ride-${mode}`, still && "ride-still", className)}
      viewBox="0 0 300 200"
      width={size}
      height={Math.round((size * 2) / 3)}
      xmlns="http://www.w3.org/2000/svg"
      data-city={known ?? "other"}
      data-mode={mode}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <g transform={flipped ? "matrix(-1 0 0 1 300 0)" : undefined}>
        {Vehicle ? (
          <Vehicle bear={(at) => <Bear at={at} />} />
        ) : (
          <>
            <Ground />
            <Bear at={{ x: 90, y: 80, size: 120 }} state="wait" />
          </>
        )}
      </g>
    </svg>
  )
}

/** 熊熊滾放在座騎畫布的 at；外層掛狀態的 class，mascot.css 的動畫才套得上 */
function Bear({ at, state = "ride" }: { at: BearAt; state?: MascotState }) {
  return (
    <g transform={`translate(${at.x} ${at.y}) scale(${at.size / 240})`}>
      <g className={`mascot mascot-${state}`}>
        <MascotFigure state={state} props={false} />
      </g>
    </g>
  )
}
