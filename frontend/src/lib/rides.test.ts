import { describe, expect, it } from "vitest"

import { RIDE_CITIES, rideCity, SPECIALTY } from "@/lib/rides"

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
