import { jsonBody, request } from "@/api/client"

export type MetricId =
  "revenue" | "growth" | "net_margin" | "frequency" | "recency" | "visit_gap"
export type MetricRule = {
  metric: MetricId
  weight: number
  direction: "higher" | "lower"
}
export type PriorityCustomer = {
  customer_id: string
  reason: string
  until: string | null
}
export type PriorityStrategy = {
  id: string
  name: string
  days: number
  daily_limit: number
  metrics: MetricRule[]
  priority_customers: PriorityCustomer[]
}
export type PrioritySettings = {
  manager_id: string
  managers: { id: string; name: string }[]
  revision: number
  active_id: string | null
  strategies: PriorityStrategy[]
  metrics: { id: MetricId; label: string; unit: string; description: string }[]
  updated_at: string | null
  updated_by: string | null
}
export type PriorityRow = {
  customer_id: string
  customer_name: string
  owner_id: string
  owner_name: string
  area: string
  rank: number
  previous_rank: number | null
  score: number
  values: Record<MetricId, number | null>
  parts: {
    metric: MetricId
    value: number | null
    normalized: number
    weight: number
    contribution: number
  }[]
  priority: boolean
  priority_reason: string | null
  reason: string
}
export type PriorityPreview = {
  date: string
  revision: number
  baseline_name: string | null
  rows: PriorityRow[]
  routes: {
    rep_id: string
    rep_name: string
    version: number
    current_ids: string[]
    suggested_ids: string[]
    blocked: string | null
    priority_overflow: number
  }[]
}

export type PriorityPreset =
  "balanced" | "revenue" | "recovery" | "profit" | "growth"
export type PriorityAdvice = {
  kind: "suggestion" | "answer" | "clarify"
  message: string
  strategy: PriorityStrategy | null
  source: "ai" | "guide"
  context: {
    date: string
    days: number
    customers: number
    customers_with_revenue: number
    growth_available: number
    declining_customers: number
    missing_purchase_history: number
    missing_visit_history: number
  }
}
export type PriorityAdviceMessage = {
  role: "user" | "assistant"
  content: string
}

const PATH = "/api/manager/customer-priority"
export function askPriorityAdvice(
  managerId: string,
  strategy: PriorityStrategy,
  question: string,
  history: PriorityAdviceMessage[],
  preset?: PriorityPreset,
  signal?: AbortSignal
) {
  return request<PriorityAdvice>(`${PATH}/advice`, {
    ...jsonBody("POST", {
      manager_id: managerId,
      strategy,
      question,
      history,
      preset,
    }),
    signal,
  })
}

export function getPrioritySettings(managerId?: string, signal?: AbortSignal) {
  return request<PrioritySettings>(
    `${PATH}${managerId ? `?manager_id=${encodeURIComponent(managerId)}` : ""}`,
    { signal }
  )
}
export function previewPriority(
  managerId: string,
  strategy: PriorityStrategy,
  signal?: AbortSignal
) {
  return request<PriorityPreview>(`${PATH}/preview`, {
    ...jsonBody("POST", { manager_id: managerId, strategy }),
    signal,
  })
}
export function savePriority(
  settings: PrioritySettings,
  activeId: string | null
) {
  return request<PrioritySettings>(
    PATH,
    jsonBody("PUT", {
      manager_id: settings.manager_id,
      revision: settings.revision,
      policy: { strategies: settings.strategies, active_id: activeId },
    })
  )
}
export function applyPriority(
  managerId: string,
  revision: number,
  repId: string,
  version: number
) {
  return request<{ rep_id: string; version: number }>(
    `${PATH}/apply-today`,
    jsonBody("POST", {
      manager_id: managerId,
      revision,
      rep_id: repId,
      version,
    })
  )
}
