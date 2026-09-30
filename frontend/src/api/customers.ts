import { jsonBody, request } from "@/api/client"
import { readUser } from "@/lib/auth"

export type Customer = {
  id: string
  name: string
  type: "chain" | "independent" | "clinic"
  region: string
  grade: string
  owner_id: string
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

// 談判卡（FR-3）：每種客戶都有，圍繞下一個節慶。
// orientation 是 customer（連鎖，顧客導向）時有 campaign、shelf、gaps、margin；
// 是 cost（獨立藥局與診所，成本導向）時有 deals、terms。不屬於這個導向的欄位是 null
export type NegotiationCard = {
  customer: Customer
  orientation: "customer" | "cost"
  // 行事曆裡沒有之後的節慶就是 null。note 是設定檔裡人寫的一句話，連鎖與其他客戶看到的不同
  festival: { name: string; date: string; days_left: number; categories: string[]; note: string } | null
  // 還來得及申請檔期的那個節慶；missed 是排在它前面、申請期限已過的節慶名稱
  campaign: {
    festival_name: string
    festival_date: string
    apply_by: string
    days_to_apply: number
    fee_cap: number
    missed: string[]
  } | null
  // scoped：是不是限定在節慶的主推品類；主推品類裡沒有東西可列時退回全部品類
  shelf: {
    items: { sku: string; name: string; orders_per_month: number; region_orders_per_month: number | null }[]
    scoped: boolean
  } | null
  gaps: { sku: string; name: string; peers_with: number; peers_total: number }[] | null
  margin: {
    listing_fee_rate: number
    channel_reward_rate: number
    net_margin_rate: number
    region_net_margin_rate: number | null
    summary: string
  } | null
  // 進行中那一期促銷，一個料號一列（搭贈後每個最便宜的那一口）；沒有進行中的促銷時 promotion_name 是 null
  deals: {
    items: {
      sku: string
      name: string
      group_name: string
      deal: string
      deal_price: number
      unit_deal_price: number
      list_price: number
      unit_profit: number
      profit_rate: number
      smallest_deal_price: number
    }[]
    scoped: boolean
    promotion_name: string | null
  } | null
  terms: {
    supply_rate: number
    channel_reward_rate: number | null
    payment_days: number
    ar_max_age_days: number | null
    free_discount_pct: number
    amount_last_90d: number
    avg_order_amount: number | null
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
