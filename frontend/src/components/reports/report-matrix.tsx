import { useMemo } from "react"
import { ChevronDown, ChevronRight } from "@/components/icons"
import { NativeSelect } from "@/components/ui/native-select"
import { ReportPointComparison } from "@/components/reports/report-comparison"
import { ReportFormattedValue } from "@/components/reports/report-formatted-value"
import { reportDisplayValue, reportTooltip } from "@/lib/report-format"
import {
  matrixAllDepth,
  matrixFilters,
  matrixPathExpanded,
  matrixSelection,
  toggleMatrixPath,
} from "@/lib/report-matrix"
import {
  emptyMetricValue,
  formatReportExactValue,
  METRICS,
  reportMatrixOptions,
  selectionPointKey,
  type ReportCard,
  type ReportMatrixData,
  type ReportMatrixView,
  type ReportSelectionPoint,
} from "@/lib/reports"
import { finishWork } from "@/lib/background-work"
import {
  reportMatrixWork,
  type MatrixWorkResult,
} from "@/lib/report-matrix-work"
import { usePageWork } from "@/lib/use-page-work"

const EMPTY_VIEW: ReportMatrixView = {}
type MatrixProps = Omit<Parameters<typeof MatrixContent>[0], "prepared">

export function ReportMatrix(props: MatrixProps) {
  const { card, data, highlight, view = EMPTY_VIEW } = props
  const input = useMemo(
    () => ({
      kind: "matrix" as const,
      source: { data, highlight },
      query: { card, view },
    }),
    [card, data, highlight, view]
  )
  // Small matrices render immediately; large matrices share the bounded worker pool.
  const inline = useMemo(
    () =>
      data.cells.length + (highlight?.cells.length ?? 0) <= 400
        ? finishWork(reportMatrixWork(input.source, input.query))
        : null,
    [data, highlight, input]
  )
  const task = usePageWork(input, !inline)
  const prepared =
    inline ?? (task.result?.kind === "matrix" ? task.result.value : null)
  const resolved = inline
    ? input
    : task.input?.kind === "matrix"
      ? task.input
      : null
  if (task.error)
    return (
      <p role="alert" className="p-3 text-sm text-destructive">
        {task.error}
      </p>
    )
  if (!prepared || !resolved)
    return (
      <p role="status" className="p-3 text-sm text-muted-foreground">
        正在整理矩陣…
      </p>
    )
  return (
    <div className="relative" aria-busy={task.pending}>
      {task.pending && (
        <p
          role="status"
          className="pointer-events-none absolute top-0 right-0 z-10 rounded bg-card/90 px-2 py-1 text-xs text-muted-foreground"
        >
          正在整理矩陣…
        </p>
      )}
      <div inert={task.pending}>
        <MatrixContent
          {...props}
          card={resolved.query.card}
          data={resolved.source.data}
          highlight={resolved.source.highlight}
          view={resolved.query.view}
          prepared={prepared}
        />
      </div>
    </div>
  )
}

function MatrixContent({
  card,
  data,
  highlight,
  view = {},
  onViewChange,
  onSelect,
  selections = [],
  prepared,
}: {
  card: ReportCard
  data: ReportMatrixData
  highlight?: ReportMatrixData | null
  view?: ReportMatrixView
  onViewChange?: (view: ReportMatrixView) => void
  onSelect?: (point: ReportSelectionPoint) => void
  selections?: ReportSelectionPoint[]
  prepared: MatrixWorkResult
}) {
  const options = reportMatrixOptions(card)
  const { columns, rows, headers, index, selectedIndex, domains } = prepared
  const selectedKeys = useMemo(
    () => new Set(selections.map(selectionPointKey)),
    [selections]
  )
  const highlightedCell = (key: string) =>
    highlight?.cells[selectedIndex.get(key) ?? -1]
  const move = (axis: "row" | "column", page: number) =>
    onViewChange?.({ ...view, [`${axis}_page`]: page })
  return (
    <div className="min-w-0 space-y-2">
      {onViewChange && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {(["rows", "columns"] as const).map((axis) => (
            <div key={axis} className="flex gap-2">
              <button
                type="button"
                className="min-h-9 text-primary disabled:opacity-40"
                disabled={options[axis].length <= 1}
                onClick={() =>
                  onViewChange(matrixAllDepth(view, axis, options[axis].length))
                }
              >
                展開所有{axis === "rows" ? "列" : "欄"}
              </button>
              <button
                type="button"
                className="min-h-9 text-primary disabled:opacity-40"
                disabled={options[axis].length <= 1}
                onClick={() => onViewChange(matrixAllDepth(view, axis, 1))}
              >
                收合所有{axis === "rows" ? "列" : "欄"}
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{data.note}</p>
      <div
        className="max-h-[60dvh] max-w-full min-w-0 overflow-auto rounded-md border"
        aria-label={`${card.title}階層矩陣`}
      >
        <table className="w-full min-w-max text-xs">
          <caption className="sr-only">
            {card.title}階層矩陣，小計與總計為各層直接聚合值
          </caption>
          <thead className="bg-muted/70">
            {headers.map((entries, level) => (
              <tr key={level}>
                {level === 0 && (
                  <th
                    scope="col"
                    rowSpan={headers.length + 1}
                    className="sticky left-0 z-10 max-w-28 min-w-28 bg-muted px-3 py-2 text-left sm:max-w-60 sm:min-w-44"
                  >
                    列階層
                  </th>
                )}
                {entries.map((header, at) => (
                  <th
                    key={`${header.id}-${at}`}
                    scope="colgroup"
                    colSpan={header.colSpan}
                    rowSpan={header.rowSpan}
                    className="border-l px-2 py-2 text-left font-medium"
                  >
                    {header.toggle && onViewChange ? (
                      <button
                        type="button"
                        className="sticky left-28 inline-flex min-h-9 items-center gap-1 sm:left-44"
                        aria-label={`${header.expanded ? "收合" : "展開"}欄：${header.fullLabel}`}
                        aria-expanded={header.expanded}
                        onClick={() =>
                          onViewChange(
                            toggleMatrixPath(
                              view,
                              "columns",
                              header.path,
                              matrixPathExpanded(
                                card,
                                view,
                                "columns",
                                header.path
                              )
                            )
                          )
                        }
                      >
                        {header.expanded ? (
                          <ChevronDown className="size-3" />
                        ) : (
                          <ChevronRight className="size-3" />
                        )}
                        {header.label}
                      </button>
                    ) : (
                      <span
                        className="sticky left-28 inline-block max-w-36 truncate sm:left-44 sm:max-w-60"
                        title={
                          card.format?.tooltip?.show === false
                            ? undefined
                            : header.fullLabel
                        }
                      >
                        {header.label}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            ))}
            <tr>
              {columns.flatMap((column) =>
                options.metrics.map((metric) => (
                  <th
                    key={`${column.id}-${metric}`}
                    scope="col"
                    className="min-w-28 border-l px-3 py-2 text-right font-medium"
                  >
                    {METRICS[metric].label}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={`border-t ${row.depth === 0 ? "bg-muted/40 font-semibold" : row.expanded ? "bg-muted/20" : ""}`}
              >
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-28 border-r bg-card px-2 py-2 text-left font-normal sm:max-w-60"
                >
                  <div
                    className="flex min-w-0 items-start gap-1"
                    style={{ paddingLeft: Math.max(0, row.depth - 1) * 10 }}
                  >
                    {row.has_children && onViewChange && (
                      <button
                        type="button"
                        className="flex size-8 shrink-0 items-center justify-center rounded hover:bg-muted"
                        aria-label={`${row.expanded ? "收合" : "展開"}列：${row.path.map((entry) => entry.label).join(" / ")}`}
                        aria-expanded={row.expanded}
                        onClick={() =>
                          onViewChange(
                            toggleMatrixPath(
                              view,
                              "rows",
                              matrixFilters(row),
                              row.expanded
                            )
                          )
                        }
                      >
                        {row.expanded ? (
                          <ChevronDown className="size-3" />
                        ) : (
                          <ChevronRight className="size-3" />
                        )}
                      </button>
                    )}
                    <span
                      className="min-w-0 py-1.5 wrap-break-word"
                      title={
                        card.format?.tooltip?.show === false
                          ? undefined
                          : row.path.map((entry) => entry.label).join(" / ")
                      }
                    >
                      {row.label}
                      {row.has_children && row.show_values && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          小計
                        </span>
                      )}
                      {row.depth > 1 && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {row.path
                            .slice(0, -1)
                            .map((entry) => entry.label)
                            .join(" / ")}
                        </span>
                      )}
                    </span>
                  </div>
                </th>
                {columns.flatMap((column) =>
                  options.metrics.map((metric) => {
                    const cell =
                      data.cells[index.get(`${row.id}|${column.id}`) ?? -1]
                    const amount =
                      cell?.values[metric] ?? emptyMetricValue(metric)
                    const point = matrixSelection(row, column, metric)
                    const selected =
                      point && selectedKeys.has(selectionPointKey(point))
                    const show = row.show_values && column.show_values
                    const comparison = cell?.comparisons[metric]
                    const context =
                      [...row.path, ...column.path]
                        .map((entry) => entry.label)
                        .join(" / ") || "全部範圍"
                    const title = reportTooltip(
                      card,
                      {
                        label: context,
                        value: amount,
                        row_count: cell?.row_count ?? 0,
                      },
                      {
                        metric,
                        comparison,
                        ...(highlight
                          ? {
                              highlight:
                                highlightedCell(`${row.id}|${column.id}`)
                                  ?.values[metric] ?? emptyMetricValue(metric),
                            }
                          : {}),
                      }
                    )
                    return (
                      <td
                        key={`${column.id}-${metric}`}
                        className={`border-l px-2 py-2 text-right align-top tabular-nums ${selected ? "bg-primary/10" : ""}`}
                        title={title}
                      >
                        {show ? (
                          <ReportFormattedValue
                            card={card}
                            value={amount}
                            metric={metric}
                            domain={domains[metric]!}
                            total={
                              row.depth === 0 ||
                              (column.depth === 0 &&
                                options.columns.length > 0) ||
                              row.has_children ||
                              column.has_children
                            }
                          >
                            {onSelect && point ? (
                              <button
                                type="button"
                                className="min-h-9 rounded px-1 text-primary"
                                aria-label={`${point.label} · ${METRICS[metric].label}：${formatReportExactValue(amount, metric)}`}
                                aria-pressed={Boolean(selected)}
                                onClick={() => onSelect(point)}
                              >
                                <span className="report-value-text">
                                  {reportDisplayValue(card, amount, metric)}
                                </span>
                              </button>
                            ) : (
                              <span
                                className={
                                  amount != null && amount < 0
                                    ? "text-destructive"
                                    : undefined
                                }
                              >
                                <span className="report-value-text">
                                  {reportDisplayValue(card, amount, metric)}
                                </span>
                              </span>
                            )}
                            <ReportPointComparison
                              card={card}
                              value={comparison}
                              metric={metric}
                            />
                            {highlight && (
                              <span className="mt-1 block text-xs whitespace-normal text-primary">
                                選取{" "}
                                {reportDisplayValue(
                                  card,
                                  highlightedCell(`${row.id}|${column.id}`)
                                    ?.values[metric] ??
                                    emptyMetricValue(metric),
                                  metric
                                )}
                              </span>
                            )}
                          </ReportFormattedValue>
                        ) : (
                          "—"
                        )}
                      </td>
                    )
                  })
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!data.rows.length && (
          <p className="p-4 text-xs text-muted-foreground">
            目前沒有符合條件的列資料。
          </p>
        )}
      </div>
      {(["row", "column"] as const).map((axis) => {
        if (axis === "column" && !options.columns.length) return null
        const total = data[`${axis}_total`]
        const page = data[`${axis}_page`]
        const size = data[`${axis}_page_size`]
        const pages = Math.max(1, Math.ceil(total / size))
        const name = axis === "row" ? "列" : "欄"
        return (
          <div
            key={axis}
            className="flex flex-wrap items-center justify-between gap-2 text-xs"
          >
            <span>
              {name} · 第 {page}／{pages} 頁
            </span>
            {onViewChange && (
              <div className="flex flex-wrap items-center gap-1">
                <NativeSelect
                  aria-label={`矩陣每頁${name}數`}
                  value={size}
                  className="h-9 w-16 rounded-md border text-base shadow-none"
                  onChange={(event) =>
                    onViewChange({
                      ...view,
                      [`${axis}_page_size`]: Number(event.target.value),
                      [`${axis}_page`]: 1,
                    })
                  }
                >
                  {(axis === "row" ? [25, 50, 100] : [5, 10, 25]).map(
                    (value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    )
                  )}
                </NativeSelect>
                <button
                  type="button"
                  aria-label={`上一頁${name}`}
                  disabled={page <= 1}
                  className="min-h-9 rounded border px-2 disabled:opacity-40"
                  onClick={() => move(axis, page - 1)}
                >
                  上一頁
                </button>
                <span className="px-1">
                  {page}/{pages}
                </span>
                <button
                  type="button"
                  aria-label={`下一頁${name}`}
                  disabled={page >= pages}
                  className="min-h-9 rounded border px-2 disabled:opacity-40"
                  onClick={() => move(axis, page + 1)}
                >
                  下一頁
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
