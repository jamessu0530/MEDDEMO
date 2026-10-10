import { describe, expect, it } from "vitest"

import type { RouteStop } from "@/api/route"
import {
  anchorId,
  crossesCity,
  finishesRoute,
  followsServer,
  hereOf,
  lastLeg,
  legBetween,
  officeLeg,
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

  it("點的先後照時間比，不照字串：小數秒寫法、時區不一樣也排得對", () => {
    // 字串比的話 "…:00.5Z" 排在 "…:00Z" 前面（"." < "Z"），+08:00 的也會亂掉
    const at = (id: string, arrived_at: string) => stop(id, "done", { arrived_at })
    expect(hereOf([at("A", "2026-10-28T02:00:00.5Z"), at("B", "2026-10-28T02:00:00Z")])).toBe("A")
    const zones = [at("A", "2026-10-28T10:30:00+08:00"), at("B", "2026-10-28T02:00:00Z")]
    expect(hereOf(zones)).toBe("A")
    expect(lastLeg(zones, "台北市")).toMatchObject({ from: "B", to: "A" })
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

  it("officeLeg：停在辦公室的座騎是辦公室縣市、辦公室到第 1 站的交通方式（點第 1 站出發時是同一台）", () => {
    expect(officeLeg(stops, "台北市")).toEqual({ from: null, to: "A", fromCity: "台北市", toCity: "台北市", mode: "drive" })
    // 沒有辦公室縣市：用第 1 站的
    expect(officeLeg([stop("C", "next", { city: "新竹市", travel_mode: "scooter" })], null)).toMatchObject({
      toCity: "新竹市",
      mode: "scooter",
    })
    expect(officeLeg([], "台北市")).toBeNull()
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

describe("followsServer", () => {
  it("後端的「最後點的」是這次比較早點的那一站（連點、前一站的 arrive 才回來）：熊不退回去", () => {
    // taps 也記只送 arrive、沒騎的那一下（沒有辦公室起點時點第 1 站），連點第 1、2 站時熊一樣不退回第 1 站
    expect(followsServer("A", "B", ["A", "B"])).toBe(false)
    // 點了 A、B、又點 A：B 回來時熊還是在 A
    expect(followsServer("B", "A", ["A", "B", "A"])).toBe(false)
  })

  it("回來的行程裡最後點的是別的評審點的站：這支手機點過站，熊留在原地", () => {
    // arrive 存好之後另開交易讀行程，別人剛點的那一站也在裡面、而且比較晚
    expect(followsServer("C", "B", ["A", "B"])).toBe(false)
    expect(followsServer("C", "B", ["B"])).toBe(false)
  })

  it("這支手機還沒點過（重新載入、別人點的）、IT 重置（null）：跟著後端換", () => {
    expect(followsServer("C", "B", [])).toBe(true)
    expect(followsServer("A", null, [])).toBe(true)
    expect(followsServer(null, "B", ["A", "B"])).toBe(true)
  })

  it("跟本地一樣就不用換", () => {
    expect(followsServer("B", "B", ["A", "B"])).toBe(false)
    expect(followsServer(null, null, [])).toBe(false)
  })
})

describe("finishesRoute", () => {
  it("點的是最後一站還沒到過的：點了就全部到過", () => {
    expect(finishesRoute([stop("A", "done"), stop("B", "next")], "B")).toBe(true)
    expect(finishesRoute([stop("A", "next")], "A")).toBe(true)
    // 連點：A 剛點、arrive 還沒回來（還不是 done），接著點 B
    expect(finishesRoute([stop("A", "next"), stop("B", "todo")], "B", ["A"])).toBe(true)
  })

  it("還有別站沒到過、或點的是到過的站：不算", () => {
    expect(finishesRoute([stop("A", "next"), stop("B", "todo")], "B")).toBe(false)
    // 全部到過之後再點一站看小卡：不收小卡
    expect(finishesRoute([stop("A", "done"), stop("B", "done")], "B")).toBe(false)
  })
})
