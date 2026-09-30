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
  // 在客戶檔案直接開的報價沒有拜訪，visit_id 是 null。折扣還在等簽核的也列出來（pending_approval），被駁回的不列
  open_quotes: {
    quote_no: string
    visit_id: string | null
    date: string
    items: string
    amount: number
    status: "draft" | "pending_approval"
  }[]
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

// 送出優惠或續約之後的簽核結果：系統核准了（auto_approved），或是現在等誰簽（waiting_for）
export type Approval = {
  form_id: number
  form_no: string
  status: "approved" | "pending"
  auto_approved: boolean
  // 模型估計的核准機率；沒有模型是 null
  probability: number | null
  waiting_for: { step: string; name: string } | null
}

export type Quote = {
  quote_no: string
  customer_id: string
  items: { sku: string; name: string; qty: number; unit_price: number; amount: number }[]
  amount: number
  discount_pct: number
  // draft：可以送給客戶；pending_approval：折扣超過業務的權限，等簽核
  status: "draft" | "pending_approval"
  // 折扣在業務的權限（3%）內就沒有申請單
  approval: Approval | null
  created_at: string
}

export function getQuoteItems(id: string, signal?: AbortSignal) {
  return request<QuoteItem[]>(`/api/customers/${encodeURIComponent(id)}/quote-items`, { signal })
}

/** 開 SAP 報價草稿；數量 0 的品項不要送（後端對沒有品項或數量 ≤ 0 回 422）。折扣超過 3% 要附理由，後端會開優惠申請單 */
export function createQuote(id: string, items: { sku: string; qty: number }[], discountPct = 0, reason = "") {
  return request<Quote>(
    `/api/customers/${encodeURIComponent(id)}/quotes`,
    jsonBody("POST", { items, discount_pct: discountPct, reason: reason || null })
  )
}

// 連鎖客戶目前的合約條件。系統沒有合約表：到期日在客戶主檔，費率從近 90 天的交易算出來
export type Contract = {
  contract_end_date: string | null
  days_left: number | null
  // 3 個月內到期，該開始談續約了
  ending_soon: boolean
  listing_fee_rate: number
  channel_reward_rate: number
  // 還沒簽完的續約申請；同一家客戶同時只能有一張
  pending_form_id: number | null
  // 現在能不能送續約申請：要在到期前 3 個月內（或已經過期），而且沒有還沒簽完的申請
  can_request: boolean
  // 離到期還太久時的說明（「合約還有 338 天到期，到期前 3 個月才能申請續約」）；其他情況是 null
  blocked_reason: string | null
}

export type ContractRequest = {
  term_months: 12 | 24
  listing_fee_rate: number
  channel_reward_rate: number
  reason: string
}

/** 不是連鎖客戶回 409 */
export function getContract(id: string, signal?: AbortSignal) {
  return request<Contract>(`/api/customers/${encodeURIComponent(id)}/contract`, { signal })
}

export function createContractRequest(id: string, body: ContractRequest) {
  return request<Approval>(`/api/customers/${encodeURIComponent(id)}/contract-requests`, jsonBody("POST", body))
}
