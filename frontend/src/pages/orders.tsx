import { useAskPageContext } from "@/ask/use-page-context"
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  RotateCw,
} from "@/components/icons"
import { Link, useNavigate, useSearchParams } from "react-router"
import {
  createOrder,
  getOrderCustomer,
  getOrders,
  type OrderCustomer,
  type OrderList,
} from "@/api/orders"
import { BottomNav } from "@/components/bottom-nav"
import { Mascot } from "@/components/mascot"
import { Notice } from "@/components/notice"
import { PendingUploads } from "@/components/pending-uploads"
import { SalesHeader } from "@/components/sales-header"
import { Button } from "@/components/ui/button"
import { SearchField } from "@/components/ui/search-field"
import { SearchSelect } from "@/components/ui/search-select"
import { CustomerSelect } from "@/components/customers/customer-select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { formatDate, formatTaipeiDateTime } from "@/lib/format"
import { ORDER_STATUS, PAYMENT_TERMS, orderMoney } from "@/lib/orders"
import { cn } from "@/lib/utils"
import { PRACTICE_CUSTOMER } from "@/lib/order-practice"
import { uiDemo } from "@/lib/ui-demo-browser"

const SELECT = "h-11 min-w-0 rounded-xl border bg-card px-3 text-sm"

export function OrdersPage({
  newOrder = false,
  title = "訂單",
  navigation,
  showBottomNav = true,
  active = true,
}: {
  newOrder?: boolean
  title?: string
  navigation?: ReactNode
  showBottomNav?: boolean
  active?: boolean
}) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const customerId = newOrder
    ? searchParams.get("customer_id") || undefined
    : undefined
  const demonstrating =
    useSyncExternalStore(uiDemo.subscribe, uiDemo.getSnapshot).status ===
    "running"
  const [practice, setPractice] = useState(false)
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("all")
  const [sort, setSort] = useState("updated_desc")
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<OrderList | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  const [creating, setCreating] = useState(false)
  useAskPageContext({ title: newOrder ? "新增訂單" : "銷售訂單", facts: [
    `搜尋：${query.trim() || "無"}`, `訂單狀態篩選：${status}`, `排序：${sort}`, `清單第 ${page} 頁`,
    ...(customerId ? [`客戶編號：${customerId}`] : []),
  ] }, active)
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setBusy(true)
      setError("")
      getOrders({ q: query.trim(), status, page, sort }, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setResult(value)
        })
        .catch((err) => {
          if (!controller.signal.aborted)
            setError(err instanceof Error ? err.message : "訂單沒有載入")
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false)
        })
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, status, page, sort, retry])
  return (
    <div className="min-h-svh pb-24 lg:pb-8">
      <header className="border-b bg-card px-4 py-5 lg:px-6">
        <SalesHeader
          title={title}
          createDisabled={!result && !demonstrating}
          onCreate={() => {
            if (demonstrating) {
              setPractice(true)
              setCreating(true)
            } else navigate("/orders/new")
          }}
        />
        {navigation}
      </header>
      <main className="space-y-4 p-4 lg:p-6">
        <PendingUploads />
        <section className="overflow-hidden rounded-2xl border-2 bg-card shadow-lip">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div>
              <h2 className="font-semibold">訂單清單</h2>
              <p role="status" className="mt-1 text-xs text-muted-foreground">
                {result
                  ? `${result.total} 筆訂單 · 資料基準日 ${result.as_of}`
                  : "載入訂單中…"}
                {busy && result && " · 更新中…"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="重新整理訂單"
              disabled={busy}
              onClick={() => setRetry((n) => n + 1)}
            >
              <RotateCw className={cn("size-4", busy && "animate-spin")} />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 border-b p-4">
            <SearchField
              containerClassName="min-w-48 flex-1"
              aria-label="搜尋訂單"
              placeholder="搜尋訂單編號、客戶名稱或 SAP 單號"
              value={query}
              onValueChange={(value) => {
                setQuery(value)
                setPage(1)
              }}
              loading={busy}
            />
            <SearchSelect
              label="訂單狀態"
              className="w-full sm:w-40"
              value={status}
              options={[
                { value: "all", label: "全部狀態" },
                { value: "draft", label: "草稿" },
                { value: "effective", label: "生效" },
              ]}
              onValueChange={(value) => {
                setStatus(value)
                setPage(1)
              }}
            />
            <SearchSelect
              label="訂單排序"
              className="w-full sm:w-64"
              value={sort}
              options={[
                { value: "updated_desc", label: "最近更新" },
                { value: "shipping_desc", label: "出貨／交易日期由新到舊" },
                { value: "amount_desc", label: "訂單金額由高到低" },
              ]}
              onValueChange={(value) => {
                setSort(value)
                setPage(1)
              }}
            />
          </div>
          {error ? (
            <div className="p-4">
              <Notice
                text={error}
                action={{
                  label: "重新載入",
                  onClick: () => setRetry((n) => n + 1),
                }}
              />
            </div>
          ) : (
            <div aria-busy={busy}>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-muted/60 text-xs text-muted-foreground">
                    <tr>
                      {[
                        "訂單編號",
                        "客戶名稱",
                        "狀態",
                        "訂單金額",
                        "出貨／交易日期",
                        "上次修改",
                        "SAP 訂單編號",
                      ].map((label) => (
                        <th key={label} className="px-4 py-3 font-medium">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result?.items.map((order) => (
                      <tr key={order.id} className="border-t hover:bg-muted/30">
                        <td className="px-4 py-4">
                          <Link
                            className="font-semibold text-primary underline-offset-4 hover:underline"
                            to={`/orders/${order.id}`}
                          >
                            {order.order_no}
                          </Link>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {order.source === "history"
                              ? "歷史交易"
                              : "訂單工作區"}
                          </p>
                        </td>
                        <td className="px-4 py-4">{order.customer_name}</td>
                        <td className="px-4 py-4">
                          <OrderBadge status={order.status} />
                        </td>
                        <td className="px-4 py-4 text-right tabular-nums">
                          {orderMoney(order.amount)}
                        </td>
                        <td className="px-4 py-4">
                          {formatDate(order.shipping_date)}
                        </td>
                        <td className="px-4 py-4 text-xs">
                          {order.updated_at
                            ? formatTaipeiDateTime(order.updated_at)
                            : "未記錄"}
                        </td>
                        <td
                          className="max-w-48 truncate px-4 py-4 text-xs"
                          title={order.sap_order_no ?? undefined}
                        >
                          {order.sap_order_no ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y lg:hidden">
                {result?.items.map((order) => (
                  <Link
                    to={`/orders/${order.id}`}
                    key={order.id}
                    className="block space-y-2 p-4 hover:bg-muted/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-sm font-semibold break-all text-primary">
                        {order.order_no}
                      </span>
                      <OrderBadge status={order.status} />
                    </div>
                    <p className="text-sm font-medium">{order.customer_name}</p>
                    <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {order.source === "history" ? "成交" : "出貨"}{" "}
                        {formatDate(order.shipping_date)}
                      </span>
                      <span className="text-base font-semibold text-foreground tabular-nums">
                        {orderMoney(order.amount)}{" "}
                        <span className="text-xs font-normal">元</span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {order.source === "history" ? "歷史交易" : "訂單工作區"}
                      </span>
                      <ChevronRight className="size-4" />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {!busy && !error && result?.items.length === 0 && (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <Mascot size={72} />
              <h3 className="font-semibold">
                {query || status !== "all"
                  ? "沒有符合條件的訂單"
                  : "從第一張訂單開始"}
              </h3>
              <p className="text-sm text-muted-foreground">
                {query || status !== "all"
                  ? "調整搜尋或狀態，看看其他訂單。"
                  : "先選擇客戶建立草稿，再加入需要的產品。"}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  if (query || status !== "all") {
                    setQuery("")
                    setStatus("all")
                    setPage(1)
                  } else navigate("/orders/new")
                }}
              >
                {query || status !== "all" ? "清除篩選" : "建立訂單草稿"}
              </Button>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
            <span>
              第 {page}／{Math.max(1, Math.ceil((result?.total ?? 0) / 25))} 頁
            </span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label="上一頁訂單"
                disabled={page === 1 || busy}
                onClick={() => setPage((n) => n - 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="下一頁訂單"
                disabled={busy || !result || page * 25 >= result.total}
                onClick={() => setPage((n) => n + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </section>
      </main>
      {showBottomNav && <BottomNav />}
      {(newOrder || creating) && (
        <CreateOrderDialog
          key={customerId ?? "new"}
          asOf={result?.as_of}
          customerId={customerId}
          practice={!newOrder && practice}
          onClose={() => {
            if (newOrder)
              navigate(
                customerId
                  ? `/customers/${encodeURIComponent(customerId)}`
                  : "/orders",
                { replace: true }
              )
            else {
              setCreating(false)
              setPractice(false)
            }
          }}
        />
      )}
    </div>
  )
}

export function OrderBadge({ status }: { status: "draft" | "effective" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-medium",
        status === "draft"
          ? "bg-amber-500/10 text-amber-800 dark:text-amber-300"
          : "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
      )}
    >
      {ORDER_STATUS[status]}
    </span>
  )
}

function CreateOrderDialog({
  practice,
  asOf,
  customerId,
  onClose,
}: {
  asOf?: string
  customerId?: string
  practice: boolean
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [customer, setCustomer] = useState<OrderCustomer | null>(null)
  const [paymentTerm, setPaymentTerm] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [defaults, setDefaults] = useState<{ as_of: string } | null>(null)
  const [loadingCustomer, setLoadingCustomer] = useState(!!customerId)
  const [loadError, setLoadError] = useState("")
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!customerId || practice) return
    const controller = new AbortController()
    getOrderCustomer(customerId, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return
        setCustomer(value.customer)
        setPaymentTerm(value.customer.payment_term || "")
        setDefaults(value)
        setLoadError("")
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setLoadError(err instanceof Error ? err.message : "客戶資料沒有載入")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingCustomer(false)
      })
    return () => controller.abort()
  }, [customerId, practice, retry])
  const shippingDate = defaults?.as_of ?? asOf
  async function create() {
    const selected = customer
    if (!selected || busy || loadingCustomer || loadError) return
    if (practice) {
      navigate("/orders/demo")
      return
    }
    if (!shippingDate) {
      setError("出貨日期尚未載入，請重新載入訂單頁。")
      return
    }
    setBusy(true)
    setError("")
    try {
      const order = await createOrder({
        customer_id: selected.id,
        ship_to_id: selected.id,
        shipping_date: shippingDate,
        payment_term: paymentTerm,
        shipping_address: selected.address || "",
        recipient: "",
        purchase_no: "",
        note: "",
        items: [],
      })
      navigate(`/orders/${order.id}`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : "草稿沒有建立")
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新增訂單</DialogTitle>
          <DialogDescription>
            {practice
              ? "練習模式：使用教學資料，接著示範加入產品與出貨資料。"
              : "先選擇客戶建立草稿，之後再加入產品與出貨資料。"}
          </DialogDescription>
        </DialogHeader>
        {loadingCustomer && (
          <p role="status" className="text-sm text-muted-foreground">
            載入客戶資料中…
          </p>
        )}
        {loadError && (
          <Notice
            text={loadError}
            action={{
              label: "重新載入客戶",
              onClick: () => {
                setLoadingCustomer(true)
                setLoadError("")
                setRetry((value) => value + 1)
              },
            }}
          />
        )}
        <div className="space-y-2 text-sm">
          <p>客戶名稱</p>
          {practice ? (
            <select
              aria-label="新訂單客戶"
              data-ui-demo="practice-customer"
              className={`${SELECT} w-full`}
              value={customer?.id ?? ""}
              onChange={(event) => {
                setCustomer(event.target.value ? PRACTICE_CUSTOMER : null)
                setPaymentTerm(PRACTICE_CUSTOMER.payment_term || "RCD1")
              }}
            >
              <option value="">請選擇客戶</option>
              <option value={PRACTICE_CUSTOMER.id}>
                {PRACTICE_CUSTOMER.name}
              </option>
            </select>
          ) : (
            <CustomerSelect
              label="新訂單客戶"
              value={customer?.id ?? ""}
              selected={customer ?? undefined}
              disabled={busy || loadingCustomer || !!loadError}
              onSelect={(value) => {
                setCustomer(value)
                setPaymentTerm(value.payment_term || "")
                setError("")
              }}
            />
          )}
        </div>
        <div className="space-y-2 text-sm">
          <p>付款條件</p>
          <SearchSelect
            label="新訂單付款條件"
            value={paymentTerm}
            placeholder="請選擇本次訂單的付款條件"
            disabled={busy || loadingCustomer || !customer}
            options={Object.entries(PAYMENT_TERMS).map(([value, label]) => ({
              value,
              label,
            }))}
            onValueChange={setPaymentTerm}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            data-ui-demo={practice ? "practice-create" : undefined}
            disabled={
              busy ||
              loadingCustomer ||
              !!loadError ||
              !customer ||
              !paymentTerm ||
              (!practice && !shippingDate)
            }
            onClick={() => void create()}
          >
            {busy && <LoaderCircle className="size-4 animate-spin" />}建立草稿
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
