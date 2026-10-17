import { describe, expect, it } from "vitest"
import { reportWidgetSize, reportWidgetDescription } from "@/lib/report-widget"
import { VISUALS, type ReportVisual } from "@/lib/reports"
describe("報表 Widget 尺寸", () => {
  it("狹長或扁平卡片保留摘要，有足夠寬高才展開資訊", () => {
    expect(reportWidgetSize(180, 900)).toBe("small")
    expect(reportWidgetSize(900, 190)).toBe("small")
    expect(reportWidgetSize(320, 432)).toBe("medium")
    expect(reportWidgetSize(320, 672)).toBe("large")
    expect(reportWidgetSize(260, 280)).toBe("medium")
    expect(reportWidgetSize(260, 560)).toBe("large")
    expect(reportWidgetSize(220, 432)).toBe("medium")
    expect(reportWidgetSize(220, 672)).toBe("large")
  })
  it("每種圖表都說明三種尺寸實際顯示的資訊", () => {
    for (const visual of Object.keys(VISUALS) as ReportVisual[]) {
      for (const size of ["small", "medium", "large"] as const) {
        const info = reportWidgetDescription(visual, size)
        expect(info.title).toBeTruthy()
        expect(info.detail).toBeTruthy()
        if (size === "small") expect(info.title).toBe("數字摘要")
        else if (visual !== "kpi") expect(info.title).toContain(VISUALS[visual])
      }
    }
  })
})
