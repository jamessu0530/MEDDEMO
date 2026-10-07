import { describe, expect, it } from "vitest"

import type { LastOrder, LastOrderLine } from "@/api/customers"
import { lastOrderLine, lastOrderSources, repeatFill, splitLastOrder } from "@/lib/last-order"

const MID = { code: "OLD-M", name: "40EXa眼藥水(中口)", deal: "<57+4>", buy_qty: 57, free_qty: 4, deal_price: 7980 }

function line(values: Partial<LastOrderLine>): LastOrderLine {
  return {
    sku: "HS-FO30", name: "魚油 30 入", spec: "30 粒", unit: "盒", supply_price: 405, qty: 32, pack: null,
    source: "order", change: null, repeat: { sku: "HS-FO30", qty: 32 }, ...values,
  }
}

const GONE = { kind: "pack_gone" as const, text: "中口這期沒了，只剩小口（買 22 送 1，$3,080）", short: "40EXa眼藥水(中口)沒了" }
const LAST: LastOrder = {
  order: { order_no: "SO20261005-C001", date: "2026-10-05" },
  quote: { quote_no: "Q20260930-0001", date: "2026-09-30" },
  lines: [
    line({ sku: "F763630", name: "40EXa眼藥水", unit: "瓶", qty: 1, pack: MID, source: "quote", change: GONE, repeat: { sku: "F763630", qty: 57 } }),
    line({}),
    line({ sku: "D120013", name: "威鎮凝膠", unit: "支", supply_price: 81, qty: 2, source: "quote", repeat: { sku: "D120013", qty: 22 } }),
    line({ sku: "F749579", name: "Premium眼藥水", qty: 1, source: "quote", repeat: { promo_code: "NOW-P", packs: 1 } }),
  ],
  changed: 1,
}

describe("lastOrderSources", () => {
  it("只寫有用到的那張", () => {
    expect(lastOrderSources(LAST)).toBe("10/5 進貨 · 9/30 報價")
    expect(lastOrderSources({ ...LAST, quote: null }, "、")).toBe("10/5 進貨")
  })
})

describe("lastOrderLine", () => {
  it("走口的寫口數，沒走口的寫數量與單位", () => {
    expect(lastOrderLine(LAST.lines[0])).toBe("40EXa眼藥水(中口) × 1 口")
    expect(lastOrderLine(LAST.lines[1])).toBe("魚油 30 入 × 32 盒")
  })
})

describe("splitLastOrder", () => {
  it("變了的全部列出，沒變的先列幾項", () => {
    const { visible, hidden } = splitLastOrder(LAST.lines, 2)
    expect(visible.map((l) => l.sku)).toEqual(["F763630", "HS-FO30", "D120013"])
    expect(hidden.map((l) => l.sku)).toEqual(["F749579"])
  })
})

describe("repeatFill", () => {
  it("先清成 0 再照上次填，頁面上沒有的品項加列", () => {
    const fill = repeatFill(LAST, ["HS-FO30", "HS-CA60", "F763630"], ["NOW-P", "NOW-S"])
    expect(fill.quantities).toEqual({ "HS-FO30": "32", "HS-CA60": "0", F763630: "57", D120013: "22" })
    expect(fill.packCounts).toEqual({ "NOW-P": "1", "NOW-S": "0" })
    expect(fill.extra).toEqual([{ sku: "D120013", name: "威鎮凝膠", spec: "30 粒", unit: "支", unit_price: 81, usual_qty: 0 }])
    expect(fill.notes).toEqual({ F763630: GONE.text })
  })

  it("同一個品項不走促銷出現兩次，數量相加", () => {
    const twice = { ...LAST, lines: [LAST.lines[0], line({ sku: "F763630", qty: 10, repeat: { sku: "F763630", qty: 10 } })] }
    expect(repeatFill(twice, ["F763630"], []).quantities).toEqual({ F763630: "67" })
  })
})
