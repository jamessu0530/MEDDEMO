import { useEffect, useState } from "react"

import { ApiError } from "@/api/client"
import {
  getFeaturedSettings,
  saveFeaturedProducts,
  type FeaturedSettings,
} from "@/api/featured-products"
import { listProducts, type Product } from "@/api/products"
import { useAskPageContext } from "@/ask/use-page-context"
import { ProductPhoto } from "@/components/product-photo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useProductSearch } from "@/lib/use-product-search"
import { catalogProducts } from "@/lib/product-search"

const PAGE_SIZE = 40

/** 主推設定按主管與節慶分開保存，切換前需儲存或還原目前的勾選。 */
export function FeaturedProductsPanel() {
  const [managerId, setManagerId] = useState<string>()
  const [festivalId, setFestivalId] = useState<string>()
  const [settings, setSettings] = useState<FeaturedSettings | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("")
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const dirty =
    settings !== null &&
    JSON.stringify(selected) !== JSON.stringify(settings.skus)
  const festival = settings?.festivals.find(
    (f) => f.id === settings.festival_id
  )
  const manager = settings?.managers.find((m) => m.id === settings.manager_id)
  const selectedSet = new Set(selected)
  const categories = [...new Set(products.map((p) => p.category))].sort()
  const search = useProductSearch(query, !loading)
  const bySku = new Map(products.map((product) => [product.sku, product]))
  const matches = search.skus !== null
    ? search.skus.flatMap((sku) => {
        const product = bySku.get(sku)
        return product && (!category || product.category === category) ? [product] : []
      })
    : catalogProducts(products, query, category || null)
  const names = new Map(products.map((p) => [p.sku, p.name]))
  useAskPageContext({
    facts: [
      ...(manager ? [`設定團隊：${manager.name}`] : []),
      ...(festival ? [`主推檔期：${festival.name}（${festival.date}）`] : []),
      `已勾選 ${selected.length} 個主推品項${dirty ? "，尚未儲存" : ""}`,
    ],
  })

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      getFeaturedSettings(managerId, festivalId, controller.signal),
      listProducts(controller.signal),
    ])
      .then(([data, catalog]) => {
        if (controller.signal.aborted) return
        setSettings(data)
        setProducts(catalog)
        setSelected(data.skus)
        setLoading(false)
        setError(null)
        setConflict(false)
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            e instanceof Error ? e.message : "主推品項沒有載入，請再試一次"
          )
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [managerId, festivalId, attempt])

  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [dirty])

  function toggle(sku: string) {
    if (!settings || busy) return
    setSelected((current) =>
      current.includes(sku)
        ? current.filter((value) => value !== sku)
        : current.length < settings.max_products
          ? [...current, sku]
          : current
    )
    setNotice(null)
  }

  async function save() {
    if (!settings?.festival_id || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const data = await saveFeaturedProducts(settings, selected)
      setSettings(data)
      setSelected(data.skus)
      setConflict(false)
      setNotice(
        data.skus.length
          ? "已儲存，團隊的談判卡會優先顯示這些品項。"
          : "已清除這一檔的指定主推品項。"
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存失敗，請再試一次")
      setConflict(e instanceof ApiError && e.status === 409)
    } finally {
      setBusy(false)
    }
  }

  function reload() {
    setLoading(true)
    setSettings(null)
    setNotice(null)
    setAttempt((value) => value + 1)
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <p className="text-sm leading-relaxed text-muted-foreground">
        選擇這一檔要主推的單一品項。儲存後，{manager?.name ?? "經理"}
        團隊客戶的談判卡會把指定品項放在最前面，列出供貨價與我方毛利。
      </p>
      {loading && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          載入主推設定與商品中…
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          <p>{error}</p>
          <Button variant="outline" disabled={busy} onClick={reload}>
            {settings ? "重新載入已儲存設定" : "重新載入"}
          </Button>
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl bg-primary/10 p-3 text-sm text-primary"
        >
          {notice}
        </p>
      )}
      {!loading && settings && (
        <>
          <div className="grid gap-3 rounded-2xl border-2 bg-card p-4 shadow-lip sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              團隊主管
              <NativeSelect
                value={settings.manager_id}
                disabled={busy || dirty || settings.managers.length < 2}
                onChange={(e) => {
                  setLoading(true)
                  setManagerId(e.target.value)
                  setFestivalId(settings.festival_id ?? undefined)
                  setNotice(null)
                }}
              >
                {settings.managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              節慶檔期
              <NativeSelect
                value={settings.festival_id ?? ""}
                disabled={busy || dirty || !settings.festival_id}
                onChange={(e) => {
                  setLoading(true)
                  setManagerId(settings.manager_id)
                  setFestivalId(e.target.value)
                  setNotice(null)
                }}
              >
                {!settings.festival_id && (
                  <option value="">尚未設定後續節慶</option>
                )}
                {settings.festivals.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} · {f.date}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              {dirty
                ? "有尚未儲存的勾選，請先儲存或還原後再切換團隊與檔期。"
                : "談判卡使用下一個節慶的主推設定；也可以提前設定之後的檔期。"}
            </p>
          </div>
          {!settings.festival_id ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              節慶行事曆沒有後續檔期，目前無法指定主推品項。
            </p>
          ) : (
            <>
              <section className="rounded-2xl border-2 border-primary/25 bg-primary/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">
                    已選 {selected.length} 個品項
                    {dirty && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        尚未儲存
                      </span>
                    )}
                  </h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || selected.length === 0}
                    onClick={() => {
                      setSelected([])
                      setNotice(null)
                    }}
                  >
                    清除勾選
                  </Button>
                </div>
                {selected.length === 0 && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    尚未指定，談判卡會依原本的節慶品類提供建議。
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {selected.map((sku) => (
                    <button
                      key={sku}
                      type="button"
                      disabled={busy}
                      onClick={() => toggle(sku)}
                      aria-label={`移除 ${names.get(sku) ?? sku}`}
                      className="rounded-lg border bg-card px-3 py-2 text-left text-xs hover:bg-muted disabled:opacity-50"
                    >
                      {names.get(sku) ?? sku}
                      <span
                        aria-hidden="true"
                        className="ml-2 text-muted-foreground"
                      >
                        ×
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
                <Input
                  type="search"
                  maxLength={200}
                  aria-label="搜尋主推品項"
                  placeholder="搜尋品名、料號或規格"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setLimit(PAGE_SIZE)
                  }}
                />
                <NativeSelect
                  aria-label="篩選商品類別"
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value)
                    setLimit(PAGE_SIZE)
                  }}
                >
                  <option value="">全部類別</option>
                  {categories.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <p className="text-xs text-muted-foreground">
                {search.pending ? "搜尋中…" : `找到 ${matches.length} 個品項`} · 最多指定 {settings.max_products}{" "}
                個；可跨節慶建議品類選擇。
              </p>
              {matches.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  沒有符合的商品，試試其他品名或料號。
                </p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {matches.slice(0, limit).map((product) => {
                  const checked = selectedSet.has(product.sku)
                  return (
                    <label
                      key={product.sku}
                      className={cn(
                        "flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border-2 bg-card p-3 shadow-lip",
                        checked && "border-primary bg-primary/5"
                      )}
                    >
                      <input
                        type="checkbox"
                        aria-label={`${product.name}（${product.sku}）`}
                        className="size-5 shrink-0 accent-primary"
                        checked={checked}
                        disabled={
                          busy ||
                          (!checked && selected.length >= settings.max_products)
                        }
                        onChange={() => toggle(product.sku)}
                      />
                      <ProductPhoto
                        product={product}
                        size="compact"
                        showSource={false}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm leading-snug font-medium">
                          {product.name}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {product.sku} · {product.category}
                          {product.spec && ` · ${product.spec}`}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
              {matches.length > limit && (
                <Button
                  variant="outline"
                  className="self-center"
                  onClick={() => setLimit((value) => value + PAGE_SIZE)}
                >
                  顯示更多商品
                </Button>
              )}
              <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 bg-card p-3 shadow-lip">
                <div className="text-xs text-muted-foreground">
                  {settings.updated_at
                    ? `上次由 ${settings.updated_by} 儲存 · ${formatDateTime(settings.updated_at)}`
                    : "這一檔還沒有儲存過主推設定"}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={busy || !dirty || conflict}
                    onClick={() => {
                      setSelected(settings.skus)
                      setError(null)
                      setNotice(null)
                    }}
                  >
                    還原勾選
                  </Button>
                  <Button
                    disabled={busy || !dirty || conflict}
                    onClick={() => void save()}
                  >
                    {busy ? "儲存中…" : "儲存主推品項"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
