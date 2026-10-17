import { describe, expect, it } from "vitest"
import { reportWidgetSize } from "@/lib/report-widget"
describe("報表 Widget 尺寸", () => {
  it("狹長或扁平卡片保留摘要，有足夠寬高才展開資訊", () => {
    expect(reportWidgetSize(180, 900)).toBe("small")
    expect(reportWidgetSize(900, 190)).toBe("small")
    expect(reportWidgetSize(320, 432)).toBe("medium")
    expect(reportWidgetSize(320, 672)).toBe("large")
    expect(reportWidgetSize(260, 280)).toBe("medium")
    expect(reportWidgetSize(260, 560)).toBe("large")
  })
})
