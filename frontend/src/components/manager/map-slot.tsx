import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react"

import { getMapsConfig, type MapsConfig, type RemovedStop, type RepRoute } from "@/api/team-routes"

// 用 import() 另外打包：Google 地圖與 @vis.gl/react-google-maps 只有主管頁的行程分頁用得到
const RouteMap = lazy(() => import("@/components/manager/route-map"))

declare global {
  interface Window {
    gm_authFailure?: () => void
  }
}

// Google 只在金鑰被拒（金鑰錯、網域不對、沒開帳單）時呼叫全域的 gm_authFailure，而且整個頁面只呼叫一次；
// 記在模組裡，之後每一個地圖區塊（總覽、詳細）都直接顯示說明，不再載入
let authFailed = false

/**
 * 主管頁的地圖區塊。先問後端有沒有瀏覽器金鑰（GET /api/maps/config，不寫進前端的建置）；
 * 沒有金鑰、Google 的程式載不下來或金鑰被拒，就換成一行「地圖暫時載入不了」，下面的清單照常。
 */
export function MapSlot({ routes, removed }: { routes: RepRoute[]; removed?: RemovedStop[] }) {
  // undefined：還在問；null：沒有瀏覽器金鑰
  const [config, setConfig] = useState<MapsConfig | undefined>(undefined)
  const [failed, setFailed] = useState(() => authFailed)

  useEffect(() => {
    const controller = new AbortController()
    getMapsConfig(controller.signal)
      .then(setConfig)
      .catch(() => {
        if (!controller.signal.aborted) setConfig(null)
      })
    return () => controller.abort()
  }, [])

  // 金鑰被拒：@vis.gl/react-google-maps 目前這版不會把 loading status 設成 AUTH_FAILURE，
  // Google 的程式碼直接呼叫這個全域函式；接住它，不然 Google 會自己畫一個「糟糕！」的灰底框
  useEffect(() => {
    const previous = window.gm_authFailure
    window.gm_authFailure = () => {
      authFailed = true
      setFailed(true)
    }
    return () => {
      window.gm_authFailure = previous
    }
  }, [])

  if (config === undefined) return <MapPlaceholder />
  if (config === null || failed) {
    return (
      <p data-map-fallback className="rounded-xl bg-muted px-3 py-2.5 text-center text-xs text-muted-foreground">
        地圖暫時載入不了
      </p>
    )
  }
  return (
    <MapBoundary onFail={() => setFailed(true)}>
      <Suspense fallback={<MapPlaceholder />}>
        <RouteMap config={config} routes={routes} removed={removed} onFail={() => setFailed(true)} />
      </Suspense>
    </MapBoundary>
  )
}

function MapPlaceholder() {
  return <div aria-hidden className="h-64 animate-pulse rounded-2xl bg-muted" />
}

/**
 * 地圖那一包是打開行程分頁才下載的，收訊不好就會失敗；沒有錯誤邊界的話 React 會卸載整頁，
 * 連下面的清單都看不到。擋在地圖這一區，換成說明。React 的錯誤邊界只能用 class 元件寫（pages/ask.tsx 同）。
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
