import { useEffect, useId, useRef, useState } from "react"

import { ApiError } from "@/api/client"
import { searchProductAppearance, type ProductPhotoMatch } from "@/api/products"
import { ProductPhoto } from "@/components/product-photo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { productPhoto } from "@/lib/product-photos"

/** 一張照片列出所有對應料號，避免同系列包裝擠滿搜尋結果。 */
export function ProductPhotoMatches({
  matches,
}: {
  matches: ProductPhotoMatch[]
}) {
  return (
    <ul
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      aria-label="外觀相近的候選商品"
    >
      {matches.map((match) => {
        const first = match.products[0]
        if (!first) return null
        // 歷史問答的對應表若已變更，就不套用另一張照片。
        const photo = productPhoto(first.sku)
        const currentPhoto = photo?.src.endsWith(match.photo.file) === true
        return (
          <li key={match.source_id} className="rounded-xl border bg-card p-3">
            <div className="flex items-start gap-3">
              {currentPhoto && <ProductPhoto product={first} />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{match.photo.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {match.products.length} 個對應料號，請比對規格
                </p>
                <ul className="mt-2 space-y-3">
                  {match.products.map((product) => (
                    <li key={product.sku} className="text-sm">
                      <p className="font-medium">{product.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {product.sku} · {product.category} · {product.unit}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {product.kind === "exact"
                          ? "同品項照片"
                          : "同系列照片，包裝規格請依品名確認"}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

type SearchState =
  | { status: "idle" | "busy" }
  | { status: "error"; message: string }
  | { status: "ready"; matches: ProductPhotoMatch[]; message: string }

export function ProductAppearanceSearch() {
  const id = useId()
  const [query, setQuery] = useState("")
  const [drugsOnly, setDrugsOnly] = useState(true)
  const [state, setState] = useState<SearchState>({ status: "idle" })
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  function reset() {
    controller.current?.abort()
    setState({ status: "idle" })
  }

  return (
    <details className="mb-4 rounded-xl border-2 bg-card p-4">
      <summary className="cursor-pointer text-sm font-medium">
        忘記品名？依外觀找照片
      </summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!query.trim()) return
          controller.current?.abort()
          const request = new AbortController()
          controller.current = request
          setState({ status: "busy" })
          try {
            const result = await searchProductAppearance(
              query.trim(),
              drugsOnly,
              request.signal
            )
            if (!request.signal.aborted)
              setState({ status: "ready", ...result })
          } catch (error) {
            if (!request.signal.aborted)
              setState({
                status: "error",
                message:
                  error instanceof ApiError
                    ? error.message
                    : "連不上伺服器，請再試一次",
              })
          }
        }}
      >
        <label htmlFor={id} className="block text-xs text-muted-foreground">
          描述盒子、瓶身或藥錠的顏色、形狀與包裝文字
        </label>
        <div className="flex gap-2">
          <Input
            id={id}
            value={query}
            maxLength={200}
            onChange={(event) => {
              reset()
              setQuery(event.target.value)
            }}
            placeholder="例如：那個黃黃的藥、藍白色的盒子"
            className="h-11 min-w-0"
          />
          <Button
            type="submit"
            className="h-11 shrink-0"
            disabled={!query.trim() || state.status === "busy"}
          >
            {state.status === "busy" ? "搜尋中…" : "找照片"}
          </Button>
        </div>
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={drugsOnly}
            onChange={(event) => {
              reset()
              setDrugsOnly(event.target.checked)
            }}
          />
          只找藥品
        </label>
      </form>
      <div aria-live="polite" aria-busy={state.status === "busy"}>
        {state.status === "error" && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {state.message}
          </p>
        )}
        {state.status === "ready" && (
          <div className="mt-3 space-y-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {state.message}
            </p>
            <ProductPhotoMatches matches={state.matches} />
          </div>
        )}
      </div>
    </details>
  )
}
