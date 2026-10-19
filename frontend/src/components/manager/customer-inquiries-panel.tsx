import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { MapPin, MessageCircleQuestion, RefreshCw, Search } from "@/components/icons"

import {
  getCustomerInquiries,
  type CustomerInquiry,
  type TeamInquiries,
} from "@/api/customer-inquiries"
import { ApiError } from "@/api/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Notice } from "@/components/notice"
import { InquiryMapSlot } from "@/components/manager/inquiry-map-slot"
import { ResizableMapLayout } from "@/components/manager/resizable-map-layout"
import { useIsDesktop } from "@/lib/use-media-query"
import { inquiryPlaceLabel } from "@/lib/inquiry-map"
import { cn } from "@/lib/utils"
import { formatTaipeiDateTime } from "@/lib/format"

const PAGE_SIZE = 50
const STATUS = {
  queued: "AI 等待處理",
  running: "AI 回答中",
  answered: "AI 已回答",
  no_evidence: "AI 查無依據",
  not_converged: "AI 尚未釐清",
  failed: "AI 查詢失敗",
} as const
const NEEDS_HELP = new Set(["no_evidence", "not_converged", "failed"])
type Load = { key: string } & (
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: TeamInquiries }
)

export function CustomerInquiriesPanel() {
  const [params, setParams] = useSearchParams()
  const days = params.get("days") === "30" ? "30" : "7"
  const rep = params.get("rep") ?? ""
  const help = params.get("help") === "1"
  const search = params.get("q") ?? ""
  const parsedOffset = Number(params.get("offset") ?? 0)
  const offset =
    Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0
  const query = new URLSearchParams({
    days,
    limit: String(PAGE_SIZE),
    offset: String(offset),
  })
  if (rep) query.set("rep", rep)
  if (help) query.set("needs_help", "true")
  if (search.trim()) query.set("q", search.trim())
  const key = query.toString()
  const [load, setLoad] = useState<Load>({ key, status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [refreshError, setRefreshError] = useState(false)
  const [people, setPeople] = useState<TeamInquiries["reps"]>([])
  useEffect(() => {
    const controller = new AbortController()
    let request: AbortController | undefined
    const reload = () => {
      request?.abort()
      request = new AbortController()
      const activeRequest = request
      void getCustomerInquiries(new URLSearchParams(key), activeRequest.signal)
        .then((data) => {
          if (controller.signal.aborted || activeRequest.signal.aborted) return
          setLoad({ key, status: "ready", data })
          setPeople(data.reps)
          setRefreshError(false)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || activeRequest.signal.aborted) return
          setRefreshError(true)
          setLoad((current) =>
            current.key === key &&
            current.status === "ready" &&
            !(error instanceof ApiError && error.status < 500)
              ? current
              : {
                  key,
                  status: "error",
                  message:
                    error instanceof ApiError
                      ? error.message
                      : "提問地圖暫時無法載入。",
                }
          )
        })
    }
    const debounce = setTimeout(reload, 250)
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") reload()
    }, 60_000)
    return () => {
      controller.abort()
      request?.abort()
      clearTimeout(debounce)
      clearInterval(timer)
    }
  }, [key, attempt])
  function filter(name: string, value: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete("offset")
        next.delete("mode")
        next.delete("view")
        if (value) next.set(name, value)
        else next.delete(name)
        return next
      },
      { replace: true }
    )
  }
  const state = load.key === key ? load : { status: "loading" as const }
  return (
    <div className="mx-auto flex w-full max-w-full flex-col gap-4">
      <section className="flex items-start gap-3 rounded-2xl border-2 bg-card p-4 shadow-lip">
        <MessageCircleQuestion className="mt-0.5 size-6 shrink-0 text-primary" />
        <div className="min-w-0">
          <h2 className="font-semibold">提問地圖</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            點選地點，查看業務當時提出的問題與時間。
          </p>
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
          <Input
            aria-label="搜尋客戶、業務或問題"
            placeholder="搜尋客戶、業務或問題"
            value={search}
            maxLength={100}
            onChange={(event) => filter("q", event.target.value)}
            className="h-11 pl-9"
          />
        </label>
        <select
          aria-label="提問期間"
          value={days}
          onChange={(event) => filter("days", event.target.value)}
          className="h-11 rounded-lg border bg-background px-3 text-sm"
        >
          <option value="7">最近 7 天</option>
          <option value="30">最近 30 天</option>
        </select>
        <select
          aria-label="篩選業務"
          value={rep}
          onChange={(event) => filter("rep", event.target.value)}
          className="h-11 max-w-full rounded-lg border bg-background px-3 text-sm"
        >
          <option value="">全部業務</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="icon"
          className="size-11"
          aria-label="重新整理提問地圖"
          onClick={() => setAttempt((value) => value + 1)}
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={help}
          onChange={(event) => filter("help", event.target.checked ? "1" : "")}
          className="size-4 accent-primary"
        />
        只看 AI 尚未解決的提問
      </label>
      {state.status === "loading" && (
        <p
          role="status"
          className="py-10 text-center text-sm text-muted-foreground"
        >
          載入提問地圖中…
        </p>
      )}
      {state.status === "error" && (
        <Notice
          text={state.message}
          action={{
            label: "重新載入",
            onClick: () => setAttempt((value) => value + 1),
          }}
          secondary={
            rep
              ? { label: "查看全部業務", onClick: () => filter("rep", "") }
              : undefined
          }
        />
      )}
      {state.status === "ready" && (
        <>
          <p className="text-sm text-muted-foreground">
            {state.data.scope} · 最近 {days} 天 · 共 {state.data.total}{" "}
            則提問
          </p>
          {refreshError && (
            <p role="status" className="text-sm text-destructive">
              更新暫時失敗，目前顯示上次載入的提問。請重新整理。
            </p>
          )}
          {state.data.items.length === 0 && <InquiryMapSlot items={[]} selectedId={null} onSelect={() => {}} className="h-64" />}
          {state.data.items.length === 0 ? (
            <div className="rounded-2xl border border-dashed px-5 py-12 text-center">
              <p className="font-medium">
                {search || rep || help
                  ? "沒有符合條件的提問"
                  : "最近還沒有提問"}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                業務提問時取得的地點，會保留在提問地圖。
              </p>
            </div>
          ) : (
            <InquiryResults key={key} data={state.data} backTo={`/manager?${params}`} />
          )}
          {(offset > 0 || offset + PAGE_SIZE < state.data.total) && (
            <nav
              aria-label="提問分頁"
              className="flex items-center justify-between gap-2"
            >
              <Button
                variant="outline"
                disabled={offset === 0}
                onClick={() =>
                  filter("offset", String(Math.max(0, offset - PAGE_SIZE)))
                }
              >
                上一頁
              </Button>
              <span className="text-xs text-muted-foreground">
                第 {offset + 1}–{Math.min(offset + PAGE_SIZE, state.data.total)}{" "}
                則
              </span>
              <Button
                variant="outline"
                disabled={offset + PAGE_SIZE >= state.data.total}
                onClick={() => filter("offset", String(offset + PAGE_SIZE))}
              >
                下一頁
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  )
}

export function CustomerInquiryCard({
  inquiry,
  backTo,
  onLocate,
  selected = false,
}: {
  inquiry: CustomerInquiry
  backTo: string
  onLocate?: () => void
  selected?: boolean
}) {
  return (
    <article className={cn("flex min-w-0 flex-col gap-3 rounded-2xl border-2 bg-card p-4 shadow-lip", selected && "border-primary")}>
      {inquiry.location ? (
        <button type="button" disabled={!onLocate} onClick={onLocate} className="flex min-h-9 items-center gap-1.5 text-left text-sm font-medium text-primary disabled:text-foreground">
          <MapPin className="size-4 shrink-0" />
          <span className="min-w-0 break-words">{inquiryPlaceLabel(inquiry.location)}</span>
          {onLocate && <span className="ml-auto shrink-0 text-xs">在地圖查看</span>}
        </button>
      ) : <p className="text-xs text-muted-foreground">未取得提問定位</p>}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {inquiry.customers.map((customer) => (
            <Link
              key={customer.id}
              to={`/customers/${encodeURIComponent(customer.id)}`}
              state={{ backTo }}
              className="font-semibold break-words text-primary hover:underline"
            >
              {customer.name}
            </Link>
          ))}
        </div>
        <Badge
          variant={NEEDS_HELP.has(inquiry.status) ? "outline" : "secondary"}
        >
          {STATUS[inquiry.status]}
        </Badge>
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
        {inquiry.question}
      </p>
      <p className="mt-auto flex flex-wrap justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
        <span>{inquiry.rep.name} · 向 AI 提問</span>
        <time dateTime={inquiry.created_at}>
          {formatTaipeiDateTime(inquiry.created_at)}
        </time>
      </p>
    </article>
  )
}


function InquiryResults({ data, backTo }: { data: TeamInquiries; backTo: string }) {
  const desktop = useIsDesktop()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = [...data.map_items, ...data.items].find((item) => item.id === selectedId)
  const mapItems = selected?.location && !data.map_items.some((item) => item.id === selected.id)
    ? [selected, ...data.map_items] : data.map_items
  const items = selected && !data.items.some((item) => item.id === selected.id) ? [selected, ...data.items] : data.items
  const map = <div className="flex min-w-0 flex-col gap-2">
    <InquiryMapSlot items={mapItems} selectedId={selectedId} onSelect={setSelectedId}
      className={desktop ? "h-[var(--manager-map-height,32rem)]" : "h-80"} />
    <p className="text-xs leading-relaxed text-muted-foreground">
      {data.mapped_total} 則有提問地點 · {data.unlocated_count} 則未取得定位
      {data.map_items.length < data.mapped_total && ` · 地圖先顯示最近 ${data.map_items.length} 則，可縮小篩選範圍`}
    </p>
  </div>
  const list = <div className="flex min-w-0 flex-col gap-3" aria-label="提問清單">
    {items.map((inquiry) => <CustomerInquiryCard key={inquiry.id} inquiry={inquiry} backTo={backTo}
      selected={selectedId === inquiry.id} onLocate={inquiry.location ? () => setSelectedId(inquiry.id) : undefined} />)}
  </div>
  return desktop ? <ResizableMapLayout contentLabel="提問" map={map}>{list}</ResizableMapLayout>
    : <div className="flex min-w-0 flex-col gap-4">{map}{list}</div>
}
