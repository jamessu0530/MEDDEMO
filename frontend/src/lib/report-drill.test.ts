import { describe, expect, it } from "vitest"
import {
  canExploreDates,
  drillDown,
  drillReset,
  drillUp,
  reportExploreQuery,
  resolveReportPointAction,
} from "@/lib/report-drill"
import {
  normalizeCard,
  reportDataKey,
  type ReportCard,
  type ReportConfig,
  type ReportSelectionPoint,
} from "@/lib/reports"

const card: ReportCard = {
  id: "trend",
  title: "日期",
  metric: "sales",
  dimension: "year",
  legend: "owner",
  visual: "stacked_column",
  limit: 5,
}
const config: ReportConfig = {
  name: "分析",
  template: "sales",
  period: "year",
  owner_id: null,
  customer_type: null,
  cards: [card],
}
const point = (
  dimension: "year" | "quarter" | "month",
  key: string
): ReportSelectionPoint => ({
  label: key + " · S2",
  filters: [
    { dimension, key },
    { dimension: "owner", key: "S2" },
  ],
})

describe("日期下鑽", () => {
  it("年到季到月保留成對系列條件，上一層還原祖先", () => {
    const quarter = drillDown(card, undefined, point("year", "2031"))!
    const month = drillDown(card, quarter, point("quarter", "2031-Q1"))!
    const query = reportExploreQuery(config, { trend: month }, [])
    expect(query.cards[0].dimension).toBe("month")
    expect(query.drill_filters?.trend).toEqual([
      { dimension: "year", key: "2031" },
      { dimension: "owner", key: "S2" },
      { dimension: "quarter", key: "2031-Q1" },
    ])
    expect(drillUp(month)).toEqual(quarter)
    expect(drillUp(quarter)).toEqual({ dimension: "year", steps: [] })
    expect(drillReset(month)).toEqual({ dimension: "year", steps: [] })
  })
  it("查詢粒度、祖先條件影響資料 key，但不改寫原本報表設定", () => {
    const before = JSON.stringify(config)
    const state = drillDown(card, undefined, point("year", "2031"))!
    const query = reportExploreQuery(config, { trend: state }, [])
    expect(reportDataKey(query)).not.toBe(reportDataKey(config))
    expect(JSON.stringify(config)).toBe(before)
    expect(config).not.toHaveProperty("drill_filters")
    expect(config.cards[0].dimension).toBe("year")
    expect(reportExploreQuery(config, {}, []).cards[0].dimension).toBe("year")
  })
  it("不能從月份繼續下鑽，也不能使用其他分組的點", () => {
    expect(
      drillDown(
        { ...card, dimension: "month" },
        undefined,
        point("month", "2031-01")
      )
    ).toBeNull()
    expect(drillDown(card, undefined, point("quarter", "2031-Q1"))).toBeNull()
    expect(canExploreDates({ ...card, visual: "matrix" })).toBe(false)
    expect(canExploreDates({ ...card, dimension: "customer" })).toBe(false)
    expect(
      resolveReportPointAction({ ...card, visual: "matrix" }, "drill")
    ).toBe("details")
    expect(
      resolveReportPointAction({ ...card, dimension: "month" }, "drill")
    ).toBe("details")
    expect(resolveReportPointAction(card, "drill")).toBe("drill")
  })
  it("下鑽條件順序不改變查詢 key，清空祖先恢復整個期間", () => {
    const query = reportExploreQuery(
      config,
      { trend: drillDown(card, undefined, point("year", "2031"))! },
      []
    )
    expect(
      reportDataKey({
        ...query,
        drill_filters: { trend: [...query.drill_filters!.trend].reverse() },
      })
    ).toBe(reportDataKey(query))
    expect(
      reportExploreQuery(
        config,
        { trend: { dimension: "quarter", steps: [] } },
        []
      ).drill_filters
    ).toEqual({})
  })
  it("折線、面積、組合保留年或季軸，快照自動改成有效分組", () => {
    for (const visual of ["line", "area", "combo"] as const)
      expect(
        normalizeCard({ ...card, visual, dimension: "quarter" }).dimension
      ).toBe("quarter")
    expect(
      normalizeCard({ ...card, metric: "customers", visual: "line" }).dimension
    ).toBe("customer")
  })
})
