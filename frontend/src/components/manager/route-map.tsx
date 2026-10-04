import { useState } from "react"
import { AdvancedMarker, APIProvider, ColorScheme, InfoWindow, Map, Polyline } from "@vis.gl/react-google-maps"

import type { MapsConfig } from "@/api/maps"
import type { RemovedStop, RepRoute, TeamStop } from "@/api/team-routes"
import { LoadWatch } from "@/components/map-load-watch"
import { UserAvatar } from "@/components/user-avatar"
import { cssColor } from "@/lib/css-color"
import { useSkin } from "@/lib/skin"
import { boundsOf, DONE_OPACITY, legPaths, routeColorVar, TAIWAN, TODO_OPACITY } from "@/lib/team-routes"
import { cn } from "@/lib/utils"

type Props = {
  config: NonNullable<MapsConfig>
  routes: RepRoute[]
  removed?: RemovedStop[]
  onFail: () => void
}

type Selected = { stop: TeamStop; repName: string }

/**
 * 主管頁的地圖（Google Maps JavaScript API，docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈地圖〉）。
 * 這支連同 @vis.gl/react-google-maps 只由 map-slot.tsx 用 import() 載入，另外打包，不算進業務首頁的下載量。
 * 金鑰被拒或 Google 的程式載不下來時呼叫 onFail，由外面換成一行「地圖暫時載入不了」。
 */
export default function RouteMap({ config, routes, removed = [], onFail }: Props) {
  const [selected, setSelected] = useState<Selected | null>(null)
  const skin = useSkin()
  const points = [
    ...routes.flatMap((route) => [
      ...(route.origin ? [route.origin] : []),
      ...route.stops,
      ...(route.location.lat != null && route.location.lng != null ? [{ lat: route.location.lat, lng: route.location.lng }] : []),
    ]),
    ...removed,
  ]
  const bounds = boundsOf(points) ?? TAIWAN
  return (
    <APIProvider apiKey={config.browser_key} language="zh-TW" region="TW" onError={onFail}>
      <LoadWatch onFail={onFail} />
      <div className="h-64 overflow-hidden rounded-2xl border-2 shadow-lip">
        {/* 地圖跟著 App 的深淺色：線的顏色是主題色，深色主題的線很淡，畫在淺色地圖上會看不見。
            換配色時重建地圖（colorScheme 只在建立時讀） */}
        <Map
          key={skin}
          mapId={config.map_id}
          colorScheme={skin === "dark" ? ColorScheme.DARK : ColorScheme.LIGHT}
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

/** 一位業務的路線：沿路的線（跑完的段深色、還沒去的淡色）與圓形編號（已完成實心、還沒去空心） */
function RouteLayer({ route, onSelect }: { route: RepRoute; onSelect: (stop: TeamStop) => void }) {
  const colorVar = routeColorVar(route.rep.id)
  const color = cssColor(colorVar)
  return (
    <>
      {/* 大眾運輸的走路畫虛線，其他（開車、機車、搭車）畫實線 */}
      {legPaths(route).flatMap((leg, n) =>
        leg.pieces.map((piece, m) => (
          <Polyline
            key={`${n}-${m}`}
            path={piece.path}
            strokeColor={color}
            strokeOpacity={piece.walk ? 0 : leg.done ? DONE_OPACITY : TODO_OPACITY}
            strokeWeight={5}
            icons={
              piece.walk
                ? [{ icon: { path: "M 0,-1 0,1", scale: 3, strokeColor: color, strokeOpacity: leg.done ? DONE_OPACITY : TODO_OPACITY }, offset: "0", repeat: "12px" }]
                : undefined
            }
            clickable={false}
          />
        ))
      )}
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
      <RepMarker route={route} />
    </>
  )
}

/** 業務的頭像在他最新的位置；暫停、沒權限或超過 5 分鐘沒更新時變灰。下班時間或今天還沒有位置就不畫 */
function RepMarker({ route }: { route: RepRoute }) {
  const { location } = route
  if (location.lat == null || location.lng == null) return null
  return (
    <AdvancedMarker
      position={{ lat: location.lat, lng: location.lng }}
      title={`${route.rep.name}：${location.text}`}
      anchorLeft="-50%"
      anchorTop="-50%"
      zIndex={10}
    >
      <span
        className={cn("block rounded-full border-[3px] bg-background shadow-sm", !location.live && "opacity-70 grayscale")}
        style={{ borderColor: location.live ? `var(${routeColorVar(route.rep.id)})` : "var(--muted-foreground)" }}
      >
        <UserAvatar id={route.rep.id} name={route.rep.name} size="sm" />
      </span>
    </AdvancedMarker>
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
