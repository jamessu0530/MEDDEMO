import { describe, expect, it } from "vitest"
import { comparisonPrevious, comparisonText } from "@/lib/report-comparison"
import {
  formatReportExactValue,
  formatReportValue,
  normalizeCard,
  reportCsv,
  reportDataKey,
  type CardData,
  type ReportCard,
  type ReportComparisonValue,
  type ReportConfig,
} from "@/lib/reports"

const card: ReportCard = {
  id: "metric",
  title: "分析",
  metric: "net_margin_rate",
  visual: "line",
  dimension: "month",
  limit: 5,
}
const config: ReportConfig = {
  name: "指標",
  template: "sales",
  period: "this_month",
  owner_id: null,
  customer_type: null,
  cards: [card],
}
const value: ReportComparisonValue = {
  previous: 0.4,
  delta: 0.1,
  relative_change: null,
  previous_rows: 2,
  status: "ok",
}

describe("分析指標與比較", () => {
  it("淨毛利率依百分比、訂單依張、客單價依元；無法計算保留空值", () => {
    expect(formatReportValue(0.535, "net_margin_rate")).toBe("53.5%")
    expect(formatReportExactValue(3, "order_count")).toBe("3 張")
    expect(formatReportValue(1450 / 3, "avg_order_value")).toBe("483.33 元")
    expect(formatReportValue(null, "net_margin_rate")).toBe("無法計算")
    expect(formatReportValue(0, "net_margin_rate")).toBe("0%")
    expect(formatReportValue(-0.15, "net_margin_rate")).toBe("-15%")
  })
  it("比率以百分點比較，金額正常成長用百分比", () => {
    expect(comparisonText(value, "net_margin_rate")).toBe("+10 個百分點")
    expect(
      comparisonText(
        { ...value, previous: 100, delta: 50, relative_change: 0.5 },
        "sales"
      )
    ).toBe("+50%")
    expect(comparisonText({ ...value, delta: 0 }, "net_margin_rate")).toBe(
      "0 個百分點"
    )
  })
  it("缺資料、零分母及負基準不表示為 0% 或無限大", () => {
    expect(
      comparisonText(
        { ...value, status: "previous_zero", previous: 0, delta: 100 },
        "sales"
      )
    ).toContain("差額 +100 元")
    expect(
      comparisonText(
        { ...value, status: "negative_baseline", previous: -100, delta: 50 },
        "sales"
      )
    ).toContain("僅顯示差額")
    expect(
      comparisonText(
        { ...value, status: "current_undefined", delta: null },
        "net_margin_rate"
      )
    ).toBe("本期指標無法計算")
    expect(
      comparisonPrevious(
        { ...value, status: "no_previous_data", previous_rows: 0 },
        "sales"
      )
    ).toBe("無比較資料")
  })
  it("比較模式改變會重抓資料，與圖表配色及順序無關", () => {
    expect(
      reportDataKey({
        ...config,
        cards: [{ ...card, comparison: "previous_year" }],
      })
    ).not.toBe(reportDataKey(config))
    expect(
      reportDataKey({ ...config, cards: [{ ...card, color: "#000000" }] })
    ).toBe(reportDataKey(config))
  })
  it("非加總指標切換成有效比較图；快照清除歷史比較", () => {
    expect(
      normalizeCard({
        ...card,
        metric: "order_count",
        visual: "stacked_column",
        legend: "owner",
      }).visual
    ).toBe("column")
    expect(normalizeCard({ ...card, visual: "donut" }).visual).toBe("column")
    expect(
      normalizeCard({
        ...card,
        metric: "customers",
        comparison: "previous_month",
      }).comparison
    ).toBe("none")
    expect(
      normalizeCard({
        ...card,
        visual: "combo",
        secondary_metric: "order_count",
      }).secondary_metric
    ).toBe("order_count")
  })
  it("彙總 CSV 用可讀百分比與百分點，空值保持空白而非零", () => {
    const data: CardData = {
      id: "metric",
      total: 0.5,
      note: null,
      points: [
        { key: "2031-04", label: "2031/04", value: 0.5, comparison: value },
        {
          key: "2031-05",
          label: "2031/05",
          value: null,
          comparison: {
            ...value,
            previous: null,
            delta: null,
            status: "current_undefined",
          },
        },
      ],
      comparison: {
        mode: "previous_month",
        start: "2031-03-01",
        end: "2031-03-17",
        value,
        note: "同區間",
      },
    }
    const csv = reportCsv(card, data)
    expect(csv).toContain('"淨毛利率（%）"')
    expect(csv).toContain('"差異（百分點）"')
    expect(csv).toContain('"2031/04","50","40","10","","可比較"')
    expect(csv).toContain('"2031/05","","","","","本期指標無法計算"')
  })
})
