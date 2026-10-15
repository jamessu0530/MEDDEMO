import type { ReactNode } from "react"
import { reportBarGeometry, reportCellStyle } from "@/lib/report-format"
import type {
  ReportCard,
  ReportFormatDomain,
  ReportMetric,
} from "@/lib/reports"

export function ReportFormattedValue({
  card,
  value,
  domain,
  metric = card.metric,
  total = false,
  children,
}: {
  card: ReportCard
  value: number | null
  domain: ReportFormatDomain
  metric?: ReportMetric
  total?: boolean
  children: ReactNode
}) {
  const bar = reportBarGeometry(card, value, domain, metric, total)
  const style =
    reportCellStyle(card, value, domain, metric, total) ??
    (card.format?.metric_colors?.[metric]
      ? { color: card.format.metric_colors[metric] }
      : undefined)
  return (
    <div
      className={`relative min-h-9 rounded px-1 py-1 ${style ? "[&_*]:text-inherit" : ""} ${bar && !bar.showValue ? "[&_.report-value-text]:sr-only" : ""}`}
      style={style}
      data-bar-clipped={bar?.clipped || undefined}
    >
      {bar && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-1 top-1 h-8 overflow-hidden rounded"
        >
          <span
            className="absolute inset-y-0 opacity-30"
            style={{
              left: `${bar.left}%`,
              width: `${bar.width}%`,
              backgroundColor: bar.color,
            }}
          />
          {bar.zero > 0 && bar.zero < 100 && (
            <span
              className="absolute inset-y-0 w-px bg-foreground/40"
              style={{ left: `${bar.zero}%` }}
            />
          )}
        </div>
      )}
      <div className="relative">{children}</div>
      {bar?.clipped && (
        <span
          aria-label="資料條超出刻度範圍，數值仍為原值"
          title={
            card.format?.tooltip?.show === false
              ? undefined
              : "資料條超出刻度範圍，數值仍為原值"
          }
          className={`pointer-events-none absolute top-0 -translate-y-1/2 text-[8px] ${value != null && value < 0 ? "left-0" : "right-0"}`}
        >
          {value != null && value < 0 ? "◀" : "▶"}
        </span>
      )}
    </div>
  )
}
