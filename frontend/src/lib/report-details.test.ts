import { describe, expect, it } from "vitest"
import {
  detailCsvFilename,
  detailPageCount,
  detailValue,
} from "@/lib/report-details"
import type { ReportDetailsColumn } from "@/api/reports"

describe("逐筆明細", () => {
  const column: ReportDetailsColumn = {
    key: "amount",
    label: "業績",
    kind: "currency",
    sort_key: "amount",
  }
  it("保留零值與負值，空值不當成零", () => {
    expect(detailValue(column, 0)).toBe("0.00")
    expect(detailValue(column, -20.5)).toBe("-20.50")
    expect(detailValue(column, null)).toBe("—")
    expect(detailValue(column, 1250.25)).toBe("1,250.25")
  })
  it("拜訪時間使用台北日界線，日期和文字保持原意", () => {
    expect(
      detailValue({ ...column, kind: "datetime" }, "2031-04-09T16:00:00Z")
    ).toMatch(/2031\/04\/10\s+00:00/u)
    expect(detailValue({ ...column, kind: "date" }, "2031-04-10")).toBe(
      "2031-04-10"
    )
    expect(detailValue({ ...column, kind: "text" }, "00015")).toBe("00015")
  })
  it("分頁涵蓋最後不足一頁的資料，空結果仍有第一頁", () => {
    expect(detailPageCount(111, 25)).toBe(5)
    expect(detailPageCount(100, 25)).toBe(4)
    expect(detailPageCount(0, 25)).toBe(1)
  })
  it("匯出檔名不含路徑字元，並標示完整逐筆資料", () => {
    expect(detailCsvFilename("客戶/業績:4月")).toBe(
      "客戶_業績_4月-完整逐筆明細.csv"
    )
  })
})
