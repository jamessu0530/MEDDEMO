import { lazy, Suspense, useEffect, useState, type ComponentType } from "react"
import {
  ChartNoAxesCombined,
  ChevronRight,
  GraduationCap,
  Medal,
  MessagesSquare,
  Shirt,
} from "lucide-react"
import { Link, useSearchParams } from "react-router"

import { getMe, type Me } from "@/api/me"
import { WorkdayHome } from "@/components/me/workday-home"
import { MedalWall } from "@/components/me/medal-wall"
import { PersonalMemory } from "@/components/me/personal-memory"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { useAuth } from "@/lib/auth"
import { formatWan } from "@/lib/format"

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; me: Me }
const Performance = lazy(() => import("@/components/me/performance"))

/** 打卡、目標和個人功能共用 Workday 首頁構圖；保留業務既有的業績與獎牌頁。 */
export function MePage() {
  const user = useAuth()?.user
  const [params] = useSearchParams()
  const requestedView = params.get("view")
  const view =
    user?.role === "sales" && (requestedView === "achievements" || requestedView === "performance")
      ? requestedView
      : "overview"
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (user?.role !== "sales") return
    const controller = new AbortController()
    getMe(controller.signal)
      .then((me) => setState({ status: "ready", me }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => controller.abort()
  }, [attempt, user?.id, user?.role, user?.acting_as?.id])

  const retry = () => {
    setState({ status: "loading" })
    setAttempt((value) => value + 1)
  }

  if (view !== "overview")
    return (
      <main className="wd-detail-page">
        <PageHeader title={view === "achievements" ? "成就與獎牌" : "業績概況"} backTo="/me" />
        {state.status === "loading" && <p className="wd-card-message">載入中…</p>}
        {state.status === "error" && (
          <Notice text="個人頁暫時載入不了" action={{ label: "再試一次", onClick: retry }} />
        )}
        {state.status === "ready" && user && (
          <Suspense fallback={<p className="wd-card-message">載入中…</p>}>
            {view === "achievements" ? (
              <MedalWall medals={state.me.medals} userId={user.id} />
            ) : (
              <Performance me={state.me} />
            )}
          </Suspense>
        )}
      </main>
    )

  return (
    <main className="wd-personal-page">
      <WorkdayHome key={`${user?.id}:${user?.role}`}>
        <nav className="wd-card wd-apps" aria-label="個人功能">
          <div className="wd-card-heading">
            <h2>常用應用程式</h2>
          </div>
          <div className="wd-app-links">
            <ProfileLink to="/conversations" icon={MessagesSquare} label="對話紀錄" />
            {user?.role === "sales" && (
              <>
                <ProfileLink to="/first-week" icon={GraduationCap} label="新人課程" />
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
                <ProfileLink
                  to="/me?view=performance"
                  icon={ChartNoAxesCombined}
                  label="業績概況"
                />
              </>
            )}
            <ProfileLink to="/mascots" icon={Shirt} label="熊熊衣櫃" />
          </div>
          <div className="wd-memory-app">
            <PersonalMemory compact />
          </div>
        </nav>
        {user?.role === "sales" && (
          <section className="wd-card" aria-label="我的業務概況">
            <div className="wd-card-heading">
              <h2>我的業務概況</h2>
            </div>
            {state.status === "loading" && <p className="wd-card-message">載入中…</p>}
            {state.status === "error" && (
              <p className="wd-card-message">
                暫時載入不了
                <button type="button" onClick={retry}>
                  再試一次
                </button>
              </p>
            )}
            {state.status === "ready" && (
              <div className="wd-activity-grid">
                <Stat
                  value={state.me.stats.visits_last_year.toLocaleString("zh-TW")}
                  label="近一年拜訪"
                />
                <Stat value={String(state.me.stats.customers)} label="名下客戶" />
                <Stat value={formatWan(state.me.stats.sales_last_year, 0)} label="近一年業績" />
              </div>
            )}
          </section>
        )}
      </WorkdayHome>
    </main>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
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
    <Link to={to} className="wd-app-link">
      <Icon aria-hidden />
      <span>{label}</span>
      {detail && (
        <span className="wd-app-detail" aria-label={`已解鎖 ${detail} 面獎牌`}>
          {detail}
        </span>
      )}
      <ChevronRight aria-hidden />
    </Link>
  )
}
