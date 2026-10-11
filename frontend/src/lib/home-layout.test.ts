import { describe, expect, it } from "vitest"

import { hasHomeMapRoom } from "@/lib/home-layout"

describe("首頁地圖的可用空間", () => {
  it("扣掉側邊欄後仍要同時放得下路線、欄距與地圖才並排", () => {
    expect(hasHomeMapRoom(752, 16)).toBe(false) // 1024px 桌機
    expect(hasHomeMapRoom(815, 16)).toBe(false)
    expect(hasHomeMapRoom(816, 16)).toBe(true)
  })

  it("放大字體後改成單欄，寬螢幕仍可並排", () => {
    expect(hasHomeMapRoom(940, 16)).toBe(true)
    expect(hasHomeMapRoom(940, 20)).toBe(false)
    expect(hasHomeMapRoom(1020, 20)).toBe(true)
  })
})
