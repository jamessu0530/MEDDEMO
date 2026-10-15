import { comparisonPrevious, comparisonText } from "@/lib/report-comparison"
import {
  METRICS,
  REPORT_COLORS,
  formatReportExactValue,
  formatReportValue,
  type CardData,
  type ReportCard,
  type ReportComparisonValue,
  type ReportFormatDomain,
  type ReportMetric,
  type ReportMatrixData,
  type ReportPoint,
} from "@/lib/reports"

export const DISPLAY_UNITS = {
  auto: "自動",
  none: "完整數值",
  thousand: "千",
  ten_thousand: "萬",
  million: "百萬",
} as const
const MULTIPLIERS = { none: 1, thousand: 1e3, ten_thousand: 1e4, million: 1e6 }
export function reportDisplayValue(
  card: ReportCard,
  value: number | null,
  metric: ReportMetric = card.metric,
  variant: "value" | "compact" | "axis" = "value"
): string {
  if (value == null || !Number.isFinite(value)) return "無法計算"
  const options = card.format?.numbers?.[metric]
  if (!options)
    return variant === "compact" ||
      (variant === "axis" && Math.abs(value) >= 10000)
      ? formatReportValue(value, metric)
      : formatReportExactValue(value, metric)
  const percentage = METRICS[metric].unit === "percent"
  const unit = options.unit ?? "auto"
  const scale = percentage
    ? 1
    : unit === "auto"
      ? variant !== "value" &&
        METRICS[metric].unit === "currency" &&
        Math.abs(value) >= 10000
        ? 1e4
        : 1
      : MULTIPLIERS[unit]
  const decimals = options.decimals
  const text = (percentage ? value * 100 : value / scale).toLocaleString(
    "zh-TW",
    {
      useGrouping: options.grouping ?? true,
      minimumFractionDigits: decimals ?? 0,
      maximumFractionDigits:
        decimals ??
        (scale > 1
          ? 1
          : METRICS[metric].unit === "count" ||
              (variant === "compact" &&
                unit === "auto" &&
                metric !== "avg_order_value" &&
                !percentage)
            ? 0
            : 2),
    }
  )
  if (options.show_unit === false) return text
  if (percentage) return `${text}%`
  const prefix =
    scale === 1e3 ? "千" : scale === 1e4 ? "萬" : scale === 1e6 ? "百萬" : ""
  const suffix =
    METRICS[metric].unit === "currency"
      ? "元"
      : metric === "visits"
        ? "次"
        : metric === "order_count"
          ? "張"
          : "家"
  return `${text} ${prefix}${suffix}`
}

export function reportPalette(card: ReportCard) {
  const color = card.color ?? REPORT_COLORS[0]
  return [
    color,
    ...REPORT_COLORS.filter((item) => item !== color),
    "#5993bd",
    "#81a85a",
    "#bb7b43",
  ]
}
export function reportSeriesColor(
  card: ReportCard,
  key: string,
  index: number,
  dimension = card.legend ?? card.dimension,
  metric = card.metric
) {
  const chosen = card.format?.series_colors?.find(
    (item) => item.dimension === dimension && item.key === key
  )?.color
  const metricColor = card.format?.metric_colors?.[metric]
  const palette = reportPalette({ ...card, color: metricColor ?? card.color })
  return (
    chosen ??
    (key === "primary" || dimension === "none" ? metricColor : undefined) ??
    palette[index % palette.length]
  )
}

export function reportFormatDomain(
  card: ReportCard,
  data: CardData,
  metric = card.metric
): ReportFormatDomain {
  if (data.matrix?.format_domains?.[metric])
    return data.matrix.format_domains[metric]!
  const values =
    metric === card.secondary_metric
      ? data.points.map((point) => point.secondary_value)
      : data.series?.length
        ? data.series.flatMap((series) =>
            series.points
              .filter((point) => !(point as { missing?: boolean }).missing)
              .map((point) => point.value)
          )
        : data.points.length
          ? data.points
              .filter((point) => !(point as { missing?: boolean }).missing)
              .map((point) => point.value)
          : [data.total]
  const finite = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value)
  )
  return finite.length
    ? { minimum: Math.min(...finite), maximum: Math.max(...finite) }
    : { minimum: null, maximum: null }
}

export function reportMatrixFormatDomain(
  data: ReportMatrixData,
  metric: ReportMetric
): ReportFormatDomain {
  if (data.format_domains?.[metric]) return data.format_domains[metric]!
  const rows = new Set(
    data.rows.filter((node) => !node.has_children).map((node) => node.id)
  )
  const columns = new Set(
    data.columns.filter((node) => !node.has_children).map((node) => node.id)
  )
  if (!data.columns.length) columns.add("[]")
  const values = data.cells
    .filter((cell) => rows.has(cell.row_id) && columns.has(cell.column_id))
    .map((cell) => cell.values[metric])
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value)
    )
  return values.length
    ? { minimum: Math.min(...values), maximum: Math.max(...values) }
    : { minimum: null, maximum: null }
}

function boundedRange(
  domain: ReportFormatDomain,
  lower?: number | null,
  upper?: number | null
) {
  let minimum = lower ?? domain.minimum ?? 0
  let maximum = upper ?? domain.maximum ?? 0
  if (minimum > maximum) {
    if (lower != null) maximum = minimum
    else minimum = maximum
  }
  return { minimum, maximum }
}
function blendColor(first: string, last: string, amount: number) {
  return `#${[1, 3, 5]
    .map((at) =>
      Math.round(
        parseInt(first.slice(at, at + 2), 16) * (1 - amount) +
          parseInt(last.slice(at, at + 2), 16) * amount
      )
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`
}
export function reportConditionalColor(
  card: ReportCard,
  value: number | null,
  domain: ReportFormatDomain,
  metric = card.metric,
  total = false
) {
  const options = card.format?.conditional?.[metric]
  if (
    value == null ||
    !Number.isFinite(value) ||
    !options ||
    (total && !options.apply_totals)
  )
    return undefined
  if (options.color_mode === "rules")
    return options.rules?.find(
      (rule) =>
        (rule.minimum == null || value >= rule.minimum) &&
        (rule.maximum == null || value < rule.maximum)
    )?.color
  if (options.color_mode !== "gradient") return undefined
  const range = boundedRange(domain, options.minimum, options.maximum)
  const ratio =
    range.maximum === range.minimum
      ? value < range.minimum
        ? 0
        : value > range.maximum
          ? 1
          : 0.5
      : Math.max(
          0,
          Math.min(1, (value - range.minimum) / (range.maximum - range.minimum))
        )
  return blendColor(
    options.low_color ?? "#e8edf8",
    options.high_color ?? "#2878b5",
    ratio
  )
}

export function reportBarGeometry(
  card: ReportCard,
  value: number | null,
  domain: ReportFormatDomain,
  metric = card.metric,
  total = false
) {
  const options = card.format?.conditional?.[metric]
  if (
    value == null ||
    !Number.isFinite(value) ||
    !options?.data_bars ||
    (total && !options.apply_totals)
  )
    return null
  const minimum = Math.min(options.bar_minimum ?? domain.minimum ?? 0, 0)
  const maximum = Math.max(options.bar_maximum ?? domain.maximum ?? 0, 0)
  const span = maximum - minimum || 1
  const zero = (-minimum / span) * 100
  const end =
    ((Math.max(minimum, Math.min(maximum, value)) - minimum) / span) * 100
  return {
    left: Math.min(zero, end),
    width: Math.abs(end - zero),
    zero,
    color:
      value < 0
        ? (options.negative_color ?? "#d76857")
        : (options.positive_color ?? "#259688"),
    clipped: value < minimum || value > maximum,
    showValue: options.show_bar_value ?? true,
  }
}
export function reportTextContrast(hex: string) {
  const rgb = [1, 3, 5]
    .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179
    ? "#111827"
    : "#ffffff"
}
export function reportCellStyle(
  card: ReportCard,
  value: number | null,
  domain: ReportFormatDomain,
  metric = card.metric,
  total = false
) {
  const color = reportConditionalColor(card, value, domain, metric, total)
  return !color
    ? undefined
    : card.format?.conditional?.[metric]?.color_target === "font"
      ? { color }
      : { backgroundColor: color, color: reportTextContrast(color) }
}

export function reportTooltip(
  card: ReportCard,
  point: Pick<ReportPoint, "label" | "value" | "row_count" | "secondary_value">,
  options: {
    metric?: ReportMetric
    comparison?: ReportComparisonValue | null
    highlight?: number | null
    share?: number
    context?: string
  } = {}
) {
  const settings = card.format?.tooltip
  if (settings?.show === false) return undefined
  const metric = options.metric ?? card.metric
  const parts = [
    options.context ?? point.label,
    `${METRICS[metric].label}：${formatReportExactValue(point.value, metric)}`,
  ]
  if (
    metric === card.metric &&
    card.secondary_metric &&
    point.secondary_value !== undefined
  )
    parts.push(
      `${METRICS[card.secondary_metric].label}：${formatReportExactValue(point.secondary_value ?? null, card.secondary_metric)}`
    )
  if (settings?.show_rows !== false && point.row_count != null)
    parts.push(`符合條件資料 ${point.row_count} 筆`)
  if (settings?.show_share !== false && options.share != null)
    parts.push(
      `圖中占比 ${(options.share * 100).toLocaleString("zh-TW", { maximumFractionDigits: 2 })}%`
    )
  if (settings?.show_comparison !== false && options.comparison)
    parts.push(
      `前期 ${comparisonPrevious(options.comparison, metric)}`,
      comparisonText(options.comparison, metric)
    )
  if (settings?.show_highlight !== false && options.highlight !== undefined)
    parts.push(`聯動選取 ${formatReportExactValue(options.highlight, metric)}`)
  if (
    settings?.show_target !== false &&
    card.target != null &&
    metric === card.metric
  )
    parts.push(`目標 ${formatReportExactValue(card.target, metric)}`)
  return parts.join(" · ")
}
