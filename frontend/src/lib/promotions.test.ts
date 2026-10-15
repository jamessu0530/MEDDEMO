import { describe, expect, it } from "vitest"

import type { Promotion, PromotionItem } from "@/api/promotions"
import {
  categoryBestCodes,
  dealLabel,
  DEFAULT_PROMOTION_FILTERS,
  filterPromotionItems,
  groupItems,
  matches,
  pickPromotion,
  splitNote,
} from "@/lib/promotions"

const item = (group_name: string, name: string) =>
  ({ group_name, name }) as PromotionItem
const period = (name: string, status: Promotion["status"]) =>
  ({ name, status }) as Promotion

describe("splitNote", () => {
  it("每個「* 標題」開一段，後面的行都算這段的內容", () => {
    const note =
      "* 骨營滿額贈\n下單滿$3,000贈1組\n例：下單1大口\n* 黴癒8-9月品牌滿額贈\n$5,000元，贈4支"
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
    const items = [
      item("骨營", "骨營粉劑"),
      item("骨營", "骨營膠囊600T(小口)"),
      item("黴癒", "LISIM CREAM乳膏"),
    ]
    expect(
      groupItems(items).map((g) => [g.name, g.items.map((i) => i.name)])
    ).toEqual([
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
  const promotions = [
    period("202611", "未開始"),
    period("202610", "進行中"),
    period("202609", "已結束"),
  ]

  it("選過的那一期優先，否則看進行中的", () => {
    expect(pickPromotion(promotions, "202609")?.name).toBe("202609")
    expect(pickPromotion(promotions, null)?.name).toBe("202610")
  })

  it("沒有進行中的就看最新的一期，沒有任何一期就是空的", () => {
    expect(
      pickPromotion(
        [period("202609", "已結束"), period("202608", "已結束")],
        null
      )?.name
    ).toBe("202609")
    expect(pickPromotion([], null)).toBeUndefined()
  })
})

describe("dealLabel", () => {
  it("有送同品寫買幾送幾，直走價寫幾個一起走", () => {
    expect(dealLabel({ buy_qty: 11, free_qty: 1, unit: "組" })).toBe(
      "買 11 送 1"
    )
    expect(dealLabel({ buy_qty: 7, free_qty: 0, unit: "盒" })).toBe("直走 7 盒")
  })
})

const offers: PromotionItem[] = [
  {
    code: "A",
    category: "一般用藥",
    group_name: "獅王",
    name: "Pure(小口)",
    sku: "PURE",
    spec: "15ML",
    deal: "買十送二",
    buy_qty: 10,
    free_qty: 2,
    unit: "瓶",
    deal_price: 1200,
    unit_deal_price: 100,
    list_price: 200,
    ship_price: 125,
    discount_rate: 0.2,
  },
  {
    code: "B",
    category: "保健品",
    group_name: "骨營",
    name: "骨營粉劑",
    sku: "BONE",
    spec: "30包",
    deal: "直走",
    buy_qty: 5,
    free_qty: 0,
    unit: "盒",
    deal_price: 1750,
    unit_deal_price: 350,
    list_price: 700,
    ship_price: 500,
    discount_rate: 0.3,
  },
  {
    code: "C",
    category: "一般用藥",
    group_name: "金舒",
    name: "胃藥(大口)",
    sku: "STOMACH",
    spec: "20T",
    deal: "買五十送二十",
    buy_qty: 50,
    free_qty: 20,
    unit: "盒",
    deal_price: 4900,
    unit_deal_price: 70,
    list_price: 200,
    ship_price: 100,
    discount_rate: 0.3,
  },
  {
    code: "D",
    category: "一般用藥",
    group_name: "獅王",
    name: "Premium(大口)",
    sku: "PREMIUM",
    spec: "15ML",
    deal: "買十送二",
    buy_qty: 10,
    free_qty: 2,
    unit: "瓶",
    deal_price: 2100,
    unit_deal_price: 175,
    list_price: 400,
    ship_price: 250,
    discount_rate: 0.3,
  },
]

describe("categoryBestCodes", () => {
  it("依商品類別比較，跨品牌的並列最高都保留", () => {
    expect([...categoryBestCodes(offers)]).toEqual(["B", "C", "D"])
    expect([...categoryBestCodes([])]).toEqual([])
  })

  it("切到另一期時使用那一期的條件", () => {
    const nextPeriod = offers.map((offer) => ({
      ...offer,
      discount_rate: offer.code === "A" ? 0.4 : offer.discount_rate,
    }))
    expect([...categoryBestCodes(nextPeriod)]).toEqual(["A", "B"])
  })
})

describe("filterPromotionItems", () => {
  it("不限折扣時不會漏掉零折扣或較出貨價貴的品項", () => {
    const noSavings = offers.map((offer) => ({ ...offer, discount_rate: -0.1 }))
    expect(
      filterPromotionItems(noSavings, DEFAULT_PROMOTION_FILTERS)
    ).toHaveLength(offers.length)
  })
  it("可同時篩類別、品牌、搭贈、折扣門檻與關鍵字，門檻含等於", () => {
    expect(
      filterPromotionItems(offers, {
        ...DEFAULT_PROMOTION_FILTERS,
        category: "一般用藥",
        brand: "獅王",
        dealType: "gift",
        minDiscount: 0.3,
        query: "premium",
      }).map((offer) => offer.code)
    ).toEqual(["D"])
    expect(
      filterPromotionItems(offers, {
        ...DEFAULT_PROMOTION_FILTERS,
        dealType: "direct",
      }).map((offer) => offer.code)
    ).toEqual(["B"])
    expect(
      filterPromotionItems(offers, {
        ...DEFAULT_PROMOTION_FILTERS,
        category: "醫材",
      })
    ).toEqual([])
  })

  it("各類別最高仍比較全期品項，不因品牌或搜尋變窄就誤選", () => {
    expect(
      filterPromotionItems(offers, {
        ...DEFAULT_PROMOTION_FILTERS,
        bestOnly: true,
        brand: "獅王",
      }).map((offer) => offer.code)
    ).toEqual(["D"])
    expect(
      filterPromotionItems(offers, {
        ...DEFAULT_PROMOTION_FILTERS,
        bestOnly: true,
        query: "Pure(小口)",
      })
    ).toEqual([])
    expect(
      filterPromotionItems(offers, {
        ...DEFAULT_PROMOTION_FILTERS,
        bestOnly: true,
      }).map((offer) => offer.code)
    ).toEqual(["B", "C", "D"])
  })

  it("搜尋也包含商品類別、料號與規格", () => {
    expect(
      filterPromotionItems(offers, {
        ...DEFAULT_PROMOTION_FILTERS,
        query: "保健品",
      }).map((offer) => offer.code)
    ).toEqual(["B"])
    expect(
      filterPromotionItems(offers, {
        ...DEFAULT_PROMOTION_FILTERS,
        query: "stomach",
      }).map((offer) => offer.code)
    ).toEqual(["C"])
    expect(
      filterPromotionItems(offers, {
        ...DEFAULT_PROMOTION_FILTERS,
        query: "30包",
      }).map((offer) => offer.code)
    ).toEqual(["B"])
  })

  it("折扣排序跨品牌，折扣相同保留原順序，也可按平均單價排序", () => {
    expect(
      filterPromotionItems(offers, {
        ...DEFAULT_PROMOTION_FILTERS,
        sort: "discount_desc",
      }).map((offer) => offer.code)
    ).toEqual(["B", "C", "D", "A"])
    expect(
      filterPromotionItems(offers, {
        ...DEFAULT_PROMOTION_FILTERS,
        sort: "unit_price_asc",
      }).map((offer) => offer.code)
    ).toEqual(["C", "A", "D", "B"])
    expect(offers.map((offer) => offer.code)).toEqual(["A", "B", "C", "D"])
  })
})
