import { jsonBody, request } from "@/api/client"

export type Product = {
  sku: string
  name: string
  category: string
  spec: string
  unit: string
  aliases: string[]
  // 常用品項：確認頁的預設選單只列這些，其他要搜尋才找得到
  common: boolean
}

export function listProducts(signal?: AbortSignal) {
  return request<Product[]>("/api/products", { signal })
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
