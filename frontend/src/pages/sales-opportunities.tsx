import { useEffect, useState, type ReactNode } from "react"
import { Link } from "react-router"
import {
  CalendarDays,
  ChevronRight,
  RotateCw,
  Target,
  TrendingDown,
  Users,
} from "@/components/icons"

import {
  getSalesOpportunities,
  type SalesOpportunities,
  type SalesOpportunity,
} from "@/api/sales-opportunities"
import { useAskPageContext } from "@/ask/use-page-context"
import { Notice } from "@/components/notice"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SearchField } from "@/components/ui/search-field"
import { SearchSelect } from "@/components/ui/search-select"
import { useAuth } from "@/lib/auth"
import { formatDate, formatMoney, formatWan } from "@/lib/format"
import {
  filterOpportunities,
  type OpportunityFilter,
  type OpportunitySort,
} from "@/lib/sales-opportunities"
import { cn } from "@/lib/utils"

const TYPES: Record<string, string> = {
  chain: "連鎖藥局",
  independent: "獨立藥局",
  clinic: "診所",
  outlet: "通路",
}
const FILTERS = [
  { value: "all", label: "全部機會" },
  { value: "high", label: "優先跟進" },
  { value: "declining", label: "訂貨減少" },
  { value: "key", label: "大客戶" },
] as const

export function SalesOpportunitiesPanel({
  heading,
  navigation,
  active,
}: {
  heading: ReactNode
  navigation: ReactNode
  active: boolean
}) {
  const user = useAuth()?.user
  const [data, setData] = useState<SalesOpportunities | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<OpportunityFilter>("all")
  const [sort, setSort] = useState<OpportunitySort>("priority")
  const items = filterOpportunities(data?.items ?? [], query, filter, sort)

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    getSalesOpportunities(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result)
          setError("")
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : "潛在銷售暫時載入不了")
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false)
      })
    return () => controller.abort()
  }, [active, attempt, user?.id, user?.acting_as?.id])

  useAskPageContext(
    {
      title: "潛在銷售",
      facts: [
        "只看目前登入業務負責的客戶；大客戶依客戶主檔 A 級判斷。",
        "訂貨減少：本月累計金額或交易數量低於上月整月。差額與平均每單金額為歷史比較，並非成交預測。",
        `篩選：${FILTERS.find((item) => item.value === filter)?.label}；搜尋：${query.trim() || "無"}`,
        ...(data
          ? [
              `資料截至系統日 ${data.as_of}；上月 ${data.previous_start} 至 ${data.previous_end}。`,
              `名下 ${data.summary.owned_customers} 家，機會 ${data.summary.opportunity_customers} 家，優先跟進 ${data.summary.high_priority} 家。`,
            ]
          : []),
      ],
    },
    active
  )

  const refresh = () => {
    setBusy(true)
    setError("")
    setAttempt((value) => value + 1)
  }
  const counts = data
    ? {
        all: data.summary.opportunity_customers,
        high: data.summary.high_priority,
        declining: data.summary.declining_customers,
        key: data.summary.key_accounts,
      }
    : null

  return (
    <div className="min-h-svh pb-24 lg:pb-8">
      <header className="border-b bg-card px-4 py-5 lg:px-6">
        {heading}
        {navigation}
      </header>
      <main className="mx-auto max-w-5xl space-y-5 p-4 lg:p-6" aria-busy={busy}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-primary">
              <Target className="size-4" /> 月底衝刺
            </p>
            <h2 className="text-2xl font-semibold">潛在銷售</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              找出值得再聯繫的熟客，把握月底補單機會。
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label="重新整理潛在銷售"
            disabled={busy}
            onClick={refresh}
          >
            <RotateCw className={cn("size-4", busy && "animate-spin")} />
          </Button>
        </div>

        {error ? (
          <Notice
            text={error}
            action={{ label: "重新載入", onClick: refresh }}
          />
        ) : !data ? (
          <p
            role="status"
            className="py-12 text-center text-sm text-muted-foreground"
          >
            正在整理你的客戶機會…
          </p>
        ) : (
          <>
            <section
              className="rounded-2xl border-2 bg-card p-4 shadow-lip sm:p-5"
              aria-label="本月機會概況"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 text-sm">
                <span className="font-semibold">
                  {Number(data.month_start.slice(0, 4))} 年{" "}
                  {Number(data.month_start.slice(5, 7))} 月 · {data.owner_name}
                  的客戶
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarDays className="size-3.5" />
                  {data.days_remaining === 0
                    ? "今天是月底"
                    : `距月底 ${data.days_remaining} 天`}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 py-4">
                <Stat
                  label="值得跟進"
                  value={String(data.summary.opportunity_customers)}
                  unit="家"
                />
                <Stat
                  label="優先跟進"
                  value={String(data.summary.high_priority)}
                  unit="家"
                  primary
                />
                <Stat
                  label="補回上月差額"
                  value={formatWan(data.summary.gap_amount)}
                />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                名下 {data.summary.owned_customers} 家客戶 · 本月累計至{" "}
                {formatDate(data.as_of)}，比較上月{" "}
                {formatDate(data.previous_start)}–
                {formatDate(data.previous_end)} 整月。
                {busy && <span role="status"> 更新中…</span>}
              </p>
            </section>

            <div className="space-y-3">
              <div
                className="flex gap-2 overflow-x-auto pb-1"
                role="group"
                aria-label="銷售機會篩選"
              >
                {FILTERS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                    className={cn(
                      "flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                      filter === value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-card text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {label}
                    <span className="text-xs opacity-75">
                      {counts?.[value]}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <SearchField
                  aria-label="搜尋潛在銷售客戶"
                  placeholder="搜尋客戶、地區或編號"
                  value={query}
                  onValueChange={setQuery}
                  containerClassName="min-w-48 flex-1"
                />
                <SearchSelect
                  label="機會排序"
                  className="w-full sm:w-48"
                  value={sort}
                  options={[
                    { value: "priority", label: "建議跟進順序" },
                    { value: "gap", label: "補單差額由高到低" },
                    { value: "previous", label: "上月金額由高到低" },
                  ]}
                  onValueChange={(value) => setSort(value as OpportunitySort)}
                />
              </div>
            </div>

            <div
              className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
              aria-live="polite"
            >
              <span>共 {items.length} 家符合條件</span>
              <span>兩項皆符合，優先跟進</span>
            </div>
            {items.length === 0 ? (
              <Notice
                text={
                  data.items.length === 0
                    ? "目前沒有訂貨減少或 A 級大客戶的跟進機會。"
                    : "沒有符合篩選的客戶，試試其他條件。"
                }
                action={
                  data.items.length
                    ? {
                        label: "清除篩選",
                        onClick: () => {
                          setFilter("all")
                          setQuery("")
                        },
                      }
                    : undefined
                }
              />
            ) : (
              <div className="grid items-start gap-4 md:grid-cols-2">
                {items.map((item) => (
                  <OpportunityCard key={item.customer_id} item={item} />
                ))}
              </div>
            )}

            <details className="rounded-xl border bg-card px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">
                如何找出這些機會？
              </summary>
              <ul className="mt-3 list-disc space-y-1.5 pl-4">
                <li>
                  訂貨減少：本月累計金額或數量少於上月整月；月初也會出現落差，不代表客戶流失。
                </li>
                <li>
                  大客戶：依目前客戶主檔的 A
                  級判斷；即使本月已達上月金額，仍可跟進加單。
                </li>
                <li>
                  兩項皆符合的先排，其餘依「補單差額」或「上月平均每單」較大者排序。
                </li>
                <li>
                  只計已入帳交易，草稿不計。多品項共用一個單號算一單；數量為各品項交易數量加總，未換算包裝單位。
                </li>
                <li>
                  補單差額為各客戶少於上月的金額加總，平均每單為上月金額除以訂單數，皆為跟進參考，並非保證可成交的業績。
                </li>
              </ul>
            </details>
          </>
        )}
      </main>
    </div>
  )
}

function Stat({
  label,
  value,
  unit,
  primary,
}: {
  label: string
  value: string
  unit?: string
  primary?: boolean
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1.5 text-xl font-semibold tabular-nums sm:text-2xl",
          primary && "text-primary"
        )}
      >
        {value}
        <span className="ml-1 text-xs font-normal text-muted-foreground">
          {unit}
        </span>
      </p>
    </div>
  )
}

function OpportunityCard({ item }: { item: SalesOpportunity }) {
  const progress =
    item.previous_amount > 0
      ? Math.min(100, (item.current_amount / item.previous_amount) * 100)
      : null
  const customerPath = `/customers/${encodeURIComponent(item.customer_id)}`
  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border-2 bg-card shadow-lip",
        item.priority === "high" && "border-primary/40"
      )}
    >
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {item.priority === "high" && <Badge>優先跟進</Badge>}
          {item.is_declining && (
            <Badge variant="secondary">
              <TrendingDown />
              訂貨減少
            </Badge>
          )}
          {item.is_key_account && (
            <Badge variant="outline">
              <Users />
              大客戶 · A 級
            </Badge>
          )}
          {item.current_orders === 0 && (
            <Badge variant="outline" className="text-muted-foreground">
              本月尚未進貨
            </Badge>
          )}
        </div>
        <div>
          <Link
            to={customerPath}
            className="group flex items-start justify-between gap-2 text-lg font-semibold hover:text-primary"
          >
            <span>{item.name}</span>
            <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
          </Link>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.city} {item.area} · {TYPES[item.type] ?? item.type} ·{" "}
            {item.customer_id}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-3 rounded-xl bg-muted/50 p-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">上月整月</dt>
            <dd className="mt-1 font-semibold tabular-nums">
              {formatMoney(item.previous_amount)}
            </dd>
            <dd className="mt-1 text-xs text-muted-foreground">
              數量 {item.previous_qty.toLocaleString()} · {item.previous_orders}{" "}
              單
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">本月累計</dt>
            <dd className="mt-1 font-semibold tabular-nums">
              {formatMoney(item.current_amount)}
            </dd>
            <dd className="mt-1 text-xs text-muted-foreground">
              數量 {item.current_qty.toLocaleString()} · {item.current_orders}{" "}
              單
            </dd>
          </div>
        </dl>
        <div className="space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="text-muted-foreground">
              {item.amount_declined
                ? "補回上月還差"
                : item.previous_amount > 0
                  ? "本月金額已達上月"
                  : "上月無進貨金額"}
            </span>
            {item.amount_declined && (
              <span className="font-semibold text-primary">
                {formatMoney(item.gap_amount)}{" "}
                <span className="font-normal">
                  （少 {item.decline_percent?.toFixed(1)}%）
                </span>
              </span>
            )}
          </div>
          {progress !== null && (
            <div
              role="img"
              aria-label={`本月金額達上月的 ${((item.current_amount / item.previous_amount) * 100).toFixed(1)}%`}
              className="h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary/65"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
          {item.quantity_declined && (
            <p className="text-muted-foreground">
              訂貨數量比上月少{" "}
              {(item.previous_qty - item.current_qty).toLocaleString()}
            </p>
          )}
          {item.is_key_account && (
            <p className="text-muted-foreground">
              上月平均每單：
              <span className="font-medium text-foreground">
                {item.previous_average_order === null
                  ? "尚無上月訂單可參考"
                  : formatMoney(item.previous_average_order)}
              </span>
            </p>
          )}
        </div>
        <p className="rounded-xl bg-primary/7 p-3 text-sm leading-relaxed">
          {item.priority === "high"
            ? "大客戶本月訂貨減少，優先確認月底補貨需求。"
            : item.is_declining
              ? "從上月常訂品項切入，確認是否需要補貨。"
              : "大客戶仍有加單機會，可洽談月底補貨需求。"}
        </p>
        <p className="text-xs text-muted-foreground">
          最近進貨：{item.last_order_date ?? "尚無交易紀錄"}
        </p>
      </div>
      <div className="flex gap-2 border-t px-4 py-3 sm:px-5">
        <Button variant="outline" asChild className="flex-1">
          <Link to={customerPath}>客戶資料</Link>
        </Button>
        <Button asChild className="flex-1">
          <Link
            to={`/orders/new?customer_id=${encodeURIComponent(item.customer_id)}`}
          >
            開訂單
            <ChevronRight className="size-4" />
          </Link>
        </Button>
      </div>
    </article>
  )
}
