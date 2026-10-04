import { Navigation } from "lucide-react"

import { SIGNAL_LABEL, type MapStop, type RouteStop } from "@/api/route"
import { DriveSource } from "@/components/route/drive-source"
import { buttonVariants } from "@/components/ui/button"
import { navigationUrl, stopHeading } from "@/lib/home-map"
import { signalTone, TONE_CLASS } from "@/lib/route-path"
import { cn } from "@/lib/utils"

/**
 * 首頁地圖底部那張卡：一站的第幾站、時間、店名、理由與車程，還沒去的加一顆「導航」打開 Google 地圖。
 * 不碰 Google 地圖的程式，跟著首頁一起打包；地圖本身在 home-map.tsx 另外載入。
 */
export function MapStopCard({
  stop,
  detail,
  estimated,
  className,
}: {
  stop: MapStop
  // 首頁行程裡的同一站：時間、理由與車程從這裡來；地圖跟行程差了一版時找不到
  detail: RouteStop | undefined
  estimated: boolean
  className?: string
}) {
  const done = stop.status === "done"
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border-2 bg-card p-3 shadow-lip", className)}>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-primary tabular-nums">{stopHeading(stop, detail)}</p>
        <p className="mt-0.5 truncate text-base leading-snug font-semibold">{stop.customer_name}</p>
        {detail && (
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {done ? (
              `已完成${detail.visit_id ? " · 已回寫" : ""}`
            ) : (
              <>
                {detail.window_kind && detail.late_minutes > 0 ? (
                  <span className="font-semibold text-destructive">會晚到 {detail.late_minutes} 分</span>
                ) : (
                  <span className={cn("font-semibold", TONE_CLASS[signalTone(detail.signal)])}>{SIGNAL_LABEL[detail.signal]}</span>
                )}
                {/* 車程與來源一起換行，「Google Maps」不會被拆成兩行 */}
                {detail.travel_minutes != null && (
                  <span className="whitespace-nowrap">
                    {` · 車程約 ${detail.travel_minutes} 分`}
                    <DriveSource estimated={estimated} />
                  </span>
                )}
              </>
            )}
          </p>
        )}
      </div>
      {!done && (
        <a
          href={navigationUrl(stop)}
          target="_blank"
          rel="noreferrer"
          className={cn(buttonVariants(), "h-11 shrink-0 gap-1.5 px-4")}
        >
          <Navigation className="size-4" />
          導航
        </a>
      )}
    </div>
  )
}
