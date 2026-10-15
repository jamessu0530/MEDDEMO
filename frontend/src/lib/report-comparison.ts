import {
  formatReportExactValue,
  COMPARISON_LABELS,
  COMPARISON_STATUS_LABELS,
  type ReportComparisonValue,
  type ReportMetric,
} from "@/lib/reports"

export const COMPARISONS = COMPARISON_LABELS
export const COMPARISON_STATUS = COMPARISON_STATUS_LABELS
function signed(value: number, suffix: string, decimals?: number | null) {
  return `${value > 0 ? "+" : ""}${value.toLocaleString("zh-TW", { minimumFractionDigits: decimals ?? 0, maximumFractionDigits: decimals ?? 2 })}${suffix}`
}
export function comparisonText(
  value: ReportComparisonValue,
  metric: ReportMetric,
  options?: {
    decimals?: number | null
    formatValue?: typeof formatReportExactValue
  }
) {
  if (
    value.status === "ok" &&
    metric === "net_margin_rate" &&
    value.delta != null
  )
    return signed(value.delta * 100, " 個百分點", options?.decimals)
  if (value.status === "ok" && value.relative_change != null)
    return signed(value.relative_change * 100, "%")
  if (
    (value.status === "previous_zero" ||
      value.status === "negative_baseline") &&
    value.delta != null
  )
    return `差額 ${value.delta > 0 ? "+" : ""}${(options?.formatValue ?? formatReportExactValue)(value.delta, metric)} · ${COMPARISON_STATUS[value.status]}`
  return COMPARISON_STATUS[value.status]
}
export function comparisonPrevious(
  value: ReportComparisonValue,
  metric: ReportMetric,
  formatter = formatReportExactValue
) {
  return value.status === "no_previous_data" || !value.previous_rows
    ? "無比較資料"
    : formatter(value.previous, metric)
}
