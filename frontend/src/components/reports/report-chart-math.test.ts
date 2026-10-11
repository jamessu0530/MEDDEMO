import { describe, expect, it } from "vitest"
import {
  chartDomain,
  chartSeries,
  stackRows,
  treeRects,
} from "@/components/reports/report-chart-math"
import type { CardData, ReportPoint } from "@/lib/reports"

const points: ReportPoint[] = [
  { key: "one", label: "第一類", value: 50 },
  { key: "two", label: "第二類", value: 60 },
]

describe("actual chart geometry", () => {
  it("有圖例時只使用後端真實系列，無圖例時不虛構系列", () => {
    const data: CardData = {
      id: "test",
      total: 110,
      points,
      series: [{ key: "clinic", label: "診所", points }],
      note: null,
    }
    expect(chartSeries(data, "業績")).toEqual(data.series)
    expect(chartSeries({ ...data, series: undefined }, "業績")).toEqual([
      { key: "primary", label: "業績", points },
    ])
  })

  it("正負堆疊分別從零累積，不讓虧損抵銷並隱藏正值", () => {
    const series = [
      { key: "a", label: "A", points: [{ ...points[0], value: 100 }] },
      { key: "b", label: "B", points: [{ ...points[0], value: -50 }] },
      { key: "c", label: "C", points: [{ ...points[0], value: 20 }] },
      { key: "d", label: "D", points: [{ ...points[0], value: -10 }] },
    ]
    expect(
      stackRows(points.slice(0, 1), series)[0].map(({ start, end }) => [
        start,
        end,
      ])
    ).toEqual([
      [0, 100],
      [0, -50],
      [100, 120],
      [-50, -60],
    ])
  })

  it("每列百分比依該列真實合計為基準，缺少系列為零", () => {
    const series = [
      {
        key: "a",
        label: "A",
        points: [
          { ...points[0], value: 30 },
          { ...points[1], value: 0 },
        ],
      },
      { key: "b", label: "B", points: [{ ...points[0], value: 70 }] },
    ]
    const rows = stackRows(points, series, true)
    expect(rows[0].map(({ start, end }) => [start, end])).toEqual([
      [0, 30],
      [30, 100],
    ])
    expect(
      rows[1].every((segment) => segment.start === 0 && segment.end === 0)
    ).toBe(true)
    expect(() =>
      stackRows(
        points,
        [{ key: "loss", label: "虧損", points: [{ ...points[0], value: -1 }] }],
        true
      )
    ).toThrow("nonnegative")
  })

  it("零值仍有有限刻度，負值與目標全部納入範圍", () => {
    expect(chartDomain([0, 0])).toEqual({ minimum: 0, maximum: 1 })
    expect(chartDomain([-50, 100], 1000)).toEqual({
      minimum: -50,
      maximum: 1000,
    })
    expect(chartDomain([-50, 100], -200)).toEqual({
      minimum: -200,
      maximum: 100,
    })
    expect(chartDomain([NaN, Infinity, 20])).toEqual({
      minimum: 0,
      maximum: 20,
    })
  })

  it("矩形面積與實際數值等比例，零值沒有假面積且區塊不重疊", () => {
    const values = [10, 20, 30, 40, 0]
    const data = values.map((value, index) => ({
      key: String(index),
      label: String(index),
      value,
    }))
    const rectangles = treeRects(data, 360, 190)
    expect(rectangles).toHaveLength(4)
    expect(
      rectangles.reduce((sum, item) => sum + item.width * item.height, 0)
    ).toBeCloseTo(360 * 190)
    for (const item of rectangles) {
      expect((item.width * item.height) / (360 * 190)).toBeCloseTo(
        item.point.value / 100
      )
      expect(item.x).toBeGreaterThanOrEqual(0)
      expect(item.y).toBeGreaterThanOrEqual(0)
      expect(item.x + item.width).toBeLessThanOrEqual(360)
      expect(item.y + item.height).toBeLessThanOrEqual(190)
    }
    for (let a = 0; a < rectangles.length; a++)
      for (let b = a + 1; b < rectangles.length; b++) {
        const first = rectangles[a]
        const second = rectangles[b]
        const width =
          Math.min(first.x + first.width, second.x + second.width) -
          Math.max(first.x, second.x)
        const height =
          Math.min(first.y + first.height, second.y + second.height) -
          Math.max(first.y, second.y)
        expect(width <= 0 || height <= 0).toBe(true)
      }
  })
})
