import { useEffect, useState } from "react"

import { getTodayMap, type TodayMap, type TodayRoute } from "@/api/route"
import { HomeMapSlot, MapFallback, MapPlaceholder } from "@/components/map-slot"

// 地圖填滿頁首與底部輸入列中間：一打開就看到整條路線和底下的卡，不必捲
const HEIGHT = "h-[calc(100svh-24.5rem)] min-h-72"

/**
 * 首頁的「地圖」：切過來才問後端各站的位置與沿路的線（GET /api/itinerary/today/map），
 * 首頁的行程換版了（三顆鈕、套用提案）就重拿。重拿時先留著上一版的地圖，不閃一下骨架；
 * 一次都沒拿到就一行「地圖暫時載入不了」，切回「路線」照常。
 */
export function HomeMapPanel({ route }: { route: TodayRoute }) {
  const [map, setMap] = useState<TodayMap | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getTodayMap(controller.signal)
      .then((found) => {
        setMap(found)
        setFailed(false)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [route.version])

  if (map) return <HomeMapSlot map={map} stops={route.stops} estimated={route.estimated} className={HEIGHT} />
  if (failed) return <MapFallback />
  return <MapPlaceholder className={HEIGHT} />
}
