import type { Work } from "@/lib/background-work"
import {
  MATRIX_ROOT,
  matrixHeaders,
  type MatrixHeader,
} from "@/lib/report-matrix"
import {
  reportMatrixOptions,
  type ReportCard,
  type ReportFormatDomain,
  type ReportMatrixData,
  type ReportMatrixNode,
  type ReportMatrixView,
  type ReportMetric,
} from "@/lib/reports"

export type MatrixWorkSource = {
  data: ReportMatrixData
  highlight?: ReportMatrixData | null
}
export type MatrixWorkQuery = { card: ReportCard; view: ReportMatrixView }
export type MatrixWorkResult = {
  rows: ReportMatrixNode[]
  columns: ReportMatrixNode[]
  headers: MatrixHeader[][]
  index: Map<string, number>
  selectedIndex: Map<string, number>
  domains: Partial<Record<ReportMetric, ReportFormatDomain>>
}

/** Build cell indexes and all metric ranges once, rather than scanning every cell per value. */
export function* reportMatrixWork(
  { data, highlight }: MatrixWorkSource,
  { card, view }: MatrixWorkQuery
): Work<MatrixWorkResult> {
  const options = reportMatrixOptions(card)
  const columns = [
    ...data.columns,
    ...(options.show_grand_total || !data.columns.length ? [MATRIX_ROOT] : []),
  ]
  const rows = [
    ...data.rows,
    ...(options.show_grand_total ? [MATRIX_ROOT] : []),
  ]
  const leafRows = new Set<string>(),
    leafColumns = new Set<string>()
  let work = 0
  for (const row of data.rows) {
    if (!row.has_children) leafRows.add(row.id)
    if (++work % 128 === 0) yield
  }
  for (const column of data.columns) {
    if (!column.has_children) leafColumns.add(column.id)
    if (++work % 128 === 0) yield
  }
  if (!data.columns.length) leafColumns.add("[]")
  const domains: MatrixWorkResult["domains"] = {}
  for (const metric of options.metrics)
    domains[metric] = data.format_domains?.[metric] ?? {
      minimum: null,
      maximum: null,
    }
  const index = new Map<string, number>(),
    selectedIndex = new Map<string, number>()
  for (let at = 0; at < data.cells.length; at++) {
    const cell = data.cells[at]
    index.set(`${cell.row_id}|${cell.column_id}`, at)
    if (leafRows.has(cell.row_id) && leafColumns.has(cell.column_id)) {
      for (const metric of options.metrics) {
        const value = cell.values[metric],
          domain = domains[metric]!
        if (
          !data.format_domains?.[metric] &&
          typeof value === "number" &&
          Number.isFinite(value)
        ) {
          domain.minimum = Math.min(domain.minimum ?? value, value)
          domain.maximum = Math.max(domain.maximum ?? value, value)
        }
      }
    }
    if (++work % 128 === 0) yield
  }
  for (let at = 0; at < (highlight?.cells.length ?? 0); at++) {
    const cell = highlight!.cells[at]
    selectedIndex.set(`${cell.row_id}|${cell.column_id}`, at)
    if (++work % 128 === 0) yield
  }
  return {
    rows,
    columns,
    headers: matrixHeaders(card, columns, view),
    index,
    selectedIndex,
    domains,
  }
}
