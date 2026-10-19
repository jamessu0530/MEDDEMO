import { useAskPageContext } from "@/ask/use-page-context"
import { useEffect, useState } from "react"
import {
  Check,
  ChevronRight,
  ClipboardList,
  Copy,
  LoaderCircle,
  Plus,
  Save,
  Send,
  Trash2,
} from "@/components/icons"
import {
  Link,
  Navigate,
  useBlocker,
  useLocation,
  useParams,
} from "react-router"
import {
  createOrder,
  getOrder,
  saveOrder,
  submitOrder,
  type OrderDetail,
  type OrderInput,
  type OrderProduct,
  type OrderCustomer,
} from "@/api/orders"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { CustomerSelect } from "@/components/customers/customer-select"
import { SearchSelect } from "@/components/ui/search-select"
import { OrderProducts } from "@/components/orders/order-products"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatDate, formatTaipeiDateTime } from "@/lib/format"
import {
  orderAmount,
  orderError,
  orderInput,
  orderMoney,
  orderPrice,
  PAYMENT_TERMS,
  repeatOrder,
} from "@/lib/orders"
import { OrderBadge } from "@/pages/orders"
import { cn } from "@/lib/utils"
import { makePracticeOrder, savePracticeOrder } from "@/lib/order-practice"
import { celebrateCompletion } from "@/lib/completion-celebration"

type Tab = "items" | "related" | "activity"
const FIELD =
  "h-11 w-full min-w-0 rounded-xl border bg-background px-3 text-sm disabled:bg-muted/50 disabled:text-foreground"

export function OrderPage() {
  const { orderId = "" } = useParams()
  const location = useLocation()
  const [loaded, setLoaded] = useState<{
    id: string
    navigationKey: string
    order: OrderDetail
  } | null>(null)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    getOrder(orderId, controller.signal)
      .then((order) => {
        if (!controller.signal.aborted) {
          setLoaded({ id: orderId, navigationKey: location.key, order })
          setError("")
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : "訂單沒有載入")
      })
    return () => controller.abort()
  }, [orderId, retry, location.key])
  if (!loaded || loaded.id !== orderId || loaded.navigationKey !== location.key)
    return (
      <div>
        <PageHeader title="訂單明細" backTo="/orders" />
        <main className="p-6">
          {error ? (
            <Notice
              text={error}
              action={{
                label: "重新載入",
                onClick: () => setRetry((n) => n + 1),
              }}
            />
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              載入訂單中…
            </p>
          )}
        </main>
      </div>
    )
  return <OrderEditor key={`${orderId}/${retry}/${loaded.navigationKey}`} initial={loaded.order} />
}

export function PracticeOrderPage() {
  const location = useLocation()
  const customer = (
    location.state as { practiceCustomer?: OrderCustomer } | null
  )?.practiceCustomer
  if (!customer) return <Navigate to="/orders" replace />
  return <PracticeOrderEditor key={customer.id} customer={customer} />
}

function PracticeOrderEditor({ customer }: { customer: OrderCustomer }) {
  const [initial] = useState(() => makePracticeOrder(customer))
  return <OrderEditor initial={initial} practice />
}

function OrderEditor({
  initial,
  practice = false,
}: {
  initial: OrderDetail
  practice?: boolean
}) {
  const [order, setOrder] = useState(initial)
  const [draft, setDraft] = useState<OrderInput>(() => orderInput(initial))
  const [products, setProducts] = useState<
    Record<string, OrderProduct | OrderDetail["items"][number]>
  >(() => Object.fromEntries(initial.items.map((item) => [item.sku, item])))
  const [shipTo, setShipTo] = useState({
    name: initial.ship_to_name,
    address: initial.shipping_address,
  })
  const [tab, setTab] = useState<Tab>("items")
  const [picker, setPicker] = useState(false)
  const [editingItems, setEditingItems] = useState(false)
  const [phase, setPhase] = useState<"save" | "submit" | "copy" | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [confirm, setConfirm] = useState<OrderDetail | null>(null)
  const [copy, setCopy] = useState<OrderDetail | null>(null)
  const busy = phase !== null
  const readonly = order.readonly
  const dirty = JSON.stringify(draft) !== JSON.stringify(orderInput(order))
  useAskPageContext({
    title: `${order.order_no} · 訂單明細`,
    facts: [
      `訂單編號：${order.order_no}`,
      `客戶：${order.customer_name}（${order.customer_id}）`,
      `狀態：${order.status === "draft" ? "草稿" : "已生效"}`,
      `正式交易資料是否已寫入：${order.status === "effective" ? "是" : "否"}`,
      ...(dirty ? ["此頁有尚未儲存的修改，不能當作正式交易"] : []),
      ...(practice ? ["這是教學練習單，不是真實交易"] : []),
    ],
  })
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !practice && dirty && currentLocation.pathname !== nextLocation.pathname
  )
  useEffect(() => {
    if (!dirty || practice) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty, practice])
  function update(patch: Partial<OrderInput>) {
    setDraft((current) => ({ ...current, ...patch }))
    setError("")
    setNotice("")
  }
  async function persist() {
    if (busy) return null
    const invalid = orderError(draft)
    if (invalid) {
      setError(invalid)
      return null
    }
    setPhase("save")
    setError("")
    setNotice("")
    try {
      const saved = practice
        ? savePracticeOrder(order, draft, products)
        : await saveOrder(order.id, draft, order.revision)
      setOrder(saved)
      setDraft(orderInput(saved))
      setProducts((current) => ({
        ...current,
        ...Object.fromEntries(saved.items.map((item) => [item.sku, item])),
      }))
      setNotice(practice ? "練習草稿已保留在這個頁面。" : "草稿已儲存。")
      return saved
    } catch (err) {
      setError(err instanceof Error ? err.message : "草稿沒有儲存")
      return null
    } finally {
      setPhase(null)
    }
  }
  async function prepareSubmit() {
    if (practice) {
      setNotice("這是練習單。正式訂單請回訂單頁建立，核對資料後再發送至 SAP。")
      return
    }
    const invalid = orderError(draft)
    if (invalid) {
      setError(invalid)
      return
    }
    if (!draft.items.length) {
      setError("請先新增至少一項產品。")
      return
    }
    if (!draft.shipping_address.trim()) {
      setError("請填寫完整收貨地址。")
      return
    }
    if (draft.shipping_date < order.as_of) {
      setError("指定出貨日期不能早於資料基準日。")
      return
    }
    const blocked = itemRows.find(
      (item) => item.price.kind === "red" || item.price.kind === "gray"
    )
    if (blocked) {
      setError(
        `${blocked.product?.name ?? blocked.sku}：${blocked.price.kind === "red" ? "超過業務 3% 優惠權限，請先從相關資料開報價申請優惠。" : "尚無標準供貨價，請先確認商品價格。"}`
      )
      setTab("items")
      return
    }
    const saved = dirty ? await persist() : order
    if (saved) setConfirm(saved)
  }
  async function send() {
    if (practice) return
    if (!confirm || busy) return
    setPhase("submit")
    setError("")
    try {
      const saved = await submitOrder(order.id, confirm.revision)
      setOrder(saved)
      setDraft(orderInput(saved))
      setConfirm(null)
      setNotice("訂單已送至 SAP 並生效，交易與應收帳款已建立。")
      celebrateCompletion("訂單成功送出！")
      setEditingItems(false)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "訂單未完成同步，草稿已保留"
      )
    } finally {
      setPhase(null)
    }
  }
  async function duplicate() {
    if (practice) {
      setNotice("練習單無法帶出正式訂單，請回訂單頁建立。")
      return
    }
    if (busy) return
    setPhase("copy")
    setError("")
    try {
      const created = await createOrder(repeatOrder(order))
      setCopy(created)
    } catch (err) {
      setError(err instanceof Error ? err.message : "新草稿沒有建立")
    } finally {
      setPhase(null)
    }
  }
  function add(chosen: OrderProduct[]) {
    setProducts((current) => ({
      ...current,
      ...Object.fromEntries(chosen.map((item) => [item.sku, item])),
    }))
    update({
      items: [
        ...draft.items,
        ...chosen.map(({ sku, unit_price, last_qty }) => ({
          sku,
          qty: last_qty ?? 1,
          unit_price,
        })),
      ],
    })
    setPicker(false)
    setEditingItems(true)
    setNotice("產品已加入，請確認數量與單價後儲存草稿。")
  }
  const total = readonly ? order.amount : orderAmount(draft.items)
  const itemRows = draft.items.map((item, index) => {
    const product = products[item.sku]
    const standard =
      product && "standard_price" in product
        ? product.standard_price
        : (product?.unit_price ?? 0)
    return {
      ...item,
      product,
      price: orderPrice(item.unit_price, standard),
      amount: readonly ? order.items[index].amount : orderAmount([item]),
    }
  })
  const step = order.status === "effective" ? 3 : phase === "submit" ? 2 : 1
  const editItem = (sku: string, patch: Partial<OrderInput["items"][number]>) =>
    update({
      items: draft.items.map((item) =>
        item.sku === sku ? { ...item, ...patch } : item
      ),
    })
  const field = (
    name: string,
    key: "shipping_address" | "recipient" | "purchase_no",
    maxLength: number
  ) => (
    <label className="min-w-0 space-y-1.5 text-sm">
      <span className="text-muted-foreground">{name}</span>
      <Input
        aria-label={name}
        data-ui-demo={practice ? `practice-${key}` : undefined}
        value={draft[key]}
        maxLength={maxLength}
        disabled={readonly || busy}
        onChange={(event) => update({ [key]: event.target.value })}
        className="h-11 disabled:text-foreground"
        placeholder={readonly ? "未記錄" : undefined}
      />
    </label>
  )
  return (
    <div className="min-h-svh pb-8">
      <PageHeader
        title="訂單明細"
        backTo="/orders"
        subtitle={practice ? "熊熊滾操作示範" : "訂單明細"}
      />
      {practice && (
        <div
          role="note"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary lg:px-6"
        >
          <span>
            <strong>練習模式</strong> · 教學資料只留在此頁，離開即可結束練習。
          </span>
          <Link
            className="inline-flex min-h-10 items-center font-semibold underline underline-offset-4"
            to="/orders"
          >
            結束練習，回訂單
          </Link>
        </div>
      )}
      <header className="border-b bg-card p-4 lg:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ClipboardList className="size-6" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">訂單</p>
              <h1 className="text-xl font-semibold break-all">
                {order.order_no}
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || dirty}
              title={dirty ? "請先儲存草稿，再照舊帶出" : undefined}
              onClick={() => void duplicate()}
            >
              {phase === "copy" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Copy className="size-4" />
              )}
              照舊帶出
            </Button>
            {!readonly && (
              <>
                <Button
                  variant="outline"
                  data-ui-demo={practice ? "practice-save" : undefined}
                  disabled={busy || !dirty}
                  onClick={() => void persist()}
                >
                  {phase === "save" ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  儲存草稿
                </Button>
                <Button
                  data-ui-demo={practice ? "practice-submit" : undefined}
                  disabled={busy || !draft.items.length}
                  onClick={() => void prepareSubmit()}
                >
                  {phase === "submit" ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  發送至 SAP
                </Button>
              </>
            )}
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3 xl:grid-cols-6">
          {[
            ["客戶名稱", order.customer_name],
            ["收貨點", shipTo.name],
            ["訂單金額", `${orderMoney(total)} 元`],
            [
              order.source === "history" ? "交易日期" : "指定出貨日期",
              draft.shipping_date,
            ],
            ["狀態", <OrderBadge status={order.status} />],
          ].map(([label, value]) => (
            <div key={String(label)} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 font-medium break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </header>
      <main className="space-y-4 p-4 lg:p-6">
        {error && (
          <p
            role="alert"
            className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="rounded-xl bg-primary/10 p-3 text-sm text-primary"
          >
            {notice}
          </p>
        )}
        {dirty && (
          <p
            role="status"
            className="text-xs text-amber-700 dark:text-amber-300"
          >
            有尚未儲存的調整。
          </p>
        )}
        <ol
          aria-label="訂單進度"
          className="flex rounded-2xl border-2 bg-card p-2 shadow-lip"
        >
          {["已建立", "草稿", "同步至 SAP", "生效"].map((label, index) => (
            <li
              aria-current={index === step ? "step" : undefined}
              key={label}
              className={cn(
                "flex min-w-0 flex-1 items-center justify-center gap-1 rounded-xl px-1 py-3 text-center text-xs sm:text-sm",
                index === step
                  ? "bg-primary font-semibold text-primary-foreground"
                  : index < step
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground"
              )}
            >
              {index < step ? (
                <Check className="size-4 shrink-0" />
              ) : index === step && busy ? (
                <LoaderCircle className="size-4 shrink-0 animate-spin" />
              ) : null}
              <span>{label}</span>
              {index < 3 && (
                <ChevronRight className="hidden size-3 shrink-0 sm:block" />
              )}
            </li>
          ))}
        </ol>
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="min-w-0 overflow-hidden rounded-2xl border-2 bg-card shadow-lip">
            <div
              role="tablist"
              aria-label="訂單內容"
              className="flex gap-5 border-b px-4"
            >
              {(
                [
                  ["items", "項目"],
                  ["related", "相關"],
                  ["activity", "活動"],
                ] as const
              ).map(([key, label]) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  aria-controls={`order-panel-${key}`}
                  id={`order-tab-${key}`}
                  key={key}
                  onClick={() => setTab(key)}
                  className={cn(
                    "min-h-12 border-b-2 px-1 text-sm font-semibold",
                    tab === key
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div
              role="tabpanel"
              id={`order-panel-${tab}`}
              aria-labelledby={`order-tab-${tab}`}
            >
              {tab === "items" ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/30 p-4">
                    <h2 className="text-base font-semibold">
                      訂單產品（{draft.items.length}）
                    </h2>
                    {!readonly && (
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          data-ui-demo={
                            practice ? "practice-add-products" : undefined
                          }
                          disabled={busy || draft.items.length >= 100}
                          onClick={() => setPicker(true)}
                          data-ui-demo-open="dialog"
                        >
                          <Plus className="size-4" />
                          新增產品
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy || !draft.items.length}
                          aria-pressed={editingItems}
                          onClick={() => setEditingItems((value) => !value)}
                        >
                          {editingItems ? "完成編輯" : "編輯產品"}
                        </Button>
                      </div>
                    )}
                  </div>
                  {!itemRows.length ? (
                    <div className="flex min-h-52 flex-col items-center justify-center gap-3 p-6 text-center">
                      <ClipboardList className="size-8 text-primary/50" />
                      <p className="text-sm font-medium">
                        草稿已建立，還沒有加入產品
                      </p>
                      {!readonly && (
                        <Button
                          variant="outline"
                          onClick={() => setPicker(true)}
                          data-ui-demo-open="dialog"
                        >
                          選擇產品
                        </Button>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="hidden overflow-x-auto md:block">
                        <table className="w-full text-left text-sm">
                          <thead className="border-y bg-muted/50 text-xs text-muted-foreground">
                            <tr>
                              {[
                                "項目",
                                "產品",
                                "數量",
                                "單價",
                                "金額",
                                "價格檢查",
                                ...(!readonly ? ["操作"] : []),
                              ].map((label) => (
                                <th
                                  key={label}
                                  className="px-3 py-3 whitespace-nowrap"
                                >
                                  {label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {itemRows.map((item, index) => (
                              <tr key={item.sku} className="border-b">
                                <td className="px-3 py-4 text-xs text-muted-foreground">
                                  {(index + 1) * 10}
                                </td>
                                <td className="min-w-40 px-3 py-4">
                                  <p className="font-medium">
                                    {item.product?.name ?? item.sku}
                                  </p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {item.sku} · {item.product?.unit}
                                  </p>
                                </td>
                                <td className="px-3 py-4">
                                  {editingItems && !readonly ? (
                                    <input
                                      type="number"
                                      aria-label={`${item.product?.name ?? item.sku}數量`}
                                      className={cn(
                                        FIELD,
                                        "w-28 min-w-28 tabular-nums"
                                      )}
                                      min={1}
                                      max={100000}
                                      step={1}
                                      value={item.qty || ""}
                                      disabled={busy}
                                      onChange={(event) =>
                                        editItem(item.sku, {
                                          qty: Number(event.target.value),
                                        })
                                      }
                                    />
                                  ) : (
                                    item.qty
                                  )}
                                </td>
                                <td className="px-3 py-4">
                                  {editingItems && !readonly ? (
                                    <input
                                      type="number"
                                      aria-label={`${item.product?.name ?? item.sku}單價`}
                                      className={cn(
                                        FIELD,
                                        "w-32 min-w-32 tabular-nums"
                                      )}
                                      min={0}
                                      step="0.01"
                                      value={item.unit_price}
                                      disabled={busy}
                                      onChange={(event) =>
                                        editItem(item.sku, {
                                          unit_price: Number(
                                            event.target.value
                                          ),
                                        })
                                      }
                                    />
                                  ) : (
                                    orderMoney(item.unit_price)
                                  )}
                                </td>
                                <td className="px-3 py-4 text-right tabular-nums">
                                  {orderMoney(item.amount)}
                                </td>
                                <td className="px-3 py-4">
                                  <PriceBadge
                                    kind={readonly ? "gray" : item.price.kind}
                                    label={
                                      readonly ? "已成交價格" : item.price.label
                                    }
                                  />
                                </td>
                                {!readonly && (
                                  <td className="px-3 py-4">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label={`移除 ${item.product?.name ?? item.sku}`}
                                      disabled={busy}
                                      onClick={() =>
                                        update({
                                          items: draft.items.filter(
                                            (row) => row.sku !== item.sku
                                          ),
                                        })
                                      }
                                    >
                                      <Trash2 className="size-4 text-destructive" />
                                    </Button>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="divide-y md:hidden">
                        {itemRows.map((item) => (
                          <div key={item.sku} className="space-y-3 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium">
                                  {item.product?.name ?? item.sku}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {item.sku} · {item.product?.unit}
                                </p>
                              </div>
                              {!readonly && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`移除 ${item.product?.name ?? item.sku}`}
                                  disabled={busy}
                                  onClick={() =>
                                    update({
                                      items: draft.items.filter(
                                        (row) => row.sku !== item.sku
                                      ),
                                    })
                                  }
                                >
                                  <Trash2 className="size-4 text-destructive" />
                                </Button>
                              )}
                            </div>
                            {editingItems && !readonly ? (
                              <div className="grid grid-cols-2 gap-3">
                                <label className="text-sm">
                                  數量
                                  <input
                                    type="number"
                                    aria-label={`${item.product?.name ?? item.sku}數量`}
                                    className={FIELD}
                                    min={1}
                                    max={100000}
                                    step={1}
                                    value={item.qty || ""}
                                    disabled={busy}
                                    onChange={(event) =>
                                      editItem(item.sku, {
                                        qty: Number(event.target.value),
                                      })
                                    }
                                  />
                                </label>
                                <label className="text-sm">
                                  單價
                                  <input
                                    type="number"
                                    aria-label={`${item.product?.name ?? item.sku}單價`}
                                    className={FIELD}
                                    min={0}
                                    step="0.01"
                                    value={item.unit_price}
                                    disabled={busy}
                                    onChange={(event) =>
                                      editItem(item.sku, {
                                        unit_price: Number(event.target.value),
                                      })
                                    }
                                  />
                                </label>
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                {item.qty} × {orderMoney(item.unit_price)} 元
                              </p>
                            )}
                            <div className="flex items-center justify-between gap-2">
                              <PriceBadge
                                kind={readonly ? "gray" : item.price.kind}
                                label={
                                  readonly ? "已成交價格" : item.price.label
                                }
                              />
                              <span className="text-sm font-semibold tabular-nums">
                                {orderMoney(item.amount)} 元
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="flex justify-between border-t px-4 py-4 text-sm font-semibold">
                    <span>訂單合計（TWD）</span>
                    <span className="tabular-nums">{orderMoney(total)} 元</span>
                  </div>
                  {!readonly && (
                    <details className="border-t p-4 text-xs leading-relaxed text-muted-foreground">
                      <summary className="cursor-pointer font-medium text-foreground">
                        價格燈號說明
                      </summary>
                      <ul className="mt-3 space-y-2">
                        <li>綠燈：單價不低於標準供貨價。</li>
                        <li>黃燈：低於標準價，優惠仍在業務 3% 權限內。</li>
                        <li>
                          紅燈：超過 3% 權限，請先從客戶的「開報價」申請優惠。
                        </li>
                        <li>灰燈：商品尚無標準供貨價，請先確認價格。</li>
                      </ul>
                    </details>
                  )}
                </>
              ) : tab === "related" ? (
                <div className="space-y-4 p-5 text-sm">
                  <h2 className="font-semibold">相關資料</h2>
                  <Link
                    className="block rounded-xl border p-4 text-primary hover:bg-muted"
                    to={`/customers/${order.customer_id}`}
                    aria-disabled={practice || undefined}
                    tabIndex={practice ? -1 : undefined}
                    onClick={(event) => {
                      if (practice) event.preventDefault()
                    }}
                    state={{ backTo: `/orders/${order.id}` }}
                  >
                    客戶資料 · {order.customer_name}
                    <ChevronRight className="float-right size-4" />
                  </Link>
                  <Link
                    className="block rounded-xl border p-4 text-primary hover:bg-muted"
                    to={`/customers/${order.customer_id}/quote`}
                    aria-disabled={practice || undefined}
                    tabIndex={practice ? -1 : undefined}
                    onClick={(event) => {
                      if (practice) event.preventDefault()
                    }}
                  >
                    開報價／申請優惠
                    <ChevronRight className="float-right size-4" />
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {order.sap_order_no
                      ? `SAP／交易單號：${order.sap_order_no}`
                      : order.source === "history"
                        ? "歷史交易未記錄 SAP 單號。"
                        : "草稿尚未同步，送出後會顯示交易單號。"}
                  </p>
                </div>
              ) : (
                <div className="space-y-5 p-5 text-sm">
                  <h2 className="font-semibold">訂單活動</h2>
                  <div className="border-l-2 border-primary/20 pl-4">
                    <p>
                      {order.source === "history" ? "歷史交易日期" : "建立草稿"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {order.source === "history"
                        ? formatDate(order.shipping_date)
                        : formatTaipeiDateTime(order.created_at)}
                    </p>
                  </div>
                  {order.source === "workspace" && (
                    <div className="border-l-2 border-primary/20 pl-4">
                      <p>
                        {order.status === "effective"
                          ? "已同步SAP，訂單生效"
                          : "最近儲存草稿"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatTaipeiDateTime(
                          order.updated_at ?? order.created_at
                        )}{" "}
                        · 版本 {order.revision}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
          <aside className="min-w-0 space-y-4 rounded-2xl border-2 bg-card p-4 shadow-lip">
            <h2 className="font-semibold">訂單資料</h2>
            <div className="grid grid-cols-2 gap-3 border-b pb-4 text-xs">
              <div>
                <p className="text-muted-foreground">訂單類型</p>
                <p className="mt-1">{order.order_type}</p>
              </div>
              <div>
                <p className="text-muted-foreground">訂單貨幣</p>
                <p className="mt-1">TWD 台幣</p>
              </div>
            </div>
            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground">收貨點</span>
              {practice ? (
                <SearchSelect
                  label="收貨點"
                  value={draft.ship_to_id}
                  disabled={readonly || busy}
                  options={[
                    {
                      value: order.customer_id,
                      label: order.customer_name,
                    },
                  ]}
                  onValueChange={(ship_to_id) => update({ ship_to_id })}
                />
              ) : (
                <CustomerSelect
                  label="收貨點"
                  value={draft.ship_to_id}
                  selected={shipTo}
                  disabled={readonly || busy}
                  onSelect={(customer) => {
                    setShipTo({
                      name: customer.name,
                      address: customer.address || "",
                    })
                    update({
                      ship_to_id: customer.id,
                      shipping_address: customer.address || "",
                    })
                  }}
                />
              )}
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground">
                {order.source === "history" ? "交易日期" : "指定出貨日期"}
              </span>
              <input
                type="date"
                aria-label={
                  order.source === "history" ? "交易日期" : "指定出貨日期"
                }
                className={FIELD}
                value={draft.shipping_date}
                min={order.as_of}
                disabled={readonly || busy}
                onChange={(event) =>
                  update({ shipping_date: event.target.value })
                }
              />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground">
                {order.source === "history"
                  ? "付款條件（目前客戶設定）"
                  : "付款條件"}
              </span>
              <SearchSelect
                label="付款條件"
                value={draft.payment_term}
                disabled={readonly || busy}
                options={Object.entries(PAYMENT_TERMS).map(
                  ([value, label]) => ({ value, label })
                )}
                onValueChange={(payment_term) => update({ payment_term })}
              />
            </label>
            <div className="grid gap-4">
              {field("收貨點地址", "shipping_address", 240)}
              {field("收貨人姓名", "recipient", 80)}
              {field("採購單號", "purchase_no", 80)}
            </div>
            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground">訂單備註</span>
              <textarea
                aria-label="訂單備註"
                className="min-h-24 w-full rounded-xl border bg-background p-3 text-sm disabled:bg-muted/50"
                maxLength={1000}
                value={draft.note}
                disabled={readonly || busy}
                onChange={(event) => update({ note: event.target.value })}
              />
            </label>
          </aside>
        </div>
      </main>
      {picker && (
        <OrderProducts
          key={draft.customer_id}
          practice={practice}
          customerId={draft.customer_id}
          existing={draft.items}
          onAdd={add}
          onClose={() => setPicker(false)}
        />
      )}
      <Dialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.state === "blocked") blocker.reset()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>離開前儲存訂單草稿？</DialogTitle>
            <DialogDescription>
              產品或出貨資料有尚未儲存的調整。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => blocker.reset?.()}
            >
              繼續編輯
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => blocker.proceed?.()}
            >
              捨棄未儲存的調整
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void persist().then((saved) => {
                  if (saved) blocker.proceed?.()
                })
              }
            >
              儲存後離開
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => !open && !busy && setConfirm(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>確認發送訂單到SAP？</DialogTitle>
            <DialogDescription>
              {order.customer_name}，{orderMoney(total)} 元，指定出貨日期{" "}
              {draft.shipping_date}
              。送出後會建立交易與應收帳款，不能再編輯這張訂單。
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              繼續編輯
            </Button>
            <Button disabled={busy} onClick={() => void send()}>
              {busy && <LoaderCircle className="size-4 animate-spin" />}確認送出
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={copy !== null}
        onOpenChange={(open) => !open && setCopy(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新訂單草稿已建立</DialogTitle>
            <DialogDescription>
              產品數量照舊，單價已依目前標準供貨價重新帶入。請確認收貨資料後再送出。
            </DialogDescription>
          </DialogHeader>
          {copy && (
            <Button asChild>
              <Link to={`/orders/${copy.id}`} onClick={() => setCopy(null)}>
                開啟 {copy.order_no}
              </Link>
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PriceBadge({
  kind,
  label,
}: {
  kind: "green" | "yellow" | "red" | "gray"
  label: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          {
            green: "bg-emerald-500",
            yellow: "bg-amber-500",
            red: "bg-red-500",
            gray: "bg-slate-400",
          }[kind]
        )}
      />
      {label}
    </span>
  )
}
