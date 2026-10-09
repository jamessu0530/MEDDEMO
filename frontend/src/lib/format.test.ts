import { describe, expect, it } from "vitest"

import { formatDayLabel, formatTaipeiTime, formatWan } from "@/lib/format"

describe("formatDayLabel", () => {
  it("月/日加星期幾", () => {
    expect(formatDayLabel("2026-10-01")).toBe("10/1（四）")
    expect(formatDayLabel("2026-10-04")).toBe("10/4（日）")
  })
})

describe("formatTaipeiTime 與 formatWan", () => {
  it("台北時間的時與分", () => expect(formatTaipeiTime("2026-10-28T06:05:00Z")).toBe("14:05"))
  it("萬為單位，預設一位小數", () => {
    expect(formatWan(2511468)).toBe("251.1 萬")
    expect(formatWan(31337833, 0)).toBe("3,134 萬")
  })
})
