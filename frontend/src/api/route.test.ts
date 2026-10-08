import { describe, expect, it } from "vitest"

import { normalizeRoute, type TodayRoute } from "@/api/route"

describe("normalizeRoute", () => {
  it("手機上存的舊行程補上每段的交通方式與辦公室", () => {
    const old = { travel_mode: "scooter", stops: [{ customer_id: "a" }] } as unknown as TodayRoute
    const route = normalizeRoute(old)
    expect(route.stops[0]).toMatchObject({ travel_mode: "scooter", travel_estimated: true, city: "" })
    expect(route).toMatchObject({ start_city: null, office_start: true, id: 0 })
  })

  it("再更舊的（沒有整天的交通方式）當開車；新的照舊", () => {
    const older = { stops: [{ customer_id: "a" }] } as unknown as TodayRoute
    expect(normalizeRoute(older).stops[0].travel_mode).toBe("drive")
    const fresh = {
      id: 7,
      travel_mode: "drive",
      start_city: "台北市",
      office_start: false,
      stops: [{ customer_id: "a", travel_mode: "walk", travel_estimated: false, city: "新北市" }],
    } as unknown as TodayRoute
    expect(normalizeRoute(fresh)).toEqual(fresh)
  })
})
