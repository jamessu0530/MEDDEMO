import { useEffect, useId, useRef, useState } from "react"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  PackageSearch,
  X,
} from "@/components/icons"
import {
  getOrderProducts,
  type OrderProduct,
  type OrderProductList,
  type OrderItemInput,
} from "@/api/orders"
import { ProductPhoto } from "@/components/product-photo"
import { Button } from "@/components/ui/button"
import { SearchField } from "@/components/ui/search-field"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { orderMoney } from "@/lib/orders"
import { cn } from "@/lib/utils"

export function OrderProducts({
  practice = false,
  customerId,
  existing,
  onAdd,
  onClose,
}: {
  practice?: boolean
  customerId: string
  existing: OrderItemInput[]
  onAdd: (items: OrderProduct[]) => void
  onClose: () => void
}) {
  const id = useId(),
    pageCheckbox = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1)
  const [result, setResult] = useState<OrderProductList | null>(null)
  const [selected, setSelected] = useState<Record<string, OrderProduct>>({})
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0)
  const [selectedOnly, setSelectedOnly] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const request = getOrderProducts(
        customerId,
        query.trim(),
        page,
        controller.signal
      )
      request
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
  const chosen = Object.values(selected),
    existingSkus = new Set(existing.map((item) => item.sku))
  const capacity = Math.max(0, 100 - existing.length)
  const pageItems = (result?.items ?? []).filter(
    (item) => !existingSkus.has(item.sku)
  )
  const pageSelected = pageItems.filter((item) => selected[item.sku]).length
  const allPage = pageItems.length > 0 && pageSelected === pageItems.length
  const pageAddCount = Math.min(
    capacity - chosen.length,
    pageItems.length - pageSelected
  )
  useEffect(() => {
    if (pageCheckbox.current)
      pageCheckbox.current.indeterminate = pageSelected > 0 && !allPage
  }, [pageSelected, allPage, selectedOnly])
  function toggle(product: OrderProduct) {
    setSelected((current) => {
      const next = { ...current }
      if (next[product.sku]) delete next[product.sku]
      else if (
        Object.keys(next).length < capacity &&
        !existingSkus.has(product.sku)
      )
        next[product.sku] = product
      return next
    })
  }
  function changeQuery(value: string) {
    setQuery(value)
    setPage(1)
    setBusy(true)
    setError("")
  }
  function changePage(value: number) {
    setPage(value)
    setBusy(true)
    setError("")
  }
  function togglePage() {
    setSelected((current) => {
      const next = { ...current }
      if (allPage) pageItems.forEach((item) => delete next[item.sku])
      else
        for (const item of pageItems) {
          if (Object.keys(next).length >= capacity) break
          next[item.sku] = item
        }
      return next
    })
  }
  const visible = selectedOnly ? chosen : (result?.items ?? [])
  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent aria-describedby={undefined} className="flex h-[min(48rem,90dvh)] max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
            <DialogTitle>新增產品</DialogTitle>
          </DialogHeader>
          <div className="shrink-0 space-y-3 border-b p-4">
            {!selectedOnly && (
              <SearchField
                aria-label="搜尋訂單產品"
                placeholder="搜尋產品名稱、料號或產品系列"
                value={query}
                onValueChange={changeQuery}
                loading={busy}
              />
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex gap-1 rounded-xl bg-muted p-1 text-sm">
                <button
                  type="button"
                  aria-pressed={!selectedOnly}
                  onClick={() => setSelectedOnly(false)}
                  className={cn(
                    "min-h-10 rounded-lg px-3",
                    !selectedOnly && "bg-card font-semibold shadow-sm"
                  )}
                >
                  商品型錄
                </button>
                <button
                  type="button"
                  aria-pressed={selectedOnly}
                  onClick={() => setSelectedOnly(true)}
                  className={cn(
                    "min-h-10 rounded-lg px-3",
                    selectedOnly && "bg-card font-semibold shadow-sm"
                  )}
                >
                  已選清單（{chosen.length}）
                </button>
              </div>
            </div>
            {!selectedOnly && chosen.length > 0 && (
              <div
                className="flex items-center gap-2 overflow-x-auto pb-1"
                aria-label="已選產品摘要"
              >
                {chosen.slice(0, 3).map((product) => (
                  <button
                    type="button"
                    key={product.sku}
                    aria-label={`取消 ${product.name}`}
                    onClick={() => toggle(product)}
                    className="flex min-h-9 max-w-48 shrink-0 items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-2 text-xs text-primary"
                  >
                    <span className="truncate">{product.name}</span>
                    <X aria-hidden className="size-3 shrink-0" />
                  </button>
                ))}
                {chosen.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setSelectedOnly(true)}
                    className="min-h-9 shrink-0 text-xs text-primary"
                  >
                    查看全部 {chosen.length} 項
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2 text-xs">
              {selectedOnly ? (
                <>
                  <span>已選 {chosen.length} 項，尚未加入訂單</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!chosen.length}
                    onClick={() => setSelected({})}
                  >
                    清除全部
                  </Button>
                </>
              ) : (
                <label className="flex min-h-9 items-center gap-2">
                  <input
                    ref={pageCheckbox}
                    type="checkbox"
                    aria-label="選取本頁產品"
                    checked={allPage}
                    disabled={
                      busy ||
                      !!error ||
                      !pageItems.length ||
                      (!allPage && pageAddCount === 0)
                    }
                    onChange={togglePage}
                    className="size-4 accent-primary"
                  />
                  <span>
                    {allPage
                      ? "取消本頁選取"
                      : `選取本頁${pageAddCount < pageItems.length - pageSelected ? `前 ${pageAddCount}` : ""}產品`}
                  </span>
                </label>
              )}
              <span className="hidden sm:inline">照片與規格</span>
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto px-4"
              aria-busy={!selectedOnly && busy}
            >
              {!selectedOnly && error ? (
                <div
                  role="alert"
                  className="space-y-4 py-10 text-center text-sm"
                >
                  <p>{error}</p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setBusy(true)
                      setError("")
                      setRetry((n) => n + 1)
                    }}
                  >
                    重新載入
                  </Button>
                </div>
              ) : !selectedOnly && busy ? (
                <p
                  role="status"
                  className="py-16 text-center text-sm text-muted-foreground"
                >
                  正在搜尋產品…
                </p>
              ) : visible.length ? (
                <ul
                  className="divide-y"
                  aria-label={selectedOnly ? "已選產品" : "產品搜尋結果"}
                >
                  {visible.map((product) => {
                    const added = existingSkus.has(product.sku),
                      checked = added || !!selected[product.sku]
                    const blocked =
                      added || (!checked && chosen.length >= capacity)
                    return (
                      <li
                        key={product.sku}
                        className={cn(
                          "flex items-center gap-2 rounded-xl px-1 py-2 transition-colors sm:gap-4",
                          checked && "bg-primary/5"
                        )}
                      >
                        <label
                          htmlFor={`${id}-${product.sku}`}
                          className={cn(
                            "flex min-h-20 min-w-0 flex-1 cursor-pointer items-center gap-3 py-2 sm:gap-4",
                            blocked && "cursor-default opacity-60"
                          )}
                        >
                          <input
                            id={`${id}-${product.sku}`}
                            type="checkbox"
                            data-ui-demo={
                              practice ? "practice-product" : undefined
                            }
                            aria-label={`選取 ${product.name}`}
                            checked={checked}
                            disabled={blocked}
                            onChange={() => toggle(product)}
                            className="size-5 shrink-0 accent-primary"
                          />
                          <ProductPhoto
                            product={product}
                            size="default"
                            showSource={false}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm leading-relaxed font-medium break-words">
                              {product.name}
                            </span>
                            <span className="mt-1 block text-xs break-all text-muted-foreground">
                              {product.sku}
                              {added && " · 訂單已有"}
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {[product.category, product.spec, product.unit]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                            <span className="mt-1 block text-sm font-medium text-primary tabular-nums sm:hidden">
                              {orderMoney(product.unit_price)}
                            </span>
                          </span>
                          <span className="hidden shrink-0 text-right text-sm font-medium tabular-nums sm:block">
                            {orderMoney(product.unit_price)}
                            <span className="mt-1 block text-xs font-normal text-muted-foreground">
                              ／{product.unit || "單位"}
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <PackageSearch
                    aria-hidden
                    className="size-10 text-muted-foreground"
                  />
                  <p className="text-sm font-medium">
                    {selectedOnly ? "尚未選取產品" : "找不到符合條件的產品"}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() =>
                      selectedOnly ? setSelectedOnly(false) : changeQuery("")
                    }
                  >
                    {selectedOnly ? "瀏覽商品型錄" : "清除搜尋"}
                  </Button>
                </div>
              )}
            </div>
          </div>
          {!selectedOnly && (
            <div className="flex shrink-0 items-center justify-between border-t px-4 py-2 text-xs">
              <span>
                {busy
                  ? "查詢中…"
                  : `第 ${page}／${Math.max(1, Math.ceil((result?.total ?? 0) / (result?.page_size ?? 25)))} 頁`}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="上一頁產品"
                  disabled={page === 1 || busy}
                  onClick={() => changePage(page - 1)}
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
                  onClick={() => changePage(page + 1)}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-muted/30 p-4">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button
              data-ui-demo={practice ? "practice-confirm-products" : undefined}
              disabled={!chosen.length}
              onClick={() => onAdd(chosen)}
            >
              <Check aria-hidden className="size-4" />
              加入 {chosen.length || "所選"} 項產品
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
