import { useEffect, useState } from "react"
import { ChevronRight, Settings } from "@/components/icons"
import { Link, Navigate } from "react-router"

import { getMe, type Me } from "@/api/me"
import { UserAvatar } from "@/components/user-avatar"
import { Mascot } from "@/components/mascot"
import { MedalWall } from "@/components/me/medal-wall"
import { MonthlySales, TopCustomers } from "@/components/me/sales-charts"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { useAuth } from "@/lib/auth"
import { formatWan } from "@/lib/format"

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; me: Me }

/**
 * 個人頁（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈個人頁〉）：從首頁左上角的名字進來（電腦版是側邊欄最上面的名字）。
 * 三格事蹟數字、可以在牆上轉的獎牌、賣最多的藥局與每月業績。只有業務有；代理示範業務的帳號看示範業務的。
 */
export function MePage() {
  const user = useAuth()?.user
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
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title="個人頁"
        backTo="/"
        trailing={
          <Link to="/settings" aria-label="帳號設定" className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
            <Settings className="size-5" />
          </Link>
        }
      />
      <main className="flex flex-1 flex-col gap-4 px-4 pt-3 pb-10">
        {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入個人頁中…</p>}
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
        {state.status === "ready" && user && (
          <>
            <div className="flex items-center gap-3.5">
              <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-accent">
                <UserAvatar id={user.id} name={user.name} size="lg" className="size-16" />
              </span>
              <div className="min-w-0">
                <p className="text-xl font-semibold">{state.me.name}</p>
                <p className="text-sm text-muted-foreground">
                  {state.me.region} · 業務 · 名下 {state.me.stats.customers} 家客戶
                </p>
                {user.acting_as && <p className="text-xs text-muted-foreground">示範業務的個人頁</p>}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Stat value={state.me.stats.visits_last_year.toLocaleString("zh-TW")} label="近一年拜訪" />
              <Stat value={String(state.me.stats.customers)} label="名下客戶" />
              <Stat value={formatWan(state.me.stats.sales_last_year, 0)} label="近一年業績" />
            </div>
            <Link to="/mascots" className="flex min-h-20 items-center gap-3 rounded-2xl border-2 bg-card px-4 py-3 shadow-lip"><Mascot state="hi" size={54} /><span className="min-w-0 flex-1 text-base font-semibold">熊熊衣櫃</span><ChevronRight className="size-4 shrink-0 text-muted-foreground" /></Link>
            <MedalWall medals={state.me.medals} userId={user.id} />
            <section className="rounded-3xl border-2 bg-card p-4 shadow-lip">
              <div className="flex items-baseline justify-between">
                <h2 className="text-base font-semibold">賣最多的藥局</h2>
                <span className="text-sm text-muted-foreground">近一年進貨</span>
              </div>
              <TopCustomers items={state.me.top_customers} />
            </section>
            <section className="rounded-3xl border-2 bg-card p-4 shadow-lip">
              <div className="flex items-baseline justify-between">
                <h2 className="text-base font-semibold">每月業績</h2>
                <span className="text-sm text-muted-foreground">近六個月</span>
              </div>
              <MonthlySales months={state.me.monthly} />
            </section>
          </>
        )}
      </main>
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border-2 bg-card px-2 py-2.5 text-center shadow-lip">
      <p className="text-xl font-semibold">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}
