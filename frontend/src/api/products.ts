import { jsonBody, request } from "@/api/client"
import type { ProductPhoto } from "@/lib/product-photos"

export type Product = {
  sku: string
  name: string
  category: string
  spec: string
  unit: string
  aliases: string[]
  // 常用品項：確認頁的預設選單只列這些，其他要搜尋才找得到
  common: boolean
  photo?: ProductPhoto | null
}

export function listProducts(signal?: AbortSignal) {
  return request<Product[]>("/api/products", { signal })
}

export type ProductPhotoMatch = {
  source_id: string
  photo: { file: string; title: string; pageUrl: string }
  products: (Pick<Product, "sku" | "name" | "category" | "spec" | "unit"> & {
    kind: "exact" | "series"
    note: string | null
  })[]
}

export function searchProductAppearance(
  query: string,
  drugsOnly: boolean,
  signal?: AbortSignal
) {
  return request<{ matches: ProductPhotoMatch[]; message: string }>(
    "/api/products/appearance-search",
    {
      ...jsonBody("POST", { query, drugs_only: drugsOnly }),
      signal,
    }
  )
}

export type BrowseSignal = {
  active_ms: number
  opens: number
  last_seen: string
}
export type BrowseProfile = Record<string, BrowseSignal>
export type BrowseEvent = {
  id: string
  sku: string
  kind: "dwell" | "detail"
  active_ms: number
}
export function getBrowseProfile(signal?: AbortSignal) {
  return request<BrowseProfile>("/api/products/browse-profile", { signal })
}
export function sendBrowseEvents(events: BrowseEvent[], keepalive = false) {
  return request<BrowseProfile>("/api/products/browse-events", {
    ...jsonBody("POST", { events }),
    keepalive,
  })
}
