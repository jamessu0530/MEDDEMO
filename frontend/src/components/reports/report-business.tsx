import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router"
import {
  findBusinessProducts,
  getBusinessReport,
  type BusinessData,
  type BusinessProduct,
  type BusinessQuery,
  type BusinessView,
} from "@/api/report-business"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"

const VIEWS: Record<BusinessView, string> = {
  pharmacy_sales: "藥局業績",
  product_queries: "藥品查詢次數",
  product_orders: "單品訂購藥局",
}
const TYPES: Record<string, string> = {
  chain: "連鎖藥局",
  independent: "獨立藥局",
  clinic: "診所",
  outlet: "公開通路",
}
type Result =
  { key: string; data: BusinessData } | { key: string; error: string }

function ProductPicker({
  value,
  onChange,
}: {
  value: BusinessProduct | null
  onChange: (product: BusinessProduct | null) => void
}) {
  const [search, setSearch] = useState("")
  const [result, setResult] = useState<{
    key: string
    products?: BusinessProduct[]
    error?: string
  } | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      findBusinessProducts(search, controller.signal)
        .then((products) => {
          if (!controller.signal.aborted) setResult({ key: search, products })
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setResult({ key: search, error: "藥品清單載入失敗" })
        })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [search, attempt])
  const products = result?.key === search ? (result.products ?? []) : []
  const options =
    value && !products.some((p) => p.sku === value.sku)
      ? [value, ...products]
      : products
  return (
    <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
      <label className="block text-xs font-medium">
        搜尋藥品
        <Input
          className="mt-1 h-11"
          placeholder="輸入品名、別名或料號"
          maxLength={100}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <label className="block text-xs font-medium">
        選擇藥品
        <NativeSelect
          className="mt-1 min-h-11 w-full"
          value={value?.sku ?? ""}
          onChange={(e) =>
            onChange(options.find((p) => p.sku === e.target.value) ?? null)
          }
        >
          <option value="">請選擇要查詢的藥品</option>
          {options.map((p) => (
            <option key={p.sku} value={p.sku}>
              {p.name} · {p.sku} · {p.spec}
            </option>
          ))}
        </NativeSelect>
      </label>
      {result?.key !== search && (
        <p role="status" className="text-xs text-muted-foreground">
          尋找藥品中…
        </p>
      )}
      {result?.key === search && result.error && (
        <p role="alert" className="text-xs text-destructive">
          {result.error}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setAttempt((n) => n + 1)}
          >
            重試
          </button>
        </p>
      )}
      {result?.key === search && result.products?.length === 0 && (
        <p role="status" className="text-xs text-muted-foreground">
          沒有符合的藥品，請換個關鍵字。
        </p>
      )}
      {products.length === 50 && (
        <p className="text-xs text-muted-foreground">
          先列出 50 項，輸入關鍵字可找其他藥品。
        </p>
      )}
    </div>
  )
}

export function ReportBusinessDialog({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<BusinessView>("pharmacy_sales")
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [search, setSearch] = useState("")
  const [customerType, setCustomerType] =
    useState<BusinessQuery["customer_type"]>("all")
  const [product, setProduct] = useState<BusinessProduct | null>(null)
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<Result | null>(null)
  const [attempt, setAttempt] = useState(0)
  const body = useMemo<BusinessQuery>(
    () => ({
      view,
      start: start || null,
      end: end || null,
      sku: view === "product_orders" ? (product?.sku ?? null) : null,
      q: search.trim(),
      customer_type: view === "product_queries" ? "all" : customerType,
      page,
      page_size: 25,
    }),
    [view, start, end, product?.sku, search, customerType, page]
  )
  const key = JSON.stringify(body)
  const invalidDate = Boolean(start && end && start > end)
  const needsProduct = view === "product_orders" && !product
  useEffect(() => {
    if (invalidDate || needsProduct) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      getBusinessReport(body, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setResult({ key, data })
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setResult({
              key,
              error:
                error instanceof Error ? error.message : "分析資料載入失敗",
            })
        })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [body, key, attempt, invalidDate, needsProduct])
  const data = result?.key === key && "data" in result ? result.data : null
  const error = result?.key === key && "error" in result ? result.error : null
  const queries = view === "product_queries"
  const orders = view === "product_orders"
  function changeView(next: BusinessView) {
    setView(next)
    setSearch("")
    setPage(1)
  }
  const number = (value: number) => value.toLocaleString("zh-TW")

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>藥局與藥品分析</DialogTitle>
          <DialogDescription>
            查看各家業績、藥品查詢熱度與單品訂購分布。此分析使用下方條件，日期留空即查全部紀錄。
          </DialogDescription>
        </DialogHeader>
        <div
          role="group"
          aria-label="選擇分析項目"
          className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1"
        >
          {Object.entries(VIEWS).map(([id, label]) => (
            <button
              type="button"
              key={id}
              aria-pressed={view === id}
              onClick={() => changeView(id as BusinessView)}
              className={cn(
                "min-h-11 rounded-lg px-2 py-2 text-sm",
                view === id
                  ? "bg-background font-semibold text-primary shadow-sm"
                  : "text-muted-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="text-xs font-medium">
            起始日期
            <Input
              type="date"
              className="mt-1 h-11"
              value={start}
              max={end || undefined}
              onChange={(e) => {
                setStart(e.target.value)
                setPage(1)
              }}
            />
          </label>
          <label className="text-xs font-medium">
            結束日期
            <Input
              type="date"
              className="mt-1 h-11"
              value={end}
              min={start || undefined}
              onChange={(e) => {
                setEnd(e.target.value)
                setPage(1)
              }}
            />
          </label>
          <Button
            variant="outline"
            className="col-span-2 min-h-11 self-end sm:col-span-1"
            disabled={!start && !end}
            onClick={() => {
              setStart("")
              setEnd("")
              setPage(1)
            }}
          >
            全部期間
          </Button>
        </div>
        {invalidDate && (
          <p role="alert" className="text-sm text-destructive">
            起始日期不能晚於結束日期。
          </p>
        )}
        {orders && (
          <ProductPicker
            value={product}
            onChange={(p) => {
              setProduct(p)
              setPage(1)
            }}
          />
        )}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            aria-label={queries ? "搜尋查詢紀錄中的藥品" : "搜尋分析中的藥局"}
            placeholder={
              queries ? "搜尋品名、別名或料號" : "搜尋藥局／客戶名稱或編號"
            }
            maxLength={100}
            className="h-11 flex-1"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
          {!queries && (
            <NativeSelect
              aria-label="分析客戶類型"
              className="min-h-11 sm:w-56 sm:shrink-0"
              value={customerType}
              onChange={(e) => {
                setCustomerType(
                  e.target.value as BusinessQuery["customer_type"]
                )
                setPage(1)
              }}
            >
              <option value="all">全部客戶（含診所）</option>
              <option value="pharmacies">藥局（連鎖＋獨立）</option>
              {Object.entries(TYPES).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {queries
            ? "全員合計，每次點開商品的「規格與常用叫法」算 1 次；相同事件重送只計一次。只統計功能啟用後的紀錄，日期依台北時間計算。點選藥品可查看誰訂過。"
            : orders
              ? "只計已成交叫貨；同張訂單的重複品項合併計量，訂單數去重。數量使用所選藥品的單位。"
              : "依成交金額排序；每家客戶都會列出，期間內沒有成交則顯示 0。報價與訂單草稿不計入業績。"}
        </p>
        {needsProduct && (
          <p
            role="status"
            className="rounded-xl bg-muted p-6 text-center text-sm text-muted-foreground"
          >
            先搜尋並選擇一項藥品，即可看到哪些藥局訂過、各訂多少。
          </p>
        )}
        {!invalidDate && !needsProduct && !data && !error && (
          <p
            role="status"
            className="py-8 text-center text-sm text-muted-foreground"
          >
            載入分析資料中…
          </p>
        )}
        {!invalidDate && !needsProduct && error && (
          <div role="alert" className="rounded-xl border p-4 text-sm">
            <p>{error}</p>
            <Button
              variant="outline"
              className="mt-3 min-h-11"
              onClick={() => {
                setResult(null)
                setAttempt((n) => n + 1)
              }}
            >
              重新載入
            </Button>
          </div>
        )}
        {!invalidDate && !needsProduct && data && (
          <>
            {data.product && (
              <p className="text-sm font-semibold">
                {data.product.name}{" "}
                <span className="font-normal text-muted-foreground">
                  {data.product.sku} · {data.product.spec}
                </span>
              </p>
            )}
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                [
                  queries
                    ? "有查詢的藥品"
                    : orders
                      ? "訂購藥局／客戶"
                      : "藥局／客戶",
                  `${number(data.total)} ${queries ? "項" : "家"}`,
                ],
                [
                  queries ? "查詢次數" : orders ? "訂購數量" : "成交金額",
                  queries
                    ? `${number(data.totals.query_count ?? 0)} 次`
                    : orders
                      ? `${number(data.totals.quantity ?? 0)} ${data.product?.unit ?? ""}`
                      : formatMoney(data.totals.sales),
                ],
                [
                  queries ? "統計範圍" : orders ? "成交金額" : "成交訂單",
                  queries
                    ? "全員合計"
                    : orders
                      ? formatMoney(data.totals.sales)
                      : `${number(data.totals.order_count)} 張`,
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-xl border bg-muted/20 p-3 last:col-span-2 sm:last:col-span-1"
                >
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-base font-semibold break-words tabular-nums sm:text-xl">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {queries && data.tracked_since && (
              <p className="text-xs text-muted-foreground">
                最早查詢紀錄：
                {new Date(data.tracked_since).toLocaleString("zh-TW", {
                  timeZone: "Asia/Taipei",
                  hour12: false,
                })}{" "}
              </p>
            )}
            {data.rows.length === 0 ? (
              <p
                role="status"
                className="rounded-xl bg-muted py-8 text-center text-sm text-muted-foreground"
              >
                {queries
                  ? "此範圍尚無藥品明細查詢紀錄。"
                  : orders
                    ? "這項藥品在此範圍尚無成交訂購紀錄。"
                    : "沒有符合條件的藥局／客戶。"}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table
                  className={cn("w-full text-sm", !queries && "min-w-[580px]")}
                >
                  <caption className="sr-only">
                    {VIEWS[view]}；{start || "最早紀錄"} 至 {end || "最新紀錄"}
                  </caption>
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="p-3 text-left">
                        {queries ? "藥品／料號" : "藥局／客戶"}
                      </th>
                      {queries ? (
                        <th scope="col" className="p-3 text-right">
                          查詢次數
                        </th>
                      ) : (
                        <>
                          {orders && (
                            <th scope="col" className="p-3 text-right">
                              訂購數量
                            </th>
                          )}
                          <th scope="col" className="p-3 text-right">
                            成交金額
                          </th>
                          <th scope="col" className="p-3 text-right">
                            訂單數
                          </th>
                          <th scope="col" className="p-3 text-right">
                            最近叫貨日
                          </th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.rows.map((row) => (
                      <tr key={row.key}>
                        <th
                          scope="row"
                          className="max-w-64 p-3 text-left font-medium"
                        >
                          {queries ? (
                            <button
                              type="button"
                              className="min-h-11 text-left text-primary underline-offset-4 hover:underline"
                              onClick={() => {
                                setProduct({
                                  sku: row.key,
                                  name: row.name,
                                  spec: row.spec ?? "",
                                  unit: row.unit ?? "",
                                })
                                changeView("product_orders")
                              }}
                            >
                              {row.name}
                            </button>
                          ) : (
                            <Link
                              className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline"
                              to={`/customers/${encodeURIComponent(row.key)}`}
                            >
                              {row.name}
                            </Link>
                          )}
                          <p className="text-xs font-normal text-muted-foreground">
                            {row.key}
                            {queries
                              ? ` · ${row.spec ?? ""}`
                              : ` · ${TYPES[row.customer_type ?? ""] ?? "客戶"}`}
                          </p>
                        </th>
                        {queries ? (
                          <td className="p-3 text-right tabular-nums">
                            {number(row.query_count ?? 0)} 次
                          </td>
                        ) : (
                          <>
                            {orders && (
                              <td className="p-3 text-right whitespace-nowrap tabular-nums">
                                {number(row.quantity ?? 0)} {data.product?.unit}
                              </td>
                            )}
                            <td className="p-3 text-right whitespace-nowrap tabular-nums">
                              {formatMoney(row.sales)}
                            </td>
                            <td className="p-3 text-right tabular-nums">
                              {number(row.order_count)}
                            </td>
                            <td className="p-3 text-right whitespace-nowrap">
                              {row.last_order_date ?? "—"}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!queries && data.rows.length > 0 && (
              <p className="text-xs text-muted-foreground sm:hidden">
                表格可左右滑動，查看成交金額、訂單數與叫貨日期。
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                共 {number(data.total)} {queries ? "項" : "家"} · 第 {data.page}{" "}
                / {Math.max(1, Math.ceil(data.total / data.page_size))} 頁
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={data.page <= 1}
                  onClick={() => setPage(data.page - 1)}
                >
                  上一頁
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={data.page * data.page_size >= data.total}
                  onClick={() => setPage(data.page + 1)}
                >
                  下一頁
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
