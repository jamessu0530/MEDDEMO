import { describe, expect, it } from "vitest"

import { dayTitle, monthGrid, monthTitle, noteDate, shiftMonth } from "@/lib/calendar"

describe("monthGrid", () => {
  it("從星期一開始，前後補空格", () => {
    const grid = monthGrid("2026-10")
    // 2026-10-01 是星期四：前面補三格
    expect(grid.slice(0, 4)).toEqual([null, null, null, "2026-10-01"])
    expect(grid.length % 7).toBe(0)
    expect(grid.filter(Boolean)).toHaveLength(31)
    // 10/31 是星期六，後面補一格
    expect(grid.at(-2)).toBe("2026-10-31")
    expect(grid.at(-1)).toBeNull()
  })
  it("月初剛好是星期一就不補", () => {
    expect(monthGrid("2026-06")[0]).toBe("2026-06-01")
  })
  it("二月", () => {
    expect(monthGrid("2028-02").filter(Boolean)).toHaveLength(29)
  })
})

describe("shiftMonth", () => {
  it("跨年", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01")
    expect(shiftMonth("2026-01", -1)).toBe("2025-12")
    expect(shiftMonth("2026-10", 0)).toBe("2026-10")
  })
})

describe("日期的寫法", () => {
  it("月/日、月份標題、某一天的標題", () => {
    expect(noteDate("2026-10-30")).toBe("10/30")
    expect(monthTitle("2026-10")).toBe("2026 年 10 月")
    expect(dayTitle("2026-10-30")).toBe("10 月 30 日（星期五）")
  })
})
