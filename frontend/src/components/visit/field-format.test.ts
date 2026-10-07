import { describe, expect, it } from "vitest"

import type { PromotionItem } from "@/api/promotions"
import { intentLine } from "@/components/visit/field-format"

const SMALL = {
  code: "PP-1",
  name: "Premium眼藥水(小口)",
  sku: "F749579",
  buy_qty: 22,
  free_qty: 1,
  deal_price: 5500,
} as PromotionItem

describe("intentLine", () => {
  it("促銷的口寫出買幾送幾與金額", () => {
    const item = { product_text: "小口 Premium", sku: "F749579", qty: 2, unit: "口", promo_code: "PP-1" }
    expect(intentLine(item, SMALL)).toBe("Premium眼藥水(小口) × 2 口（買 22 送 1，NT$11,000）")
  })
  it("沒促銷、或查不到那一口，照口述講法", () => {
    expect(intentLine({ product_text: "魚油", sku: "HS-FO30", qty: 20, unit: "盒", promo_code: null })).toBe("魚油 × 20盒")
    expect(intentLine({ product_text: "小口眼藥水", sku: null, qty: 1, unit: "口", promo_code: "PP-9" })).toBe("小口眼藥水 × 1口")
  })
})
