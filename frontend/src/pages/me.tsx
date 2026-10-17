import { lazy, Suspense, useEffect, useState, type ComponentType } from "react"
import {
  ChartNoAxesCombined,
  ChevronRight,
  Medal,
  Settings,
  Shirt,
} from "@/components/icons"
import { Link, Navigate, useSearchParams } from "react-router"

import { getMe, type Me } from "@/api/me"
import { UserAvatar } from "@/components/user-avatar"
import { MedalWall } from "@/components/me/medal-wall"
import { PersonalMemory } from "@/components/me/personal-memory"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { useAuth } from "@/lib/auth"
import { formatWan } from "@/lib/format"

type LoadState =
  { status: "loading" } | { status: "error" } | { status: "ready"; me: Me }

const Performance = lazy(() => import("@/components/me/performance"))

/** 個人頁只顯示概況與功能入口；獎牌和業績在點開時才呈現。 */
export function MePage() {
  const user = useAuth()?.user
  const [params] = useSearchParams()
  const requestedView = params.get("view")
  const view =
    requestedView === "achievements" || requestedView === "performance"
      ? requestedView
      : "overview"
  const title =
    view === "achievements"
      ? "成就與獎牌"
      : view === "performance"
        ? "業績概況"
        : "個人頁"
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getMe(controller.signal)
      .then((me) => setState({ status: "ready", me }))
      .catch(() => {
        // 主管、IT 在下面就轉去帳號設定了，業務拿不到只會是連不上或伺服器出錯
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => controller.abort()
  }, [attempt, user?.id, user?.acting_as?.id])

  if (user && user.role !== "sales") return <Navigate to="/settings" replace />

  return (
    <div className="flex flex-col">
      <PageHeader
        title={title}
        backTo={view === "overview" ? "/" : "/me"}
        trailing={
          view === "overview" && (
            <Link
              to="/settings"
              aria-label="帳號設定"
              className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <Settings className="size-5" />
            </Link>
          )
        }
      />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 pt-6 pb-10 sm:px-6">
        {state.status === "loading" && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            載入個人頁中…
          </p>
        )}
        {state.status === "error" && (
          <Notice
            text="個人頁暫時載入不了"
            action={{
              label: "再試一次",
              onClick: () => {
                setState({ status: "loading" })
                setAttempt((n) => n + 1)
              },
            }}
          />
        )}
        {view === "overview" && state.status === "ready" && user && (
          <>
            <div className="flex items-center gap-3.5">
              <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-accent">
                <UserAvatar
                  id={user.id}
                  name={user.name}
                  size="lg"
                  className="size-16"
                />
              </span>
              <div className="min-w-0">
                <p className="text-xl font-semibold">{state.me.name}</p>
                <p className="text-sm text-muted-foreground">
                  {state.me.region} · 業務
                </p>
                {user.acting_as && (
                  <p className="text-xs text-muted-foreground">
                    示範業務的個人頁
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 divide-x rounded-2xl bg-muted/50 py-3">
              <Stat
                value={state.me.stats.visits_last_year.toLocaleString("zh-TW")}
                label="近一年拜訪"
              />
              <Stat value={String(state.me.stats.customers)} label="名下客戶" />
              <Stat
                value={formatWan(state.me.stats.sales_last_year, 0)}
                label="近一年業績"
              />
            </div>
          </>
        )}
        {view === "overview" && (
          <nav
            aria-label="個人功能"
            className="overflow-hidden rounded-2xl border bg-card [&>*+*]:border-t"
          >
            <PersonalMemory compact />
            <ProfileLink
              to="/me?view=achievements"
              icon={Medal}
              label="成就與獎牌"
              detail={
                state.status === "ready"
                  ? `${state.me.medals.filter((medal) => medal.unlocked_on).length} / ${state.me.medals.length}`
                  : undefined
              }
            />
            <ProfileLink to="/mascots" icon={Shirt} label="熊熊衣櫃" />
            <ProfileLink
              to="/me?view=performance"
              icon={ChartNoAxesCombined}
              label="業績概況"
            />
          </nav>
        )}
        {view !== "overview" && state.status === "ready" && user && (
          <Suspense
            fallback={
              <p className="py-10 text-center text-sm text-muted-foreground">
                載入中…
              </p>
            }
          >
            {view === "achievements" ? (
              <MedalWall medals={state.me.medals} userId={user.id} />
            ) : (
              <Performance me={state.me} />
            )}
          </Suspense>
        )}
      </main>
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-2 text-center">
      <p className="text-xl font-semibold">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function ProfileLink({
  to,
  icon: Icon,
  label,
  detail,
}: {
  to: string
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  label: string
  detail?: string
}) {
  return (
    <Link
      to={to}
      className="flex min-h-14 items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      <span className="flex-1 font-medium">{label}</span>
      {detail && (
        <span
          className="text-xs text-muted-foreground tabular-nums"
          aria-label={`已解鎖 ${detail} 面獎牌`}
        >
          {detail}
        </span>
      )}
      <ChevronRight
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground"
      />
    </Link>
  )
}
