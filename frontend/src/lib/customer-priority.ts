import type {
  MetricId,
  MetricRule,
  PriorityStrategy,
} from "@/api/customer-priority"

export const METRIC_LABELS: Record<MetricId, string> = {
  revenue: "營收貢獻",
  growth: "營收成長",
  net_margin: "淨毛利貢獻",
  frequency: "採購頻率",
  recency: "距上次採購",
  visit_gap: "距上次拜訪",
}

/** 權重是相對重要性，正規化後才顯示百分比；零權重代表不採計。 */
export function metricPercent(rules: MetricRule[], metric: MetricId) {
  const total = rules.reduce((sum, r) => sum + r.weight, 0)
  return total > 0
    ? ((rules.find((r) => r.metric === metric)?.weight ?? 0) / total) * 100
    : 0
}

export function metricValue(metric: MetricId, value: number | null) {
  if (value === null) return "無資料"
  if (metric === "growth") return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`
  if (metric === "revenue" || metric === "net_margin")
    return `${(value / 10000).toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 萬`
  return `${value.toLocaleString("zh-TW")}${metric === "frequency" ? " 筆" : " 天"}`
}

export function validStrategy(strategy: PriorityStrategy) {
  return (
    Boolean(strategy.name.trim()) &&
    strategy.metrics.some((r) => r.weight > 0) &&
    Number.isInteger(strategy.days) &&
    strategy.days >= 7 &&
    strategy.days <= 365 &&
    Number.isInteger(strategy.daily_limit) &&
    strategy.daily_limit >= 1 &&
    strategy.daily_limit <= 8 &&
    strategy.priority_customers.every((c) => c.reason.trim())
  )
}

export function strategyFingerprint(
  managerId: string,
  strategy: PriorityStrategy
) {
  return JSON.stringify([managerId, strategy])
}

/** 比較實際相對權重與方向，等比例放大原始權重不算經營偏好改變。 */
export function strategyChanges(
  before: PriorityStrategy,
  after: PriorityStrategy
) {
  const changes: { label: string; before: string; after: string }[] = []
  for (const [key, label] of Object.entries(METRIC_LABELS)) {
    const metric = key as MetricId
    const describe = (strategy: PriorityStrategy) => {
      const rule = strategy.metrics.find((r) => r.metric === metric)
      const weight = metricPercent(strategy.metrics, metric)
      return weight === 0
        ? "不採計"
        : `${weight.toFixed(1)}% · ${rule?.direction === "lower" ? "低值優先" : "高值優先"}`
    }
    const previous = describe(before),
      next = describe(after)
    if (previous !== next)
      changes.push({ label, before: previous, after: next })
  }
  for (const [key, label, suffix] of [
    ["name", "策略名稱", ""],
    ["days", "統計期間", " 天"],
    ["daily_limit", "每天建議站數", " 站"],
  ] as const) {
    if (before[key] !== after[key])
      changes.push({
        label,
        before: `${before[key]}${suffix}`,
        after: `${after[key]}${suffix}`,
      })
  }
  return changes
}
