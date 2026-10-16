import {
  comparisonPrevious,
  comparisonText,
  COMPARISONS,
} from "@/lib/report-comparison"
import {
  formatReportExactValue,
  type ReportComparison,
  type ReportComparisonValue,
  type ReportMetric,
  type ReportCard,
} from "@/lib/reports"
import { reportDisplayValue } from "@/lib/report-format"

export function ReportPointComparison({
  value,
  metric,
  card,
}: {
  value?: ReportComparisonValue | null
  metric: ReportMetric
  card?: ReportCard
}) {
  if (!value) return null
  const formatter = (amount: number | null, unit: ReportMetric) =>
    card
      ? reportDisplayValue(card, amount, unit)
      : formatReportExactValue(amount, unit)
  return (
    <span className="mt-1 block text-xs font-normal whitespace-normal text-muted-foreground">
      前期 {comparisonPrevious(value, metric, formatter)}
      <br />
      {comparisonText(value, metric, {
        decimals: card?.format?.numbers?.[metric]?.decimals,
        formatValue: formatter,
      })}
    </span>
  )
}

export function ReportComparisonSummary({
  comparison,
  metric,
  label,
  card,
}: {
  comparison?: ReportComparison | null
  metric: ReportMetric
  label?: string
  card?: ReportCard
}) {
  if (!comparison) return null
  const formatter = (amount: number | null, unit: ReportMetric) =>
    card
      ? reportDisplayValue(card, amount, unit)
      : formatReportExactValue(amount, unit)
  return (
    <div
      className="space-y-1 rounded-md border bg-muted/20 px-2 py-2 text-xs"
      aria-label={label ?? "期間比較"}
    >
      <p className="wrap-break-word">
        {label && `${label} · `}
        {COMPARISONS[comparison.mode]}：
        {comparisonText(comparison.value, metric, {
          decimals: card?.format?.numbers?.[metric]?.decimals,
          formatValue: formatter,
        })}
      </p>
      <p className="text-xs text-muted-foreground">
        前期 {comparisonPrevious(comparison.value, metric, formatter)}
        {comparison.value.status === "ok" &&
          metric !== "net_margin_rate" &&
          comparison.value.delta != null &&
          ` · 差額 ${formatter(comparison.value.delta, metric)}`}
      </p>
      {comparison.start && comparison.end && (
        <p className="text-xs text-muted-foreground">
          {comparison.start > comparison.end
            ? "比較日期條件沒有交集"
            : `比較日期：${comparison.start} 至 ${comparison.end}`}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {comparison.note} 日期條件同步平移，其餘條件與權限相同。
      </p>
    </div>
  )
}
