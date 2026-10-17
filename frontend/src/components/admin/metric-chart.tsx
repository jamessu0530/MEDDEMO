import { useState } from "react"

import type { CloudMetrics } from "@/api/cloud-metrics"
import { METRIC_COLORS, metricNumber, metricTrend } from "@/lib/cloud-metrics"

export type ChartSeries = { key: string; label: string; color?: string }
const timeLabel = (timestamp: number) =>
  new Date(timestamp * 1000).toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })

export function MetricChart({
  data,
  title,
  description,
  series,
  unit,
  multiplier = 1,
  digits = 2,
}: {
  data: CloudMetrics
  title: string
  description: string
  series: ChartSeries[]
  unit: string
  multiplier?: number
  digits?: number
}) {
  const [cursor, setCursor] = useState<number | null>(null)
  const [hidden, setHidden] = useState<string[]>([])
  const visible = series.filter((item) => !hidden.includes(item.key))
  const values = visible
    .flatMap((item) => data.history[item.key] ?? [])
    .map((point) => point.value)
    .filter((value): value is number => value != null && Number.isFinite(value))
  const ceiling = Math.max(...values, 0.001) * 1.12
  const hasValues = values.length > 0
  const selectedTime =
    cursor == null
      ? null
      : data.range_start + cursor * (data.range_end - data.range_start)
  const domain = {
    start: data.range_start,
    end: data.range_end,
    ceiling,
    width: 584,
    height: 160,
    stepSeconds: data.step_seconds,
  }
  const valueAt = (key: string) => {
    const points = data.history[key] ?? []
    if (selectedTime == null) return points[points.length - 1]?.value
    const point = points.reduce<(typeof points)[number] | undefined>(
      (best, next) =>
        !best ||
        Math.abs(next.timestamp - selectedTime) <
          Math.abs(best.timestamp - selectedTime)
          ? next
          : best,
      undefined
    )
    return point &&
      Math.abs(point.timestamp - selectedTime) <= data.step_seconds
      ? point.value
      : null
  }

  return (
    <article className="min-w-0 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {description}
          </p>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {selectedTime == null ? "最新" : timeLabel(selectedTime)} · {unit}
        </span>
      </div>
      <div
        className="relative mt-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        tabIndex={hasValues ? 0 : undefined}
        role="group"
        aria-label={`${title}趨勢，使用左右方向鍵查看樣本`}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setCursor(
            Math.max(
              0,
              Math.min(
                1,
                (((event.clientX - rect.left) / rect.width) * 640 - 48) / 576
              )
            )
          )
        }}
        onPointerLeave={() => setCursor(null)}
        onBlur={() => setCursor(null)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setCursor(null)
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault()
            setCursor(
              Math.max(
                0,
                Math.min(
                  1,
                  (cursor ?? 1) +
                    ((event.key === "ArrowRight" ? 1 : -1) *
                      data.step_seconds) /
                      data.window_seconds
                )
              )
            )
          }
        }}
      >
        <svg
          viewBox="0 0 640 200"
          className="block h-auto min-h-32 w-full"
          role="img"
          aria-label={`${title}，${hasValues ? `範圍最高 ${metricNumber(Math.max(...values), digits, multiplier)} ${unit}` : "尚無樣本"}`}
        >
          {[0, 1, 2, 3, 4].map((tick) => (
            <g key={tick}>
              <line
                x1="48"
                x2="624"
                y1={16 + tick * 36}
                y2={16 + tick * 36}
                className="stroke-border"
                strokeDasharray="3 5"
              />
              <text
                x="38"
                y={20 + tick * 36}
                textAnchor="end"
                className="fill-muted-foreground text-[10px]"
              >
                {hasValues
                  ? metricNumber(
                      ceiling * (1 - tick / 4),
                      ceiling * multiplier > 20 ? 0 : digits,
                      multiplier
                    )
                  : "—"}
              </text>
            </g>
          ))}
          <g transform="translate(44 8)">
            {visible.map((item) => {
              const path = metricTrend(data.history[item.key] ?? [], domain)
              return (
                path && (
                  <path
                    key={item.key}
                    d={path}
                    fill="none"
                    stroke={item.color ?? METRIC_COLORS[series.indexOf(item)]}
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )
              )
            })}
          </g>
          {cursor != null && hasValues && (
            <line
              x1={48 + cursor * 576}
              x2={48 + cursor * 576}
              y1="12"
              y2="164"
              className="stroke-foreground/40"
              strokeDasharray="4 4"
            />
          )}
          <text x="48" y="187" className="fill-muted-foreground text-[10px]">
            {timeLabel(data.range_start)}
          </text>
          <text
            x="336"
            y="187"
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {timeLabel((data.range_start + data.range_end) / 2)}
          </text>
          <text
            x="624"
            y="187"
            textAnchor="end"
            className="fill-muted-foreground text-[10px]"
          >
            {timeLabel(data.range_end)}
          </text>
        </svg>
        {!hasValues && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center pb-6 text-xs text-muted-foreground">
            等待 Cloud 樣本
          </p>
        )}
      </div>
      <div className="flex min-h-7 flex-wrap gap-x-4 gap-y-1">
        {series.map((item, index) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={!hidden.includes(item.key)}
            className="inline-flex min-h-7 items-center gap-1.5 text-xs disabled:cursor-default"
            disabled={series.length === 1}
            onClick={() =>
              setHidden((current) =>
                current.includes(item.key)
                  ? current.filter((key) => key !== item.key)
                  : current.length < series.length - 1
                    ? [...current, item.key]
                    : current
              )
            }
          >
            <span
              className="size-2 rounded-full"
              style={{
                backgroundColor: item.color ?? METRIC_COLORS[index],
                opacity: hidden.includes(item.key) ? 0.25 : 1,
              }}
            />
            <span
              className={
                hidden.includes(item.key)
                  ? "text-muted-foreground line-through"
                  : "text-muted-foreground"
              }
            >
              {item.label}
            </span>
            <span className="font-medium tabular-nums">
              {hidden.includes(item.key)
                ? "隱藏"
                : metricNumber(valueAt(item.key), digits, multiplier)}
            </span>
          </button>
        ))}
      </div>
    </article>
  )
}
