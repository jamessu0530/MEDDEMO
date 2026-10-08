import { useEffect, useRef, useState, type CSSProperties, type Ref } from "react"
import {
  Bell,
  BookOpenText,
  CalendarDays,
  ChevronRight,
  FileText,
  Flag,
  Loader2,
  Map as MapIcon,
  Route,
  TriangleAlert,
} from "lucide-react"
import { Link, useNavigate, useSearchParams } from "react-router"

import { ApiError } from "@/api/client"
import { getTodayRoute, sendRouteFeedback, setLegMode, type LegMode, type RouteAction, type TodayRoute } from "@/api/route"
import { BottomNav } from "@/components/bottom-nav"
import { Mascot } from "@/components/mascot"
import { Notice } from "@/components/notice"
import { MyStatusButton } from "@/components/my-status"
import { RoutePath } from "@/components/route-path"
import { EditRouteLink, SkippedHabitsNote } from "@/components/route/home-extras"
import { HomeAsk } from "@/components/route/home-ask"
import { HomeMapPanel } from "@/components/route/home-map-panel"
import { ShareBar } from "@/components/route/share-bar"
import { SkinToggle } from "@/components/skin-toggle"
import { Button, buttonVariants } from "@/components/ui/button"
import { useAuth } from "@/lib/auth"
import { formatDate, formatDayLabel } from "@/lib/format"
import { useUnseenReplies } from "@/lib/manager-replies"
import { TRAVEL_MODE_LABEL } from "@/lib/travel-mode"
import { cn } from "@/lib/utils"
import { FirstWeekEntry } from "@/pages/first-week"

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  // 後端說這個帳號不該有路線（主管）：直接顯示它那一句，不要說成連不上
  | { status: "denied"; message: string }
  | { status: "ready"; route: TodayRoute; cached: boolean }

/**
 * 今日路線（首頁）：一天要跑哪幾家、順序、以及每一家為什麼被排進來。
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
  const userId = user?.id ?? null
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const unseen = useUnseenReplies()

  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    getTodayRoute(userId, controller.signal)
      .then(({ route, cached }) => setState({ status: "ready", route, cached }))
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
  const onMap = mappable && params.get("view") === "map"
  const headerRef = useRef<HTMLElement>(null)
  const switchRef = useRef<HTMLDivElement>(null)
  // 固定的頁首有多高（有沒有位置分享列、字放多大都不一樣）：地圖照它算高度（home-map-panel.tsx 的 --home-header）
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
      style={headerHeight ? ({ "--home-header": `${headerHeight}px` } as CSSProperties) : undefined}
    >
      <header ref={headerRef} className="sticky top-0 z-10 bg-background/95 px-4 pt-2 pb-3 backdrop-blur">
        <div className="-mr-2 flex items-center justify-between gap-2">
          {/* 自己的頭像：點了換狀態（有空、忙碌、顯示為離線…）；點名字進帳號設定：改密碼、登出、使用說明 */}
          <div className="flex min-w-0 items-center gap-1.5">
            <MyStatusButton className="size-9" />
            <Link to="/settings" className="flex h-11 min-w-0 items-center gap-1 text-xs text-muted-foreground">
              {/* 名字自己一行、區與示範說明另一行：右邊還有狀態列，放大字體時接在一起整句會被截到只剩一兩個字 */}
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate">{user.name}</span>
                <span className="truncate">
                  {user.region}
                  {user.acting_as && ` · 示範：${user.acting_as.name}的客戶`}
                </span>
              </span>
              <ChevronRight className="size-3.5 shrink-0" />
            </Link>
          </div>
          {/* 像 Duolingo 的狀態列：圖示加數字。進度只是顯示，其他三顆可以按。
              按鈕用固定的 40px，不跟著放大字體變大，不然左邊的名字會被擠到只剩一個字 */}
          <div className="flex shrink-0 items-center">
            {/* 今天沒排拜訪就不顯示 0/0 */}
            {route && route.total > 0 && (
              <span className="flex h-[40px] items-center gap-1 px-1.5 text-sm font-semibold tabular-nums">
                <Flag className="size-5 fill-primary text-primary" />
                <span className="sr-only">今日進度</span>
                {route.done}/{route.total}
              </span>
            )}
            {/* FR-8.4：主管回覆了，顯示還沒看的則數 */}
            <Link
              to="/escalations"
              aria-label={unseen > 0 ? `主管回覆 ${unseen} 則，查看` : "轉給主管的提問"}
              className="flex h-[40px] min-w-[40px] items-center justify-center gap-1 rounded-lg px-1.5 hover:bg-muted"
            >
              <Bell className={cn("size-5", unseen > 0 ? "fill-warning text-warning" : "text-muted-foreground")} />
              {unseen > 0 && <span className="text-sm font-semibold text-warning tabular-nums">{unseen}</span>}
            </Link>
            <Link
              to="/oa/forms"
              aria-label="我的申請單"
              className="flex size-[40px] items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <FileText className="size-5" />
            </Link>
            <SkinToggle className="size-[40px]" />
          </div>
        </div>
        {/* 像 Duolingo 的單元橫幅；右邊的「指南」換成方法卡：主管教的做法，出門前或進門前翻一下 */}
        <div className="mt-1 flex items-stretch overflow-hidden rounded-2xl bg-primary text-primary-foreground shadow-lip-primary">
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
            <h1 className="text-lg leading-snug font-semibold">今日路線</h1>
          </div>
          {state.status === "ready" && !state.cached && <EditRouteLink />}
          <Link
            to="/methods"
            className="flex w-16 shrink-0 flex-col items-center justify-center gap-0.5 border-l-2 border-black/15 text-[0.6875rem] font-semibold active:bg-black/10"
          >
            <BookOpenText className="size-5" />
            方法卡
          </Link>
        </div>
        {/* 位置分享列：上班時間主管看得到你在哪（components/route/share-bar.tsx） */}
        <ShareBar />
      </header>

      {/* 底部分頁列約 64px，上面再疊一條跟熊熊滾說的輸入列，最後的終點要露出來 */}
      {/* overflow-x-clip：路線與地圖互相滑進來時，不要短暫多出左右捲軸 */}
      <main className="flex-1 overflow-x-clip px-4 pt-3 pb-48">
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

        {route && urgent && (
          <article className="mb-2 flex flex-col gap-2 rounded-2xl border-2 border-destructive/30 bg-destructive/10 p-4 shadow-lip-destructive-soft">
            <span className="flex items-center gap-1 self-start rounded-md bg-destructive px-2 py-1 text-[0.6875rem] font-semibold text-white">
              <TriangleAlert className="size-3" />
              需立即處理 · {urgent.headline}
            </span>
            <Link
              to={`/customers/${urgent.customer_id}`}
              className="flex min-h-11 items-center text-base leading-snug font-semibold"
            >
              {urgent.customer_name}
            </Link>
            <p className="text-xs leading-relaxed">{urgent.detail}</p>
            {urgent.note && <p className="text-xs leading-relaxed text-muted-foreground">{urgent.note}</p>}
            <div className="mt-1 flex gap-2">
              <Button variant="danger" className="h-11 flex-1" disabled={busy} onClick={pin}>
                插入下一站
              </Button>
              <Button variant="outline" className="h-11 w-16 shrink-0" disabled={busy} onClick={snooze}>
                暫緩
              </Button>
              <Button variant="outline" className="h-11 w-16 shrink-0" disabled={busy} onClick={misjudge}>
                誤判
              </Button>
            </div>
          </article>
        )}

        {mappable && <ViewSwitch ref={switchRef} onMap={onMap} onChange={showView} />}
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
                />
              )}
            </div>
          ))}
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
      <BottomNav />
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
