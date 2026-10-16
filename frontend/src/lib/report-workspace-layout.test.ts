import { describe, expect, it } from "vitest"
import { hasReportPanelRoom } from "@/lib/report-workspace-layout"

describe("報表工作區可用寬度", () => {
  it("扣除導覽後，畫布與兩側面板都放得下才並排", () => {
    expect(hasReportPanelRoom(800, 16, true)).toBe(false)
    expect(hasReportPanelRoom(1215, 16, true)).toBe(false)
    expect(hasReportPanelRoom(1216, 16, true)).toBe(true)
  })

  it("隱藏資料面板後可以較早展開視覺效果面板", () => {
    expect(hasReportPanelRoom(959, 16, false)).toBe(false)
    expect(hasReportPanelRoom(960, 16, false)).toBe(true)
    expect(hasReportPanelRoom(960, 16, true)).toBe(false)
  })

  it("放大字體會重新保留畫布空間", () => {
    expect(hasReportPanelRoom(1280, 16, true)).toBe(true)
    expect(hasReportPanelRoom(1280, 20, true)).toBe(false)
    expect(hasReportPanelRoom(1520, 20, true)).toBe(true)
    expect(hasReportPanelRoom(1100, 20, false)).toBe(false)
  })
})
