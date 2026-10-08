import { describe, expect, it } from "vitest"

import type { RouteStop } from "@/api/route"
import { crossesCity, legInto, legKey, legToPlay, parkedLeg, RIDE_CITIES, ridesOf, rideCity, SPECIALTY, type Leg } from "@/lib/rides"

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

describe("legInto", () => {
  const stops = [stop("a", "done", { city: "新北市" }), stop("b", "next", { city: "新竹市", travel_mode: "transit" })]

  it("第一站從辦公室出發，縣市用 startCity", () => {
    expect(legInto(stops, 0, "台北市")).toEqual({ from: null, to: "a", fromCity: "台北市", toCity: "新北市", mode: "drive" })
  })

  it("其他站從上一站出發，帶上一站的縣市與這一段的交通方式", () => {
    expect(legInto(stops, 1, "台北市")).toEqual({ from: "a", to: "b", fromCity: "新北市", toCity: "新竹市", mode: "transit" })
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

describe("legToPlay", () => {
  const opts = { played: new Set<string>(), officeStart: true, startCity: "台北市" }

  it("剛完成一站：最後完成的站到下一站", () => {
    const stops = [stop("a", "done"), stop("b", "done"), stop("c", "next"), stop("d", "todo")]
    expect(legToPlay(stops, opts)).toMatchObject({ from: "b", to: "c" })
  })

  it("今天第一次打開：辦公室到第 1 站", () => {
    const stops = [stop("a", "next"), stop("b", "todo")]
    expect(legToPlay(stops, opts)).toMatchObject({ from: null, to: "a", fromCity: "台北市" })
  })

  it("沒有辦公室起點而且還沒完成任何站：沒有可播的", () => {
    expect(legToPlay([stop("a", "next")], { ...opts, officeStart: false })).toBeNull()
  })

  it("沒有辦公室起點但已有完成的站，照樣播下一段", () => {
    expect(legToPlay([stop("a", "done"), stop("b", "next")], { ...opts, officeStart: false })).toMatchObject({ from: "a", to: "b" })
  })

  it("播過了就不再播", () => {
    const stops = [stop("a", "done"), stop("b", "next")]
    expect(legToPlay(stops, { ...opts, played: new Set(["a>b"]) })).toBeNull()
    expect(legToPlay([stop("a", "next")], { ...opts, played: new Set(["office>a"]) })).toBeNull()
  })

  it("全部跑完是 null", () => {
    expect(legToPlay([stop("a", "done"), stop("b", "done")], opts)).toBeNull()
    expect(legToPlay([], opts)).toBeNull()
  })
})

describe("legKey 與 parkedLeg", () => {
  it("legKey 從辦公室出發寫 office", () => {
    expect(legKey(leg({ from: null, to: "a" }))).toBe("office>a")
    expect(legKey(leg())).toBe("a>b")
  })

  it("停著的那台是到下一站的那一段，全部跑完是 null", () => {
    expect(parkedLeg([stop("a", "done"), stop("b", "next")], "台北市")).toMatchObject({ from: "a", to: "b" })
    expect(parkedLeg([stop("a", "next")], "台北市")).toMatchObject({ from: null, to: "a" })
    expect(parkedLeg([stop("a", "done")], "台北市")).toBeNull()
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
