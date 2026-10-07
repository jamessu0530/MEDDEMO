import { describe, expect, it } from "vitest"

import {
  legFrom,
  legMinutes,
  LEG_MODES,
  MODE_ICON,
  NAVIGATION_MODE,
  routeSource,
  TRAVEL_MODE_LABEL,
  TRAVEL_MODES,
} from "@/lib/travel-mode"

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
    expect(routeSource("walk", false)).toBe("（Google 走路路線測試版）")
  })

  it("單段多一種走路，字、圖示、導航都對得起來", () => {
    expect(LEG_MODES).toEqual(["drive", "scooter", "transit", "walk"])
    expect(TRAVEL_MODES).toEqual(LEG_MODES.slice(0, 3))
    expect(LEG_MODES.map((mode) => TRAVEL_MODE_LABEL[mode])).toEqual(["開車", "機車", "大眾運輸", "走路"])
    expect(Object.keys(MODE_ICON).sort()).toEqual([...LEG_MODES].sort())
    expect(NAVIGATION_MODE.walk).toBe("walking")
  })

  it("估算的分鐘數前面加「約」；第一站從辦公室出發", () => {
    expect(legMinutes(12, false)).toBe("12 分")
    expect(legMinutes(12, true)).toBe("約 12 分")
    expect(legFrom([{ customer_id: "a" }, { customer_id: "b" }], 0)).toBeNull()
    expect(legFrom([{ customer_id: "a" }, { customer_id: "b" }], 1)).toBe("a")
  })
})
