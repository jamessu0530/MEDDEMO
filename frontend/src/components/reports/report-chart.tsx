import {
  AnalysisChart,
  StageChart,
  ReportMap,
} from "@/components/reports/report-advanced"
import {
  useLayoutEffect,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import { BarChart3, ChevronDown } from "@/components/icons"
import { ReportMatrix } from "@/components/reports/report-matrix"
import { ReportFormattedValue } from "@/components/reports/report-formatted-value"
import type { ReportWidgetSize } from "@/lib/report-widget"
import {
  reportCellStyle,
  reportDisplayValue,
  reportFormatDomain,
  reportTooltip,
  reportConditionalColor,
  reportSeriesColor,
} from "@/lib/report-format"
import {
  ReportComparisonSummary,
  ReportPointComparison,
} from "@/components/reports/report-comparison"

import {
  DIMENSIONS,
  METRICS,
  REPORT_COLORS,
  formatReportValue,
  formatReportExactValue,
  emptyMetricValue,
  NON_ADDITIVE_METRICS,
  PART_WHOLE_VISUALS,
  selectionPointKey,
  chartSelection,
  type CardData,
  type ReportCard,
  type ReportDimension,
  type ReportMetric,
  type ReportPoint,
  type ReportSelectionPoint,
  type ReportMatrixView,
} from "@/lib/reports"
import {
  chartDomain,
  chartSeries,
  numericCardData,
  trendSegments,
  stackRows,
  treeRects,
  type NumericChartSeries,
  type NumericCardData,
} from "@/components/reports/report-chart-math"

type ChartProps = {
  widgetSize?: ReportWidgetSize
  summary?: boolean
  plotOnly?: boolean
  card: ReportCard
  data: CardData
  onSelectPoint?: (
    dimension: ReportDimension,
    key: string,
    label: string
  ) => void
  onHoverData?: (point: ReportSelectionPoint) => void
  onHoverEnd?: () => void
  selectedKey?: string
  onSelectData?: (point: ReportSelectionPoint) => void
  pointActionLabel?: string
  selections?: ReportSelectionPoint[]
  expanded?: boolean
  matrixView?: ReportMatrixView
  onMatrixViewChange?: (view: ReportMatrixView) => void
}
type PlotProps = Omit<ChartProps, "data"> & {
  data: NumericCardData
  series: NumericChartSeries[]
  colors: string[]
}

function exactValue(value: number | null, metric: ReportMetric): string {
  return formatReportExactValue(value, metric)
}
function axisValue(value: number, metric: ReportMetric, card?: ReportCard) {
  if (card) return reportDisplayValue(card, value, metric, "axis")
  return Math.abs(value) >= 10000
    ? formatReportValue(value, metric)
    : exactValue(value, metric)
}
function colorAt(colors: string[], index: number) {
  return colors[index % colors.length]
}
function percentValue(value: number) {
  return `${value.toLocaleString("zh-TW", { maximumFractionDigits: 1 })}%`
}
function plotPointTooltip(
  props: PlotProps,
  point: ReportPoint & { missing?: boolean },
  series?: NumericChartSeries,
  share?: number
) {
  const sample =
    series?.points.find((entry) => entry.key === point.key) ?? point
  return reportTooltip(
    props.card,
    {
      ...sample,
      label: chartSelection(props.card, point, series).label,
      value: (sample as { missing?: boolean }).missing ? null : sample.value,
    },
    {
      comparison: sample.comparison,
      ...(props.data.highlight
        ? { highlight: highlightValue(props, point, series) }
        : {}),
      share,
    }
  )
}
function pointColor(
  props: PlotProps,
  point: ReportPoint & { missing?: boolean },
  column = 0,
  metric = props.card.metric,
  fallback?: string
) {
  const series = props.series[column]
  const sample =
    series?.points.find((entry) => entry.key === point.key) ?? point
  const value =
    metric === props.card.secondary_metric
      ? (point.secondary_value ?? null)
      : (sample as { missing?: boolean }).missing
        ? null
        : sample.value
  const chosen = props.card.legend
    ? colorAt(props.colors, column)
    : (props.card.format?.series_colors?.find(
        (entry) =>
          entry.dimension === props.card.dimension && entry.key === point.key
      )?.color ??
      props.card.format?.metric_colors?.[metric] ??
      fallback ??
      (metric === props.card.secondary_metric
        ? reportSeriesColor(props.card, "primary", column, "none", metric)
        : colorAt(props.colors, column)))
  return (
    reportConditionalColor(
      props.card,
      value,
      reportFormatDomain(props.card, props.data, metric),
      metric
    ) ?? chosen
  )
}
function chartTooltip(card: ReportCard, text: string) {
  return card.format?.tooltip?.show === false ? undefined : text
}

function Total({
  card,
  total,
  data,
  large = false,
  summary = false,
  showTarget = true,
}: {
  card: ReportCard
  total: number | null
  data: CardData
  large?: boolean
  summary?: boolean
  showTarget?: boolean
}) {
  const display = reportDisplayValue(card, total, card.metric, "compact")
  const formatted =
    summary && display.endsWith(" 萬") ? `${display}元` : display
  const exact = exactValue(total, card.metric)
  return (
    <div className={summary ? "report-summary-total" : large ? "py-2" : "mb-3"}>
      {!summary && (
        <p className="mb-1 text-xs text-muted-foreground">
          {NON_ADDITIVE_METRICS.includes(card.metric)
            ? "所選範圍"
            : "所選範圍合計"}
        </p>
      )}
      <p
        className={`${summary ? "report-summary-value" : large ? "text-[clamp(1.125rem,5.5vw,1.625rem)] sm:text-3xl" : "text-xl"} leading-tight font-semibold tracking-tight break-words tabular-nums ${total != null && total < 0 ? "text-destructive" : "text-foreground"}`}
        title={reportTooltip(
          card,
          { label: "所選範圍", value: total, row_count: data.row_count },
          { comparison: data.comparison?.value }
        )}
        style={
          reportCellStyle(
            card,
            total,
            reportFormatDomain(card, data),
            card.metric,
            !large
          ) ??
          (total != null && total >= 0
            ? {
                color:
                  card.format?.metric_colors?.[card.metric] ??
                  (summary ? undefined : card.color),
              }
            : undefined)
        }
      >
        {formatted}
      </p>
      {!summary &&
        formatted !== exact &&
        !card.format?.numbers?.[card.metric] && (
          <p className="mt-1 text-xs break-words text-muted-foreground tabular-nums">
            {exact}
          </p>
        )}
      {showTarget && large && typeof card.target === "number" && (
        <p className="mt-3 text-xs text-muted-foreground">
          目標 {reportDisplayValue(card, card.target, card.metric)}
          {card.target > 0 && total != null && (
            <> · 達成 {percentValue((total / card.target) * 100)}</>
          )}
        </p>
      )}
    </div>
  )
}

function EmptyChart() {
  return (
    <div className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
      <BarChart3 className="size-6 opacity-60" aria-hidden="true" />
      <p>目前範圍沒有資料</p>
    </div>
  )
}
function Unsupported({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-xl border border-border bg-muted/30 px-3 py-4 text-xs leading-relaxed text-muted-foreground"
    >
      {children}
    </p>
  )
}

function interactive(props: ChartProps) {
  return Boolean(props.onSelectData || props.onSelectPoint)
}

function pointSelected(
  props: ChartProps,
  point: ReportPoint,
  series?: { key: string; label: string }
) {
  if (props.selectedKey === point.key) return true
  const selections = props.selections ?? []
  return series
    ? selections.some(
        (selection) =>
          selectionPointKey(selection) ===
            selectionPointKey(chartSelection(props.card, point, series)) ||
          (selection.filters.length === 1 &&
            selection.filters[0].dimension === props.card.dimension &&
            selection.filters[0].key === point.key)
      )
    : selections.some((selection) =>
        selection.filters.some(
          (filter) =>
            filter.dimension === props.card.dimension &&
            filter.key === point.key
        )
      )
}

function selectionOpacity(
  props: ChartProps,
  point: ReportPoint,
  series?: { key: string; label: string }
) {
  if (
    (props.selectedKey || props.selections?.length) &&
    !pointSelected(props, point, series)
  )
    return 0.3
  if (props.data.highlight) {
    const points =
      series && props.card.legend
        ? props.data.highlight.series?.find((item) => item.key === series.key)
            ?.points
        : props.data.highlight.points
    const entry = points?.find((item) => item.key === point.key)
    if (
      entry?.row_count === 0 ||
      (entry?.row_count == null && highlightValue(props, point, series) === 0)
    )
      return 0.25
  }
  return 1
}

function highlightValue(
  props: ChartProps,
  point: ReportPoint,
  series?: { key: string; label: string }
) {
  const highlight = props.data.highlight
  if (!highlight) return null
  const points =
    series && props.card.legend
      ? highlight.series?.find((item) => item.key === series.key)?.points
      : highlight.points
  return (
    points?.find((item) => item.key === point.key)?.value ??
    emptyMetricValue(props.card.metric)
  )
}

function selectPoint(
  props: ChartProps,
  point: ReportPoint,
  series?: { key: string; label: string }
) {
  if (props.card.dimension === "none" || series?.key === "__other__") return
  const selection = chartSelection(props.card, point, series)
  if (props.onSelectData) props.onSelectData(selection)
  else props.onSelectPoint?.(props.card.dimension, point.key, point.label)
}

function hoverInteraction(
  props: ChartProps,
  point: ReportPoint,
  series?: { key: string; label: string }
) {
  return {
    onMouseEnter: () => {
      if (series?.key !== "__other__")
        props.onHoverData?.(chartSelection(props.card, point, series))
    },
    onMouseLeave: props.onHoverEnd,
    onFocus: () => {
      if (series?.key !== "__other__")
        props.onHoverData?.(chartSelection(props.card, point, series))
    },
    onBlur: props.onHoverEnd,
  }
}

function svgInteraction(
  props: ChartProps,
  point: ReportPoint,
  series?: { key: string; label: string }
) {
  if (
    !interactive(props) ||
    props.card.dimension === "none" ||
    series?.key === "__other__"
  )
    return {}
  const select = () => selectPoint(props, point, series)
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": `${chartSelection(props.card, point, series).label}：${exactValue(series ? seriesValue(props.data, point, series.key) : (point as ReportPoint & { missing?: boolean }).missing ? null : point.value, props.card.metric)}，點選${props.pointActionLabel ?? "篩選"}`,
    "aria-pressed": pointSelected(props, point, series),
    onClick: select,
    onMouseEnter: () =>
      props.onHoverData?.(chartSelection(props.card, point, series)),
    onMouseLeave: props.onHoverEnd,
    onFocus: () =>
      props.onHoverData?.(chartSelection(props.card, point, series)),
    onBlur: props.onHoverEnd,
    onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        select()
      }
    },
    className:
      "cursor-pointer focus-visible:outline-2 focus-visible:outline-ring",
  }
}

function seriesValue(data: CardData, point: ReportPoint, key: string) {
  const value = data.series
    ?.find((item) => item.key === key)
    ?.points.find((item) => item.key === point.key) as
    (ReportPoint & { missing?: boolean }) | undefined
  return value?.missing ? null : value ? value.value : point.value
}

function ValueTable(props: ChartProps & { matrix?: boolean }) {
  const { card, data, matrix = false } = props
  const series = matrix ? (data.series ?? []) : []
  const indexes = series.map(
    (item) => new Map(item.points.map((point) => [point.key, point.value]))
  )
  const secondary = card.secondary_metric
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table
        className={`w-full text-left text-xs ${series.length ? "min-w-max" : "table-fixed"}`}
      >
        <caption className="sr-only">{card.title}分組彙總</caption>
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th
              scope="col"
              className={`${series.length ? "min-w-28" : "w-[42%]"} px-3 py-2.5 font-medium`}
            >
              {DIMENSIONS[card.dimension]}
            </th>
            {series.map((item) => (
              <th
                scope="col"
                key={item.key}
                className="max-w-40 px-3 py-2.5 text-right font-medium break-words"
              >
                {item.label}
              </th>
            ))}
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              {series.length
                ? NON_ADDITIVE_METRICS.includes(card.metric)
                  ? "本列整體"
                  : "合計"
                : METRICS[card.metric].label}
            </th>
            {secondary && (
              <th scope="col" className="px-3 py-2.5 text-right font-medium">
                {METRICS[secondary].label}
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.points.map((point) => (
            <tr
              key={point.key}
              className={
                pointSelected(props, point) ? "bg-primary/8" : undefined
              }
            >
              <th
                scope="row"
                className="max-w-48 px-3 py-2 font-normal break-words"
              >
                {interactive(props) && card.dimension !== "none" ? (
                  <button
                    type="button"
                    className="min-h-11 w-full text-left text-primary underline-offset-2 focus-visible:underline"
                    aria-pressed={pointSelected(props, point)}
                    {...hoverInteraction(props, point)}
                    onClick={() => selectPoint(props, point)}
                  >
                    {point.label}
                  </button>
                ) : (
                  point.label
                )}
              </th>
              {indexes.map((index, column) => (
                <td
                  key={series[column].key}
                  className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums"
                  title={reportTooltip(
                    card,
                    {
                      label: `${point.label} / ${series[column].label}`,
                      value:
                        index.get(point.key) ?? emptyMetricValue(card.metric),
                      row_count: series[column].points.find(
                        (entry) => entry.key === point.key
                      )?.row_count,
                    },
                    {
                      comparison: series[column].points.find(
                        (entry) => entry.key === point.key
                      )?.comparison,
                    }
                  )}
                >
                  <ReportFormattedValue
                    card={card}
                    value={
                      index.get(point.key) ?? emptyMetricValue(card.metric)
                    }
                    domain={reportFormatDomain(card, data)}
                  >
                    {interactive(props) &&
                    series[column].key !== "__other__" ? (
                      <button
                        type="button"
                        className="min-h-10 min-w-12 rounded px-1 text-primary"
                        aria-label={`${point.label} / ${series[column].label}，點選${props.pointActionLabel ?? "篩選"}`}
                        aria-pressed={pointSelected(
                          props,
                          point,
                          series[column]
                        )}
                        {...hoverInteraction(props, point, series[column])}
                        onClick={() =>
                          selectPoint(props, point, series[column])
                        }
                      >
                        <span className="report-value-text">
                          {reportDisplayValue(
                            card,
                            index.get(point.key) ??
                              emptyMetricValue(card.metric),
                            card.metric
                          )}
                        </span>
                      </button>
                    ) : (
                      <span className="report-value-text">
                        {reportDisplayValue(
                          card,
                          index.get(point.key) ?? emptyMetricValue(card.metric),
                          card.metric
                        )}
                      </span>
                    )}
                    {data.highlight && (
                      <span className="block text-xs text-primary">
                        選取{" "}
                        {reportDisplayValue(
                          card,
                          highlightValue(props, point, series[column]),
                          card.metric
                        )}
                      </span>
                    )}
                    <ReportPointComparison
                      card={card}
                      value={
                        series[column].points.find(
                          (item) => item.key === point.key
                        )?.comparison
                      }
                      metric={card.metric}
                    />
                  </ReportFormattedValue>
                </td>
              ))}
              <td
                className={`px-3 py-2.5 text-right break-words tabular-nums ${point.value != null && point.value < 0 ? "text-destructive" : ""}`}
                title={reportTooltip(card, point, {
                  comparison: point.comparison,
                  ...(data.highlight
                    ? { highlight: highlightValue(props, point) }
                    : {}),
                })}
              >
                <ReportFormattedValue
                  card={card}
                  value={point.value}
                  domain={reportFormatDomain(card, data)}
                  total={series.length > 0}
                >
                  <span className="report-value-text">
                    {reportDisplayValue(card, point.value, card.metric)}
                  </span>
                  <ReportPointComparison
                    card={card}
                    value={point.comparison}
                    metric={card.metric}
                  />
                  {data.highlight && (
                    <span className="block text-xs text-primary">
                      選取{" "}
                      {reportDisplayValue(
                        card,
                        highlightValue(props, point),
                        card.metric
                      )}
                    </span>
                  )}
                </ReportFormattedValue>
              </td>
              {secondary && (
                <td
                  className="px-3 py-2.5 text-right break-words tabular-nums"
                  title={reportTooltip(
                    card,
                    {
                      label: point.label,
                      value: point.secondary_value ?? null,
                      row_count: point.row_count,
                    },
                    { metric: secondary }
                  )}
                >
                  <ReportFormattedValue
                    card={card}
                    value={point.secondary_value ?? null}
                    metric={secondary}
                    domain={reportFormatDomain(card, data, secondary)}
                  >
                    <span className="report-value-text">
                      {typeof point.secondary_value === "number"
                        ? reportDisplayValue(
                            card,
                            point.secondary_value,
                            secondary
                          )
                        : "—"}
                    </span>
                  </ReportFormattedValue>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DataDetails(props: ChartProps) {
  const matrix = !!props.data.series?.length
  if (props.expanded) return <ValueTable {...props} matrix={matrix} />
  return (
    <details
      open={props.widgetSize === "large" ? true : undefined}
      className="group rounded-xl border border-border bg-muted/10"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        查看分組彙總數值
        <ChevronDown
          className="size-4 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="px-3 pb-3">
        <ValueTable {...props} matrix={matrix} />
      </div>
    </details>
  )
}

function Legend({
  items,
  card,
  colors,
}: {
  items: { key: string; label: string }[]
  card: ReportCard
  colors: string[]
}) {
  if (card.show_legend === false || items.length < 2) return null
  return (
    <ul
      className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground"
      aria-label="圖例"
    >
      {items.map((item, index) => (
        <li key={item.key} className="flex min-w-0 items-center gap-1.5">
          <span
            className="size-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: colorAt(colors, index) }}
            aria-hidden="true"
          />
          <span className="break-words">{item.label}</span>
        </li>
      ))}
    </ul>
  )
}

function BarChart(props: PlotProps) {
  const { card, data, series, colors } = props
  const stacked = card.visual === "stacked_bar" || card.visual === "percent_bar"
  const percentage = card.visual === "percent_bar"
  const rows = stackRows(data.points, series, percentage)
  const values = stacked
    ? rows.flatMap((row) =>
        row.flatMap((segment) => [segment.start, segment.end])
      )
    : series.flatMap((item) => item.points.map((point) => point.value))
  const domain = percentage
    ? { minimum: 0, maximum: 100 }
    : chartDomain(values, card.target)
  const span = domain.maximum - domain.minimum
  const x = (value: number) => ((value - domain.minimum) / span) * 100
  const baseline = x(0)
  const indexes = series.map(
    (item) => new Map(item.points.map((point) => [point.key, point.value]))
  )
  return (
    <div className="space-y-3">
      <ol
        className={
          card.height === "compact"
            ? "space-y-2"
            : card.height === "tall"
              ? "space-y-5"
              : "space-y-3"
        }
        aria-label={`${card.title}，${DIMENSIONS[card.dimension]}比較`}
      >
        {data.points.map((point, index) => {
          const content = (
            <>
              <div className="mb-1.5 flex items-start justify-between gap-3 text-xs">
                {interactive(props) ? (
                  <button
                    type="button"
                    data-axis="y"
                    style={
                      card.format?.axes?.show_y === false
                        ? { display: "none" }
                        : undefined
                    }
                    className="min-h-8 min-w-0 rounded text-left break-words text-primary"
                    aria-pressed={pointSelected(props, point)}
                    {...hoverInteraction(props, point)}
                    onClick={() => selectPoint(props, point)}
                  >
                    {point.label}
                  </button>
                ) : (
                  <span
                    data-axis="y"
                    style={
                      card.format?.axes?.show_y === false
                        ? { display: "none" }
                        : undefined
                    }
                    className="min-w-0 break-words"
                  >
                    {point.label}
                  </span>
                )}
                {card.show_labels !== false && (
                  <span
                    className={`shrink-0 text-right tabular-nums ${point.value < 0 ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {reportDisplayValue(
                      card,
                      point.missing ? null : point.value,
                      card.metric
                    )}
                  </span>
                )}
              </div>
              {stacked ? (
                <div
                  className={`relative overflow-hidden rounded-sm bg-muted/40 ${card.height === "compact" ? "h-5" : card.height === "tall" ? "h-8" : "h-6"}`}
                >
                  <BarGrid
                    card={card}
                    minimum={domain.minimum}
                    maximum={domain.maximum}
                    percentage={percentage}
                  />
                  <span
                    className="absolute inset-y-0 z-10 w-px bg-muted-foreground/60"
                    style={{ left: `${Math.min(99.8, baseline)}%` }}
                  />
                  {rows[index].map((segment) => {
                    const left = x(Math.min(segment.start, segment.end))
                    const width =
                      (Math.abs(segment.end - segment.start) / span) * 100
                    return (
                      <button
                        type="button"
                        key={series[segment.series].key}
                        disabled={
                          !interactive(props) ||
                          series[segment.series].key === "__other__"
                        }
                        aria-label={`${point.label} / ${series[segment.series].label}：${exactValue(segment.value, card.metric)}，點選${props.pointActionLabel ?? "篩選"}`}
                        aria-pressed={pointSelected(
                          props,
                          point,
                          series[segment.series]
                        )}
                        {...hoverInteraction(
                          props,
                          point,
                          series[segment.series]
                        )}
                        onClick={() =>
                          selectPoint(props, point, series[segment.series])
                        }
                        className="absolute inset-y-0 flex items-center justify-center overflow-hidden text-sm font-medium text-white focus-visible:z-30 focus-visible:outline-2 focus-visible:outline-ring"
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          backgroundColor: pointColor(
                            props,
                            point,
                            segment.series
                          ),
                          opacity: selectionOpacity(
                            props,
                            point,
                            series[segment.series]
                          ),
                        }}
                        title={plotPointTooltip(
                          props,
                          point,
                          series[segment.series],
                          percentage
                            ? (segment.end - segment.start) / 100
                            : undefined
                        )}
                      >
                        {card.show_labels !== false &&
                          width > 13 &&
                          (percentage
                            ? percentValue(segment.end - segment.start)
                            : reportDisplayValue(
                                card,
                                segment.value,
                                card.metric,
                                "compact"
                              ))}
                      </button>
                    )
                  })}
                  {!percentage && typeof card.target === "number" && (
                    <span
                      className="absolute inset-y-0 z-20 border-l-2 border-dashed border-foreground"
                      style={{ left: `${Math.min(99.5, x(card.target))}%` }}
                    />
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  {series.map((item, column) => {
                    if (
                      item.points.find((entry) => entry.key === point.key)
                        ?.missing
                    )
                      return (
                        <span
                          key={item.key}
                          className="block text-xs text-muted-foreground"
                        >
                          {item.label}：無法計算
                        </span>
                      )
                    const value = indexes[column].get(point.key) ?? 0
                    const left = x(Math.min(0, value))
                    const width = (Math.abs(value) / span) * 100
                    return (
                      <button
                        type="button"
                        key={item.key}
                        disabled={
                          !interactive(props) || item.key === "__other__"
                        }
                        aria-label={`${chartSelection(card, point, item).label}：${exactValue(value, card.metric)}，點選${props.pointActionLabel ?? "篩選"}`}
                        aria-pressed={pointSelected(props, point, item)}
                        {...hoverInteraction(props, point, item)}
                        onClick={() => selectPoint(props, point, item)}
                        className={`relative block w-full overflow-hidden rounded-sm bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring ${card.height === "compact" ? "h-5" : card.height === "tall" ? "h-8" : "h-6"}`}
                        style={{
                          opacity: selectionOpacity(props, point, item),
                        }}
                      >
                        <BarGrid
                          card={card}
                          minimum={domain.minimum}
                          maximum={domain.maximum}
                          percentage={percentage}
                        />
                        <span
                          className="absolute inset-y-0 z-10 w-px bg-muted-foreground/60"
                          style={{ left: `${Math.min(99.8, baseline)}%` }}
                        />
                        <span
                          className={`absolute inset-y-0 rounded-sm ${value < 0 && series.length === 1 ? "bg-destructive/80" : ""}`}
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            backgroundColor: pointColor(
                              props,
                              point,
                              column,
                              card.metric,
                              value < 0 && series.length === 1
                                ? REPORT_COLORS[4]
                                : undefined
                            ),
                            opacity:
                              data.highlight &&
                              !NON_ADDITIVE_METRICS.includes(card.metric)
                                ? 0.25
                                : undefined,
                          }}
                          title={plotPointTooltip(props, point, item)}
                        />
                        {data.highlight &&
                          !NON_ADDITIVE_METRICS.includes(card.metric) &&
                          value >= 0 &&
                          (highlightValue(props, point, item) ?? 0) >= 0 &&
                          (highlightValue(props, point, item) ?? 0) <=
                            value && (
                            <span
                              className="absolute inset-y-0 rounded-sm border-2 border-foreground/70"
                              style={{
                                left: `${x(0)}%`,
                                width: `${Math.min(width, (Math.abs(highlightValue(props, point, item) ?? 0) / span) * 100)}%`,
                                backgroundColor: pointColor(
                                  props,
                                  point,
                                  column
                                ),
                              }}
                              title={plotPointTooltip(props, point, item)}
                            />
                          )}
                        {typeof card.target === "number" && (
                          <span
                            className="absolute inset-y-0 z-20 border-l-2 border-dashed border-foreground"
                            style={{
                              left: `${Math.min(99.5, x(card.target))}%`,
                            }}
                          />
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )
          return (
            <li key={point.key}>
              <div
                className={
                  pointSelected(props, point)
                    ? "rounded bg-primary/5"
                    : undefined
                }
              >
                {content}
              </div>
            </li>
          )
        })}
      </ol>
      <BarAxisLabels
        card={card}
        minimum={domain.minimum}
        maximum={domain.maximum}
        percentage={percentage}
      />
      <Legend card={card} colors={colors} items={series} />
    </div>
  )
}

function chartFrame(
  card: ReportCard,
  expanded?: boolean,
  secondary = false,
  data?: NumericCardData,
  measuredWidth?: number
) {
  const width = measuredWidth ?? (expanded ? 480 : 360)
  const height = expanded
    ? 300
    : card.height === "compact"
      ? 180
      : card.height === "tall"
        ? 280
        : 220
  const labelWidth = (metric: ReportMetric, fallback: number) => {
    if (!data || !card.format?.numbers?.[metric]) return fallback
    const amounts =
      metric === card.secondary_metric
        ? data.points.map((point) => point.secondary_value)
        : [
            ...data.points.map((point) => point.value),
            ...(data.series ?? []).flatMap((series) =>
              series.points.map((point) => point.value)
            ),
          ]
    const values = [
      0,
      ...amounts,
      metric === card.metric && card.visual !== "scatter" ? card.target : null,
    ].filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value)
    )
    const labels = values.map((value) =>
      reportDisplayValue(card, value, metric, "axis")
    )
    const measured = Math.max(
      ...labels.map((text) =>
        [...text].reduce(
          (sum, char) =>
            sum + (/[0-9.,+−-]/.test(char) ? 5.5 : /\s/.test(char) ? 3 : 9),
          0
        )
      )
    )
    return Math.max(fallback, Math.min(width / 3, measured + 10))
  }
  const yMetric =
    card.visual === "scatter"
      ? (card.secondary_metric ?? card.metric)
      : card.metric
  return {
    width,
    height,
    left: card.format?.axes?.show_y === false ? 16 : labelWidth(yMetric, 48),
    right:
      width -
      (secondary
        ? card.format?.axes?.show_secondary === false
          ? 14
          : labelWidth(card.secondary_metric ?? card.metric, 52)
        : 14),
    top: card.format?.axes?.show_titles ? 36 : 22,
    bottom: height - (card.format?.axes?.show_titles ? 53 : 35),
  }
}
function axisTicks(
  minimum: number,
  maximum: number,
  metric: ReportMetric,
  percentage = false
) {
  const ticks = [
    minimum,
    minimum + (maximum - minimum) / 3,
    minimum + ((maximum - minimum) * 2) / 3,
    maximum,
  ]
  return [
    ...new Set(
      ticks.map((tick) =>
        percentage
          ? Math.round(tick)
          : METRICS[metric].unit === "count"
            ? Math.round(tick)
            : tick
      )
    ),
  ]
}
function categoryLabel(point: ReportPoint, dimension: ReportDimension) {
  if (dimension === "year") return point.key
  if (dimension === "quarter")
    return `${point.key.slice(0, 4)} Q${point.key.slice(-1)}`
  if (dimension === "month") {
    const match = point.label.match(/(?:\d{4}[-/])?(\d{1,2})$/)
    if (match) return `${Number(match[1])} 月`
  }
  return point.label.length > 7 ? `${point.label.slice(0, 6)}…` : point.label
}

function AxisTitles({
  card,
  frame,
  secondary,
  scatter = false,
}: {
  card: ReportCard
  frame: ReturnType<typeof chartFrame>
  secondary?: ReportMetric
  scatter?: boolean
}) {
  if (!card.format?.axes?.show_titles) return null
  const settings = card.format.axes
  const x =
    settings.x_title ||
    (scatter ? METRICS[card.metric].label : DIMENSIONS[card.dimension])
  const y =
    settings.y_title ||
    METRICS[scatter && secondary ? secondary : card.metric].label
  const right =
    settings.secondary_title || (secondary ? METRICS[secondary].label : "")
  const text = (value: string, maximum = 20) =>
    value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value
  const yMaximum =
    secondary && !scatter
      ? Math.max(4, Math.floor((frame.right - frame.left) / 18))
      : 20
  return (
    <g aria-label="座標軸標題">
      <text
        x={(frame.left + frame.right) / 2}
        y={frame.height - 2}
        textAnchor="middle"
        fontSize="9"
        className="fill-muted-foreground"
      >
        {text(x)}
        <title>{chartTooltip(card, x)}</title>
      </text>
      <text
        x={frame.left}
        y="11"
        fontSize="9"
        className="fill-muted-foreground"
      >
        {text(y, yMaximum)}
        <title>{chartTooltip(card, y)}</title>
      </text>
      {secondary && !scatter && (
        <text
          x={frame.right}
          y="11"
          textAnchor="end"
          fontSize="9"
          className="fill-muted-foreground"
        >
          {text(right, yMaximum)}
          <title>{chartTooltip(card, right)}</title>
        </text>
      )}
    </g>
  )
}
function BarGrid({
  card,
  minimum,
  maximum,
  percentage,
}: {
  card: ReportCard
  minimum: number
  maximum: number
  percentage: boolean
}) {
  if (card.format?.axes?.show_grid === false) return null
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      data-grid="true"
    >
      {axisTicks(minimum, maximum, card.metric, percentage).map((tick) => (
        <span
          key={tick}
          className="absolute inset-y-0 w-px bg-border/80"
          style={{ left: `${((tick - minimum) / (maximum - minimum)) * 100}%` }}
        />
      ))}
    </span>
  )
}
function BarAxisLabels({
  card,
  minimum,
  maximum,
  percentage,
}: {
  card: ReportCard
  minimum: number
  maximum: number
  percentage: boolean
}) {
  const settings = card.format?.axes
  return (
    <div className="space-y-1">
      {settings?.show_x !== false && (
        <div
          className="relative h-5 text-xs text-muted-foreground"
          data-axis="x"
        >
          {axisTicks(minimum, maximum, card.metric, percentage).map(
            (tick, index, list) => (
              <span
                key={tick}
                className="absolute max-w-[30%] truncate"
                style={{
                  left: `${((tick - minimum) / (maximum - minimum)) * 100}%`,
                  transform:
                    index === 0
                      ? undefined
                      : index === list.length - 1
                        ? "translateX(-100%)"
                        : "translateX(-50%)",
                }}
                title={chartTooltip(
                  card,
                  percentage
                    ? `${tick}%`
                    : formatReportExactValue(tick, card.metric)
                )}
              >
                {percentage
                  ? `${tick}%`
                  : reportDisplayValue(card, tick, card.metric, "axis")}
              </span>
            )
          )}
        </div>
      )}
      {settings?.show_titles && (
        <p className="text-xs text-muted-foreground">
          X 軸：{settings.x_title || METRICS[card.metric].label} · Y 軸：
          {settings.y_title || DIMENSIONS[card.dimension]}
        </p>
      )}
    </div>
  )
}

/** Keep chart labels at readable sizes instead of scaling a phone plot across desktop. */
function useReadingPlotWidth(container: HTMLDivElement | null) {
  const [width, setWidth] = useState<number>()
  useLayoutEffect(() => {
    if (!container) return
    const measure = () => {
      const next = Math.round(container.clientWidth)
      if (next > 0) setWidth(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [container])
  return width
}

function ColumnChart(props: PlotProps) {
  const { card, data, series, colors, expanded } = props
  const [plotElement, setPlotElement] = useState<HTMLDivElement | null>(null)
  const plotWidth = useReadingPlotWidth(plotElement)
  const stacked =
    card.visual === "stacked_column" || card.visual === "percent_column"
  const percentage = card.visual === "percent_column"
  const frame = chartFrame(
    card,
    expanded,
    false,
    data,
    props.summary ? plotWidth : undefined
  )
  const rows = stackRows(data.points, series, percentage)
  const values = stacked
    ? rows.flatMap((row) =>
        row.flatMap((segment) => [segment.start, segment.end])
      )
    : series.flatMap((item) => item.points.map((point) => point.value))
  const { minimum, maximum } = percentage
    ? { minimum: 0, maximum: 100 }
    : chartDomain(values, card.target)
  const y = (value: number) =>
    frame.bottom -
    ((value - minimum) / (maximum - minimum)) * (frame.bottom - frame.top)
  const band = (frame.right - frame.left) / data.points.length
  const indexes = series.map(
    (item) => new Map(item.points.map((point) => [point.key, point.value]))
  )
  const labelStep = Math.max(1, Math.ceil(data.points.length / 6))
  const peak = data.points.findIndex(
    (point) =>
      point.value === Math.max(...data.points.map((item) => item.value))
  )
  return (
    <div ref={setPlotElement} className="space-y-3">
      <svg
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        className="block h-auto w-full"
        role={interactive(props) ? "group" : "img"}
        aria-label={`${card.title}，${percentage ? "百分比" : "直條"}比較`}
      >
        <title>{chartTooltip(card, card.title)}</title>
        {axisTicks(minimum, maximum, card.metric, percentage).map((tick) => (
          <g key={tick}>
            <line
              x1={frame.left}
              x2={frame.right}
              y1={y(tick)}
              y2={y(tick)}
              data-grid="true"
              style={
                card.format?.axes?.show_grid === false
                  ? { display: "none" }
                  : undefined
              }
              className="stroke-border"
              strokeDasharray="3 4"
            />
            <text
              data-axis="y"
              style={
                card.format?.axes?.show_y === false
                  ? { display: "none" }
                  : undefined
              }
              x={frame.left - 6}
              y={y(tick) + 3}
              textAnchor="end"
              fontSize="9"
              className="fill-muted-foreground"
            >
              {percentage ? `${tick}%` : axisValue(tick, card.metric, card)}
            </text>
          </g>
        ))}
        <line
          x1={frame.left}
          x2={frame.right}
          y1={y(0)}
          y2={y(0)}
          className="stroke-muted-foreground/60"
        />
        {data.points.map((point, index) => (
          <g key={point.key}>
            <title>{plotPointTooltip(props, point)}</title>
            {(stacked
              ? rows[index]
              : series.map((_, column) => {
                  const value = indexes[column].get(point.key) ?? 0
                  return { series: column, value, start: 0, end: value }
                })
            ).map((segment) => {
              if (
                series[segment.series].points.find(
                  (entry) => entry.key === point.key
                )?.missing
              )
                return null
              const barWidth = (band * 0.7) / (stacked ? 1 : series.length)
              const x =
                frame.left +
                band * index +
                band * 0.15 +
                (stacked ? 0 : barWidth * segment.series)
              const top = y(Math.max(segment.start, segment.end))
              const height = Math.abs(y(segment.end) - y(segment.start))
              return (
                <g
                  key={series[segment.series].key}
                  {...svgInteraction(props, point, series[segment.series])}
                  opacity={selectionOpacity(
                    props,
                    point,
                    series[segment.series]
                  )}
                >
                  <rect
                    x={x}
                    y={top}
                    width={Math.max(1, barWidth - (stacked ? 0 : 1))}
                    height={height}
                    fill={pointColor(props, point, segment.series)}
                    fillOpacity={data.highlight ? 0.25 : 1}
                    rx="1"
                  >
                    <title>
                      {plotPointTooltip(
                        props,
                        point,
                        series[segment.series],
                        percentage
                          ? (segment.end - segment.start) / 100
                          : undefined
                      )}
                    </title>
                  </rect>
                  {data.highlight &&
                    !NON_ADDITIVE_METRICS.includes(card.metric) &&
                    segment.value > 0 &&
                    (highlightValue(props, point, series[segment.series]) ??
                      0) >= 0 &&
                    (highlightValue(props, point, series[segment.series]) ??
                      0) <= segment.value && (
                      <rect
                        x={x}
                        y={
                          top +
                          height *
                            (1 -
                              Math.min(
                                1,
                                (highlightValue(
                                  props,
                                  point,
                                  series[segment.series]
                                ) ?? 0) / segment.value
                              ))
                        }
                        width={Math.max(1, barWidth - (stacked ? 0 : 1))}
                        height={
                          height *
                          Math.min(
                            1,
                            (highlightValue(
                              props,
                              point,
                              series[segment.series]
                            ) ?? 0) / segment.value
                          )
                        }
                        fill={pointColor(props, point, segment.series)}
                        stroke="currentColor"
                        strokeWidth="0.5"
                      >
                        <title>
                          {plotPointTooltip(
                            props,
                            point,
                            series[segment.series]
                          )}
                        </title>
                      </rect>
                    )}
                  {card.show_labels !== false &&
                    (stacked
                      ? height > 16 && barWidth > 30
                      : series.length === 1 &&
                        (data.points.length <= 6 ||
                          index === peak ||
                          index === data.points.length - 1)) && (
                      <text
                        x={x + barWidth / 2}
                        y={
                          stacked
                            ? top + height / 2 + 3
                            : segment.value >= 0
                              ? Math.max(10, top - 5)
                              : top + height + 11
                        }
                        textAnchor="middle"
                        fontSize="9"
                        fill={stacked ? "white" : "currentColor"}
                      >
                        {percentage
                          ? percentValue(segment.end - segment.start)
                          : reportDisplayValue(
                              card,
                              segment.value,
                              card.metric,
                              "compact"
                            )}
                      </text>
                    )}
                </g>
              )
            })}
            {(index === 0 ||
              index === data.points.length - 1 ||
              (index % labelStep === 0 &&
                index < data.points.length - labelStep)) && (
              <text
                x={frame.left + band * (index + 0.5)}
                data-axis="x"
                style={
                  card.format?.axes?.show_x === false
                    ? { display: "none" }
                    : undefined
                }
                y={frame.height - 12}
                textAnchor="middle"
                fontSize="10"
                className="fill-muted-foreground"
              >
                {categoryLabel(point, card.dimension)}
              </text>
            )}
          </g>
        ))}
        {!percentage && typeof card.target === "number" && (
          <g>
            <line
              x1={frame.left}
              x2={frame.right}
              y1={y(card.target)}
              y2={y(card.target)}
              className="stroke-foreground"
              strokeDasharray="5 3"
            />
            <title>
              {chartTooltip(
                card,
                `目標：${exactValue(card.target, card.metric)}`
              )}
            </title>
          </g>
        )}
        <AxisTitles card={card} frame={frame} />
      </svg>
      <Legend card={card} colors={colors} items={series} />
    </div>
  )
}

function SeriesPath({
  props,
  path,
  x,
  y,
  value,
  column,
  metric = props.card.metric,
  area = false,
}: {
  props: PlotProps
  path: number[]
  x: (index: number) => number
  y: (value: number) => number
  value: (index: number) => number
  column: number
  metric?: ReportMetric
  area?: boolean
}) {
  const conditional = props.card.format?.conditional?.[metric]?.color_mode
  const colored = conditional === "rules" || conditional === "gradient"
  const parts = colored
    ? path.slice(1).map((end, index) => [path[index], end])
    : [path]
  return (
    <>
      {parts.map((part, index) => {
        const color = colored
          ? pointColor(
              props,
              props.data.points[part[part.length - 1]],
              column,
              metric
            )
          : colorAt(props.colors, column)
        const coords = part.map((row) => `${x(row)},${y(value(row))}`).join(" ")
        return (
          <g key={index}>
            {area && (
              <polygon
                points={`${x(part[0])},${y(0)} ${coords} ${x(part[part.length - 1])},${y(0)}`}
                fill={color}
                fillOpacity="0.16"
              />
            )}
            <polyline
              points={coords}
              fill="none"
              stroke={color}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              pointerEvents="none"
            />
          </g>
        )
      })}
    </>
  )
}

function TrendChart(props: PlotProps) {
  const { card, data, series, colors, expanded } = props
  const [plotElement, setPlotElement] = useState<HTMLDivElement | null>(null)
  const plotWidth = useReadingPlotWidth(plotElement)
  const frame = chartFrame(
    props.plotOnly ? { ...card, height: "compact" } : card,
    expanded,
    false,
    data,
    props.summary || props.plotOnly ? plotWidth : undefined
  )
  const domain = chartDomain(
    series.flatMap((item) => item.points.map((point) => point.value)),
    card.target
  )
  const padding = (domain.maximum - domain.minimum) * 0.1
  const minimum = domain.minimum - padding
  const maximum = domain.maximum + padding
  const x = (index: number) =>
    data.points.length === 1
      ? (frame.left + frame.right) / 2
      : frame.left +
        (index / (data.points.length - 1)) * (frame.right - frame.left)
  const y = (value: number) =>
    frame.bottom -
    ((value - minimum) / (maximum - minimum)) * (frame.bottom - frame.top)
  const labelStep = Math.max(1, Math.ceil(data.points.length / 6))
  return (
    <div ref={setPlotElement} className="space-y-3">
      <svg
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        className="block h-auto w-full"
        role={interactive(props) ? "group" : "img"}
        aria-label={`${card.title}日期趨勢，可展開查看分組數值`}
      >
        <title>{chartTooltip(card, `${card.title}日期趨勢`)}</title>
        {axisTicks(domain.minimum, domain.maximum, card.metric).map((tick) => (
          <g key={tick}>
            <line
              x1={frame.left}
              x2={frame.right}
              y1={y(tick)}
              y2={y(tick)}
              data-grid="true"
              style={
                card.format?.axes?.show_grid === false
                  ? { display: "none" }
                  : undefined
              }
              className="stroke-border"
              strokeDasharray="3 4"
            />
            <text
              data-axis="y"
              style={
                card.format?.axes?.show_y === false
                  ? { display: "none" }
                  : undefined
              }
              x={frame.left - 6}
              y={y(tick) + 3}
              textAnchor="end"
              fontSize="9"
              className="fill-muted-foreground"
            >
              {axisValue(tick, card.metric, card)}
            </text>
          </g>
        ))}
        <line
          x1={frame.left}
          x2={frame.right}
          y1={y(0)}
          y2={y(0)}
          className="stroke-muted-foreground/60"
        />
        {series.map((item, column) => {
          const index = new Map(
            item.points.map((point) => [point.key, point.value])
          )
          const values = data.points.map((point) => index.get(point.key) ?? 0)
          const paths = trendSegments(
            data.points.map((point) => point.key),
            item.points
          )
          return (
            <g key={item.key}>
              {paths.map((path, segment) => (
                <SeriesPath
                  key={segment}
                  props={props}
                  path={path}
                  x={x}
                  y={y}
                  value={(row) => values[row]}
                  column={column}
                  area={card.visual === "area"}
                />
              ))}
              {data.points.map((point, row) =>
                item.points.find((entry) => entry.key === point.key)
                  ?.missing ? null : (
                  <g
                    key={point.key}
                    {...svgInteraction(props, point, item)}
                    opacity={selectionOpacity(props, point, item)}
                  >
                    <circle
                      cx={x(row)}
                      cy={y(values[row])}
                      r={pointSelected(props, point) ? 5 : 3.5}
                      fill={pointColor(props, point, column)}
                      className="stroke-card"
                      strokeWidth="1.5"
                    >
                      <title>{plotPointTooltip(props, point, item)}</title>
                    </circle>
                    {card.show_labels !== false &&
                      series.length === 1 &&
                      (data.points.length <= 6 ||
                        row === values.indexOf(Math.max(...values)) ||
                        row === values.length - 1) && (
                        <text
                          x={x(row)}
                          y={y(values[row]) - 8}
                          textAnchor="middle"
                          fontSize="9"
                          className="fill-foreground"
                        >
                          {reportDisplayValue(
                            card,
                            values[row],
                            card.metric,
                            "compact"
                          )}
                        </text>
                      )}
                  </g>
                )
              )}
            </g>
          )
        })}
        {data.points.map(
          (point, index) =>
            (index === 0 ||
              index === data.points.length - 1 ||
              (index % labelStep === 0 &&
                index < data.points.length - labelStep)) && (
              <text
                key={point.key}
                x={x(index)}
                data-axis="x"
                style={
                  card.format?.axes?.show_x === false
                    ? { display: "none" }
                    : undefined
                }
                y={frame.height - 12}
                textAnchor={
                  index === 0
                    ? "start"
                    : index === data.points.length - 1
                      ? "end"
                      : "middle"
                }
                fontSize="10"
                className="fill-muted-foreground"
              >
                {categoryLabel(point, card.dimension)}
              </text>
            )
        )}
        {typeof card.target === "number" && (
          <g>
            <line
              x1={frame.left}
              x2={frame.right}
              y1={y(card.target)}
              y2={y(card.target)}
              className="stroke-foreground"
              strokeDasharray="5 3"
            />
            <title>
              {chartTooltip(
                card,
                `目標：${exactValue(card.target, card.metric)}`
              )}
            </title>
          </g>
        )}
        <AxisTitles card={card} frame={frame} />
      </svg>
      <Legend card={card} colors={colors} items={series} />
    </div>
  )
}

function piePath(
  start: number,
  end: number,
  inner: number,
  cy: number,
  radius: number
) {
  const cx = 180
  const position = (angle: number, r: number) => [
    cx + Math.cos(angle) * r,
    cy + Math.sin(angle) * r,
  ]
  const [sx, sy] = position(start, radius)
  const [ex, ey] = position(end, radius)
  const large = end - start > Math.PI ? 1 : 0
  if (inner) {
    const [isx, isy] = position(start, inner)
    const [iex, iey] = position(end, inner)
    return `M${sx} ${sy} A${radius} ${radius} 0 ${large} 1 ${ex} ${ey} L${iex} ${iey} A${inner} ${inner} 0 ${large} 0 ${isx} ${isy} Z`
  }
  return `M${cx} ${cy} L${sx} ${sy} A${radius} ${radius} 0 ${large} 1 ${ex} ${ey} Z`
}

function ShareChart(props: PlotProps) {
  const { card, data, colors } = props
  const sum = data.points.reduce((total, point) => total + point.value, 0)
  const positive = data.points.filter((point) => point.value > 0)
  let angle = -Math.PI / 2
  const donut = card.visual === "donut"
  const height = props.expanded
    ? 280
    : card.height === "compact"
      ? 150
      : card.height === "tall"
        ? 260
        : 190
  const cy = height / 2
  const radius = Math.min(120, (height - 36) / 2)
  const inner = radius * 0.58
  const rectangles =
    card.visual === "treemap" ? treeRects(data.points, 360, height) : []
  return (
    <div className="space-y-3">
      {sum <= 0 ? (
        <Unsupported>
          分類數值皆為 0，目前無法計算占比。下方保留完整數值。
        </Unsupported>
      ) : (
        <svg
          viewBox={`0 0 360 ${height}`}
          className="block h-auto w-full"
          role={interactive(props) ? "group" : "img"}
          aria-label={`${card.title}，以圖中分類合計計算占比`}
        >
          <title>{chartTooltip(card, card.title)}</title>
          {card.visual === "treemap"
            ? rectangles.map(({ point, x, y, width, height }) => {
                const index = data.points.findIndex(
                  (item) => item.key === point.key
                )
                return (
                  <g
                    key={point.key}
                    {...svgInteraction(props, point)}
                    opacity={selectionOpacity(props, point)}
                  >
                    <title>
                      {plotPointTooltip(
                        props,
                        point,
                        undefined,
                        point.value / sum
                      )}
                    </title>
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={height}
                      fill={colorAt(colors, index)}
                      className="stroke-card"
                      strokeWidth="2"
                    />
                    {card.show_labels !== false &&
                      width > 60 &&
                      height > 36 && (
                        <text
                          x={x + width / 2}
                          y={y + height / 2 - 2}
                          textAnchor="middle"
                          fill="white"
                          fontSize="11"
                        >
                          <tspan x={x + width / 2}>
                            {point.label.slice(0, Math.floor(width / 13))}
                          </tspan>
                          <tspan x={x + width / 2} dy="15">
                            {percentValue((point.value / sum) * 100)}
                          </tspan>
                        </text>
                      )}
                  </g>
                )
              })
            : positive.map((point) => {
                const share = point.value / sum
                const start = angle
                const end = angle + share * Math.PI * 2
                angle = end
                const middle = (start + end) / 2
                const index = data.points.findIndex(
                  (item) => item.key === point.key
                )
                return (
                  <g
                    key={point.key}
                    {...svgInteraction(props, point)}
                    opacity={selectionOpacity(props, point)}
                  >
                    <title>
                      {plotPointTooltip(props, point, undefined, share)}
                    </title>
                    {positive.length === 1 ? (
                      <circle
                        cx="180"
                        cy={cy}
                        r={donut ? (radius + inner) / 2 : radius}
                        fill={donut ? "none" : colorAt(colors, index)}
                        stroke={donut ? colorAt(colors, index) : undefined}
                        strokeWidth={donut ? radius - inner : undefined}
                      />
                    ) : (
                      <path
                        d={piePath(start, end, donut ? inner : 0, cy, radius)}
                        fill={colorAt(colors, index)}
                        className="stroke-card"
                        strokeWidth="1.5"
                      />
                    )}
                    {card.show_labels !== false && share >= 0.07 && (
                      <text
                        x={
                          180 +
                          Math.cos(middle) * radius * (donut ? 0.79 : 0.64)
                        }
                        y={
                          cy +
                          Math.sin(middle) * radius * (donut ? 0.79 : 0.64) +
                          3
                        }
                        textAnchor="middle"
                        fill="white"
                        fontSize="11"
                      >
                        {percentValue(share * 100)}
                      </text>
                    )}
                  </g>
                )
              })}
          {donut && (
            <text
              x="180"
              y={cy - 2}
              textAnchor="middle"
              fontSize="13"
              className="fill-foreground"
            >
              <tspan x="180">
                {reportDisplayValue(card, sum, card.metric, "compact")}
              </tspan>
              <tspan
                x="180"
                dy="17"
                fontSize="10"
                className="fill-muted-foreground"
              >
                圖中分類合計
              </tspan>
            </text>
          )}
        </svg>
      )}
      <Legend card={card} colors={colors} items={data.points} />
    </div>
  )
}

function ComboChart(props: PlotProps) {
  const { card, data, colors, expanded } = props
  const secondary = card.secondary_metric
  if (
    !secondary ||
    !data.points.some((point) => typeof point.secondary_value === "number")
  )
    return (
      <Unsupported>
        請選擇第二指標，並確認目前範圍有對應數值，才能呈現組合圖。
      </Unsupported>
    )
  const frame = chartFrame(card, expanded, true, data)
  const primaryDomain = chartDomain(
    data.points.map((point) => point.value),
    card.target
  )
  const secondaryDomain = chartDomain(
    data.points.flatMap((point) =>
      typeof point.secondary_value === "number" ? [point.secondary_value] : []
    )
  )
  const y = (value: number) =>
    frame.bottom -
    ((value - primaryDomain.minimum) /
      (primaryDomain.maximum - primaryDomain.minimum)) *
      (frame.bottom - frame.top)
  const y2 = (value: number) =>
    frame.bottom -
    ((value - secondaryDomain.minimum) /
      (secondaryDomain.maximum - secondaryDomain.minimum)) *
      (frame.bottom - frame.top)
  const band = (frame.right - frame.left) / data.points.length
  const x = (index: number) => frame.left + band * (index + 0.5)
  const paths: number[][] = [[]]
  data.points.forEach((point, index) => {
    if (typeof point.secondary_value === "number")
      paths[paths.length - 1].push(index)
    else if (paths.at(-1)?.length) paths.push([])
  })
  const secondaryColor = colorAt(colors, 1)
  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        className="block h-auto w-full"
        role={interactive(props) ? "group" : "img"}
        aria-label={`${card.title}：直條 ${METRICS[card.metric].label} 使用左軸，折線 ${METRICS[secondary].label} 使用右軸`}
      >
        <title>
          {chartTooltip(
            card,
            `${METRICS[card.metric].label}（左軸）與${METRICS[secondary].label}（右軸），兩軸刻度獨立`
          )}
        </title>
        {axisTicks(
          primaryDomain.minimum,
          primaryDomain.maximum,
          card.metric
        ).map((tick) => (
          <g key={tick}>
            <line
              x1={frame.left}
              x2={frame.right}
              y1={y(tick)}
              y2={y(tick)}
              data-grid="true"
              style={
                card.format?.axes?.show_grid === false
                  ? { display: "none" }
                  : undefined
              }
              className="stroke-border"
              strokeDasharray="3 4"
            />
            <text
              data-axis="y"
              style={
                card.format?.axes?.show_y === false
                  ? { display: "none" }
                  : undefined
              }
              x={frame.left - 5}
              y={y(tick) + 3}
              textAnchor="end"
              fontSize="8"
              className="fill-muted-foreground"
            >
              {axisValue(tick, card.metric, card)}
            </text>
          </g>
        ))}
        {axisTicks(
          secondaryDomain.minimum,
          secondaryDomain.maximum,
          secondary
        ).map((tick) => (
          <text
            key={tick}
            data-axis="secondary"
            style={
              card.format?.axes?.show_secondary === false
                ? { display: "none" }
                : undefined
            }
            x={frame.right + 5}
            y={y2(tick) + 3}
            fontSize="8"
            fill={secondaryColor}
          >
            {axisValue(tick, secondary, card)}
          </text>
        ))}
        <line
          x1={frame.left}
          x2={frame.right}
          y1={y(0)}
          y2={y(0)}
          className="stroke-muted-foreground/60"
        />
        {data.points.map((point, index) => (
          <g
            key={point.key}
            {...svgInteraction(props, point)}
            opacity={selectionOpacity(props, point)}
          >
            <title>{plotPointTooltip(props, point)}</title>
            {!point.missing && (
              <rect
                x={x(index) - band * 0.28}
                y={Math.min(y(point.value), y(0))}
                width={band * 0.56}
                height={Math.abs(y(point.value) - y(0))}
                fill={pointColor(props, point)}
                fillOpacity="0.8"
                rx="1"
              />
            )}
            {typeof point.secondary_value === "number" && (
              <circle
                cx={x(index)}
                cy={y2(point.secondary_value)}
                r="3.5"
                fill={pointColor(props, point, 1, secondary)}
                className="stroke-card"
                strokeWidth="1.5"
              />
            )}
            {!point.missing &&
              card.show_labels !== false &&
              data.points.length <= 6 && (
                <text
                  x={x(index)}
                  y={Math.max(12, y(point.value) - 5)}
                  fontSize="9"
                  textAnchor="middle"
                  className="fill-foreground"
                >
                  {reportDisplayValue(
                    card,
                    point.value,
                    card.metric,
                    "compact"
                  )}
                </text>
              )}
            {(data.points.length <= 6 || index % 2 === 0) && (
              <text
                x={x(index)}
                data-axis="x"
                style={
                  card.format?.axes?.show_x === false
                    ? { display: "none" }
                    : undefined
                }
                y={frame.height - 12}
                textAnchor="middle"
                fontSize="10"
                className="fill-muted-foreground"
              >
                {categoryLabel(point, card.dimension)}
              </text>
            )}
          </g>
        ))}
        {paths
          .filter((path) => path.length > 1)
          .map((path, index) => (
            <SeriesPath
              key={index}
              props={props}
              path={path}
              x={x}
              y={y2}
              value={(row) => data.points[row].secondary_value as number}
              column={1}
              metric={secondary}
            />
          ))}
        {typeof card.target === "number" && (
          <g>
            <line
              x1={frame.left}
              x2={frame.right}
              y1={y(card.target)}
              y2={y(card.target)}
              className="stroke-foreground"
              strokeDasharray="5 3"
            />
            <title>
              {chartTooltip(
                card,
                `左軸目標：${exactValue(card.target, card.metric)}`
              )}
            </title>
          </g>
        )}
        <AxisTitles card={card} frame={frame} secondary={secondary} />
      </svg>
      <p className="text-xs text-muted-foreground">
        左軸：{METRICS[card.metric].label} · 右軸：{METRICS[secondary].label}
        （獨立刻度）
      </p>
      <Legend
        card={card}
        colors={colors}
        items={[
          { key: "primary", label: `${METRICS[card.metric].label} · 直條` },
          { key: "secondary", label: `${METRICS[secondary].label} · 折線` },
        ]}
      />
    </div>
  )
}

function ScatterChart(props: PlotProps) {
  const { card, data, expanded } = props
  const secondary = card.secondary_metric
  const points = data.points.filter(
    (point) => !point.missing && typeof point.secondary_value === "number"
  )
  if (!secondary || !points.length)
    return (
      <Unsupported>
        散佈圖需要兩個真實指標。目前沒有第二指標的對應數值，請改用比較圖或選擇第二指標。
      </Unsupported>
    )
  const frame = chartFrame(card, expanded, false, data)
  const xDomain = chartDomain(points.map((point) => point.value))
  const yDomain = chartDomain(
    points.map((point) => point.secondary_value as number)
  )
  const x = (value: number) =>
    frame.left +
    ((value - xDomain.minimum) / (xDomain.maximum - xDomain.minimum)) *
      (frame.right - frame.left)
  const y = (value: number) =>
    frame.bottom -
    ((value - yDomain.minimum) / (yDomain.maximum - yDomain.minimum)) *
      (frame.bottom - frame.top)
  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        className="block h-auto w-full"
        role={interactive(props) ? "group" : "img"}
        aria-label={`${card.title}：橫軸 ${METRICS[card.metric].label}，縱軸 ${METRICS[secondary].label}`}
      >
        <title>
          {chartTooltip(
            card,
            `${METRICS[card.metric].label}與${METRICS[secondary].label}的實際數值關係`
          )}
        </title>
        {axisTicks(yDomain.minimum, yDomain.maximum, secondary).map((tick) => (
          <g key={tick}>
            <line
              x1={frame.left}
              x2={frame.right}
              y1={y(tick)}
              y2={y(tick)}
              data-grid="true"
              style={
                card.format?.axes?.show_grid === false
                  ? { display: "none" }
                  : undefined
              }
              className="stroke-border"
              strokeDasharray="3 4"
            />
            <text
              data-axis="y"
              style={{
                display:
                  card.format?.axes?.show_y === false ? "none" : undefined,
                fill: card.format?.metric_colors?.[secondary],
              }}
              x={frame.left - 5}
              y={y(tick) + 3}
              textAnchor="end"
              fontSize="9"
              className="fill-muted-foreground"
            >
              {axisValue(tick, secondary, card)}
            </text>
          </g>
        ))}
        {axisTicks(xDomain.minimum, xDomain.maximum, card.metric).map(
          (tick) => (
            <text
              key={tick}
              x={x(tick)}
              data-axis="x"
              style={{
                display:
                  card.format?.axes?.show_x === false ? "none" : undefined,
                fill: card.format?.metric_colors?.[card.metric],
              }}
              y={frame.height - 12}
              textAnchor={
                tick === xDomain.minimum
                  ? "start"
                  : tick === xDomain.maximum
                    ? "end"
                    : "middle"
              }
              fontSize="9"
              className="fill-muted-foreground"
            >
              {axisValue(tick, card.metric, card)}
            </text>
          )
        )}
        <line
          x1={x(0)}
          x2={x(0)}
          y1={frame.top}
          y2={frame.bottom}
          className="stroke-muted-foreground/60"
        />
        <line
          x1={frame.left}
          x2={frame.right}
          y1={y(0)}
          y2={y(0)}
          className="stroke-muted-foreground/60"
        />
        {points.map((point) => (
          <g
            key={point.key}
            {...svgInteraction(props, point)}
            opacity={selectionOpacity(props, point)}
          >
            <circle
              cx={x(point.value)}
              cy={y(point.secondary_value as number)}
              r={pointSelected(props, point) ? 7 : 5}
              fill={
                reportConditionalColor(
                  card,
                  point.value,
                  reportFormatDomain(card, data)
                ) ??
                reportConditionalColor(
                  card,
                  point.secondary_value ?? null,
                  reportFormatDomain(card, data, secondary),
                  secondary
                ) ??
                pointColor(props, point)
              }
              fillOpacity="0.75"
              className="stroke-card"
              strokeWidth="1.5"
            >
              <title>{plotPointTooltip(props, point)}</title>
            </circle>
            {card.show_labels !== false && (
              <text
                x={Math.min(frame.right - 4, x(point.value) + 9)}
                y={Math.max(12, y(point.secondary_value as number) - 7)}
                fontSize="10"
                textAnchor={x(point.value) > frame.right - 70 ? "end" : "start"}
                className="fill-foreground"
              >
                {categoryLabel(point, card.dimension)}
              </text>
            )}
          </g>
        ))}
        <AxisTitles card={card} frame={frame} secondary={secondary} scatter />
      </svg>
      <p className="text-xs text-muted-foreground">
        橫軸：{METRICS[card.metric].label} · 縱軸：{METRICS[secondary].label}
      </p>
      {points.length !== data.points.length && (
        <p className="text-xs text-muted-foreground">
          {data.points.length - points.length} 個分類沒有第二指標，未繪製散點。
        </p>
      )}
    </div>
  )
}

function HighlightSummary(props: ChartProps) {
  const highlight = props.data.highlight
  if (!highlight) return null
  if (props.widgetSize && props.widgetSize !== "large")
    return (
      <p role="status" className="text-xs text-primary">
        聯動選取
        {NON_ADDITIVE_METRICS.includes(props.card.metric) ? "指標" : "合計"}：
        {reportDisplayValue(
          props.card,
          highlight.total,
          props.card.metric,
          "compact"
        )}
      </p>
    )
  return (
    <div
      className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs"
      role="status"
    >
      <p className="font-medium text-primary">
        聯動選取
        {NON_ADDITIVE_METRICS.includes(props.card.metric) ? "指標" : "合計"}：
        {reportDisplayValue(props.card, highlight.total, props.card.metric)}
      </p>
      <ReportComparisonSummary
        card={props.card}
        comparison={highlight.comparison}
        metric={props.card.metric}
        label="聯動子集比較"
      />
    </div>
  )
}

function WidgetTarget({ card, data }: ChartProps) {
  if (
    card.target == null ||
    card.target <= 0 ||
    data.total == null ||
    data.total < 0
  )
    return null
  const percent = (data.total / card.target) * 100
  return (
    <div className="report-widget-target">
      <div className="mb-1.5 flex flex-wrap justify-between gap-1 text-xs text-muted-foreground">
        <span>
          目標 {reportDisplayValue(card, card.target, card.metric, "compact")}
        </span>
        <span>
          {percent.toLocaleString("zh-TW", { maximumFractionDigits: 1 })}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="目標達成率"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, percent)}
        aria-valuetext={`${percent.toLocaleString("zh-TW", { maximumFractionDigits: 1 })}%`}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
    </div>
  )
}

export function ReportChart(input: ChartProps) {
  // Presentation overrides never alter the saved visual, fields, or query data.
  const props = input.widgetSize
    ? {
        ...input,
        summary: input.widgetSize !== "large",
        card: {
          ...input.card,
          height:
            input.widgetSize === "large"
              ? ("tall" as const)
              : ("compact" as const),
        },
      }
    : input
  const { card, data } = props
  if (card.visual === "kpi" || props.widgetSize === "small")
    return (
      <div className="space-y-2">
        <Total
          card={card}
          total={data.total}
          data={data}
          large
          summary={props.summary}
          showTarget={!props.widgetSize}
        />
        <ReportComparisonSummary
          card={card}
          comparison={data.comparison}
          metric={card.metric}
          compact={!!props.widgetSize && props.widgetSize !== "large"}
        />
        <HighlightSummary {...props} />
        {props.widgetSize && <WidgetTarget {...props} />}
        {props.widgetSize === "large" && data.points.length > 0 && (
          <DataDetails {...props} />
        )}
      </div>
    )
  const series = chartSeries(data, METRICS[card.metric].label)
  const share = ["pie", "donut", "treemap"].includes(card.visual)
  const colors = share
    ? data.points.map(
        (point, index) =>
          reportConditionalColor(
            card,
            point.value,
            reportFormatDomain(card, data)
          ) ?? reportSeriesColor(card, point.key, index, card.dimension)
      )
    : card.visual === "combo" || card.visual === "scatter"
      ? [
          reportSeriesColor(card, "primary", 0, "none"),
          reportSeriesColor(
            card,
            "primary",
            1,
            "none",
            card.secondary_metric ?? card.metric
          ),
        ]
      : series.map((item, index) =>
          reportSeriesColor(card, item.key, index, card.legend ?? "none")
        )
  const plot = {
    ...props,
    data: numericCardData(data),
    series,
    colors,
  }
  const percentage =
    card.visual === "percent_bar" || card.visual === "percent_column"
  const negative = share
    ? data.points.some((point) => point.value != null && point.value < 0)
    : series.some((item) => item.points.some((point) => point.value < 0))
  let chart: ReactNode
  if (
    NON_ADDITIVE_METRICS.includes(card.metric) &&
    PART_WHOLE_VISUALS.includes(card.visual)
  )
    chart = (
      <Unsupported>
        比率、平均與去重訂單數不能直接相加；請使用比較、趨勢或表格。
      </Unsupported>
    )
  else if (!data.points.length) chart = <EmptyChart />
  else if (
    !["table", "matrix"].includes(card.visual) &&
    !data.points.some(
      (point) =>
        point.value != null || typeof point.secondary_value === "number"
    ) &&
    !data.series?.some((series) =>
      series.points.some((point) => point.value != null)
    )
  )
    chart = (
      <Unsupported>
        此範圍沒有可計算的{METRICS[card.metric].label}
        。分組彙總與逐筆明細仍提供實際資料。
      </Unsupported>
    )
  else if ((share || percentage) && negative)
    chart = (
      <Unsupported>
        {share
          ? "圓餅、環圈與矩形樹狀圖無法表達負值占比；請改用長條或折線圖。"
          : "百分比堆疊圖需要非負數值；目前包含負值，請改用一般堆疊圖。"}
        下方保留完整數值。
      </Unsupported>
    )
  else if (card.visual === "matrix" && data.matrix)
    chart = (
      <ReportMatrix
        card={card}
        data={data.matrix}
        highlight={data.highlight?.matrix}
        view={props.matrixView}
        onViewChange={props.onMatrixViewChange}
        onSelect={props.onSelectData}
        selections={props.selections}
      />
    )
  else if (card.visual === "table" || card.visual === "matrix")
    chart = <ValueTable {...props} matrix={card.visual === "matrix"} />
  else if (["bar", "stacked_bar", "percent_bar"].includes(card.visual))
    chart = <BarChart {...plot} />
  else if (["column", "stacked_column", "percent_column"].includes(card.visual))
    chart = <ColumnChart {...plot} />
  else if (["waterfall", "funnel"].includes(card.visual))
    chart = (
      <StageChart
        card={card}
        data={data}
        onSelect={props.onSelectData}
        onHover={props.onHoverData}
        onLeave={props.onHoverEnd}
      />
    )
  else if (card.visual === "map")
    chart = (
      <ReportMap
        card={card}
        data={data}
        onSelect={props.onSelectData}
        onHover={props.onHoverData}
        onLeave={props.onHoverEnd}
      />
    )
  else if (
    data.analysis &&
    (card.analytics?.trend_line || card.analytics?.forecast_periods)
  )
    chart = (
      <AnalysisChart
        card={card}
        data={data}
        onSelect={props.onSelectData}
        onHover={props.onHoverData}
        onLeave={props.onHoverEnd}
      />
    )
  else if (card.visual === "line" || card.visual === "area")
    chart = <TrendChart {...plot} />
  else if (share) chart = <ShareChart {...plot} />
  else if (card.visual === "combo") chart = <ComboChart {...plot} />
  else chart = <ScatterChart {...plot} />
  return (
    <div className="min-w-0 space-y-3">
      {!props.plotOnly && (
        <Total
          card={card}
          total={data.total}
          data={data}
          summary={props.summary}
        />
      )}
      {!props.plotOnly && (
        <ReportComparisonSummary
          card={card}
          comparison={data.comparison}
          metric={card.metric}
          compact={props.widgetSize === "medium"}
        />
      )}
      <HighlightSummary {...props} />
      {chart}
      {props.widgetSize && <WidgetTarget {...props} />}
      {typeof card.target === "number" &&
        !percentage &&
        !share &&
        !["table", "matrix", "scatter"].includes(card.visual) && (
          <p className="text-xs text-muted-foreground">
            虛線目標：{reportDisplayValue(card, card.target, card.metric)}
          </p>
        )}
      {!props.summary &&
        !props.plotOnly &&
        data.points.length > 0 &&
        card.visual !== "table" &&
        card.visual !== "matrix" && <DataDetails {...props} />}
    </div>
  )
}
