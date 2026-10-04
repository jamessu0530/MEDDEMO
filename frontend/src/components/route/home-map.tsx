import { useEffect, useMemo, useState } from "react"
import { AdvancedMarker, APIProvider, ColorScheme, Map, Polyline, useMap } from "@vis.gl/react-google-maps"
import { Check, Loader2, LocateFixed } from "lucide-react"

import type { MapsConfig } from "@/api/maps"
import type { MapStop, RouteStop, TodayMap, TravelMode } from "@/api/route"
import type { LatLng } from "@/api/team-routes"
import { LoadWatch } from "@/components/map-load-watch"
import { MapStopCard } from "@/components/route/map-stop-card"
import { TravelModeIcon } from "@/components/route/travel-mode-icon"
import { cssColor } from "@/lib/css-color"
import { shownStop } from "@/lib/home-map"
import { useLocationShare } from "@/lib/location-share"
import { drawPlan, revealed, stopsShown } from "@/lib/route-draw"
import { useSkin } from "@/lib/skin"
import { boundsOf, DONE_OPACITY, legPaths, TAIWAN, TODO_OPACITY } from "@/lib/team-routes"
import { TRAVEL_MODE_LABEL, TRAVEL_MODES } from "@/lib/travel-mode"
import { cn } from "@/lib/utils"

// 自己的位置用 Google 地圖慣用的藍點：一看就知道是「我在這」，不跟紫色的站點混在一起
const HERE_COLOR = "#1A73E8"
// 框住路線時四周留白：上面讓給交通方式的按鈕，底下讓給那張卡，路線不要被蓋住
const PADDING = { top: 72, right: 32, bottom: 168, left: 32 }
// 路線畫完要多久；之後站點一個一個冒出來跟著筆走
const DRAW_MS = 1600
// 走路（大眾運輸）畫成虛線
const WALK_DASH = { path: "M 0,-1 0,1", scale: 3 }

type Props = {
  config: NonNullable<MapsConfig>
  map: TodayMap
  // 首頁的行程：卡片上的時間、理由與車程從這裡找
  stops: RouteStop[]
  estimated: boolean
  // 業務選的交通方式，與正在換成哪一種（還沒換好）
  mode: TravelMode
  switching: TravelMode | null
  onMode: (mode: TravelMode) => void
  className: string
  onFail: () => void
}

/**
 * 首頁「地圖」分頁（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈業務首頁的地圖〉）。
 * 自己今天的路線照交通方式沿路畫出來：一打開（或換了交通方式）路線從出發點一段一段畫出來，畫到哪一站那一站才冒出來；
 * 跑完的段深色、還沒去的淡色，底下墊一層白邊，跟 Google 底圖上彩色的捷運線分得開；大眾運輸的走路畫虛線。
 * 站點跑完的打勾、下一站多一圈、還沒去的空心寫站號；藍點是自己的位置（位置分享中才有）。
 * 左上角換交通方式（整天的行程跟著重算），右上角移回自己的位置；點站點，底下的卡換成那一站，點空白處回到下一站。
 * 這支連同 @vis.gl/react-google-maps 只由 map-slot.tsx 用 import() 載入：切到地圖才下載，首頁本身不多載。
 * 金鑰被拒或 Google 的程式載不下來時呼叫 onFail，由外面換成一行「地圖暫時載入不了」。
 */
export default function HomeMap({ config, map, stops, estimated, mode, switching, onMode, className, onFail }: Props) {
  const skin = useSkin()
  const { position } = useLocationShare()
  const [pickedId, setPickedId] = useState<string | null>(null)
  // 底圖載好了才開始畫線，不然線在一片空白上畫完了地圖才出來
  const [ready, setReady] = useState(false)
  const shown = shownStop(map, pickedId)
  const bounds = boundsOf([...(map.origin ? [map.origin] : []), ...map.stops]) ?? TAIWAN
  const plan = useMemo(() => drawPlan(legPaths(map)), [map])
  const progress = useDraw(ready ? `${map.version}:${map.travel_mode}` : null)
  const pen = progress * plan.total
  const visible = stopsShown(plan, pen, map.origin !== null, map.stops.length)
  // 線畫在 canvas 上要實際的顏色；換配色時 useSkin 會重畫，跟著換
  const color = cssColor("--primary")
  const casing = cssColor("--background")

  // 底圖一直沒載好（網路很慢）也不要讓路線永遠不出來
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 2500)
    return () => window.clearTimeout(timer)
  }, [])

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
          onTilesLoaded={() => setReady(true)}
          className="size-full"
        >
          {plan.pieces.map((piece, n) => {
            const path = revealed(piece, pen)
            if (path.length < 2) return null
            const opacity = piece.done ? DONE_OPACITY : TODO_OPACITY
            return piece.walk ? (
              <Polyline
                key={n}
                path={path}
                strokeOpacity={0}
                icons={[{ icon: { ...WALK_DASH, strokeColor: color, strokeOpacity: opacity }, offset: "0", repeat: "12px" }]}
                zIndex={2}
                clickable={false}
              />
            ) : (
              <RouteLine key={n} path={path} color={color} casing={casing} opacity={opacity} />
            )
          })}
          {map.stops.slice(0, visible).map((stop) => (
            <StopPin
              key={stop.customer_id}
              stop={stop}
              picked={stop.customer_id === shown?.customer_id}
              onPick={() => setPickedId(stop.customer_id)}
            />
          ))}
          {position && <HereDot position={position} />}
        </Map>
        <ModePicker mode={mode} switching={switching} onMode={onMode} />
        {position && <LocateButton position={position} />}
        {/* 卡片離底 2rem：左下角 Google 的標誌與地圖資料的版權列要露出來（Google 的使用條款） */}
        {shown && (
          <MapStopCard
            stop={shown}
            detail={stops.find((stop) => stop.customer_id === shown.customer_id)}
            estimated={estimated}
            mode={mode}
            className="absolute inset-x-2.5 bottom-8"
          />
        )}
      </div>
    </APIProvider>
  )
}

/**
 * 路線畫到哪：key 換了（地圖一載好、行程換版、換了交通方式）就從 0 重畫到 1，先快後慢。
 * 系統設定「減少動態效果」就直接畫好。key 是 null（還沒準備好）時什麼都不畫
 */
function useDraw(key: string | null) {
  const [reduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)
  // 記著是哪一個 key 的進度：換 key 的那一刻還沒開始跑，不要先閃一下上一次畫完的整條線
  const [drawn, setDrawn] = useState({ key: "", progress: 0 })

  useEffect(() => {
    if (key === null || reduced) return
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DRAW_MS)
      setDrawn({ key, progress: 1 - (1 - t) ** 3 })
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [key, reduced])

  if (key === null) return 0
  if (reduced) return 1
  return drawn.key === key ? drawn.progress : 0
}

/** 一段實線：底下先墊一層比較寬的底色，路線才不會跟 Google 底圖上彩色的捷運線、公路混在一起 */
function RouteLine({ path, color, casing, opacity }: { path: LatLng[]; color: string; casing: string; opacity: number }) {
  return (
    <>
      <Polyline path={path} strokeColor={casing} strokeOpacity={0.9} strokeWeight={9} zIndex={1} clickable={false} />
      <Polyline path={path} strokeColor={color} strokeOpacity={opacity} strokeWeight={5} zIndex={2} clickable={false} />
    </>
  )
}

/** 左上角：換交通方式。整天的行程跟著重算，換好之前那一顆轉圈、其他先不能按 */
function ModePicker({
  mode,
  switching,
  onMode,
}: {
  mode: TravelMode
  switching: TravelMode | null
  onMode: (mode: TravelMode) => void
}) {
  return (
    <div role="radiogroup" aria-label="交通方式" className="absolute top-2.5 left-2.5 flex gap-0.5 rounded-xl border-2 bg-card p-0.5 shadow-lip">
      {TRAVEL_MODES.map((option) => {
        const active = (switching ?? mode) === option
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={switching !== null}
            onClick={() => onMode(option)}
            className={cn(
              "flex h-10 items-center gap-1 rounded-[0.6rem] px-2 text-xs font-semibold transition-colors",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            )}
          >
            {switching === option ? <Loader2 className="size-4 animate-spin" /> : <TravelModeIcon mode={option} className="size-4" />}
            {TRAVEL_MODE_LABEL[option]}
          </button>
        )
      })}
    </div>
  )
}

/** 一站的圓點：跑完的實心打勾、下一站實心外面一圈、還沒去的空心寫站號；底下卡片寫的那一站放大一點。
 *  路線畫到這一站時才掛上，彈一下冒出來 */
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
      <span className="block animate-in duration-300 zoom-in-50 fade-in motion-reduce:animate-none">
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
