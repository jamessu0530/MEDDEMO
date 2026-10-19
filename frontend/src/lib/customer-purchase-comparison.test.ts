import { describe, expect, it } from "vitest"

import {
  buildPurchaseComparison,
  purchaseChangeNote,
} from "./customer-purchase-comparison"

describe("客戶每月進貨比較", () => {
  it("卡片使用本月至今，與上月同期比較；上月折線保留整月", () => {
    const comparison = buildPurchaseComparison(
      [
        {
          month: "2026-09",
          daily: [
            { date: "2026-09-01", amount: 10000 },
            { date: "2026-09-18", amount: 10000 },
            { date: "2026-09-25", amount: 50000 },
          ],
        },
        {
          month: "2026-10",
          daily: [
            { date: "2026-10-01", amount: 10000 },
            { date: "2026-10-18", amount: 20000 },
          ],
        },
      ],
      "2026-10-18"
    )
    expect(comparison.currentAmount).toBe(30000)
    expect(comparison.previousAmount).toBe(70000)
    expect(comparison.previousComparableAmount).toBe(20000)
    expect(purchaseChangeNote(comparison)).toBe("比上月同期 +50%")
    expect(comparison.points[1]).toEqual({
      day: 2,
      current: 10000,
      previous: 10000,
    })
    expect(comparison.points[18]).toEqual({
      day: 19,
      current: null,
      previous: 20000,
    })
    expect(comparison.points[30]).toEqual({
      day: 31,
      current: null,
      previous: null,
    })
  })

  it("跨年與閏年二月按實際天數對齊，不把上月不存在的日期補成零", () => {
    const january = buildPurchaseComparison([], "2027-01-01")
    expect(january.previousMonth).toBe("2026-12")
    expect(january.points[1].current).toBeNull()
    expect(january.points).toHaveLength(31)

    const march = buildPurchaseComparison(
      [{ month: "2024-02", daily: [{ date: "2024-02-29", amount: 10000 }] }],
      "2024-03-31"
    )
    expect(march.points[28].previous).toBe(10000)
    expect(march.points[29].previous).toBeNull()
    expect(march.points[30].current).toBe(0)
    expect(march.previousComparableAmount).toBe(10000)
    expect(purchaseChangeNote(march)).toBe("比上月同期 -100%")
    expect(
      buildPurchaseComparison([], "2025-03-01").points[28].previous
    ).toBeNull()
  })

  it("上月比本月長時保留上月月底；百分比不與上月整月比較", () => {
    const february = buildPurchaseComparison(
      [{ month: "2026-01", daily: [{ date: "2026-01-31", amount: 10000 }] }],
      "2026-02-28"
    )
    expect(february.points).toHaveLength(31)
    expect(february.points[30]).toEqual({
      day: 31,
      current: null,
      previous: 10000,
    })
    expect(february.previousComparableAmount).toBe(0)
    expect(purchaseChangeNote(february)).toBe("與上月同期持平")
  })

  it("上月零進貨時顯示明確提示，避免無限大的成長率", () => {
    const empty = buildPurchaseComparison([], "2026-10-18")
    expect(empty.currentAmount).toBe(0)
    expect(purchaseChangeNote(empty)).toBe("與上月同期持平")
    const first = buildPurchaseComparison(
      [{ month: "2026-10", daily: [{ date: "2026-10-18", amount: 5000 }] }],
      "2026-10-18"
    )
    expect(purchaseChangeNote(first)).toBe("上月同期無進貨")
  })
})
