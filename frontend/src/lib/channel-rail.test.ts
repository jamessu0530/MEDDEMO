import { describe, expect, it } from "vitest"

import type { Channel } from "@/api/channels"
import { folderExpanded, pickSelected, railItems, railPath, railUnread, shortName, topicsOf } from "@/lib/channel-rail"

const channel = (id: number, kind: Channel["kind"], name: string, extra: Partial<Channel> = {}) =>
  ({ id, kind, name, region_id: null, parent_id: null, unread: 0, archived: false, can_manage: false, ...extra }) as Channel

// 北區業務看得到的頻道，順序跟後端 GET /api/channels 一樣
const national = channel(1, "national", "全國")
const notice = channel(20, "topic", "公司公告", { parent_id: 1, unread: 1 })
const north = channel(2, "region", "北區", { region_id: "TW.N", parent_id: 1, unread: 2 })
const news = channel(21, "topic", "新品上市", { region_id: "TW.N", parent_id: 2, unread: 3 })
const old = channel(22, "topic", "舊活動", { region_id: "TW.N", parent_id: 2, unread: 5, archived: true })
const team = channel(5, "team", "陳建宏小組", { region_id: "TW.N", parent_id: 2 })
const daan = channel(9, "place", "台北市・大安區", { region_id: "TW.N", parent_id: 2, unread: 4 })
const xinbei = channel(10, "place", "新北市", { region_id: "TW.N", parent_id: 2, unread: 1 })
const rep = [national, notice, north, news, old, team, daan, xinbei]

describe("shortName", () => {
  it("小組取主管名字的最後兩個字，地點取行政區或縣市，全國與整區照名稱", () => {
    expect(shortName(team)).toBe("建宏")
    expect(shortName(daan)).toBe("大安")
    expect(shortName(xinbei)).toBe("新北")
    expect(shortName(channel(11, "place", "彰化縣"))).toBe("彰化")
    expect(shortName(north)).toBe("北區")
    expect(shortName(national)).toBe("全國")
  })

  it("英文名字的主管跟頭像一樣取縮寫", () => {
    expect(shortName(channel(12, "team", "James Su小組"))).toBe("JS")
  })
})

describe("topicsOf / railUnread", () => {
  it("文字頻道依上層挑出來，照後端的順序（封存的在後面）", () => {
    expect(topicsOf(rep, 2).map((c) => c.name)).toEqual(["新品上市", "舊活動"])
    expect(topicsOf(rep, 1).map((c) => c.name)).toEqual(["公司公告"])
  })

  it("整區與全國的數字加上底下沒封存的文字頻道", () => {
    expect(railUnread(rep, north)).toBe(2 + 3)
    expect(railUnread(rep, national)).toBe(1)
    expect(railUnread(rep, daan)).toBe(4)
  })
})

describe("railItems", () => {
  it("全國 → 每一區（整區、小組、地點資料夾）；文字頻道不在左欄", () => {
    const items = railItems(rep)
    expect(items.map((item) => (item.type === "channel" ? item.channel.name : item.type === "folder" ? item.label : "—"))).toEqual([
      "全國",
      "—",
      "北區",
      "陳建宏小組",
      "地點",
    ])
    const places = items.at(-1)
    expect(places).toMatchObject({ type: "folder", icon: "places", unread: 5 })
    expect(places?.type === "folder" && places.channels.map((c) => c.name)).toEqual(["台北市・大安區", "新北市"])
  })

  it("IT 看到每一區，封存的小組頻道收在最後的已封存資料夾", () => {
    const south = channel(3, "region", "南區", { region_id: "TW.S", parent_id: 1 })
    const gone = channel(7, "team", "蔡宗翰小組", { archived: true })
    const items = railItems([national, north, team, south, gone])
    expect(items.map((item) => (item.type === "channel" ? item.channel.name : item.type === "folder" ? item.label : "—"))).toEqual([
      "全國",
      "—",
      "北區",
      "陳建宏小組",
      "—",
      "南區",
      "—",
      "已封存",
    ])
  })
})

describe("pickSelected", () => {
  it("網址指定的優先，再來是上次選的", () => {
    expect(pickSelected(rep, 9, 2, "sales")?.name).toBe("台北市・大安區")
    expect(pickSelected(rep, null, 2, "sales")?.name).toBe("北區")
  })

  it("指定的是文字頻道就停在它的上層", () => {
    expect(pickSelected(rep, 21, null, "sales")?.name).toBe("北區")
  })

  it("都不在了：業務與主管停在自己的小組，IT 停在全國", () => {
    expect(pickSelected(rep, 999, 998, "sales")?.name).toBe("陳建宏小組")
    expect(pickSelected(rep, null, null, "manager")?.name).toBe("陳建宏小組")
    expect(pickSelected(rep, null, null, "it")?.name).toBe("全國")
    expect(pickSelected([], null, null, "sales")).toBeNull()
  })
})

describe("railPath", () => {
  it("文字頻道與客戶討論串回上層，其他回自己", () => {
    expect(railPath(news)).toBe("/channels?c=2")
    expect(railPath(channel(30, "customer", "忠孝店", { parent_id: 9 }))).toBe("/channels?c=9")
    expect(railPath(team)).toBe("/channels?c=5")
  })
})

describe("folderExpanded", () => {
  it("沒點過的資料夾：裡面有選中的頻道就展開，沒有就收著", () => {
    expect(folderExpanded(new Map(), "places-2", true)).toBe(true)
    expect(folderExpanded(new Map(), "places-2", false)).toBe(false)
  })

  it("自己點過的照自己點的：選中的頻道在裡面也收得起來", () => {
    expect(folderExpanded(new Map([["places-2", false]]), "places-2", true)).toBe(false)
    expect(folderExpanded(new Map([["places-2", true]]), "places-2", false)).toBe(true)
    // 點的是別的資料夾，不影響這一個
    expect(folderExpanded(new Map([["archived", false]]), "places-2", true)).toBe(true)
  })
})
