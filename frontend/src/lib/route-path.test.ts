import { describe, expect, it } from "vitest"

import { departureRow, labelSide, pathOffset, signalTone } from "@/lib/route-path"

describe("pathOffset", () => {
  it("8 站一個來回，之後重複", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(pathOffset)).toEqual([0, 40, 64, 40, 0, -40, -64, -40])
    expect(pathOffset(8)).toBe(0)
    expect(pathOffset(10)).toBe(64)
  })
})

describe("labelSide", () => {
  it("圓鈕偏右時標籤在左，置中或偏左時在右", () => {
    expect(labelSide(40)).toBe("left")
    expect(labelSide(0)).toBe("right")
    expect(labelSide(-64)).toBe("right")
  })
})

describe("signalTone", () => {
  it("商機保留綠色，其他拜訪理由不再顯示警示色", () => {
    expect(signalTone("opportunity")).toBe("good")
    expect(signalTone("routine")).toBe("plain")
    expect(signalTone("ar")).toBe("plain")
    expect(signalTone("commitment")).toBe("plain")
  })
})

describe("departureRow", () => {
  const stops = [
    { customer_id: "a", status: "done" as const },
    { customer_id: "b", status: "next" as const },
    { customer_id: "c", status: "todo" as const },
  ]

  it("沒在騎：留「出發」空間的是下一站", () => {
    expect(departureRow(stops, null, false)).toBe("b")
    expect(departureRow(stops, "a", false)).toBe("b")
  })

  it("騎的時候：照開始騎時那一列，點的就是下一站、回應已經把它標成到過也不搬", () => {
    expect(departureRow(stops, "a", true)).toBe("a")
  })

  it("開始騎時沒有下一站（全部到過）：騎的時候哪一列都不留", () => {
    expect(departureRow(stops, null, true)).toBeNull()
  })

  it("沒有下一站：哪一列都不留", () => {
    expect(departureRow([{ customer_id: "a", status: "done" as const }], null, false)).toBeNull()
  })
})
