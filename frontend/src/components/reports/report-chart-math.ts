import type { CardData, ReportPoint } from "@/lib/reports"

export type ChartSeries = { key: string; label: string; points: ReportPoint[] }
export type StackSegment = {
  series: number
  value: number
  start: number
  end: number
}

export function chartSeries(data: CardData, label: string): ChartSeries[] {
  return data.series?.length
    ? data.series
    : [{ key: "primary", label, points: data.points }]
}

/** Each category accumulates gains and losses independently from the same zero. */
export function stackRows(
  points: ReportPoint[],
  series: ChartSeries[],
  percentage = false
): StackSegment[][] {
  const indexes = series.map(
    (item) => new Map(item.points.map((point) => [point.key, point.value]))
  )
  return points.map((point) => {
    const values = indexes.map((index) => index.get(point.key) ?? 0)
    if (percentage && values.some((value) => value < 0))
      throw new Error("Percentage stacks require nonnegative values")
    const sum = values.reduce((total, value) => total + value, 0)
    let positive = 0
    let negative = 0
    return values.map((raw, index) => {
      const value = percentage ? (sum > 0 ? (raw / sum) * 100 : 0) : raw
      const start = value < 0 ? negative : positive
      const end = start + value
      if (value < 0) negative = end
      else positive = end
      return { series: index, value: raw, start, end }
    })
  })
}

export function chartDomain(values: number[], target?: number | null) {
  const finite = values.filter(Number.isFinite)
  if (typeof target === "number" && Number.isFinite(target)) finite.push(target)
  const minimum = Math.min(0, ...finite)
  const maximum = Math.max(0, ...finite)
  return { minimum, maximum: maximum === minimum ? minimum + 1 : maximum }
}

export type TreeRect = {
  point: ReportPoint
  x: number
  y: number
  width: number
  height: number
}

/** Binary area partition: every positive category receives exactly its share of the area. */
export function treeRects(
  points: ReportPoint[],
  width: number,
  height: number
): TreeRect[] {
  const result: TreeRect[] = []
  function partition(
    items: ReportPoint[],
    x: number,
    y: number,
    w: number,
    h: number
  ) {
    const total = items.reduce((sum, item) => sum + item.value, 0)
    if (!items.length || total <= 0) return
    if (items.length === 1) {
      result.push({ point: items[0], x, y, width: w, height: h })
      return
    }
    let split = 1
    let firstTotal = items[0].value
    while (
      split < items.length - 1 &&
      firstTotal + items[split].value / 2 < total / 2
    )
      firstTotal += items[split++].value
    const fraction = firstTotal / total
    if (w >= h) {
      partition(items.slice(0, split), x, y, w * fraction, h)
      partition(items.slice(split), x + w * fraction, y, w * (1 - fraction), h)
    } else {
      partition(items.slice(0, split), x, y, w, h * fraction)
      partition(items.slice(split), x, y + h * fraction, w, h * (1 - fraction))
    }
  }
  partition(
    points.filter((point) => point.value > 0),
    0,
    0,
    width,
    height
  )
  return result
}
