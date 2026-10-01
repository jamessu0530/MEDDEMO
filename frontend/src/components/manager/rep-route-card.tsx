import { ChevronRight, CircleMinus, Clock, MapPin } from "lucide-react"
import { Link } from "react-router"

import type { RepRoute } from "@/api/team-routes"
import { LiveAvatar } from "@/components/user-avatar"
import { lateLine, nextStopLine, progressLine, removedLine, routeColorVar } from "@/lib/team-routes"

/** 團隊總覽的一張卡：頭像、進度、現在在哪、下一站，以及要主管注意的事（拿掉系統排的站、會晚到、還沒動過）。點了進詳細 */
export function RepRouteCard({ route }: { route: RepRoute }) {
  const removed = removedLine(route.removed)
  const late = lateLine(route.stops)
  const next = nextStopLine(route.stops)
  const percent = route.total ? Math.round((route.done / route.total) * 100) : 0
  return (
    <Link
      to={`/manager?view=routes&rep=${route.rep.id}`}
      className="flex flex-col gap-2 rounded-2xl border-2 bg-card p-4 shadow-lip press"
    >
      <div className="flex items-center gap-2.5">
        <LiveAvatar id={route.rep.id} name={route.rep.name} />
        <div className="min-w-0 flex-1">
          <p className="leading-snug font-semibold">{route.rep.name}</p>
          <p className="text-xs text-muted-foreground tabular-nums">{progressLine(route)}</p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </div>
      {/* 進度條用這位業務在地圖上的顏色 */}
      <div
        role="progressbar"
        aria-label="今天的進度"
        aria-valuemin={0}
        aria-valuemax={route.total}
        aria-valuenow={route.done}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full" style={{ width: `${percent}%`, background: `var(${routeColorVar(route.rep.id)})` }} />
      </div>
      <p className="flex items-start gap-1.5 text-xs text-primary">
        <MapPin className="mt-0.5 size-3.5 shrink-0" />
        {route.location.text}
      </p>
      {next && <p className="text-xs">{next}</p>}
      {removed && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <CircleMinus className="mt-0.5 size-3.5 shrink-0" />
          {removed}
        </p>
      )}
      {late && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <Clock className="mt-0.5 size-3.5 shrink-0" />
          {late}
        </p>
      )}
      {route.untouched && <p className="text-xs text-muted-foreground">照系統建議，還沒動過</p>}
    </Link>
  )
}
