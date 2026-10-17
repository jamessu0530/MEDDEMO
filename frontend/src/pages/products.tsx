import { useAskPageContext } from "@/ask/use-page-context"
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { ChevronLeft, ChevronRight, Search, Sparkles } from "@/components/icons"

import { listProducts, type Product } from "@/api/products"
import { Notice } from "@/components/notice"
import { ProductPhoto } from "@/components/product-photo"
import { ContextHelp } from "@/components/context-help"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { catalogProducts } from "@/lib/product-search"
import {
  discoverProducts,
  horizontalSwap,
  PRODUCT_BATCH,
} from "@/lib/product-discovery"
import { useProductBrowsing } from "@/lib/use-product-browsing"
import { FIXED_COLUMN } from "@/lib/desktop-layout"
import { cn } from "@/lib/utils"
import "./product-discovery.css"

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; products: Product[] }

/** 頁內的完整商品型錄：品項與 AI 查詢讀同一份資料。 */
export function ProductsPanel({
  heading,
  navigation,
  active = true,
}: {
  heading?: ReactNode
  navigation: ReactNode
  active?: boolean
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const [limit, setLimit] = useState(PRODUCT_BATCH)
  const [selection, setSelection] = useState<{
    key: string
    seed: string
    order: string[]
    direction: "left" | "right"
  } | null>(null)
  const [idle, setIdle] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; captured: boolean } | null>(null)
  const anchor = useRef<{ index: number; top: number } | null>(null)
  const filterKey = `${query}\u0000${category ?? ""}`

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
  const ordered = useMemo(() => {
    if (!selection || selection.key !== filterKey) return found
    const bySku = new Map(found.map((product) => [product.sku, product]))
    return selection.order.flatMap((sku) =>
      bySku.has(sku) ? [bySku.get(sku)!] : []
    )
  }, [found, selection, filterKey])
  useAskPageContext({ title: `${category || "全部商品"}${query.trim() ? ` · ${query.trim()}` : ""} · 商品型錄`, facts: [
    `商品分類：${category || "全部"}`, `搜尋：${query.trim() || "無"}`,
    ...(state.status === "ready" ? [`符合篩選共 ${found.length} 項商品`, ...(found.length === 1 ? [`唯一符合商品：${found[0].name}（料號 ${found[0].sku}）`] : [])] : ["商品資料尚未載入"]),
  ] }, active)
  const browsing = useProductBrowsing(
    listRef,
    active,
    `${products.length}/${filterKey}/${limit}/${selection?.seed ?? ""}`
  )
  const shown = ordered.slice(0, limit)

  useEffect(() => {
    const node = sentinelRef.current
    if (!active || !node || limit >= ordered.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          setLimit((count) => Math.min(count + PRODUCT_BATCH, ordered.length))
      },
      { rootMargin: "600px" }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [active, limit, ordered.length, state.status])

  useEffect(() => {
    if (!active) return
    let timer = window.setTimeout(() => setIdle(true), 4000)
    const scrolling = () => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), 4000)
    }
    window.addEventListener("scroll", scrolling, { passive: true })
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("scroll", scrolling)
    }
  }, [active, filterKey, selection?.seed])

  useLayoutEffect(() => {
    const saved = anchor.current
    const node = saved && listRef.current?.children[saved.index]
    if (node && saved)
      window.scrollBy({
        top: node.getBoundingClientRect().top - saved.top,
        behavior: "instant",
      })
    anchor.current = null
  }, [selection])

  function swap(direction: "left" | "right") {
    if (found.length < 2) return
    const nodes = [...(listRef.current?.children ?? [])]
    const headerBottom =
      listRef.current
        ?.closest("[data-product-panel]")
        ?.querySelector("header")
        ?.getBoundingClientRect().bottom ?? 0
    const index = nodes.findIndex(
      (node) => node.getBoundingClientRect().bottom > headerBottom
    )
    if (index >= 0)
      anchor.current = { index, top: nodes[index].getBoundingClientRect().top }
    const visibleSkus = nodes
      .filter((node) => {
        const rect = node.getBoundingClientRect()
        return rect.bottom > headerBottom && rect.top < window.innerHeight
      })
      .map((node) => (node as HTMLElement).dataset.productSku!)
    const seed = crypto.randomUUID()
    const nextOrder = discoverProducts(
      found,
      browsing.profile(),
      seed,
      visibleSkus
    ).map((product) => product.sku)
    // 搜尋結果很少時，也確保這次換批真的有換順序。
    if (nextOrder.every((sku, i) => sku === ordered[i]?.sku))
      nextOrder.push(nextOrder.shift()!)
    setSelection({
      key: filterKey,
      seed,
      direction,
      order: nextOrder,
    })
    setIdle(false)
  }

  function retry() {
    setState({ status: "loading" })
    setAttempt((n) => n + 1)
  }

  function clear() {
    setQuery("")
    setCategory(null)
    setLimit(PRODUCT_BATCH)
    setSelection(null)
  }

  return (
    <div data-product-panel className="flex min-h-svh flex-col">
      <header className={cn("sticky top-0 z-10 border-b bg-background/95 px-4 backdrop-blur", heading ? "py-5 lg:px-6" : "pt-4 pb-3")}>
        {heading ?? <h1 className="mt-0.5 text-xl font-semibold">商品與促銷</h1>}
        {navigation}
        {state.status === "ready" && (
          <>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setLimit(PRODUCT_BATCH)
                  setSelection(null)
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
                      setLimit(PRODUCT_BATCH)
                      setSelection(null)
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

      <main className="flex-1 overflow-x-clip px-4 pt-3 pb-32">
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
            <div className="mb-3 flex items-center justify-between gap-2">
              <p role="status" className="text-xs text-muted-foreground">
                {query.trim() || category
                  ? `找到 ${found.length.toLocaleString()} 個品項`
                  : `共 ${products.length.toLocaleString()} 個品項`}
                {found.length > 0 && ` · 已顯示 ${shown.length} 個`}
                {shown.length < ordered.length && "，往下看更多"}
                {selection && " · 換了一批商品"}
              </p>
              <ContextHelp label="商品瀏覽與推薦方式">
                <p>
                  往下捲動會自動載入更多商品；左右滑會將整排商品換一批，也可以先聚焦商品清單再按左右方向鍵。會依登入帳號記錄前景中商品的有效停留時間與主動展開紀錄，用來調整之後換批的排序。閒置、背景與熊熊滾示範不計入；滑動方向不代表喜歡或不喜歡。
                </p>
              </ContextHelp>
            </div>
            {found.length === 0 && (
              <Notice
                text="沒有符合搜尋條件的商品。"
                action={{ label: "清除篩選", onClick: clear }}
              />
            )}
            <div
              role="group"
              aria-label="商品清單，可往下瀏覽或左右滑換一批"
              tabIndex={0}
              className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onDragStart={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (
                  event.target !== event.currentTarget ||
                  !["ArrowLeft", "ArrowRight"].includes(event.key)
                )
                  return
                event.preventDefault()
                swap(event.key === "ArrowLeft" ? "left" : "right")
              }}
              onPointerDown={(event) => {
                if (
                  event.button !== 0 ||
                  !event.isPrimary ||
                  (event.target as HTMLElement).closest(
                    "button,input,select,textarea,a,summary"
                  )
                )
                  return
                drag.current = {
                  x: event.clientX,
                  y: event.clientY,
                  captured: false,
                }
              }}
              onPointerMove={(event) => {
                const start = drag.current
                if (
                  start &&
                  horizontalSwap(
                    event.clientX - start.x,
                    event.clientY - start.y
                  )
                ) {
                  if (!start.captured) {
                    event.currentTarget.setPointerCapture(event.pointerId)
                    start.captured = true
                  }
                  event.preventDefault()
                }
              }}
              onPointerCancel={() => {
                drag.current = null
              }}
              onPointerUp={(event) => {
                const start = drag.current
                drag.current = null
                if (!start) return
                const direction = horizontalSwap(
                  event.clientX - start.x,
                  event.clientY - start.y
                )
                if (direction) {
                  event.preventDefault()
                  swap(direction)
                }
              }}
              style={{ touchAction: "pan-y" }}
            >
              <ul
                ref={listRef}
                key={selection?.seed ?? "original"}
                className={cn(
                  "catalog-product-list grid grid-cols-1 gap-3 sm:grid-cols-2",
                  selection && `catalog-swap-${selection.direction}`
                )}
              >
                {shown.map((product) => (
                  <li
                    key={product.sku}
                    data-product-sku={product.sku}
                    className="rounded-xl border-2 bg-card px-4 py-3 shadow-lip"
                  >
                    <div className="flex items-start gap-3 sm:gap-4">
                      <ProductPhoto product={product} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="min-w-0 leading-snug font-medium">
                            {product.name}
                          </p>
                          <Badge variant="secondary" className="shrink-0">
                            {product.category}
                          </Badge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {product.sku} · {product.unit}
                        </p>
                        <details
                          className="mt-3 border-t pt-2"
                          onToggle={(event) => {
                            if (event.currentTarget.open)
                              browsing.open(product.sku)
                          }}
                        >
                          <summary className="min-h-8 cursor-pointer text-xs font-medium text-primary">
                            規格與常用叫法
                          </summary>
                          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <dt className="text-muted-foreground">料號</dt>
                              <dd className="mt-0.5 font-medium break-all">
                                {product.sku}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">單位</dt>
                              <dd className="mt-0.5 font-medium">
                                {product.unit}
                              </dd>
                            </div>
                            {product.spec && (
                              <div className="col-span-2">
                                <dt className="text-muted-foreground">規格</dt>
                                <dd className="mt-0.5">{product.spec}</dd>
                              </div>
                            )}
                            {product.aliases.length > 0 && (
                              <div className="col-span-2">
                                <dt className="text-muted-foreground">
                                  常用叫法
                                </dt>
                                <dd className="mt-0.5">
                                  {product.aliases.join("、")}
                                </dd>
                              </div>
                            )}
                          </dl>
                        </details>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div
              ref={sentinelRef}
              className="flex min-h-16 items-center justify-center text-xs text-muted-foreground"
            >
              {shown.length < ordered.length
                ? "往下繼續看…"
                : ordered.length > 0
                  ? "已看到這批的最後，左右滑再換一批看看"
                  : ""}
            </div>
            {active && idle && found.length > 1 && (
              <div
                className={cn(
                  FIXED_COLUMN,
                  "pointer-events-none bottom-22 z-20 flex justify-center px-4"
                )}
              >
                <div className="flex w-fit max-w-full items-center gap-1 rounded-full border-2 border-primary/20 bg-card/95 p-1 shadow-lg backdrop-blur">
                  <Button
                    className="pointer-events-auto rounded-full"
                    variant="ghost"
                    size="icon"
                    aria-label="向左換一排商品"
                    onClick={() => swap("left")}
                  >
                    <ChevronLeft className="size-5" />
                  </Button>
                  <span className="flex items-center gap-1 text-xs font-medium text-primary">
                    <Sparkles className="size-3.5" />
                    左右滑，換一排看看
                  </span>
                  <Button
                    className="pointer-events-auto rounded-full"
                    variant="ghost"
                    size="icon"
                    aria-label="向右換一排商品"
                    onClick={() => swap("right")}
                  >
                    <ChevronRight className="size-5" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
