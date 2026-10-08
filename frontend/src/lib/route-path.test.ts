import { describe, expect, it } from "vitest"

import { labelSide, pathOffset, signalTone } from "@/lib/route-path"

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
  it("商機是好消息、例行是平常、其他都是警示", () => {
    expect(signalTone("opportunity")).toBe("good")
    expect(signalTone("routine")).toBe("plain")
    expect(signalTone("ar")).toBe("alert")
    expect(signalTone("commitment")).toBe("alert")
  })
})
