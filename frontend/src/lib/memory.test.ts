import { describe, expect, it } from "vitest"

import { dueText, localToday } from "@/lib/memory"

describe("dueText", () => {
  it("寫出逾期、今天、明天，其他寫日期", () => {
    expect(dueText("2026-09-28", "2026-10-01")).toEqual({ text: "逾期 3 天", overdue: true })
    expect(dueText("2026-10-01", "2026-10-01")).toEqual({ text: "今天到期", overdue: false })
    expect(dueText("2026-10-02", "2026-10-01")).toEqual({ text: "明天到期", overdue: false })
    expect(dueText("2026-10-15", "2026-10-01")).toEqual({ text: "10/15 到期", overdue: false })
  })
})

describe("localToday", () => {
  it("用手機的日期，不是 UTC 的", () => {
    expect(localToday(new Date(2026, 9, 1, 7, 30))).toBe("2026-10-01")
  })
})
