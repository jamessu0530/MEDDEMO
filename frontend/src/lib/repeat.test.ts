import { describe, expect, it } from "vitest"

import type { IntentItem, RepeatSnapshot } from "@/api/visits"
import { repeatHeader, repeatNotes } from "@/lib/repeat"

const SNAPSHOT: RepeatSnapshot = {
  said: "跟上次一樣就好",
  all: true,
  except_skus: ["D120013"],
  except_names: ["威鎮凝膠"],
  order: { order_no: "SO20261005-C001", date: "2026-10-05" },
  quote: { quote_no: "Q20260930-0001", date: "2026-09-30" },
  empty: false,
  copied: 21,
  changes: [
    { sku: "F763630", promo_code: null, text: "中口這期沒了，只剩小口（買 22 送 1，$3,080）" },
    { sku: "C130082", promo_code: "NOW-J", text: "從買 10 送 2 變成買 15 送 2，一口 $800 → $1,200" },
  ],
  relative: [
    { sku: "F749579", promo_code: "NOW-P", last_qty: 1, delta: 1 },
    { sku: "HS-FO30", promo_code: null, last_qty: 32, delta: -5 },
    { sku: "HS-CA60", promo_code: null, last_qty: 0, delta: 6 },
    { sku: "HS-GL60", promo_code: null, last_qty: 18, delta: 0 },
  ],
}

const item = (sku: string, promo_code: string | null, unit: string | null): IntentItem => ({
  product_text: sku, sku, qty: 1, unit, promo_code,
})

describe("repeatHeader", () => {
  it("寫抄了幾項、照哪兩張、幾項促銷變了", () => {
    expect(repeatHeader(SNAPSHOT)).toBe("照上次的單抄了 21 項（10/5 進貨、9/30 報價），2 項促銷變了")
    expect(repeatHeader({ ...SNAPSHOT, changes: [], quote: null })).toBe("照上次的單抄了 21 項（10/5 進貨）")
    expect(repeatHeader({ ...SNAPSHOT, all: false })).toBeNull()
    expect(repeatHeader({ ...SNAPSHOT, empty: true })).toBeNull()
  })
})

describe("repeatNotes", () => {
  it("照品項與口對到變了什麼、加減多少", () => {
    expect(repeatNotes(item("F763630", null, "瓶"), SNAPSHOT)).toEqual({ warnings: [SNAPSHOT.changes[0].text], notes: [] })
    // 口對不上就不是同一列：這期的小口不是上次的不走促銷
    expect(repeatNotes(item("F763630", "NOW-S", "口"), SNAPSHOT)).toEqual({ warnings: [], notes: [] })
    expect(repeatNotes(item("F749579", "NOW-P", "口"), SNAPSHOT).notes).toEqual(["上次 1 口，這次多 1 口"])
    expect(repeatNotes(item("HS-FO30", null, "盒"), SNAPSHOT).notes).toEqual(["上次 32 盒，這次少 5 盒"])
    expect(repeatNotes(item("HS-CA60", null, "瓶"), SNAPSHOT).notes).toEqual(["上次沒有，這次加 6 瓶"])
    expect(repeatNotes(item("HS-GL60", null, "瓶"), SNAPSHOT).notes).toEqual(["照上次 18 瓶"])
  })
})
