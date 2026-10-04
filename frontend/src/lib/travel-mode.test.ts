import { describe, expect, it } from "vitest"

import { routeSource, TRAVEL_MODE_LABEL, TRAVEL_MODES } from "@/lib/travel-mode"

describe("交通方式", () => {
  it("三種，照設定頁與地圖上的順序", () => {
    expect(TRAVEL_MODES).toEqual(["drive", "scooter", "transit"])
    expect(TRAVEL_MODES.map((mode) => TRAVEL_MODE_LABEL[mode])).toEqual(["開車", "機車", "大眾運輸"])
  })

  it("車程從哪裡來：估算的寫估計；Google 的機車路線要註明是測試版", () => {
    expect(routeSource("drive", true)).toBe("（估計）")
    expect(routeSource("drive", false)).toBe("（Google 路線）")
    expect(routeSource("transit", false)).toBe("（Google 路線）")
    expect(routeSource("scooter", false)).toBe("（Google 機車路線測試版）")
  })
})
