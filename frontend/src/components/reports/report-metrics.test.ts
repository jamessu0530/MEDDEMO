import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ReportChart } from "@/components/reports/report-chart"
import {
  numericCardData,
  trendSegments,
} from "@/components/reports/report-chart-math"
import { ReportComparisonSummary } from "@/components/reports/report-comparison"
import {
  ReportInspector,
  ReportVisualGallery,
} from "@/components/reports/report-inspector"
import type { CardData, ReportCard } from "@/lib/reports"

const card: ReportCard = {
  id: "ratio",
  title: "淨毛利率",
  metric: "net_margin_rate",
  dimension: "month",
  visual: "line",
  limit: 5,
}
const data: CardData = {
  id: "ratio",
  total: 0.6,
  note: null,
  points: [
    { key: "2031-01", label: "2031/01", value: 0.5 },
    { key: "2031-02", label: "2031/02", value: null },
    { key: "2031-03", label: "2031/03", value: 0.7 },
  ],
}

describe("指標呈現", () => {
  it("缺少可計算資料會切斷趨勢，數值零仍保留", () => {
    expect(
      trendSegments(
        data.points.map((point) => point.key),
        data.points
      )
    ).toEqual([[0], [2]])
    expect(
      trendSegments(["zero"], [{ key: "zero", label: "零", value: 0 }])
    ).toEqual([[0]])
    const numeric = numericCardData(data)
    expect(numeric.points[1].missing).toBe(true)
    expect(data.points[1].value).toBeNull()
    const html = renderToStaticMarkup(
      createElement(ReportChart, { card, data })
    )
    expect(html.match(/<polyline/g)).toHaveLength(2)
    expect(html.match(/<circle/g)).toHaveLength(2)
    expect(html).toContain("無法計算")
    expect(html).not.toContain("NaN")
  })
  it("直條的缺資料點不繪製成 0% 資料點，彙總保留空值", () => {
    const html = renderToStaticMarkup(
      createElement(ReportChart, {
        card: { ...card, visual: "column" },
        data,
        onSelectData: () => undefined,
      })
    )
    expect(html).toContain("2031/02 · 淨毛利率：無法計算")
    expect(html).not.toContain('aria-label="2031/02：0%')
  })
  it("全為空值時說明原因，仍可檢視原始品項，不畫出假的百分比曲線", () => {
    const html = renderToStaticMarkup(
      createElement(ReportChart, {
        card,
        data: {
          ...data,
          total: null,
          points: [{ key: "2031-04", label: "2031/04", value: null }],
        },
      })
    )
    expect(html).toContain("此範圍沒有可計算的淨毛利率")
    expect(html).toContain("逐筆明細仍提供實際資料")
    expect(html).not.toContain("<polyline")
    expect(html).not.toContain("<circle")
  })
  it("KPI 空值不虛構為零，快照及百分比目標有正確單位", () => {
    const html = renderToStaticMarkup(
      createElement(ReportChart, {
        card: { ...card, dimension: "none", visual: "kpi", target: 0.5 },
        data: { ...data, total: null },
      })
    )
    expect(html).toContain("無法計算")
    expect(html).toContain("目標 50%")
    expect(html).not.toContain("達成")
  })
  it("前期日期與百分點差異可讀，不誤顯示為元或相對成長", () => {
    const html = renderToStaticMarkup(
      createElement(ReportComparisonSummary, {
        metric: "net_margin_rate",
        comparison: {
          mode: "previous_month",
          start: "2031-03-01",
          end: "2031-03-17",
          note: "同區間",
          value: {
            previous: 0.4,
            delta: 0.1,
            relative_change: null,
            status: "ok",
            previous_rows: 2,
          },
        },
      })
    )
    expect(html).toContain("+10 個百分點")
    expect(html).toContain("前期 40%")
    expect(html).toContain("2031-03-01 至 2031-03-17")
    expect(html).not.toContain("元")
  })
  it("非加總圖表庫說明限制，資料設定可選新指標及歷史比較", () => {
    const gallery = renderToStaticMarkup(
      createElement(ReportVisualGallery, {
        metric: "net_margin_rate",
        onSelect: () => undefined,
      })
    )
    expect(gallery.match(/disabled=""/g)).toHaveLength(7)
    expect(gallery).toContain("不能直接相加")
    const inspector = renderToStaticMarkup(
      createElement(ReportInspector, {
        card,
        config: {
          name: "分析",
          template: "sales",
          period: "this_month",
          owner_id: null,
          customer_type: null,
          cards: [card],
        },
        owners: [],
        onChange: () => undefined,
        onAdd: () => undefined,
        onDuplicate: () => undefined,
        onDelete: () => undefined,
        onMove: () => undefined,
      })
    )
    for (const label of [
      "淨毛利率",
      "訂單數",
      "平均客單價",
      "月增／年增比較",
      "前月同區間",
      "去年同期",
    ])
      expect(inspector).toContain(label)
  })
})
