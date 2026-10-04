import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react"
import { Link, useNavigate, useSearchParams } from "react-router"

import { ApiError } from "@/api/client"
import {
  getRepRoute,
  getTeamLocations,
  getTeamRoutes,
  type RepRoute,
  type TeamLocations,
  type TeamRoutes,
  type TeamStop,
} from "@/api/team-routes"
import { MapSlot } from "@/components/map-slot"
import { RepRouteCard } from "@/components/manager/rep-route-card"
import { Notice } from "@/components/notice"
import { LiveAvatar } from "@/components/user-avatar"
import { realtime, useRealtimeConnected } from "@/lib/realtime"
import { headerLine, progressLine, SOURCE_LABEL, totalsLine, windowLabel, withLocation, withLocations } from "@/lib/team-routes"
import { cn } from "@/lib/utils"
import type { CustomerLocationState } from "@/pages/customer"

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
  const connected = useRealtimeConnected()
  useEffect(() => {
    const controller = new AbortController()
    const full = () =>
      load(controller.signal)
        .then((data) => setState({ status: "ready", data }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          const message = error instanceof ApiError && error.status === 404 ? error.message : LOAD_FAILED
          setState((current) => (current.status === "ready" ? current : { status: "error", message }))
        })
    const locationsOnly = () =>
      getTeamLocations(controller.signal)
        .then((update) =>
          setState((current) => (current.status === "ready" ? { status: "ready", data: mergeLocations(current.data, update) } : current))
        )
        .catch(() => {
          // 拿不到就等下一次通知或整份重拿
        })
    void full()

    let timer: ReturnType<typeof setTimeout> | undefined
    let wantFull = false
    const soon = (fullReload: boolean) => {
      wantFull ||= fullReload
      timer ??= setTimeout(() => {
        timer = undefined
        const reloadFull = wantFull
        wantFull = false
        void (reloadFull ? full() : locationsOnly())
      }, RELOAD_DELAY_MS)
    }
    const off = realtime.subscribe((event) => {
      if (event.type === "resync") soon(true)
      else if (event.type === "itinerary" && watches(event.user_id)) soon(true)
      else if (event.type === "location" && watches(event.user_id)) soon(false)
    })
    const poll = connected
      ? undefined
      : setInterval(() => {
          if (document.visibilityState === "visible") void full()
        }, POLL_MS)
    return () => {
      controller.abort()
      clearTimeout(timer)
      clearInterval(poll)
      off()
    }
    // load、mergeLocations、watches 每次 render 都是新的函式；要不要重拿只看 key、按了重新載入、連線狀態
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt, connected])
  const retry = () => {
    setState({ status: "loading" })
    setAttempt((n) => n + 1)
  }
  return { state, retry }
}

function Loading() {
  return <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>
}

function TeamOverview() {
  const navigate = useNavigate()
  const { state, retry } = useLiveLoad<TeamRoutes>(getTeamRoutes, withLocations, () => true, "team")
  if (state.status === "loading") return <Loading />
  if (state.status === "error") {
    return (
      <Notice
        text={state.message}
        action={{ label: "重新載入", onClick: retry }}
        secondary={{ label: "看提問", onClick: () => navigate("/manager?view=asks") }}
      />
    )
  }
  const { data } = state
  return (
    <>
      <p className="text-xs text-muted-foreground">{headerLine(data)}</p>
      {data.reps.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">目前沒有業務。</p>
      ) : (
        <>
          <MapSlot routes={data.reps} />
          {data.reps.map((route) => (
            <RepRouteCard key={route.rep.id} route={route} />
          ))}
          <GoogleAttribution routes={data.reps} />
        </>
      )}
    </>
  )
}

function RepDetail({ userId }: { userId: string }) {
  const navigate = useNavigate()
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
  const backTo = `/manager?view=routes&rep=${route.rep.id}`
  return (
    <>
      <Link to="/manager" replace className="-ml-1 flex h-11 items-center gap-1 self-start text-sm text-muted-foreground">
        <ChevronLeft className="size-4" />
        團隊行程
      </Link>
      <div className="flex items-center gap-2.5">
        <LiveAvatar id={route.rep.id} name={route.rep.name} size="lg" />
        <div className="min-w-0">
          <p className="text-base font-semibold">{route.rep.name}</p>
          <p className="text-xs text-muted-foreground tabular-nums">{progressLine(route)}</p>
        </div>
      </div>
      <MapSlot routes={[route]} removed={route.removed} />
      <p className="text-xs tabular-nums">{totalsLine(route)}</p>
      <p className="flex items-start gap-1.5 text-xs text-primary">
        <MapPin className="mt-0.5 size-3.5 shrink-0" />
        {route.location.text}
      </p>
      <section className="flex flex-col gap-1.5 rounded-2xl border-2 bg-card p-4 shadow-lip">
        <h2 className="text-sm font-semibold">跟系統早上的建議比</h2>
        <Changes route={route} />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">今天的行程</h2>
        <ol className="flex flex-col gap-2">
          {route.stops.map((stop) => (
            <StopRow key={stop.customer_id} stop={stop} backTo={backTo} />
          ))}
        </ol>
      </section>
      <GoogleAttribution routes={[route]} />
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

/** 行程清單的一站：跟業務看到的一樣（到達時間、停留、約的時間、會晚到、來源），點了進客戶檔案 */
function StopRow({ stop, backTo }: { stop: TeamStop; backTo: string }) {
  const done = stop.status === "done"
  const window = windowLabel(stop)
  return (
    <li>
      <Link
        to={`/customers/${stop.customer_id}`}
        state={{ backTo } satisfies CustomerLocationState}
        className={cn("flex items-start gap-3 rounded-xl border-2 bg-card px-3 py-2.5 shadow-lip press", done && "opacity-60")}
      >
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold tabular-nums">
          {stop.number}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug font-medium">{stop.customer_name}</span>
          <span className="block text-xs text-muted-foreground tabular-nums">
            {done ? `${stop.planned_time} 完成` : `${stop.planned_time} 到 · 停 ${stop.duration_minutes} 分`}
          </span>
          <span className="mt-1 flex flex-wrap gap-1 empty:hidden">
            {window && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[0.6875rem]">{window}</span>}
            {!done && stop.late_minutes > 0 && (
              <span className="rounded-md bg-destructive/10 px-1.5 py-0.5 text-[0.6875rem] text-destructive">
                會晚到 {stop.late_minutes} 分
              </span>
            )}
            {stop.source !== "model" && (
              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[0.6875rem] text-primary">
                {SOURCE_LABEL[stop.source]}
              </span>
            )}
          </span>
        </span>
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
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
