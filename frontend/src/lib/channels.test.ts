import { describe, expect, it } from "vitest"

import type { ChannelMessage } from "@/api/channels"
import { awaitingMascot, MASCOT_WAIT_MS, mergeMessages, withMascotMention } from "@/lib/channels"

const message = (id: number) => ({ id, body: `第 ${id} 則` }) as ChannelMessage

describe("mergeMessages", () => {
  it("輪詢拿到的接在後面，自己剛送出又被輪詢拿到的只留一份", () => {
    expect(mergeMessages([message(1), message(3)], [message(3), message(4)]).map((m) => m.id)).toEqual([1, 3, 4])
  })

  it("往上捲拿到的舊訊息放到前面", () => {
    expect(mergeMessages([message(5), message(6)], [message(2), message(3)]).map((m) => m.id)).toEqual([2, 3, 5, 6])
  })
})

describe("awaitingMascot", () => {
  const at = Date.parse("2026-10-01T01:00:00Z")
  const msg = (id: number, extra: Partial<ChannelMessage>) =>
    ({ id, kind: "user", mentions_ai: false, reply_to_id: null, created_at: "2026-10-01T01:00:00Z", ...extra }) as ChannelMessage

  it("叫了熊熊滾、還沒回、不到三分鐘：在想", () => {
    expect(awaitingMascot([msg(1, {}), msg(2, { mentions_ai: true })], at + 10_000)).toBe(true)
  })

  it("熊熊滾回了就不想了", () => {
    expect(awaitingMascot([msg(2, { mentions_ai: true }), msg(3, { kind: "ai", reply_to_id: 2 })], at + 10_000)).toBe(false)
  })

  it("超過三分鐘還沒回就不再顯示，背景服務停了也不會一直轉", () => {
    expect(awaitingMascot([msg(2, { mentions_ai: true })], at + MASCOT_WAIT_MS)).toBe(false)
  })

  it("沒有人叫熊熊滾", () => {
    expect(awaitingMascot([msg(1, {})], at)).toBe(false)
  })
})

describe("withMascotMention", () => {
  it("還沒叫熊熊滾就在開頭補上", () => {
    expect(withMascotMention("退貨運費誰付？")).toBe("@熊熊滾 退貨運費誰付？")
    expect(withMascotMention("")).toBe("@熊熊滾 ")
  })

  it("已經叫了就不重複，全形與 @AI 也算", () => {
    for (const draft of ["@熊熊滾 在嗎", "請@熊熊 回答", "＠熊熊滾 在嗎", "@ai 請問", "＠ＡＩ請問"]) {
      expect(withMascotMention(draft)).toBe(draft)
    }
  })

  it("email 與 @AIDS 不算叫了", () => {
    expect(withMascotMention("寄到 x@ai.com")).toBe("@熊熊滾 寄到 x@ai.com")
    expect(withMascotMention("@AIDS 衛教單張")).toBe("@熊熊滾 @AIDS 衛教單張")
  })
})
