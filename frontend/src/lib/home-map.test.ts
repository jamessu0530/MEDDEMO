import { describe, expect, it } from "vitest"

import type { MapStop, RouteStop, TodayMap } from "@/api/route"
import { navigationUrl, shownStop, stopHeading } from "@/lib/home-map"

function pin(number: number, status: MapStop["status"]): MapStop {
  return { number, customer_id: `C${number}`, customer_name: `客戶${number}`, status, lat: 25.05 + number / 100, lng: 121.55 }
}

function map(stops: MapStop[]): TodayMap {
  return { version: 1, travel_mode: "drive", origin: { lat: 25.04, lng: 121.53 }, stops, legs: [] }
}

const detail = (extra: Partial<RouteStop>) => ({ planned_time: "11:00", ...extra }) as RouteStop

describe("navigationUrl", () => {
  it("開 Google 地圖的導航，終點是這一站的座標，照業務的交通方式", () => {
    expect(navigationUrl({ lat: 25.0478, lng: 121.5319 }, "drive")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=25.0478,121.5319&travelmode=driving"
    )
    expect(navigationUrl({ lat: 25.0478, lng: 121.5319 }, "scooter")).toContain("travelmode=two-wheeler")
    expect(navigationUrl({ lat: 25.0478, lng: 121.5319 }, "transit")).toContain("travelmode=transit")
  })
})

describe("shownStop", () => {
  const day = map([pin(1, "done"), pin(2, "next"), pin(3, "todo")])

  it("沒點過就是下一站", () => {
    expect(shownStop(day, null)?.number).toBe(2)
  })

  it("點了哪一站就是那一站", () => {
    expect(shownStop(day, "C3")?.number).toBe(3)
    expect(shownStop(day, "C1")?.number).toBe(1)
  })

  it("點過的那一站已經不在行程裡（換版了）就回到下一站", () => {
    expect(shownStop(day, "GONE")?.number).toBe(2)
  })

  it("都跑完了、也沒點，就沒有卡片", () => {
    expect(shownStop(map([pin(1, "done"), pin(2, "done")]), null)).toBeNull()
  })
})

describe("stopHeading", () => {
  it("下一站、其他還沒去的、跑完的", () => {
    expect(stopHeading(pin(2, "next"), detail({}))).toBe("下一站 · 第 2 站 · 11:00 到")
    expect(stopHeading(pin(3, "todo"), detail({ planned_time: "13:30" }))).toBe("第 3 站 · 13:30 到")
    expect(stopHeading(pin(1, "done"), detail({ planned_time: "09:10" }))).toBe("第 1 站 · 09:10 完成")
  })

  it("首頁的行程裡找不到這一站（剛換版）就只寫第幾站", () => {
    expect(stopHeading(pin(2, "next"), undefined)).toBe("下一站 · 第 2 站")
  })
})
