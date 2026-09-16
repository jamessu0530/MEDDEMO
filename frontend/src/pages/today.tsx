import { useEffect, useState } from "react"
import { Bell, Check, ChevronRight, CircleHelp, ListOrdered, Loader2, TriangleAlert } from "lucide-react"
import { Link, useNavigate } from "react-router"

import { signOutSession } from "@/api/auth"
import { ApiError } from "@/api/client"
import { getTodayRoute, SIGNAL_LABEL, type RouteSignal, type RouteStop, type TodayRoute } from "@/api/route"
import { BottomNav } from "@/components/bottom-nav"
import { Notice } from "@/components/notice"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth"
import { formatDate } from "@/lib/format"
import { useUnseenReplies } from "@/lib/manager-replies"
import { openGuide } from "@/lib/onboarding"
import { markMisjudged, pinCustomer, readFeedback, snoozeCustomer } from "@/lib/route-feedback"
import { cn } from "@/lib/utils"

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  // 後端說這個帳號不該有路線（主管）：直接顯示它那一句，不要說成連不上
  | { status: "denied"; message: string }
  | { status: "ready"; route: TodayRoute; cached: boolean }

const STATUS_LABEL: Record<RouteStop["status"], string> = {
  done: "已完成",
  next: "下一站",
  todo: "待拜訪",
}

/**
 * 今日路線（首頁）：一天要跑哪幾家、順序、以及每一家為什麼被排進來。
 * 最上面是「需立即處理」，業務按三顆鈕給回饋（插入下一站／暫緩／誤判），
 * 回饋只存在這支手機（lib/route-feedback.ts），每次要路線時一起送出去重排。
 */
export function TodayPage() {
  const navigate = useNavigate()
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
    getTodayRoute(userId, readFeedback(userId), controller.signal)
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

  if (!user) return null // 沒登入進不來（App.tsx 會導去登入頁），這行只是讓型別成立

  const route = state.status === "ready" ? state.route : null
  const urgent = route?.urgent ?? null
  const percent = route && route.total > 0 ? Math.round((route.done / route.total) * 100) : 0

  // 重新跟後端要一次路線；期間畫面仍顯示目前這份，只在上面標「重新排今天的順序…」
  function reload() {
    setBusy(true)
    setAttempt((n) => n + 1)
  }

  // 三顆鈕：只改這支手機記著的回饋，然後重新跟後端要一次路線
  function pin() {
    if (!user || !urgent) return
    pinCustomer(user.id, urgent.customer_id, urgent.signal)
    setHint("已插到下一站，之後這類提醒會排前面一點。")
    reload()
  }

  function snooze() {
    if (!user || !urgent || !route) return
    snoozeCustomer(user.id, urgent.customer_id, route.date)
    setHint("先暫緩，三天內不會再排這家。")
    reload()
  }

  function misjudge() {
    if (!user || !urgent || !route) return
    markMisjudged(user.id, urgent.customer_id, urgent.signal, route.date)
    setHint("知道了，這類提醒會少排一點。")
    reload()
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 pt-2 pb-3 backdrop-blur">
        <div className="-mr-2 flex items-center justify-between gap-2">
          {/* 點自己的名字進帳號設定：改密碼、登出 */}
          <Link to="/settings" className="flex h-11 min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <span className="truncate">
              {user.region} · {user.name}
              {user.acting_as && `（示範：${user.acting_as.name}的客戶）`}
            </span>
            <ChevronRight className="size-3.5 shrink-0" />
          </Link>
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              aria-label="使用說明"
              onClick={openGuide}
              className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <CircleHelp className="size-5" />
            </button>
            {/* FR-8.4：主管回覆了，首頁顯示還沒看的則數 */}
            <Link
              to="/escalations"
              aria-label={unseen > 0 ? `主管回覆 ${unseen} 則，查看` : "轉給主管的提問"}
              className="relative flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <Bell className="size-5" />
              {unseen > 0 && (
                <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
                  {unseen}
                </span>
              )}
            </Link>
          </div>
        </div>
        <div className="-mr-2 flex items-center justify-between gap-2">
          <h1 className="truncate text-lg font-semibold">今日路線{route ? ` · ${formatDate(route.date)}` : ""}</h1>
          <button
            type="button"
            onClick={() => void signOutSession()}
            className="flex h-11 shrink-0 items-center rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted"
          >
            登出
          </button>
        </div>
        {route && (
          <div className="mt-2 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              已完成 {route.done} / {route.total}
            </span>
          </div>
        )}
      </header>

      <main className="flex-1 px-4 pt-3 pb-20">
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
        {busy && route && (
          <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            重新排今天的順序…
          </p>
        )}
        {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入今日路線中…</p>}
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
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-destructive">
              <TriangleAlert className="size-3.5" />
              <span className="text-xs font-semibold tracking-wide">需立即處理</span>
            </div>
            <article className="flex flex-col gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-4">
              <span className="self-start rounded-md bg-destructive px-2 py-1 text-[11px] text-white">{urgent.headline}</span>
              <Link
                to={`/customers/${urgent.customer_id}`}
                className="flex min-h-11 items-center text-[15px] leading-snug font-semibold"
              >
                {urgent.customer_name}
              </Link>
              <p className="text-xs leading-relaxed">{urgent.detail}</p>
              {urgent.note && <p className="text-xs leading-relaxed text-muted-foreground">{urgent.note}</p>}
              <div className="mt-1 flex gap-2">
                <Button variant="ghost" className="h-11 flex-1 bg-destructive text-white hover:bg-destructive/90 hover:text-white" disabled={busy} onClick={pin}>
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
          </section>
        )}

        {route && (
          <section className={cn("flex flex-col gap-2", urgent && "mt-4")}>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <ListOrdered className="size-3.5" />
              <span className="text-xs font-semibold tracking-wide">今日順序</span>
            </div>
            {route.stops.length === 0 ? (
              <Notice
                text="今天沒有排定的拜訪。"
                action={{ label: "自己挑一家", onClick: () => navigate("/customers") }}
              />
            ) : (
              route.stops.map((stop, index) => <StopRow key={stop.customer_id} stop={stop} index={index} />)
            )}
          </section>
        )}
      </main>
      <BottomNav />
    </div>
  )
}

/** 今日的一站；點進去是客戶檔案（進門前三分鐘） */
function StopRow({ stop, index }: { stop: RouteStop; index: number }) {
  const done = stop.status === "done"
  const next = stop.status === "next"

  return (
    <Link
      to={`/customers/${stop.customer_id}`}
      className={cn(
        "flex flex-col gap-2.5 rounded-2xl border bg-card p-3 active:bg-muted",
        next && "border-primary/40",
        done && "opacity-60"
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            done && "bg-primary/10 text-primary",
            next && "bg-primary text-primary-foreground",
            !done && !next && "bg-secondary text-secondary-foreground"
          )}
        >
          {done ? <Check className="size-4" /> : index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("truncate leading-snug font-medium", done && "line-through")}>{stop.customer_name}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {done && `${stop.planned_time} 完成${stop.visit_id ? " · 已回寫" : ""}`}
            {next && `${stop.planned_time} · 下一站`}
            {!done && !next && (
              <>
                {stop.planned_time} · <SignalLabel signal={stop.signal} /> · {stop.reason}
              </>
            )}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md px-2 py-1 text-[11px]",
            next ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground"
          )}
        >
          {STATUS_LABEL[stop.status]}
        </span>
      </div>
      {/* 下一站多寫一行為什麼排這家，並直接給進客戶檔案的入口 */}
      {next && (
        <>
          <p className="text-xs leading-relaxed text-foreground/80">
            <SignalLabel signal={stop.signal} /> · {stop.reason}
          </p>
          <span className="flex h-11 items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground">
            開啟拜訪準備
          </span>
        </>
      )}
    </Link>
  )
}

/** 排進來的理由；商機是好消息，用綠色標出來，跟承諾逾期、帳款這些警示分開 */
function SignalLabel({ signal }: { signal: RouteSignal }) {
  if (signal !== "opportunity") return <>{SIGNAL_LABEL[signal]}</>
  return <span className="font-medium text-success">{SIGNAL_LABEL[signal]}</span>
}
