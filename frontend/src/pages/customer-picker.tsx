import { useEffect, useMemo, useState } from "react"
import { Bell, ChevronRight, CircleHelp, Search } from "lucide-react"
import { Link } from "react-router"

import { CUSTOMER_TYPE_LABEL, listCustomers, type Customer } from "@/api/customers"
import { BottomNav } from "@/components/bottom-nav"
import { Notice } from "@/components/notice"
import { PendingUploads } from "@/components/pending-uploads"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { formatDate } from "@/lib/format"
import { useUnseenReplies } from "@/lib/manager-replies"
import { openGuide } from "@/lib/onboarding"

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; customers: Customer[]; cached: boolean }

export function CustomerPicker() {
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState("")
  const unseen = useUnseenReplies()

  useEffect(() => {
    const controller = new AbortController()
    listCustomers(controller.signal)
      .then(({ customers, cached }) => setState({ status: "ready", customers, cached }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => controller.abort()
  }, [attempt])

  // 客戶 250 家，整份清單壓縮後約 4 KB，一次載入後在手機上篩選，打字時不必每個字都等網路
  const keyword = query.trim()
  const visible = useMemo(
    () => (state.status === "ready" ? state.customers.filter((c) => c.name.includes(keyword)) : []),
    [state, keyword]
  )

  function retry() {
    setState({ status: "loading" })
    setAttempt((n) => n + 1)
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 pt-2 pb-3 backdrop-blur">
        <div className="-mr-2 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">中化裕民 · 業務 AI 助理</p>
          <div className="flex items-center">
            <Link to="/manager" className="flex h-10 items-center px-2 text-xs text-muted-foreground">
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
            {/* FR-8.4：主管回覆了，這裡顯示還沒看的則數 */}
            <Link
              to="/escalations"
              aria-label={unseen > 0 ? `主管回覆 ${unseen} 則，查看` : "轉給主管的提問"}
              className="relative flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <Bell className="size-5" />
              {unseen > 0 && (
                <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
                  {unseen}
                </span>
              )}
            </Link>
          </div>
        </div>
        <h1 className="text-lg font-semibold">選擇拜訪客戶</h1>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋客戶名稱"
            aria-label="搜尋客戶名稱"
            className="h-11 bg-card pl-9"
          />
        </div>
      </header>

      <main className="flex-1 px-4 pt-3 pb-20">
        {unseen > 0 && (
          <Link
            to="/escalations"
            className="mb-3 flex min-h-12 items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm"
          >
            <Bell className="size-4 shrink-0 text-primary" />
            <span className="flex-1">主管回覆了你轉過去的 {unseen} 個提問</span>
            <span className="shrink-0 font-medium text-primary">查看</span>
          </Link>
        )}
        <PendingUploads />
        {state.status === "ready" && state.cached && (
          <p className="mb-2 text-xs text-muted-foreground">沒有網路，顯示上次載入的客戶清單。錄音會先存在手機，恢復連線自動送出。</p>
        )}
        {state.status === "loading" && (
          <p className="py-10 text-center text-sm text-muted-foreground">載入客戶中…</p>
        )}
        {state.status === "error" && (
          <Notice text="連不上伺服器，客戶清單沒有載入。" action={{ label: "重新載入", onClick: retry }} />
        )}
        {state.status === "ready" && visible.length === 0 && (
          <Notice
            text={`找不到名稱包含「${keyword}」的客戶。`}
            action={{ label: "清除搜尋", onClick: () => setQuery("") }}
          />
        )}
        {visible.length > 0 && (
          <ul className="flex flex-col gap-2">
            {visible.map((customer) => (
              <CustomerRow key={customer.id} customer={customer} />
            ))}
          </ul>
        )}
      </main>
      <BottomNav />
    </div>
  )
}

function CustomerRow({ customer }: { customer: Customer }) {
  return (
    <li>
      <Link
        to={`/customers/${customer.id}`}
        className="flex items-center gap-2 rounded-xl border bg-card py-3 pr-2 pl-4 active:bg-muted"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="leading-snug font-medium">{customer.name}</p>
            <Badge variant="secondary">{customer.grade} 級</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {CUSTOMER_TYPE_LABEL[customer.type]} · {customer.region} ·{" "}
            {customer.last_visit_date ? `上次拜訪 ${formatDate(customer.last_visit_date)}` : "還沒有拜訪紀錄"}
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  )
}
