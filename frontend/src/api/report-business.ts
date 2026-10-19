import { jsonBody, request } from "@/api/client"

export type BusinessView =
  "pharmacy_sales" | "product_queries" | "product_orders"
export type BusinessProduct = {
  sku: string
  name: string
  spec: string
  unit: string
}
export type BusinessQuery = {
  view: BusinessView
  start: string | null
  end: string | null
  sku: string | null
  q: string
  customer_type:
    "all" | "pharmacies" | "chain" | "independent" | "clinic" | "outlet"
  page: number
  page_size: number
}
export type BusinessRow = {
  key: string
  name: string
  customer_type: string | null
  spec: string | null
  unit: string | null
  sales: number
  order_count: number
  quantity: number | null
  query_count: number | null
  last_order_date: string | null
}
export type BusinessData = {
  view: BusinessView
  rows: BusinessRow[]
  total: number
  page: number
  page_size: number
  totals: {
    sales: number
    order_count: number
    quantity: number | null
    query_count: number | null
  }
  product: BusinessProduct | null
  tracked_since: string | null
}

export function getBusinessReport(query: BusinessQuery, signal?: AbortSignal) {
  return request<BusinessData>("/api/reports/business", {
    ...jsonBody("POST", query),
    signal,
  })
}

export function findBusinessProducts(q: string, signal?: AbortSignal) {
  return request<BusinessProduct[]>(
    `/api/reports/business-products?${new URLSearchParams({ q })}`,
    { signal }
  )
}
