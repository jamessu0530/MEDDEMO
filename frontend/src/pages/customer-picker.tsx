import { memo, useEffect, useRef, useState } from "react"
import { ChevronRight, CircleHelp, Search } from "@/components/icons"
import { Link } from "react-router"

import {
  CUSTOMER_TYPE_LABEL,
  listPickerCustomers,
  type Customer,
  type CustomerPickerPage,
} from "@/api/customers"
import { BottomNav } from "@/components/bottom-nav"
import {
  CustomerStorefrontList,
  CustomerStorefrontThumbnail,
} from "@/components/customer-storefront"
import { Notice } from "@/components/notice"
import { PendingUploads } from "@/components/pending-uploads"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatDate } from "@/lib/format"
import { openGuide } from "@/lib/onboarding"

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | ({ status: "ready"; cached: boolean } & CustomerPickerPage)

export function CustomerPicker() {
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState("")
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState(false)
  const moreController = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(
      () =>
        listPickerCustomers(controller.signal, query.trim())
          .then((page) => {
            if (!controller.signal.aborted)
              setState({ status: "ready", ...page })
          })
          .catch(() => {
            if (!controller.signal.aborted) setState({ status: "error" })
          }),
      query.trim() ? 200 : 0
    )
    return () => {
      clearTimeout(timer)
      controller.abort()
      moreController.current?.abort()
    }
  }, [attempt, query])

  const keyword = query.trim()
  const visible = state.status === "ready" ? state.customers : []
  const nextOffset =
    state.status === "ready" && !state.cached ? state.next_offset : null

  useEffect(() => {
    if (nextOffset === null) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void listPickerCustomers(controller.signal, keyword, nextOffset).catch(
        () => {}
      )
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [keyword, nextOffset])

  function search(value: string) {
    moreController.current?.abort()
    setQuery(value)
    setState({ status: "loading" })
    setLoadingMore(false)
    setMoreError(false)
  }

  function loadMore() {
    if (state.status !== "ready" || state.next_offset === null || loadingMore)
      return
    const controller = new AbortController()
    moreController.current = controller
    setLoadingMore(true)
    setMoreError(false)
    listPickerCustomers(controller.signal, keyword, state.next_offset)
      .then((page) => {
        if (controller.signal.aborted) return
        setState((previous) =>
          previous.status !== "ready"
            ? previous
            : {
                status: "ready",
                customers: [
                  ...new Map(
                    [...previous.customers, ...page.customers].map(
                      (customer) => [customer.id, customer]
                    )
                  ).values(),
                ],
                next_offset: page.next_offset,
                cached: previous.cached || page.cached,
              }
        )
      })
      .catch(() => {
        if (!controller.signal.aborted) setMoreError(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingMore(false)
      })
  }

  function retry() {
    setState({ status: "loading" })
    setAttempt((n) => n + 1)
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 pt-2 pb-3 backdrop-blur">
        <div className="-mr-2 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            中化裕民 · 業務 AI 助理
          </p>
          <div className="flex items-center">
            <Link
              to="/manager"
              className="flex h-10 items-center px-2 text-xs text-muted-foreground"
            >
              主管端
            </Link>
            <button
              type="button"
              aria-label="使用說明"
              onClick={openGuide}
              className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <CircleHelp className="size-5" />
            </button>
          </div>
        </div>
        <h1 className="text-xl font-semibold">選擇拜訪客戶</h1>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => search(event.target.value)}
            placeholder="搜尋名稱、地址或電話（支援錯字）"
            aria-label="搜尋名稱、地址或電話（支援錯字）"
            maxLength={100}
            className="h-11 bg-card pl-9"
          />
        </div>
      </header>

      <main className="flex-1 px-4 pt-3 pb-20">
        <PendingUploads />
        {state.status === "ready" && state.cached && (
          <p className="mb-2 text-xs text-muted-foreground">
            沒有網路，顯示上次載入的客戶清單。錄音會先存在手機，恢復連線自動送出。
          </p>
        )}
        {state.status === "loading" && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            載入客戶中…
          </p>
        )}
        {state.status === "error" && (
          <Notice
            text="連不上伺服器，客戶清單沒有載入。"
            action={{ label: "重新載入", onClick: retry }}
          />
        )}
        {state.status === "ready" && visible.length === 0 && (
          <Notice
            text={`找不到符合「${keyword}」的客戶。`}
            action={{ label: "清除搜尋", onClick: () => search("") }}
          />
        )}
        {visible.length > 0 && (
          <CustomerStorefrontList
            offline={state.status === "ready" && state.cached}
          >
            <ul className="flex flex-col gap-2">
              {visible.map((customer, index) => (
                <CustomerRow
                  key={customer.id}
                  customer={customer}
                  priority={index < 4}
                />
              ))}
            </ul>
            {moreError && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                無法載入更多客戶，請再試一次。
              </p>
            )}
            {state.status === "ready" && state.next_offset !== null && (
              <Button
                type="button"
                variant="outline"
                className="mt-4 w-full"
                disabled={loadingMore}
                onClick={loadMore}
              >
                {loadingMore ? "載入中…" : "顯示更多客戶"}
              </Button>
            )}
          </CustomerStorefrontList>
        )}
      </main>
      <BottomNav />
    </div>
  )
}

const CustomerRow = memo(function CustomerRow({
  customer,
  priority,
}: {
  customer: Customer
  priority: boolean
}) {
  return (
    <li className="flex items-start gap-3 rounded-xl border-2 bg-card p-3 shadow-lip">
      <CustomerStorefrontThumbnail
        priority={priority}
        customer={{
          id: customer.id,
          name: customer.name,
          city: customer.city ?? "",
          area: customer.area ?? "",
          address: customer.address,
          storefront_photo: customer.storefront_photo,
          google_place_id: customer.google_place_id,
        }}
      />
      <Link
        to={`/customers/${customer.id}`}
        state={{ backTo: "/customers" }}
        className="flex min-h-20 min-w-0 flex-1 press items-center gap-2 rounded-lg"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="leading-snug font-medium">{customer.name}</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {CUSTOMER_TYPE_LABEL[customer.type]} ·{" "}
            {customer.city || customer.region} {customer.area} ·{" "}
            {customer.last_visit_date
              ? `上次拜訪 ${formatDate(customer.last_visit_date)}`
              : "還沒有拜訪紀錄"}
          </p>
          {customer.address && (
            <p className="mt-1 text-xs text-muted-foreground">
              {customer.address}
            </p>
          )}
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  )
})
