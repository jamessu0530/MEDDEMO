import { describe, expect, it } from "vitest"

import type { MethodCard } from "@/api/methods"
import { filterCards, tagLabel, TAG_LABELS, TAGS } from "@/lib/methods"

const card = (id: number, customer_type: MethodCard["customer_type"], tags: string[], extra: Partial<MethodCard> = {}) =>
  ({ id, title: `第 ${id} 張`, situation: "", approach: "", customer_type, tags, ...extra }) as MethodCard

const cards = [
  card(1, "chain", ["competitor"], { title: "御松田來搶陳列位" }),
  card(2, "clinic", ["cost"], { situation: "診所的慢箋量在長", approach: "帶學名藥比價表，先講 Amlodipine 的價差" }),
  card(3, null, ["newcomer"], { title: "新人第一次拜訪" }),
  card(4, null, ["cost", "newcomer"], { approach: "超過 3% 不要當場答應" }),
  card(5, "independent", ["cost"], { situation: "老闆怕壓庫存" }),
]
const ids = (found: MethodCard[]) => found.map((c) => c.id)
const all = { tag: null, customerType: null, keyword: "" }

describe("TAG_LABELS", () => {
  it("後端那七個標籤都有畫面上的名稱，順序就是篩選列的順序", () => {
    expect(TAGS).toEqual(["competitor", "interval_up", "contract_ending", "ar_overdue", "festival", "cost", "newcomer"])
    expect(TAG_LABELS.competitor).toBe("客戶提到競品")
    expect(TAG_LABELS.newcomer).toBe("新人必看")
    expect(TAGS.every((tag) => TAG_LABELS[tag])).toBe(true)
  })

  it("不認得的標籤照原樣顯示，不會整張卡壞掉", () => {
    expect(tagLabel("cost")).toBe("談進價與成本")
    expect(tagLabel("brand_new_tag")).toBe("brand_new_tag")
  })
})

describe("filterCards", () => {
  it("沒有條件就是全部，順序照後端排好的", () => {
    expect(ids(filterCards(cards, all))).toEqual([1, 2, 3, 4, 5])
  })

  it("標籤：卡片掛的標籤裡有這一個就算", () => {
    expect(ids(filterCards(cards, { ...all, tag: "cost" }))).toEqual([2, 4, 5])
    expect(ids(filterCards(cards, { ...all, tag: "newcomer" }))).toEqual([3, 4])
    expect(ids(filterCards(cards, { ...all, tag: "festival" }))).toEqual([])
  })

  it("適用類型：指定那一種的，加上每種客戶都適用的", () => {
    expect(ids(filterCards(cards, { ...all, customerType: "clinic" }))).toEqual([2, 3, 4])
    expect(ids(filterCards(cards, { ...all, customerType: "chain" }))).toEqual([1, 3, 4])
  })

  it("關鍵字在標題、情況、做法裡找，英文不分大小寫", () => {
    expect(ids(filterCards(cards, { ...all, keyword: "御松田" }))).toEqual([1])
    expect(ids(filterCards(cards, { ...all, keyword: " 壓庫存 " }))).toEqual([5])
    expect(ids(filterCards(cards, { ...all, keyword: "amlodipine" }))).toEqual([2])
    expect(ids(filterCards(cards, { ...all, keyword: "3%" }))).toEqual([4])
  })

  it("三個條件一起用是都要符合", () => {
    expect(ids(filterCards(cards, { tag: "cost", customerType: "independent", keyword: "" }))).toEqual([4, 5])
    expect(ids(filterCards(cards, { tag: "cost", customerType: "independent", keyword: "庫存" }))).toEqual([5])
  })
})
