import type { KeyboardEvent, ReactNode } from "react"
import { BarChart3, ChevronDown } from "lucide-react"

import {
  DIMENSIONS,
  METRICS,
  REPORT_COLORS,
  formatReportValue,
  type CardData,
  type ReportCard,
  type ReportDimension,
  type ReportMetric,
  type ReportPoint,
} from "@/lib/reports"
import {
  chartDomain,
  chartSeries,
  stackRows,
  treeRects,
  type ChartSeries,
} from "@/components/reports/report-chart-math"

type ChartProps = {
  card: ReportCard
  data: CardData
  onSelectPoint?: (
    dimension: ReportDimension,
    key: string,
    label: string
  ) => void
  selectedKey?: string
  expanded?: boolean
}
type PlotProps = ChartProps & { series: ChartSeries[]; colors: string[] }

function exactValue(value: number, metric: ReportMetric): string {
  const currency = METRICS[metric].unit === "currency"
  return `${value.toLocaleString("zh-TW", { maximumFractionDigits: currency ? 2 : 0 })} ${currency ? "元" : metric === "visits" ? "次" : "家"}`
}
function axisValue(value: number, metric: ReportMetric) {
  return Math.abs(value) >= 10000
    ? formatReportValue(value, metric)
    : exactValue(value, metric)
}
function colorPalette(card: ReportCard) {
  const color = card.color ?? REPORT_COLORS[0]
  return [
    color,
    ...REPORT_COLORS.filter((item) => item !== color),
    "#5993bd",
    "#81a85a",
    "#bb7b43",
  ]
}
function colorAt(colors: string[], index: number) {
  return colors[index % colors.length]
}
function percentValue(value: number) {
  return `${value.toLocaleString("zh-TW", { maximumFractionDigits: 1 })}%`
}
function pointLabel(point: ReportPoint, card: ReportCard) {
  return `${point.label}：${exactValue(point.value, card.metric)}`
}

function Total({
  card,
  total,
  large = false,
}: {
  card: ReportCard
  total: number
  large?: boolean
}) {
  const formatted = formatReportValue(total, card.metric)
  const exact = exactValue(total, card.metric)
  return (
    <div className={large ? "py-2" : "mb-3"}>
      <p className="mb-1 text-[11px] text-muted-foreground">所選範圍合計</p>
      <p
        className={`${large ? "text-[clamp(1.125rem,5.5vw,1.625rem)] sm:text-3xl" : "text-xl"} leading-tight font-semibold tracking-tight break-words tabular-nums ${total < 0 ? "text-destructive" : "text-foreground"}`}
        title={exact}
        style={total >= 0 ? { color: card.color } : undefined}
      >
        {formatted}
      </p>
      {formatted !== exact && (
        <p className="mt-1 text-[11px] break-words text-muted-foreground tabular-nums">
          {exact}
        </p>
      )}
      {large && typeof card.target === "number" && (
        <p className="mt-3 text-xs text-muted-foreground">
          目標 {exactValue(card.target, card.metric)}
          {card.target > 0 && (
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
      <p className="text-xs">可以調整期間或篩選條件。</p>
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

function svgInteraction(props: ChartProps, point: ReportPoint) {
  if (!props.onSelectPoint || props.card.dimension === "none") return {}
  const select = () =>
    props.onSelectPoint?.(props.card.dimension, point.key, point.label)
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": `${pointLabel(point, props.card)}，點選篩選`,
    "aria-pressed": props.selectedKey === point.key,
    onClick: select,
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

function ValueTable(props: ChartProps & { matrix?: boolean }) {
  const { card, data, matrix = false, onSelectPoint, selectedKey } = props
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
        <caption className="sr-only">{card.title}明細</caption>
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
              {series.length ? "合計" : METRICS[card.metric].label}
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
              className={selectedKey === point.key ? "bg-primary/8" : undefined}
            >
              <th
                scope="row"
                className="max-w-48 px-3 py-2 font-normal break-words"
              >
                {onSelectPoint && card.dimension !== "none" ? (
                  <button
                    type="button"
                    className="min-h-11 w-full text-left text-primary underline-offset-2 focus-visible:underline"
                    aria-pressed={selectedKey === point.key}
                    onClick={() =>
                      onSelectPoint(card.dimension, point.key, point.label)
                    }
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
                >
                  {exactValue(index.get(point.key) ?? 0, card.metric)}
                </td>
              ))}
              <td
                className={`px-3 py-2.5 text-right break-words tabular-nums ${point.value < 0 ? "text-destructive" : ""}`}
              >
                {exactValue(point.value, card.metric)}
              </td>
              {secondary && (
                <td className="px-3 py-2.5 text-right break-words tabular-nums">
                  {typeof point.secondary_value === "number"
                    ? exactValue(point.secondary_value, secondary)
                    : "—"}
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
    <details className="group rounded-xl border border-border bg-muted/10">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {props.card.dimension === "month" ? "查看各月數值" : "查看數值明細"}
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
      className="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground"
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
  const { card, data, series, colors, onSelectPoint, selectedKey } = props
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
                <span className="min-w-0 break-words">{point.label}</span>
                {card.show_labels !== false && (
                  <span
                    className={`shrink-0 text-right tabular-nums ${point.value < 0 ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {exactValue(point.value, card.metric)}
                  </span>
                )}
              </div>
              {stacked ? (
                <div
                  className={`relative overflow-hidden rounded-sm bg-muted/40 ${card.height === "compact" ? "h-5" : card.height === "tall" ? "h-8" : "h-6"}`}
                  aria-hidden="true"
                >
                  <span
                    className="absolute inset-y-0 z-10 w-px bg-muted-foreground/60"
                    style={{ left: `${Math.min(99.8, baseline)}%` }}
                  />
                  {rows[index].map((segment) => {
                    const left = x(Math.min(segment.start, segment.end))
                    const width =
                      (Math.abs(segment.end - segment.start) / span) * 100
                    return (
                      <span
                        key={series[segment.series].key}
                        className="absolute inset-y-0 flex items-center justify-center overflow-hidden text-[10px] font-medium text-white"
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          backgroundColor: colorAt(colors, segment.series),
                        }}
                        title={`${series[segment.series].label}：${exactValue(segment.value, card.metric)}${percentage ? ` · ${percentValue(segment.end - segment.start)}` : ""}`}
                      >
                        {card.show_labels !== false &&
                          width > 13 &&
                          (percentage
                            ? percentValue(segment.end - segment.start)
                            : formatReportValue(segment.value, card.metric))}
                      </span>
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
                    const value = indexes[column].get(point.key) ?? 0
                    const left = x(Math.min(0, value))
                    const width = (Math.abs(value) / span) * 100
                    return (
                      <div
                        key={item.key}
                        className={`relative overflow-hidden rounded-sm bg-muted/40 ${card.height === "compact" ? "h-3" : card.height === "tall" ? "h-5" : "h-3.5"}`}
                        aria-hidden="true"
                      >
                        <span
                          className="absolute inset-y-0 z-10 w-px bg-muted-foreground/60"
                          style={{ left: `${Math.min(99.8, baseline)}%` }}
                        />
                        <span
                          className={`absolute inset-y-0 rounded-sm ${value < 0 && series.length === 1 ? "bg-destructive/80" : ""}`}
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            ...(value < 0 && series.length === 1
                              ? {}
                              : { backgroundColor: colorAt(colors, column) }),
                          }}
                          title={`${item.label}：${exactValue(value, card.metric)}`}
                        />
                        {typeof card.target === "number" && (
                          <span
                            className="absolute inset-y-0 z-20 border-l-2 border-dashed border-foreground"
                            style={{
                              left: `${Math.min(99.5, x(card.target))}%`,
                            }}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )
          return (
            <li key={point.key}>
              {onSelectPoint ? (
                <button
                  type="button"
                  className={`min-h-11 w-full rounded-md p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedKey === point.key ? "bg-primary/8 ring-1 ring-primary/30" : ""}`}
                  onClick={() =>
                    onSelectPoint(card.dimension, point.key, point.label)
                  }
                  aria-pressed={selectedKey === point.key}
                  aria-label={`${pointLabel(point, card)}，點選篩選`}
                >
                  {content}
                </button>
              ) : (
                <div>{content}</div>
              )}
            </li>
          )
        })}
      </ol>
      <Legend card={card} colors={colors} items={series} />
      {percentage && (
        <p className="text-[11px] text-muted-foreground">
          每個分類合計為 100%；合計為 0 的分類顯示 0%。
        </p>
      )}
    </div>
  )
}

function chartFrame(card: ReportCard, expanded?: boolean, secondary = false) {
  const width = expanded ? 480 : 360
  const height = expanded
    ? 300
    : card.height === "compact"
      ? 180
      : card.height === "tall"
        ? 280
        : 220
  return {
    width,
    height,
    left: 48,
    right: width - (secondary ? 52 : 14),
    top: 22,
    bottom: height - 35,
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
  if (dimension === "month") {
    const match = point.label.match(/(?:\d{4}[-/])?(\d{1,2})$/)
    if (match) return `${Number(match[1])} 月`
  }
  return point.label.length > 7 ? `${point.label.slice(0, 6)}…` : point.label
}

function ColumnChart(props: PlotProps) {
  const { card, data, series, colors, expanded } = props
  const stacked =
    card.visual === "stacked_column" || card.visual === "percent_column"
  const percentage = card.visual === "percent_column"
  const frame = chartFrame(card, expanded)
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
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        className="block h-auto w-full"
        role={props.onSelectPoint ? "group" : "img"}
        aria-label={`${card.title}，${percentage ? "百分比" : "直條"}比較`}
      >
        <title>{card.title}</title>
        {axisTicks(minimum, maximum, card.metric, percentage).map((tick) => (
          <g key={tick}>
            <line
              x1={frame.left}
              x2={frame.right}
              y1={y(tick)}
              y2={y(tick)}
              className="stroke-border"
              strokeDasharray="3 4"
            />
            <text
              x={frame.left - 6}
              y={y(tick) + 3}
              textAnchor="end"
              fontSize="9"
              className="fill-muted-foreground"
            >
              {percentage ? `${tick}%` : axisValue(tick, card.metric)}
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
          <g
            key={point.key}
            {...svgInteraction(props, point)}
            opacity={
              props.selectedKey && props.selectedKey !== point.key ? 0.35 : 1
            }
          >
            <title>{pointLabel(point, card)}</title>
            {(stacked
              ? rows[index]
              : series.map((_, column) => {
                  const value = indexes[column].get(point.key) ?? 0
                  return { series: column, value, start: 0, end: value }
                })
            ).map((segment) => {
              const barWidth = (band * 0.7) / (stacked ? 1 : series.length)
              const x =
                frame.left +
                band * index +
                band * 0.15 +
                (stacked ? 0 : barWidth * segment.series)
              const top = y(Math.max(segment.start, segment.end))
              const height = Math.abs(y(segment.end) - y(segment.start))
              return (
                <g key={series[segment.series].key}>
                  <rect
                    x={x}
                    y={top}
                    width={Math.max(1, barWidth - (stacked ? 0 : 1))}
                    height={height}
                    fill={colorAt(colors, segment.series)}
                    rx="1"
                  >
                    <title>{`${series[segment.series].label}：${exactValue(segment.value, card.metric)}${percentage ? ` · ${percentValue(segment.end - segment.start)}` : ""}`}</title>
                  </rect>
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
                          : formatReportValue(segment.value, card.metric)}
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
            <title>{`目標：${exactValue(card.target, card.metric)}`}</title>
          </g>
        )}
      </svg>
      <Legend card={card} colors={colors} items={series} />
      {percentage && (
        <p className="text-[11px] text-muted-foreground">
          各分類合計為 100%；零合計分類顯示 0%。
        </p>
      )}
    </div>
  )
}

function TrendChart(props: PlotProps) {
  const { card, data, series, colors, expanded } = props
  const frame = chartFrame(card, expanded)
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
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        className="block h-auto w-full"
        role={props.onSelectPoint ? "group" : "img"}
        aria-label={`${card.title}趨勢，可展開查看各月數值`}
      >
        <title>{`${card.title}逐月趨勢`}</title>
        {axisTicks(domain.minimum, domain.maximum, card.metric).map((tick) => (
          <g key={tick}>
            <line
              x1={frame.left}
              x2={frame.right}
              y1={y(tick)}
              y2={y(tick)}
              className="stroke-border"
              strokeDasharray="3 4"
            />
            <text
              x={frame.left - 6}
              y={y(tick) + 3}
              textAnchor="end"
              fontSize="9"
              className="fill-muted-foreground"
            >
              {axisValue(tick, card.metric)}
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
          const coords = values
            .map((value, row) => `${x(row)},${y(value)}`)
            .join(" ")
          return (
            <g key={item.key}>
              {card.visual === "area" && (
                <polygon
                  points={`${x(0)},${y(0)} ${coords} ${x(values.length - 1)},${y(0)}`}
                  fill={colorAt(colors, column)}
                  fillOpacity="0.16"
                />
              )}
              <polyline
                points={coords}
                fill="none"
                stroke={colorAt(colors, column)}
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {data.points.map((point, row) => (
                <g
                  key={point.key}
                  {...svgInteraction(props, point)}
                  opacity={
                    props.selectedKey && props.selectedKey !== point.key
                      ? 0.35
                      : 1
                  }
                >
                  <circle
                    cx={x(row)}
                    cy={y(values[row])}
                    r={props.selectedKey === point.key ? 5 : 3.5}
                    fill={colorAt(colors, column)}
                    className="stroke-card"
                    strokeWidth="1.5"
                  >
                    <title>{`${point.label} · ${item.label}：${exactValue(values[row], card.metric)}`}</title>
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
                        {formatReportValue(values[row], card.metric)}
                      </text>
                    )}
                </g>
              ))}
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
            <title>{`目標：${exactValue(card.target, card.metric)}`}</title>
          </g>
        )}
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
          role={props.onSelectPoint ? "group" : "img"}
          aria-label={`${card.title}，以圖中分類合計計算占比`}
        >
          <title>{card.title}</title>
          {card.visual === "treemap"
            ? rectangles.map(({ point, x, y, width, height }) => {
                const index = data.points.findIndex(
                  (item) => item.key === point.key
                )
                return (
                  <g
                    key={point.key}
                    {...svgInteraction(props, point)}
                    opacity={
                      props.selectedKey && props.selectedKey !== point.key
                        ? 0.35
                        : 1
                    }
                  >
                    <title>{`${pointLabel(point, card)} · ${percentValue((point.value / sum) * 100)}`}</title>
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
                    opacity={
                      props.selectedKey && props.selectedKey !== point.key
                        ? 0.35
                        : 1
                    }
                  >
                    <title>{`${pointLabel(point, card)} · ${percentValue(share * 100)}`}</title>
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
              <tspan x="180">{formatReportValue(sum, card.metric)}</tspan>
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
      {sum > 0 && (
        <p className="text-[11px] text-muted-foreground">
          占比以圖中分類合計計算；上方合計包含完整範圍。
        </p>
      )}
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
  const frame = chartFrame(card, expanded, true)
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
  const paths: string[][] = [[]]
  data.points.forEach((point, index) => {
    if (typeof point.secondary_value === "number")
      paths[paths.length - 1].push(`${x(index)},${y2(point.secondary_value)}`)
    else if (paths.at(-1)?.length) paths.push([])
  })
  const secondaryColor = colorAt(colors, 1)
  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        className="block h-auto w-full"
        role={props.onSelectPoint ? "group" : "img"}
        aria-label={`${card.title}：直條 ${METRICS[card.metric].label} 使用左軸，折線 ${METRICS[secondary].label} 使用右軸`}
      >
        <title>{`${METRICS[card.metric].label}（左軸）與${METRICS[secondary].label}（右軸），兩軸刻度獨立`}</title>
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
              className="stroke-border"
              strokeDasharray="3 4"
            />
            <text
              x={frame.left - 5}
              y={y(tick) + 3}
              textAnchor="end"
              fontSize="8"
              className="fill-muted-foreground"
            >
              {axisValue(tick, card.metric)}
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
            x={frame.right + 5}
            y={y2(tick) + 3}
            fontSize="8"
            fill={secondaryColor}
          >
            {axisValue(tick, secondary)}
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
            opacity={
              props.selectedKey && props.selectedKey !== point.key ? 0.35 : 1
            }
          >
            <title>{`${pointLabel(point, card)} · ${METRICS[secondary].label}：${typeof point.secondary_value === "number" ? exactValue(point.secondary_value, secondary) : "無資料"}`}</title>
            <rect
              x={x(index) - band * 0.28}
              y={Math.min(y(point.value), y(0))}
              width={band * 0.56}
              height={Math.abs(y(point.value) - y(0))}
              fill={colors[0]}
              fillOpacity="0.8"
              rx="1"
            />
            {typeof point.secondary_value === "number" && (
              <circle
                cx={x(index)}
                cy={y2(point.secondary_value)}
                r="3.5"
                fill={secondaryColor}
                className="stroke-card"
                strokeWidth="1.5"
              />
            )}
            {card.show_labels !== false && data.points.length <= 6 && (
              <text
                x={x(index)}
                y={Math.max(12, y(point.value) - 5)}
                fontSize="9"
                textAnchor="middle"
                className="fill-foreground"
              >
                {formatReportValue(point.value, card.metric)}
              </text>
            )}
            {(data.points.length <= 6 || index % 2 === 0) && (
              <text
                x={x(index)}
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
            <polyline
              key={index}
              points={path.join(" ")}
              fill="none"
              stroke={secondaryColor}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              pointerEvents="none"
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
            <title>{`左軸目標：${exactValue(card.target, card.metric)}`}</title>
          </g>
        )}
      </svg>
      <p className="text-[11px] text-muted-foreground">
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
  const { card, data, colors, expanded } = props
  const secondary = card.secondary_metric
  const points = data.points.filter(
    (point) => typeof point.secondary_value === "number"
  )
  if (!secondary || !points.length)
    return (
      <Unsupported>
        散佈圖需要兩個真實指標。目前沒有第二指標的對應數值，請改用比較圖或選擇第二指標。
      </Unsupported>
    )
  const frame = chartFrame(card, expanded)
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
        role={props.onSelectPoint ? "group" : "img"}
        aria-label={`${card.title}：橫軸 ${METRICS[card.metric].label}，縱軸 ${METRICS[secondary].label}`}
      >
        <title>{`${METRICS[card.metric].label}與${METRICS[secondary].label}的實際數值關係`}</title>
        {axisTicks(yDomain.minimum, yDomain.maximum, secondary).map((tick) => (
          <g key={tick}>
            <line
              x1={frame.left}
              x2={frame.right}
              y1={y(tick)}
              y2={y(tick)}
              className="stroke-border"
              strokeDasharray="3 4"
            />
            <text
              x={frame.left - 5}
              y={y(tick) + 3}
              textAnchor="end"
              fontSize="9"
              className="fill-muted-foreground"
            >
              {axisValue(tick, secondary)}
            </text>
          </g>
        ))}
        {axisTicks(xDomain.minimum, xDomain.maximum, card.metric).map(
          (tick) => (
            <text
              key={tick}
              x={x(tick)}
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
              {axisValue(tick, card.metric)}
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
            opacity={
              props.selectedKey && props.selectedKey !== point.key ? 0.3 : 1
            }
          >
            <circle
              cx={x(point.value)}
              cy={y(point.secondary_value as number)}
              r={props.selectedKey === point.key ? 7 : 5}
              fill={colors[0]}
              fillOpacity="0.75"
              className="stroke-card"
              strokeWidth="1.5"
            >
              <title>{`${pointLabel(point, card)} · ${METRICS[secondary].label}：${exactValue(point.secondary_value as number, secondary)}`}</title>
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
      </svg>
      <p className="text-[11px] text-muted-foreground">
        橫軸：{METRICS[card.metric].label} · 縱軸：{METRICS[secondary].label}
      </p>
      {points.length !== data.points.length && (
        <p className="text-[11px] text-muted-foreground">
          {data.points.length - points.length} 個分類沒有第二指標，未繪製散點。
        </p>
      )}
    </div>
  )
}

export function ReportChart(props: ChartProps) {
  const { card, data } = props
  if (card.visual === "kpi")
    return <Total card={card} total={data.total} large />
  const series = chartSeries(data, METRICS[card.metric].label)
  const plot = { ...props, series, colors: colorPalette(card) }
  const share = ["pie", "donut", "treemap"].includes(card.visual)
  const percentage =
    card.visual === "percent_bar" || card.visual === "percent_column"
  const negative = share
    ? data.points.some((point) => point.value < 0)
    : series.some((item) => item.points.some((point) => point.value < 0))
  let chart: ReactNode
  if (!data.points.length) chart = <EmptyChart />
  else if ((share || percentage) && negative)
    chart = (
      <Unsupported>
        {share
          ? "圓餅、環圈與矩形樹狀圖無法表達負值占比；請改用長條或折線圖。"
          : "百分比堆疊圖需要非負數值；目前包含負值，請改用一般堆疊圖。"}
        下方保留完整數值。
      </Unsupported>
    )
  else if (card.visual === "table" || card.visual === "matrix")
    chart = <ValueTable {...props} matrix={card.visual === "matrix"} />
  else if (["bar", "stacked_bar", "percent_bar"].includes(card.visual))
    chart = <BarChart {...plot} />
  else if (["column", "stacked_column", "percent_column"].includes(card.visual))
    chart = <ColumnChart {...plot} />
  else if (card.visual === "line" || card.visual === "area")
    chart = <TrendChart {...plot} />
  else if (share) chart = <ShareChart {...plot} />
  else if (card.visual === "combo") chart = <ComboChart {...plot} />
  else chart = <ScatterChart {...plot} />
  return (
    <div className="min-w-0 space-y-3">
      <Total card={card} total={data.total} />
      {chart}
      {typeof card.target === "number" &&
        !percentage &&
        !share &&
        !["table", "matrix", "scatter"].includes(card.visual) && (
          <p className="text-[11px] text-muted-foreground">
            虛線目標：{exactValue(card.target, card.metric)}
          </p>
        )}
      {data.points.length > 0 &&
        card.visual !== "table" &&
        card.visual !== "matrix" && <DataDetails {...props} />}
    </div>
  )
}
