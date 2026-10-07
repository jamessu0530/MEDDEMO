import { jsonBody, request } from "@/api/client"
import type { MethodCard } from "@/api/methods"
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
  // 主管教的做法：照這家的情況帶出來的方法卡，最多兩張；my_feedback 是我在這家客戶按過什麼。沒有相關的就是空的
  methods: MethodCard[]
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

// 開報價時這一期的促銷：依品項列出每一口。supply_price 是這家的供貨價，給「不走促銷」那一列；
// usual 是這個品項已經在常進品項裡，不重複列「不走促銷」
export type QuotePack = { code: string; name: string; deal: string; buy_qty: number; free_qty: number; deal_price: number }
export type QuotePromotion = {
  name: string
  // PM 提醒原文：滿額贈這類看整張訂單的活動，系統不算
  pm_note: string
  products: {
    group_name: string
    sku: string
    name: string
    spec: string
    unit: string
    supply_price: number
    usual: boolean
    packs: QuotePack[]
  }[]
}

// 報價的一列：品項 × 數量，或是促銷的某一口 × 口數
export type QuoteLineInput = { sku: string; qty: number } | { promo_code: string; packs: number }

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
  // 促銷的列：qty 是付錢的數量，promo_code、packs、free_qty、deal 說明是哪一口
  items: {
    sku: string
    name: string
    qty: number
    unit_price: number
    amount: number
    promo_code: string | null
    packs: number | null
    free_qty: number
    deal: string | null
  }[]
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

/** 沒有進行中的一期是 null */
export function getQuotePromotion(id: string, signal?: AbortSignal) {
  return request<QuotePromotion | null>(`/api/customers/${encodeURIComponent(id)}/quote-promotion`, { signal })
}

/**
 * 開 SAP 報價草稿；數量或口數 0 的列不要送（後端對沒有列或 ≤ 0 回 422）。
 * 折扣只套在沒促銷的列，超過 3% 要附理由，後端會開優惠申請單
 */
export function createQuote(id: string, items: QuoteLineInput[], discountPct = 0, reason = "") {
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
