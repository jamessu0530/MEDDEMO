import { useEffect, useState } from "react"

import { ApiError } from "@/api/client"
import { getTodayMap, setTravelMode, type TodayMap, type TodayRoute, type TravelMode } from "@/api/route"
import { HomeMapSlot, MapFallback, MapPlaceholder } from "@/components/map-slot"

// 地圖填滿固定的頁首與底部輸入列中間（切換捲到頁首正下面時）：一打開就看到整條路線和底下的卡。
// 頁首的高度由首頁量好放在 --home-header（有沒有位置分享列、字放多大都不一樣）；12rem 是切換本身加上底部的輸入列與分頁列
// 電腦版地圖在右欄、固定在頁首下面：高度是視窗扣掉頁首，上下各留 0.75rem
const HEIGHT = "h-[calc(100svh-var(--home-header,12rem)-12rem)] min-h-72 lg:h-[calc(100svh-var(--home-header,8rem)-1.5rem)]"

/**
 * 首頁的「地圖」：切過來才問後端各站的位置與沿路的線（GET /api/itinerary/today/map），
 * 首頁的行程換版了（三顆鈕、套用提案、換交通方式）就重拿。重拿時先留著上一版的地圖，不閃一下骨架；
 * 一次都沒拿到就一行「地圖暫時載入不了」，切回「路線」照常。
 * 地圖左上角換交通方式：整天的行程照新的方式重算（PUT /api/itinerary/travel-mode），回來的行程交給首頁。
 */
export function HomeMapPanel({
  route,
  userId,
  onRoute,
}: {
  route: TodayRoute
  userId: string
  onRoute: (route: TodayRoute) => void
}) {
  const [map, setMap] = useState<TodayMap | null>(null)
  const [failed, setFailed] = useState(false)
  const [switching, setSwitching] = useState<TravelMode | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  async function changeMode(mode: TravelMode) {
    if (mode === route.travel_mode || switching) return
    setSwitching(mode)
    setError(null)
    try {
      onRoute(await setTravelMode(userId, mode))
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "連不上伺服器，交通方式沒有換到，請再試一次。")
    } finally {
      setSwitching(null)
    }
  }

  if (!map) return failed ? <MapFallback /> : <MapPlaceholder className={HEIGHT} />
  return (
    <>
      {error && <p className="mb-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      <HomeMapSlot
        map={map}
        stops={route.stops}
        estimated={route.estimated}
        mode={route.travel_mode}
        switching={switching}
        onMode={(mode) => void changeMode(mode)}
        className={HEIGHT}
      />
    </>
  )
}
