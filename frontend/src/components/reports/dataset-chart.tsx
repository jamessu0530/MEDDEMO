import { useEffect, useState } from "react"
import {
  queryDataSource,
  type DataChart,
  type DataResult,
  type DataSource,
} from "@/api/report-datasets"
import { dataValue } from "@/lib/report-datasets"

const COLORS = [
  "#6455c7",
  "#2878b5",
  "#259688",
  "#e0a32e",
  "#d76857",
  "#a34fa0",
]

export function DatasetChart({
  source,
  chart,
}: {
  source: DataSource
  chart: DataChart
}) {
  const [snapshot, setSnapshot] = useState<{
    key: string
    data?: DataResult
    error?: string
  } | null>(null)
  const key = JSON.stringify(chart)
  const requestKey = `${source.id}/${source.revision}/${key}`
  useEffect(() => {
    const controller = new AbortController()
    queryDataSource(source.id, JSON.parse(key) as DataChart, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setSnapshot({ key: requestKey, data: next })
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setSnapshot({
            key: requestKey,
            error: reason instanceof Error ? reason.message : "圖表無法載入",
          })
        }
      })
    return () => controller.abort()
  }, [source.id, key, requestKey])
  const result = snapshot?.key === requestKey ? snapshot.data : undefined
  const error = snapshot?.key === requestKey ? snapshot.error : undefined
  if (error)
    return (
      <p role="alert" className="p-3 text-sm text-destructive">
        {error}
      </p>
    )
  if (!result || result.revision !== source.revision)
    return (
      <p role="status" className="p-3 text-sm text-muted-foreground">
        正在計算完整資料…
      </p>
    )
  const points = result.points
  const maximum = Math.max(
    1,
    ...points.map((point) => Math.abs(point.value ?? 0))
  )
  const minimum = Math.min(0, ...points.map((point) => point.value ?? 0))
  const top = Math.max(0, ...points.map((point) => point.value ?? 0))
  const y = (value: number) =>
    155 - ((value - minimum) / (top - minimum || 1)) * 140
  const x = (index: number) =>
    30 + (index / Math.max(points.length - 1, 1)) * 540
  const pieTotal = points.reduce(
    (total, point) => total + (point.value ?? 0),
    0
  )
  const stops = points.map((point, index) => {
    const start =
      (points
        .slice(0, index)
        .reduce((sum, item) => sum + (item.value ?? 0), 0) /
        (pieTotal || 1)) *
      360
    const end = start + ((point.value ?? 0) / (pieTotal || 1)) * 360
    return `${COLORS[index % COLORS.length]} ${start}deg ${end}deg`
  })
  return (
    <div className="min-w-0 space-y-3">
      <p className="text-2xl font-semibold text-primary">
        {dataValue(result.total)}
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          完整範圍 · {result.row_count.toLocaleString()} 列
        </span>
      </p>
      {!result.row_count && (
        <p className="text-sm text-muted-foreground">
          沒有符合篩選條件的資料。
        </p>
      )}
      {chart.visual === "bar" && (
        <div className="space-y-2">
          {points.map((point) => (
            <div
              key={point.label}
              className="grid grid-cols-[minmax(0,1fr)_2fr] items-center gap-3 text-xs"
            >
              <span className="truncate" title={point.label}>
                {point.label}
              </span>
              <div className="relative min-h-7 rounded bg-muted">
                <div
                  className="absolute inset-y-0 rounded opacity-25"
                  style={{
                    width: `${(Math.abs(point.value ?? 0) / maximum) * 100}%`,
                    background: (point.value ?? 0) < 0 ? "#d76857" : COLORS[0],
                  }}
                />
                <span className="relative block px-2 py-1">
                  {dataValue(point.value)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      {(chart.visual === "line" || chart.visual === "column") &&
        points.length > 0 && (
          <svg
            viewBox="0 0 600 205"
            role="img"
            aria-label={chart.title}
            className="w-full"
          >
            <line
              x1="15"
              x2="585"
              y1={y(0)}
              y2={y(0)}
              stroke="currentColor"
              opacity="0.2"
            />
            {chart.visual === "line" &&
              points.map((point, i) =>
                point.value !== null &&
                i > 0 &&
                points[i - 1].value !== null ? (
                  <line
                    key={`line-${i}`}
                    x1={x(i - 1)}
                    x2={x(i)}
                    y1={y(points[i - 1].value!)}
                    y2={y(point.value)}
                    stroke={COLORS[0]}
                    strokeWidth="3"
                  />
                ) : null
              )}
            {points.map((point, i) => (
              <g key={point.label}>
                <title>
                  {point.label}：{dataValue(point.value)}
                </title>
                {point.value !== null &&
                  (chart.visual === "line" ? (
                    <circle
                      cx={x(i)}
                      cy={y(point.value)}
                      r="4"
                      fill={COLORS[0]}
                    />
                  ) : (
                    <rect
                      x={x(i) - Math.min(18, 180 / points.length)}
                      y={Math.min(y(point.value), y(0))}
                      width={Math.min(36, 360 / points.length)}
                      height={Math.max(1, Math.abs(y(point.value) - y(0)))}
                      fill={point.value < 0 ? "#d76857" : COLORS[0]}
                    />
                  ))}
                <text
                  x={x(i)}
                  y="178"
                  textAnchor="middle"
                  fill="currentColor"
                  fontSize="10"
                >
                  {point.label.slice(0, 7)}
                </text>
              </g>
            ))}
          </svg>
        )}
      {chart.visual === "pie" && !result.has_negative && pieTotal > 0 && (
        <div className="flex flex-wrap items-center gap-4">
          <div
            role="img"
            aria-label={chart.title}
            className="size-40 shrink-0 rounded-full"
            style={{ background: `conic-gradient(${stops.join(",")})` }}
          />
          <div className="space-y-1 text-xs">
            {points.map((point, i) => (
              <p key={point.label}>
                <span
                  className="mr-2 inline-block size-2 rounded-full"
                  style={{ background: COLORS[i % COLORS.length] }}
                />
                {point.label}：{dataValue(point.value)}
              </p>
            ))}
          </div>
        </div>
      )}
      {chart.visual !== "kpi" && (
        <details
          open={
            chart.visual === "table" ||
            (chart.visual === "pie" && (result.has_negative || pieTotal <= 0))
          }
          className="rounded border p-2 text-xs"
        >
          <summary className="min-h-8 cursor-pointer">
            精確數值 · 顯示 {points.length}／{result.group_count} 組
          </summary>
          <div className="max-h-64 overflow-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="p-2 text-left">分組</th>
                  <th className="p-2 text-right">數值</th>
                  <th className="p-2 text-right">資料列數</th>
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.label} className="border-t">
                    <td className="p-2">{point.label}</td>
                    <td className="p-2 text-right">{dataValue(point.value)}</td>
                    <td className="p-2 text-right">{point.rows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {result.note}
      </p>
    </div>
  )
}
