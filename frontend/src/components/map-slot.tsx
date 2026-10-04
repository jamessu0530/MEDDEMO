import { Component, lazy, Suspense, useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react"

import { getMapsConfig, type MapsConfig } from "@/api/maps"
import type { RouteStop, TodayMap, TravelMode } from "@/api/route"
import type { RemovedStop, RepRoute } from "@/api/team-routes"
import { cn } from "@/lib/utils"

// 用 import() 另外打包：Google 地圖與 @vis.gl/react-google-maps 只有主管頁的行程分頁、首頁切到「地圖」才用得到
const RouteMap = lazy(() => import("@/components/manager/route-map"))
const HomeMap = lazy(() => import("@/components/route/home-map"))

declare global {
  interface Window {
    gm_authFailure?: () => void
  }
}

// Google 只在金鑰被拒（金鑰錯、網域不對、沒開帳單）時呼叫全域的 gm_authFailure，整個頁面只呼叫一次，
// 而且可能在換頁的空檔才到：在模組載入時就裝好、不拆掉，記在模組裡，之後每一個地圖區塊都直接顯示說明
let authFailed = false
const authListeners = new Set<() => void>()
if (typeof window !== "undefined") {
  const previous = window.gm_authFailure
  window.gm_authFailure = () => {
    authFailed = true
    authListeners.forEach((listener) => listener())
    previous?.()
  }
}
function subscribeAuth(listener: () => void) {
  authListeners.add(listener)
  return () => {
    authListeners.delete(listener)
  }
}
const readAuthFailed = () => authFailed

/** 主管頁的地圖區塊：團隊或一位業務的路線 */
export function MapSlot({ routes, removed }: { routes: RepRoute[]; removed?: RemovedStop[] }) {
  return (
    <MapGate className="h-64">
      {(config, onFail) => <RouteMap config={config} routes={routes} removed={removed} onFail={onFail} />}
    </MapGate>
  )
}

/** 首頁「地圖」分頁的地圖：自己今天的路線、自己的位置、換交通方式，底下一張卡寫下一站（或點的那一站） */
export function HomeMapSlot({
  className,
  ...props
}: {
  map: TodayMap
  stops: RouteStop[]
  estimated: boolean
  mode: TravelMode
  switching: TravelMode | null
  onMode: (mode: TravelMode) => void
  className: string
}) {
  return (
    <MapGate className={className}>
      {(config, onFail) => <HomeMap config={config} className={className} onFail={onFail} {...props} />}
    </MapGate>
  )
}

/**
 * 地圖區塊的外框。先問後端有沒有瀏覽器金鑰（GET /api/maps/config，不寫進前端的建置）；
 * 沒有金鑰、Google 的程式載不下來或金鑰被拒，就換成一行「地圖暫時載入不了」，頁面其他地方照常。
 * className 是地圖的高度，載入中的骨架跟它一樣高，載好時版面不會跳
 */
function MapGate({
  className,
  children,
}: {
  className: string
  children: (config: NonNullable<MapsConfig>, onFail: () => void) => ReactNode
}) {
  // undefined：還在問；null：沒有瀏覽器金鑰
  const [config, setConfig] = useState<MapsConfig | undefined>(undefined)
  // load/chunk 失敗（地圖那包下載不下來、React 錯誤邊界接住的例外）；金鑰被拒走下面的 rejected，不記在這裡
  const [failed, setFailed] = useState(false)
  // 金鑰被拒：裝在模組裡的 gm_authFailure，整個頁面只會呼叫一次，可能發生在這個元件還沒掛上的空檔
  const rejected = useSyncExternalStore(subscribeAuth, readAuthFailed, readAuthFailed)

  useEffect(() => {
    const controller = new AbortController()
    getMapsConfig(controller.signal)
      .then(setConfig)
      .catch(() => {
        if (!controller.signal.aborted) setConfig(null)
      })
    return () => controller.abort()
  }, [])

  const onFail = useCallback(() => setFailed(true), [])

  // 先看金鑰有沒有被拒：頁面已經知道的話，不要先閃一下「還在問」的骨架
  if (failed || rejected) return <MapFallback />
  if (config === undefined) return <MapPlaceholder className={className} />
  if (config === null) return <MapFallback />
  return (
    <MapBoundary onFail={onFail}>
      <Suspense fallback={<MapPlaceholder className={className} />}>{children(config, onFail)}</Suspense>
    </MapBoundary>
  )
}

export function MapPlaceholder({ className }: { className: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-2xl bg-muted", className)} />
}

export function MapFallback() {
  return (
    <p data-map-fallback className="rounded-xl bg-muted px-3 py-2.5 text-center text-xs text-muted-foreground">
      地圖暫時載入不了
    </p>
  )
}

/**
 * 地圖那一包是要畫地圖時才下載的，收訊不好就會失敗；沒有錯誤邊界的話 React 會卸載整頁，
 * 連清單都看不到。擋在地圖這一區，換成說明。React 的錯誤邊界只能用 class 元件寫（pages/ask.tsx 同）。
 */
class MapBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onFail()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
