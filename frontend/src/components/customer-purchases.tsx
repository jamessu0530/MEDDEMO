import { useEffect, useState } from "react"

import { getPurchasedProducts, type PurchasedProduct } from "@/api/customers"
import { Search } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { matchesPurchasedProduct } from "@/lib/customer-purchases"
import { formatDate } from "@/lib/format"

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; products: PurchasedProduct[] }

export function CustomerPurchases({ customerId }: { customerId: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getPurchasedProducts(customerId, controller.signal)
      .then((products) => {
        if (!controller.signal.aborted) setState({ status: "ready", products })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => controller.abort()
  }, [customerId, attempt])

  const products = state.status === "ready" ? state.products : []
  const matches = products.filter((product) =>
    matchesPurchasedProduct(product, query)
  )
  const visible = expanded || query.trim() ? matches : matches.slice(0, 6)

  return (
    <section
      aria-labelledby="customer-purchases-title"
      className="rounded-2xl border-2 bg-card p-4 shadow-lip"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="customer-purchases-title" className="text-sm font-semibold">
          這家叫過什麼
        </h2>
        {state.status === "ready" && (
          <span className="text-xs text-muted-foreground">
            共 {products.length} 項
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        按累計叫貨量由多到少，自動整理這家常叫的品項。
      </p>
      {state.status === "loading" && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          載入叫貨品項中…
        </p>
      )}
      {state.status === "error" && (
        <div
          role="alert"
          className="mt-3 flex items-center justify-between gap-3 text-sm text-muted-foreground"
        >
          叫貨品項沒有載入。
          <Button
            variant="ghost"
            className="min-h-11 text-primary"
            onClick={() => {
              setState({ status: "loading" })
              setAttempt((n) => n + 1)
            }}
          >
            重新載入
          </Button>
        </div>
      )}
      {state.status === "ready" && products.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          這家尚無成交叫貨紀錄。
        </p>
      )}
      {products.length > 0 && (
        <>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="搜尋這家叫過的品項"
              placeholder="搜尋品名、別名、品類或料號"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={100}
              className="h-11 pl-9"
            />
          </div>
          <ul className="mt-2 divide-y">
            {visible.map((product) => (
              <li key={product.sku} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm font-medium text-primary">
                  <p>{product.name}</p>
                  <span>
                    累計 {product.total_qty} {product.unit}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {product.sku} · {product.spec}
                </p>
                <div className="mt-1 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>最近叫貨 {formatDate(product.last_order_date)}</span>
                  <span>叫過 {product.order_count} 次</span>
                </div>
              </li>
            ))}
          </ul>
          {matches.length === 0 && (
            <p role="status" className="py-4 text-sm text-muted-foreground">
              沒有符合「{query.trim()}」的叫貨品項。
            </p>
          )}
          {visible.length < matches.length && (
            <Button
              variant="ghost"
              className="min-h-11 px-0 text-primary"
              onClick={() => setExpanded(true)}
            >
              查看其餘 {matches.length - visible.length} 項
            </Button>
          )}
          {expanded && !query.trim() && products.length > 6 && (
            <Button
              variant="ghost"
              className="min-h-11 px-0 text-primary"
              onClick={() => setExpanded(false)}
            >
              收合品項
            </Button>
          )}
        </>
      )}
    </section>
  )
}
