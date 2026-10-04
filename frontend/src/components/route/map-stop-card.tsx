import { Navigation } from "lucide-react"

import { SIGNAL_LABEL, type MapStop, type RouteStop, type TravelMode } from "@/api/route"
import { DriveSource } from "@/components/route/drive-source"
import { buttonVariants } from "@/components/ui/button"
import { navigationUrl, stopHeading } from "@/lib/home-map"
import { signalTone, TONE_CLASS } from "@/lib/route-path"
import { TRAVEL_MODE_LABEL } from "@/lib/travel-mode"
import { cn } from "@/lib/utils"

/**
 * 首頁地圖底部那張卡：一站的第幾站、時間、店名、理由與車程，還沒去的加一顆「導航」打開 Google 地圖。
 * 車程與導航照業務的交通方式；Google 的機車路線是測試版，Google 要求註明。
 * 不碰 Google 地圖的程式，跟著首頁一起打包；地圖本身在 home-map.tsx 另外載入。
 */
export function MapStopCard({
  stop,
  detail,
  estimated,
  mode,
  className,
}: {
  stop: MapStop
  // 首頁行程裡的同一站：時間、理由與車程從這裡來；地圖跟行程差了一版時找不到
  detail: RouteStop | undefined
  estimated: boolean
  mode: TravelMode
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
                {/* 理由、車程與來源各自整段換行：「合約快到期」「Google Maps」不會被拆成兩行 */}
                {detail.window_kind && detail.late_minutes > 0 ? (
                  <span className="font-semibold whitespace-nowrap text-destructive">會晚到 {detail.late_minutes} 分</span>
                ) : (
                  <span className={cn("font-semibold whitespace-nowrap", TONE_CLASS[signalTone(detail.signal)])}>
                    {SIGNAL_LABEL[detail.signal]}
                  </span>
                )}
                {/* 時間與來源各自不斷行，段與段之間用 <wbr> 留換行點（每段開頭的空白在不斷行的範圍裡，算不上換行點）：
                    「大眾運輸約 32 分 · Google Maps」太長時換到下一行，不會整串擠進右邊的導航鈕底下 */}
                {detail.travel_minutes != null && (
                  <>
                    <wbr />
                    <span className="whitespace-nowrap">{` · ${TRAVEL_MODE_LABEL[mode]}約 ${detail.travel_minutes} 分`}</span>
                    <wbr />
                    <span className="whitespace-nowrap">
                      <DriveSource estimated={estimated} />
                    </span>
                  </>
                )}
              </>
            )}
          </p>
        )}
        {mode === "scooter" && !estimated && (
          <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">Google 的機車路線是測試版，可能少了部分小路</p>
        )}
      </div>
      {!done && (
        <a
          href={navigationUrl(stop, mode)}
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
