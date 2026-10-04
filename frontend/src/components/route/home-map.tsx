import { useState } from "react"
import { AdvancedMarker, APIProvider, ColorScheme, Map, Polyline, useMap } from "@vis.gl/react-google-maps"
import { Check, LocateFixed } from "lucide-react"

import type { MapsConfig } from "@/api/maps"
import type { MapStop, RouteStop, TodayMap } from "@/api/route"
import type { LatLng } from "@/api/team-routes"
import { LoadWatch } from "@/components/map-load-watch"
import { MapStopCard } from "@/components/route/map-stop-card"
import { cssColor } from "@/lib/css-color"
import { shownStop } from "@/lib/home-map"
import { useLocationShare } from "@/lib/location-share"
import { useSkin } from "@/lib/skin"
import { boundsOf, DONE_OPACITY, legPaths, TAIWAN, TODO_OPACITY } from "@/lib/team-routes"
import { cn } from "@/lib/utils"

// 自己的位置用 Google 地圖慣用的藍點：一看就知道是「我在這」，不跟紫色的站點混在一起
const HERE_COLOR = "#1A73E8"
// 框住路線時四周留白；底下多留，路線不要被底部那張卡蓋住
const PADDING = { top: 64, right: 32, bottom: 136, left: 32 }

type Props = {
  config: NonNullable<MapsConfig>
  map: TodayMap
  // 首頁的行程：卡片上的時間、理由與車程從這裡找
  stops: RouteStop[]
  estimated: boolean
  className: string
  onFail: () => void
}

/**
 * 首頁「地圖」分頁（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈業務首頁的地圖〉）。
 * 自己今天的路線沿路畫出來：跑完的段深色、還沒去的淡色；站點跑完的打勾、下一站多一圈、還沒去的空心寫站號；
 * 藍點是自己的位置（位置分享中才有）。點站點，底下的卡換成那一站；點地圖空白處回到下一站。
 * 這支連同 @vis.gl/react-google-maps 只由 map-slot.tsx 用 import() 載入：切到地圖才下載，首頁本身不多載。
 * 金鑰被拒或 Google 的程式載不下來時呼叫 onFail，由外面換成一行「地圖暫時載入不了」。
 */
export default function HomeMap({ config, map, stops, estimated, className, onFail }: Props) {
  const skin = useSkin()
  const { position } = useLocationShare()
  const [pickedId, setPickedId] = useState<string | null>(null)
  const shown = shownStop(map, pickedId)
  const bounds = boundsOf([...(map.origin ? [map.origin] : []), ...map.stops]) ?? TAIWAN
  // 線畫在 canvas 上要實際的顏色；換配色時 useSkin 會重畫，跟著換
  const color = cssColor("--primary")
  return (
    <APIProvider apiKey={config.browser_key} language="zh-TW" region="TW" onError={onFail}>
      <LoadWatch onFail={onFail} />
      <div className={cn("relative overflow-hidden rounded-2xl border-2 shadow-lip", className)}>
        {/* 地圖跟著 App 的深淺色（colorScheme 只在建立時讀，換配色時重建）。整塊都是地圖，一根手指就能拖 */}
        <Map
          key={skin}
          mapId={config.map_id}
          colorScheme={skin === "dark" ? ColorScheme.DARK : ColorScheme.LIGHT}
          defaultBounds={{ ...bounds, padding: PADDING }}
          gestureHandling="greedy"
          disableDefaultUI
          clickableIcons={false}
          onClick={() => setPickedId(null)}
          className="size-full"
        >
          {legPaths(map).map((leg, n) => (
            <Polyline
              key={n}
              path={leg.path}
              strokeColor={color}
              strokeOpacity={leg.done ? DONE_OPACITY : TODO_OPACITY}
              strokeWeight={5}
              clickable={false}
            />
          ))}
          {map.stops.map((stop) => (
            <StopPin
              key={stop.customer_id}
              stop={stop}
              picked={stop.customer_id === shown?.customer_id}
              onPick={() => setPickedId(stop.customer_id)}
            />
          ))}
          {position && <HereDot position={position} />}
        </Map>
        {position && <LocateButton position={position} />}
        {shown && (
          <MapStopCard
            stop={shown}
            detail={stops.find((stop) => stop.customer_id === shown.customer_id)}
            estimated={estimated}
            className="absolute inset-x-2.5 bottom-2.5"
          />
        )}
      </div>
    </APIProvider>
  )
}

/** 一站的圓點：跑完的實心打勾、下一站實心外面一圈、還沒去的空心寫站號；底下卡片寫的那一站放大一點 */
function StopPin({ stop, picked, onPick }: { stop: MapStop; picked: boolean; onPick: () => void }) {
  const done = stop.status === "done"
  const next = stop.status === "next"
  return (
    <AdvancedMarker
      position={{ lat: stop.lat, lng: stop.lng }}
      title={`第 ${stop.number} 站 ${stop.customer_name}`}
      onClick={onPick}
      anchorLeft="-50%"
      anchorTop="-50%"
      zIndex={picked ? 5 : next ? 4 : 1}
    >
      <span
        className={cn(
          "flex size-7 items-center justify-center rounded-full border-2 text-xs font-bold tabular-nums shadow-sm transition-transform",
          done || next ? "border-background bg-primary text-primary-foreground" : "border-primary bg-background text-primary",
          next && "ring-4 ring-primary/30",
          picked && "scale-125"
        )}
      >
        {done ? <Check className="size-3.5" strokeWidth={3.5} /> : stop.number}
      </span>
    </AdvancedMarker>
  )
}

/** 自己的位置：藍點加一圈淡藍 */
function HereDot({ position }: { position: LatLng }) {
  return (
    <AdvancedMarker position={{ lat: position.lat, lng: position.lng }} title="你的位置" anchorLeft="-50%" anchorTop="-50%" zIndex={10}>
      <span className="flex size-7 items-center justify-center rounded-full" style={{ background: `${HERE_COLOR}33` }}>
        <span className="size-3.5 rounded-full border-2 border-white shadow-sm" style={{ background: HERE_COLOR }} />
      </span>
    </AdvancedMarker>
  )
}

/** 右上角：把地圖移回自己的位置 */
function LocateButton({ position }: { position: LatLng }) {
  const googleMap = useMap()
  return (
    <button
      type="button"
      aria-label="回到我的位置"
      onClick={() => googleMap?.panTo({ lat: position.lat, lng: position.lng })}
      className="absolute top-2.5 right-2.5 flex size-11 items-center justify-center rounded-xl border-2 bg-card shadow-lip press"
    >
      <LocateFixed className="size-5" />
    </button>
  )
}
