import { useEffect, useRef, useState, type CSSProperties, type Ref } from "react"
import {
  BookOpenText,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronRight,
  Flag,
  Loader2,
  Map as MapIcon,
  Route,
  TriangleAlert,
} from "@/components/icons"
import { Link, useNavigate, useSearchParams } from "react-router"

import { ApiError } from "@/api/client"
import type { Medal } from "@/api/me"
import {
  arriveAt,
  cacheRoute,
  getTodayRoute,
  sendRouteFeedback,
  setLegMode,
  type LegMode,
  type RouteAction,
  type RouteUrgent,
  type TodayRoute,
} from "@/api/route"
import { getVehicles, sendRides } from "@/api/vehicles"
import { BottomNav } from "@/components/bottom-nav"
import { Mascot } from "@/components/mascot"
import { Notice } from "@/components/notice"
import { RoutePath } from "@/components/route-path"
import { SalesToolbar } from "@/components/sales-toolbar"
import { EditRouteLink, SkippedHabitsNote } from "@/components/route/home-extras"
import { HomeAsk } from "@/components/route/home-ask"
import { HomeMapPanel } from "@/components/route/home-map-panel"
import { LocationConsent } from "@/components/route/location-share"
import { UnlockToast } from "@/components/route/unlock-toast"
import { Button, buttonVariants } from "@/components/ui/button"
import { useAuth } from "@/lib/auth"
import { formatDate, formatDayLabel } from "@/lib/format"
import { inOrder } from "@/lib/in-order"
import { useHomeSplitLayout } from "@/lib/home-layout"
import { ridesOf, type Leg } from "@/lib/rides"
import { applyProgress } from "@/lib/route-progress"
import { TRAVEL_MODE_LABEL } from "@/lib/travel-mode"
import { urgentCard } from "@/lib/urgent-card"
import { useIsDesktop } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"
import { FirstWeekEntry } from "@/pages/first-week"

// 急件卡收起來要多久（跟卡片外層的 duration-300 一樣）
const URGENT_CLOSE_MS = 300

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  // 後端說這個帳號不該有路線（主管）：直接顯示它那一句，不要說成連不上
  | { status: "denied"; message: string }
  | { status: "ready"; route: TodayRoute; cached: boolean }

/**
 * 今日路線（/route）：一天要跑哪幾家、順序、以及每一家為什麼被排進來。
 * 版面照 Duolingo 的主畫面（docs/superpowers/specs/2026-10-01-duolingo-home-design.md）：
 * 頂部是圖示加數字的狀態列和紫色橫幅，路線是一顆顆蛇行往下的圓鈕（components/route-path.tsx）。
 * 最上面是「需立即處理」，業務按三顆鈕給回饋（插入下一站／暫緩／誤判），
 * 後端直接改存著的今日行程（services/itinerary.py），回來的就是改好的那一份。
 * 路線可以切成「地圖」（components/route/home-map-panel.tsx）：同一份行程畫在 Google 地圖上，下一站一按就導航。
 */
export function TodayPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const user = useAuth()?.user
  const desktop = useIsDesktop()
  const { ref: layoutRef, fitsSplit } = useHomeSplitLayout()
  const split = desktop && fitsSplit
  const userId = user?.id ?? null
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  // 送 arrive 失敗的站：小卡寫「沒連上，這一站還沒記到」，下次點成功就拿掉
  const [unsaved, setUnsaved] = useState<ReadonlySet<string>>(new Set())
  // 這次點站解鎖的獎牌：底部跳一行，點了進個人頁
  const [unlocked, setUnlocked] = useState<Medal[]>([])
  // 打開首頁補送上次送不出去的騎乘記錄：每次開頁面只送一次（StrictMode 重跑、輪詢重載都不再送）
  const flushedRides = useRef(false)
  // 點站的 arrive 回來的順序不一定：只套用比上次套用過的還新的（lib/in-order.ts）
  const [arrivals] = useState(inOrder)
  // 座騎圖鑑收集了幾台（路線最底下的入口）：拿不到就是 null，入口只寫名字
  const [collected, setCollected] = useState<{ ridden: number; total: number } | null>(null)
  const [collectedTick, setCollectedTick] = useState(0)
  // 熊在騎嗎（RoutePath 的 onRidingChange）；剛點了急件那一站、arrive 回來把它拿掉時留下的那一張（lib/urgent-card.ts）
  const [riding, setRiding] = useState(false)
  const [heldUrgent, setHeldUrgent] = useState<RouteUrgent | null>(null)
  // 點站回來時要套到的那一份：arrive 是非同步的，閉包裡的 state 可能已經舊了
  const latest = useRef(state)
  useEffect(() => {
    latest.current = state
  }, [state])

  // 留下的急件卡：熊到了就收（約 300ms 收完再拿掉；減少動態效果時直接拿掉）
  const closingUrgent =
    state.status === "ready" && (urgentCard(state.route.urgent, heldUrgent, riding)?.closing ?? false)
  useEffect(() => {
    if (!closingUrgent) return
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const timer = window.setTimeout(() => setHeldUrgent(null), still ? 0 : URGENT_CLOSE_MS)
    return () => window.clearTimeout(timer)
  }, [closingUrgent])

  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    getVehicles(controller.signal)
      .then(({ ridden, total }) => setCollected({ ridden, total }))
      .catch(() => {})
    return () => controller.abort()
  }, [userId, collectedTick])

  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    getTodayRoute(userId, controller.signal)
      .then(({ route, cached }) => {
        setState({ status: "ready", route, cached })
        if (!cached && !flushedRides.current) {
          flushedRides.current = true
          void sendRides([]).then(() => setCollectedTick((n) => n + 1))
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof ApiError && error.status === 403) setState({ status: "denied", message: error.message })
        else setState({ status: "error" })
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false)
      })
    return () => controller.abort()
  }, [userId, attempt])

  // 路線／地圖：沒有站、或用的是手機上的舊行程（連不上，地圖也載不到）就只有路線
  const mappable = state.status === "ready" && !state.cached && state.route.stops.length > 0
  // 內容放得下才並排；窄桌機與大字設定也保留路線／地圖切換。
  const onMap = !split && mappable && params.get("view") === "map"
  const headerRef = useRef<HTMLElement>(null)
  const switchRef = useRef<HTMLDivElement>(null)
  // 固定的頁首有多高（字放多大不一樣）：地圖照它算高度（home-map-panel.tsx 的 --home-header）
  const [headerHeight, setHeaderHeight] = useState<number | null>(null)
  // 按過路線／地圖切換：之後換過去的那一邊從旁邊滑進來
  const [switched, setSwitched] = useState(false)

  useEffect(() => {
    const header = headerRef.current
    if (!header) return
    const observer = new ResizeObserver(() => setHeaderHeight(header.offsetHeight))
    observer.observe(header)
    return () => observer.disconnect()
  }, [userId])

  // 切到地圖（或從客戶檔案回到地圖）時，把切換捲到固定的頁首正下面：地圖的高度是照這個位置算的，
  // 上面有新人卡、需立即處理時不捲的話，地圖下半與底下那張卡會被輸入列蓋住
  useEffect(() => {
    const node = switchRef.current
    if (!onMap || !node) return
    const top = node.getBoundingClientRect().top + window.scrollY - (headerRef.current?.offsetHeight ?? 0)
    window.scrollTo({ top: Math.max(top, 0), behavior: "smooth" })
  }, [onMap])

  if (!user) return null // 沒登入進不來（App.tsx 會導去登入頁），這行只是讓型別成立

  const route = state.status === "ready" ? state.route : null
  const urgent = route?.urgent ?? null
  // 行程上又有急件（重新載入、別人改過）：留著的那一張就不要了，之後按三顆鈕拿掉新的那一張時才不會又冒出來
  if (urgent && heldUrgent) setHeldUrgent(null)
  const card = route ? urgentCard(urgent, heldUrgent, riding) : null

  // 開始騎一段（點站、點座騎重播；減少動態效果或量不到位置而直接停好也算）：送出騎過的座騎（每騎一次送一次）
  function recordRide(leg: Leg) {
    // 送完（含補送先前存起來的）重拿一次圖鑑的數字
    void sendRides(ridesOf(leg)).then(() => setCollectedTick((n) => n + 1))
  }

  // 點了一站：後端記成到過，回每站的進度與這次解鎖的獎牌。熊已經在騎了，不等它。回有沒有記到（RoutePath 的收工要看）
  async function arrive(customerId: string): Promise<boolean> {
    if (!user) return false
    const seq = arrivals.next()
    try {
      const { progress, unlocked: fresh } = await arriveAt(customerId)
      // 連點 A、B，A 的比較晚回來：A 的進度裡還沒有 B，套用的話 B 的打勾與進度會退回去，所以畫面與快取只收較新的
      if (arrivals.take(seq)) {
        // 進度套到現在畫面上那一份（回來之前可能已經重新載入過）；站對不上（別的評審剛改過、IT 重置）就背景重新讀一次，
        // 讀回來之前畫面照舊
        const current = latest.current
        const next = current.status === "ready" ? applyProgress(current.route, progress) : null
        if (next && current.status === "ready") {
          // 點的是急件那一站：卡片先留著，熊到了才收（lib/urgent-card.ts），路線不會在騎到一半往上跳
          if (current.route.urgent && !next.urgent) setHeldUrgent(current.route.urgent)
          setState({ status: "ready", route: next, cached: current.cached })
          cacheRoute(user.id, next)
          // 畫面上是連不上時的舊行程：時間與車程也可能是舊的，背景再讀一次整份
          if (current.cached) reload()
        } else reload()
      }
      setUnsaved((now) => new Set([...now].filter((id) => id !== customerId)))
      if (fresh.length > 0) setUnlocked(fresh)
      return true
    } catch (error) {
      // 這家剛被別人從路線拿掉（404）、行程剛被重置（409）：重新載入最新的
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        reload()
        return false
      }
      setUnsaved((now) => new Set([...now, customerId]))
      return false
    }
  }

  // 記在網址上：從客戶檔案按返回，回來還是地圖。按了切換才滑動，一打開頁面不滑
  function showView(view: "route" | "map") {
    setSwitched(true)
    setParams(view === "map" ? { view: "map" } : {}, { replace: true })
  }

  // 重新跟後端要一次路線；期間畫面仍顯示目前這份，只在上面標「更新今天的行程…」
  function reload() {
    setBusy(true)
    setAttempt((n) => n + 1)
  }

  // 三顆鈕：後端改今天的行程，回來的就是改好的那一份。行程剛被別人改過（409）、
  // 或這家剛被別人跑完拿掉了（404）都重新載入最新的
  async function feedback(action: RouteAction, message: string) {
    if (!user || !urgent || !route) return
    setBusy(true)
    try {
      const next = await sendRouteFeedback(user.id, urgent.customer_id, action, route.version)
      setState({ status: "ready", route: next, cached: false })
      setHint(message)
      setBusy(false)
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.status === 404)) {
        setHint(error.message)
        reload()
        return
      }
      setHint(error instanceof ApiError ? error.message : "連不上伺服器，這次沒有改到，請再試一次。")
      setBusy(false)
    }
  }

  // 換一段的交通方式：後端重算之後回整份行程。行程剛被別人改過（409）、
  // 或這兩家已經不相鄰（422，例如剛被別人拖過）都重新載入最新的
  async function pickMode(from: string | null, to: string, mode: LegMode) {
    if (!user || !route) return
    setBusy(true)
    try {
      const next = await setLegMode(user.id, route.version, from, to, mode)
      setState({ status: "ready", route: next, cached: false })
      setHint(null)
      setBusy(false)
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.status === 422)) {
        setHint(error.message)
        reload()
        return
      }
      setHint(error instanceof ApiError ? error.message : "連不上伺服器，這次沒有改到，請再試一次。")
      setBusy(false)
    }
  }

  const pin = () => feedback("pin", "已插到下一站，之後這類提醒會排前面一點。")
  const snooze = () => feedback("snooze", "先暫緩，三天內不會再排這家。")
  const misjudge = () => feedback("misjudge", "知道了，這類提醒會少排一點。")

  return (
    <div
      className="flex min-h-svh flex-col"
      style={{
        "--home-header": headerHeight ? `${headerHeight}px` : undefined,
        "--home-route-width": split ? "27.5rem" : "calc(100% - 17rem)",
      } as CSSProperties}
    >
      <header ref={headerRef} className="sticky top-0 z-10 bg-background/95 px-4 pt-2 pb-3 backdrop-blur lg:px-6">
        <SalesToolbar user={user}>
          {route && route.total > 0 && (
            <span className="flex h-[40px] items-center gap-1 px-1.5 text-sm font-semibold tabular-nums">
              <Flag className="size-5 fill-primary text-primary" />
              <span className="sr-only">今日進度</span>
              {route.done}/{route.total}
            </span>
          )}
        </SalesToolbar>
        {/* 像 Duolingo 的單元橫幅；右邊的「指南」換成方法卡：主管教的做法，出門前或進門前翻一下 */}
        <div className="mt-1 flex items-stretch overflow-hidden rounded-2xl bg-primary text-primary-foreground lg:mt-0 shadow-lip-primary">
          <div className="min-w-0 flex-1 px-4 py-2.5">
            {route && (
              <p className="text-xs font-semibold opacity-85">
                {/* 點日期進日曆：每一天要帶什麼、講過什麼（pages/calendar.tsx）。負的外距讓點得到的範圍大一點，橫幅不變高 */}
                <Link
                  to="/calendar"
                  aria-label="打開日曆"
                  className="-mx-1 -my-2 inline-flex items-center gap-1 rounded-md px-1 py-2 underline decoration-dotted underline-offset-2 active:bg-black/10"
                >
                  <CalendarDays className="size-3.5" />
                  {formatDayLabel(route.date)}
                </Link>
                {route.total > 0 && ` · ${route.total} 站`}
                {/* 手機上存的舊行程（這一版以前）沒有交通方式 */}
                {route.total > 0 && route.travel_mode && ` · ${TRAVEL_MODE_LABEL[route.travel_mode]}`}
              </p>
            )}
            <h1 className="text-xl leading-snug font-semibold">今日路線</h1>
          </div>
          {/* 電腦版頁首第一列收起來了，今日進度放在橫幅右邊 */}
          {route && route.total > 0 && (
            <span className="hidden items-center gap-1 px-4 text-sm font-semibold tabular-nums lg:flex">
              <Flag className="size-5 fill-current" />
              <span className="sr-only">今日進度</span>
              {route.done}/{route.total}
            </span>
          )}
          {state.status === "ready" && !state.cached && <EditRouteLink />}
          <Link
            to="/methods"
            className="flex w-16 shrink-0 flex-col items-center justify-center gap-0.5 border-l-2 border-black/15 text-xs font-semibold active:bg-black/10"
          >
            <BookOpenText className="size-5" />
            方法卡
          </Link>
        </div>
      </header>

      {/* 底部分頁列約 64px，上面再疊一條跟熊熊滾說的輸入列，最後的終點要露出來 */}
      {/* overflow-x-clip：路線與地圖互相滑進來時，不要短暫多出左右捲軸 */}
      <main ref={layoutRef} className={cn("flex-1 overflow-x-clip px-4 pt-3 pb-48 lg:px-6 lg:pb-24", split && "lg:flex lg:items-start lg:gap-6")}>
        <div className={cn("min-w-0", split && "lg:w-[27.5rem] lg:shrink-0")}>
        <Link to="/reports" className="mb-3 flex min-h-14 items-center gap-3 rounded-2xl border-2 bg-card px-4 py-3 shadow-lip lg:hidden">
          <ChartNoAxesCombined className="size-5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 text-sm font-semibold">我的報表<span className="ml-2 text-xs font-normal text-muted-foreground">自選指標 · AI 調整</span></span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
        {/* 新人才有的入口卡；自己問自己的資料，載不到就不顯示，跟下面的路線互不影響 */}
        <FirstWeekEntry userId={user.id} />
        {state.status === "ready" && state.cached && (
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-muted px-3 py-2">
            <p className="flex-1 text-xs text-muted-foreground">
              連不上伺服器，顯示上次載入的路線（{formatDate(state.route.date)}）。
            </p>
            <Button variant="outline" className="h-11 shrink-0 px-3" disabled={busy} onClick={reload}>
              重新載入
            </Button>
          </div>
        )}
        {hint && <p className="mb-3 rounded-xl bg-primary/10 px-3 py-2 text-xs text-primary">{hint}</p>}
        {route && <SkippedHabitsNote route={route} />}
        {busy && route && (
          <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            更新今天的行程…
          </p>
        )}
        {state.status === "loading" && (
          <div className="flex flex-col items-center gap-2 py-10">
            <Mascot state="wait" size={96} />
            <p className="text-sm text-muted-foreground">載入今日路線中…</p>
          </div>
        )}
        {state.status === "denied" && (
          <Notice
            text={state.message}
            action={{ label: "去主管端", onClick: () => navigate("/manager") }}
            secondary={{ label: "去客戶清單", onClick: () => navigate("/customers") }}
          />
        )}
        {state.status === "error" && (
          <Notice
            text="連不上伺服器，今日路線沒有載入。"
            action={{ label: "重新載入", onClick: reload }}
            secondary={{ label: "去客戶清單", onClick: () => navigate("/customers") }}
          />
        )}

        {card && (
          // 收起來：高度與透明度一起收（grid 的 1fr → 0fr），底下的路線跟著平順往上。
          // 外距放在卡片上、不放在外層的 padding：padding 收不掉，最後會再跳 8px
          <div
            data-urgent-card={card.closing ? "closing" : card.stale ? "stale" : "live"}
            aria-hidden={card.closing || undefined}
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
              card.closing ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]"
            )}
          >
            <div className="min-h-0 overflow-hidden">
              <article className="mb-2 flex flex-col gap-2 rounded-2xl border-2 border-destructive/30 bg-destructive/10 p-4 shadow-lip-destructive-soft">
                <span className="flex items-center gap-1 self-start rounded-md bg-destructive px-2 py-1 text-xs font-semibold text-white">
                  <TriangleAlert className="size-3" />
                  需立即處理 · {card.urgent.headline}
                </span>
                <Link
                  to={`/customers/${card.urgent.customer_id}`}
                  tabIndex={card.closing ? -1 : undefined}
                  className="flex min-h-11 items-center text-base leading-snug font-semibold"
                >
                  {card.urgent.customer_name}
                </Link>
                <p className="text-xs leading-relaxed">{card.urgent.detail}</p>
                {card.urgent.note && <p className="text-xs leading-relaxed text-muted-foreground">{card.urgent.note}</p>}
                {/* 留著的那一張（這一站已經到過）鈕不能按 */}
                <div className="mt-1 flex gap-2">
                  <Button variant="danger" className="h-11 flex-1" disabled={busy || card.stale} onClick={pin}>
                    插入下一站
                  </Button>
                  <Button variant="outline" className="h-11 w-16 shrink-0" disabled={busy || card.stale} onClick={snooze}>
                    暫緩
                  </Button>
                  <Button variant="outline" className="h-11 w-16 shrink-0" disabled={busy || card.stale} onClick={misjudge}>
                    誤判
                  </Button>
                </div>
              </article>
            </div>
          </div>
        )}

        {mappable && !split && <ViewSwitch ref={switchRef} onMap={onMap} onChange={showView} />}
        {route &&
          (route.stops.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Mascot state="think" size={96} />
              <p className="text-sm text-muted-foreground">今天沒有排定的拜訪。</p>
              <Link to="/customers" className={cn(buttonVariants(), "h-11 px-6")}>
                自己挑一家
              </Link>
            </div>
          ) : (
            // 地圖在切換的右邊、路線在左邊：換過去的那一邊從那一側滑進來
            <div
              key={onMap ? "map" : "route"}
              className={cn(
                switched && "animate-in duration-300 fade-in motion-reduce:animate-none",
                switched && (onMap ? "slide-in-from-right-8" : "slide-in-from-left-8")
              )}
            >
              {onMap ? (
                <HomeMapPanel
                  route={route}
                  userId={user.id}
                  onRoute={(next) => setState({ status: "ready", route: next, cached: false })}
                />
              ) : (
                <RoutePath
                  stops={route.stops}
                  dayMode={route.travel_mode}
                  officeStart={route.office_start}
                  startCity={route.start_city}
                  onPickMode={state.status === "ready" && !state.cached && !busy ? pickMode : undefined}
                  onArrive={arrive}
                  unsaved={unsaved}
                  onRide={recordRide}
                  onRidingChange={setRiding}
                  collected={collected}
                />
              )}
            </div>
          ))}
        </div>
        {/* 電腦版：地圖在右欄，固定在頁首下面；沒有站或用的是舊行程就不畫 */}
        {split && mappable && route && (
          <div className="sticky top-[calc(var(--home-header,8rem)+0.75rem)] min-w-0 flex-1">
            <HomeMapPanel
              sideBySide
              route={route}
              userId={user.id}
              onRoute={(next) => setState({ status: "ready", route: next, cached: false })}
            />
          </div>
        )}
      </main>
      {/* 跟熊熊滾說要怎麼排：連不上、用的是手機上的舊行程時不給問 */}
      {state.status === "ready" && !state.cached && (
        <HomeAsk
          userId={user.id}
          onApplied={(next) => {
            setState({ status: "ready", route: next, cached: false })
            setHint("已套用熊熊滾的提案。")
          }}
        />
      )}
      {unlocked.length > 0 && <UnlockToast medals={unlocked} onDone={() => setUnlocked([])} />}
      <BottomNav />
      {/* 位置分享只有第一次的說明，按「知道了」就結束；暫停、繼續在帳號設定（components/route/location-share.tsx） */}
      <LocationConsent />
    </div>
  )
}

/** 路線／地圖切換：平常看蛇行的路線，要看地圖再切過來 */
function ViewSwitch({
  ref,
  onMap,
  onChange,
}: {
  ref: Ref<HTMLDivElement>
  onMap: boolean
  onChange: (view: "route" | "map") => void
}) {
  const tab = (active: boolean) =>
    cn(
      "flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition-colors",
      active ? "bg-card text-foreground shadow-[0_2px_0_var(--lip)]" : "text-muted-foreground"
    )
  return (
    <div ref={ref} role="group" aria-label="怎麼看今天的路線" className="mb-3 flex gap-1 rounded-2xl bg-muted p-1">
      <button type="button" aria-pressed={!onMap} onClick={() => onChange("route")} className={tab(!onMap)}>
        <Route className="size-4" />
        路線
      </button>
      <button type="button" aria-pressed={onMap} onClick={() => onChange("map")} className={tab(onMap)}>
        <MapIcon className="size-4" />
        地圖
      </button>
    </div>
  )
}
