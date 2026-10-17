import { Flag } from "@/components/icons"

import type { RepRoute } from "@/api/team-routes"
import { RoutePath } from "@/components/route-path"
import { TRAVEL_MODE_LABEL } from "@/lib/travel-mode"

/** 主管查看同一份業務路線；站點只展開資訊，進度由業務端更新。 */
export function RepRoutePath({ route, backTo }: { route: RepRoute; backTo: string }) {
  return (
    <section aria-label={`${route.rep.name}的今日路線`} className="mx-auto w-full max-w-[27.5rem]">
      <div className="mb-3 flex items-center gap-3 rounded-2xl bg-primary px-4 py-2.5 text-primary-foreground shadow-lip-primary">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold opacity-85">{route.total} 站 · {TRAVEL_MODE_LABEL[route.travel_mode]}</p>
          <h2 className="text-xl leading-snug font-semibold">今日路線</h2>
        </div>
        <span className="flex items-center gap-1 text-sm font-semibold tabular-nums">
          <Flag className="size-5 fill-current" />
          <span className="sr-only">今日進度</span>
          {route.done}/{route.total}
        </span>
      </div>
      {route.stops.length > 0 ? (
        <RoutePath
          stops={route.stops}
          dayMode={route.travel_mode}
          officeStart={route.office_start}
          startCity={route.start_city}
          readOnly
          backTo={backTo}
        />
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">今天沒有排定的拜訪。</p>
      )}
    </section>
  )
}
