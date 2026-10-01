import { useEffect, useState } from "react"
import {
  AdvancedMarker,
  APILoadingStatus,
  APIProvider,
  InfoWindow,
  Map,
  Polyline,
  useApiLoadingStatus,
} from "@vis.gl/react-google-maps"

import type { MapsConfig, RemovedStop, RepRoute, TeamStop } from "@/api/team-routes"
import { boundsOf, legPaths, routeColorVar } from "@/lib/team-routes"

// 還沒有任何點時框住台灣本島
const TAIWAN = { north: 25.35, south: 21.85, east: 122.05, west: 119.95 }
// 已經跑完的段深色、還沒去的段淡色
const DONE_OPACITY = 0.95
const TODO_OPACITY = 0.35
// 讀不到 CSS 變數時用主色
const FALLBACK_COLOR = "#9B51E0"

type Props = {
  config: NonNullable<MapsConfig>
  routes: RepRoute[]
  removed?: RemovedStop[]
  onFail: () => void
}

type Selected = { stop: TeamStop; repName: string }

/** CSS 變數換成實際的顏色：Google 地圖的線畫在 canvas 上，不認 var(--primary) */
function cssColor(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || FALLBACK_COLOR
}

/**
 * 主管頁的地圖（Google Maps JavaScript API，docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈地圖〉）。
 * 這支連同 @vis.gl/react-google-maps 只由 map-slot.tsx 用 import() 載入，另外打包，不算進業務首頁的下載量。
 * 金鑰被拒或 Google 的程式載不下來時呼叫 onFail，由外面換成一行「地圖暫時載入不了」。
 */
export default function RouteMap({ config, routes, removed = [], onFail }: Props) {
  const [selected, setSelected] = useState<Selected | null>(null)
  const points = [
    ...routes.flatMap((route) => [...(route.origin ? [route.origin] : []), ...route.stops]),
    ...removed,
  ]
  const bounds = boundsOf(points) ?? TAIWAN
  return (
    <APIProvider apiKey={config.browser_key} language="zh-TW" region="TW" onError={onFail}>
      <LoadWatch onFail={onFail} />
      <div className="h-64 overflow-hidden rounded-2xl border-2 shadow-lip">
        <Map
          mapId={config.map_id}
          defaultBounds={{ ...bounds, padding: 32 }}
          gestureHandling="cooperative"
          disableDefaultUI
          clickableIcons={false}
          className="size-full"
        >
          {routes.map((route) => (
            <RouteLayer
              key={route.rep.id}
              route={route}
              onSelect={(stop) => setSelected({ stop, repName: route.rep.name })}
            />
          ))}
          {removed.map((stop) => (
            <AdvancedMarker
              key={stop.customer_id}
              position={{ lat: stop.lat, lng: stop.lng }}
              title={`${stop.customer_name}（拿掉）`}
              anchorLeft="-50%"
              anchorTop="-12px"
            >
              {/* 被拿掉的站：紅色虛線圈加「（拿掉）」 */}
              <span className="flex flex-col items-center">
                <span className="size-6 rounded-full border-2 border-dashed border-destructive bg-background/70" />
                <span className="mt-0.5 rounded bg-background/90 px-1 text-[0.625rem] font-semibold text-destructive">
                  （拿掉）
                </span>
              </span>
            </AdvancedMarker>
          ))}
          {selected && (
            <InfoWindow
              position={{ lat: selected.stop.lat, lng: selected.stop.lng }}
              pixelOffset={[0, -14]}
              onCloseClick={() => setSelected(null)}
              headerContent={<span className="text-sm font-semibold text-neutral-900">{selected.stop.customer_name}</span>}
            >
              {/* 資訊視窗的底一律是白的，不跟深色配色：字用固定的深灰 */}
              <p className="text-xs text-neutral-700">
                {selected.repName} · 第 {selected.stop.number} 站 · {selected.stop.planned_time}{" "}
                {selected.stop.status === "done" ? "完成" : "到"}
              </p>
            </InfoWindow>
          )}
        </Map>
      </div>
      {routes.length > 1 && <Legend routes={routes} />}
    </APIProvider>
  )
}

/** 金鑰被拒（AUTH_FAILURE）或程式載不下來（FAILED）：交給外面換成說明 */
function LoadWatch({ onFail }: { onFail: () => void }) {
  const status = useApiLoadingStatus()
  useEffect(() => {
    if (status === APILoadingStatus.FAILED || status === APILoadingStatus.AUTH_FAILURE) onFail()
  }, [status, onFail])
  return null
}

/** 一位業務的路線：沿路的線（跑完的段深色、還沒去的淡色）與圓形編號（已完成實心、還沒去空心） */
function RouteLayer({ route, onSelect }: { route: RepRoute; onSelect: (stop: TeamStop) => void }) {
  const colorVar = routeColorVar(route.rep.id)
  const color = cssColor(colorVar)
  return (
    <>
      {legPaths(route).map((leg, n) => (
        <Polyline
          key={n}
          path={leg.path}
          strokeColor={color}
          strokeOpacity={leg.done ? DONE_OPACITY : TODO_OPACITY}
          strokeWeight={5}
          clickable={false}
        />
      ))}
      {route.stops.map((stop) => {
        const done = stop.status === "done"
        return (
          <AdvancedMarker
            key={stop.customer_id}
            position={{ lat: stop.lat, lng: stop.lng }}
            title={`第 ${stop.number} 站 ${stop.customer_name}`}
            onClick={() => onSelect(stop)}
            anchorLeft="-50%"
            anchorTop="-50%"
          >
            <span
              className="flex size-6 items-center justify-center rounded-full border-2 text-[0.6875rem] font-bold tabular-nums shadow-sm"
              style={
                done
                  ? { background: `var(${colorVar})`, borderColor: `var(${colorVar})`, color: "var(--background)" }
                  : { background: "var(--background)", borderColor: `var(${colorVar})`, color: `var(${colorVar})` }
              }
            >
              {stop.number}
            </span>
          </AdvancedMarker>
        )
      })}
    </>
  )
}

/** 圖例：每位業務的顏色 */
function Legend({ routes }: { routes: RepRoute[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="圖例">
      {routes.map((route) => (
        <li key={route.rep.id} className="flex items-center gap-1.5">
          <span className="h-1.5 w-4 rounded-full" style={{ background: `var(${routeColorVar(route.rep.id)})` }} />
          {route.rep.name}
        </li>
      ))}
    </ul>
  )
}
