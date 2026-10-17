import { describe, expect, it } from "vitest"
import type { Channel } from "@/api/channels"
import { placeDirectory } from "@/lib/channel-geography"
import { railItems, shortName } from "@/lib/channel-rail"

const place = (id: number, name: string, extra: Partial<Channel> = {}) => ({ id, name, kind: "place", region_id: null, unread: 0, ...extra }) as Channel

describe("全台地點頻道", () => {
  it("完整保留22縣市、368行政區，包含沒有公開通路資料的離島", () => {
    const { cities } = placeDirectory([])
    expect(cities).toHaveLength(22)
    expect(cities.reduce((sum, city) => sum + city.total, 0)).toBe(368)
    expect(cities.find((city) => city.name === "連江縣")?.total).toBe(4)
  })

  it("對齊台臺、空白與分隔符，搜尋同名行政區仍依縣市區別", () => {
    const daan = place(1, "台北市・大安區", { unread: 2 })
    const taichung = place(2, "臺中市大安區")
    const { cities } = placeDirectory([daan, taichung], "大安")
    expect(cities.map((city) => city.name)).toEqual(["臺北市", "臺中市"])
    expect(cities[0].districts[0].channels).toEqual([daan])
    expect(cities[0].unread).toBe(2)
    expect(placeDirectory([daan], " 台 北 ").cities[0].districts.find((district) => district.name === "大安區")?.channels).toEqual([daan])
    expect(shortName(place(3, "臺北市大安區"))).toBe("大安")
  })

  it("不混入私人組織地點，未知來源地點保留在待核對清單且不灌入行政區數", () => {
    const privatePlace = place(1, "台北市・大安區", { region_id: "TW.N" })
    const unknown = place(2, "待核對新北市")
    const shared = place(3, "桃園市中壢區")
    const directory = placeDirectory([privatePlace, unknown, shared])
    expect(directory.other).toEqual([unknown])
    expect(directory.cities[1].districts.flatMap((district) => district.channels)).toEqual([])
    expect(railItems([privatePlace, unknown, shared])[0]).toMatchObject({ type: "folder", key: "shared-places", channels: [unknown, shared] })
    expect(placeDirectory([shared], "不存在").cities).toEqual([])
  })
})
