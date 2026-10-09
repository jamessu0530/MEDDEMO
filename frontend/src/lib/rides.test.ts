import { describe, expect, it } from "vitest"

import type { RouteStop } from "@/api/route"
import {
  anchorId,
  crossesCity,
  hereOf,
  lastLeg,
  legBetween,
  RIDE_CITIES,
  ridesOf,
  rideCity,
  SPECIALTY,
  type Leg,
} from "@/lib/rides"

function stop(id: string, status: RouteStop["status"], extra: Partial<RouteStop> = {}): RouteStop {
  return {
    customer_id: id,
    customer_name: `客戶${id}`,
    type: "independent",
    grade: "A",
    planned_time: "10:00",
    status,
    signal: "ar",
    reason: "帳款最久拖了 78 天",
    visit_id: null,
    source: "model",
    duration_minutes: 40,
    late_minutes: 0,
    travel_minutes: 10,
    travel_km: 3.2,
    window_kind: null,
    window_time: null,
    note: null,
    locked: false,
    habit_ids: [],
    travel_mode: "drive",
    travel_estimated: false,
    city: "台北市",
    arrived_at: null,
    ...extra,
  }
}

const leg = (extra: Partial<Leg> = {}): Leg => ({ from: "a", to: "b", fromCity: "台北市", toCity: "台北市", mode: "drive", ...extra })

describe("rides", () => {
  it("七個縣市照圖鑑的順序，各有一種特產", () => {
    expect(RIDE_CITIES).toEqual(["台北市", "新北市", "新竹市", "台中市", "彰化縣", "台南市", "高雄市"])
    expect(RIDE_CITIES.map((city) => SPECIALTY[city])).toEqual(["小籠包", "天燈", "貢丸", "珍珠奶茶", "肉圓", "虱目魚", "香蕉"])
  })

  it("不在七個縣市裡的是 null", () => {
    expect(rideCity("新竹市")).toBe("新竹市")
    expect(rideCity("桃園市")).toBeNull()
    expect(rideCity("")).toBeNull()
    expect(rideCity(null)).toBeNull()
  })
})

describe("crossesCity", () => {
  it("新北到新竹跨縣市", () => expect(crossesCity(leg({ fromCity: "新北市", toCity: "新竹市" }))).toBe(true))
  it("台北到台北不跨", () => expect(crossesCity(leg())).toBe(false))
  it("桃園不在七個縣市裡，到新竹不算跨", () => {
    expect(crossesCity(leg({ fromCity: "桃園市", toCity: "新竹市" }))).toBe(false)
    expect(crossesCity(leg({ fromCity: null, toCity: "新竹市" }))).toBe(false)
  })
})

describe("熊熊滾停在哪、騎哪一段", () => {
  const stops = [
    stop("A", "done", { city: "新北市", arrived_at: "2026-10-28T02:00:00Z" }),
    stop("B", "done", { city: "台北市", arrived_at: "2026-10-28T03:00:00Z" }),
    stop("C", "next", { city: "新竹市", travel_mode: "scooter" }),
  ]

  it("anchorId：辦公室是 office", () => {
    expect(anchorId(null)).toBe("office")
    expect(anchorId("B")).toBe("B")
  })

  it("hereOf：最後點的那一站；沒點過是 null", () => {
    expect(hereOf(stops)).toBe("B")
    expect(hereOf([stop("A", "next")])).toBeNull()
  })

  it("legBetween：出發縣市是起點那一站（辦公室用 startCity），交通方式照到的那一站", () => {
    expect(legBetween(stops, "B", "C", "台北市")).toEqual({
      from: "B",
      to: "C",
      fromCity: "台北市",
      toCity: "新竹市",
      mode: "scooter",
    })
    expect(legBetween(stops, null, "A", "台北市").fromCity).toBe("台北市")
    // 往回騎也可以
    expect(legBetween(stops, "C", "A", null)).toMatchObject({ from: "C", to: "A", fromCity: "新竹市", toCity: "新北市" })
  })

  it("lastLeg：倒數第二個點的（沒有就辦公室）→ 最後點的；沒點過是 null", () => {
    expect(lastLeg(stops, "台北市")).toMatchObject({ from: "A", to: "B" })
    expect(lastLeg([stops[0]], "台北市")).toMatchObject({ from: null, to: "A", fromCity: "台北市" })
    expect(lastLeg([stop("A", "next")], "台北市")).toBeNull()
  })
})

describe("ridesOf", () => {
  it("同縣市只算一台", () => {
    expect(ridesOf(leg({ mode: "scooter" }))).toEqual([{ city: "台北市", mode: "scooter" }])
  })

  it("跨縣市算兩台：目的地先、出發地後", () => {
    expect(ridesOf(leg({ fromCity: "新北市", toCity: "新竹市" }))).toEqual([
      { city: "新竹市", mode: "drive" },
      { city: "新北市", mode: "drive" },
    ])
  })

  it("不認得的縣市不算", () => {
    expect(ridesOf(leg({ fromCity: "桃園市", toCity: "新竹市" }))).toEqual([{ city: "新竹市", mode: "drive" }])
    expect(ridesOf(leg({ fromCity: "新竹市", toCity: "桃園市" }))).toEqual([])
  })
})
