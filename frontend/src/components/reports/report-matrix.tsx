import { ChevronDown, ChevronRight } from "lucide-react"
import { NativeSelect } from "@/components/ui/native-select"
import { ReportPointComparison } from "@/components/reports/report-comparison"
import { ReportFormattedValue } from "@/components/reports/report-formatted-value"
import {
  reportDisplayValue,
  reportMatrixFormatDomain,
  reportTooltip,
} from "@/lib/report-format"
import {
  MATRIX_ROOT,
  matrixAllDepth,
  matrixFilters,
  matrixHeaders,
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

export function ReportMatrix({
  card,
  data,
  highlight,
  view = {},
  onViewChange,
  onSelect,
  selections = [],
}: {
  card: ReportCard
  data: ReportMatrixData
  highlight?: ReportMatrixData | null
  view?: ReportMatrixView
  onViewChange?: (view: ReportMatrixView) => void
  onSelect?: (point: ReportSelectionPoint) => void
  selections?: ReportSelectionPoint[]
}) {
  const options = reportMatrixOptions(card)
  const columns = [
    ...data.columns,
    ...(options.show_grand_total || !data.columns.length ? [MATRIX_ROOT] : []),
  ]
  const rows = [
    ...data.rows,
    ...(options.show_grand_total ? [MATRIX_ROOT] : []),
  ]
  const headers = matrixHeaders(card, columns, view)
  const index = new Map(
    data.cells.map((cell) => [`${cell.row_id}|${cell.column_id}`, cell])
  )
  const selectedIndex = new Map(
    highlight?.cells.map((cell) => [`${cell.row_id}|${cell.column_id}`, cell])
  )
  const move = (axis: "row" | "column", page: number) =>
    onViewChange?.({ ...view, [`${axis}_page`]: page })
  return (
    <div className="min-w-0 space-y-2">
      {onViewChange && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
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
      <p className="text-[10px] text-muted-foreground">{data.note}</p>
      {Object.values(card.format?.conditional ?? {}).some(
        (format) => format?.data_bars
      ) && (
        <p className="text-[10px] text-muted-foreground">
          資料條共用零軸，自動刻度使用完整最低層分組。三角記號表示超出刻度，數字仍為原值。
        </p>
      )}
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
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          小計
                        </span>
                      )}
                      {row.depth > 1 && (
                        <span className="mt-1 block text-[10px] text-muted-foreground">
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
                    const cell = index.get(`${row.id}|${column.id}`)
                    const amount =
                      cell?.values[metric] ?? emptyMetricValue(metric)
                    const point = matrixSelection(row, column, metric)
                    const selected =
                      point &&
                      selections.some(
                        (entry) =>
                          selectionPointKey(entry) === selectionPointKey(point)
                      )
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
                                selectedIndex.get(`${row.id}|${column.id}`)
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
                            domain={reportMatrixFormatDomain(data, metric)}
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
                              <span className="mt-1 block text-[10px] whitespace-normal text-primary">
                                選取{" "}
                                {reportDisplayValue(
                                  card,
                                  selectedIndex.get(`${row.id}|${column.id}`)
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
            className="flex flex-wrap items-center justify-between gap-2 text-[11px]"
          >
            <span>
              {name} {total ? (page - 1) * size + 1 : 0}–
              {Math.min(total, page * size)} / {total} 個分組
            </span>
            {onViewChange && (
              <div className="flex flex-wrap items-center gap-1">
                <NativeSelect
                  aria-label={`矩陣每頁${name}數`}
                  value={size}
                  className="h-9 w-16 rounded-md border text-xs shadow-none"
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
