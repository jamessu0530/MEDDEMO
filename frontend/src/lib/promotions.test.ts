import { describe, expect, it } from "vitest"

import type { Promotion, PromotionItem } from "@/api/promotions"
import { dealLabel, groupItems, matches, pickPromotion, splitNote } from "@/lib/promotions"

const item = (group_name: string, name: string) => ({ group_name, name }) as PromotionItem
const period = (name: string, status: Promotion["status"]) => ({ name, status }) as Promotion

describe("splitNote", () => {
  it("每個「* 標題」開一段，後面的行都算這段的內容", () => {
    const note = "* 骨營滿額贈\n下單滿$3,000贈1組\n例：下單1大口\n* 黴癒8-9月品牌滿額贈\n$5,000元，贈4支"
    expect(splitNote(note)).toEqual([
      { title: "骨營滿額贈", body: "下單滿$3,000贈1組\n例：下單1大口" },
      { title: "黴癒8-9月品牌滿額贈", body: "$5,000元，贈4支" },
    ])
  })

  it("第一個標題之前的字不會掉，空的提醒就沒有段落", () => {
    expect(splitNote("本月注意\n* 骨營滿額贈\n可累計")).toEqual([
      { title: "", body: "本月注意" },
      { title: "骨營滿額贈", body: "可累計" },
    ])
    expect(splitNote("")).toEqual([])
  })
})

describe("groupItems", () => {
  it("同品牌放一起，品牌照第一次出現的順序", () => {
    const items = [item("骨營", "骨營粉劑"), item("骨營", "骨營膠囊600T(小口)"), item("黴癒", "LISIM CREAM乳膏")]
    expect(groupItems(items).map((g) => [g.name, g.items.map((i) => i.name)])).toEqual([
      ["骨營", ["骨營粉劑", "骨營膠囊600T(小口)"]],
      ["黴癒", ["LISIM CREAM乳膏"]],
    ])
  })
})

describe("matches", () => {
  it("不分大小寫、任一欄位有就算，沒打字全部都算", () => {
    expect(matches("lisim", "黴癒", "LISIM CREAM乳膏")).toBe(true)
    expect(matches(" 眼藥水 ", "獅王眼藥水")).toBe(true)
    expect(matches("骨營", "黴癒", "LISIM CREAM乳膏")).toBe(false)
    expect(matches("", "任何東西")).toBe(true)
  })
})

describe("pickPromotion", () => {
  const promotions = [period("202611", "未開始"), period("202610", "進行中"), period("202609", "已結束")]

  it("選過的那一期優先，否則看進行中的", () => {
    expect(pickPromotion(promotions, "202609")?.name).toBe("202609")
    expect(pickPromotion(promotions, null)?.name).toBe("202610")
  })

  it("沒有進行中的就看最新的一期，沒有任何一期就是空的", () => {
    expect(pickPromotion([period("202609", "已結束"), period("202608", "已結束")], null)?.name).toBe("202609")
    expect(pickPromotion([], null)).toBeUndefined()
  })
})

describe("dealLabel", () => {
  it("有送同品寫買幾送幾，直走價寫幾個一起走", () => {
    expect(dealLabel({ buy_qty: 11, free_qty: 1, unit: "組" })).toBe("買 11 送 1")
    expect(dealLabel({ buy_qty: 7, free_qty: 0, unit: "盒" })).toBe("直走 7 盒")
  })
})
