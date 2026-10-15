import { describe, expect, it } from "vitest"
import {
  normalizeReportConfig,
  reportDataKey,
  type ReportConfig,
} from "./reports"
import { reportLoadedTime, reportRefreshDue } from "./report-refresh"

describe("報表資料更新", () => {
  it("間隔到期只在前景、連線且沒有查詢時刷新", () => {
    expect(reportRefreshDue(60, 1000, 61000, true, true, false)).toBe(true)
    expect(reportRefreshDue(60, 1000, 60999, true, true, false)).toBe(false)
    expect(reportRefreshDue(0, 0, 999999, true, true, false)).toBe(false)
    for (const [visible, online, busy] of [
      [false, true, false],
      [true, false, false],
      [true, true, true],
    ])
      expect(reportRefreshDue(60, 0, 999999, visible, online, busy)).toBe(false)
  })
  it("成功載入時間顯示台北實際時間，無效時間不虛構成功", () => {
    expect(reportLoadedTime("2031-04-09T16:00:01Z")).toContain("2031/04/10")
    expect(reportLoadedTime("2031-04-09T16:00:01Z")).toContain("00:00:01")
    expect(reportLoadedTime("invalid")).toBe("尚未成功載入")
  })
  it("舊報表預設關閉，自動刷新設定不改變資料條件或清除探索", () => {
    const config = {
      name: "舊報表",
      template: "sales",
      period: "this_month",
      owner_id: null,
      customer_type: null,
      cards: [],
    } as ReportConfig
    expect(normalizeReportConfig(config).refresh_seconds).toBe(0)
    expect(reportDataKey({ ...config, refresh_seconds: 60 })).toBe(
      reportDataKey(config)
    )
  })
})
