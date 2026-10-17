import { request } from "@/api/client"

export type MetricsWindow = "15m" | "1h" | "6h" | "24h"
export type MetricPoint = { timestamp: number; value: number | null }
export type RouteMetric = {
  method: string
  route: string
  requests: number | null
  requests_per_second: number | null
  server_errors: number | null
  client_errors: number | null
  p95_seconds: number | null
}
export type InstanceMetric = {
  instance: string
  up: number | null
  cpu_cores: number | null
  memory_bytes: number | null
  in_progress: number | null
  uptime_seconds: number | null
}
export type CloudMetrics = {
  status: "ready" | "no_data" | "unconfigured" | "error"
  message: string | null
  environment: string
  dashboard_url: string
  window: MetricsWindow
  window_seconds: number
  step_seconds: number
  refresh_seconds: number
  rate_window_seconds: number
  range_start: number
  range_end: number
  fetched_at: string
  last_scraped_at: string | null
  scrape_up: number | null
  instances_up: number | null
  instances_total: number | null
  requests_per_second: number | null
  requests_in_range: number | null
  success_percent: number | null
  error_percent: number | null
  client_error_percent: number | null
  p50_seconds: number | null
  p95_seconds: number | null
  p99_seconds: number | null
  average_seconds: number | null
  cpu_cores: number | null
  memory_bytes: number | null
  in_progress: number | null
  history: Record<string, MetricPoint[]>
  routes: RouteMetric[]
  status_codes: { status: string; requests: number }[]
  instances: InstanceMetric[]
}

export function getCloudMetrics(window: MetricsWindow, signal?: AbortSignal) {
  return request<CloudMetrics>(`/api/admin/metrics?window=${window}`, {
    signal,
  })
}
