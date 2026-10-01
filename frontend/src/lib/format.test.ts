import { describe, expect, it } from "vitest"

import { formatDayLabel } from "@/lib/format"

describe("formatDayLabel", () => {
  it("月/日加星期幾", () => {
    expect(formatDayLabel("2026-10-01")).toBe("10/1（四）")
    expect(formatDayLabel("2026-10-04")).toBe("10/4（日）")
  })
})
