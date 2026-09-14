import { useEffect, useState } from "react"
import { Handshake, Mic } from "lucide-react"
import { useNavigate, useParams } from "react-router"

import { ApiError } from "@/api/client"
import { CUSTOMER_TYPE_LABEL, getCustomerProfile, type CustomerProfile, type ProfileStats } from "@/api/customers"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; profile: CustomerProfile }
type Tone = "alert" | "warn" | undefined

// 帳齡門檻照《付款條件與帳齡管理》：超過 60 天、90 天各有處理規定
const AR_WARN_DAYS = 60
const AR_ALERT_DAYS = 90

const wan = (amount: number) => (amount / 10000).toFixed(1)

/** 客戶檔案（原型 S-03，FR-2）：交易概況、待處理事項、競品紀錄放在同一頁 */
export function CustomerPage() {
  const { customerId = "" } = useParams()
  const navigate = useNavigate()
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getCustomerProfile(customerId, controller.signal)
      .then((profile) => setState({ status: "ready", profile }))
      .catch((error) => {
        if (controller.signal.aborted) return
        const missing = error instanceof ApiError && error.status === 404
        setState({ status: "error", message: missing ? "找不到這家客戶。" : "連不上伺服器，客戶檔案沒有載入。" })
      })
    return () => controller.abort()
  }, [customerId, attempt])

  if (state.status !== "ready") {
    return (
      <div className="flex min-h-svh flex-col">
        <PageHeader title="客戶檔案" backTo="/" />
        <main className="flex-1 p-4">
          {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入客戶檔案中…</p>}
          {/* 沒訊號時看不到客戶檔案，但照樣可以錄音：錄音先存在手機，恢復連線自動送出（FR-4.3） */}
          {state.status === "error" && !navigator.onLine && (
            <Notice
              text="沒有網路，客戶檔案沒有載入。可以直接錄音，錄音會先存在手機。"
              action={{ label: "直接錄音", onClick: () => navigate(`/customers/${customerId}/record`) }}
              secondary={{ label: "回客戶清單", onClick: () => navigate("/") }}
            />
          )}
          {state.status === "error" && navigator.onLine && (
            <Notice
              text={state.message}
              action={{
                label: "重新載入",
                onClick: () => {
                  setState({ status: "loading" })
                  setAttempt((n) => n + 1)
                },
              }}
              secondary={{ label: "回客戶清單", onClick: () => navigate("/") }}
            />
          )}
        </main>
      </div>
    )
  }

  const { profile } = state
  const { customer, stats } = profile
  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title={customer.name}
        subtitle={`${CUSTOMER_TYPE_LABEL[customer.type]} · ${customer.grade} 級 · ${customer.region}`}
        backTo="/"
      />
      <main className="flex flex-1 flex-col gap-4 px-4 pt-4 pb-28">
        <section className="rounded-2xl border border-primary/20 bg-primary/10 p-4">
          <p className="text-xs font-semibold tracking-wide text-primary">進門前三分鐘</p>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4 text-sm leading-relaxed">
            {profile.highlights.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <section className="grid grid-cols-3 gap-2">
          <StatCard label="近 3 月進貨" value={wan(stats.amount_last_90d)} unit="萬" note={amountNote(stats)} />
          <StatCard
            label="進貨間隔"
            value={stats.interval_last_90d === null ? "—" : Math.round(stats.interval_last_90d)}
            unit="天"
            tone={stats.interval_alert ? "alert" : undefined}
            note={stats.interval_before === null ? undefined : `之前 ${Math.round(stats.interval_before)} 天`}
          />
          <StatCard
            label="帳齡"
            value={stats.ar_max_age_days ?? "—"}
            unit="天"
            tone={arTone(stats.ar_max_age_days)}
            note={`未收 ${wan(stats.ar_outstanding)} 萬`}
          />
        </section>

        <IntervalChart intervals={profile.intervals} alert={stats.interval_alert} />
        <PendingItems profile={profile} />
        <Competitors competitors={profile.competitors} />
      </main>

      <div className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md gap-2 border-t bg-card px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        {customer.type === "chain" && (
          <Button variant="outline" className="h-12 flex-1 gap-1.5" onClick={() => navigate(`/customers/${customer.id}/negotiation`)}>
            <Handshake className="size-4" />
            談判卡
          </Button>
        )}
        <Button className="h-12 flex-1 gap-1.5" onClick={() => navigate(`/customers/${customer.id}/record`)}>
          <Mic className="size-4" />
          語音記錄
        </Button>
      </div>
    </div>
  )
}

function amountNote(stats: ProfileStats) {
  if (!stats.amount_prev_90d) return undefined
  const change = Math.round((stats.amount_last_90d / stats.amount_prev_90d - 1) * 100)
  return `比前 3 月 ${change > 0 ? "+" : ""}${change}%`
}

function arTone(days: number | null): Tone {
  if (days === null) return undefined
  if (days > AR_ALERT_DAYS) return "alert"
  return days > AR_WARN_DAYS ? "warn" : undefined
}

function StatCard({ label, value, unit, note, tone }: { label: string; value: string | number; unit: string; note?: string; tone?: Tone }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", tone === "alert" && "text-destructive", tone === "warn" && "text-warning")}>
        {value}
        <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">{unit}</span>
      </p>
      {note && <p className="text-[11px] leading-snug text-muted-foreground">{note}</p>}
    </div>
  )
}

/** 近六個月每個月的平均進貨間隔；拉長時最後一根標紅（原型的「進貨間隔」長條圖） */
function IntervalChart({ intervals, alert }: { intervals: CustomerProfile["intervals"]; alert: boolean }) {
  const max = Math.max(1, ...intervals.map((item) => item.gap_days ?? 0))
  return (
    <section className="rounded-2xl border bg-card p-4">
      <p className="text-sm font-semibold">每月進貨間隔</p>
      <p className="text-[11px] text-muted-foreground">每次進貨距離上一次幾天，算在進貨的那個月</p>
      <div className="mt-3 flex h-36 items-end gap-2">
        {intervals.map((item, index) => {
          const last = index === intervals.length - 1
          return (
            <div key={item.month} className="flex flex-1 flex-col items-center justify-end gap-1">
              <span className={cn("text-[11px] tabular-nums", last && alert ? "font-semibold text-destructive" : "text-muted-foreground")}>
                {item.gap_days === null ? "—" : Math.round(item.gap_days)}
              </span>
              <div
                className={cn("w-full rounded-md", item.gap_days === null ? "h-1 bg-muted" : last && alert ? "bg-destructive" : "bg-accent")}
                style={item.gap_days === null ? undefined : { height: `${Math.max(6, (item.gap_days / max) * 96)}px` }}
              />
              <span className="text-[11px] text-muted-foreground">{Number(item.month.slice(5))}月</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** FR-2.2：未結案報價、客訴、逾期承諾 */
function PendingItems({ profile }: { profile: CustomerProfile }) {
  const rows = [
    ...profile.commitments.map((item) => ({
      key: `commitment-${item.visit_id}`,
      tone: (item.overdue ? "alert" : "warn") as Tone,
      title: `${item.by === "us" ? "我方答應" : "客戶答應"}：${item.text}`,
      meta: item.due ? `${formatDate(item.due)} ${item.overdue ? "已過期" : "到期"}` : "沒有期限",
    })),
    ...profile.complaints.map((item) => ({
      key: `complaint-${item.visit_id}`,
      tone: "warn" as Tone,
      title: `客訴：${item.text}`,
      meta: formatDate(item.visit_date),
    })),
    ...profile.open_quotes.map((item) => ({
      key: `quote-${item.visit_id}`,
      tone: undefined as Tone,
      title: `報價草稿：${item.items}`,
      meta: `NT$${Math.round(item.amount).toLocaleString("zh-TW")}`,
    })),
  ]
  return (
    <section className="rounded-2xl border bg-card px-4 pb-1">
      <p className="py-3 text-sm font-semibold">待處理事項</p>
      {rows.length === 0 && <p className="pb-3 text-sm text-muted-foreground">沒有待處理的事項。</p>}
      {rows.map((row) => (
        <div key={row.key} className="flex min-h-12 items-center gap-3 border-t py-2">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              row.tone === "alert" ? "bg-destructive" : row.tone === "warn" ? "bg-warning" : "bg-muted-foreground/40"
            )}
          />
          <p className="flex-1 text-sm">{row.title}</p>
          <span className={cn("shrink-0 text-xs", row.tone === "alert" ? "text-destructive" : "text-muted-foreground")}>{row.meta}</span>
        </div>
      ))}
    </section>
  )
}

/** FR-2.3：過去拜訪提到過的競品 */
function Competitors({ competitors }: { competitors: CustomerProfile["competitors"] }) {
  return (
    <section className="rounded-2xl border bg-card px-4 pb-1">
      <p className="py-3 text-sm font-semibold">競品紀錄</p>
      {competitors.length === 0 && <p className="pb-3 text-sm text-muted-foreground">過去的拜訪沒有提到競品。</p>}
      {competitors.map((item) => (
        <div key={item.name} className="flex flex-col gap-0.5 border-t py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium">{item.name}</p>
            <span className="text-xs text-muted-foreground">
              提到 {item.mentions} 次 · 最近 {formatDate(item.last_date)}
            </span>
          </div>
          {item.detail && <p className="text-xs text-muted-foreground">{item.detail}</p>}
        </div>
      ))}
    </section>
  )
}
