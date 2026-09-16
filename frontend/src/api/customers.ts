import { jsonBody, request } from "@/api/client"
import { readUser } from "@/lib/auth"

export type Customer = {
  id: string
  name: string
  type: "chain" | "independent" | "clinic"
  region: string
  grade: string
  owner_name: string
  last_visit_date: string | null
}

export const CUSTOMER_TYPE_LABEL: Record<Customer["type"], string> = {
  chain: "連鎖藥局",
  independent: "獨立藥局",
  clinic: "診所",
}

// 沒訊號的地方也要能選客戶開始錄音（FR-4.3）：每次載入成功就把清單記在手機裡，連不上時拿出來用。
// 每個人看得到的客戶不一樣，key 帶登入的使用者 id，同一支手機換人登入不會看到上一個人的客戶
const CUSTOMER_CACHE_KEY = "meddemo:customers"

function cacheKey() {
  return `${CUSTOMER_CACHE_KEY}:${readUser()?.id ?? "anonymous"}`
}

function readCachedCustomers(): Customer[] | null {
  try {
    const raw = localStorage.getItem(cacheKey())
    return raw ? (JSON.parse(raw) as Customer[]) : null
  } catch {
    return null // 瀏覽器不讓存（例如部分無痕模式）就當作沒有
  }
}

/** 登入者看得到的客戶清單（後端依登入身分篩過）；連不上伺服器時改用上次載入的清單（cached 為 true） */
export async function listCustomers(signal?: AbortSignal) {
  try {
    const customers = await request<Customer[]>("/api/customers", { signal })
    try {
      localStorage.setItem(cacheKey(), JSON.stringify(customers))
    } catch {
      // 存不進去就算了，下次沒網路時只是看不到清單
    }
    return { customers, cached: false }
  } catch (error) {
    const cached = signal?.aborted ? null : readCachedCustomers()
    if (cached) return { customers: cached, cached: true }
    throw error
  }
}

export function cachedCustomer(id: string) {
  return readCachedCustomers()?.find((customer) => customer.id === id)
}

export function getCustomer(id: string, signal?: AbortSignal) {
  return request<Customer>(`/api/customers/${encodeURIComponent(id)}`, { signal })
}

export type ProfileStats = {
  amount_last_90d: number
  amount_prev_90d: number
  avg_order_amount_last_90d: number | null
  avg_order_amount_before: number | null
  interval_last_90d: number | null
  interval_before: number | null
  interval_alert: boolean
  ar_outstanding: number
  ar_max_age_days: number | null
  last_order_date: string | null
  last_visit_date: string | null
}

// 客戶檔案（FR-2）：交易概況、待處理事項、競品紀錄
export type CustomerProfile = {
  customer: Customer
  today: string
  highlights: string[]
  stats: ProfileStats
  intervals: { month: string; gap_days: number | null }[]
  // 在客戶檔案直接開的報價沒有拜訪，visit_id 是 null
  open_quotes: { quote_no: string; visit_id: string | null; date: string; items: string; amount: number }[]
  commitments: {
    visit_id: string
    visit_date: string
    by: "us" | "customer"
    text: string
    due: string | null
    overdue: boolean
  }[]
  complaints: { visit_id: string; visit_date: string; text: string }[]
  competitors: { name: string; mentions: number; last_date: string; detail: string | null }[]
}

// 談判卡（FR-3）：只有連鎖客戶有
export type NegotiationCard = {
  customer: Customer
  turnover: { sku: string; name: string; orders_per_month: number; region_orders_per_month: number | null }[]
  margin: {
    listing_fee_rate: number
    channel_reward_rate: number
    net_margin_rate: number
    region_net_margin_rate: number | null
    summary: string
  } | null
  tips: { reason: string; doc_title: string; section: string; content: string; source_name: string }[]
}

export function getCustomerProfile(id: string, signal?: AbortSignal) {
  return request<CustomerProfile>(`/api/customers/${encodeURIComponent(id)}/profile`, { signal })
}

export function getNegotiationCard(id: string, signal?: AbortSignal) {
  return request<NegotiationCard>(`/api/customers/${encodeURIComponent(id)}/negotiation`, { signal })
}

// 開報價（原型客戶檔案的「開報價」）：這家近半年常進的品項，unit_price 已經是給這家客戶的供貨價
export type QuoteItem = {
  sku: string
  name: string
  spec: string
  unit: string
  unit_price: number
  usual_qty: number
}

export type Quote = {
  quote_no: string
  customer_id: string
  items: { sku: string; name: string; qty: number; unit_price: number; amount: number }[]
  amount: number
  created_at: string
}

export function getQuoteItems(id: string, signal?: AbortSignal) {
  return request<QuoteItem[]>(`/api/customers/${encodeURIComponent(id)}/quote-items`, { signal })
}

/** 開 SAP 報價草稿；數量 0 的品項不要送（後端對沒有品項或數量 ≤ 0 回 422） */
export function createQuote(id: string, items: { sku: string; qty: number }[]) {
  return request<Quote>(`/api/customers/${encodeURIComponent(id)}/quotes`, jsonBody("POST", { items }))
}
