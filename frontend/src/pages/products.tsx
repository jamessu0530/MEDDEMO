import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Search } from "lucide-react"

import { listProducts, type Product } from "@/api/products"
import { BottomNav } from "@/components/bottom-nav"
import { CatalogNav } from "@/components/catalog-nav"
import { Notice } from "@/components/notice"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { catalogProducts } from "@/lib/product-search"
import { cn } from "@/lib/utils"

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; products: Product[] }
const PAGE_SIZE = 30

/** 完整商品型錄：和促銷頁一樣直接翻查，品項與 AI 查詢讀同一份資料。 */
export function ProductsPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listProducts(controller.signal)
      .then((products) => setState({ status: "ready", products }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => controller.abort()
  }, [attempt])

  const products = useMemo(
    () => (state.status === "ready" ? state.products : []),
    [state]
  )
  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const product of products)
      counts.set(product.category, (counts.get(product.category) ?? 0) + 1)
    return [...counts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-TW"))
  }, [products])
  const found = useMemo(
    () => catalogProducts(products, query, category),
    [products, query, category]
  )
  const pages = Math.max(1, Math.ceil(found.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages - 1)
  const start = currentPage * PAGE_SIZE

  function retry() {
    setState({ status: "loading" })
    setAttempt((n) => n + 1)
  }

  function clear() {
    setQuery("")
    setCategory(null)
    setPage(0)
  }

  function turnPage(next: number) {
    setPage(next)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 pt-4 pb-3 backdrop-blur">
        <p className="text-xs text-muted-foreground">
          完整商品型錄，依品名、料號或類別查詢
        </p>
        <h1 className="mt-0.5 text-lg font-semibold">商品</h1>
        <CatalogNav />
        {state.status === "ready" && (
          <>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setPage(0)
                }}
                placeholder="搜尋品名、料號或規格"
                aria-label="搜尋商品品名、料號、規格或別名"
                className="h-11 bg-card pl-9"
              />
            </div>
            <div
              aria-label="商品類別"
              className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1.5"
            >
              {[{ name: null, count: products.length }, ...categories].map(
                ({ name, count }) => (
                  <button
                    key={name ?? "all"}
                    type="button"
                    aria-pressed={category === name}
                    onClick={() => {
                      setCategory(name)
                      setPage(0)
                    }}
                    className={cn(
                      "min-h-11 shrink-0 press rounded-full border-2 px-3 text-sm",
                      category === name
                        ? "border-primary bg-primary text-primary-foreground shadow-lip-primary"
                        : "bg-card text-muted-foreground shadow-lip"
                    )}
                  >
                    {name ?? "全部"} · {count.toLocaleString()}
                  </button>
                )
              )}
            </div>
          </>
        )}
      </header>

      <main className="flex-1 px-4 pt-3 pb-20">
        {state.status === "loading" && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            載入商品型錄中…
          </p>
        )}
        {state.status === "error" && (
          <Notice
            text="連不上伺服器，商品型錄沒有載入。"
            action={{ label: "重新載入", onClick: retry }}
          />
        )}
        {state.status === "ready" && products.length === 0 && (
          <Notice text="目前還沒有商品資料。" />
        )}
        {state.status === "ready" && products.length > 0 && (
          <>
            <p role="status" className="mb-3 text-xs text-muted-foreground">
              {query.trim() || category
                ? `找到 ${found.length.toLocaleString()} 個品項`
                : `共 ${products.length.toLocaleString()} 個品項`}
              {found.length > 0 &&
                ` · 顯示 ${start + 1}–${Math.min(start + PAGE_SIZE, found.length)}`}
            </p>
            {found.length === 0 && (
              <Notice
                text="沒有符合搜尋條件的商品。"
                action={{ label: "清除篩選", onClick: clear }}
              />
            )}
            <ul className="flex flex-col gap-2">
              {found.slice(start, start + PAGE_SIZE).map((product) => (
                <li
                  key={product.sku}
                  className="rounded-xl border-2 bg-card px-4 py-3 shadow-lip"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 leading-snug font-medium">
                      {product.name}
                    </p>
                    <Badge variant="secondary" className="shrink-0">
                      {product.category}
                    </Badge>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 border-t pt-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">料號</dt>
                      <dd className="mt-0.5 font-medium break-all">
                        {product.sku}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">單位</dt>
                      <dd className="mt-0.5 font-medium">{product.unit}</dd>
                    </div>
                    {product.spec && (
                      <div className="col-span-2">
                        <dt className="text-muted-foreground">規格</dt>
                        <dd className="mt-0.5">{product.spec}</dd>
                      </div>
                    )}
                    {product.aliases.length > 0 && (
                      <div className="col-span-2">
                        <dt className="text-muted-foreground">常用叫法</dt>
                        <dd className="mt-0.5">{product.aliases.join("、")}</dd>
                      </div>
                    )}
                  </dl>
                </li>
              ))}
            </ul>
            {pages > 1 && (
              <nav
                aria-label="商品分頁"
                className="mt-4 flex items-center justify-between gap-2"
              >
                <Button
                  variant="outline"
                  className="h-11"
                  disabled={currentPage === 0}
                  onClick={() => turnPage(currentPage - 1)}
                >
                  <ChevronLeft className="size-4" />
                  上一頁
                </Button>
                <span className="text-xs text-muted-foreground">
                  {currentPage + 1} / {pages} 頁
                </span>
                <Button
                  variant="outline"
                  className="h-11"
                  disabled={currentPage === pages - 1}
                  onClick={() => turnPage(currentPage + 1)}
                >
                  下一頁
                  <ChevronRight className="size-4" />
                </Button>
              </nav>
            )}
          </>
        )}
      </main>
      <BottomNav />
    </div>
  )
}
