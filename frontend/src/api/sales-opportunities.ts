import { request } from "@/api/client"

export type SalesOpportunity = {
  customer_id: string
  name: string
  type: string
  grade: string | null
  city: string
  area: string
  previous_amount: number
  current_amount: number
  previous_qty: number
  current_qty: number
  previous_orders: number
  current_orders: number
  gap_amount: number
  decline_percent: number | null
  previous_average_order: number | null
  last_order_date: string | null
  amount_declined: boolean
  quantity_declined: boolean
  is_declining: boolean
  is_key_account: boolean
  priority: "high" | "normal"
}

export type SalesOpportunities = {
  as_of: string
  month_start: string
  month_end: string
  previous_start: string
  previous_end: string
  days_remaining: number
  owner_name: string
  summary: {
    owned_customers: number
    opportunity_customers: number
    declining_customers: number
    key_accounts: number
    high_priority: number
    gap_amount: number
  }
  items: SalesOpportunity[]
}

export function getSalesOpportunities(signal?: AbortSignal) {
  return request<SalesOpportunities>("/api/sales-opportunities", { signal })
}
