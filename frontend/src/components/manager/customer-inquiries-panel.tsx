import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { MessageCircleQuestion, RefreshCw, Search } from "@/components/icons"

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
                      : "客戶提問暫時無法載入。",
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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <section className="flex items-start gap-3 rounded-2xl border-2 bg-card p-4 shadow-lip">
        <MessageCircleQuestion className="mt-0.5 size-6 shrink-0 text-primary" />
        <div className="min-w-0">
          <h2 className="font-semibold">了解客戶問題，協助業務找到答案</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            看看團隊正在詢問哪些客戶、遇到什麼問題。AI
            尚未解決的提問，可以優先關心。
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
          aria-label="重新整理客戶提問"
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
          載入客戶提問中…
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
            則客戶提問
          </p>
          {refreshError && (
            <p role="status" className="text-sm text-destructive">
              更新暫時失敗，目前顯示上次載入的提問。請重新整理。
            </p>
          )}
          {state.data.items.length === 0 ? (
            <div className="rounded-2xl border border-dashed px-5 py-12 text-center">
              <p className="font-medium">
                {search || rep || help
                  ? "沒有符合條件的客戶提問"
                  : "最近還沒有客戶提問"}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                業務向 AI 詢問特定客戶時，相關問題會顯示在這裡。
              </p>
            </div>
          ) : (
            <div className="grid min-w-0 gap-3 lg:grid-cols-2">
              {state.data.items.map((inquiry) => (
                <CustomerInquiryCard
                  key={inquiry.id}
                  inquiry={inquiry}
                  backTo={`/manager?${params}`}
                />
              ))}
            </div>
          )}
          {(offset > 0 || offset + PAGE_SIZE < state.data.total) && (
            <nav
              aria-label="客戶提問分頁"
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
}: {
  inquiry: CustomerInquiry
  backTo: string
}) {
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-2xl border-2 bg-card p-4 shadow-lip">
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
