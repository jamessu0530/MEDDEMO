import {
  reportMatrixOptions,
  reportDataKey,
  type ReportCard,
  type ReportFilter,
  type ReportMatrixNode,
  type ReportMatrixView,
  type ReportMetric,
  type ReportSelectionPoint,
  type ReportQuery,
} from "@/lib/reports"

export type MatrixAxis = "rows" | "columns"
/** 暫時聯動及展開在載入中保留舊表格 DOM；固定欄位／範圍改變不能重用。 */
export function matrixRenderKey(query: ReportQuery, id: string) {
  const card = query.cards.find((entry) => entry.id === id)
  return card?.visual === "matrix"
    ? reportDataKey({
        ...query,
        cards: [card],
        selection_groups: [],
        matrix_views: {},
        drill_filters: {},
      })
    : null
}
export const MATRIX_ROOT: ReportMatrixNode = {
  id: "[]",
  path: [],
  label: "總計",
  depth: 0,
  has_children: false,
  expanded: false,
  show_values: true,
}
export function matrixPathId(path: ReportFilter[]) {
  return JSON.stringify(path.map((entry) => [entry.dimension, entry.key]))
}
export function matrixFilters(node: ReportMatrixNode): ReportFilter[] {
  return node.path.map(({ dimension, key }) => ({ dimension, key }))
}
export function matrixSelection(
  row: ReportMatrixNode,
  column: ReportMatrixNode,
  metric?: ReportMetric
): ReportSelectionPoint | null {
  const filters = [...matrixFilters(row), ...matrixFilters(column)]
  if (!filters.length) return null
  return {
    filters,
    label: [...row.path, ...column.path]
      .map((entry) => entry.label)
      .join(" / ")
      .slice(0, 300),
    ...(metric ? { metric } : {}),
  }
}
export function matrixPathExpanded(
  card: ReportCard,
  view: ReportMatrixView,
  axis: MatrixAxis,
  path: ReportFilter[]
) {
  const options = reportMatrixOptions(card)
  const id = matrixPathId(path)
  const depth =
    (axis === "rows" ? view.row_expand_depth : view.column_expand_depth) ??
    (axis === "rows" ? options.row_expand_depth : options.column_expand_depth)
  return (
    (view[`expanded_${axis}`] ?? []).some(
      (entry) => matrixPathId(entry) === id
    ) ||
    (path.length < depth &&
      !(view[`collapsed_${axis}`] ?? []).some(
        (entry) => matrixPathId(entry) === id
      ))
  )
}
export function toggleMatrixPath(
  view: ReportMatrixView,
  axis: MatrixAxis,
  path: ReportFilter[],
  expanded: boolean
): ReportMatrixView {
  const id = matrixPathId(path)
  const explicit = (view[`expanded_${axis}`] ?? []).filter(
    (entry) => matrixPathId(entry) !== id
  )
  const collapsed = (view[`collapsed_${axis}`] ?? []).filter(
    (entry) => matrixPathId(entry) !== id
  )
  if (expanded) collapsed.push(path)
  else explicit.push(path)
  return {
    ...view,
    [`expanded_${axis}`]: explicit.slice(-100),
    [`collapsed_${axis}`]: collapsed.slice(-100),
    [`${axis === "rows" ? "row" : "column"}_page`]: 1,
  }
}
export function matrixAllDepth(
  view: ReportMatrixView,
  axis: MatrixAxis,
  depth: number
): ReportMatrixView {
  return {
    ...view,
    [`${axis === "rows" ? "row" : "column"}_expand_depth`]: depth,
    [`expanded_${axis}`]: [],
    [`collapsed_${axis}`]: [],
    [`${axis === "rows" ? "row" : "column"}_page`]: 1,
  }
}
export type MatrixHeader = {
  id: string
  label: string
  fullLabel: string
  path: ReportFilter[]
  colSpan: number
  rowSpan: number
  toggle: boolean
  expanded: boolean
}

export function matrixHeaders(
  card: ReportCard,
  columns: ReportMatrixNode[],
  view: ReportMatrixView
): MatrixHeader[][] {
  const options = reportMatrixOptions(card)
  const nodes = new Map(columns.map((node) => [node.id, node]))
  const chains = columns.map((node) => {
    if (!node.depth)
      return [
        {
          id: "root",
          label: options.columns.length ? "總計" : "指標",
          fullLabel: options.columns.length ? "總計" : "指標",
          path: [],
          toggle: false,
        },
      ]
    const path = matrixFilters(node)
    const entries = node.path.map((entry, index) => ({
      id: matrixPathId(path.slice(0, index + 1)),
      label: entry.label,
      fullLabel: node.path
        .slice(0, index + 1)
        .map((entry) => entry.label)
        .join(" / "),
      path: path.slice(0, index + 1),
      toggle:
        index + 1 < options.columns.length &&
        (nodes.get(matrixPathId(path.slice(0, index + 1)))?.has_children ??
          node.depth > index + 1),
    }))
    if (node.expanded && node.has_children)
      entries.push({
        id: `${node.id}:subtotal`,
        label: "小計",
        fullLabel: node.path.map((entry) => entry.label).join(" / "),
        path,
        toggle: false,
      })
    return entries
  })
  const depth = Math.max(1, ...chains.map((chain) => chain.length))
  return Array.from({ length: depth }, (_, level) => {
    const result: MatrixHeader[] = []
    for (let index = 0; index < chains.length; index++) {
      const entry = chains[index][level]
      if (!entry) continue
      const prior = result.at(-1)
      if (prior?.id === entry.id && prior.rowSpan === 1)
        prior.colSpan += options.metrics.length
      else
        result.push({
          ...entry,
          colSpan: options.metrics.length,
          rowSpan: level === chains[index].length - 1 ? depth - level : 1,
          expanded: matrixPathExpanded(card, view, "columns", entry.path),
        })
    }
    return result
  })
}
