import type { ReportDetailsColumn } from "@/api/reports"

const number = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 4 })
const currency = new Intl.NumberFormat("zh-TW", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const datetime = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

export function detailValue(
  column: ReportDetailsColumn,
  value: string | number | null | undefined
) {
  if (value == null || value === "") return "—"
  if (typeof value === "number")
    return column.kind === "currency"
      ? currency.format(value)
      : number.format(value)
  if (column.kind === "datetime") {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? value : datetime.format(parsed)
  }
  return value
}

export function detailPageCount(total: number, size: number) {
  return Math.max(1, Math.ceil(total / size))
}

export function detailCsvFilename(title: string) {
  return `${title.replace(/[^\p{L}\p{N}\s_-]/gu, "_").slice(0, 60)}-完整逐筆明細.csv`
}
