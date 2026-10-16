import { useEffect, useState } from "react"
import { Check, ChevronLeft, ChevronRight, Search } from "lucide-react"
import {
  getOrderProducts,
  type OrderProduct,
  type OrderProductList,
  type OrderItemInput,
} from "@/api/orders"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { orderMoney } from "@/lib/orders"

export function OrderProducts({
  customerId,
  existing,
  onAdd,
  onClose,
}: {
  customerId: string
  existing: OrderItemInput[]
  onAdd: (items: OrderProduct[]) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<OrderProductList | null>(null)
  const [selected, setSelected] = useState<Record<string, OrderProduct>>({})
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setBusy(true)
      setError("")
      getOrderProducts(customerId, query.trim(), page, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setResult(value)
        })
        .catch((err) => {
          if (!controller.signal.aborted)
            setError(err instanceof Error ? err.message : "產品沒有載入")
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false)
        })
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [customerId, query, page, retry])
  const chosen = Object.values(selected)
  const existingSkus = new Set(existing.map((item) => item.sku))
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b p-5">
          <DialogTitle>新增產品</DialogTitle>
          <DialogDescription>
            從商品型錄選取產品，供貨價依這家客戶的類型帶入。
          </DialogDescription>
        </DialogHeader>
        <div className="p-4">
          <div className="relative">
            <Search className="absolute top-3 left-3 size-4 text-muted-foreground" />
            <Input
              aria-label="搜尋訂單產品"
              placeholder="搜尋產品名稱、料號或產品系列"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
              maxLength={100}
              className="h-11 pl-9"
            />
          </div>
          <p role="status" className="mt-3 text-xs text-muted-foreground">
            已選 {chosen.length} 項 · 訂單目前 {existing.length} 項／最多 100 項{" "}
            {busy && "· 搜尋中…"}
          </p>
        </div>
        <div className="min-h-40 flex-1 overflow-auto px-4" aria-busy={busy}>
          {error ? (
            <div role="alert" className="py-6 text-sm">
              {error}
              <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
                重新載入
              </Button>
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="w-10 p-3">
                    <span className="sr-only">選取</span>
                  </th>
                  <th className="p-3">產品／料號</th>
                  <th className="hidden p-3 sm:table-cell">系列與規格</th>
                  <th className="p-3 text-right">供貨單價</th>
                </tr>
              </thead>
              <tbody>
                {result?.items.map((product) => {
                  const added = existingSkus.has(product.sku),
                    checked = added || !!selected[product.sku]
                  return (
                    <tr key={product.sku} className="border-b">
                      <td className="p-3">
                        <input
                          type="checkbox"
                          aria-label={`選取 ${product.name}`}
                          checked={checked}
                          disabled={
                            added ||
                            (!checked &&
                              chosen.length + existing.length >= 100) ||
                            busy
                          }
                          onChange={() =>
                            setSelected((current) => {
                              const next = { ...current }
                              if (next[product.sku]) delete next[product.sku]
                              else next[product.sku] = product
                              return next
                            })
                          }
                          className="size-5 accent-primary"
                        />
                      </td>
                      <td className="py-3 pr-3">
                        <label className="font-medium">{product.name}</label>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {product.sku}
                          {added && " · 已加入"}
                        </p>
                      </td>
                      <td className="hidden p-3 text-xs text-muted-foreground sm:table-cell">
                        {product.category}
                        <br />
                        {product.spec} · {product.unit}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap tabular-nums">
                        {orderMoney(product.unit_price)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {!busy && !error && result?.items.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              找不到符合條件的產品，試試其他名稱或料號。
            </p>
          )}
        </div>
        <div className="flex items-center justify-between border-t px-4 py-3 text-xs">
          <span>
            共 {result?.total ?? 0} 項產品 · 第 {page} 頁
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="上一頁產品"
              disabled={page === 1 || busy}
              onClick={() => setPage((n) => n - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="下一頁產品"
              disabled={
                busy || !result || page * result.page_size >= result.total
              }
              onClick={() => setPage((n) => n + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={!chosen.length || busy}
            onClick={() => onAdd(chosen)}
          >
            <Check className="size-4" />
            加入 {chosen.length || "所選"} 項產品
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
