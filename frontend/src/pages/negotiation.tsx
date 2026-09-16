import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router"

import { ApiError } from "@/api/client"
import { getNegotiationCard, type NegotiationCard } from "@/api/customers"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth"
import { customerNotFoundText } from "@/lib/scope"
import { cn } from "@/lib/utils"

type LoadState =
  | { status: "loading" }
  // missing：後端回 404（沒有這家，或不是登入者看得到的客戶），回客戶檔案也一樣看不到
  | { status: "error"; message: string; missing: boolean }
  | { status: "ready"; card: NegotiationCard }

/** 談判卡（原型 S-04，FR-3）：連鎖客戶才有。對照數據來自交易資料，切入點是內部文件的原文段落 */
export function NegotiationPage() {
  const { customerId = "" } = useParams()
  const navigate = useNavigate()
  const user = useAuth()?.user
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const profilePath = `/customers/${customerId}`

  useEffect(() => {
    const controller = new AbortController()
    getNegotiationCard(customerId, controller.signal)
      .then((card) => setState({ status: "ready", card }))
      .catch((error) => {
        if (controller.signal.aborted) return
        const missing = error instanceof ApiError && error.status === 404
        const message =
          error instanceof ApiError && error.status === 409 ? error.message : "連不上伺服器，談判卡沒有載入。"
        setState({ status: "error", message, missing })
      })
    return () => controller.abort()
  }, [customerId, attempt])

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader title="談判卡" subtitle={state.status === "ready" ? state.card.customer.name : undefined} backTo={profilePath} />
      <main className="flex flex-1 flex-col gap-4 px-4 pt-4 pb-28">
        {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">整理談判資料中…</p>}
        {state.status === "error" && state.missing && (
          <Notice text={customerNotFoundText(user)} action={{ label: "回客戶清單", onClick: () => navigate("/customers") }} />
        )}
        {state.status === "error" && !state.missing && (
          <Notice
            text={state.message}
            action={{
              label: "重新載入",
              onClick: () => {
                setState({ status: "loading" })
                setAttempt((n) => n + 1)
              },
            }}
            secondary={{ label: "回客戶檔案", onClick: () => navigate(profilePath) }}
          />
        )}
        {state.status === "ready" && (
          <>
            <Turnover items={state.card.turnover} />
            {state.card.margin && (
              <section className="rounded-2xl border bg-card p-4">
                <p className="text-sm font-semibold">這家客戶的毛利結構</p>
                <p className="mt-1.5 text-sm leading-relaxed text-foreground/80">{state.card.margin.summary}。</p>
                <p className="mt-1 text-[11px] text-muted-foreground">近 90 天，淨毛利＝毛利－上架費－通路獎勵</p>
              </section>
            )}
            <Tips tips={state.card.tips} />
          </>
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md gap-2 border-t bg-card px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <Button variant="outline" className="h-12 w-28 shrink-0" onClick={() => navigate(profilePath)}>
          客戶檔案
        </Button>
        <Button className="h-12 flex-1" onClick={() => navigate(`/customers/${customerId}/record`)}>
          開始拜訪
        </Button>
      </div>
    </div>
  )
}

/** FR-3.1：我方主要品項近 90 天每月進貨幾次，灰線是同區同類型客戶的平均；低於平均標紅 */
function Turnover({ items }: { items: NegotiationCard["turnover"] }) {
  const scale = Math.max(0.1, ...items.flatMap((item) => [item.orders_per_month, item.region_orders_per_month ?? 0])) * 1.15
  return (
    <section className="rounded-2xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">我方品項每月進貨次數</p>
        <p className="text-[11px] text-muted-foreground">近 90 天 · 灰線是同區平均</p>
      </div>
      {items.length === 0 && <p className="mt-2 text-sm text-muted-foreground">近半年沒有進貨紀錄。</p>}
      <div className="mt-3 flex flex-col gap-2.5">
        {items.map((item) => {
          const region = item.region_orders_per_month
          const below = region !== null && item.orders_per_month < region
          return (
            <div key={item.sku} className="flex items-center gap-2.5">
              <span className="w-24 shrink-0 truncate text-xs">{item.name}</span>
              <span className="relative block h-4 flex-1 overflow-hidden rounded bg-secondary">
                <span
                  className={cn("absolute inset-y-0 left-0 rounded", below ? "bg-destructive" : "bg-primary")}
                  style={{ width: `${(item.orders_per_month / scale) * 100}%` }}
                />
                {region !== null && (
                  <span className="absolute inset-y-0 w-0.5 bg-muted-foreground" style={{ left: `${(region / scale) * 100}%` }} />
                )}
              </span>
              <span className={cn("w-16 shrink-0 text-right text-xs tabular-nums", below ? "text-destructive" : "text-muted-foreground")}>
                {item.orders_per_month.toFixed(1)} / {region === null ? "—" : region.toFixed(1)}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** FR-3.2：依這家客戶的情況，列出內部文件裡相關的規定原文 */
function Tips({ tips }: { tips: NegotiationCard["tips"] }) {
  return (
    <section className="rounded-2xl border border-primary/25 bg-primary/10 p-4">
      <p className="text-xs font-semibold tracking-wide text-primary">內部文件建議的切入點</p>
      {tips.length === 0 && <p className="mt-2 text-sm text-muted-foreground">內部文件裡沒有找到適用的段落。</p>}
      <ol className="mt-3 flex flex-col gap-4">
        {tips.map((tip) => (
          <li key={`${tip.source_name}-${tip.section}`} className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">因為{tip.reason}</span>
            <p className="text-sm font-medium">{tip.section}</p>
            <p className="text-[13px] leading-relaxed text-foreground/80">{tip.content}</p>
            <span className="text-[11px] text-muted-foreground">出處：{tip.doc_title}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
