import { jsonBody, request } from "@/api/client"

export type OrderStatus = "draft" | "effective"
export type OrderCustomer = {
  id: string
  name: string
  owner_id: string | null
  owner_name: string | null
  payment_term: string | null
  region: string
  city?: string
  area?: string
  address?: string | null
  phone?: string | null
}
export type OrderProduct = {
  sku: string
  name: string
  category: string
  spec: string
  unit: string
  unit_price: number
  last_qty?: number
  last_unit_price?: number
}
export type OrderLastPurchase = {
  order_no: string
  date: string
  items: OrderProduct[]
  unavailable_count: number
}
export type OrderItemInput = { sku: string; qty: number; unit_price: number }
export type OrderInput = {
  customer_id: string
  ship_to_id: string
  shipping_date: string
  shipping_address: string
  recipient: string
  payment_term: string
  purchase_no: string
  note: string
  items: OrderItemInput[]
}
export type OrderItem = OrderItemInput & {
  line_no: number
  name: string
  category: string
  spec: string
  unit: string
  amount: number
  standard_price: number
  minimum_price: number
  price_status: "green" | "yellow" | "red" | "gray"
  price_message: string
}
export type OrderSummary = {
  id: string
  order_no: string
  customer_id: string
  customer_name: string
  status: OrderStatus
  amount: number
  shipping_date: string
  updated_at: string | null
  sap_order_no: string | null
  owner_id: string | null
  owner_name: string | null
  source: "workspace" | "history"
}
export type OrderDetail = OrderSummary &
  Omit<OrderInput, "items"> & {
    ship_to_name: string
    created_at: string
    revision: number
    readonly: boolean
    items: OrderItem[]
    order_type: string
    currency: string
    as_of: string
  }
export type OrderList = {
  items: OrderSummary[]
  total: number
  page: number
  page_size: number
  as_of: string
  integration: "demo"
}
export type OrderProductList = {
  items: OrderProduct[]
  total: number
  page: number
  page_size: number
}
export type OrderRecommendation = OrderProduct & {
  rank: number
  score: number
  source: "related" | "replenishment" | "content" | "popular"
  reasons: string[]
}
export type OrderRecommendations = {
  items: OrderRecommendation[]
  customer_id: string
  customer_name: string
  as_of: string
  channel: string
  history_days: number
  history_orders: number
  peer_customers: number
  model_version: string
  message: string
}

export function getOrderRecommendations(
  customerId: string,
  excludedSkus: string[],
  signal?: AbortSignal
) {
  const params = new URLSearchParams()
  excludedSkus.forEach((sku) => params.append("exclude_sku", sku))
  return request<OrderRecommendations>(
    `/api/orders/customers/${encodeURIComponent(customerId)}/recommendations${params.size ? `?${params}` : ""}`,
    { signal }
  )
}

export function getOrders(
  params: { q: string; status: string; page: number; sort: string },
  signal?: AbortSignal
) {
  return request<OrderList>(
    `/api/orders?${new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])))}`,
    { signal }
  )
}
export function getOrder(id: string, signal?: AbortSignal) {
  return request<OrderDetail>(`/api/orders/${encodeURIComponent(id)}`, {
    signal,
  })
}
export function getOrderCustomers(signal?: AbortSignal, query = "") {
  return request<OrderCustomer[]>(
    `/api/orders/customers${query ? `?q=${encodeURIComponent(query)}` : ""}`,
    { signal }
  )
}
export function getOrderCustomer(id: string, signal?: AbortSignal) {
  return request<{ customer: OrderCustomer; as_of: string }>(
    `/api/orders/customers/${encodeURIComponent(id)}`,
    { signal }
  )
}
export function getOrderProducts(
  customerId: string,
  q: string,
  page: number,
  signal?: AbortSignal
) {
  return request<OrderProductList>(
    `/api/orders/products?${new URLSearchParams({ customer_id: customerId, q, page: String(page) })}`,
    { signal }
  )
}
export function getOrderLastPurchase(customerId: string, signal?: AbortSignal) {
  return request<OrderLastPurchase | null>(
    `/api/orders/customers/${encodeURIComponent(customerId)}/last-purchase`,
    { signal }
  )
}
export function createOrder(body: OrderInput) {
  return request<OrderDetail>("/api/orders", jsonBody("POST", body))
}
export function saveOrder(id: string, body: OrderInput, revision: number) {
  return request<OrderDetail>(
    `/api/orders/${encodeURIComponent(id)}`,
    jsonBody("PUT", { ...body, revision })
  )
}
export function submitOrder(id: string, revision: number) {
  return request<OrderDetail>(
    `/api/orders/${encodeURIComponent(id)}/submit`,
    jsonBody("POST", { revision })
  )
}
