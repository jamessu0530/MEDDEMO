import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import {
  ReportDateRangeEditor,
  ReportFilterChips,
  ReportPeriodEditor,
  ReportSlicerEditor,
} from "@/components/reports/report-filters"
import { emptyFilterOptions } from "@/lib/report-filters"

describe("報表篩選介面", () => {
  const options = {
    ...emptyFilterOptions(),
    customer: [
      { key: "C1", label: "杏林診所" },
      { key: "C2", label: "仁和藥局" },
    ],
  }
  const fallback = { start: "2031-04-01", end: "2031-04-17" }
  it("四種切片器顯示選擇器入口與已選摘要，不預先渲染長清單", () => {
    const html = renderToStaticMarkup(
      createElement(ReportSlicerEditor, {
        options,
        slicers: [{ dimension: "customer", keys: ["C1"] }],
        onChange: () => undefined,
      })
    )
    for (const label of ["業務", "客戶", "商品", "客戶類型"])
      expect(html).toContain(`aria-label="${label}"`)
    expect(html.match(/role="combobox"/g)).toHaveLength(4)
    expect(html).toContain("杏林診所")
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('role="option"')
  })
  it("有效條件使用可見名称並標明範圍，未知值仍可清除", () => {
    const html = renderToStaticMarkup(
      createElement(ReportFilterChips, {
        options,
        scope: "目前分頁",
        slicers: [{ dimension: "customer", keys: ["C1", "C3"] }],
        onRemoveSlicer: () => undefined,
      })
    )
    expect(html).toContain("目前分頁 · 客戶：杏林診所、已無可用選項（C3）")
    expect(html).toContain("清除目前分頁")
  })
  it("日期在明確套用前保持草稿，輸入無效時禁用套用", () => {
    const html = renderToStaticMarkup(
      createElement(ReportDateRangeEditor, {
        value: { start: "2031-04-17", end: "2031-04-01" },
        fallback,
        asOf: "2031-04-17",
        onChange: () => undefined,
      })
    )
    expect(html).toContain("起始日期不能晚於結束日期")
    expect(html).toContain('disabled=""')
    expect(html).toContain('max="2031-04-17"')
  })
  it("預設期間與自訂日期共用控制，分頁和單圖可沿用期間", () => {
    const html = renderToStaticMarkup(
      createElement(ReportPeriodEditor, {
        period: "custom",
        range: fallback,
        fallback,
        onChange: () => undefined,
      })
    )
    expect(html).toContain('value="custom" selected=""')
    expect(html).toContain("報表日期起始日期")
    const inherit = renderToStaticMarkup(
      createElement(ReportDateRangeEditor, {
        value: null,
        fallback,
        allowClear: true,
        label: "單圖日期",
        onChange: () => undefined,
      })
    )
    expect(inherit).toContain("單圖日期：沿用報表期間")
    expect(inherit).toContain("另設日期範圍")
  })
})
