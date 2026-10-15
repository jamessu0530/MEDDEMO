import {
  CUSTOMER_TYPES,
  DIMENSIONS,
  type ReportDateRange,
  type ReportFilter,
  type ReportFilterOption,
  type ReportFilterOptions,
  type ReportSlicer,
  type ReportPeriod,
} from "@/lib/reports"

export const SLICER_DIMENSIONS = [
  "owner",
  "customer",
  "product",
  "customer_type",
] as const

export function emptyFilterOptions(): ReportFilterOptions {
  return {
    owner: [],
    customer: [],
    product: [],
    customer_type: Object.entries(CUSTOMER_TYPES).map(([key, label]) => ({
      key,
      label,
    })),
  }
}

export function searchFilterOptions(
  options: ReportFilterOption[],
  query: string
): ReportFilterOption[] {
  const term = query.normalize("NFKC").trim().toLocaleLowerCase("zh-TW")
  return term
    ? options.filter((option) =>
        `${option.key} ${option.label}`
          .normalize("NFKC")
          .toLocaleLowerCase("zh-TW")
          .includes(term)
      )
    : options
}

export function setReportSlicer(
  slicers: ReportSlicer[],
  dimension: ReportFilter["dimension"],
  keys: string[]
): ReportSlicer[] {
  const unique = [...new Set(keys.map((key) => key.trim()).filter(Boolean))]
  const remaining = slicers.filter((item) => item.dimension !== dimension)
  return unique.length ? [...remaining, { dimension, keys: unique }] : remaining
}

export function filterOptionLabel(
  options: ReportFilterOptions,
  dimension: ReportFilter["dimension"],
  key: string
): string {
  if (dimension === "month") return key.replace("-", "/")
  if (dimension === "year") return `${key} 年`
  if (dimension === "quarter") return `${key.slice(0, 4)} 年第 ${key.slice(-1)} 季`
  return (
    options[dimension].find((option) => option.key === key)?.label ??
    `已無可用選項（${key}）`
  )
}

export function filterSummary(
  options: ReportFilterOptions,
  dimension: ReportFilter["dimension"],
  keys: string[]
): string {
  const labels = keys.map((key) => filterOptionLabel(options, dimension, key))
  return `${DIMENSIONS[dimension]}：${labels.slice(0, 3).join("、")}${labels.length > 3 ? ` 等 ${labels.length} 項` : ""}`
}

export function dateRangeError(
  range: ReportDateRange,
  asOf?: string
): string | null {
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000"))
      return false
    const time = Date.parse(`${value}T00:00:00Z`)
    return (
      Number.isFinite(time) &&
      new Date(time).toISOString().slice(0, 10) === value
    )
  }
  if (!validDate(range.start) || !validDate(range.end))
    return "請輸入完整且有效的起始與結束日期。"
  if (range.start > range.end) return "起始日期不能晚於結束日期。"
  if (asOf && range.end > asOf) return `結束日期不能晚於報表基準日 ${asOf}。`
  if ((Date.parse(range.end) - Date.parse(range.start)) / 86400000 > 3660)
    return "自訂日期範圍最多十年。"
  return null
}

/** 使用報表基準日計算預設範圍，查詢載入中也不跳回本月。 */
export function reportPeriodRange(
  period: ReportPeriod,
  asOf: string,
  custom?: ReportDateRange | null
): ReportDateRange {
  if (period === "custom" && custom)
    return { start: custom.start, end: custom.end < asOf ? custom.end : asOf }
  const date = new Date(`${asOf}T00:00:00Z`)
  const month = date.getUTCMonth()
  date.setUTCDate(1)
  if (period === "last_month") {
    const previousEnd = new Date(date.getTime() - 86400000)
      .toISOString()
      .slice(0, 10)
    date.setUTCMonth(month - 1)
    return { start: date.toISOString().slice(0, 10), end: previousEnd }
  }
  date.setUTCMonth(
    period === "quarter"
      ? Math.floor(month / 3) * 3
      : month - (period === "six_months" ? 5 : period === "year" ? 11 : 0)
  )
  return { start: date.toISOString().slice(0, 10), end: asOf }
}
