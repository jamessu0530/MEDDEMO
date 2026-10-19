import { describe, expect, it } from "vitest"
import type { Customer, PurchasedProduct } from "@/api/customers"
import {
  matchesCustomerKeyword,
  matchesPurchasedProduct,
  purchaseKeywordPreview,
  rankPurchasedProducts,
} from "./customer-purchases"

const fish: PurchasedProduct = {
  sku: "P01",
  name: "深海魚油",
  category: "保健食品",
  spec: "60 粒",
  unit: "盒",
  aliases: ["Omega 3"],
  order_count: 2,
  total_qty: 12,
  last_order_date: "2031-04-17",
}

describe("商家叫貨關鍵字", () => {
  it("依累計叫貨量取前三項，較新的少量叫貨不會擠掉大量品項", () => {
    const products = [
      { ...fish, sku: "small", total_qty: 1, last_order_date: "2031-04-18" },
      { ...fish, sku: "big", total_qty: 100, last_order_date: "2020-01-01" },
      { ...fish, sku: "medium", total_qty: 30 },
      { ...fish, sku: "fourth", total_qty: 5 },
    ]
    expect(purchaseKeywordPreview(products, "").map((p) => p.sku)).toEqual([
      "big",
      "medium",
      "fourth",
    ])
    expect(products[0].sku).toBe("small")
    expect(
      rankPurchasedProducts([
        { ...fish, sku: "one", order_count: 1 },
        { ...fish, sku: "many", order_count: 5 },
      ])[0].sku
    ).toBe("many")
  })
  it("可用部分品名、別名、料號、品類與規格搜尋，統一全形及空白", () => {
    for (const query of ["魚油", "ＯＭＥＧＡ　３", "p01", "保健", "６０粒"])
      expect(matchesPurchasedProduct(fish, query)).toBe(true)
    expect(matchesPurchasedProduct(fish, "葉黃素")).toBe(false)
  })

  it("搜尋命中的品項即使叫貨量不在前三名，也會顯示在預覽前面", () => {
    const others = Array.from({ length: 4 }, (_, i) => ({
      ...fish,
      sku: `X${i}`,
      name: `品項${i}`,
      aliases: [],
      total_qty: fish.total_qty + i + 1,
    }))
    expect(
      purchaseKeywordPreview([...others, fish], "魚油").map((p) => p.sku)
    ).toEqual(["P01", "X3", "X2"])
    expect(
      purchaseKeywordPreview([...others, fish], "").map((p) => p.sku)
    ).toEqual(["X3", "X2", "X1"])
  })

  it("舊快取沒有品項欄位時仍可搜尋店家；有品項時能依叫貨搜尋", () => {
    const store = {
      id: "C1",
      name: "安心藥局",
      city: "臺北",
      address: "中正路1號",
      phone: "0223456789",
    } as Customer
    expect(matchesCustomerKeyword(store, "台北")).toBe(true)
    expect(matchesCustomerKeyword(store, "魚油")).toBe(false)
    expect(
      matchesCustomerKeyword(
        { ...store, purchased_products: [fish] },
        "Omega 3"
      )
    ).toBe(true)
    expect(matchesCustomerKeyword(store, " ")).toBe(true)
  })
})
