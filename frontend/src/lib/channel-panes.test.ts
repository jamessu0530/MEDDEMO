import { describe, expect, it } from "vitest"

import type { Channel } from "@/api/channels"
import { channelPanes } from "@/lib/channel-panes"

const channel = (id: number, kind: Channel["kind"], name: string, extra: Partial<Channel> = {}) =>
  ({ id, kind, name, region_id: null, parent_id: null, unread: 0, archived: false, can_manage: false, ...extra }) as Channel

const national = channel(1, "national", "全國")
const north = channel(2, "region", "北區", { parent_id: 1 })
const news = channel(21, "topic", "新品上市", { parent_id: 2 })
const team = channel(5, "team", "陳建宏小組", { parent_id: 2 })
const daan = channel(9, "place", "台北市・大安區", { parent_id: 2 })
const channels = [national, north, news, team, daan]
const thread = { id: 300, kind: "customer" as const, parent_id: 9 }

const panes = (input: Partial<Parameters<typeof channelPanes>[0]>) =>
  channelPanes({ channels, routeId: null, requested: null, remembered: null, role: "sales", opened: null, ...input })

describe("channelPanes", () => {
  it("/channels/:id 是文字頻道：對話開它，頻道列選上層", () => {
    expect(panes({ routeId: 21 })).toEqual({ railId: 2, openId: 21 })
  })

  it("/channels/:id 是頻道列上的頻道：兩邊都是它", () => {
    expect(panes({ routeId: 2 })).toEqual({ railId: 2, openId: 2 })
    expect(panes({ routeId: 9 })).toEqual({ railId: 9, openId: 9 })
  })

  it("客戶討論串不在清單裡：載入之前頻道列先不選，載入之後選它的地點", () => {
    expect(panes({ routeId: 300 })).toEqual({ railId: null, openId: 300 })
    expect(panes({ routeId: 300, opened: thread })).toEqual({ railId: 9, openId: 300 })
  })

  it("對話欄還留著上一個頻道的資料時不算", () => {
    expect(panes({ routeId: 300, opened: { id: 301, kind: "customer", parent_id: 2 } })).toEqual({ railId: null, openId: 300 })
  })

  it("/channels 沒帶 id：照 ?c=、記住的、預設的，對話開頻道列選中的那個", () => {
    expect(panes({ requested: 2 })).toEqual({ railId: 2, openId: 2 })
    expect(panes({ requested: 21 })).toEqual({ railId: 2, openId: 2 })
    expect(panes({ remembered: 9 })).toEqual({ railId: 9, openId: 9 })
    expect(panes({})).toEqual({ railId: 5, openId: 5 })
    expect(panes({ role: "it" })).toEqual({ railId: 1, openId: 1 })
  })

  it("一個頻道都看不到", () => {
    expect(panes({ channels: [] })).toEqual({ railId: null, openId: null })
  })
})
