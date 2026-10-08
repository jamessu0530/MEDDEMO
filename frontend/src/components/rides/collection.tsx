import { useEffect, useRef, useState } from "react"

import type { LegMode } from "@/api/route"
import type { Vehicles } from "@/api/vehicles"
import { Ride } from "@/components/rides/ride"
import { formatTaipeiDateTime } from "@/lib/format"
import { RIDE_CITIES, SPECIALTY, type RideCity } from "@/lib/rides"
import { LEG_MODES, TRAVEL_MODE_LABEL } from "@/lib/travel-mode"
import { cn } from "@/lib/utils"

// 點騎過的：動幾毫秒再靜止
const PLAY_MS = 3000

/** 座騎圖鑑的內容：一個縣市一區、每區四張卡。騎過的有顏色，沒騎過的是灰色剪影 */
export function RideCollection({ vehicles }: { vehicles: Vehicles }) {
  const riddenAt = new Map(vehicles.items.map((item) => [`${item.city}|${item.mode}`, item.ridden_at]))
  // 點到哪一張：騎過的拿掉 still 動一下，沒騎過的在下面提示怎麼收集
  const [active, setActive] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  function tap(key: string, ridden: boolean) {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (ridden) {
      setActive(key)
      timer.current = setTimeout(() => setActive(null), PLAY_MS)
    } else {
      setActive((now) => (now === key ? null : key))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm font-semibold text-primary">
        已收集 {vehicles.ridden}/{vehicles.total}
      </p>
      {RIDE_CITIES.map((city) => (
        <section key={city} aria-label={city}>
          <h2 className="mb-2 text-sm font-semibold">
            {city}
            <span className="ml-2 text-xs font-normal text-muted-foreground">特產：{SPECIALTY[city]}</span>
          </h2>
          <ul className="grid grid-cols-2 gap-3">
            {LEG_MODES.map((mode) => {
              const key = `${city}|${mode}`
              const at = riddenAt.get(key) ?? null
              return (
                <li key={mode}>
                  <RideCard city={city} mode={mode} riddenAt={at} active={active === key} onTap={() => tap(key, at !== null)} />
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function RideCard({
  city,
  mode,
  riddenAt,
  active,
  onTap,
}: {
  city: RideCity
  mode: LegMode
  riddenAt: string | null
  active: boolean
  onTap: () => void
}) {
  const ridden = riddenAt !== null
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`${city}${TRAVEL_MODE_LABEL[mode]}，${ridden ? "騎過了" : "還沒騎過"}`}
      className={cn("flex w-full flex-col items-center rounded-2xl border-2 px-2 py-3 shadow-lip press", ridden ? "bg-card" : "bg-muted/50")}
    >
      {/* 濾鏡放在外層：Ride 自己的 .ride 沒進 layer，className 蓋不過它。
          剪影用 filter（brightness(0) 把線條與填色都變黑），不能改 fill，線條會被填滿；深色主題反白 */}
      <div className={cn(!ridden && "ride-silhouette brightness-0 opacity-25 dark:invert dark:opacity-30")}>
        <Ride city={city} mode={mode} size={140} still={!ridden || !active} />
      </div>
      <p className="mt-1 text-sm font-semibold">{TRAVEL_MODE_LABEL[mode]}</p>
      <p className="text-xs text-muted-foreground">{ridden ? `${formatTaipeiDateTime(riddenAt)} 第一次騎` : "還沒騎過"}</p>
      {!ridden && active && (
        <p className="mt-1 text-xs text-primary">
          在{city}選{TRAVEL_MODE_LABEL[mode]}就能收集
        </p>
      )}
    </button>
  )
}
