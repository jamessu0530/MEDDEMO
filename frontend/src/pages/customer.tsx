import { useEffect, useState } from "react"
import { FileText, Handshake, MessagesSquare, Mic } from "lucide-react"
import { Link, useLocation, useNavigate, useParams } from "react-router"

import { openCustomerThread } from "@/api/channels"
import { ApiError } from "@/api/client"
import {
  CUSTOMER_TYPE_LABEL,
  getContract,
  getCustomerProfile,
  placeOrder,
  type Contract,
  type CustomerProfile,
  type ProfileStats,
} from "@/api/customers"
import { LastOrderSection } from "@/components/last-order-section"
import { NextNotes } from "@/components/next-notes"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { ReassignOwner } from "@/components/reassign-owner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAuth } from "@/lib/auth"
import { formatDate, formatMoney } from "@/lib/format"
import { customerNotFoundText } from "@/lib/scope"
import { useIsDesktop } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"

type LoadState =
  | { status: "loading" }
  // missing：後端回 404（沒有這家，或不是登入者看得到的客戶）
  | { status: "error"; missing: boolean }
  | { status: "ready"; profile: CustomerProfile }

// 別的頁面帶過來的：flash 是開報價、送續約申請之後的提示（pages/quote.tsx、contract.tsx）；backTo 是返回鍵要回哪裡（主管從風險通報、團隊行程點進來）
export type CustomerLocationState = { flash?: string; backTo?: string }
type Tone = "alert" | "warn" | undefined

// 帳齡門檻照《付款條件與帳齡管理》：超過 60 天、90 天各有處理規定
const AR_WARN_DAYS = 60
const AR_ALERT_DAYS = 90

const wan = (amount: number) => (amount / 10000).toFixed(1)

/** 客戶檔案（原型 S-03，FR-2）：交易概況、待處理事項、競品紀錄放在同一頁 */
export function CustomerPage() {
  const { customerId = "" } = useParams()
  const navigate = useNavigate()
  // 電腦版左邊看狀況、右邊做事（docs/superpowers/specs/2026-10-09-desktop-layout-design.md）
  const desktop = useIsDesktop()
  const { flash, backTo = "/" } = (useLocation().state as CustomerLocationState | null) ?? {}
  const user = useAuth()?.user
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [threadError, setThreadError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  // 連鎖客戶的合約條件；記下是哪一家的，換客戶時不會閃一下上一家的合約
  const [contract, setContract] = useState<{ customerId: string; data: Contract } | null>(null)
  // 待處理事項按了「客戶下單了」的那張報價，確認框開著；notice 是成交之後的提示
  const [ordering, setOrdering] = useState<CustomerProfile["open_quotes"][number] | null>(null)
  const [placing, setPlacing] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function confirmOrder() {
    if (!ordering || placing) return
    setPlacing(true)
    setOrderError(null)
    try {
      const placed = await placeOrder(customerId, ordering.quote_no)
      setNotice(`報價 ${ordering.quote_no} 成交了，已寫進今天的進貨 ${formatMoney(placed.amount)}`)
      setOrdering(null)
      // 進貨數字、待處理事項、上次訂的都跟著變：整頁重新載入
      setAttempt((n) => n + 1)
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : "沒有寫成，請再試一次")
    } finally {
      setPlacing(false)
    }
  }

  async function openThread() {
    // 雙擊按鈕不要開兩次討論串、多推兩筆瀏覽紀錄
    if (opening) return
    setOpening(true)
    setThreadError(null)
    try {
      const thread = await openCustomerThread(customerId)
      navigate(`/channels/${thread.id}`, { state: { backTo: `/customers/${customerId}` } })
    } catch {
      setThreadError("討論串沒有打開，請再試一次")
    } finally {
      setOpening(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    getCustomerProfile(customerId, controller.signal)
      .then((profile) => setState({ status: "ready", profile }))
      .catch((error) => {
        if (controller.signal.aborted) return
        setState({ status: "error", missing: error instanceof ApiError && error.status === 404 })
      })
    return () => controller.abort()
  }, [customerId, attempt])

  // 合約那一列只有連鎖客戶有。另外問一次，問不到就不顯示：不擋客戶檔案的其他內容
  const isChain = state.status === "ready" && state.profile.customer.type === "chain"
  useEffect(() => {
    if (!isChain) return
    const controller = new AbortController()
    getContract(customerId, controller.signal)
      .then((data) => setContract({ customerId, data }))
      .catch(() => {
        // 連不上就少這一列，續約照樣可以從 OA 送
      })
    return () => controller.abort()
  }, [customerId, isChain, attempt])

  if (state.status !== "ready") {
    return (
      <div className="flex min-h-svh flex-col">
        <PageHeader title="客戶檔案" backTo={backTo} />
        <main className="flex-1 p-4">
          {state.status === "loading" && <p className="py-10 text-center text-sm text-muted-foreground">載入客戶檔案中…</p>}
          {/* 404：沒有這家，或不是登入者看得到的客戶。重新載入也一樣，只給回客戶清單的路 */}
          {state.status === "error" && state.missing && (
            <Notice text={customerNotFoundText(user)} action={{ label: "回客戶清單", onClick: () => navigate("/customers") }} />
          )}
          {/* 沒訊號時看不到客戶檔案，但照樣可以錄音：錄音先存在手機，恢復連線自動送出（FR-4.3） */}
          {state.status === "error" && !state.missing && !navigator.onLine && (
            <Notice
              text="沒有網路，客戶檔案沒有載入。可以直接錄音，錄音會先存在手機。"
              action={{ label: "直接錄音", onClick: () => navigate(`/customers/${customerId}/record`) }}
              secondary={{ label: "回客戶清單", onClick: () => navigate("/customers") }}
            />
          )}
          {state.status === "error" && !state.missing && navigator.onLine && (
            <Notice
              text="連不上伺服器，客戶檔案沒有載入。"
              action={{
                label: "重新載入",
                onClick: () => {
                  setState({ status: "loading" })
                  setAttempt((n) => n + 1)
                },
              }}
              secondary={{ label: "回客戶清單", onClick: () => navigate("/customers") }}
            />
          )}
        </main>
      </div>
    )
  }

  const { profile } = state
  const { customer, stats } = profile
  const toRecord = () => navigate(`/customers/${customer.id}/record`)
  const toQuote = () => navigate(`/customers/${customer.id}/quote`)
  const toNegotiation = () => navigate(`/customers/${customer.id}/negotiation`)

  const alerts = (
    <>
      {flash && <p className="rounded-xl bg-primary/10 px-3 py-2 text-sm text-primary">{flash}</p>}
      {notice && <p className="rounded-xl bg-primary/10 px-3 py-2 text-sm text-primary">{notice}</p>}
      {threadError && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{threadError}</p>}
      {/* IT 可以把這家交給別的業務；換完重新載入，負責人就是新的那位 */}
      {user?.role === "it" && <ReassignOwner customer={customer} onDone={() => setAttempt((n) => n + 1)} />}
    </>
  )
  const brief = (
    <section className="rounded-2xl border-2 border-primary/20 bg-primary/10 p-4 shadow-lip-primary-soft">
      <p className="text-xs font-semibold tracking-wide text-primary">進門前三分鐘</p>
      <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4 text-sm leading-relaxed">
        {profile.highlights.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  )
  const nextNotes = <NextNotes customerId={customer.id} customerName={customer.name} today={profile.today} />
  // 跟著整頁重新載入：成交之後「上次」就是剛成交的那張
  const lastOrderSection = <LastOrderSection key={attempt} customerId={customer.id} />
  const numbers = (
    <>
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
    </>
  )
  const contractRow = contract?.customerId === customer.id && <ContractRow customerId={customer.id} contract={contract.data} />
  const pendingItems = (
    <PendingItems
      profile={profile}
      onOrder={(quote) => {
        setOrderError(null)
        setOrdering(quote)
      }}
    />
  )
  const competitorList = <Competitors competitors={profile.competitors} />

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader
        title={customer.name}
        subtitle={`${CUSTOMER_TYPE_LABEL[customer.type]} · ${customer.grade} 級 · ${customer.region}`}
        backTo={backTo}
        trailing={
          <button
            type="button"
            aria-label="討論串"
            disabled={opening}
            onClick={() => void openThread()}
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <MessagesSquare className="size-5" />
          </button>
        }
      />
      {desktop ? (
        <main className="flex flex-1 items-start gap-6 px-6 pt-4 pb-10">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {alerts}
            {brief}
            {numbers}
            {pendingItems}
            {competitorList}
          </div>
          {/* 要動手的放右邊，捲動時固定在頁首下面；太高時自己捲 */}
          <aside className="sticky top-[4.5rem] flex max-h-[calc(100svh-5.5rem)] w-80 shrink-0 flex-col gap-4 overflow-y-auto px-1 pb-2">
            <div className="flex flex-col gap-2">
              <Button className="h-12 gap-1.5" onClick={toRecord}>
                <Mic className="size-4" />
                語音記錄
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" className="h-12 flex-1 gap-1.5" onClick={toQuote}>
                  <FileText className="size-4" />
                  開報價
                </Button>
                <Button variant="outline" className="h-12 flex-1 gap-1.5" onClick={toNegotiation}>
                  <Handshake className="size-4" />
                  談判卡
                </Button>
              </div>
            </div>
            {nextNotes}
            {lastOrderSection}
            {contractRow}
          </aside>
        </main>
      ) : (
        <main className="flex flex-1 flex-col gap-4 px-4 pt-4 pb-28">
          {alerts}
          {brief}
          {nextNotes}
          {lastOrderSection}
          {numbers}
          {contractRow}
          {pendingItems}
          {competitorList}
        </main>
      )}

      <Dialog open={ordering !== null} onOpenChange={(open) => !open && !placing && setOrdering(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>把這張報價寫成今天的進貨？</DialogTitle>
            <DialogDescription>
              {ordering && `${ordering.quote_no}，${formatMoney(ordering.amount)}。`}會寫進交易紀錄與應收帳款，不能復原。
            </DialogDescription>
          </DialogHeader>
          {orderError && <p className="text-sm text-destructive">{orderError}</p>}
          <DialogFooter>
            <Button variant="outline" className="h-11" disabled={placing} onClick={() => setOrdering(null)}>
              不要
            </Button>
            <Button className="h-11" disabled={placing} onClick={confirmOrder}>
              {placing ? "寫入中…" : "客戶下單了"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!desktop && (
        <div className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md gap-2 border-t bg-card px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          {/* 每種客戶都有談判卡：連鎖是顧客導向，獨立藥局與診所是成本導向 */}
          <Button variant="outline" className="h-12 flex-1 gap-1.5" onClick={toNegotiation}>
            <Handshake className="size-4" />
            談判卡
          </Button>
          {/* 原型放在「語音記錄」旁邊：不必等拜訪口述，直接挑常進的品項開 SAP 報價草稿 */}
          <Button variant="outline" className="h-12 flex-1 gap-1.5" onClick={toQuote}>
            <FileText className="size-4" />
            開報價
          </Button>
          <Button className="h-12 flex-1 gap-1.5" onClick={toRecord}>
            <Mic className="size-4" />
            語音記錄
          </Button>
        </div>
      )}
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
    <div className="flex flex-col gap-1 rounded-xl border-2 bg-card p-3 shadow-lip">
      <p className="text-[0.6875rem] text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", tone === "alert" && "text-destructive", tone === "warn" && "text-warning")}>
        {value}
        <span className="ml-0.5 text-[0.6875rem] font-normal text-muted-foreground">{unit}</span>
      </p>
      {note && <p className="text-[0.6875rem] leading-snug text-muted-foreground">{note}</p>}
    </div>
  )
}

/** 近六個月每個月的平均進貨間隔；拉長時最後一根標紅（原型的「進貨間隔」長條圖） */
function IntervalChart({ intervals, alert }: { intervals: CustomerProfile["intervals"]; alert: boolean }) {
  const max = Math.max(1, ...intervals.map((item) => item.gap_days ?? 0))
  return (
    <section className="rounded-2xl border-2 bg-card p-4 shadow-lip">
      <p className="text-sm font-semibold">每月進貨間隔</p>
      <p className="text-[0.6875rem] text-muted-foreground">每次進貨距離上一次幾天，算在進貨的那個月</p>
      <div className="mt-3 flex h-36 items-end gap-2">
        {intervals.map((item, index) => {
          const last = index === intervals.length - 1
          return (
            <div key={item.month} className="flex flex-1 flex-col items-center justify-end gap-1">
              <span className={cn("text-[0.6875rem] tabular-nums", last && alert ? "font-semibold text-destructive" : "text-muted-foreground")}>
                {item.gap_days === null ? "—" : Math.round(item.gap_days)}
              </span>
              <div
                className={cn("w-full rounded-md", item.gap_days === null ? "h-1 bg-muted" : last && alert ? "bg-destructive" : "bg-accent")}
                style={item.gap_days === null ? undefined : { height: `${Math.max(6, (item.gap_days / max) * 96)}px` }}
              />
              <span className="text-[0.6875rem] text-muted-foreground">{Number(item.month.slice(5))}月</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/**
 * 連鎖客戶的合約到期日；3 個月內到期時標出來，這時才有「申請續約」
 * （《連鎖通路合約條件》：到期前 3 個月啟動續約協商，離到期還久的合約後端不收續約申請）
 */
function ContractRow({ customerId, contract }: { customerId: string; contract: Contract }) {
  if (!contract.contract_end_date) return null
  const left = contract.days_left ?? 0
  return (
    <section
      className={cn("flex items-center gap-3 rounded-2xl border-2 bg-card px-4 py-3 shadow-lip", contract.ending_soon && "border-warning/60")}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          合約 {contract.contract_end_date.replaceAll("-", "/")} 到期
          {contract.ending_soon && (
            <Badge variant="outline" className="ml-2 border-warning/60 text-warning">
              {left >= 0 ? `剩 ${left} 天` : "已過期"}
            </Badge>
          )}
        </p>
        <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
          {contract.pending_form_id
            ? "續約申請簽核中"
            : contract.ending_soon
              ? "3 個月內到期，該開始談續約"
              : `還有 ${left} 天，到期前 3 個月才能申請續約`}
        </p>
      </div>
      {contract.pending_form_id ? (
        <Button asChild variant="outline" className="h-11 shrink-0">
          <Link to={`/oa/forms/${contract.pending_form_id}`}>看申請單</Link>
        </Button>
      ) : (
        contract.can_request && (
          <Button asChild variant="outline" className="h-11 shrink-0">
            <Link to={`/customers/${customerId}/contract`}>申請續約</Link>
          </Button>
        )
      )}
    </section>
  )
}

/** FR-2.2：未結案報價、客訴、逾期承諾 */
type OpenQuote = CustomerProfile["open_quotes"][number]

function PendingItems({ profile, onOrder }: { profile: CustomerProfile; onOrder: (quote: OpenQuote) => void }) {
  const rows: { key: string; tone: Tone; title: string; meta: string; tag?: string; quote?: OpenQuote }[] = [
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
    // 直接開的報價沒有 visit_id，用報價單號分辨。折扣還在等簽核的標出來：核准之前不能送給客戶，也不能成交
    ...profile.open_quotes.map((item) => ({
      key: `quote-${item.quote_no}`,
      tone: undefined as Tone,
      title: `報價草稿 ${item.quote_no}：${item.items}`,
      meta: formatMoney(item.amount),
      tag: item.status === "pending_approval" ? "待簽核" : undefined,
      quote: item,
    })),
  ]
  return (
    <section className="rounded-2xl border-2 bg-card px-4 pb-1 shadow-lip">
      <p className="py-3 text-sm font-semibold">待處理事項</p>
      {rows.length === 0 && <p className="pb-3 text-sm text-muted-foreground">沒有待處理的事項。</p>}
      {rows.map((row) => (
        <div key={row.key} className="flex flex-col gap-1 border-t py-2">
          <div className="flex min-h-8 items-center gap-3">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                row.tone === "alert" ? "bg-destructive" : row.tone === "warn" ? "bg-warning" : "bg-muted-foreground/40"
              )}
            />
            <p className="flex-1 text-sm">
              {row.title}
              {row.tag && (
                <Badge variant="outline" className="ml-2 align-middle">
                  {row.tag}
                </Badge>
              )}
            </p>
            <span className={cn("shrink-0 text-xs", row.tone === "alert" ? "text-destructive" : "text-muted-foreground")}>{row.meta}</span>
          </div>
          {row.quote && (
            <div className="ml-5 flex items-center gap-3">
              <Button
                variant="outline"
                className="h-11 shrink-0"
                disabled={row.quote.status !== "draft"}
                onClick={() => onOrder(row.quote!)}
              >
                客戶下單了
              </Button>
              {row.quote.status === "pending_approval" && <p className="text-xs text-muted-foreground">核准後才能成交</p>}
            </div>
          )}
        </div>
      ))}
    </section>
  )
}

/** FR-2.3：過去拜訪提到過的競品 */
function Competitors({ competitors }: { competitors: CustomerProfile["competitors"] }) {
  return (
    <section className="rounded-2xl border-2 bg-card px-4 pb-1 shadow-lip">
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
