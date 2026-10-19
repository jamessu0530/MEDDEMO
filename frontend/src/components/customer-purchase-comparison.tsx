import { useId, useState } from "react"

import type { PurchaseComparison } from "@/lib/customer-purchase-comparison"
import { formatDate, formatMoney, formatWan } from "@/lib/format"

const W = 380
const H = 220
const LEFT = 52
const RIGHT = W - 12
const TOP = 18
const BASE = H - 34

export function CustomerPurchaseComparison({
  comparison,
  today,
}: {
  comparison: PurchaseComparison
  today: string
}) {
  const titleId = useId()
  const [selectedDay, setSelectedDay] = useState(comparison.through)
  const { points, currentMonth, previousMonth } = comparison
  const selected = points[selectedDay - 1] ?? points[comparison.through - 1]
  const highest = Math.max(
    1,
    ...points.flatMap((point) => [point.current ?? 0, point.previous ?? 0])
  )
  const magnitude = 10 ** Math.floor(Math.log10(highest / 3))
  const rawStep = highest / 3 / magnitude
  const step =
    ([1, 2, 5, 10].find((value) => value >= rawStep) ?? 10) * magnitude
  const max = step * 3
  const x = (day: number) =>
    LEFT + ((day - 1) / (points.length - 1)) * (RIGHT - LEFT)
  const y = (amount: number) => BASE - (amount / max) * (BASE - TOP)
  const path = (series: "current" | "previous") =>
    points
      .filter((point) => point[series] !== null)
      .map(
        (point, index) =>
          `${index ? "L" : "M"}${x(point.day)} ${y(point[series]!)}`
      )
      .join(" ")
  const monthLabel = (month: string) => `${Number(month.slice(5))} 月`
  const ticks = [1, 5, 10, 15, 20, 25, points.length]
  const empty = !comparison.currentAmount && !comparison.previousAmount

  return (
    <section className="rounded-2xl border-2 bg-card p-4 shadow-lip">
      <h2 id={titleId} className="text-base font-semibold">
        本月與上月進貨比較
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        依每月日期疊圖 · 累計進貨（萬）
      </p>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
        <span className="inline-flex items-center gap-2">
          <span className="w-5 border-t-[3px] border-primary" />
          本月 {monthLabel(currentMonth)} ·{" "}
          {formatWan(comparison.currentAmount)}
        </span>
        <span className="inline-flex items-center gap-2 text-muted-foreground">
          <span className="w-5 border-t-2 border-dashed border-muted-foreground" />
          上月 {monthLabel(previousMonth)} ·{" "}
          {formatWan(comparison.previousAmount)}
        </span>
      </div>
      {empty ? (
        <p className="flex h-48 items-center justify-center text-sm text-muted-foreground">
          本月與上月尚無進貨紀錄
        </p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="mt-3 block h-auto w-full"
            role="img"
            aria-labelledby={titleId}
          >
            <desc>
              本月實線、上月虛線，依每月幾號比較累計進貨金額。本月只畫到
              {formatDate(today)}。
            </desc>
            {[0, step, step * 2, max].map((amount) => (
              <g key={amount}>
                <line
                  x1={LEFT}
                  x2={RIGHT}
                  y1={y(amount)}
                  y2={y(amount)}
                  className="stroke-border"
                />
                <text
                  x={LEFT - 8}
                  y={y(amount) + 4}
                  textAnchor="end"
                  fontSize={11}
                  className="fill-muted-foreground"
                >
                  {Number((amount / 10000).toPrecision(3))}
                </text>
              </g>
            ))}
            {ticks.map((day) => (
              <text
                key={day}
                x={x(day)}
                y={BASE + 22}
                textAnchor="middle"
                fontSize={11}
                className="fill-muted-foreground"
              >
                {day}日
              </text>
            ))}
            <path
              data-series="previous"
              d={path("previous")}
              fill="none"
              className="stroke-muted-foreground"
              strokeWidth={2}
              strokeDasharray="5 4"
              strokeLinejoin="round"
            />
            <path
              data-series="current"
              d={path("current")}
              fill="none"
              className="stroke-primary"
              strokeWidth={3}
              strokeLinejoin="round"
            />
            <line
              x1={x(selected.day)}
              x2={x(selected.day)}
              y1={TOP}
              y2={BASE}
              className="stroke-border"
              strokeDasharray="3 3"
            />
            {(["previous", "current"] as const).map(
              (series) =>
                selected[series] !== null && (
                  <circle
                    key={series}
                    cx={x(selected.day)}
                    cy={y(selected[series])}
                    r={4}
                    className={
                      series === "current"
                        ? "fill-primary stroke-card"
                        : "fill-muted-foreground stroke-card"
                    }
                    strokeWidth={2}
                  />
                )
            )}
            {points.map((point) => (
              <rect
                key={point.day}
                x={x(point.day) - (RIGHT - LEFT) / points.length / 2}
                y={TOP}
                width={(RIGHT - LEFT) / points.length}
                height={BASE - TOP}
                fill="transparent"
                onPointerEnter={() => setSelectedDay(point.day)}
                onPointerDown={() => setSelectedDay(point.day)}
              />
            ))}
          </svg>
          <label className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="shrink-0">選擇日期</span>
            <input
              type="range"
              min={1}
              max={points.length}
              value={selected.day}
              onChange={(event) => setSelectedDay(Number(event.target.value))}
              aria-label="選擇比較日期"
              aria-valuetext={`${selected.day} 日`}
              className="h-8 min-w-0 flex-1 accent-primary"
            />
            <span className="w-8 text-right tabular-nums">
              {selected.day}日
            </span>
          </label>
          <div
            className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-3 text-xs tabular-nums"
            aria-live="polite"
          >
            <p>
              <span className="text-muted-foreground">
                本月 {selected.day} 日
              </span>
              <span className="mt-1 block font-semibold text-primary">
                {selected.current === null
                  ? "尚未到此日期"
                  : formatMoney(selected.current)}
              </span>
            </p>
            <p>
              <span className="text-muted-foreground">
                上月 {selected.day} 日
              </span>
              <span className="mt-1 block font-semibold">
                {selected.previous === null
                  ? "上月無此日期"
                  : formatMoney(selected.previous)}
              </span>
            </p>
          </div>
        </>
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        本月統計至 {formatDate(today)}；上月顯示整月。增減幅度與上月同期比較。
      </p>
    </section>
  )
}
