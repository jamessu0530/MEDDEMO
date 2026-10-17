import type {
  CloudMetrics,
  MetricPoint,
  MetricsWindow,
  RouteMetric,
} from "@/api/cloud-metrics"

export const METRICS_WINDOWS: { value: MetricsWindow; label: string }[] = [
  { value: "15m", label: "近 15 分鐘" },
  { value: "1h", label: "近 1 小時" },
  { value: "6h", label: "近 6 小時" },
  { value: "24h", label: "近 24 小時" },
]
export const METRIC_COLORS = [
  "#8b5cf6",
  "#0ea5e9",
  "#f59e0b",
  "#f43f5e",
  "#10b981",
]

export function metricNumber(
  value: number | null | undefined,
  digits = 0,
  multiplier = 1
) {
  if (value == null || !Number.isFinite(value)) return "—"
  return (value * multiplier).toLocaleString("zh-TW", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function metricUptime(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "—"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分鐘`
  const hours = Math.floor(minutes / 60)
  return hours < 24
    ? `${hours} 小時 ${minutes % 60} 分`
    : `${Math.floor(hours / 24)} 天 ${hours % 24} 小時`
}

/** 下一個 Cloud 更新時鐘的邊界；不以請求結束時間累積延遲。 */
export function nextMetricRefresh(now: number, seconds: number) {
  const interval = Math.max(1, seconds) * 1000
  return interval - (now % interval) + 100
}

export function grafanaDashboardLink(
  data: Pick<
    CloudMetrics,
    "dashboard_url" | "window" | "environment" | "refresh_seconds"
  >
) {
  const url = new URL(data.dashboard_url)
  url.searchParams.set("from", `now-${data.window}`)
  url.searchParams.set("to", "now")
  url.searchParams.set("var-environment", data.environment)
  url.searchParams.set("refresh", `${data.refresh_seconds}s`)
  return url.toString()
}

export type RouteSort = "requests" | "p95_seconds" | "server_errors"
export function rankedRoutes(routes: RouteMetric[], sort: RouteSort) {
  return [...routes].sort(
    (a, b) =>
      (b[sort] ?? -1) - (a[sort] ?? -1) ||
      (b.requests ?? -1) - (a.requests ?? -1)
  )
}

export function metricHealth(
  data: CloudMetrics | null,
  checkedAt: number,
  transportError: string | null
) {
  if (transportError)
    return {
      tone: "danger",
      label: "更新中斷",
      detail: transportError,
    } as const
  if (!data)
    return {
      tone: "neutral",
      label: "連接 Cloud",
      detail: "正在取得監控資料",
    } as const
  if (data.status === "unconfigured")
    return {
      tone: "neutral",
      label: "等待連接",
      detail: "請設定 Cloud 讀取連線",
    } as const
  if (data.status === "error")
    return {
      tone: "danger",
      label: "Cloud 讀取失敗",
      detail: data.message,
    } as const
  if (data.status === "no_data")
    return {
      tone: "neutral",
      label: "等待樣本",
      detail: "目前環境尚無近期收集資料",
    } as const
  const age = data.last_scraped_at
    ? (checkedAt - new Date(data.last_scraped_at).getTime()) / 1000
    : Infinity
  if (age > Math.max(20, data.refresh_seconds * 4))
    return {
      tone: "warning",
      label: "樣本延遲",
      detail: "請檢查 Alloy 收集與 Cloud 傳送狀態",
    } as const
  if (data.scrape_up !== 1)
    return {
      tone: "danger",
      label: "收集異常",
      detail: "有 API 實例未成功收集指標",
    } as const
  if ((data.error_percent ?? 0) >= 1)
    return {
      tone: "danger",
      label: "錯誤率升高",
      detail: "近一分鐘的 5xx 錯誤率達 1%",
    } as const
  if ((data.p95_seconds ?? 0) >= 1)
    return {
      tone: "warning",
      label: "回應時間偏高",
      detail: "近一分鐘的 p95 回應時間達 1 秒",
    } as const
  return {
    tone: "good",
    label: "系統運作正常",
    detail: "Cloud 已收到近期樣本",
  } as const
}

/** 依真實時間繪圖；缺值與漏收樣本保留斷點。 */
export function metricTrend(
  points: MetricPoint[],
  domain?: {
    start: number
    end: number
    ceiling: number
    width: number
    height: number
    stepSeconds: number
  }
) {
  const valid = points.filter(
    (point) => point.value != null && Number.isFinite(point.value)
  )
  if (!valid.length) return null
  const start = domain?.start ?? points[0].timestamp
  const span = Math.max(
    1,
    (domain?.end ?? points[points.length - 1].timestamp) - start
  )
  const ceiling =
    domain?.ceiling ?? Math.max(...valid.map((point) => point.value!), 0.001)
  const width = domain?.width ?? 300
  const height = domain?.height ?? 60
  const step = domain?.stepSeconds ?? 60
  let path = ""
  let previous: number | null = null
  for (const point of points) {
    if (point.value == null || !Number.isFinite(point.value)) {
      previous = null
      continue
    }
    const x = 4 + ((point.timestamp - start) / span) * (width - 8)
    const y =
      height -
      8 -
      (Math.max(0, point.value) / Math.max(ceiling, 0.001)) * (height - 16)
    const move = previous == null || point.timestamp - previous > step * 1.5
    path += `${move ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)} `
    if (move) path += `L${(x + 0.5).toFixed(2)},${y.toFixed(2)} `
    previous = point.timestamp
  }
  return path.trim()
}
