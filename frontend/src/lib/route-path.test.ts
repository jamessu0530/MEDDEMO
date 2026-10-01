import { describe, expect, it } from "vitest"

import { bearStopIndex, labelSide, pathOffset, signalTone } from "@/lib/route-path"

const stops = (...statuses: ("done" | "next" | "todo")[]) => statuses.map((status) => ({ status }))

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

describe("bearStopIndex", () => {
  it("下一站剛好置中就站在下一站旁邊", () => {
    expect(bearStopIndex(stops("next", "todo", "todo"))).toBe(0)
  })
  it("否則往後找第一個置中的站", () => {
    expect(bearStopIndex(stops("done", "done", "next", "todo", "todo", "todo"))).toBe(4)
  })
  it("後面沒有置中的站就站在終點", () => {
    expect(bearStopIndex(stops("done", "next", "todo"))).toBeNull()
  })
  it("全部完成就站在終點", () => {
    expect(bearStopIndex(stops("done", "done", "done", "done", "done"))).toBeNull()
  })
  it("沒有標下一站時從第一個還沒去的開始找", () => {
    expect(bearStopIndex(stops("done", "todo", "todo", "todo", "todo"))).toBe(4)
  })
  it("沒有站就站在終點", () => {
    expect(bearStopIndex([])).toBeNull()
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
