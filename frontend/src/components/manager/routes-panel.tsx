import { useEffect, useState } from "react"
import { ChevronLeft, MapPin } from "@/components/icons"
import { Link, useNavigate, useSearchParams } from "react-router"

import { ApiError } from "@/api/client"
import {
  getRepRoute,
  getTeamLocations,
  getTeamRoutes,
  type RepRoute,
  type TeamLocations,
  type TeamRoutes,
} from "@/api/team-routes"
import { MapSlot } from "@/components/map-slot"
import { RepRoutePath } from "@/components/manager/rep-route-path"
import { ViewSwitch } from "@/components/route/view-switch"
import { RepRouteCard } from "@/components/manager/rep-route-card"
import { ResizableMapLayout } from "@/components/manager/resizable-map-layout"
import { Notice } from "@/components/notice"
import { LiveAvatar } from "@/components/user-avatar"
import { useIsDesktop } from "@/lib/use-media-query"
import { realtime } from "@/lib/realtime"
import { RouteLiveLoader } from "@/lib/route-live-loader"
import { headerLine, progressLine, totalsLine, withLocation, withLocations } from "@/lib/team-routes"

// 收到位置或行程的通知之後等這麼久再重拿，一連串的變化併成一次（跟頻道列表一樣）
const RELOAD_DELAY_MS = 3_000
// WebSocket 沒連上時，畫面在前景每 60 秒整份重拿一次
const POLL_MS = 60_000

type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T }

const LOAD_FAILED = "連不上伺服器，團隊行程沒有載入。"

/**
 * 主管端的「行程」分頁（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈主管端：行程分頁〉）：
 * 預設是團隊總覽，網址帶 rep 就是那位業務的詳細（/manager?view=routes&rep=U01）。只能看、只看今天。
 * 位置與行程的變化跟著 WebSocket 的通知更新（useLiveLoad）。
 */
export function RoutesPanel() {
  const [params] = useSearchParams()
  const rep = params.get("rep")
  return rep ? <RepDetail key={rep} userId={rep} /> : <TeamOverview />
}

/**
 * 載入一份資料並跟著即時通知更新：看得到的業務位置變了，3 秒後只重拿位置（不重算行程、不問 Google）；
 * 行程變了或 WebSocket 重連，3 秒後整份重拿。WebSocket 沒連上時改成每 60 秒整份重拿。
 * 背景重拿失敗就留著上一份，不把畫面換成錯誤。watches 是這個畫面關心哪幾位業務的通知
 */
function useLiveLoad<T>(
  load: (signal: AbortSignal) => Promise<T>,
  mergeLocations: (data: T, update: TeamLocations) => T,
  watches: (userId: string) => boolean,
  key: string
) {
  const [state, setState] = useState<Load<T>>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const loader = new RouteLiveLoader({
      full: load,
      locations: getTeamLocations,
      onFull: (data) => setState({ status: "ready", data }),
      onLocations: (update) =>
        setState((current) => (current.status === "ready" ? { status: "ready", data: mergeLocations(current.data, update) } : current)),
      onError: (error) => {
        const message = error instanceof ApiError && error.status === 404 ? error.message : LOAD_FAILED
        setState((current) => (current.status === "ready" ? current : { status: "error", message }))
      },
    })
    loader.reload("full")

    let timer: ReturnType<typeof setTimeout> | undefined
    let wantFull = false
    const soon = (fullReload: boolean) => {
      wantFull ||= fullReload
      timer ??= setTimeout(() => {
        timer = undefined
        const reloadFull = wantFull
        wantFull = false
        loader.reload(reloadFull ? "full" : "locations")
      }, RELOAD_DELAY_MS)
    }
    const off = realtime.subscribe((event) => {
      if (event.type === "resync") soon(true)
      else if (event.type === "itinerary" && watches(event.user_id)) soon(true)
      else if (event.type === "location" && watches(event.user_id)) soon(false)
    })
    // 連線狀態只決定這次要不要輪詢，不重啟 effect／中止還在等的行程請求。
    const poll = setInterval(() => {
      if (!realtime.isConnected() && document.visibilityState === "visible") loader.reload("full")
    }, POLL_MS)
    return () => {
      loader.dispose()
      clearTimeout(timer)
      clearInterval(poll)
      off()
    }
    // load、mergeLocations、watches 每次 render 都是新的函式；換行程或按重新載入才重啟。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt])
  const retry = () => {
    setState({ status: "loading" })
    setAttempt((n) => n + 1)
  }
  return { state, retry }
}

function Loading() {
  return <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>
}

// 外層的拖曳控制設定高度，載入中與 Google 地圖共用同一尺寸。
const DESKTOP_MAP = "h-[var(--manager-map-height,clamp(20rem,calc(100svh-12rem),48rem))]"

function TeamOverview() {
  const navigate = useNavigate()
  const desktop = useIsDesktop()
  const { state, retry } = useLiveLoad<TeamRoutes>(getTeamRoutes, withLocations, () => true, "team")
  if (state.status === "loading") return <Loading />
  if (state.status === "error") {
    return (
      <Notice
        text={state.message}
        action={{ label: "重新載入", onClick: retry }}
        secondary={{ label: "看頻道", onClick: () => navigate("/channels") }}
      />
    )
  }
  const { data } = state
  const header = <p className="text-xs text-muted-foreground">{headerLine(data)}</p>
  if (data.reps.length === 0) {
    return (
      <>
        {header}
        <p className="py-10 text-center text-sm text-muted-foreground">目前沒有業務。</p>
      </>
    )
  }
  const cards = data.reps.map((route) => <RepRouteCard key={route.rep.id} route={route} />)
  if (desktop) {
    return (
      <ResizableMapLayout map={<MapSlot routes={data.reps} className={DESKTOP_MAP} />}>
        {header}
        {cards}
        <GoogleAttribution routes={data.reps} />
      </ResizableMapLayout>
    )
  }
  return (
    <>
      {header}
      <MapSlot routes={data.reps} />
      {cards}
      <GoogleAttribution routes={data.reps} />
    </>
  )
}

function RepDetail({ userId }: { userId: string }) {
  const navigate = useNavigate()
  const desktop = useIsDesktop()
  const [params, setParams] = useSearchParams()
  const onMap = params.get("mode") === "map"
  const showView = (view: "route" | "map") => setParams(
    (current) => {
      const next = new URLSearchParams(current)
      if (view === "map") next.set("mode", "map")
      else next.delete("mode")
      return next
    },
    { replace: true }
  )
  const { state, retry } = useLiveLoad<RepRoute>((signal) => getRepRoute(userId, signal), withLocation, (id) => id === userId, userId)
  if (state.status === "loading") return <Loading />
  if (state.status === "error") {
    return (
      <Notice
        text={state.message}
        action={{ label: "重新載入", onClick: retry }}
        secondary={{ label: "回團隊行程", onClick: () => navigate("/manager") }}
      />
    )
  }
  const route = state.data
  // 從客戶檔案按返回，回到這位業務的詳細
  const backTo = `/manager?${params}`
  const back = (
    <Link to="/manager" replace className="-ml-1 flex h-11 items-center gap-1 self-start text-sm text-muted-foreground">
      <ChevronLeft className="size-4" />
      團隊行程
    </Link>
  )
  const who = (
    <div className="flex items-center gap-2.5">
      <LiveAvatar id={route.rep.id} name={route.rep.name} size="lg" />
      <div className="min-w-0">
        <p className="text-base font-semibold">{route.rep.name}</p>
        <p className="text-xs text-muted-foreground tabular-nums">{progressLine(route)}</p>
      </div>
    </div>
  )
  const details = (
    <>
      <p className="text-xs tabular-nums">{totalsLine(route)}</p>
      <p className="flex items-start gap-1.5 text-xs text-primary">
        <MapPin className="mt-0.5 size-3.5 shrink-0" />
        {route.location.text}
      </p>
      {!desktop && <ViewSwitch onMap={onMap} onChange={showView} />}
      {!desktop && onMap ? (
        <MapSlot routes={[route]} removed={route.removed} />
      ) : (
        <RepRoutePath route={route} backTo={backTo} />
      )}
      <section className="flex flex-col gap-1.5 rounded-2xl border-2 bg-card p-4 shadow-lip">
        <h2 className="text-base font-semibold">跟系統早上的建議比</h2>
        <Changes route={route} />
      </section>
      <GoogleAttribution routes={[route]} />
    </>
  )
  if (desktop) {
    return (
      <ResizableMapLayout map={<MapSlot routes={[route]} removed={route.removed} className={DESKTOP_MAP} />}>
        {back}
        {who}
        {details}
      </ResizableMapLayout>
    )
  }
  return (
    <>
      {back}
      {who}
      {details}
    </>
  )
}

/** 跟系統早上的建議比：拿掉的（含理由）、自己加的、順序改過的；都沒有就是照系統建議 */
function Changes({ route }: { route: RepRoute }) {
  if (!route.removed.length && !route.added.length && !route.moved.length) {
    return <p className="text-xs text-muted-foreground">照系統建議</p>
  }
  return (
    <ul className="flex flex-col gap-1 text-xs leading-relaxed">
      {route.removed.map((stop) => (
        <li key={stop.customer_id} className="text-destructive">
          拿掉：{stop.customer_name}（{stop.label}）· {stop.reason}
        </li>
      ))}
      {route.added.map((name) => (
        <li key={name}>自己加的：{name}</li>
      ))}
      {route.moved.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}

/**
 * Google 的條款：Routes API 的內容（車程、公里）顯示在不是 Google 地圖的地方要標「Google Maps」，
 * 字型 Roboto、不翻譯、不換行。有任何一份是 Google 的道路車程才標
 */
function GoogleAttribution({ routes }: { routes: RepRoute[] }) {
  if (routes.every((route) => route.estimated)) return null
  return (
    <p translate="no" className="text-center text-xs whitespace-nowrap text-muted-foreground" style={{ fontFamily: "Roboto, Arial, sans-serif" }}>
      Google Maps
    </p>
  )
}
